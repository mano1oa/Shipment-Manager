import { getDb, ensureReferenceSchema } from './neon.js';

export const SUPPLIER_NAME_MAX_LENGTH = 150;

export interface SupplierRecord {
  id: string;
  name: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export class DuplicateSupplierError extends Error {
  constructor(public existing: SupplierRecord) {
    super('Supplier already exists');
  }
}

/**
 * Active suppliers, alphabetical.
 */
export async function getActiveSuppliers(): Promise<SupplierRecord[]> {
  await ensureReferenceSchema();
  const sql = getDb();

  const rows = await sql`
    SELECT id, name, is_active, created_at, updated_at
    FROM shipment_suppliers
    WHERE is_active = TRUE
    ORDER BY LOWER(name) ASC
  `;

  return rows as unknown as SupplierRecord[];
}

async function findSupplierByName(name: string): Promise<SupplierRecord | null> {
  const sql = getDb();
  const rows = await sql`
    SELECT id, name, is_active, created_at, updated_at
    FROM shipment_suppliers
    WHERE LOWER(TRIM(name)) = LOWER(TRIM(${name}))
    LIMIT 1
  `;
  return (rows[0] as SupplierRecord) ?? null;
}

/**
 * Creates a supplier. `name` must already be trimmed and validated.
 * Throws DuplicateSupplierError on a case-insensitive name collision.
 */
export async function createSupplier(name: string): Promise<SupplierRecord> {
  await ensureReferenceSchema();
  const sql = getDb();

  const existing = await findSupplierByName(name);
  if (existing) {
    throw new DuplicateSupplierError(existing);
  }

  try {
    const rows = await sql`
      INSERT INTO shipment_suppliers (name)
      VALUES (${name})
      RETURNING id, name, is_active, created_at, updated_at
    `;
    return rows[0] as SupplierRecord;
  } catch (err: any) {
    // Concurrent insert of the same name (unique index)
    if (err?.code === '23505') {
      const raced = await findSupplierByName(name);
      if (raced) throw new DuplicateSupplierError(raced);
    }
    throw err;
  }
}
