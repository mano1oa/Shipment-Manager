import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, AlertTriangle, Layers, Loader2, Search, X } from 'lucide-react';
import { Shipment } from '../types';
import {
  DigiInvoice,
  GroupingResult,
  NotReceivedInvoice,
  addInvoicesToShipment,
  createShipmentFromInvoices,
  fetchDigiInvoices,
  formatAmount,
  formatDate,
  inputClass,
  isGoodsInvoice,
  isInvoiceReceived,
} from './digiApi';

interface Props {
  mode: 'Air' | 'Sea';
  /** Adds invoices to this shipment; absent = new shipment. */
  shipment?: Shipment | null;
  /** Every shipment: invoices of a shipment "to review" (former model) can be regrouped. */
  shipments: Shipment[];
  onClose: () => void;
  /** emptied: former shipments left without invoice (to delete). */
  onDone: (shipmentId: string, emptied: string[]) => void;
}

const supplierOf = (inv: DigiInvoice) => inv.supplier_display || '—';

/**
 * Supply Chain: groups invoices received at the hub into the shipment to
 * Madagascar (one sale invoice = Réf FA DIGI-NXT). Invoices whose parcels are
 * not all confirmed received need an explicit exception.
 */
export const ShipmentInvoicesModal: React.FC<Props> = ({ mode, shipment, shipments, onClose, onDone }) => {
  const hub = mode === 'Air' ? 'Orly' : 'Rouen';
  const [invoices, setInvoices] = useState<DigiInvoice[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [onlyReceived, setOnlyReceived] = useState(true);
  const [search, setSearch] = useState('');
  const [refFa, setRefFa] = useState('');
  const [blAwb, setBlAwb] = useState('');
  const [carrier, setCarrier] = useState('');
  const [remarks, setRemarks] = useState('');
  const [exception, setException] = useState<NotReceivedInvoice[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchDigiInvoices()
      .then(setInvoices)
      .catch((err) => setError(err.message));
  }, []);

  const shipmentById = useMemo(() => new Map(shipments.map((s) => [s.id, s])), [shipments]);

  /** Free = no shipment, a deleted one, or a shipment "to review" of the former model. */
  const inOtherShipment = (inv: DigiInvoice) => {
    if (!inv.shipment_id || !inv.shipment_exists) return null;
    if (inv.shipment_id === shipment?.id) return inv.shipment_id;
    return shipmentById.get(inv.shipment_id)?.needs_review ? null : inv.shipment_id;
  };

  const candidates = useMemo(
    () =>
      (invoices || []).filter(
        (inv) =>
          isGoodsInvoice(inv) &&
          inv.validation_status !== 'rejected' &&
          !inOtherShipment(inv) &&
          inv.shipment_id !== shipment?.id
      ),
    [invoices, shipmentById, shipment?.id]
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return candidates.filter((inv) => {
      if (onlyReceived && !isInvoiceReceived(inv)) return false;
      if (!q) return true;
      return [inv.ref, inv.supplier_display, inv.supplier_name, inv.amazon_order_ref, inv.buyer].some(
        (v) => v && v.toLowerCase().includes(q)
      );
    });
  }, [candidates, onlyReceived, search]);

  const groups = useMemo(() => {
    const map = new Map<string, DigiInvoice[]>();
    visible.forEach((inv) => map.set(supplierOf(inv), [...(map.get(supplierOf(inv)) || []), inv]));
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b, 'fr'));
  }, [visible]);

  const toggle = (ids: string[], on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => (on ? next.add(id) : next.delete(id)));
      return next;
    });

  const selectedInvoices = candidates.filter((i) => selected.has(i.id));
  const selectable = (inv: DigiInvoice) => inv.validation_status === 'validated';

  const submit = async (force: boolean) => {
    setError(null);
    if (selectedInvoices.length === 0) {
      setError('Cochez les factures de l\'expédition.');
      return;
    }
    if (!shipment && !refFa.trim()) {
      setError('La réf FA DIGI-NXT (facture de vente) est obligatoire.');
      return;
    }
    setSaving(true);
    try {
      const ids = selectedInvoices.map((i) => i.id);
      const result: GroupingResult = shipment
        ? await addInvoicesToShipment(shipment.id, ids, force)
        : await createShipmentFromInvoices({
            mode,
            ref_fa_digi_nxt: refFa,
            bl_awb: blAwb,
            carrier,
            remarks,
            invoice_ids: ids,
            force,
          });
      if ('needsException' in result) setException(result.needsException);
      else if ('shipment' in result) onDone(result.shipment.id, result.emptied);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const label = 'font-semibold text-slate-700 dark:text-slate-300';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-900/60 p-4 backdrop-blur-xs">
      <div className="my-8 w-full max-w-4xl rounded-3xl border border-slate-200 bg-white p-6 text-xs shadow-2xl dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-100 pb-4 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#623387] text-white shadow-sm">
              <Layers className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-extrabold text-slate-900 dark:text-white">
                {shipment ? `Ajouter des factures à ${shipment.id}` : `Nouvelle expédition ${hub} → Madagascar`}
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Regroupement des factures reçues à {hub} : une expédition = une facture de vente (Réf FA DIGI-NXT).
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-xl p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {error && (
          <div className="mt-4 flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 font-semibold text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300">
            <AlertCircle className="h-4 w-4 shrink-0" /> {error}
          </div>
        )}

        {!shipment && (
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-4">
            <label>
              <span className={label}>Réf FA DIGI-NXT *</span>
              <input value={refFa} onChange={(e) => setRefFa(e.target.value)} className={`${inputClass} font-mono`} />
            </label>
            <label>
              <span className={label}>{mode === 'Air' ? 'LTA' : 'BL'}</span>
              <input value={blAwb} onChange={(e) => setBlAwb(e.target.value)} className={`${inputClass} font-mono`} />
            </label>
            <label>
              <span className={label}>Transporteur / transitaire</span>
              <input value={carrier} onChange={(e) => setCarrier(e.target.value)} className={inputClass} />
            </label>
            <label>
              <span className={label}>Remarque</span>
              <input value={remarks} onChange={(e) => setRemarks(e.target.value)} className={inputClass} />
            </label>
          </div>
        )}

        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Fournisseur, facture, commande Amazon, acheteur…"
              className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
          </div>
          <label className="flex cursor-pointer items-center gap-2 font-semibold text-slate-600 dark:text-slate-300">
            <input
              type="checkbox"
              checked={onlyReceived}
              onChange={(e) => setOnlyReceived(e.target.checked)}
              className="h-4 w-4 accent-[#623387]"
            />
            Reçues à {hub} seulement (tous les colis)
          </label>
        </div>

        <div className="mt-3 max-h-[45vh] overflow-y-auto rounded-2xl border border-slate-200 dark:border-slate-700">
          {invoices === null ? (
            <Loader2 className="m-4 h-5 w-5 animate-spin text-slate-400" />
          ) : groups.length === 0 ? (
            <p className="p-4 text-slate-500">
              {onlyReceived
                ? `Aucune facture reçue à ${hub} en attente d'expédition. Décochez le filtre pour voir les autres (exception).`
                : 'Aucune facture en marchandises disponible.'}
            </p>
          ) : (
            groups.map(([supplier, list]) => {
              const ids = list.filter(selectable).map((i) => i.id);
              const all = ids.length > 0 && ids.every((id) => selected.has(id));
              return (
                <div key={supplier} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
                  <label className="flex cursor-pointer items-center gap-2 bg-slate-50 px-3 py-2 font-extrabold dark:bg-slate-800">
                    <input
                      type="checkbox"
                      checked={all}
                      disabled={ids.length === 0}
                      onChange={() => toggle(ids, !all)}
                      className="h-4 w-4 accent-[#623387]"
                    />
                    {supplier}
                    <span className="font-semibold text-slate-500">{list.length} facture(s)</span>
                  </label>
                  {list.map((inv) => {
                    const received = isInvoiceReceived(inv);
                    const legacy = inv.shipment_id && inv.shipment_exists ? inv.shipment_id : null;
                    return (
                      <label
                        key={inv.id}
                        className={`flex items-center gap-2 px-3 py-1.5 ${
                          selectable(inv) ? 'cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/60' : 'opacity-50'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={selected.has(inv.id)}
                          disabled={!selectable(inv)}
                          onChange={() => toggle([inv.id], !selected.has(inv.id))}
                          className="h-4 w-4 accent-[#623387]"
                        />
                        <span className="w-32 font-semibold">{inv.ref || '—'}</span>
                        <span className="w-24 text-slate-500">{formatDate(inv.invoice_date)}</span>
                        <span className="w-28 text-right">
                          {formatAmount(inv.amount_total)} {inv.currency === 'USD' ? '$' : '€'}
                        </span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                            received
                              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                              : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                          }`}
                        >
                          {received
                            ? `Reçue à ${hub}`
                            : inv.parcel_count === 0
                            ? 'Sans colis'
                            : `${inv.parcel_received_count}/${inv.parcel_count} colis reçu(s)`}
                        </span>
                        {!inv.is_digi && <span className="text-[10px] text-slate-500">hors DIGI</span>}
                        {inv.validation_status === 'pending' && (
                          <span className="text-[10px] font-bold text-amber-700">à valider avant expédition</span>
                        )}
                        {legacy && <span className="text-[10px] text-slate-500">dans {legacy} (à revoir)</span>}
                      </label>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>

        {exception && (
          <div className="mt-4 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
            <div className="flex items-center gap-2 font-bold">
              <AlertTriangle className="h-4 w-4" /> Exception Supply Chain : colis pas tous confirmés reçus à {hub}
            </div>
            <ul className="mt-2 list-disc pl-5">
              {exception.map((n) => (
                <li key={n.id}>
                  {n.supplier || '—'} · facture {n.ref || '—'} : {n.parcels_received}/{n.parcels_total} colis reçu(s)
                </li>
              ))}
            </ul>
            <p className="mt-2">L'exception sera inscrite dans l'historique de l'expédition, avec votre nom.</p>
            <div className="mt-3 flex gap-2">
              <button
                onClick={() => submit(true)}
                disabled={saving}
                className="flex items-center gap-1.5 rounded-xl bg-amber-600 px-4 py-2 font-bold text-white hover:bg-amber-700 disabled:opacity-50"
              >
                {saving && <Loader2 className="h-4 w-4 animate-spin" />} Confirmer l'exception
              </button>
              <button
                onClick={() => setException(null)}
                className="rounded-xl border border-amber-300 px-4 py-2 font-bold text-amber-800 dark:text-amber-200"
              >
                Revoir la sélection
              </button>
            </div>
          </div>
        )}

        {!exception && (
          <div className="mt-5 flex items-center justify-between gap-2 border-t border-slate-100 pt-4 dark:border-slate-800">
            <span className="text-slate-500">{selectedInvoices.length} facture(s) sélectionnée(s)</span>
            <div className="flex gap-2">
              <button
                onClick={onClose}
                className="rounded-xl border border-slate-200 px-4 py-2 font-bold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                Annuler
              </button>
              <button
                onClick={() => submit(false)}
                disabled={saving || selectedInvoices.length === 0}
                className="flex items-center gap-2 rounded-xl bg-[#623387] px-4 py-2 font-bold text-white hover:bg-[#522870] disabled:opacity-50"
              >
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                {shipment ? 'Ajouter à l\'expédition' : 'Créer l\'expédition'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
