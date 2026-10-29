import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Loader2, PackageCheck, X } from 'lucide-react';
import { validateParcelInput } from '../lib/parcelTracking';
import type { ParcelDestination } from '../lib/parcelTracking';
import {
  DigiInvoice,
  Parcel,
  createReceivedParcel,
  fetchDigiInvoices,
  formatAmount,
  formatDate,
  inputClass,
  isGoodsInvoice,
  isInvoiceReceived,
} from './digiApi';

interface Props {
  destination: ParcelDestination;
  onClose: () => void;
  /** The parcel was created as received. */
  onSaved: (parcel: Parcel) => void;
}

const supplierOf = (inv: DigiInvoice) => inv.supplier_display || '—';

/**
 * Supply Chain, at Antoine's weekly point: a parcel received at the hub that
 * was not announced (no tracking number entered). It is created already
 * received and attached to the invoice(s) it covers, of one supplier.
 */
export const ReceiveParcelModal: React.FC<Props> = ({ destination, onClose, onSaved }) => {
  const hub = destination === 'ORLY' ? 'Orly' : 'Rouen';
  const [invoices, setInvoices] = useState<DigiInvoice[] | null>(null);
  const [supplier, setSupplier] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [trackingNumber, setTrackingNumber] = useState('');
  const [receivedAt, setReceivedAt] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchDigiInvoices()
      // Tracked invoices still waiting for at least one parcel
      .then((list) => setInvoices(list.filter((i) => isGoodsInvoice(i) && !isInvoiceReceived(i))))
      .catch((err) => setError(err.message));
  }, []);

  const suppliers = useMemo(
    () => Array.from(new Set<string>((invoices || []).map(supplierOf))).sort((a, b) => a.localeCompare(b, 'fr')),
    [invoices]
  );
  const supplierInvoices = useMemo(() => (invoices || []).filter((i) => supplierOf(i) === supplier), [invoices, supplier]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (selected.size === 0) {
      setError('Cochez la ou les factures que couvre ce colis.');
      return;
    }
    const { value, errors } = validateParcelInput({ tracking_number: trackingNumber, notes, destination });
    if (!value) {
      setError(errors.join(' '));
      return;
    }
    setSaving(true);
    try {
      const { parcel } = await createReceivedParcel(value, Array.from(selected), receivedAt);
      onSaved(parcel);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const label = 'font-semibold text-slate-700 dark:text-slate-300';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-900/60 p-4 backdrop-blur-xs">
      <form
        onSubmit={handleSubmit}
        className="my-8 w-full max-w-2xl rounded-3xl border border-slate-200 bg-white p-6 text-xs shadow-2xl dark:border-slate-800 dark:bg-slate-900"
      >
        <div className="flex items-center justify-between border-b border-slate-100 pb-4 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-600 text-white shadow-sm">
              <PackageCheck className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-extrabold text-slate-900 dark:text-white">Colis reçu à {hub}, non annoncé</h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Colis confirmé {destination === 'ORLY' ? 'par Antoine' : 'au quai de Rouen'} sans n° de suivi saisi :
                il est créé directement « Reçu à {hub} ».
              </p>
            </div>
          </div>
          <button
            type="button"
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

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="sm:col-span-2">
            <span className={label}>Fournisseur (une photo = un colis d'un seul fournisseur) *</span>
            <select
              value={supplier}
              onChange={(e) => {
                setSupplier(e.target.value);
                setSelected(new Set());
              }}
              className={inputClass}
              required
            >
              <option value="">{invoices === null ? 'Chargement…' : '— Sélectionner —'}</option>
              {suppliers.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>

          {supplier && (
            <div className="sm:col-span-2">
              <span className={label}>Facture(s) couverte(s) par ce colis *</span>
              <div className="mt-1 max-h-56 space-y-1 overflow-y-auto rounded-xl border border-slate-200 p-2 dark:border-slate-700">
                {supplierInvoices.map((inv) => (
                  <label key={inv.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1 hover:bg-slate-50 dark:hover:bg-slate-800">
                    <input
                      type="checkbox"
                      checked={selected.has(inv.id)}
                      onChange={() => toggle(inv.id)}
                      className="h-4 w-4 accent-[#623387]"
                    />
                    <span className="font-semibold">{inv.ref || '—'}</span>
                    <span className="text-slate-500">
                      {formatDate(inv.invoice_date)} · {formatAmount(inv.amount_total)} {inv.currency} ·{' '}
                      {inv.parcel_count === 0 ? 'sans colis' : `${inv.parcel_received_count}/${inv.parcel_count} colis reçu(s)`}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <label>
            <span className={label}>N° de suivi (si lisible sur la photo)</span>
            <input value={trackingNumber} onChange={(e) => setTrackingNumber(e.target.value)} className={`${inputClass} font-mono`} />
          </label>
          <label>
            <span className={label}>Reçu le *</span>
            <input
              type="date"
              value={receivedAt}
              max={new Date().toISOString().slice(0, 10)}
              onChange={(e) => setReceivedAt(e.target.value)}
              className={inputClass}
              required
            />
          </label>
          <label className="sm:col-span-2">
            <span className={label}>Remarque</span>
            <input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputClass} />
          </label>
        </div>

        <p className="mt-3 text-[11px] text-slate-500">Pour un colis photographié par Antoine, utilisez plutôt « Point Antoine » : la photo y est rattachée en même temps.</p>

        <div className="mt-5 flex justify-end gap-2 border-t border-slate-100 pt-4 dark:border-slate-800">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-200 px-4 py-2 font-bold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Annuler
          </button>
          <button
            type="submit"
            disabled={saving}
            className="flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} Enregistrer comme reçu
          </button>
        </div>
      </form>
    </div>
  );
};
