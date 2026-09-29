import { getDb, ensureReferenceSchema } from './neon.js';

export type CarrierTransportMode = 'Air' | 'Sea' | 'BOTH';

export const CARRIER_TRANSPORT_MODES: CarrierTransportMode[] = ['Air', 'Sea', 'BOTH'];

export const CARRIER_NAME_MAX_LENGTH = 100;

export interface CarrierRecord {
  id: string;
  name: string;
  transport_mode: CarrierTransportMode;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export class DuplicateReferenceError extends Error {
  constructor(public existing: CarrierRecord) {
    super('Carrier already exists');
  }
}

/**
 * Active carriers, alphabetical. Filtering by transport mode is done by the
 * caller (a carrier with transport_mode = 'BOTH' applies to Air and Sea).
 */
export async function getActiveCarriers(): Promise<CarrierRecord[]> {
  await ensureReferenceSchema();
  const sql = getDb();

  const rows = await sql`
    SELECT id, name, transport_mode, is_active, created_at, updated_at
    FROM shipment_carriers
    WHERE is_active = TRUE
    ORDER BY LOWER(name) ASC
  `;

  return rows as unknown as CarrierRecord[];
}

async function findCarrierByName(name: string): Promise<CarrierRecord | null> {
  const sql = getDb();
  const rows = await sql`
    SELECT id, name, transport_mode, is_active, created_at, updated_at
    FROM shipment_carriers
    WHERE LOWER(TRIM(name)) = LOWER(TRIM(${name}))
    LIMIT 1
  `;
  return (rows[0] as CarrierRecord) ?? null;
}

/**
 * Creates a carrier. `name` must already be trimmed and validated.
 * Throws DuplicateReferenceError on a case-insensitive name collision.
 */
export async function createCarrier(
  name: string,
  transportMode: CarrierTransportMode
): Promise<CarrierRecord> {
  await ensureReferenceSchema();
  const sql = getDb();

  const existing = await findCarrierByName(name);
  if (existing) {
    throw new DuplicateReferenceError(existing);
  }

  try {
    const rows = await sql`
      INSERT INTO shipment_carriers (name, transport_mode)
      VALUES (${name}, ${transportMode})
      RETURNING id, name, transport_mode, is_active, created_at, updated_at
    `;
    return rows[0] as CarrierRecord;
  } catch (err: any) {
    // Concurrent insert of the same name (unique index)
    if (err?.code === '23505') {
      const raced = await findCarrierByName(name);
      if (raced) throw new DuplicateReferenceError(raced);
    }
    throw err;
  }
}
