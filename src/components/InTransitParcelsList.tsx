import React, { useMemo, useState } from 'react';
import { AlertCircle, Loader2, RefreshCw, Search } from 'lucide-react';
import type { ParcelDestination } from '../lib/parcelTracking';
import { Shipment } from '../types';
import { Parcel, formatDate } from './digiApi';
import { parcelMatches } from './ParcelsBoardView';

/** Where a parcel stands between the supplier and Madagascar. */
type Stage = 'to_hub' | 'at_hub' | 'to_mada' | 'customs' | 'search';

const STAGE_LABELS: Record<Stage, (hub: string) => string> = {
  to_hub: (hub) => `En route vers ${hub}`,
  at_hub: (hub) => `À ${hub}, en attente de départ`,
  to_mada: () => 'En route vers Madagascar',
  customs: () => 'Bloqué en douane',
  search: () => 'Avis de recherche',
};

const STAGE_BADGES: Record<Stage, string> = {
  to_hub: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  at_hub: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300',
  to_mada: 'bg-[#EAD7F9] text-[#623387] dark:bg-purple-950 dark:text-[#B688FF]',
  customs: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  search: 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300',
};

/**
 * Stage of a parcel, or null once it is over: lost before the hub, or its
 * shipment delivered to the Madagascar warehouse (an "avis de recherche" stays
 * open until it is settled).
 */
function stageOf(p: Parcel, shipments: Shipment[]): Stage | null {
  if (p.status === 'lost') return null;
  if (p.status === 'search') return 'search';
  if (p.status === 'to_receive') return 'to_hub';
  if (shipments.some((s) => s.global_status === 'Livrée entrepôt')) return null;
  if (shipments.some((s) => s.global_status === 'Bloquée douane')) return 'customs';
  if (shipments.some((s) => s.global_status === 'Expédiée vers Mada')) return 'to_mada';
  return 'at_hub';
}

export interface InTransitRow {
  parcel: Parcel;
  shipments: Shipment[];
  stage: Stage;
}

/** Parcels of a hub not yet received in Madagascar, with their stage. */
export function inTransitRows(parcels: Parcel[], destination: ParcelDestination, shipments: Shipment[]): InTransitRow[] {
  const byId = new Map(shipments.map((s) => [s.id, s]));
  return parcels
    .filter((p) => p.destination === destination)
    .map((p) => {
      const own = p.shipment_ids.map((id) => byId.get(id)).filter((s): s is Shipment => Boolean(s));
      return { parcel: p, shipments: own, stage: stageOf(p, own) };
    })
    .filter((r): r is InTransitRow => r.stage !== null);
}

interface Props {
  destination: ParcelDestination;
  /** Loaded once by the app; null while loading. */
  parcels: Parcel[] | null;
  shipments: Shipment[];
  loading: boolean;
  error: string | null;
  onReload: () => void;
  /** Search typed in the top bar. */
  globalSearch: string;
  onOpenShipment: (shipmentId: string) => void;
}

/** Suivi aérien / maritime › En cours d'acheminement: every parcel not yet received in Madagascar. */
export const InTransitParcelsList: React.FC<Props> = ({
  destination,
  parcels,
  shipments,
  loading,
  error,
  onReload,
  globalSearch,
  onOpenShipment,
}) => {
  const hub = destination === 'ORLY' ? 'Orly' : 'Rouen';
  const [search, setSearch] = useState('');
  const [stageFilter, setStageFilter] = useState<'all' | Stage>('all');

  const rows = useMemo(() => inTransitRows(parcels || [], destination, shipments), [parcels, destination, shipments]);

  const counts = useMemo(() => {
    const c: Record<Stage, number> = { to_hub: 0, at_hub: 0, to_mada: 0, customs: 0, search: 0 };
    rows.forEach((r) => c[r.stage]++);
    return c;
  }, [rows]);

  const filtered = useMemo(
    () =>
      rows.filter(
        ({ parcel: p, stage }) =>
          (stageFilter === 'all' || stage === stageFilter) && parcelMatches(p, search) && parcelMatches(p, globalSearch)
      ),
    [rows, search, globalSearch, stageFilter]
  );

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Tous les colis vers {hub} pas encore arrivés à Madagascar : en route vers {hub}, en attente de départ, puis en
        route vers Madagascar.
      </p>
      <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-xs lg:flex-row lg:flex-wrap lg:items-center dark:border-slate-800 dark:bg-slate-800">
        <div className="relative min-w-0 flex-1 sm:min-w-[16rem]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="N° de suivi, fournisseur, facture, expédition…"
            className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-xs text-slate-800 focus:border-[#623387] focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          />
        </div>
        <select
          value={stageFilter}
          onChange={(e) => setStageFilter(e.target.value as typeof stageFilter)}
          className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 focus:border-[#623387] focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
        >
          <option value="all">Toutes les étapes ({rows.length})</option>
          {(Object.keys(STAGE_LABELS) as Stage[]).map((s) => (
            <option key={s} value={s}>
              {STAGE_LABELS[s](hub)} ({counts[s]})
            </option>
          ))}
        </select>
        <button
          onClick={onReload}
          disabled={loading}
          className="flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Actualiser
        </button>
        <span className="text-xs font-semibold text-slate-500">{filtered.length} colis</span>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-800">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500 dark:bg-slate-900/60 dark:text-slate-400">
              <tr>
                <th className="px-3 py-3">N° de suivi</th>
                <th className="px-3 py-3">Fournisseur</th>
                <th className="px-3 py-3">Factures</th>
                <th className="px-3 py-3">Étape</th>
                <th className="px-3 py-3">Livraison prévue</th>
                <th className="px-3 py-3">Expédition</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
              {parcels === null ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center">
                    {error ? '—' : <Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-400" />}
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-slate-500">
                    {rows.length === 0 ? 'Aucun colis en cours d’acheminement.' : 'Aucun colis ne correspond à vos filtres.'}
                  </td>
                </tr>
              ) : (
                filtered.map(({ parcel: p, shipments: own, stage }) => (
                  <tr key={p.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-700/30">
                    <td className="px-3 py-2.5">
                      <span className="font-mono font-semibold">{p.tracking_number || '— (inconnu)'}</span>
                      {p.carrier_name && <span className="ml-1 text-[10px] text-slate-400">{p.carrier_name}</span>}
                    </td>
                    <td className="px-3 py-2.5 font-semibold">{p.supplier_name || '—'}</td>
                    <td className="px-3 py-2.5">{p.invoices.map((i) => i.ref || '—').join(', ') || '—'}</td>
                    <td className="px-3 py-2.5">
                      <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-bold ${STAGE_BADGES[stage]}`}>
                        {STAGE_LABELS[stage](hub)}
                      </span>
                      {p.status === 'received' && p.received_at && (
                        <span className="ml-1 text-[10px] text-slate-400">reçu le {formatDate(p.received_at)}</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">{formatDate(p.expected_delivery)}</td>
                    <td className="px-3 py-2.5">
                      {own.length === 0
                        ? '—'
                        : own.map((s) => (
                            <button
                              key={s.id}
                              onClick={() => onOpenShipment(s.id)}
                              className="mr-1 font-mono font-semibold text-[#623387] hover:underline dark:text-[#B688FF]"
                            >
                              {s.id}
                            </button>
                          ))}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
