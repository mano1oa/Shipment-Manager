/**
 * Minimal Odoo external API client (JSON-RPC over HTTPS, read only).
 *
 * Configuration (server side only, never exposed to the browser):
 *   ODOO_URL       e.g. https://digi-logistic.odoo.com
 *   ODOO_DB        database name
 *   ODOO_USERNAME  login of the API user
 *   ODOO_API_KEY   API key of that user (or its password)
 */

export interface OdooConfig {
  url: string;
  db: string;
  username: string;
  apiKey: string;
}

export class OdooError extends Error {
  constructor(
    public kind: 'NOT_CONFIGURED' | 'AUTH' | 'NETWORK' | 'INVALID_FIELD' | 'REMOTE',
    message: string,
    public publicMessage: string
  ) {
    super(message);
  }
}

const REQUEST_TIMEOUT_MS = 60_000;

export function getOdooConfig(): OdooConfig | null {
  const url = process.env.ODOO_URL?.trim().replace(/\/+$/, '');
  const db = process.env.ODOO_DB?.trim();
  const username = process.env.ODOO_USERNAME?.trim();
  const apiKey = process.env.ODOO_API_KEY?.trim();
  if (!url || !db || !username || !apiKey || !/^https?:\/\//i.test(url)) return null;
  return { url, db, username, apiKey };
}

export function isOdooConfigured(): boolean {
  return getOdooConfig() !== null;
}

let requestId = 0;

async function jsonRpc(config: OdooConfig, service: string, method: string, args: unknown[]): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${config.url}/jsonrpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'call',
        params: { service, method, args },
        id: ++requestId,
      }),
      signal: controller.signal,
    });
  } catch (err: any) {
    throw new OdooError('NETWORK', `Odoo request failed: ${err?.message || err}`, 'Odoo est injoignable.');
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new OdooError('NETWORK', `Odoo HTTP ${response.status}`, `Odoo a répondu une erreur HTTP ${response.status}.`);
  }

  const payload: any = await response.json().catch(() => null);
  if (!payload) {
    throw new OdooError('REMOTE', 'Odoo returned a non-JSON response', 'Réponse Odoo illisible.');
  }

  if (payload.error) {
    const data = payload.error.data || {};
    const message: string = data.message || payload.error.message || 'Unknown Odoo error';
    if (/AccessDenied|Access Denied/i.test(`${data.name} ${message}`)) {
      throw new OdooError('AUTH', message, 'Identifiants Odoo refusés.');
    }
    // A missing custom field (dest_partner_id, num_cmd_amz, sale_move_id) is a
    // configuration problem worth naming; nothing else from Odoo is relayed.
    const invalidField = /Invalid field ['"]?([\w.]+)['"]?/i.exec(message);
    if (invalidField) {
      throw new OdooError(
        'INVALID_FIELD',
        message,
        `Champ Odoo introuvable : ${invalidField[1]}. Vérifiez le nom technique du champ sur DIGI LOGISTIC.`
      );
    }
    throw new OdooError('REMOTE', message, 'Odoo a refusé la requête.');
  }

  return payload.result;
}

/**
 * Authenticated session on one Odoo database. Use `connect()`.
 */
export class OdooSession {
  private constructor(private config: OdooConfig, private uid: number) {}

  static async connect(config: OdooConfig | null = getOdooConfig()): Promise<OdooSession> {
    if (!config) {
      throw new OdooError('NOT_CONFIGURED', 'Odoo is not configured', 'La connexion Odoo n\'est pas configurée.');
    }
    const uid = await jsonRpc(config, 'common', 'authenticate', [config.db, config.username, config.apiKey, {}]);
    if (typeof uid !== 'number' || uid <= 0) {
      throw new OdooError('AUTH', 'Odoo authentication failed', 'Identifiants Odoo refusés.');
    }
    return new OdooSession(config, uid);
  }

  execute<T = any>(model: string, method: string, args: unknown[], kwargs: Record<string, unknown> = {}): Promise<T> {
    return jsonRpc(this.config, 'object', 'execute_kw', [
      this.config.db,
      this.uid,
      this.config.apiKey,
      model,
      method,
      args,
      kwargs,
    ]);
  }

  searchRead<T = any>(
    model: string,
    domain: unknown[],
    fields: string[],
    options: { limit?: number; offset?: number; order?: string } = {}
  ): Promise<T[]> {
    return this.execute<T[]>(model, 'search_read', [domain], { fields, ...options });
  }

  read<T = any>(model: string, ids: number[], fields: string[]): Promise<T[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.execute<T[]>(model, 'read', [ids], { fields });
  }
}
