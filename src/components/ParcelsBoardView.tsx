import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Loader2,
  PackageCheck,
  PackageX,
  RefreshCw,
  Search,
  SearchX,
  Undo2,
  X,
} from 'lucide-react';
import { isParcelOverdue, parcelLossDeadline, parcelStatusHint, parcelStatusLabel } from '../lib/parcelTracking';
import type { ParcelDestination, ParcelStatus, TrackingSettings } from '../lib/parcelTracking';
import { InvoiceWithoutParcel, Parcel, formatDate, setParcelStatus } from './digiApi';
import { PARCEL_STATUS_BADGES } from './InvoiceParcelsPanel';
import { ParcelPhotosModal } from './ParcelPhotosModal';
import { ReceiveParcelModal } from './ReceiveParcelModal';
import { ReceptionPointView } from './ReceptionPointView';

type StatusFilter = 'open' | ParcelStatus | 'all';

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
  /** Supply Chain: confirms receptions, photos, avis de recherche. */
  isSupplyChain: boolean;
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
  isSupplyChain,
}) => {
  const hub = destination === 'ORLY' ? 'Orly' : 'Rouen';
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('open');
  const [supplierFilter, setSupplierFilter] = useState('all');
  const [showWithout, setShowWithout] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [receptionDate, setReceptionDate] = useState(today);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [photosOf, setPhotosOf] = useState<Parcel | null>(null);
  const [receiving, setReceiving] = useState(false);
  const [pointOpen, setPointOpen] = useState(false);

  /** Changes the state of parcels one by one and reports the failures. */
  const changeStatus = async (list: Parcel[], status: ParcelStatus, label: string) => {
    setActionError(null);
    setActionMessage(null);
    const failures: string[] = [];
    for (let i = 0; i < list.length; i++) {
      setBusy(`${label} : ${i + 1} / ${list.length}…`);
      try {
        await setParcelStatus(list[i].id, status, status === 'received' ? receptionDate : null);
      } catch (err: any) {
        failures.push(`${list[i].tracking_number || list[i].supplier_name || list[i].id} (${err.message})`);
      }
    }
    setBusy(null);
    setSelected(new Set());
    if (failures.length > 0) setActionError(`${failures.length} colis non traité(s) : ${failures.join(' ; ')}`);
    if (list.length > failures.length) setActionMessage(`${list.length - failures.length} colis : ${label.toLowerCase()}.`);
    onReload();
  };

  const confirmReception = (list: Parcel[]) => {
    if (!window.confirm(`Confirmer la réception à ${hub} de ${list.length} colis, le ${formatDate(receptionDate)} ?`)) return;
    changeStatus(list, 'received', 'Réception confirmée');
  };

  const openSearch = (p: Parcel) => {
    if (!window.confirm(`Ouvrir un avis de recherche : le colis ${p.tracking_number || ''} a été reçu à ${hub} mais n'est pas arrivé à Madagascar ?`)) return;
    changeStatus([p], 'search', 'Avis de recherche ouvert');
  };

  const declareLost = (p: Parcel) => {
    if (!window.confirm(`Déclarer le colis ${p.tracking_number || ''} perdu avant ${hub} (réclamation fournisseur) ?`)) return;
    changeStatus([p], 'lost', `Déclaré perdu avant ${hub}`);
  };

  const backToReceive = (p: Parcel) => {
    if (!window.confirm(`Remettre le colis ${p.tracking_number || ''} « à recevoir » ? La date de réception est effacée.`)) return;
    changeStatus([p], 'to_receive', 'Remis à recevoir');
  };

  const own = useMemo(() => (parcels || []).filter((p) => p.destination === destination), [parcels, destination]);
  const overdue = (p: Parcel) => isParcelOverdue(p, parcelInvoiceDate(p), today, settings);

  const counts = useMemo(
    () => ({
      to_receive: own.filter((p) => p.status === 'to_receive').length,
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
        if (['received', 'lost', 'search', 'to_receive'].includes(statusFilter) && p.status !== statusFilter) return false;
        if (supplierFilter !== 'all' && (p.supplier_name || '—') !== supplierFilter) return false;
        return parcelMatches(p, search) && parcelMatches(p, globalSearch);
      }),
    [own, statusFilter, supplierFilter, search, globalSearch, settings]
  );

  // Late parcels are turned "lost" by the server when the list is loaded
  const tiles: { key: StatusFilter; label: string; value: number; tone: string }[] = [
    { key: 'open', label: 'À recevoir', value: counts.to_receive, tone: 'text-slate-900 dark:text-white' },
    { key: 'received', label: `Reçus à ${hub}`, value: counts.received, tone: 'text-emerald-600' },
    { key: 'lost', label: `Perdus avant ${hub}`, value: counts.lost, tone: 'text-rose-600' },
    { key: 'search', label: 'Avis de recherche', value: counts.search, tone: 'text-amber-600' },
  ];

  const selectedParcels = filtered.filter((p) => selected.has(p.id));
  const toConfirm = selectedParcels.filter((p) => p.status === 'to_receive' || p.status === 'lost');
  const allSelected = filtered.length > 0 && filtered.every((p) => selected.has(p.id));
  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const columns = 7 + (destination === 'ROUEN' ? 1 : 0) + (isSupplyChain ? 1 : 0) + 1;
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

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {tiles.map((t) => (
          <button
            key={t.key}
            onClick={() => setStatusFilter(t.key)}
            className={`rounded-2xl border bg-white p-3 text-left shadow-xs transition dark:bg-slate-800 ${
              statusFilter === t.key ? 'border-[#623387] ring-1 ring-[#623387]' : 'border-slate-200 dark:border-slate-700'
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
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)} className={selectClass}>
          <option value="open">À recevoir</option>
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

      {isSupplyChain && (selectedParcels.length > 0 || busy) && (
        <div className="sticky top-20 z-10 flex flex-col gap-3 rounded-2xl border border-emerald-300 bg-emerald-50 p-3 shadow-md lg:flex-row lg:items-center dark:border-emerald-900 dark:bg-slate-900">
          <div className="flex flex-1 items-center gap-2 text-xs font-bold text-slate-800 dark:text-slate-100">
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin text-emerald-600" /> {busy}
              </>
            ) : (
              <>
                {selectedParcels.length} colis sélectionné(s)
                <button
                  onClick={() => setSelected(new Set())}
                  title="Tout désélectionner"
                  className="rounded-lg p-1 text-slate-400 hover:bg-white hover:text-slate-700 dark:hover:bg-slate-800"
                >
                  <X className="h-4 w-4" />
                </button>
              </>
            )}
          </div>
          {!busy && (
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300">
                Reçu(s) le
                <input
                  type="date"
                  value={receptionDate}
                  max={today}
                  onChange={(e) => setReceptionDate(e.target.value || today)}
                  className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-800"
                />
              </label>
              <button
                onClick={() => confirmReception(toConfirm)}
                disabled={toConfirm.length === 0}
                className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-[11px] font-bold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-40"
              >
                <CheckCircle2 className="h-3.5 w-3.5" /> Confirmer la réception à {hub} ({toConfirm.length})
              </button>
            </div>
          )}
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-800">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500 dark:bg-slate-900/60 dark:text-slate-400">
              <tr>
                {isSupplyChain && (
                  <th className="w-8 px-3 py-3">
                    <input
                      type="checkbox"
                      aria-label="Sélectionner les colis affichés"
                      checked={allSelected}
                      onChange={() => setSelected(allSelected ? new Set() : new Set(filtered.map((p) => p.id)))}
                      className="h-4 w-4 cursor-pointer accent-emerald-600"
                    />
                  </th>
                )}
                <th className="px-3 py-3">N° de suivi</th>
                <th className="px-3 py-3">Transporteur</th>
                <th className="px-3 py-3">Fournisseur</th>
                <th className="px-3 py-3">Factures</th>
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
                filtered.map((p) => {
                  const late = overdue(p);
                  return (
                    <tr
                      key={p.id}
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
                                className="mr-1 font-mono font-semibold text-[#623387] hover:underline dark:text-[#B688FF]"
                              >
                                {id}
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
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

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
