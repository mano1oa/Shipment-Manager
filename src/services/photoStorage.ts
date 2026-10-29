import { createPrivateKey, createSign } from 'crypto';

/**
 * Antoine's parcel photos: Google Drive, in a shared drive (Google Workspace).
 *
 * The application authenticates with a service account, member of the shared
 * drive as "Gestionnaire de contenu" (a service account has no storage of its
 * own: it cannot upload to a "My Drive" folder). Its key stays on the server,
 * so photos go through the API: uploaded after compression in the browser
 * (a few hundred KB), shown through an authenticated route. The database only
 * keeps the Drive file id, never the image.
 *
 * Environment: GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
 * GOOGLE_DRIVE_PHOTOS_FOLDER_ID (folder of the shared drive, or the shared drive id).
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const SCOPE = 'https://www.googleapis.com/auth/drive';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

export const PHOTO_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
/** Photos are resized in the browser (~1600 px): far below this (and below the 4.5 MB Vercel body limit). */
export const PHOTO_MAX_BYTES = 4 * 1024 * 1024;

export class PhotoStorageError extends Error {}

const PEM_RE = /-----BEGIN ([A-Z ]*PRIVATE KEY)-----([\s\S]*?)-----END \1-----/;

/**
 * The private key as pasted in the hosting variables, made into a PEM. Accepts
 * the forms met in practice: "\n" kept literally (Vercel), surrounding quotes
 * copied from the JSON file, the whole JSON key file, line breaks turned into
 * spaces, or the PEM encoded in base64.
 */
export function normalizePrivateKey(raw: string | undefined): string | undefined {
  let key = raw?.trim();
  if (!key) return undefined;
  if (key.startsWith('{')) {
    try {
      key = String(JSON.parse(key).private_key ?? '').trim();
    } catch {
      // not JSON after all: read as is
    }
  }
  key = key.replace(/^["']|["']$/g, '').replace(/\\r/g, '').replace(/\\n/g, '\n').replace(/\r\n/g, '\n').trim();
  if (!key.includes('-----BEGIN') && /^[A-Za-z0-9+/=\s]+$/.test(key)) {
    const decoded = Buffer.from(key, 'base64').toString('utf8');
    if (decoded.includes('-----BEGIN')) key = decoded.trim();
  }
  // Rebuild the PEM body (64 characters per line) whatever the separators became
  const m = key.match(PEM_RE);
  if (!m) return key;
  const body = m[2].replace(/[^A-Za-z0-9+/=]/g, '');
  return `-----BEGIN ${m[1]}-----\n${body.match(/.{1,64}/g)?.join('\n') ?? ''}\n-----END ${m[1]}-----\n`;
}

/** What is wrong with the key, without ever showing it (diagnostic). */
function describeKeyProblem(key: string): string | null {
  try {
    createPrivateKey(key);
    return null;
  } catch {
    if (!key.includes('-----BEGIN')) {
      return "la clé ne contient pas « -----BEGIN PRIVATE KEY----- » : collez la valeur « private_key » du fichier JSON du compte de service";
    }
    if (!PEM_RE.test(key)) return 'la ligne « -----END PRIVATE KEY----- » manque : la clé a été tronquée au collage';
    return 'la clé est illisible (caractères manquants ou modifiés) : recollez-la depuis le fichier JSON, ou créez une nouvelle clé';
  }
}

function config() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim();
  const key = normalizePrivateKey(process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY);
  const folder = process.env.GOOGLE_DRIVE_PHOTOS_FOLDER_ID?.trim();
  if (!email || !key || !folder) return null;
  return { email, key, folder };
}

export function isPhotoStorageConfigured(): boolean {
  return config() !== null;
}

const base64url = (input: string | Buffer) => Buffer.from(input).toString('base64url');

let cachedToken: { value: string; expiresAt: number } | null = null;

/** OAuth access token of the service account (JWT bearer grant), cached until shortly before expiry. */
async function accessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;
  const c = config();
  if (!c) throw new PhotoStorageError('Stockage des photos (Google Drive) non configuré');

  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(JSON.stringify({ iss: c.email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 }));
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claims}`);
  const assertion = `${header}.${claims}.${base64url(signer.sign(c.key))}`;

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new PhotoStorageError(`Authentification Google refusée (${res.status}) : ${data.error_description || data.error || ''}`);
  }
  cachedToken = { value: data.access_token, expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000 };
  return cachedToken.value;
}

async function driveFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const token = await accessToken();
  return fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) } });
}

async function driveError(res: Response, action: string): Promise<PhotoStorageError> {
  const data: any = await res.json().catch(() => ({}));
  return new PhotoStorageError(`Google Drive ${action} ${res.status} : ${data?.error?.message || ''}`);
}

export interface PhotoStorageCheck {
  ok: boolean;
  /** One line per step, in order: configuration, authentication, photos folder. */
  steps: { label: string; ok: boolean; detail: string }[];
}

/**
 * Checks the Drive set-up step by step (variables, service account sign-in,
 * access to the photos folder and right to add files in it), to tell Supply
 * Chain what to fix when photos are not stored.
 */
export async function checkPhotoStorage(): Promise<PhotoStorageCheck> {
  const steps: PhotoStorageCheck['steps'] = [];
  const done = () => ({ ok: steps.every((s) => s.ok), steps });
  const c = config();
  steps.push({
    label: 'Variables',
    ok: Boolean(c),
    detail: c
      ? `Compte de service ${c.email}, dossier ${c.folder}`
      : 'GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY et GOOGLE_DRIVE_PHOTOS_FOLDER_ID sont requises',
  });
  if (!c) return done();

  const keyProblem = describeKeyProblem(c.key);
  steps.push({
    label: 'Clé privée',
    ok: keyProblem === null,
    detail: keyProblem ?? 'Format reconnu',
  });
  if (keyProblem) return done();

  try {
    await accessToken();
    steps.push({ label: 'Authentification Google', ok: true, detail: 'Jeton obtenu' });
  } catch (err: any) {
    steps.push({ label: 'Authentification Google', ok: false, detail: err.message });
    return done();
  }

  const res = await driveFetch(
    `${DRIVE_API}/files/${encodeURIComponent(c.folder)}?supportsAllDrives=true&fields=id,name,mimeType,driveId,trashed,capabilities(canAddChildren)`
  );
  if (!res.ok) {
    const err = await driveError(res, 'accès au dossier');
    steps.push({
      label: 'Dossier des photos',
      ok: false,
      detail: `${err.message} — vérifiez l'id du dossier et que le compte de service est membre du Drive partagé`,
    });
    return done();
  }
  const folder: any = await res.json();
  const problems: string[] = [];
  if (folder.trashed) problems.push('le dossier est dans la corbeille');
  if (folder.mimeType !== FOLDER_MIME && folder.id !== folder.driveId) problems.push("l'id ne désigne pas un dossier");
  if (!folder.driveId) problems.push("le dossier est dans « Mon Drive », pas dans un Drive partagé (un compte de service n'y a pas d'espace)");
  if (!folder.capabilities?.canAddChildren) problems.push('le compte de service ne peut pas y ajouter de fichiers (rôle « Gestionnaire de contenu » requis)');
  steps.push({
    label: 'Dossier des photos',
    ok: problems.length === 0,
    detail: problems.length === 0 ? `« ${folder.name} » (Drive partagé), écriture autorisée` : `« ${folder.name} » : ${problems.join(' ; ')}`,
  });
  return done();
}

/** Creates a folder under the photos folder (one per point Antoine). Returns its id. */
export async function createPhotoFolder(name: string): Promise<string> {
  const c = config();
  if (!c) throw new PhotoStorageError('Stockage des photos (Google Drive) non configuré');
  const res = await driveFetch(`${DRIVE_API}/files?supportsAllDrives=true&fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [c.folder] }),
  });
  if (!res.ok) throw await driveError(res, 'création du dossier');
  return ((await res.json()) as any).id as string;
}

/** Uploads one photo into a folder. Returns the Drive file id. */
export async function uploadPhoto(folderId: string, name: string, contentType: string, data: Buffer): Promise<string> {
  const boundary = `shipment-manager-${Date.now().toString(36)}`;
  const metadata = JSON.stringify({ name, parents: [folderId] });
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`),
    data,
    Buffer.from(`\r\n--${boundary}--`),
  ]);
  const res = await driveFetch(`${DRIVE_UPLOAD}/files?uploadType=multipart&supportsAllDrives=true&fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  if (!res.ok) throw await driveError(res, 'envoi');
  return ((await res.json()) as any).id as string;
}

/** Content of a photo, to stream to a signed-in user. */
export async function downloadPhoto(fileId: string): Promise<{ data: Buffer; contentType: string }> {
  const res = await driveFetch(`${DRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`);
  if (!res.ok) throw await driveError(res, 'lecture');
  return {
    data: Buffer.from(await res.arrayBuffer()),
    contentType: res.headers.get('content-type') || 'image/jpeg',
  };
}

/**
 * Moves a photo to the shared drive's trash (recoverable for 30 days; a
 * "Gestionnaire de contenu" may trash but not delete). Already gone: no error.
 */
export async function deletePhotoObject(fileId: string): Promise<void> {
  const res = await driveFetch(`${DRIVE_API}/files/${encodeURIComponent(fileId)}?supportsAllDrives=true`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trashed: true }),
  });
  if (!res.ok && res.status !== 404) throw await driveError(res, 'suppression');
}
