import { getDb, ensureReferenceSchema } from './neon.js';

export type CarrierTransportMode = 'Air' | 'Sea' | 'BOTH';

export const CARRIER_TRANSPORT_MODES: CarrierTransportMode[] = ['Air', 'Sea', 'BOTH'];

export const CARRIER_NAME_MAX_LENGTH = 100;

export interface CarrierRecord {
  id: string;
  name: string;
  transport_mode: CarrierTransportMode;
  /** Tracking connector (CARRIER_CODES, e.g. 'DHL') this carrier is linked to; null = not linked. */
  tracking_carrier_code: string | null;
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
    SELECT id, name, transport_mode, tracking_carrier_code, is_active, created_at, updated_at
    FROM shipment_carriers
    WHERE is_active = TRUE
    ORDER BY LOWER(name) ASC
  `;

  return rows as unknown as CarrierRecord[];
}

async function findCarrierByName(name: string): Promise<CarrierRecord | null> {
  const sql = getDb();
  const rows = await sql`
    SELECT id, name, transport_mode, tracking_carrier_code, is_active, created_at, updated_at
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
      RETURNING id, name, transport_mode, tracking_carrier_code, is_active, created_at, updated_at
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

/** All carriers, active or not, alphabetical (settings screen). */
export async function getAllCarriers(): Promise<CarrierRecord[]> {
  await ensureReferenceSchema();
  const sql = getDb();

  const rows = await sql`
    SELECT id, name, transport_mode, tracking_carrier_code, is_active, created_at, updated_at
    FROM shipment_carriers
    ORDER BY LOWER(name) ASC
  `;

  return rows as unknown as CarrierRecord[];
}

/**
 * Updates a carrier. `name` must already be trimmed and validated.
 * Returns null when the carrier does not exist. Throws DuplicateReferenceError
 * when the new name collides (case-insensitive) with another carrier.
 * Existing shipments keep the carrier name they were saved with.
 */
export async function updateCarrier(
  id: string,
  changes: {
    name: string;
    transport_mode: CarrierTransportMode;
    tracking_carrier_code: string | null;
    is_active: boolean;
  }
): Promise<CarrierRecord | null> {
  await ensureReferenceSchema();
  const sql = getDb();

  const existing = await findCarrierByName(changes.name);
  if (existing && existing.id !== id) {
    throw new DuplicateReferenceError(existing);
  }

  try {
    const rows = await sql`
      UPDATE shipment_carriers
      SET
        name = ${changes.name},
        transport_mode = ${changes.transport_mode},
        tracking_carrier_code = ${changes.tracking_carrier_code},
        is_active = ${changes.is_active},
        updated_at = NOW()
      WHERE id = ${id}
      RETURNING id, name, transport_mode, tracking_carrier_code, is_active, created_at, updated_at
    `;
    return (rows[0] as CarrierRecord) ?? null;
  } catch (err: any) {
    if (err?.code === '23505') {
      const raced = await findCarrierByName(changes.name);
      if (raced) throw new DuplicateReferenceError(raced);
    }
    throw err;
  }
}

/**
 * Tracking connector linked to the carrier saved on a shipment (shipments.carrier
 * is free text, matched case-insensitively). Null when unknown or not linked.
 */
/**
 * Carrier of a parcel, from the Settings list:
 * - a name picked by the user must be an active carrier;
 * - without name, the carrier linked to the connector detected from the
 *   tracking number format, if any.
 * Returns undefined when the picked name is unknown or inactive.
 */
export async function resolveParcelCarrier(
  pickedName: string | null,
  detectedCode: string
): Promise<{ name: string | null; trackingCode: string | null } | undefined> {
  await ensureReferenceSchema();
  if (pickedName) {
    const carrier = await findCarrierByName(pickedName);
    if (!carrier || !carrier.is_active) return undefined;
    return { name: carrier.name, trackingCode: carrier.tracking_carrier_code };
  }
  if (detectedCode === 'UNKNOWN' || detectedCode === 'OTHER') return { name: null, trackingCode: null };
  const sql = getDb();
  const rows = await sql`
    SELECT name FROM shipment_carriers
    WHERE is_active AND tracking_carrier_code = ${detectedCode}
    ORDER BY LOWER(name) LIMIT 1
  `;
  return { name: (rows[0]?.name as string) ?? null, trackingCode: detectedCode };
}

export async function getTrackingCodeForCarrierName(name: string | null | undefined): Promise<string | null> {
  if (!name || !name.trim()) return null;
  await ensureReferenceSchema();
  const carrier = await findCarrierByName(name);
  return carrier?.tracking_carrier_code ?? null;
}
