/**
 * Antoine's parcel photos: Neon Object Storage (private bucket).
 *
 * The browser uploads straight to the bucket with a short presigned PUT URL;
 * the database only keeps the object key. Photos are shown with a short
 * presigned GET URL, requested by a signed-in user. No image goes through
 * the server or Postgres.
 *
 * Presigned URLs come from the Neon API (Buckets, beta):
 *   POST /projects/{project}/branches/{branch}/buckets/{bucket}/objects/{key}/presign
 *   DELETE /projects/{project}/branches/{branch}/buckets/{bucket}/objects/{key}
 *
 * Environment: NEON_API_KEY, NEON_STORAGE_PROJECT_ID, NEON_STORAGE_BRANCH_ID,
 * NEON_STORAGE_BUCKET.
 */

const NEON_API = 'https://console.neon.tech/api/v2';

/** Upload URL lifetime: enough to send one compressed photo. */
export const UPLOAD_URL_SECONDS = 300;
/** Display URL lifetime. */
export const VIEW_URL_SECONDS = 600;

export const PHOTO_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
/** Photos are resized in the browser (~1600 px): far below this. */
export const PHOTO_MAX_BYTES = 5 * 1024 * 1024;

export class PhotoStorageError extends Error {}

function config() {
  const apiKey = process.env.NEON_API_KEY?.trim();
  const project = process.env.NEON_STORAGE_PROJECT_ID?.trim();
  const branch = process.env.NEON_STORAGE_BRANCH_ID?.trim();
  const bucket = process.env.NEON_STORAGE_BUCKET?.trim();
  if (!apiKey || !project || !branch || !bucket) return null;
  return { apiKey, project, branch, bucket };
}

export function isPhotoStorageConfigured(): boolean {
  return config() !== null;
}

function objectUrl(key: string): string {
  const c = config();
  if (!c) throw new PhotoStorageError('Stockage des photos non configuré');
  // Slashes of the key must be encoded (%2F)
  return `${NEON_API}/projects/${encodeURIComponent(c.project)}/branches/${encodeURIComponent(c.branch)}/buckets/${encodeURIComponent(c.bucket)}/objects/${encodeURIComponent(key)}`;
}

async function neonRequest(url: string, init: RequestInit): Promise<Response> {
  const c = config();
  if (!c) throw new PhotoStorageError('Stockage des photos non configuré');
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${c.apiKey}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  return res;
}

async function presign(
  key: string,
  body: Record<string, unknown>
): Promise<{ url: string; method: string; headers: Record<string, string>; expires_at: string }> {
  const res = await neonRequest(`${objectUrl(key)}/presign`, { method: 'POST', body: JSON.stringify(body) });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok || typeof data?.url !== 'string') {
    throw new PhotoStorageError(`Neon presign ${res.status}: ${data?.message || 'réponse invalide'}`);
  }
  return { url: data.url, method: data.method || 'GET', headers: data.headers || {}, expires_at: data.expires_at };
}

export function presignPhotoUpload(key: string, contentType: string) {
  return presign(key, { operation: 'upload', content_type: contentType, expires_in_seconds: UPLOAD_URL_SECONDS });
}

export async function presignPhotoView(key: string): Promise<string> {
  return (await presign(key, { operation: 'download', expires_in_seconds: VIEW_URL_SECONDS })).url;
}

/** Deletes the object; an object already gone is not an error. */
export async function deletePhotoObject(key: string): Promise<void> {
  const res = await neonRequest(objectUrl(key), { method: 'DELETE' });
  if (!res.ok && res.status !== 404) {
    const data: any = await res.json().catch(() => ({}));
    throw new PhotoStorageError(`Neon delete ${res.status}: ${data?.message || ''}`);
  }
}
