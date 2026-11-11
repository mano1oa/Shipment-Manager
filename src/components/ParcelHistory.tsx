import React, { useEffect, useState } from 'react';
import { AlertCircle, History, Loader2 } from 'lucide-react';
import { fetchParcelHistory, formatDateTime } from './digiApi';
import type { HistoryTone, ParcelHistoryEvent } from '../lib/parcelHistory';
import { ui } from '../lib/ui';

/** History already loaded, per parcel (refreshed in the background when opened again). */
const cache = new Map<string, { events: ParcelHistoryEvent[]; photos: boolean }>();

/** Events shown before « Tout afficher » (the latest ones). */
const COLLAPSED_COUNT = 6;

const DOT: Record<HistoryTone, string> = {
  neutral: 'bg-[#C9C3D1] dark:bg-slate-600',
  success: 'bg-emerald-500',
  warning: 'bg-amber-500',
  danger: 'bg-rose-500',
};

/**
 * Historique d'un colis, inside its details (under its row in the tracking
 * lists): loaded only when the details are opened.
 */
export const ParcelHistory: React.FC<{ parcelId: string }> = ({ parcelId }) => {
  const [data, setData] = useState(cache.get(parcelId) ?? null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [broken, setBroken] = useState<Set<string>>(new Set());

  useEffect(() => {
    let alive = true;
    fetchParcelHistory(parcelId)
      .then((d) => {
        const next = { events: d.events, photos: d.photo_storage_configured };
        cache.set(parcelId, next);
        if (alive) setData(next);
      })
      .catch((err) => alive && setError(err.message));
    return () => {
      alive = false;
    };
  }, [parcelId]);

  const events = data?.events ?? [];
  const hidden = expanded ? 0 : Math.max(events.length - COLLAPSED_COUNT, 0);
  const shown = events.slice(hidden);

  return (
    <div className="rounded-xl border border-[#E7E4EC] bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-800">
      <div className={`flex items-center gap-1.5 font-bold ${ui.title}`}>
        <History className="h-3.5 w-3.5 text-[#623387] dark:text-purple-300" /> Historique
      </div>
      {error ? (
        <p className="mt-1 flex items-center gap-1.5 font-semibold text-rose-600 dark:text-rose-400">
          <AlertCircle className="h-4 w-4" /> {error}
        </p>
      ) : !data ? (
        <p className={`mt-1 flex items-center gap-2 ${ui.muted}`}>
          <Loader2 className="h-4 w-4 animate-spin" /> Chargement de l'historique…
        </p>
      ) : events.length === 0 ? (
        <p className={`mt-1 ${ui.muted}`}>Aucun événement enregistré.</p>
      ) : (
        <>
          {hidden > 0 && (
            <button
              onClick={() => setExpanded(true)}
              className="mt-1 text-[11px] font-semibold text-[#623387] hover:underline dark:text-purple-300"
            >
              Afficher les {hidden} événement(s) plus ancien(s)
            </button>
          )}
          <ol className="mt-1.5 space-y-2">
            {shown.map((e, i) => {
              const photoUrl = e.photo_id && data.photos && !broken.has(e.photo_id) ? `/api/photos/${e.photo_id}` : null;
              return (
                <li key={`${e.at}-${i}`} className="relative flex gap-2.5 pl-0.5">
                  {/* Line between the dots */}
                  {i < shown.length - 1 && (
                    <span className="absolute left-[5px] top-3 h-[calc(100%+0.25rem)] w-px bg-[#E7E4EC] dark:bg-slate-700" aria-hidden />
                  )}
                  <span className={`relative mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${DOT[e.tone]}`} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className={`font-semibold ${ui.title}`}>{e.title}</div>
                    {e.detail && <div className={ui.text}>{e.detail}</div>}
                    <div className={`text-[10px] ${ui.muted}`}>
                      {formatDateTime(e.at)}
                      {e.by ? ` · par ${e.by}` : ''}
                    </div>
                  </div>
                  {photoUrl && (
                    <a
                      href={photoUrl}
                      target="_blank"
                      rel="noreferrer"
                      title="Ouvrir la photo"
                      className="h-10 w-10 shrink-0 overflow-hidden rounded-lg border border-[#E7E4EC] dark:border-slate-700"
                    >
                      <img
                        src={photoUrl}
                        alt="Photo de la réception"
                        loading="lazy"
                        onError={() => setBroken((prev) => new Set(prev).add(e.photo_id!))}
                        className="h-full w-full object-cover"
                      />
                    </a>
                  )}
                </li>
              );
            })}
          </ol>
        </>
      )}
    </div>
  );
};
