import { getDb } from './neon.js';
import { ensureDigiInvoicesSchema } from './digiInvoices.js';
import type { ParcelDestination } from '../lib/parcelTracking.js';

/**
 * Point Antoine (Orly) or reception at Rouen: the photos of the day are all
 * uploaded first (parcel_photos with point_id, parcel_id NULL; one Google
 * Drive folder per point), then matched one by one to a parcel. Matching a
 * photo confirms the parcel's reception at the point date. Tables: see
 * parcelSchema.ts.
 */

export interface ReceptionPointRecord {
  id: string;
  destination: ParcelDestination;
  point_date: string;
  notes: string | null;
  created_by_email: string | null;
  created_at: string;
  /** Google Drive folder of the point (null until the first photo). */
  drive_folder_id: string | null;
  photo_count: number;
  linked_count: number;
}

export interface PointPhotoRecord {
  id: string;
  storage_key: string;
  content_type: string | null;
  size_bytes: number | null;
  uploaded_at: string;
  uploaded_by_email: string | null;
  parcel_id: string | null;
  linked_by_email: string | null;
  linked_at: string | null;
}

const SELECT_POINTS = `
  SELECT rp.id, rp.destination, TO_CHAR(rp.point_date, 'YYYY-MM-DD') AS point_date, rp.notes,
    rp.created_by_email, rp.created_at, rp.drive_folder_id,
    (SELECT COUNT(*)::int FROM parcel_photos ph WHERE ph.point_id = rp.id) AS photo_count,
    (SELECT COUNT(*)::int FROM parcel_photos ph WHERE ph.point_id = rp.id AND ph.parcel_id IS NOT NULL) AS linked_count
  FROM reception_points rp
`;

export async function listReceptionPoints(destination: ParcelDestination): Promise<ReceptionPointRecord[]> {
  await ensureDigiInvoicesSchema();
  const sql = getDb();
  const rows = await sql.query(`${SELECT_POINTS} WHERE rp.destination = $1 ORDER BY rp.point_date DESC, rp.created_at DESC LIMIT 100`, [
    destination,
  ]);
  return rows as unknown as ReceptionPointRecord[];
}

export async function getReceptionPoint(id: string): Promise<ReceptionPointRecord | null> {
  await ensureDigiInvoicesSchema();
  const sql = getDb();
  const rows = await sql.query(`${SELECT_POINTS} WHERE rp.id = $1`, [id]);
  return (rows[0] as unknown as ReceptionPointRecord) ?? null;
}

export async function createReceptionPoint(
  destination: ParcelDestination,
  pointDate: string,
  notes: string | null,
  actorEmail: string
): Promise<string> {
  await ensureDigiInvoicesSchema();
  const sql = getDb();
  const rows = await sql`
    INSERT INTO reception_points (destination, point_date, notes, created_by_email)
    VALUES (${destination}, ${pointDate}, ${notes}, ${actorEmail})
    RETURNING id
  `;
  return rows[0].id as string;
}

export async function listPointPhotos(pointId: string): Promise<PointPhotoRecord[]> {
  await ensureDigiInvoicesSchema();
  const sql = getDb();
  const rows = await sql`
    SELECT id, storage_key, content_type, size_bytes, uploaded_at, uploaded_by_email, parcel_id,
      linked_by_email, linked_at
    FROM parcel_photos WHERE point_id = ${pointId}
    ORDER BY uploaded_at, id
  `;
  return rows as unknown as PointPhotoRecord[];
}

export async function addPointPhoto(
  pointId: string,
  storageKey: string,
  contentType: string,
  sizeBytes: number,
  actorEmail: string
): Promise<string> {
  await ensureDigiInvoicesSchema();
  const sql = getDb();
  const rows = await sql`
    INSERT INTO parcel_photos (point_id, storage_key, content_type, size_bytes, uploaded_by_email)
    VALUES (${pointId}, ${storageKey}, ${contentType}, ${sizeBytes}, ${actorEmail})
    ON CONFLICT (storage_key) DO NOTHING
    RETURNING id
  `;
  if (rows[0]?.id) return rows[0].id as string;
  return (await sql`SELECT id FROM parcel_photos WHERE storage_key = ${storageKey}`)[0].id as string;
}

/** Links a photo of the point to a parcel (null = back to "to match"). Returns false when not found. */
export async function linkPointPhoto(
  pointId: string,
  photoId: string,
  parcelId: string | null,
  actorEmail: string
): Promise<boolean> {
  await ensureDigiInvoicesSchema();
  const sql = getDb();
  const rows = await sql`
    UPDATE parcel_photos SET
      parcel_id = ${parcelId},
      linked_by_email = ${parcelId ? actorEmail : null},
      linked_at = ${parcelId ? new Date().toISOString() : null}
    WHERE id = ${photoId} AND point_id = ${pointId}
    RETURNING id
  `;
  return rows.length > 0;
}

export async function deletePointPhoto(pointId: string, photoId: string): Promise<string | null> {
  await ensureDigiInvoicesSchema();
  const sql = getDb();
  const rows = await sql`
    DELETE FROM parcel_photos WHERE id = ${photoId} AND point_id = ${pointId} RETURNING storage_key
  `;
  return (rows[0]?.storage_key as string) ?? null;
}

/** Records the Drive folder created for the point (kept if another upload created one first). */
export async function setPointFolder(pointId: string, folderId: string): Promise<string> {
  const sql = getDb();
  const rows = await sql`
    UPDATE reception_points SET drive_folder_id = COALESCE(drive_folder_id, ${folderId})
    WHERE id = ${pointId}
    RETURNING drive_folder_id
  `;
  return (rows[0]?.drive_folder_id as string) ?? folderId;
}

/** A photo by id (point or parcel), for the authenticated display route. */
export async function getPhotoFile(photoId: string): Promise<{ storage_key: string; content_type: string | null } | null> {
  await ensureDigiInvoicesSchema();
  const sql = getDb();
  const rows = await sql`SELECT storage_key, content_type FROM parcel_photos WHERE id = ${photoId}`;
  return (rows[0] as any) ?? null;
}
