import { chatWebhooksFor } from '../db/chatWebhooks.js';
import { chatWebhookPurposeLabel } from '../lib/chatWebhooks.js';
import type { ChatWebhookPurpose } from '../lib/chatWebhooks.js';

/**
 * Posts a message on every active Google Chat webhook of a type (Paramètres ›
 * Webhooks Google Chat). Until a webhook of that type is created in the app,
 * the old server variable GOOGLE_CHAT_WEBHOOK_URL is used, so nothing stops
 * while the webhooks are being configured. A type whose webhooks are all
 * deactivated sends nothing.
 */

export interface ChatSendResult {
  /** Webhooks that accepted the message. */
  sent: number;
  /** Null when sent everywhere; otherwise why it was not (or not fully) sent. */
  error: string | null;
}

export async function postToWebhook(url: string, text: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({ text }),
    });
    if (res.ok) return null;
    console.error('[Google Chat] Rejected:', res.status, await res.text().catch(() => ''));
    return `Google Chat a refusé le message (${res.status}).`;
  } catch (err) {
    console.error('[Google Chat] Failed:', err);
    return 'Google Chat injoignable.';
  }
}

export async function sendChatMessage(purpose: ChatWebhookPurpose, text: string): Promise<ChatSendResult> {
  const { active, any } = await chatWebhooksFor(purpose);
  const targets = active.map((w) => ({ name: w.name, url: w.url }));
  if (!any && process.env.GOOGLE_CHAT_WEBHOOK_URL) {
    targets.push({ name: 'GOOGLE_CHAT_WEBHOOK_URL', url: process.env.GOOGLE_CHAT_WEBHOOK_URL });
  }
  if (targets.length === 0) {
    return {
      sent: 0,
      error: `Aucun webhook actif de type « ${chatWebhookPurposeLabel(purpose)} » (Paramètres › Webhooks Google Chat).`,
    };
  }

  let sent = 0;
  const errors: string[] = [];
  for (const t of targets) {
    const error = await postToWebhook(t.url, text);
    if (error) errors.push(`${t.name} : ${error}`);
    else sent++;
  }
  return { sent, error: errors.length > 0 ? errors.join(' ; ') : null };
}
