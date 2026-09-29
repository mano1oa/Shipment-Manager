import bcrypt from 'bcryptjs';
import { getDb } from './neon.js';

export type UserRole =
  | 'SUPPLY_CHAIN'
  | 'SOURCING'
  | 'DIRECTION';

export interface UserRecord {
  id: string;
  email: string;
  display_name: string;
  role: UserRole;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
}

export interface UserWithPassword extends UserRecord {
  password_hash: string;
}

export async function createUser(params: {
  email: string;
  password: string;
  displayName: string;
  role?: UserRole;
}): Promise<UserRecord> {
  const sql = getDb();

  const email = params.email.trim().toLowerCase();
  const displayName = params.displayName.trim();
  const passwordHash = await bcrypt.hash(params.password, 12);

  const rows = await sql`
    INSERT INTO users (
      email,
      password_hash,
      display_name,
      role
    )
    VALUES (
      ${email},
      ${passwordHash},
      ${displayName},
      ${params.role ?? 'SOURCING'}
    )
    RETURNING
      id,
      email,
      display_name,
      role,
      is_active,
      created_at,
      updated_at,
      last_login_at
  `;

  return rows[0] as UserRecord;
}

export async function findUserByEmail(
  email: string
): Promise<UserWithPassword | null> {
  const sql = getDb();

  const normalizedEmail = email.trim().toLowerCase();

  const rows = await sql`
    SELECT
      id,
      email,
      password_hash,
      display_name,
      role,
      is_active,
      created_at,
      updated_at,
      last_login_at
    FROM users
    WHERE email = ${normalizedEmail}
    LIMIT 1
  `;

  return (rows[0] as UserWithPassword) ?? null;
}

export async function verifyUserPassword(
  password: string,
  passwordHash: string
): Promise<boolean> {
  return bcrypt.compare(password, passwordHash);
}
export async function updateLastLogin(userId: string) {
  const sql = getDb();

  await sql`
    UPDATE users
    SET
      last_login_at = NOW(),
      updated_at = NOW()
    WHERE id = ${userId}
  `;
}


export async function listUsers() {
  const sql = getDb();

  return await sql`
    SELECT
      id,
      email,
      display_name,
      role,
      is_active,
      created_at,
      updated_at,
      last_login_at
    FROM users
    ORDER BY created_at DESC
  `;
}

export type GuardedUpdateResult =
  | { ok: true; user: UserRecord; previous: { role: UserRole; is_active: boolean } }
  | { ok: false; reason: 'NOT_FOUND' | 'LAST_ACTIVE_SUPPLY_CHAIN' };

async function getUserState(userId: string) {
  const sql = getDb();
  const rows = await sql`
    SELECT id, role, is_active FROM users WHERE id = ${userId} LIMIT 1
  `;
  return (rows[0] as { id: string; role: UserRole; is_active: boolean }) ?? null;
}

/**
 * Changes a user's role. Refuses to remove the SUPPLY_CHAIN role from the last
 * active SUPPLY_CHAIN account (the check and the update run in one statement).
 */
export async function updateUserRole(
  userId: string,
  role: UserRole
): Promise<GuardedUpdateResult> {
  const sql = getDb();

  const before = await getUserState(userId);
  if (!before) return { ok: false, reason: 'NOT_FOUND' };

  const rows = await sql`
    UPDATE users
    SET
      role = ${role},
      updated_at = NOW()
    WHERE id = ${userId}
      AND (
        ${role} = 'SUPPLY_CHAIN'
        OR NOT (role = 'SUPPLY_CHAIN' AND is_active = TRUE)
        OR EXISTS (
          SELECT 1 FROM users other
          WHERE other.role = 'SUPPLY_CHAIN'
            AND other.is_active = TRUE
            AND other.id <> ${userId}
        )
      )
    RETURNING
      id,
      email,
      display_name,
      role,
      is_active,
      created_at,
      updated_at,
      last_login_at
  `;

  if (!rows[0]) return { ok: false, reason: 'LAST_ACTIVE_SUPPLY_CHAIN' };
  return {
    ok: true,
    user: rows[0] as UserRecord,
    previous: { role: before.role, is_active: before.is_active },
  };
}

/**
 * Activates/deactivates a user. Refuses to deactivate the last active
 * SUPPLY_CHAIN account. Deactivation also deletes the user's sessions.
 */
export async function updateUserStatus(
  userId: string,
  isActive: boolean
): Promise<GuardedUpdateResult> {
  const sql = getDb();

  const before = await getUserState(userId);
  if (!before) return { ok: false, reason: 'NOT_FOUND' };

  const rows = await sql`
    UPDATE users
    SET
      is_active = ${isActive},
      updated_at = NOW()
    WHERE id = ${userId}
      AND (
        ${isActive} = TRUE
        OR NOT (role = 'SUPPLY_CHAIN' AND is_active = TRUE)
        OR EXISTS (
          SELECT 1 FROM users other
          WHERE other.role = 'SUPPLY_CHAIN'
            AND other.is_active = TRUE
            AND other.id <> ${userId}
        )
      )
    RETURNING
      id,
      email,
      display_name,
      role,
      is_active,
      created_at,
      updated_at,
      last_login_at
  `;

  if (!rows[0]) return { ok: false, reason: 'LAST_ACTIVE_SUPPLY_CHAIN' };

  if (!isActive) {
    await sql`DELETE FROM user_sessions WHERE user_id = ${userId}`;
  }

  return {
    ok: true,
    user: rows[0] as UserRecord,
    previous: { role: before.role, is_active: before.is_active },
  };
}
