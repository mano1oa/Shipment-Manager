import React, { useMemo, useState } from 'react';
import { AlertTriangle, Camera, ChevronDown, ChevronRight, Loader2, RefreshCw, Search } from 'lucide-react';
import { isParcelOverdue, parcelLossDeadline, parcelStatusHint, parcelStatusLabel } from '../lib/parcelTracking';
import type { ParcelDestination, ParcelStatus, TrackingSettings } from '../lib/parcelTracking';
import { InvoiceWithoutParcel, Parcel, formatDate } from './digiApi';
import { PARCEL_STATUS_BADGES } from './InvoiceParcelsPanel';

type StatusFilter = 'open' | 'overdue' | ParcelStatus | 'all';

interface Props {
  destination: ParcelDestination;
  parcels: Parcel[] | null;
  invoicesWithoutParcel: InvoiceWithoutParcel[];
  settings: TrackingSettings | undefined;
  loading: boolean;
  error: string | null;
  onReload: () => void;
  /** Search typed in the top bar (applies to both tabs). */
  globalSearch: string;
  onOpenShipment: (shipmentId: string) => void;
}

/** Earliest invoice date of a parcel: start of the loss delay without expected delivery. */
export const parcelInvoiceDate = (p: Parcel) =>
  p.invoices
    .map((i) => i.invoice_date)
    .filter((d): d is string => Boolean(d))
    .sort()[0] ?? null;

export const parcelMatches = (p: Parcel, query: string) => {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [p.tracking_number, p.carrier_name, p.supplier_name, p.notes, p.description, ...p.shipment_ids, ...p.invoices.map((i) => i.ref)]
    .some((v) => v && v.toLowerCase().includes(q));
};

/**
 * Suivi Aérien › Colis vers Orly / Suivi Maritime › Colis vers Rouen: parcels
 * on the way from the suppliers, before their shipment to Madagascar.
 */
export const ParcelsBoardView: React.FC<Props> = ({
  destination,
  parcels,
  invoicesWithoutParcel,
  settings,
  loading,
  error,
  onReload,
  globalSearch,
  onOpenShipment,
}) => {
  const hub = destination === 'ORLY' ? 'Orly' : 'Rouen';
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('open');
  const [supplierFilter, setSupplierFilter] = useState('all');
  const [showWithout, setShowWithout] = useState(false);
  const today = new Date().toISOString().slice(0, 10);

  const own = useMemo(() => (parcels || []).filter((p) => p.destination === destination), [parcels, destination]);
  const overdue = (p: Parcel) => isParcelOverdue(p, parcelInvoiceDate(p), today, settings);

  const counts = useMemo(
    () => ({
      to_receive: own.filter((p) => p.status === 'to_receive').length,
      overdue: own.filter(overdue).length,
      received: own.filter((p) => p.status === 'received').length,
      lost: own.filter((p) => p.status === 'lost').length,
      search: own.filter((p) => p.status === 'search').length,
    }),
    [own, settings]
  );

  const suppliers = useMemo(
    () => Array.from(new Set<string>(own.map((p) => p.supplier_name || '—'))).sort((a, b) => a.localeCompare(b, 'fr')),
    [own]
  );

  const filtered = useMemo(
    () =>
      own.filter((p) => {
        if (statusFilter === 'open' && p.status !== 'to_receive') return false;
        if (statusFilter === 'overdue' && !overdue(p)) return false;
        if (['received', 'lost', 'search', 'to_receive'].includes(statusFilter) && p.status !== statusFilter) return false;
        if (supplierFilter !== 'all' && (p.supplier_name || '—') !== supplierFilter) return false;
        return parcelMatches(p, search) && parcelMatches(p, globalSearch);
      }),
    [own, statusFilter, supplierFilter, search, globalSearch, settings]
  );

  const tiles: { key: StatusFilter; label: string; value: number; tone: string }[] = [
    { key: 'open', label: 'À recevoir', value: counts.to_receive, tone: 'text-slate-900 dark:text-white' },
    { key: 'overdue', label: 'En retard', value: counts.overdue, tone: 'text-rose-600' },
    { key: 'received', label: `Reçus à ${hub}`, value: counts.received, tone: 'text-emerald-600' },
    { key: 'lost', label: `Perdus avant ${hub}`, value: counts.lost, tone: 'text-rose-600' },
    { key: 'search', label: 'Avis de recherche', value: counts.search, tone: 'text-amber-600' },
  ];

  const selectClass =
    'rounded-xl border border-slate-200 bg-slate-50 py-2 px-3 text-xs text-slate-800 focus:border-[#643288] focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100';

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Colis livrés par les fournisseurs {destination === 'ORLY' ? 'chez Antoine à Orly' : 'au quai de Rouen'}, avant
        leur expédition vers Madagascar. Ils se créent depuis Factures fournisseurs (« + Colis ») ; un colis non confirmé
        à temps passe en retard (livraison prévue + {settings?.parcel_loss_days_after_eta ?? 7} j, sinon date de facture
        + {settings?.parcel_loss_days_without_eta ?? 14} j).
      </p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {tiles.map((t) => (
          <button
            key={t.key}
            onClick={() => setStatusFilter(t.key)}
            className={`rounded-2xl border bg-white p-3 text-left shadow-xs transition dark:bg-slate-800 ${
              statusFilter === t.key ? 'border-[#643288] ring-1 ring-[#643288]' : 'border-slate-200 dark:border-slate-700'
            }`}
          >
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{t.label}</div>
            <div className={`mt-1 text-2xl font-extrabold ${t.tone}`}>{t.value}</div>
          </button>
        ))}
      </div>

      {invoicesWithoutParcel.length > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
          <button onClick={() => setShowWithout((v) => !v)} className="flex w-full items-center gap-2 font-bold">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {invoicesWithoutParcel.length} facture(s) en marchandises sans colis : n° de suivi à saisir dans Factures
            fournisseurs (destination encore inconnue).
            {showWithout ? <ChevronDown className="ml-auto h-4 w-4" /> : <ChevronRight className="ml-auto h-4 w-4" />}
          </button>
          {showWithout && (
            <ul className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-2 lg:grid-cols-3">
              {invoicesWithoutParcel.map((i) => (
                <li key={i.id}>
                  <strong>{i.supplier_display || '—'}</strong> · {i.ref || '—'} · {formatDate(i.invoice_date)}
                  {!i.is_digi && ' · hors DIGI'}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-xs lg:flex-row lg:items-center dark:border-slate-800 dark:bg-slate-800">
        <div className="relative min-w-[16rem] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="N° de suivi, fournisseur, facture, expédition…"
            className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-xs text-slate-800 focus:border-[#643288] focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          />
        </div>
        <select value={supplierFilter} onChange={(e) => setSupplierFilter(e.target.value)} className={`max-w-[16rem] ${selectClass}`}>
          <option value="all">Tous les fournisseurs ({suppliers.length})</option>
          {suppliers.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)} className={selectClass}>
          <option value="open">À recevoir</option>
          <option value="overdue">En retard</option>
          <option value="received">Reçus à {hub}</option>
          <option value="lost">Perdus avant {hub}</option>
          <option value="search">Avis de recherche</option>
          <option value="all">Tous les colis</option>
        </select>
        <button
          onClick={onReload}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Actualiser
        </button>
      </div>

      {error && <p className="text-xs font-semibold text-rose-600">{error}</p>}

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-800">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500 dark:bg-slate-900/60 dark:text-slate-400">
              <tr>
                <th className="px-3 py-3">N° de suivi</th>
                <th className="px-3 py-3">Transporteur</th>
                <th className="px-3 py-3">Fournisseur</th>
                <th className="px-3 py-3">Factures</th>
                <th className="px-3 py-3">Livraison prévue</th>
                <th className="px-3 py-3">État</th>
                {destination === 'ROUEN' && <th className="px-3 py-3">Colisage / volume</th>}
                <th className="px-3 py-3">Expédition</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
              {parcels === null || (loading && own.length === 0) ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center">
                    <Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-400" />
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-slate-500">
                    {own.length === 0 ? `Aucun colis vers ${hub}.` : 'Aucun colis ne correspond à vos filtres.'}
                  </td>
                </tr>
              ) : (
                filtered.map((p) => {
                  const late = overdue(p);
                  return (
                    <tr key={p.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-700/30">
                      <td className="px-3 py-2.5 font-mono font-semibold">{p.tracking_number || '— (inconnu)'}</td>
                      <td className="px-3 py-2.5">{p.carrier_name || '—'}</td>
                      <td className="px-3 py-2.5 font-semibold">{p.supplier_name || '—'}</td>
                      <td className="px-3 py-2.5">{p.invoices.map((i) => i.ref || '—').join(', ') || '—'}</td>
                      <td className="px-3 py-2.5">{formatDate(p.expected_delivery)}</td>
                      <td className="px-3 py-2.5">
                        <span
                          title={parcelStatusHint(p.status, p.destination)}
                          className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${PARCEL_STATUS_BADGES[p.status]}`}
                        >
                          {parcelStatusLabel(p.status, p.destination)}
                        </span>
                        {p.status === 'received' && p.received_at && (
                          <span className="ml-1 text-[10px] text-slate-400">le {formatDate(p.received_at)}</span>
                        )}
                        {p.photo_count > 0 && (
                          <span className="ml-1 inline-flex items-center gap-0.5 text-[10px] text-slate-400">
                            <Camera className="h-3 w-3" /> {p.photo_count}
                          </span>
                        )}
                        {late && (
                          <span className="ml-1 rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-700 dark:bg-rose-950 dark:text-rose-300">
                            En retard depuis le{' '}
                            {formatDate(parcelLossDeadline(p.expected_delivery, parcelInvoiceDate(p), settings))}
                          </span>
                        )}
                        {p.notes && <div className="mt-0.5 text-[10px] text-slate-400">{p.notes}</div>}
                      </td>
                      {destination === 'ROUEN' && (
                        <td className="px-3 py-2.5">
                          {[p.delivery_type, p.packing_info, p.volume_m3 != null ? `${p.volume_m3} m³` : null]
                            .filter(Boolean)
                            .join(' · ') || '—'}
                        </td>
                      )}
                      <td className="px-3 py-2.5">
                        {p.shipment_ids.length === 0
                          ? '—'
                          : p.shipment_ids.map((id) => (
                              <button
                                key={id}
                                onClick={() => onOpenShipment(id)}
                                className="mr-1 font-mono font-semibold text-[#643288] hover:underline dark:text-purple-300"
                              >
                                {id}
                              </button>
                            ))}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
