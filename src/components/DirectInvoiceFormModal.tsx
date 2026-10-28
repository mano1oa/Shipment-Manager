import React, { useEffect, useState } from 'react';
import { AlertCircle, FileText, Loader2, X } from 'lucide-react';
import { parseNumberValue } from '../lib/digiInvoices';
import { validateDirectInvoiceInput } from '../lib/directInvoices';
import { CURRENCIES } from '../lib/parcelTracking';
import type { Currency } from '../lib/parcelTracking';
import { DigiInvoice, inputClass, saveDirectInvoice } from './digiApi';

interface Props {
  invoice: DigiInvoice | null; // null = new invoice
  /** Supply Chain: validated at once. Otherwise the invoice waits for Supply Chain. */
  isSupplyChain: boolean;
  onClose: () => void;
  onSaved: (invoice: DigiInvoice) => void;
}

/**
 * "Hors DIGI" invoice: a supplier invoice that does not go through DIGI
 * LOGISTIC but still needs parcel tracking. No item lines.
 */
export const DirectInvoiceFormModal: React.FC<Props> = ({ invoice, isSupplyChain, onClose, onSaved }) => {
  const [supplier, setSupplier] = useState(invoice?.supplier_name ?? '');
  const [ref, setRef] = useState(invoice?.ref ?? '');
  const [invoiceDate, setInvoiceDate] = useState(invoice?.invoice_date ?? '');
  const [amount, setAmount] = useState(
    invoice?.amount_total !== null && invoice?.amount_total !== undefined ? String(invoice.amount_total).replace('.', ',') : ''
  );
  const [currency, setCurrency] = useState<Currency>(invoice?.currency ?? 'EUR');
  const [buyer, setBuyer] = useState(invoice?.buyer ?? '');
  const [suppliers, setSuppliers] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/reference/suppliers', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => setSuppliers((d?.suppliers || []).map((s: { name: string }) => s.name)))
      .catch(() => setSuppliers([]));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const parsedAmount = parseNumberValue(amount);
    const { value, errors } = validateDirectInvoiceInput({
      supplier_name: supplier,
      ref,
      invoice_date: invoiceDate,
      amount: typeof parsedAmount === 'number' ? parsedAmount : undefined,
      currency,
      buyer,
    });
    if (!value) {
      setError(errors.join(' '));
      return;
    }
    setSaving(true);
    try {
      onSaved(await saveDirectInvoice(value, invoice?.id));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const label = 'font-semibold text-slate-700 dark:text-slate-300';
  const refused = invoice?.validation_status === 'rejected';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-900/60 p-4 backdrop-blur-xs">
      <form
        onSubmit={handleSubmit}
        className="my-8 w-full max-w-xl rounded-3xl border border-slate-200 bg-white p-6 text-xs shadow-2xl dark:border-slate-800 dark:bg-slate-900"
      >
        <div className="flex items-center justify-between border-b border-slate-100 pb-4 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#643288] text-white shadow-sm">
              <FileText className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-extrabold text-slate-900 dark:text-white">
                {invoice ? 'Modifier la facture hors DIGI' : 'Nouvelle facture hors DIGI'}
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Facture fournisseur qui ne passe pas par DIGI LOGISTIC, à suivre jusqu'à Madagascar.
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

        {refused && (
          <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300">
            <strong>Refusée par la Supply Chain :</strong> {invoice?.rejection_reason || '—'}
            <div className="mt-1 text-[11px]">Corrigez-la : elle repartira en validation.</div>
          </div>
        )}
        {error && (
          <div className="mt-4 flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 font-semibold text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="sm:col-span-2">
            <span className={label}>Fournisseur *</span>
            <input
              list="direct-invoice-suppliers"
              value={supplier}
              onChange={(e) => setSupplier(e.target.value)}
              className={inputClass}
              required
            />
            <datalist id="direct-invoice-suppliers">
              {suppliers.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </label>
          <label>
            <span className={label}>Référence de la facture *</span>
            <input value={ref} onChange={(e) => setRef(e.target.value)} className={inputClass} required />
          </label>
          <label>
            <span className={label}>Date de facture *</span>
            <input
              type="date"
              value={invoiceDate}
              onChange={(e) => setInvoiceDate(e.target.value)}
              className={inputClass}
              required
            />
          </label>
          <label>
            <span className={label}>Montant *</span>
            <input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="1 234,56"
              className={inputClass}
              required
            />
          </label>
          <label>
            <span className={label}>Devise *</span>
            <select value={currency} onChange={(e) => setCurrency(e.target.value as Currency)} className={inputClass}>
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="sm:col-span-2">
            <span className={label}>Acheteur / demandeur *</span>
            <input value={buyer} onChange={(e) => setBuyer(e.target.value)} className={inputClass} required />
          </label>
        </div>

        <p className="mt-4 text-[11px] text-slate-500 dark:text-slate-400">
          {isSupplyChain
            ? 'Saisie par la Supply Chain : la facture est validée directement.'
            : 'La facture devra être validée par la Supply Chain avant d\'entrer dans une expédition. Vous pouvez déjà ajouter ses colis.'}
        </p>

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
            className="flex items-center gap-2 rounded-xl bg-[#643288] px-4 py-2 font-bold text-white hover:bg-[#522870] disabled:opacity-50"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} Enregistrer
          </button>
        </div>
      </form>
    </div>
  );
};
