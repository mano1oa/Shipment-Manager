/**
 * Google Chat webhooks configured in Paramètres › Webhooks Google Chat.
 * Each webhook has one type (what it receives). To add a new kind of
 * message: add one entry below, then call sendChatMessage('<id>', text).
 */
export const CHAT_WEBHOOK_PURPOSES = [
  {
    id: 'parcel_lost',
    label: 'Alerte colis perdus',
    hint: 'Récapitulatif quotidien (8 h) des colis non reçus à réclamer aux fournisseurs.',
  },
  {
    id: 'shipment_confirmed',
    label: 'Confirmation des expéditions',
    hint: 'Mémo des colis envoyé à chaque confirmation d’une expédition.',
  },
  {
    id: 'invoices_without_parcel',
    label: 'Factures sans colis',
    hint: 'Liste quotidienne (8 h) des factures qui n’ont pas encore de colis.',
  },
  {
    id: 'reminders',
    label: 'Relances manuelles',
    hint: 'Relances envoyées depuis le centre d’alertes et la fiche expédition.',
  },
  {
    id: 'weekly_summary',
    label: 'Point hebdo direction',
    hint: 'Résumé envoyé chaque lundi matin : colis en route, en retard, perdus, valeur en transit et blocages en douane.',
  },
] as const;

export type ChatWebhookPurpose = (typeof CHAT_WEBHOOK_PURPOSES)[number]['id'];

export const CHAT_WEBHOOK_PURPOSE_IDS = CHAT_WEBHOOK_PURPOSES.map((p) => p.id) as ChatWebhookPurpose[];

export const isChatWebhookPurpose = (value: unknown): value is ChatWebhookPurpose =>
  typeof value === 'string' && (CHAT_WEBHOOK_PURPOSE_IDS as string[]).includes(value);

/**
 * Types added after the webhooks screen: never sent to the old server variable
 * GOOGLE_CHAT_WEBHOOK_URL, only to the webhooks created for them.
 */
const WITHOUT_ENV_FALLBACK: string[] = ['weekly_summary'];

export const usesEnvFallback = (id: string) => !WITHOUT_ENV_FALLBACK.includes(id);

export const chatWebhookPurposeLabel = (id: string) =>
  CHAT_WEBHOOK_PURPOSES.find((p) => p.id === id)?.label ?? id;

export interface ChatWebhook {
  id: string;
  name: string;
  url: string;
  purpose: ChatWebhookPurpose;
  active: boolean;
  updated_by_email: string | null;
  updated_at: string;
  created_at: string;
}

/**
 * Only Google Chat incoming webhooks are accepted: the server never posts to
 * an arbitrary address typed in the app.
 */
const GOOGLE_CHAT_URL_RE = /^https:\/\/chat\.googleapis\.com\/v1\/spaces\/[A-Za-z0-9_-]+\/messages\?\S+$/;

export const isGoogleChatWebhookUrl = (url: string) => GOOGLE_CHAT_URL_RE.test(url.trim());

/** URL shown with its key and token hidden. */
export function maskWebhookUrl(url: string): string {
  return url
    .replace(/^https:\/\//, '')
    .replace(/([?&](?:key|token)=)[^&]*/g, '$1••••••');
}
