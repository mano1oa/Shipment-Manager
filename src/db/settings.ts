import { getDb } from './neon.js';
import { DEFAULT_TRACKING_SETTINGS, SETTING_LIMITS } from '../lib/parcelTracking.js';
import type { TrackingSettings } from '../lib/parcelTracking.js';

/**
 * Settings editable in Paramètres (one JSON value per key). A key never set
 * uses its default from DEFAULT_TRACKING_SETTINGS.
 */

let settingsSchemaPromise: Promise<void> | null = null;

function ensureSettingsSchema(): Promise<void> {
  if (!settingsSchemaPromise) {
    settingsSchemaPromise = (async () => {
      const sql = getDb();
      await sql`
        CREATE TABLE IF NOT EXISTS app_settings (
          key VARCHAR(100) PRIMARY KEY,
          value JSONB,
          updated_by_email VARCHAR(255),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `;
    })().catch((err) => {
      settingsSchemaPromise = null;
      throw err;
    });
  }
  return settingsSchemaPromise;
}

export async function getTrackingSettings(): Promise<TrackingSettings> {
  await ensureSettingsSchema();
  const sql = getDb();
  const keys = Object.keys(DEFAULT_TRACKING_SETTINGS);
  const rows = await sql`SELECT key, value FROM app_settings WHERE key = ANY(${keys}::text[])`;
  const settings: TrackingSettings = { ...DEFAULT_TRACKING_SETTINGS };
  for (const row of rows as any[]) {
    const value = row.value;
    if (row.key === 'usd_eur_rate') {
      settings.usd_eur_rate = typeof value === 'number' && value > 0 ? value : null;
    } else if (row.key in SETTING_LIMITS && Number.isInteger(value)) {
      (settings as any)[row.key] = value;
    }
  }
  return settings;
}

/** Validates a partial update. Returns the errors (empty when valid). */
export function validateTrackingSettings(raw: any): { value: Partial<TrackingSettings>; errors: string[] } {
  const errors: string[] = [];
  const value: Partial<TrackingSettings> = {};
  if (!raw || typeof raw !== 'object') return { value, errors: ['Paramètres invalides.'] };

  if ('usd_eur_rate' in raw) {
    const rate = raw.usd_eur_rate;
    if (rate === null) value.usd_eur_rate = null;
    else if (typeof rate === 'number' && rate > 0 && rate < 100) value.usd_eur_rate = rate;
    else errors.push('Taux USD → EUR : nombre positif attendu.');
  }
  for (const [key, [min, max]] of Object.entries(SETTING_LIMITS)) {
    if (!(key in raw)) continue;
    const n = raw[key];
    if (Number.isInteger(n) && n >= min && n <= max) (value as any)[key] = n;
    else errors.push(`${key} : entier entre ${min} et ${max} attendu.`);
  }
  return { value, errors };
}

export async function saveTrackingSettings(update: Partial<TrackingSettings>, actorEmail: string): Promise<TrackingSettings> {
  await ensureSettingsSchema();
  const sql = getDb();
  for (const [key, value] of Object.entries(update)) {
    await sql`
      INSERT INTO app_settings (key, value, updated_by_email, updated_at)
      VALUES (${key}, ${JSON.stringify(value)}::jsonb, ${actorEmail}, NOW())
      ON CONFLICT (key) DO UPDATE SET
        value = EXCLUDED.value, updated_by_email = EXCLUDED.updated_by_email, updated_at = NOW()
    `;
  }
  return getTrackingSettings();
}
