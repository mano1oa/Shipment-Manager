import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Combine,
  Layers,
  Loader2,
  PackageCheck,
  PackageX,
  RefreshCw,
  Search,
  SearchX,
  Undo2,
  X,
  Download,
} from 'lucide-react';
import { isParcelOverdue, parcelLossDeadline, parcelStatusHint, parcelStatusLabel } from '../lib/parcelTracking';
import type { ParcelDestination, ParcelStatus, TrackingSettings } from '../lib/parcelTracking';
import { compareDateDesc } from '../lib/dateFormat';
import { InvoiceWithoutParcel, Parcel, formatDate } from './digiApi';
import { BoxesBadge } from './BoxesBadge';
import { AmazonPendingBanner } from './AmazonPendingBanner';
import { MergeParcelModal } from './MergeParcelModal';
import { findMergeSuspects } from '../lib/parcelBoxes';
import { ParcelContentsPreview } from './ParcelContentsPreview';
import { PARCEL_STATUS_BADGES } from './InvoiceParcelsPanel';
import { ParcelPhotosModal } from './ParcelPhotosModal';
import { ReceiveParcelModal } from './ReceiveParcelModal';
import { ReceptionPointView } from './ReceptionPointView';
import { useParcelStatusActions } from './useParcelStatusActions';
import { Shipment, shipmentLabel } from '../types';
import DateInput from './DateInput';
import { Pagination, usePagination } from './Pagination';
import { SavedFilters } from './SavedFilters';
import { downloadCsv } from '../lib/exportCsv';

type StatusFilter = 'open' | ParcelStatus | 'no_invoice' | 'all';
/** Filters kept by « Mes filtres ». */
type ParcelFilters = { status: StatusFilter; supplier: string; search: string; receivedOn: string };

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
  /** Shipments, to show the Réf FA DIGI-NXT of each parcel's shipment. */
  shipments: Shipment[];
  /** Supply Chain: confirms receptions, photos, avis de recherche. */
  isSupplyChain: boolean;
  /** Supply Chain: new shipment to Madagascar with these invoices pre-checked. */
  onGroupInShipment?: (invoiceIds: string[]) => void;
}

/** Invoices of the parcels not yet in a shipment, to group them into a new one. */
const invoicesToShip = (list: Parcel[]) =>
  Array.from(new Set(list.filter((p) => p.shipment_ids.length === 0).flatMap((p) => p.invoices.map((i) => i.id))));

/** Earliest invoice date of a parcel: start of the loss delay without expected delivery. */
export const parcelInvoiceDate = (p: Parcel) =>
  p.invoices
    .map((i) => i.invoice_date)
    .filter((d): d is string => Boolean(d))
    .sort()[0] ?? null;

/** Amazon orders of the parcel's invoices, once each (lets the buyers find their order). */
export const parcelAmazonOrders = (p: Parcel): string[] =>
  Array.from(new Set(p.invoices.map((i) => i.amazon_order_ref?.trim()).filter((v): v is string => Boolean(v))));

/** "Commande Amazon" cell of the parcel tables (Suivi aérien). */
export const AmazonOrdersCell: React.FC<{ parcel: Parcel }> = ({ parcel }) => {
  const orders = parcelAmazonOrders(parcel);
  return (
    <td className="px-3 py-2.5 font-mono text-[11px]">
      {orders.length === 0 ? '—' : orders.map((o) => <div key={o}>{o}</div>)}
    </td>
  );
};

export const parcelMatches = (p: Parcel, query: string) => {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  // Other numbers (supplier, carrier, box) find the parcel too, typed with or without spaces;
  // the reception date as shown (03-11-2026)
  const compactQ = q.replace(/[^a-z0-9]/g, '');
  const numbers = (p.numbers || []).map((n) => n.number);
  const receivedOn = p.received_at ? formatDate(p.received_at) : null;
  return (
    [p.tracking_number, p.carrier_name, p.supplier_name, p.notes, p.description, receivedOn, ...numbers, ...p.shipment_ids, ...p.invoices.map((i) => i.ref), ...parcelAmazonOrders(p)].some(
      (v) => v && v.toLowerCase().includes(q)
    ) ||
    (compactQ.length >= 4 &&
      [p.tracking_number, ...numbers].some((v) => v && v.toLowerCase().replace(/[^a-z0-9]/g, '').includes(compactQ)))
  );
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
  shipments,
  isSupplyChain,
  onGroupInShipment,
}) => {
  const shipmentById = useMemo(() => new Map(shipments.map((s) => [s.id, s])), [shipments]);
  const hub = destination === 'ORLY' ? 'Orly' : 'Rouen';
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('open');
  const [supplierFilter, setSupplierFilter] = useState('all');
  const [showWithout, setShowWithout] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [receptionDate, setReceptionDate] = useState(today);
  const [photosOf, setPhotosOf] = useState<Parcel | null>(null);
  const [receiving, setReceiving] = useState(false);
  const [pointOpen, setPointOpen] = useState(false);
  /** Parcel whose contents are shown under its row. */
  const [openId, setOpenId] = useState<string | null>(null);
  /** "Fusionner dans le colis principal…": the parcel to merge, and the main parcel proposed. */
  const [mergeOf, setMergeOf] = useState<{ parcel: Parcel; principalId: string | null } | null>(null);
  const [showSuspects, setShowSuspects] = useState(false);
  /** Received: only the parcels received on this date ('' = every date). */
  const [receivedOn, setReceivedOn] = useState('');
  /** Date groups opened or closed by hand (by default only the latest one is open). */
  const [toggledGroups, setToggledGroups] = useState<Set<string>>(new Set());
  const toggleGroup = (key: string) =>
    setToggledGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const { busy, actionError, actionMessage, setActionMessage, openSearch, declareLost, backToReceive, ...actions } =
    useParcelStatusActions(hub, onReload, () => setSelected(new Set()));
  const confirmReception = (list: Parcel[]) => actions.confirmReception(list, receptionDate);

  const own = useMemo(() => (parcels || []).filter((p) => p.destination === destination), [parcels, destination]);
  const overdue = (p: Parcel) => isParcelOverdue(p, parcelInvoiceDate(p), today, settings);

  const counts = useMemo(
    () => ({
      to_receive: own.filter((p) => p.status === 'to_receive').length,
      received: own.filter((p) => p.status === 'received').length,
      lost: own.filter((p) => p.status === 'lost').length,
      search: own.filter((p) => p.status === 'search').length,
      no_invoice: own.filter((p) => p.invoices.length === 0).length,
    }),
    [own, settings]
  );

  // A lost parcel and parcels created at a point for the same invoice: probably boxes of one shipment
  const suspects = useMemo(() => (isSupplyChain ? findMergeSuspects(own) : []), [own, isSupplyChain]);

  const suppliers = useMemo(
    () => Array.from(new Set<string>(own.map((p) => p.supplier_name || '—'))).sort((a, b) => a.localeCompare(b, 'fr')),
    [own]
  );

  const filtered = useMemo(
    () =>
      own.filter((p) => {
        if (statusFilter === 'open' && p.status !== 'to_receive') return false;
        if (['received', 'lost', 'search', 'to_receive'].includes(statusFilter) && p.status !== statusFilter) return false;
        if (statusFilter === 'no_invoice' && p.invoices.length > 0) return false;
        if (statusFilter === 'received' && receivedOn && p.received_at !== receivedOn) return false;
        if (supplierFilter !== 'all' && (p.supplier_name || '—') !== supplierFilter) return false;
        return parcelMatches(p, search) && parcelMatches(p, globalSearch);
      })
        // Latest expected delivery first (received: latest reception first)
        .sort(
          (a, b) =>
            (statusFilter === 'received' ? compareDateDesc(a.received_at, b.received_at) : 0) ||
            compareDateDesc(a.expected_delivery, b.expected_delivery)
        ),
    [own, statusFilter, supplierFilter, search, globalSearch, settings, receivedOn]
  );

  // Pages of 80 / 100 / 200 rows, or everything (remembered per hub)
  const pager = usePagination(filtered, `parcels-${destination}`, `${statusFilter}|${supplierFilter}|${search}|${globalSearch}|${receivedOn}`);
  const shown = pager.pageItems;

  // Received at the hub: one group per reception date, to ship them together
  const rowGroups = useMemo(() => {
    if (statusFilter !== 'received') return [{ date: null as string | null, grouped: false, parcels: shown }];
    const groups: { date: string | null; grouped: boolean; parcels: Parcel[] }[] = [];
    for (const p of shown) {
      const last = groups[groups.length - 1];
      if (last && last.date === (p.received_at ?? null)) last.parcels.push(p);
      else groups.push({ date: p.received_at ?? null, grouped: true, parcels: [p] });
    }
    return groups;
  }, [shown, statusFilter]);

  // Late parcels are turned "lost" by the server when the list is loaded
  const tiles: { key: StatusFilter; label: string; value: number; dot: string }[] = [
    { key: 'open', label: 'À recevoir', value: counts.to_receive, dot: 'bg-[#9A93A5]' },
    { key: 'received', label: `Reçus à ${hub}`, value: counts.received, dot: 'bg-[#2E9E5B]' },
    { key: 'lost', label: `Perdus avant ${hub}`, value: counts.lost, dot: 'bg-[#D9534F]' },
    { key: 'search', label: 'Avis de recherche', value: counts.search, dot: 'bg-[#E8A33D]' },
    { key: 'all', label: 'Tous les colis', value: own.length, dot: 'bg-[#623387]' },
  ];

  /** « Exporter »: every parcel of the current filter, all pages. */
  const exportParcels = () =>
    downloadCsv(
      `colis-${hub.toLowerCase()}`,
      ['N° de suivi', 'Transporteur', 'Fournisseur', 'Factures', 'Commande Amazon', 'Statut', 'Livraison prévue', 'Reçu le', 'Reçu par', 'Expédition(s)'],
      filtered.map((p) => [
        p.tracking_number,
        p.carrier_name || (p.carrier !== 'UNKNOWN' ? p.carrier : ''),
        p.supplier_name,
        p.invoices.map((i) => i.ref || '—').join(', '),
        p.invoices.map((i) => i.amazon_order_ref).filter(Boolean).join(', '),
        parcelStatusLabel(p.status, destination),
        formatDate(p.expected_delivery),
        formatDate(p.received_at),
        p.received_by_email,
        p.shipment_ids.map((id) => shipmentLabel(shipmentById.get(id), id)).join(', '),
      ])
    );

  const selectedParcels = filtered.filter((p) => selected.has(p.id));
  const toConfirm = selectedParcels.filter((p) => p.status === 'to_receive' || p.status === 'lost');
  const allSelected = shown.length > 0 && shown.every((p) => selected.has(p.id));
  const toShip = invoicesToShip(selectedParcels.filter((p) => p.status === 'received'));
  const toggleMany = (list: Parcel[], on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      list.forEach((p) => (on ? next.add(p.id) : next.delete(p.id)));
      return next;
    });
  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const columns = 7 + (destination === 'ROUEN' ? 1 : 0) + (destination === 'ORLY' ? 1 : 0) + (isSupplyChain ? 1 : 0) + 1;
  const iconButton =
    'rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-100 disabled:opacity-40 dark:hover:bg-slate-700';

  const selectClass =
    'rounded-xl border border-slate-200 bg-slate-50 py-2 px-3 text-xs text-slate-800 focus:border-[#623387] focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100';

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Colis livrés par les fournisseurs {destination === 'ORLY' ? 'chez Antoine à Orly' : 'au quai de Rouen'}, avant
          leur expédition vers Madagascar. Ils se créent depuis Factures fournisseurs (« + Colis »). Un colis non confirmé
          à temps passe automatiquement « Perdu avant {hub} » (livraison prévue +{' '}
          {settings?.parcel_loss_days_after_eta ?? 7} j, sinon date de facture +{' '}
          {settings?.parcel_loss_days_without_eta ?? 14} j) et apparaît dans les alertes.
          {isSupplyChain &&
            (destination === 'ORLY'
              ? ' Au point avec Antoine : « Point Antoine » pour déposer toutes ses photos puis les rattacher (la réception est confirmée) ; les colis confirmés sans photo se cochent ici.'
              : ' Cochez les colis reçus au quai et confirmez leur réception.')}
        </p>
        {isSupplyChain && (
          <div className="flex shrink-0 flex-wrap gap-2">
            <button
              onClick={() => setPointOpen(true)}
              title="Déposer toutes les photos du point, puis les rattacher une à une (confirme les réceptions)"
              className="flex items-center gap-1.5 rounded-xl bg-[#623387] px-3 py-2 text-xs font-bold text-white hover:bg-[#522870]"
            >
              <Camera className="h-4 w-4" /> {destination === 'ORLY' ? 'Point Antoine (photos)' : 'Réception Rouen (photos)'}
            </button>
            <button
              onClick={() => setReceiving(true)}
              title="Colis confirmé sans photo et sans n° de suivi saisi"
              className="flex items-center gap-1.5 rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700 hover:bg-emerald-100 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300"
            >
              <PackageCheck className="h-4 w-4" /> Colis reçu non annoncé
            </button>
          </div>
        )}
      </div>

      {actionError && <p className="text-xs font-semibold text-rose-600">{actionError}</p>}
      {actionMessage && <p className="text-xs font-semibold text-emerald-600">{actionMessage}</p>}

      {/* Status filters (same as the « Statut » list below) */}
      <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrer par statut">
        {tiles.map((t) => {
          const on = statusFilter === t.key;
          return (
            <button
              key={t.key}
              type="button"
              aria-pressed={on}
              onClick={() => setStatusFilter(t.key)}
              className={`flex h-10 items-center gap-2 rounded-full border px-4 text-[13px] font-semibold transition ${
                on
                  ? 'border-[#1E1229] bg-[#1E1229] text-white dark:border-white dark:bg-white dark:text-[#1E1229]'
                  : 'border-[#E1DDE7] bg-white text-[#3A3444] hover:border-[#C9B6DD] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'
              }`}
            >
              <span className={`h-2 w-2 rounded-full ${on ? 'bg-current' : t.dot}`} />
              {t.label}
              <span className="tabular-nums font-medium opacity-80">{t.value}</span>
            </button>
          );
        })}
      </div>

      {suspects.length > 0 && (
        <div className="rounded-2xl border border-sky-200 bg-sky-50 p-3 text-xs text-sky-900 dark:border-sky-900/60 dark:bg-sky-950/30 dark:text-sky-200">
          <button onClick={() => setShowSuspects((v) => !v)} className="flex w-full items-center gap-2 text-left font-bold">
            <Combine className="h-4 w-4 shrink-0" />
            Colis à fusionner ? {suspects.length} facture(s) ont un colis perdu et des colis créés au point (même fournisseur,
            même transporteur) : ce sont peut-être les boîtes d'un même envoi.
            {showSuspects ? <ChevronDown className="ml-auto h-4 w-4" /> : <ChevronRight className="ml-auto h-4 w-4" />}
          </button>
          {showSuspects && (
            <ul className="mt-2 space-y-2">
              {suspects.map((s) => (
                <li key={`${s.invoice_id}-${s.principal.id}`} className="rounded-xl bg-white/70 p-2 dark:bg-slate-900/40">
                  <div>
                    Facture <strong>{s.invoice_ref || '—'}</strong> · {s.principal.supplier_name || '—'} · perdu :{' '}
                    <span className="font-mono font-bold">{s.principal.tracking_number || 'sans n°'}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {s.boxes.map((b) => (
                      <button
                        key={b.id}
                        onClick={() => setMergeOf({ parcel: b, principalId: s.principal.id })}
                        className="flex items-center gap-1 rounded-lg border border-sky-300 bg-white px-2 py-1 font-semibold hover:bg-sky-100 dark:border-sky-800 dark:bg-slate-900"
                      >
                        <Combine className="h-3.5 w-3.5" /> Fusionner{' '}
                        <span className="font-mono">{b.tracking_number || 'sans n°'}</span>
                        {b.received_at ? ` (reçu le ${formatDate(b.received_at)})` : ''}
                      </button>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {counts.no_invoice > 0 && statusFilter !== 'no_invoice' && (
        <button
          onClick={() => setStatusFilter('no_invoice')}
          className="flex w-full items-center gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-left text-xs font-bold text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {counts.no_invoice} colis reçu(s) sans facture : la facture leur sera rattachée quand elle sera saisie avec
          leur n° (« + Colis ») ou par « Importer Excel » › Expéditions (rapport Amazon). Voir la liste
          <ChevronRight className="ml-auto h-4 w-4" />
        </button>
      )}

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

      <AmazonPendingBanner destination={destination} refreshKey={parcels} canEdit={isSupplyChain} />

      <SavedFilters<ParcelFilters>
        storageKey={`parcels-${destination}`}
        current={{ status: statusFilter, supplier: supplierFilter, search, receivedOn }}
        isDefault={statusFilter === 'open' && supplierFilter === 'all' && !search.trim() && !receivedOn}
        equals={(a, b) => a.status === b.status && a.supplier === b.supplier && a.search === b.search && a.receivedOn === b.receivedOn}
        onApply={(f) => {
          setStatusFilter(f.status);
          setSupplierFilter(f.supplier);
          setSearch(f.search);
          setReceivedOn(f.receivedOn);
        }}
      />

      <div className="flex flex-col gap-3 rounded-2xl border border-[#E7E4EC] bg-white p-4 lg:flex-row lg:items-center dark:border-slate-800 dark:bg-slate-900">
        <div className="relative min-w-0 flex-1 sm:min-w-[16rem]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="N° de suivi, fournisseur, facture, expédition…"
            className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-xs text-slate-800 focus:border-[#623387] focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
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
        {statusFilter === 'received' && (
          <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300">
            Reçus le
            <DateInput
              value={receivedOn}
              wrapperClassName="w-36"
              max={today}
              onChange={(v) => setReceivedOn(v || '')}
              className={selectClass}
            />
            {receivedOn && (
              <button
                onClick={() => setReceivedOn('')}
                title="Toutes les dates"
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-700"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </label>
        )}
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)} className={selectClass}>
          <option value="open">À recevoir</option>
          <option value="received">Reçus à {hub}</option>
          <option value="lost">Perdus avant {hub}</option>
          <option value="search">Avis de recherche</option>
          <option value="no_invoice">Reçus sans facture</option>
          <option value="all">Tous les colis</option>
        </select>
        <button
          onClick={onReload}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Actualiser
        </button>
        <button
          type="button"
          onClick={exportParcels}
          disabled={filtered.length === 0}
          title="Tous les colis du filtre en cours (toutes les pages), en fichier Excel"
          className="flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300"
        >
          <Download className="h-3.5 w-3.5" /> Exporter ({filtered.length})
        </button>
      </div>

      {error && <p className="text-xs font-semibold text-rose-600">{error}</p>}

      {isSupplyChain && (selectedParcels.length > 0 || busy) && (
        <div className="sticky top-2 z-10 flex flex-col gap-3 rounded-2xl bg-[#1E1229] p-3 pl-4 text-white shadow-lg lg:flex-row lg:items-center">
          <div className="flex flex-1 items-center gap-2 text-sm font-semibold">
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin text-[#62D18F]" /> {busy}
              </>
            ) : (
              <>
                {selectedParcels.length} colis sélectionné(s)
                <button
                  onClick={() => setSelected(new Set())}
                  title="Tout désélectionner"
                  aria-label="Tout désélectionner"
                  className="rounded-lg p-1.5 text-white/70 hover:bg-white/10 hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              </>
            )}
          </div>
          {!busy && (
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1.5 text-xs font-semibold text-white/80">
                Reçu(s) le
                <DateInput
                  value={receptionDate}
                  wrapperClassName="w-36"
                  max={today}
                  onChange={(v) => setReceptionDate(v || today)}
                  className="rounded-lg border border-white/20 bg-white px-2 py-1.5 text-xs text-[#17111F]"
                />
              </label>
              <button
                onClick={() => confirmReception(toConfirm)}
                disabled={toConfirm.length === 0}
                className="flex items-center gap-1.5 rounded-lg bg-[#2E9E5B] px-3 py-2 text-xs font-semibold text-white hover:bg-[#268a4f] disabled:opacity-40"
              >
                <CheckCircle2 className="h-3.5 w-3.5" /> Confirmer la réception à {hub} ({toConfirm.length})
              </button>
              {onGroupInShipment && (
                <button
                  onClick={() => onGroupInShipment(toShip)}
                  disabled={toShip.length === 0}
                  title="Nouvelle expédition vers Madagascar avec les factures des colis reçus cochés (pas encore expédiés)"
                  className="flex items-center gap-1.5 rounded-lg bg-[#623387] px-3 py-2 text-xs font-semibold text-white hover:bg-[#7340a0] disabled:opacity-40"
                >
                  <Layers className="h-3.5 w-3.5" /> Regrouper en expédition ({toShip.length} facture(s))
                </button>
              )}
            </div>
          )}
        </div>
      )}

      <Pagination
        page={pager.page}
        pageCount={pager.pageCount}
        size={pager.size}
        total={pager.total}
        onPage={pager.setPage}
        onSize={pager.setSize}
        unit="colis"
      />

      <div className="overflow-hidden rounded-2xl border border-[#E7E4EC] bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#FAF9FB] text-[11px] font-medium text-[#5E5869] dark:bg-slate-800/60 dark:text-slate-400">
              <tr>
                {isSupplyChain && (
                  <th className="w-8 px-3 py-3">
                    <input
                      type="checkbox"
                      aria-label="Sélectionner les colis affichés"
                      checked={allSelected}
                      onChange={() => toggleMany(shown, !allSelected)}
                      className="h-4 w-4 cursor-pointer accent-emerald-600"
                    />
                  </th>
                )}
                <th className="px-3 py-3">N° de suivi</th>
                <th className="px-3 py-3">Transporteur</th>
                <th className="px-3 py-3">Fournisseur</th>
                <th className="px-3 py-3">Factures</th>
                {destination === 'ORLY' && <th className="px-3 py-3">Commande Amazon</th>}
                <th className="px-3 py-3">Livraison prévue</th>
                <th className="px-3 py-3">État</th>
                {destination === 'ROUEN' && <th className="px-3 py-3">Colisage / volume</th>}
                <th className="px-3 py-3">Expédition</th>
                <th className="px-3 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
              {parcels === null || (loading && own.length === 0) ? (
                <tr>
                  <td colSpan={columns} className="px-4 py-10 text-center">
                    <Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-400" />
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={columns} className="px-4 py-10 text-center text-slate-500">
                    {own.length === 0 ? `Aucun colis vers ${hub}.` : 'Aucun colis ne correspond à vos filtres.'}
                  </td>
                </tr>
              ) : (
                rowGroups.map((g, groupIndex) => {
                  const groupSelected = g.parcels.every((p) => selected.has(p.id));
                  const groupToShip = invoicesToShip(g.parcels);
                  const groupKey = g.date ?? 'none';
                  // Latest date open by default; a search or a date filter opens every group shown
                  const filteredView = Boolean(receivedOn || search.trim() || globalSearch.trim());
                  const groupOpen =
                    !g.grouped || filteredView || (groupIndex === 0) !== toggledGroups.has(groupKey);
                  return (
                  <React.Fragment key={groupKey}>
                  {g.grouped && (
                    <tr
                      onClick={() => !filteredView && toggleGroup(groupKey)}
                      className={`bg-slate-50 dark:bg-slate-900/50 ${filteredView ? '' : 'cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-900'}`}
                    >
                      {isSupplyChain && (
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            aria-label={`Sélectionner les colis reçus le ${formatDate(g.date)}`}
                            checked={groupSelected}
                            onChange={() => toggleMany(g.parcels, !groupSelected)}
                            onClick={(e) => e.stopPropagation()}
                            className="h-4 w-4 cursor-pointer accent-emerald-600"
                          />
                        </td>
                      )}
                      <td colSpan={columns - (isSupplyChain ? 1 : 0)} className="px-3 py-2">
                        <div className="flex flex-wrap items-center gap-2">
                          {!filteredView &&
                            (groupOpen ? (
                              <ChevronDown className="h-4 w-4 text-slate-400" />
                            ) : (
                              <ChevronRight className="h-4 w-4 text-slate-400" />
                            ))}
                          <span className="text-[11px] font-extrabold text-slate-800 dark:text-slate-100">
                            {g.date ? `Reçus le ${formatDate(g.date)}` : 'Date de réception inconnue'}
                          </span>
                          <span className="text-[11px] text-slate-500">
                            {g.parcels.length} colis · {g.parcels.filter((p) => p.shipment_ids.length === 0).length} à expédier
                          </span>
                          {onGroupInShipment && groupToShip.length > 0 && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onGroupInShipment(groupToShip);
                              }}
                              title="Nouvelle expédition vers Madagascar avec les factures de ces colis (pas encore expédiés)"
                              className="ml-auto flex items-center gap-1 rounded-lg border border-[#623387]/40 px-2 py-1 text-[11px] font-bold text-[#623387] hover:bg-[#F8EEFF] dark:text-[#C09BE3] dark:hover:bg-purple-950/40"
                            >
                              <Layers className="h-3.5 w-3.5" /> Créer l’expédition ({groupToShip.length} facture(s))
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                  {(groupOpen ? g.parcels : []).map((p) => {
                  const late = overdue(p);
                  return (
                    <React.Fragment key={p.id}>
                    <tr
                      className={
                        selected.has(p.id)
                          ? 'bg-emerald-50/70 dark:bg-emerald-950/20'
                          : 'hover:bg-slate-50/80 dark:hover:bg-slate-700/30'
                      }
                    >
                      {isSupplyChain && (
                        <td className="px-3 py-2.5">
                          <input
                            type="checkbox"
                            aria-label={`Sélectionner le colis ${p.tracking_number || ''}`}
                            checked={selected.has(p.id)}
                            onChange={() => toggleOne(p.id)}
                            className="h-4 w-4 cursor-pointer accent-emerald-600"
                          />
                        </td>
                      )}
                      <td className="px-3 py-2.5 font-mono font-semibold">
                        <button
                          onClick={() => setOpenId(openId === p.id ? null : p.id)}
                          title={openId === p.id ? 'Masquer le contenu' : 'Voir le contenu de la facture / du colis'}
                          aria-expanded={openId === p.id}
                          className="mr-1 rounded p-0.5 align-middle text-slate-400 hover:bg-slate-100 hover:text-[#623387] dark:hover:bg-slate-700"
                        >
                          {openId === p.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </button>
                        {p.tracking_number || '— (inconnu)'}
                      </td>
                      <td className="px-3 py-2.5">{p.carrier_name || '—'}</td>
                      <td className="px-3 py-2.5 font-semibold">{p.supplier_name || '—'}</td>
                      <td className="px-3 py-2.5">
                        {p.invoices.length === 0 ? (
                          <span
                            title="Facture pas encore en base : rattachée par « + Colis » avec ce n° ou par l’import Amazon"
                            className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                          >
                            Sans facture
                          </span>
                        ) : (
                          p.invoices.map((i) => i.ref || '—').join(', ')
                        )}
                      </td>
                      {destination === 'ORLY' && <AmazonOrdersCell parcel={p} />}
                      <td className="px-3 py-2.5">{formatDate(p.expected_delivery)}</td>
                      <td className="px-3 py-2.5">
                        <span
                          title={parcelStatusHint(p.status, p.destination)}
                          className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${PARCEL_STATUS_BADGES[p.status]}`}
                        >
                          {parcelStatusLabel(p.status, p.destination)}
                        </span>{' '}
                        <BoxesBadge parcel={p} />
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
                                className="mr-1 font-mono font-semibold text-[#623387] hover:underline dark:text-[#B688FF]"
                              >
                                {shipmentLabel(shipmentById.get(id), id)}
                              </button>
                            ))}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex justify-end gap-0.5">
                          <button
                            onClick={() => setPhotosOf(p)}
                            title="Voir les photos"
                            className={`${iconButton} hover:text-[#623387]`}
                          >
                            <Camera className="h-4 w-4" />
                          </button>
                          {isSupplyChain && (p.status === 'to_receive' || p.status === 'lost') && (
                            <button
                              onClick={() => confirmReception([p])}
                              disabled={busy !== null}
                              title={`Reçu à ${hub} le ${formatDate(receptionDate)}`}
                              className={`${iconButton} text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/40`}
                            >
                              <CheckCircle2 className="h-4 w-4" />
                            </button>
                          )}
                          {isSupplyChain && p.status === 'received' && (
                            <button
                              onClick={() => openSearch(p)}
                              disabled={busy !== null}
                              title="Avis de recherche : reçu mais absent à l'arrivée à Madagascar"
                              className={`${iconButton} text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/40`}
                            >
                              <SearchX className="h-4 w-4" />
                            </button>
                          )}
                          {isSupplyChain && p.status === 'to_receive' && (
                            <button
                              onClick={() => declareLost(p)}
                              disabled={busy !== null}
                              title={`Déclarer perdu avant ${hub}`}
                              className={`${iconButton} text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40`}
                            >
                              <PackageX className="h-4 w-4" />
                            </button>
                          )}
                          {isSupplyChain && p.status !== 'to_receive' && (
                            <button
                              onClick={() => backToReceive(p)}
                              disabled={busy !== null}
                              title="Remettre à recevoir"
                              className={`${iconButton} hover:text-[#623387]`}
                            >
                              <Undo2 className="h-4 w-4" />
                            </button>
                          )}
                          {isSupplyChain && p.status !== 'search' && (
                            <button
                              onClick={() => setMergeOf({ parcel: p, principalId: null })}
                              disabled={busy !== null}
                              title="Fusionner dans le colis principal… (boîte d'un envoi de plusieurs boîtes, créée à part)"
                              className={`${iconButton} hover:text-[#623387]`}
                            >
                              <Combine className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {openId === p.id && (
                      <tr>
                        <td colSpan={columns} className="p-0">
                          <ParcelContentsPreview parcel={p} />
                        </td>
                      </tr>
                    )}
                    </React.Fragment>
                  );
                  })}
                  </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Pagination
        page={pager.page}
        pageCount={pager.pageCount}
        size={pager.size}
        total={pager.total}
        onPage={pager.setPage}
        onSize={pager.setSize}
        unit="colis"
      />

      {mergeOf && (
        <MergeParcelModal
          merged={mergeOf.parcel}
          parcels={own}
          initialPrincipalId={mergeOf.principalId}
          onClose={() => setMergeOf(null)}
          onMerged={(principal) => {
            setActionMessage(
              `Colis ${mergeOf.parcel.tracking_number || 'sans n°'} fusionné dans ${principal.tracking_number || 'le colis principal'} : ${
                principal.boxes.length
              } boîte(s) reçue(s)${principal.boxes_expected ? ` sur ${principal.boxes_expected}` : ''}.`
            );
            setMergeOf(null);
            onReload();
          }}
        />
      )}

      {photosOf && (
        <ParcelPhotosModal
          parcel={photosOf}
          canEdit={isSupplyChain}
          onClose={() => setPhotosOf(null)}
          onChanged={onReload}
        />
      )}

      {receiving && (
        <ReceiveParcelModal
          destination={destination}
          onClose={() => setReceiving(false)}
          onSaved={(parcel) => {
            setReceiving(false);
            setActionMessage(`Colis ${parcel.tracking_number || 'sans n° de suivi'} enregistré comme reçu à ${hub}.`);
            onReload();
          }}
        />
      )}

      {pointOpen && (
        <ReceptionPointView
          destination={destination}
          parcels={parcels || []}
          onClose={() => {
            setPointOpen(false);
            onReload();
          }}
          onChanged={onReload}
        />
      )}
    </div>
  );
};
