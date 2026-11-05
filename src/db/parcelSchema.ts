import { getDb } from './neon.js';
import { detectTrackingNumber } from '../lib/carrierDetection.js';
import { convertLegacyShipmentStatus } from '../lib/parcelTracking.js';

/**
 * Parcel model tables and the one-time conversion of the data saved before it.
 * Run by ensureDigiInvoicesSchema() (digi_invoices and shipments exist).
 *
 * - digi_invoices (new columns): "hors DIGI" invoices (is_digi = FALSE, amount +
 *   currency, buyer, Supply Chain validation) and the manual sort (triage).
 * - parcels: one row per parcel (tracking number, may be unknown until Orly).
 * - parcel_invoices: a parcel covers 1..n invoices, an invoice has 1..n parcels.
 * - parcel_photos: Antoine's photos (storage_key = Google Drive file id, never the image).
 */
export async function initParcelSchema(): Promise<void> {
  const sql = getDb();

  // "Hors DIGI" invoices entered by hand (no lines: amount + currency)
  await sql`ALTER TABLE digi_invoices ADD COLUMN IF NOT EXISTS is_digi BOOLEAN NOT NULL DEFAULT TRUE;`;
  await sql`ALTER TABLE digi_invoices ADD COLUMN IF NOT EXISTS amount NUMERIC(14, 2);`;
  await sql`ALTER TABLE digi_invoices ADD COLUMN IF NOT EXISTS currency VARCHAR(3);`;
  await sql`ALTER TABLE digi_invoices ADD COLUMN IF NOT EXISTS buyer VARCHAR(255);`;
  await sql`
    ALTER TABLE digi_invoices
      ADD COLUMN IF NOT EXISTS validation_status VARCHAR(10) NOT NULL DEFAULT 'validated';
  `;
  await sql`ALTER TABLE digi_invoices ADD COLUMN IF NOT EXISTS rejection_reason TEXT;`;
  await sql`ALTER TABLE digi_invoices ADD COLUMN IF NOT EXISTS validated_by_email VARCHAR(255);`;
  await sql`ALTER TABLE digi_invoices ADD COLUMN IF NOT EXISTS validated_at TIMESTAMPTZ;`;
  // Manual sort of DIGI invoices: to_sort → goods (tracked) or services
  await sql`ALTER TABLE digi_invoices ADD COLUMN IF NOT EXISTS triage VARCHAR(10);`;
  await sql`ALTER TABLE digi_invoices ADD COLUMN IF NOT EXISTS triaged_at TIMESTAMPTZ;`;

  await sql`
    CREATE TABLE IF NOT EXISTS parcels (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tracking_number VARCHAR(100),
      carrier VARCHAR(30) NOT NULL DEFAULT 'UNKNOWN',
      supplier_name VARCHAR(255),
      expected_delivery DATE,
      status VARCHAR(12) NOT NULL DEFAULT 'to_receive'
        CHECK (status IN ('to_receive', 'received', 'lost', 'search')),
      received_at DATE,
      received_by_email VARCHAR(255),
      status_changed_at TIMESTAMPTZ,
      notes TEXT,
      legacy_shipment_id VARCHAR(50),
      created_by_email VARCHAR(255),
      updated_by_email VARCHAR(255),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;
  // One parcel per tracking number (stored as text, never numeric)
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_parcels_tracking_number_ci
      ON parcels (UPPER(TRIM(tracking_number)))
      WHERE tracking_number IS NOT NULL;
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_parcels_status ON parcels (status);`;
  // Carrier of the Settings list (shipment_carriers.name); `carrier` stays the tracking connector
  await sql`ALTER TABLE parcels ADD COLUMN IF NOT EXISTS carrier_name VARCHAR(100);`;
  // Destination hub: Orly (air) or Rouen quay (sea), with the sea delivery details
  await sql`ALTER TABLE parcels ADD COLUMN IF NOT EXISTS destination VARCHAR(10) NOT NULL DEFAULT 'ORLY';`;
  await sql`ALTER TABLE parcels ADD COLUMN IF NOT EXISTS description TEXT;`;
  await sql`ALTER TABLE parcels ADD COLUMN IF NOT EXISTS packing_info VARCHAR(500);`;
  await sql`ALTER TABLE parcels ADD COLUMN IF NOT EXISTS volume_m3 NUMERIC(12, 3);`;
  await sql`ALTER TABLE parcels ADD COLUMN IF NOT EXISTS delivery_type VARCHAR(40);`;
  // Lost parcels already announced on Google Chat (daily summary)
  await sql`ALTER TABLE parcels ADD COLUMN IF NOT EXISTS loss_notified_at TIMESTAMPTZ;`;

  await sql`
    CREATE TABLE IF NOT EXISTS parcel_invoices (
      parcel_id UUID NOT NULL REFERENCES parcels(id) ON DELETE CASCADE,
      invoice_id UUID NOT NULL REFERENCES digi_invoices(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (parcel_id, invoice_id)
    );
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_parcel_invoices_invoice ON parcel_invoices (invoice_id);`;

  await sql`
    CREATE TABLE IF NOT EXISTS parcel_photos (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      parcel_id UUID NOT NULL REFERENCES parcels(id) ON DELETE CASCADE,
      storage_key VARCHAR(512) NOT NULL UNIQUE,
      content_type VARCHAR(100),
      size_bytes INTEGER,
      uploaded_by_email VARCHAR(255),
      uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_parcel_photos_parcel ON parcel_photos (parcel_id);`;

  // Point Antoine (or Rouen reception): all the photos of a date are uploaded
  // first, then matched one by one to a parcel (which confirms its reception)
  await sql`
    CREATE TABLE IF NOT EXISTS reception_points (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      destination VARCHAR(10) NOT NULL DEFAULT 'ORLY',
      point_date DATE NOT NULL,
      notes TEXT,
      created_by_email VARCHAR(255),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_reception_points_date ON reception_points (destination, point_date DESC);`;
  // Google Drive folder of the point (created at the first photo)
  await sql`ALTER TABLE reception_points ADD COLUMN IF NOT EXISTS drive_folder_id VARCHAR(100);`;
  // A photo of a point is not matched yet: parcel_id stays NULL until then
  await sql`ALTER TABLE parcel_photos ALTER COLUMN parcel_id DROP NOT NULL;`;
  await sql`
    ALTER TABLE parcel_photos
      ADD COLUMN IF NOT EXISTS point_id UUID REFERENCES reception_points(id) ON DELETE CASCADE;
  `;
  await sql`ALTER TABLE parcel_photos ADD COLUMN IF NOT EXISTS linked_by_email VARCHAR(255);`;
  await sql`ALTER TABLE parcel_photos ADD COLUMN IF NOT EXISTS linked_at TIMESTAMPTZ;`;
  await sql`CREATE INDEX IF NOT EXISTS idx_parcel_photos_point ON parcel_photos (point_id);`;

  // Boxes of a parcel: one row per box received (a photo matched at a point, or a
  // reception confirmed without photo). parcels.received_at = date of the first box.
  await sql`
    CREATE TABLE IF NOT EXISTS parcel_receptions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      parcel_id UUID NOT NULL REFERENCES parcels(id) ON DELETE CASCADE,
      point_id UUID REFERENCES reception_points(id) ON DELETE SET NULL,
      photo_id UUID UNIQUE REFERENCES parcel_photos(id) ON DELETE CASCADE,
      piece_number VARCHAR(100),
      box_index INTEGER CHECK (box_index >= 1),
      received_at DATE NOT NULL,
      received_by_email VARCHAR(255),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_parcel_receptions_parcel ON parcel_receptions (parcel_id);`;
  // Boxes announced (supplier, "x of N" of the label): optional
  await sql`ALTER TABLE parcels ADD COLUMN IF NOT EXISTS boxes_expected INTEGER CHECK (boxes_expected >= 1);`;
  // Incomplete parcels already announced on Google Chat (daily summary)
  await sql`ALTER TABLE parcels ADD COLUMN IF NOT EXISTS partial_notified_at TIMESTAMPTZ;`;
  // Point where the parcel was created (label not found): finds the split boxes to merge
  await sql`ALTER TABLE parcels ADD COLUMN IF NOT EXISTS created_at_point_id UUID;`;

  // Other numbers of a parcel (supplier, carrier, box): search only, the
  // tracking connector keeps tracking_number
  await sql`
    CREATE TABLE IF NOT EXISTS parcel_numbers (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      parcel_id UUID NOT NULL REFERENCES parcels(id) ON DELETE CASCADE,
      number VARCHAR(100) NOT NULL,
      kind VARCHAR(10) NOT NULL CHECK (kind IN ('supplier', 'carrier', 'piece')),
      created_by_email VARCHAR(255),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_parcel_numbers_parcel ON parcel_numbers (parcel_id);`;
  await runOnce('parcel_boxes_v1', createNumberGuards);
  // Parcels received before boxes existed: one box per photo of a point, else one
  // without photo (checked before: 108 received, 104 with one photo, 4 without, none with several)
  await runOnce('parcel_boxes_backfill_v1', async () => {
    await sql.transaction(backfillBoxesQueries(null));
  });
  // Parcels created at a point before the column: found in the audit trail
  await runOnce('parcel_created_at_point_v1', async () => {
    const hasAudit = (await sql`SELECT to_regclass('system_audit_logs') IS NOT NULL AS ok`)[0]?.ok;
    if (!hasAudit) return;
    await sql`
      UPDATE parcels p SET created_at_point_id = (a.details->>'point_id')::uuid
      FROM system_audit_logs a
      WHERE a.action = 'LINK_POINT_PHOTO' AND a.details->>'created' = 'true'
        AND a.entity_id = p.id::text AND p.created_at_point_id IS NULL
        AND a.details->>'point_id' ~ '^[0-9a-f-]{36}$'
    `;
  });

  await runOnce('parcel_model_v1', runConversion);
  // After the conversion (which fills the NULLs): new DIGI invoices start unsorted
  await sql`ALTER TABLE digi_invoices ALTER COLUMN triage SET DEFAULT 'to_sort';`;
  await runOnce('parcel_rouen_v1', convertSeaDeliveries);
  // Losses known before the daily summary existed are not announced again
  await runOnce('parcel_loss_notified_v1', async () => {
    await sql`UPDATE parcels SET loss_notified_at = NOW() WHERE status = 'lost' AND loss_notified_at IS NULL`;
  });
}

/**
 * Runs a one-time conversion. Claimed first so two server instances never run
 * it together; released on failure (each step is idempotent, so a retry
 * resumes where it stopped).
 */
async function runOnce(key: string, conversion: () => Promise<void>): Promise<void> {
  const sql = getDb();
  const claimed = await sql`INSERT INTO app_migrations (key) VALUES (${key}) ON CONFLICT DO NOTHING RETURNING key`;
  if (claimed.length === 0) return;
  try {
    await conversion();
  } catch (err) {
    await sql`DELETE FROM app_migrations WHERE key = ${key}`;
    throw err;
  }
}

/**
 * Boxes for the parcels received before boxes existed: one per photo matched
 * at a point (date of the point), else one without photo at received_at.
 * Skips a parcel that already has boxes. `parcelIds` null = every parcel.
 */
export function backfillBoxesQueries(parcelIds: string[] | null) {
  const sql = getDb();
  const all = parcelIds === null;
  const ids = parcelIds ?? [];
  return [
    sql`
      INSERT INTO parcel_receptions (parcel_id, point_id, photo_id, received_at, received_by_email, created_at)
      SELECT p.id, ph.point_id, ph.id, COALESCE(rp.point_date, p.received_at, p.status_changed_at::date),
        COALESCE(ph.linked_by_email, p.received_by_email), COALESCE(ph.linked_at, NOW())
      FROM parcels p
      JOIN parcel_photos ph ON ph.parcel_id = p.id AND ph.point_id IS NOT NULL
      JOIN reception_points rp ON rp.id = ph.point_id
      WHERE p.status IN ('received', 'search') AND (${all} OR p.id = ANY(${ids}::uuid[]))
        AND NOT EXISTS (SELECT 1 FROM parcel_receptions r WHERE r.parcel_id = p.id)
    `,
    sql`
      INSERT INTO parcel_receptions (parcel_id, received_at, received_by_email)
      SELECT p.id, COALESCE(p.received_at, p.status_changed_at::date, p.created_at::date), p.received_by_email
      FROM parcels p
      WHERE p.status IN ('received', 'search') AND (${all} OR p.id = ANY(${ids}::uuid[]))
        AND NOT EXISTS (SELECT 1 FROM parcel_receptions r WHERE r.parcel_id = p.id)
    `,
  ];
}

/** SQLSTATE raised when a number already belongs to a parcel (see NumberTakenError). */
export const NUMBER_TAKEN_SQLSTATE = 'P0420';

/**
 * One-time DDL: a number exists once in tracking_number ∪ parcel_numbers.
 * The HTTP driver has no interactive transaction, so Postgres checks it: the
 * trigger locks the number (two writers wait for each other), then looks in
 * both tables. DETAIL = id of the parcel that owns the number.
 */
async function createNumberGuards(): Promise<void> {
  const sql = getDb();
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_parcel_numbers_number_ci ON parcel_numbers (UPPER(TRIM(number)));`;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_parcel_receptions_piece_ci
      ON parcel_receptions (parcel_id, UPPER(TRIM(piece_number)))
      WHERE piece_number IS NOT NULL;
  `;
  await sql.query(`
    CREATE OR REPLACE FUNCTION parcel_number_guard() RETURNS trigger AS $$
    DECLARE
      n TEXT;
      owner UUID;
    BEGIN
      IF TG_TABLE_NAME = 'parcels' THEN
        n := UPPER(TRIM(NEW.tracking_number));
      ELSE
        n := UPPER(TRIM(NEW.number));
      END IF;
      IF n IS NULL OR n = '' THEN
        RETURN NEW;
      END IF;
      PERFORM pg_advisory_xact_lock(hashtext('parcel_number:' || n));
      IF TG_TABLE_NAME = 'parcels' THEN
        SELECT parcel_id INTO owner FROM parcel_numbers WHERE UPPER(TRIM(number)) = n LIMIT 1;
      ELSE
        SELECT id INTO owner FROM parcels WHERE UPPER(TRIM(tracking_number)) = n LIMIT 1;
      END IF;
      IF owner IS NOT NULL THEN
        RAISE EXCEPTION 'Number % already used', n USING ERRCODE = '${NUMBER_TAKEN_SQLSTATE}', DETAIL = owner::text;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);
  await sql`DROP TRIGGER IF EXISTS trg_parcels_number_guard ON parcels;`;
  await sql`
    CREATE TRIGGER trg_parcels_number_guard BEFORE INSERT OR UPDATE OF tracking_number ON parcels
      FOR EACH ROW EXECUTE FUNCTION parcel_number_guard();
  `;
  await sql`DROP TRIGGER IF EXISTS trg_parcel_numbers_guard ON parcel_numbers;`;
  await sql`
    CREATE TRIGGER trg_parcel_numbers_guard BEFORE INSERT OR UPDATE OF number ON parcel_numbers
      FOR EACH ROW EXECUTE FUNCTION parcel_number_guard();
  `;
}

const RECEP_ROUEN_RECEIVED = 'Oui';
/** created_by_email of the parcels taken from the Rouen lines (marks a shipment as done). */
const SEA_MIGRATION_ACTOR = 'migration-rouen';

/**
 * One-time: the "livraisons Rouen" lines of sea shipments become parcels to
 * Rouen (Oui → received, Non / À confirmer → to receive), linked to the
 * shipment's invoices. The JSON lines are kept as history. Parcels taken
 * from sea shipments by parcel_model_v1 are moved to Rouen.
 */
async function convertSeaDeliveries(): Promise<void> {
  const sql = getDb();
  await sql`
    UPDATE parcels p SET destination = 'ROUEN'
    FROM shipments s
    WHERE s.id = p.legacy_shipment_id AND s.mode = 'Sea' AND p.destination <> 'ROUEN'
  `;

  const shipments = await sql`
    SELECT s.id, s.supplier, s.sea_deliveries,
      COALESCE((SELECT array_agg(i.id) FROM digi_invoices i WHERE i.shipment_id = s.id), '{}') AS invoice_ids
    FROM shipments s
    WHERE s.mode = 'Sea' AND jsonb_array_length(COALESCE(s.sea_deliveries, '[]'::jsonb)) > 0
  `;
  for (const s of shipments as any[]) {
    const invoiceIds: string[] = s.invoice_ids || [];
    const done = await sql`
      SELECT 1 FROM parcels WHERE legacy_shipment_id = ${s.id} AND created_by_email = ${SEA_MIGRATION_ACTOR} LIMIT 1
    `;
    if (done.length > 0) continue;
    for (const item of (s.sea_deliveries || []) as any[]) {
      const raw = typeof item.tracking_no === 'string' ? item.tracking_no.trim() : '';
      const detected = raw ? detectTrackingNumber(raw) : null;
      const tracking = detected?.number || raw || null;
      const received = item.recep_rouen === RECEP_ROUEN_RECEIVED;
      const notes = [
        item.remarks,
        item.recep_rouen === 'A confirmer svp' ? 'Réception Rouen à confirmer' : null,
        item.carrier_delivery_status ? `Statut transporteur : ${item.carrier_delivery_status}` : null,
        `Repris de l'expédition ${s.id} (ligne ${item.item_no ?? '?'})`,
      ]
        .filter((t) => typeof t === 'string' && t.trim())
        .join(' · ');
      const volume = Number(item.volume_m3);

      const inserted = await sql`
        INSERT INTO parcels (tracking_number, carrier, carrier_name, supplier_name, destination, status,
          received_at, description, packing_info, volume_m3, delivery_type, notes,
          legacy_shipment_id, status_changed_at, created_by_email)
        VALUES (${tracking}, ${detected?.carrier || 'UNKNOWN'}, ${item.carrier?.trim() || null},
          ${item.supplier?.trim() || s.supplier || null}, 'ROUEN', ${received ? 'received' : 'to_receive'},
          NULL, ${item.description?.trim() || null}, ${item.colisage_info?.trim() || null},
          ${Number.isFinite(volume) && volume > 0 ? volume : null}, ${item.delivery_type || null}, ${notes || null},
          ${s.id}, NOW(), ${SEA_MIGRATION_ACTOR})
        ON CONFLICT DO NOTHING
        RETURNING id
      `;
      // Same tracking number already a parcel (e.g. taken by parcel_model_v1)
      const parcelId =
        inserted[0]?.id ??
        (tracking
          ? (await sql`SELECT id FROM parcels WHERE UPPER(TRIM(tracking_number)) = UPPER(TRIM(${tracking}))`)[0]?.id
          : null);
      if (parcelId && invoiceIds.length > 0) {
        await sql`
          INSERT INTO parcel_invoices (parcel_id, invoice_id)
          SELECT ${parcelId}::uuid, UNNEST(${invoiceIds}::uuid[])
          ON CONFLICT DO NOTHING
        `;
      }
    }
  }
}

/**
 * One-time conversion to the parcel model:
 * - invoice sort: services flag → services, linked to a shipment → goods,
 *   else to_sort;
 * - shipment status: old global status → new status (see
 *   convertLegacyShipmentStatus); not departed → needs_review;
 * - shipments not departed that carry DIGI invoices were one supplier parcel:
 *   their tracking numbers become parcels of those invoices;
 * - "Perdu Orly" / "Avis de recherche" become a parcel in that state so the
 *   claim is not lost.
 */
async function runConversion(): Promise<void> {
  const sql = getDb();
  await sql`
    UPDATE digi_invoices SET triage = CASE
      WHEN no_shipment THEN 'services'
      WHEN shipment_id IS NOT NULL OR NOT is_digi THEN 'goods'
      ELSE 'to_sort'
    END
    WHERE triage IS NULL
  `;

  const hasTrackingTable = (await sql`SELECT to_regclass('shipment_tracking_numbers') IS NOT NULL AS ok`)[0]?.ok;
  const shipments = await sql`
    SELECT s.id, s.supplier, s.carrier, s.tracking_no, s.eta, s.global_status, s.antoine_status,
      s.orly_scan_date, s.mada_receipt_date,
      COALESCE((SELECT array_agg(i.id) FROM digi_invoices i WHERE i.shipment_id = s.id), '{}') AS invoice_ids
    FROM shipments s
    WHERE s.legacy_global_status IS NULL
  `;

  for (const s of shipments as any[]) {
    const old = (s.global_status || '').trim();
    const { status, needsReview } = convertLegacyShipmentStatus(s);
    const invoiceIds: string[] = s.invoice_ids || [];

    let parcelStatus: 'to_receive' | 'lost' | 'search' | null = null;
    if (old === 'Perdu Orly') parcelStatus = 'lost';
    else if (s.antoine_status === 'Avis de recherche') parcelStatus = 'search';
    else if (needsReview && invoiceIds.length > 0) parcelStatus = 'to_receive';

    const alreadyConverted = (await sql`SELECT 1 FROM parcels WHERE legacy_shipment_id = ${s.id} LIMIT 1`).length > 0;
    if (parcelStatus && !alreadyConverted) {
      const numbers = new Set<string>();
      if (s.tracking_no?.trim()) numbers.add(s.tracking_no.trim());
      if (hasTrackingTable) {
        const rows = await sql`
          SELECT tracking_number FROM shipment_tracking_numbers WHERE shipment_id = ${s.id} AND is_active
        `;
        rows.forEach((r: any) => numbers.add(r.tracking_number));
      }
      const expected = /^\d{4}-\d{2}-\d{2}$/.test(s.eta || '') ? s.eta : null;
      const note = `Repris de l'expédition ${s.id} (ancien statut : ${old || 'non défini'})`;
      // A parcel without tracking number keeps the claim when none is known
      const list: (string | null)[] = numbers.size > 0 ? [...numbers] : [null];
      for (const number of list) {
        const detected = number ? detectTrackingNumber(number) : null;
        const tracking = detected?.number || number;
        const inserted = await sql`
          INSERT INTO parcels (tracking_number, carrier, carrier_name, supplier_name, expected_delivery, status, notes,
            legacy_shipment_id, status_changed_at, created_by_email)
          VALUES (${tracking}, ${detected?.carrier || 'UNKNOWN'}, ${s.carrier?.trim() || null}, ${s.supplier || null}, ${expected},
            ${parcelStatus}, ${note}, ${s.id}, NOW(), 'migration')
          ON CONFLICT DO NOTHING
          RETURNING id
        `;
        const parcelId =
          inserted[0]?.id ??
          (tracking
            ? (await sql`SELECT id FROM parcels WHERE UPPER(TRIM(tracking_number)) = UPPER(TRIM(${tracking}))`)[0]?.id
            : null);
        if (parcelId && invoiceIds.length > 0) {
          await sql`
            INSERT INTO parcel_invoices (parcel_id, invoice_id)
            SELECT ${parcelId}::uuid, UNNEST(${invoiceIds}::uuid[])
            ON CONFLICT DO NOTHING
          `;
        }
      }
    }

    await sql`
      UPDATE shipments SET
        legacy_global_status = ${old},
        global_status = ${status},
        needs_review = ${needsReview}
      WHERE id = ${s.id}
    `;
  }
}
