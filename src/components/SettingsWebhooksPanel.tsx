import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, Copy, Eye, EyeOff, Loader2, Pencil, Plus, Send, Trash2, Webhook, X } from 'lucide-react';
import { apiJson, inputClass } from './digiApi';
import {
  CHAT_WEBHOOK_PURPOSES,
  chatWebhookPurposeLabel,
  isGoogleChatWebhookUrl,
  maskWebhookUrl,
  usesEnvFallback,
} from '../lib/chatWebhooks';
import type { ChatWebhook, ChatWebhookPurpose } from '../lib/chatWebhooks';

type Draft = { id?: string; name: string; url: string; purpose: ChatWebhookPurpose; active: boolean };

const EMPTY_DRAFT: Draft = { name: '', url: '', purpose: CHAT_WEBHOOK_PURPOSES[0].id, active: true };

const formatModified = (iso: string) =>
  new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

const outlineButton =
  'flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700';

/**
 * Paramètres › Webhooks Google Chat: the Chat spaces that receive the app's
 * messages. Each webhook has a type (lost parcels, shipment confirmation…).
 */
export const SettingsWebhooksPanel: React.FC = () => {
  const [webhooks, setWebhooks] = useState<ChatWebhook[]>([]);
  const [envFallback, setEnvFallback] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState<Draft | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = () =>
    apiJson<{ webhooks: ChatWebhook[]; env_fallback: boolean }>('/api/settings/chat-webhooks')
      .then((d) => {
        setWebhooks(d.webhooks);
        setEnvFallback(d.env_fallback);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));

  useEffect(() => {
    load();
  }, []);

  const replace = (w: ChatWebhook) =>
    setWebhooks((prev) => (prev.some((x) => x.id === w.id) ? prev.map((x) => (x.id === w.id ? w : x)) : [...prev, w]));

  const run = async (id: string, action: () => Promise<void>) => {
    setBusyId(id);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const toggleActive = (w: ChatWebhook) =>
    run(w.id, async () => {
      const d = await apiJson<{ webhook: ChatWebhook }>(`/api/settings/chat-webhooks/${w.id}`, {
        method: 'PUT',
        body: JSON.stringify({ active: !w.active }),
      });
      replace(d.webhook);
    });

  const remove = (w: ChatWebhook) => {
    if (!window.confirm(`Supprimer le webhook « ${w.name} » ? Son espace Google Chat ne recevra plus ces messages.`)) return;
    run(w.id, async () => {
      await apiJson(`/api/settings/chat-webhooks/${w.id}`, { method: 'DELETE' });
      setWebhooks((prev) => prev.filter((x) => x.id !== w.id));
      setNotice(`Webhook « ${w.name} » supprimé.`);
    });
  };

  const test = (w: ChatWebhook) =>
    run(w.id, async () => {
      await apiJson(`/api/settings/chat-webhooks/${w.id}/test`, { method: 'POST' });
      setNotice(`Message de test envoyé dans « ${w.name} ».`);
    });

  const sendDigest = (w: ChatWebhook) =>
    run(w.id, async () => {
      const r = await apiJson<{ invoices: number; sent: number }>('/api/settings/chat-webhooks/send-invoices-without-parcel', {
        method: 'POST',
      });
      setNotice(
        r.invoices === 0
          ? 'Aucune facture sans colis : rien à envoyer.'
          : `Liste de ${r.invoices} facture(s) sans colis envoyée (${r.sent} webhook(s)).`
      );
    });

  const sendWeeklyPreview = (w: ChatWebhook) =>
    run(w.id, async () => {
      await apiJson(`/api/settings/chat-webhooks/${w.id}/send-weekly-summary`, { method: 'POST' });
      setNotice(`Aperçu du point hebdo envoyé dans « ${w.name} ».`);
    });

  const copy = async (w: ChatWebhook) => {
    try {
      await navigator.clipboard.writeText(w.url);
      setNotice(`Adresse de « ${w.name} » copiée.`);
    } catch {
      setError('Copie impossible dans ce navigateur.');
    }
  };

  const toggleReveal = (id: string) =>
    setRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const openForm = (w?: ChatWebhook) => {
    setFormError(null);
    setDraft(w ? { id: w.id, name: w.name, url: w.url, purpose: w.purpose, active: w.active } : { ...EMPTY_DRAFT });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft) return;
    if (!draft.name.trim()) return setFormError('Donnez un nom au webhook.');
    if (!isGoogleChatWebhookUrl(draft.url)) {
      return setFormError(
        'Collez l’URL complète du webhook Google Chat : https://chat.googleapis.com/v1/spaces/…/messages?key=…&token=…'
      );
    }
    setSaving(true);
    setFormError(null);
    try {
      const body = JSON.stringify({ name: draft.name.trim(), url: draft.url.trim(), purpose: draft.purpose, active: draft.active });
      const d = await apiJson<{ webhook: ChatWebhook }>(
        draft.id ? `/api/settings/chat-webhooks/${draft.id}` : '/api/settings/chat-webhooks',
        { method: draft.id ? 'PUT' : 'POST', body }
      );
      replace(d.webhook);
      setNotice(`Webhook « ${d.webhook.name} » ${draft.id ? 'modifié' : 'créé'}.`);
      setDraft(null);
    } catch (err: any) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const activeCount = webhooks.filter((w) => w.active).length;
  /** Types with no webhook at all: still sent to the server variable, if any. */
  const purposesWithout = useMemo(
    () => CHAT_WEBHOOK_PURPOSES.filter((p) => !webhooks.some((w) => w.purpose === p.id)),
    [webhooks]
  );
  const selectedPurpose = CHAT_WEBHOOK_PURPOSES.find((p) => p.id === draft?.purpose);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-extrabold text-slate-900 dark:text-white">Webhooks Google Chat</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Choisissez les espaces Google Chat qui reçoivent les messages de Shipment Manager, selon leur type.
          </p>
        </div>
        <button
          onClick={() => openForm()}
          className="flex shrink-0 items-center gap-1.5 rounded-xl bg-[#623387] px-4 py-2 text-xs font-bold text-white hover:bg-[#522870]"
        >
          <Plus className="h-4 w-4" /> Nouveau webhook
        </button>
      </div>

      <p className="text-xs text-slate-500 dark:text-slate-400">
        <span className="font-bold text-slate-800 dark:text-slate-200">{webhooks.length}</span> webhook(s) ·{' '}
        <span className="font-bold text-emerald-600 dark:text-emerald-400">{activeCount}</span> actif(s)
      </p>

      {!loading && purposesWithout.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300">
          <span className="font-bold">Sans webhook :</span> {purposesWithout.map((p) => p.label).join(', ')}.{' '}
          {envFallback && purposesWithout.some((p) => usesEnvFallback(p.id))
            ? 'Ces messages partent encore vers l’ancienne adresse fixée sur le serveur (Vercel) jusqu’à la création d’un webhook de ce type.'
            : 'Ces messages ne sont envoyés nulle part tant qu’un webhook de ce type n’est pas créé.'}
          {envFallback && purposesWithout.some((p) => !usesEnvFallback(p.id)) && purposesWithout.some((p) => usesEnvFallback(p.id)) && (
            <>
              {' '}Sauf{' '}
              {purposesWithout
                .filter((p) => !usesEnvFallback(p.id))
                .map((p) => `« ${p.label} »`)
                .join(', ')}
              , envoyé uniquement aux webhooks créés ici.
            </>
          )}
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300">
          <AlertCircle className="h-4 w-4 shrink-0" /> {error}
        </div>
      )}
      {notice && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-semibold text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300">
          <CheckCircle2 className="h-4 w-4 shrink-0" /> {notice}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Chargement…
        </div>
      ) : webhooks.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-xs text-slate-500 dark:border-slate-700">
          Aucun webhook. Créez-en un par espace Google Chat à prévenir.
        </div>
      ) : (
        <div className="space-y-3">
          {webhooks.map((w) => {
            const busy = busyId === w.id;
            return (
              <section
                key={w.id}
                className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs dark:border-slate-800 dark:bg-slate-900"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#623387]/10 text-[#623387] dark:bg-[#623387]/30 dark:text-[#D7BCE8]">
                      <Webhook className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-bold text-slate-900 dark:text-white">{w.name}</h3>
                      <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                        <span className="rounded-full bg-[#EAD7F9] px-2 py-0.5 font-bold text-[#623387] dark:bg-purple-950 dark:text-[#B688FF]">
                          {chatWebhookPurposeLabel(w.purpose)}
                        </span>
                        <span>Modifié le {formatModified(w.updated_at)}</span>
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={w.active}
                    onClick={() => toggleActive(w)}
                    disabled={busy}
                    className="flex shrink-0 items-center gap-2 text-xs font-semibold disabled:opacity-50"
                  >
                    <span className={w.active ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'}>
                      {w.active ? 'Actif' : 'Inactif'}
                    </span>
                    <span
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition ${
                        w.active ? 'bg-[#623387]' : 'bg-slate-300 dark:bg-slate-700'
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 rounded-full bg-white shadow transition ${
                          w.active ? 'translate-x-4' : 'translate-x-0.5'
                        }`}
                      />
                    </span>
                  </button>
                </div>

                <div className="mt-3 flex items-center gap-2 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-800/60">
                  <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-slate-600 dark:text-slate-300">
                    {revealed.has(w.id) ? w.url.replace(/^https:\/\//, '') : maskWebhookUrl(w.url)}
                  </code>
                  <button
                    type="button"
                    onClick={() => toggleReveal(w.id)}
                    title={revealed.has(w.id) ? 'Masquer' : 'Afficher'}
                    className="rounded-lg p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                  >
                    {revealed.has(w.id) ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => copy(w)}
                    title="Copier"
                    className="rounded-lg p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                  >
                    <Copy className="h-4 w-4" />
                  </button>
                </div>

                <div className="mt-3 flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
                  {w.purpose === 'invoices_without_parcel' && (
                    <button onClick={() => sendDigest(w)} disabled={busy} className={outlineButton} title="Envoie maintenant la liste prévue chaque matin">
                      <Send className="h-3.5 w-3.5" /> Envoyer la liste maintenant
                    </button>
                  )}
                  {w.purpose === 'weekly_summary' && (
                    <button
                      onClick={() => sendWeeklyPreview(w)}
                      disabled={busy}
                      className={outlineButton}
                      title="Envoie maintenant dans cet espace le point prévu chaque lundi matin"
                    >
                      <Send className="h-3.5 w-3.5" /> Envoyer un aperçu maintenant
                    </button>
                  )}
                  <button onClick={() => test(w)} disabled={busy} className={outlineButton}>
                    {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Tester
                  </button>
                  <button onClick={() => openForm(w)} disabled={busy} className={outlineButton}>
                    <Pencil className="h-3.5 w-3.5" /> Modifier
                  </button>
                  <button
                    onClick={() => remove(w)}
                    disabled={busy}
                    className={`${outlineButton} !text-rose-600 dark:!text-rose-400`}
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Supprimer
                  </button>
                </div>
              </section>
            );
          })}
        </div>
      )}

      {draft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs">
          <form
            onSubmit={handleSave}
            className="w-full max-w-lg space-y-3 rounded-3xl border border-slate-200 bg-white p-6 text-xs shadow-2xl dark:border-slate-800 dark:bg-slate-900"
          >
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3 dark:border-slate-800">
              <h3 className="text-base font-extrabold text-slate-900 dark:text-white">
                {draft.id ? 'Modifier le webhook' : 'Nouveau webhook'}
              </h3>
              <button
                type="button"
                onClick={() => setDraft(null)}
                aria-label="Fermer"
                className="rounded-xl p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {formError && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
                {formError}
              </div>
            )}

            <label className="block font-semibold text-slate-700 dark:text-slate-300">
              Nom (espace Google Chat)
              <input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                maxLength={100}
                placeholder="ex. ACHATS"
                className={inputClass}
                autoFocus
              />
            </label>

            <label className="block font-semibold text-slate-700 dark:text-slate-300">
              Type de messages
              <select
                value={draft.purpose}
                onChange={(e) => setDraft({ ...draft, purpose: e.target.value as ChatWebhookPurpose })}
                className={inputClass}
              >
                {CHAT_WEBHOOK_PURPOSES.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
              {selectedPurpose && <span className="mt-1 block font-normal text-slate-500">{selectedPurpose.hint}</span>}
            </label>

            <label className="block font-semibold text-slate-700 dark:text-slate-300">
              URL du webhook
              <input
                value={draft.url}
                onChange={(e) => setDraft({ ...draft, url: e.target.value })}
                placeholder="https://chat.googleapis.com/v1/spaces/…/messages?key=…&token=…"
                className={`${inputClass} font-mono`}
              />
              <span className="mt-1 block font-normal text-slate-500">
                Dans Google Chat : espace › Applications et intégrations › Webhooks › copier l’URL.
              </span>
            </label>

            <label className="flex items-center gap-2 font-semibold text-slate-700 dark:text-slate-300">
              <input
                type="checkbox"
                checked={draft.active}
                onChange={(e) => setDraft({ ...draft, active: e.target.checked })}
                className="h-4 w-4 accent-[#623387]"
              />
              Actif
            </label>

            <div className="flex justify-end gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setDraft(null)}
                className="rounded-xl border border-slate-200 px-4 py-2 font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                Annuler
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-xl bg-[#623387] px-5 py-2 font-bold text-white hover:bg-[#522870] disabled:opacity-50"
              >
                {saving ? 'Enregistrement...' : draft.id ? 'Enregistrer' : 'Créer'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
