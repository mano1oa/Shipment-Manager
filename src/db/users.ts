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

export async function updateUserRole(
  userId: string,
  role: UserRole
) {
  const sql = getDb();

  const rows = await sql`
    UPDATE users
    SET
      role = ${role},
      updated_at = NOW()
    WHERE id = ${userId}
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

  return rows[0] ?? null;
}

export async function updateUserStatus(
  userId: string,
  isActive: boolean
) {
  const sql = getDb();

  const rows = await sql`
    UPDATE users
    SET
      is_active = ${isActive},
      updated_at = NOW()
    WHERE id = ${userId}
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

  return rows[0] ?? null;
}