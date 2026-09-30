import React, { useEffect, useMemo, useState } from 'react';
import {
  Truck,
  Plus,
  Trash2,
  Loader2,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  MapPin,
} from 'lucide-react';
import {
  CARRIER_CODES,
  CARRIER_LABELS,
  CarrierCode,
  WARNING_LABELS,
  detectTrackingNumber,
} from '../lib/carrierDetection';

type TrackingStatus =
  | 'UNKNOWN'
  | 'INFO_RECEIVED'
  | 'IN_TRANSIT'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'EXCEPTION';

interface TrackingNumber {
  id: string;
  tracking_number: string;
  raw_input: string;
  carrier: CarrierCode;
  status: TrackingStatus;
  status_label: string | null;
  last_event_at: string | null;
  delivered_at: string | null;
  last_checked_at: string | null;
  last_error: string | null;
  is_active: boolean;
}

interface TrackingEvent {
  id: string;
  tracking_number_id: string;
  event_at: string;
  status: TrackingStatus;
  description: string;
  location: string | null;
  source: string;
  created_by_email: string | null;
}

const STATUS_LABELS: Record<TrackingStatus, string> = {
  UNKNOWN: 'Aucune information',
  INFO_RECEIVED: 'Informations reçues',
  IN_TRANSIT: 'En transit',
  OUT_FOR_DELIVERY: 'En cours de livraison',
  DELIVERED: 'Livré',
  EXCEPTION: 'Incident',
};

const STATUS_STYLES: Record<TrackingStatus, string> = {
  UNKNOWN: 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-900 dark:text-slate-400 dark:border-slate-700',
  INFO_RECEIVED: 'bg-sky-50 text-sky-800 border-sky-200 dark:bg-sky-950 dark:text-sky-300 dark:border-sky-900',
  IN_TRANSIT: 'bg-indigo-50 text-indigo-800 border-indigo-200 dark:bg-indigo-950 dark:text-indigo-300 dark:border-indigo-900',
  OUT_FOR_DELIVERY: 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-900',
  DELIVERED: 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-900',
  EXCEPTION: 'bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-950 dark:text-rose-300 dark:border-rose-900',
};

const SOURCE_LABELS: Record<string, string> = {
  manual: 'Saisie manuelle',
  carrier_api: 'Transporteur (API)',
  amazon_report: 'Rapport Amazon',
  webhook: 'Transporteur (notification)',
  import: 'Import',
};

const MANUAL_STATUSES: TrackingStatus[] = [
  'INFO_RECEIVED',
  'IN_TRANSIT',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'EXCEPTION',
];

const inputClass =
  'w-full rounded-lg border border-slate-200 bg-white p-2 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-white';

const formatDateTime = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString('fr-FR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';

const nowForInput = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};

async function apiJson(url: string, init?: RequestInit) {
  const res = await fetch(url, { credentials: 'include', ...init });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.success) {
    throw new Error(data?.error || `Erreur ${res.status}`);
  }
  return data;
}

interface TrackingPanelProps {
  shipmentId: string;
  canEdit: boolean;
}

export const TrackingPanel: React.FC<TrackingPanelProps> = ({ shipmentId, canEdit }) => {
  const [numbers, setNumbers] = useState<TrackingNumber[]>([]);
  const [events, setEvents] = useState<TrackingEvent[]>([]);
  const [automatedCarriers, setAutomatedCarriers] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [newNumber, setNewNumber] = useState('');
  const [newCarrier, setNewCarrier] = useState<CarrierCode | ''>('');
  const [adding, setAdding] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [eventFormFor, setEventFormFor] = useState<string | null>(null);
  const [eventAt, setEventAt] = useState(nowForInput());
  const [eventStatus, setEventStatus] = useState<TrackingStatus | ''>('');
  const [eventDescription, setEventDescription] = useState('');
  const [eventLocation, setEventLocation] = useState('');
  const [savingEvent, setSavingEvent] = useState(false);

  const load = async () => {
    setError(null);
    try {
      const data = await apiJson(`/api/shipments/${encodeURIComponent(shipmentId)}/tracking`);
      setNumbers(data.numbers || []);
      setEvents(data.events || []);
      setAutomatedCarriers(data.automated_carriers || []);
    } catch (err: any) {
      setError(err?.message || 'Impossible de charger le suivi');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    load();
  }, [shipmentId]);

  const detected = useMemo(() => (newNumber.trim() ? detectTrackingNumber(newNumber) : null), [newNumber]);

  const eventsByNumber = useMemo(() => {
    const map = new Map<string, TrackingEvent[]>();
    for (const ev of events) {
      const list = map.get(ev.tracking_number_id) || [];
      list.push(ev);
      map.set(ev.tracking_number_id, list);
    }
    return map;
  }, [events]);

  const hasAutomated = numbers.some((n) => automatedCarriers.includes(n.carrier));

  const handleAdd = async () => {
    if (!detected?.number) return;
    setAdding(true);
    setError(null);
    setMessage(null);
    try {
      await apiJson(`/api/shipments/${encodeURIComponent(shipmentId)}/tracking-numbers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tracking_number: newNumber, carrier: newCarrier || undefined }),
      });
      setNewNumber('');
      setNewCarrier('');
      await load();
    } catch (err: any) {
      setError(err?.message);
    } finally {
      setAdding(false);
    }
  };

  const handleCarrierChange = async (id: string, carrier: CarrierCode) => {
    setError(null);
    try {
      await apiJson(`/api/tracking-numbers/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ carrier }),
      });
      await load();
    } catch (err: any) {
      setError(err?.message);
    }
  };

  const handleDelete = async (n: TrackingNumber) => {
    if (!window.confirm(`Retirer le numéro ${n.tracking_number} et son historique ?`)) return;
    setError(null);
    try {
      await apiJson(`/api/tracking-numbers/${n.id}`, { method: 'DELETE' });
      await load();
    } catch (err: any) {
      setError(err?.message);
    }
  };

  const openEventForm = (id: string) => {
    setEventFormFor(id);
    setExpandedId(id);
    setEventAt(nowForInput());
    setEventStatus('');
    setEventDescription('');
    setEventLocation('');
  };

  const handleSaveEvent = async (id: string) => {
    if (!eventStatus || !eventDescription.trim()) {
      setError('Le statut et la description de l’événement sont obligatoires.');
      return;
    }
    setSavingEvent(true);
    setError(null);
    try {
      await apiJson(`/api/tracking-numbers/${id}/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_at: new Date(eventAt).toISOString(),
          status: eventStatus,
          description: eventDescription,
          location: eventLocation,
        }),
      });
      setEventFormFor(null);
      await load();
    } catch (err: any) {
      setError(err?.message);
    } finally {
      setSavingEvent(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    setError(null);
    setMessage(null);
    try {
      const data = await apiJson(`/api/tracking/sync/${encodeURIComponent(shipmentId)}`, { method: 'POST' });
      const results: Array<{ outcome: string; new_events: number }> = data.results || [];
      const newEvents = results.reduce((sum, r) => sum + (r.new_events || 0), 0);
      const failed = results.filter((r) => r.outcome === 'FAILED' || r.outcome === 'NOT_FOUND').length;
      setMessage(
        `${newEvents} nouvel(s) événement(s).` +
          (failed ? ` ${failed} numéro(s) sans réponse du transporteur : suivi précédent conservé.` : '')
      );
      await load();
    } catch (err: any) {
      setError(err?.message);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-800">
      <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-700">
        <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
          <Truck className="h-4 w-4 text-[#643288]" /> Suivi transporteur
        </h3>
        {canEdit && hasAutomated && (
          <button
            type="button"
            onClick={handleSync}
            disabled={syncing}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 disabled:opacity-50"
          >
            <RefreshCw className={`h-3 w-3 ${syncing ? 'animate-spin' : ''}`} /> Synchroniser
          </button>
        )}
      </div>

      {error && (
        <p className="mt-3 rounded-lg bg-rose-50 p-2 text-[11px] font-semibold text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
          {error}
        </p>
      )}
      {message && (
        <p className="mt-3 rounded-lg bg-emerald-50 p-2 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
          {message}
        </p>
      )}

      {loading ? (
        <div className="mt-4 flex items-center gap-2 text-xs text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Chargement du suivi…
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {numbers.length === 0 && (
            <p className="text-xs text-slate-500 dark:text-slate-400">Aucun numéro de suivi rattaché.</p>
          )}

          {numbers.map((n) => {
            const nEvents = eventsByNumber.get(n.id) || [];
            const expanded = expandedId === n.id;
            const warnings = detectTrackingNumber(n.raw_input || n.tracking_number).warnings;
            const automated = automatedCarriers.includes(n.carrier);

            return (
              <div key={n.id} className="rounded-xl border border-slate-100 bg-slate-50/50 p-3 dark:border-slate-700 dark:bg-slate-900/50">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs font-bold text-slate-900 dark:text-white">{n.tracking_number}</span>
                  <span className={`rounded-md border px-2 py-0.5 text-[10px] font-semibold ${STATUS_STYLES[n.status]}`}>
                    {STATUS_LABELS[n.status]}
                  </span>
                  <span className="rounded-md bg-white px-2 py-0.5 text-[10px] text-slate-500 border border-slate-200 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-400">
                    {automated ? 'Suivi automatique' : 'Suivi manuel'}
                  </span>
                  <div className="ml-auto flex items-center gap-1.5">
                    {canEdit ? (
                      <select
                        value={n.carrier}
                        onChange={(e) => handleCarrierChange(n.id, e.target.value as CarrierCode)}
                        aria-label="Transporteur"
                        className="rounded-md border border-slate-200 bg-white p-1 text-[11px] dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                      >
                        {CARRIER_CODES.map((c) => (
                          <option key={c} value={c}>
                            {CARRIER_LABELS[c]}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-[11px] text-slate-600 dark:text-slate-300">{CARRIER_LABELS[n.carrier]}</span>
                    )}
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => handleDelete(n)}
                        className="rounded-md p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                        title="Retirer ce numéro"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                <div className="mt-1.5 text-[11px] text-slate-600 dark:text-slate-400">
                  {n.status_label || 'Aucun événement enregistré.'}
                  {n.last_event_at && <span className="text-slate-400"> · {formatDateTime(n.last_event_at)}</span>}
                </div>

                {warnings.map((w) => (
                  <p key={w} className="mt-1 flex items-center gap-1 text-[11px] text-amber-700 dark:text-amber-400">
                    <AlertTriangle className="h-3 w-3" /> {WARNING_LABELS[w]}
                  </p>
                ))}
                {n.last_error && (
                  <p className="mt-1 flex items-center gap-1 text-[11px] text-rose-600 dark:text-rose-400">
                    <AlertTriangle className="h-3 w-3" /> {n.last_error} ({formatDateTime(n.last_checked_at)}) — suivi précédent conservé.
                  </p>
                )}

                <div className="mt-2 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setExpandedId(expanded ? null : n.id)}
                    className="flex items-center gap-1 text-[11px] font-semibold text-[#643288] dark:text-purple-300"
                  >
                    {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                    Historique ({nEvents.length})
                  </button>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => openEventForm(n.id)}
                      className="flex items-center gap-1 text-[11px] font-semibold text-slate-600 hover:text-slate-900 dark:text-slate-300"
                    >
                      <Plus className="h-3 w-3" /> Ajouter un événement
                    </button>
                  )}
                </div>

                {expanded && (
                  <div className="mt-2 space-y-2">
                    {eventFormFor === n.id && (
                      <div className="grid grid-cols-1 gap-2 rounded-lg border border-[#643288]/30 bg-white p-2.5 sm:grid-cols-2 dark:border-purple-900/60 dark:bg-slate-800">
                        <input
                          type="datetime-local"
                          value={eventAt}
                          onChange={(e) => setEventAt(e.target.value)}
                          aria-label="Date de l'événement"
                          className={inputClass}
                        />
                        <select
                          value={eventStatus}
                          onChange={(e) => setEventStatus(e.target.value as TrackingStatus | '')}
                          aria-label="Statut"
                          className={inputClass}
                        >
                          <option value="">— Statut —</option>
                          {MANUAL_STATUSES.map((s) => (
                            <option key={s} value={s}>
                              {STATUS_LABELS[s]}
                            </option>
                          ))}
                        </select>
                        <input
                          type="text"
                          value={eventDescription}
                          onChange={(e) => setEventDescription(e.target.value)}
                          aria-label="Description"
                          className={`${inputClass} sm:col-span-2`}
                        />
                        <input
                          type="text"
                          value={eventLocation}
                          onChange={(e) => setEventLocation(e.target.value)}
                          aria-label="Lieu"
                          className={inputClass}
                        />
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setEventFormFor(null)}
                            className="rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-600 dark:border-slate-700 dark:text-slate-300"
                          >
                            Annuler
                          </button>
                          <button
                            type="button"
                            onClick={() => handleSaveEvent(n.id)}
                            disabled={savingEvent}
                            className="flex items-center gap-1 rounded-lg bg-[#643288] px-2.5 py-1 text-[11px] font-bold text-white disabled:opacity-50"
                          >
                            {savingEvent ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                            Enregistrer
                          </button>
                        </div>
                      </div>
                    )}

                    {nEvents.length === 0 && eventFormFor !== n.id && (
                      <p className="text-[11px] text-slate-500">Aucun événement.</p>
                    )}
                    {nEvents.map((ev) => (
                      <div key={ev.id} className="rounded-lg border border-slate-100 bg-white p-2 dark:border-slate-700 dark:bg-slate-800">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[11px] font-bold text-slate-900 dark:text-white">{ev.description}</span>
                          <span className="font-mono text-[10px] text-slate-400">{formatDateTime(ev.event_at)}</span>
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[10px] text-slate-500">
                          <span>{STATUS_LABELS[ev.status]}</span>
                          {ev.location && (
                            <span className="flex items-center gap-0.5">
                              <MapPin className="h-3 w-3" /> {ev.location}
                            </span>
                          )}
                          <span>· {SOURCE_LABELS[ev.source] || ev.source}</span>
                          {ev.created_by_email && <span>· {ev.created_by_email}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {canEdit && (
            <div className="rounded-xl border border-dashed border-slate-200 p-3 dark:border-slate-700">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_180px_auto]">
                <input
                  type="text"
                  value={newNumber}
                  onChange={(e) => setNewNumber(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAdd();
                    }
                  }}
                  aria-label="Nouveau numéro de suivi"
                  className={`${inputClass} font-mono`}
                />
                <select
                  value={newCarrier}
                  onChange={(e) => setNewCarrier(e.target.value as CarrierCode | '')}
                  aria-label="Transporteur du nouveau numéro"
                  className={inputClass}
                >
                  <option value="">
                    {detected ? `Détecté : ${CARRIER_LABELS[detected.carrier]}` : 'Transporteur (auto)'}
                  </option>
                  {CARRIER_CODES.map((c) => (
                    <option key={c} value={c}>
                      {CARRIER_LABELS[c]}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={handleAdd}
                  disabled={adding || !detected?.number}
                  className="flex items-center justify-center gap-1 rounded-lg bg-[#643288] px-3 py-2 text-[11px] font-bold text-white hover:bg-[#522870] disabled:opacity-50"
                >
                  {adding ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                  Ajouter un n° de suivi
                </button>
              </div>
              {detected?.warnings.map((w) => (
                <p key={w} className="mt-1.5 flex items-center gap-1 text-[11px] text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="h-3 w-3" /> {WARNING_LABELS[w]}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
