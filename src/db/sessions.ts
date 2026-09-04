import crypto from 'crypto';
import { getDb } from './neon.ts';

const SESSION_DURATION_DAYS = 7;

function hashToken(token: string): string {
  return crypto
    .createHash('sha256')
    .update(token)
    .digest('hex');
}

export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export async function createSession(userId: string) {
  const sql = getDb();

  const token = generateSessionToken();
  const tokenHash = hashToken(token);

  const expiresAt = new Date(
    Date.now() + SESSION_DURATION_DAYS * 24 * 60 * 60 * 1000
  );

  await sql`
    INSERT INTO user_sessions (
      user_id,
      token_hash,
      expires_at
    )
    VALUES (
      ${userId},
      ${tokenHash},
      ${expiresAt.toISOString()}
    )
  `;

  return {
    token,
    expiresAt,
  };
}

export async function getSessionUser(token: string) {
  const sql = getDb();

  const tokenHash = hashToken(token);

  const rows = await sql`
    SELECT
      u.id,
      u.email,
      u.display_name,
      u.role,
      u.is_active,
      s.id AS session_id,
      s.expires_at
    FROM user_sessions s
    JOIN users u
      ON u.id = s.user_id
    WHERE s.token_hash = ${tokenHash}
      AND s.expires_at > NOW()
      AND u.is_active = TRUE
    LIMIT 1
  `;

  if (!rows[0]) {
    return null;
  }

  await sql`
    UPDATE user_sessions
    SET last_used_at = NOW()
    WHERE id = ${rows[0].session_id}
  `;

  return rows[0];
}

export async function deleteSession(token: string) {
  const sql = getDb();

  const tokenHash = hashToken(token);

  await sql`
    DELETE FROM user_sessions
    WHERE token_hash = ${tokenHash}
  `;
}
