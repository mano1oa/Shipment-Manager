import { getDb } from './neon.js';
import type { ChatWebhook, ChatWebhookPurpose } from '../lib/chatWebhooks.js';

/** Google Chat webhooks, managed in Paramètres (Supply Chain). */

let schemaPromise: Promise<void> | null = null;

function ensureChatWebhooksSchema(): Promise<void> {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const sql = getDb();
      await sql`
        CREATE TABLE IF NOT EXISTS chat_webhooks (
          id UUID PRIMARY KEY,
          name VARCHAR(100) NOT NULL,
          url TEXT NOT NULL,
          purpose VARCHAR(50) NOT NULL,
          active BOOLEAN NOT NULL DEFAULT TRUE,
          created_by_email VARCHAR(255),
          updated_by_email VARCHAR(255),
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `;
      await sql`CREATE INDEX IF NOT EXISTS idx_chat_webhooks_purpose ON chat_webhooks (purpose) WHERE active;`;
    })().catch((err) => {
      schemaPromise = null;
      throw err;
    });
  }
  return schemaPromise;
}

const mapRow = (r: any): ChatWebhook => ({
  id: r.id,
  name: r.name,
  url: r.url,
  purpose: r.purpose,
  active: r.active !== false,
  updated_by_email: r.updated_by_email ?? null,
  updated_at: new Date(r.updated_at).toISOString(),
  created_at: new Date(r.created_at).toISOString(),
});

export async function listChatWebhooks(): Promise<ChatWebhook[]> {
  await ensureChatWebhooksSchema();
  const sql = getDb();
  const rows = await sql`SELECT * FROM chat_webhooks ORDER BY created_at`;
  return (rows as any[]).map(mapRow);
}

/** Webhooks of one type: `active` only, and whether any (even inactive) exists. */
export async function chatWebhooksFor(purpose: ChatWebhookPurpose): Promise<{ active: ChatWebhook[]; any: boolean }> {
  await ensureChatWebhooksSchema();
  const sql = getDb();
  const rows = (await sql`SELECT * FROM chat_webhooks WHERE purpose = ${purpose} ORDER BY created_at`) as any[];
  return { active: rows.filter((r) => r.active !== false).map(mapRow), any: rows.length > 0 };
}

export async function getChatWebhook(id: string): Promise<ChatWebhook | null> {
  await ensureChatWebhooksSchema();
  const sql = getDb();
  const rows = (await sql`SELECT * FROM chat_webhooks WHERE id = ${id}`) as any[];
  return rows[0] ? mapRow(rows[0]) : null;
}

export interface ChatWebhookInput {
  name: string;
  url: string;
  purpose: ChatWebhookPurpose;
  active: boolean;
}

export async function createChatWebhook(input: ChatWebhookInput, actorEmail: string): Promise<ChatWebhook> {
  await ensureChatWebhooksSchema();
  const sql = getDb();
  const id = crypto.randomUUID();
  await sql`
    INSERT INTO chat_webhooks (id, name, url, purpose, active, created_by_email, updated_by_email)
    VALUES (${id}, ${input.name}, ${input.url}, ${input.purpose}, ${input.active}, ${actorEmail}, ${actorEmail})
  `;
  return (await getChatWebhook(id))!;
}

export async function updateChatWebhook(
  id: string,
  input: Partial<ChatWebhookInput>,
  actorEmail: string
): Promise<ChatWebhook | null> {
  await ensureChatWebhooksSchema();
  const current = await getChatWebhook(id);
  if (!current) return null;
  const next = { ...current, ...input };
  const sql = getDb();
  await sql`
    UPDATE chat_webhooks SET
      name = ${next.name}, url = ${next.url}, purpose = ${next.purpose}, active = ${next.active},
      updated_by_email = ${actorEmail}, updated_at = NOW()
    WHERE id = ${id}
  `;
  return getChatWebhook(id);
}

export async function deleteChatWebhook(id: string): Promise<boolean> {
  await ensureChatWebhooksSchema();
  const sql = getDb();
  const rows = await sql`DELETE FROM chat_webhooks WHERE id = ${id} RETURNING id`;
  return rows.length > 0;
}
