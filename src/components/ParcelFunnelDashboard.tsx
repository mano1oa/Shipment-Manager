import React, { useMemo, useState } from 'react';
import { AlertTriangle, FileWarning, Loader2, PackageX, SearchX, ShieldAlert } from 'lucide-react';
import { Shipment } from '../types';
import type { ParcelsOverview } from './digiApi';
import { journeyStage, JourneyStage } from './InTransitParcelsList';

type Hub = 'all' | 'ORLY' | 'ROUEN';

interface Props {
  overview: ParcelsOverview | null;
  loading: boolean;
  shipments: Shipment[];
  /** Opens Suivi aérien (Orly) / maritime (Rouen). */
  onOpenHub?: (hub: 'ORLY' | 'ROUEN') => void;
}

/** Steps of the funnel: a parcel counts in every step it has reached. */
const FUNNEL: { key: string; label: string; hint: string; reached: JourneyStage[] }[] = [
  {
    key: 'announced',
    label: 'Colis attendus',
    hint: 'Tous les colis créés depuis les factures (hors perdus)',
    reached: ['to_hub', 'at_hub', 'to_mada', 'customs', 'search', 'delivered'],
  },
  { key: 'hub', label: 'Reçus au hub', hint: 'Confirmés à Orly / Rouen', reached: ['at_hub', 'to_mada', 'customs', 'delivered'] },
  { key: 'departed', label: 'Partis vers Madagascar', hint: 'Dans une expédition partie', reached: ['to_mada', 'customs', 'delivered'] },
  { key: 'delivered', label: 'Livrés à Madagascar', hint: 'Expédition livrée à l’entrepôt', reached: ['delivered'] },
];

/** One hue, light → dark along the journey (light / dark themes). */
const FUNNEL_FILLS = [
  'bg-[#D9C2EE] dark:bg-[#4A2766]',
  'bg-[#B48BDB] dark:bg-[#6E3E96]',
  'bg-[#8A55BA] dark:bg-[#9465BF]',
  'bg-[#623387] dark:bg-[#C09BE3]',
];

const STAGE_LABELS: Record<JourneyStage, string> = {
  to_hub: 'En route vers le hub',
  at_hub: 'Au hub, en attente de départ',
  to_mada: 'En route vers Madagascar',
  customs: 'Bloqués en douane',
  search: 'Avis de recherche',
  lost: 'Perdus avant le hub',
  delivered: 'Livrés à Madagascar',
};

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

/**
 * Tableau de bord, reading in a funnel: the key figures first (the journey of
 * the parcels, from the supplier to Madagascar), then the exceptions, then the
 * details (where the open parcels are, by supplier).
 */
export const ParcelFunnelDashboard: React.FC<Props> = ({ overview, loading, shipments, onOpenHub }) => {
  const [hub, setHub] = useState<Hub>('all');

  const data = useMemo(() => {
    if (!overview) return null;
    const byId = new Map<string, Shipment>(shipments.map((s) => [s.id, s]));
    const parcels = overview.parcels.filter((p) => hub === 'all' || p.destination === hub);
    const stages = parcels.map((p) => ({ parcel: p, stage: journeyStage(p, byId) }));
    const count = (list: JourneyStage[]) => stages.filter((s) => list.includes(s.stage)).length;
    const funnel = FUNNEL.map((f) => ({ ...f, value: count(f.reached) }));
    const open = stages.filter((s) => s.stage !== 'delivered' && s.stage !== 'lost');
    const byStage = (['to_hub', 'at_hub', 'to_mada', 'customs', 'search'] as JourneyStage[]).map((k) => ({
      key: k,
      value: stages.filter((s) => s.stage === k).length,
    }));
    const suppliers = new Map<string, number>();
    open.forEach((s) => suppliers.set(s.parcel.supplier_name || '—', (suppliers.get(s.parcel.supplier_name || '—') ?? 0) + 1));
    const topSuppliers = Array.from(suppliers.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'fr'))
      .slice(0, 6);
    return {
      total: parcels.length,
      open: open.length,
      funnel,
      byStage,
      topSuppliers,
      lost: count(['lost']),
      search: count(['search']),
      customs: count(['customs']),
      withoutParcel: hub === 'all' ? overview.invoices_without_parcel.length : null,
      lateTriage: overview.late_triage_invoices.length,
    };
  }, [overview, shipments, hub]);

  const card = 'rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-800';

  if (!data) {
    return (
      <div className={`${card} flex items-center gap-2 text-xs text-slate-500`}>
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        {loading ? 'Chargement des colis…' : 'Colis non disponibles.'}
      </div>
    );
  }

  const top = data.funnel[0].value;
  const maxStage = Math.max(1, ...data.byStage.map((s) => s.value));
  const maxSupplier = Math.max(1, ...data.topSuppliers.map((s) => s[1]));
  const delivered = data.funnel[3].value;

  return (
    <div className="space-y-4">
      {/* Filter: one row above the charts */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-sm font-bold text-slate-900 dark:text-white">Tableau de bord — colis fournisseur → Madagascar</h1>
        <div className="flex gap-1 rounded-xl bg-slate-200/60 p-1 text-xs font-semibold dark:bg-slate-800">
          {(
            [
              ['all', 'Tous'],
              ['ORLY', 'Aérien (Orly)'],
              ['ROUEN', 'Maritime (Rouen)'],
            ] as [Hub, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setHub(key)}
              className={`rounded-lg px-3 py-1 transition ${
                hub === key ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white' : 'text-slate-500 hover:text-slate-800 dark:text-slate-400'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* 1. Key figures */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: 'Colis en cours', value: data.open, sub: `sur ${data.total} colis au total` },
          { label: 'Au hub, à expédier', value: data.byStage[1].value, sub: 'reçus, en attente de départ' },
          { label: 'En route vers Madagascar', value: data.byStage[2].value, sub: 'expéditions parties' },
          { label: 'Livrés à Madagascar', value: delivered, sub: `${pct(delivered, top)} % des colis attendus` },
        ].map((k) => (
          <div key={k.label} className={card}>
            <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">{k.label}</div>
            <div className="mt-1 text-3xl font-extrabold tabular-nums text-slate-900 dark:text-white">{k.value}</div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">{k.sub}</div>
          </div>
        ))}
      </div>

      {/* 2. Funnel + exceptions */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className={`${card} lg:col-span-2`}>
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">Entonnoir d'acheminement</h2>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            Chaque étape compte les colis qui l'ont atteinte ; le % indique le passage depuis l'étape précédente.
          </p>
          <div className="mt-4 space-y-3">
            {data.funnel.map((f, i) => {
              const width = top > 0 ? Math.max((f.value / top) * 100, f.value > 0 ? 3 : 0) : 0;
              const prev = i > 0 ? data.funnel[i - 1].value : null;
              return (
                <div key={f.key} title={`${f.label} : ${f.value} colis — ${f.hint}`} className="group">
                  <div className="mb-1 flex items-baseline justify-between text-xs">
                    <span className="font-semibold text-slate-700 dark:text-slate-200">{f.label}</span>
                    <span className="tabular-nums text-slate-900 dark:text-white">
                      <b>{f.value}</b>
                      {prev !== null && <span className="ml-2 text-[11px] text-slate-500">{pct(f.value, prev)} %</span>}
                    </span>
                  </div>
                  <div className="h-7 w-full rounded-r-md bg-slate-100 dark:bg-slate-900/60">
                    <div
                      className={`h-full rounded-r-md transition-all group-hover:opacity-80 ${FUNNEL_FILLS[i]}`}
                      style={{ width: `${width}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
          {onOpenHub && (
            <div className="mt-4 flex gap-3 text-[11px] font-semibold">
              <button onClick={() => onOpenHub('ORLY')} className="text-[#623387] hover:underline dark:text-[#C09BE3]">
                Ouvrir le suivi aérien →
              </button>
              <button onClick={() => onOpenHub('ROUEN')} className="text-[#623387] hover:underline dark:text-[#C09BE3]">
                Ouvrir le suivi maritime →
              </button>
            </div>
          )}
        </div>

        <div className={card}>
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">Exceptions à traiter</h2>
          <ul className="mt-3 space-y-2 text-xs">
            {[
              { icon: PackageX, label: 'Perdus avant le hub', value: data.lost, tone: 'text-rose-600 dark:text-rose-400' },
              { icon: SearchX, label: 'Avis de recherche', value: data.search, tone: 'text-orange-600 dark:text-orange-400' },
              { icon: ShieldAlert, label: 'Bloqués en douane', value: data.customs, tone: 'text-amber-600 dark:text-amber-400' },
              ...(data.withoutParcel !== null
                ? [{ icon: FileWarning, label: 'Factures sans colis', value: data.withoutParcel, tone: 'text-amber-600 dark:text-amber-400' }]
                : []),
              { icon: AlertTriangle, label: 'Factures non triées en retard', value: data.lateTriage, tone: 'text-amber-600 dark:text-amber-400' },
            ].map(({ icon: Icon, label, value, tone }) => (
              <li
                key={label}
                className="flex items-center justify-between rounded-xl border border-slate-100 px-3 py-2 dark:border-slate-700"
              >
                <span className="flex items-center gap-2 font-semibold text-slate-700 dark:text-slate-200">
                  <Icon className={`h-4 w-4 ${value > 0 ? tone : 'text-slate-400'}`} /> {label}
                </span>
                <span className="text-base font-extrabold tabular-nums text-slate-900 dark:text-white">{value}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* 3. Details */}
      <div className="grid gap-4 lg:grid-cols-2">
        <BarList
          title="Où sont les colis en cours"
          rows={data.byStage.map((s) => ({ label: STAGE_LABELS[s.key], value: s.value }))}
          max={maxStage}
          card={card}
        />
        <BarList
          title="Colis en cours par fournisseur (top 6)"
          rows={data.topSuppliers.map(([label, value]) => ({ label, value }))}
          max={maxSupplier}
          card={card}
          empty="Aucun colis en cours."
        />
      </div>
    </div>
  );
};

const BarList: React.FC<{ title: string; rows: { label: string; value: number }[]; max: number; card: string; empty?: string }> = ({
  title,
  rows,
  max,
  card,
  empty,
}) => (
  <div className={card}>
    <h2 className="text-sm font-bold text-slate-900 dark:text-white">{title}</h2>
    {rows.length === 0 ? (
      <p className="mt-3 text-xs text-slate-500">{empty}</p>
    ) : (
      <div className="mt-3 space-y-2">
        {rows.map((r) => (
          <div key={r.label} title={`${r.label} : ${r.value} colis`} className="group grid grid-cols-[minmax(0,10rem)_1fr_2.5rem] items-center gap-2 text-xs">
            <span className="truncate text-slate-600 dark:text-slate-300">{r.label}</span>
            <div className="h-4 rounded-r bg-slate-100 dark:bg-slate-900/60">
              <div
                className="h-full rounded-r bg-[#8A55BA] transition-all group-hover:opacity-80 dark:bg-[#9465BF]"
                style={{ width: `${r.value > 0 ? Math.max((r.value / max) * 100, 2) : 0}%` }}
              />
            </div>
            <span className="text-right font-bold tabular-nums text-slate-900 dark:text-white">{r.value}</span>
          </div>
        ))}
      </div>
    )}
  </div>
);
