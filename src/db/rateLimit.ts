import { getDb } from './neon.js';

/**
 * Fixed-window rate limiter persisted in Neon.
 *
 * In-memory counters do not work on Vercel Serverless (each instance has its
 * own memory and instances are short-lived), so counters live in Postgres.
 *
 * Fails OPEN: if the limiter itself errors, the request is allowed and the
 * error is logged — a limiter outage must not lock everyone out.
 */

let rateLimitSchemaPromise: Promise<void> | null = null;

function ensureRateLimitSchema(): Promise<void> {
  if (!rateLimitSchemaPromise) {
    const sql = getDb();
    rateLimitSchemaPromise = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS api_rate_limits (
          bucket VARCHAR(255) PRIMARY KEY,
          window_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          count INT NOT NULL DEFAULT 0
        );
      `;
    })().catch((err) => {
      rateLimitSchemaPromise = null;
      throw err;
    });
  }
  return rateLimitSchemaPromise;
}

export interface RateLimitResult {
  allowed: boolean;
  count: number;
  retryAfterSeconds: number;
}

/**
 * Counts one hit on `bucket` and tells whether it is within `limit` hits per
 * `windowSeconds`. The window restarts once it has fully elapsed.
 */
export async function consumeRateLimit(
  bucket: string,
  limit: number,
  windowSeconds: number
): Promise<RateLimitResult> {
  try {
    await ensureRateLimitSchema();
    const sql = getDb();

    const rows = await sql`
      INSERT INTO api_rate_limits (bucket, window_start, count)
      VALUES (${bucket}, NOW(), 1)
      ON CONFLICT (bucket) DO UPDATE SET
        count = CASE
          WHEN api_rate_limits.window_start <= NOW() - make_interval(secs => ${windowSeconds})
          THEN 1
          ELSE api_rate_limits.count + 1
        END,
        window_start = CASE
          WHEN api_rate_limits.window_start <= NOW() - make_interval(secs => ${windowSeconds})
          THEN NOW()
          ELSE api_rate_limits.window_start
        END
      RETURNING
        count,
        GREATEST(
          0,
          CEIL(EXTRACT(EPOCH FROM (window_start + make_interval(secs => ${windowSeconds}) - NOW())))
        )::int AS retry_after
    `;

    const count = Number(rows[0]?.count ?? 0);
    return {
      allowed: count <= limit,
      count,
      retryAfterSeconds: Number(rows[0]?.retry_after ?? windowSeconds),
    };
  } catch (err: any) {
    console.error('[RateLimit] consume failed (allowing request):', bucket, err?.message || err);
    return { allowed: true, count: 0, retryAfterSeconds: 0 };
  }
}

/**
 * Reads the current count of `bucket` without incrementing it.
 */
export async function peekRateLimit(
  bucket: string,
  limit: number,
  windowSeconds: number
): Promise<RateLimitResult> {
  try {
    await ensureRateLimitSchema();
    const sql = getDb();

    const rows = await sql`
      SELECT
        count,
        GREATEST(
          0,
          CEIL(EXTRACT(EPOCH FROM (window_start + make_interval(secs => ${windowSeconds}) - NOW())))
        )::int AS retry_after
      FROM api_rate_limits
      WHERE bucket = ${bucket}
        AND window_start > NOW() - make_interval(secs => ${windowSeconds})
      LIMIT 1
    `;

    const count = Number(rows[0]?.count ?? 0);
    return {
      allowed: count < limit,
      count,
      retryAfterSeconds: Number(rows[0]?.retry_after ?? 0),
    };
  } catch (err: any) {
    console.error('[RateLimit] peek failed (allowing request):', bucket, err?.message || err);
    return { allowed: true, count: 0, retryAfterSeconds: 0 };
  }
}

export async function resetRateLimit(bucket: string): Promise<void> {
  try {
    await ensureRateLimitSchema();
    const sql = getDb();
    await sql`DELETE FROM api_rate_limits WHERE bucket = ${bucket}`;
  } catch (err: any) {
    console.error('[RateLimit] reset failed:', bucket, err?.message || err);
  }
}

/**
 * Best-effort client IP. On Vercel, x-forwarded-for is set by the platform
 * (first entry = client).
 */
export function getClientIp(req: any): string {
  const forwarded = req.headers?.['x-forwarded-for'];
  const first =
    typeof forwarded === 'string'
      ? forwarded.split(',')[0]?.trim()
      : Array.isArray(forwarded)
        ? forwarded[0]
        : '';
  const realIp = req.headers?.['x-real-ip'];
  return (first || (typeof realIp === 'string' ? realIp : '') || req.ip || 'unknown').slice(0, 64);
}
