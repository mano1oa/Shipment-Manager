import React, { useEffect, useState } from 'react';
import { AlertCircle, FilePlus2, Loader2, Plus, Trash2, X } from 'lucide-react';
import { parseNumberValue, validateDigiInvoiceInput } from '../lib/digiInvoices';
import { DigiInvoice, cellInputClass, inputClass, saveDigiInvoice } from './digiApi';

interface LineDraft {
  key: number;
  name: string;
  quantity: string;
  price_unit: string;
  price_subtotal: string;
}

interface Props {
  invoice: DigiInvoice | null; // null = new invoice
  defaultDestination: string;
  onClose: () => void;
  onSaved: (invoice: DigiInvoice) => void;
}

let lineKey = 0;
const emptyLine = (): LineDraft => ({ key: ++lineKey, name: '', quantity: '', price_unit: '', price_subtotal: '' });
const numberText = (n: number | null) => (n === null ? '' : String(n).replace('.', ','));

export const DigiInvoiceFormModal: React.FC<Props> = ({ invoice, defaultDestination, onClose, onSaved }) => {
  const [supplier, setSupplier] = useState(invoice?.supplier_name ?? '');
  const [destination, setDestination] = useState(invoice ? invoice.dest_partner_name ?? '' : defaultDestination);
  const [ref, setRef] = useState(invoice?.ref ?? '');
  const [invoiceDate, setInvoiceDate] = useState(invoice?.invoice_date ?? '');
  const [amazonOrder, setAmazonOrder] = useState(invoice?.amazon_order_ref ?? '');
  const [saleMove, setSaleMove] = useState(invoice?.sale_move_ref ?? '');
  const [lines, setLines] = useState<LineDraft[]>(
    invoice && invoice.lines.length > 0
      ? invoice.lines.map((l) => ({
          key: ++lineKey,
          name: l.name,
          quantity: numberText(l.quantity),
          price_unit: numberText(l.price_unit),
          price_subtotal: numberText(l.price_subtotal),
        }))
      : [emptyLine()]
  );
  const [suppliers, setSuppliers] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/reference/suppliers', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => setSuppliers((d?.suppliers || []).map((s: { name: string }) => s.name)))
      .catch(() => setSuppliers([]));
  }, []);

  const updateLine = (key: number, patch: Partial<LineDraft>) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const computedSubtotal = (line: LineDraft): number | null => {
    const q = parseNumberValue(line.quantity);
    const p = parseNumberValue(line.price_unit);
    return typeof q === 'number' && typeof p === 'number' ? Math.round(q * p * 100) / 100 : null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const lineErrors: string[] = [];
    const parsedLines = lines
      .filter((l) => l.name.trim() || l.quantity.trim() || l.price_unit.trim() || l.price_subtotal.trim())
      .map((l, index) => {
        const read = (text: string, label: string) => {
          const value = parseNumberValue(text);
          if (value === undefined) lineErrors.push(`Ligne ${index + 1} : ${label} illisible.`);
          return value ?? null;
        };
        const quantity = read(l.quantity, 'quantité');
        const priceUnit = read(l.price_unit, 'prix');
        const subtotal = l.price_subtotal.trim() ? read(l.price_subtotal, 'sous-total') : computedSubtotal(l);
        return { name: l.name, quantity, price_unit: priceUnit, price_subtotal: subtotal };
      });

    const { value, errors } = validateDigiInvoiceInput({
      supplier_name: supplier,
      dest_partner_name: destination,
      ref,
      invoice_date: invoiceDate || null,
      amazon_order_ref: amazonOrder,
      sale_move_ref: saleMove,
      lines: parsedLines,
    });
    if (!value || lineErrors.length > 0) {
      setError([...lineErrors, ...errors].join(' '));
      return;
    }

    setSaving(true);
    try {
      onSaved(await saveDigiInvoice(value, invoice?.id));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const label = 'font-semibold text-slate-700 dark:text-slate-300';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs overflow-y-auto">
      <div className="w-full max-w-4xl rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-900 my-8">
        <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#623387] text-white shadow-sm">
              <FilePlus2 className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-extrabold text-slate-900 dark:text-white">
                {invoice ? 'Modifier la facture DIGI' : 'Saisie manuelle d\'une facture DIGI'}
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Facture DIGI LOGISTIC à destination de {defaultDestination}
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
          <div className="mt-4 flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300">
            <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-4 space-y-5 text-xs">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className={label}>Fournisseur *</label>
              <input
                value={supplier}
                onChange={(e) => setSupplier(e.target.value)}
                list="digi-suppliers"
                required
                className={inputClass}
              />
              <datalist id="digi-suppliers">
                {suppliers.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            </div>
            <div>
              <label className={label}>Référence de la facture *</label>
              <input value={ref} onChange={(e) => setRef(e.target.value)} required className={inputClass} />
            </div>
            <div>
              <label className={label}>Date de facturation</label>
              <input
                type="date"
                value={invoiceDate}
                onChange={(e) => setInvoiceDate(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label className={label}>Commande Amazon</label>
              <input value={amazonOrder} onChange={(e) => setAmazonOrder(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className={label}>Facture vente</label>
              <input value={saleMove} onChange={(e) => setSaleMove(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className={label}>Entité de destination</label>
              <input value={destination} onChange={(e) => setDestination(e.target.value)} className={inputClass} />
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Lignes de facture</h3>
              <button
                type="button"
                onClick={() => setLines((prev) => [...prev, emptyLine()])}
                className="flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <Plus className="h-3.5 w-3.5" /> Ajouter une ligne
              </button>
            </div>
            <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
              <table className="w-full text-left">
                <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                  <tr>
                    <th className="px-2 py-2">Libellé *</th>
                    <th className="w-24 px-2 py-2">Quantité</th>
                    <th className="w-28 px-2 py-2">Prix</th>
                    <th className="w-28 px-2 py-2">Sous-total</th>
                    <th className="w-8 px-2 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {lines.map((line) => {
                    const computed = computedSubtotal(line);
                    return (
                      <tr key={line.key}>
                        <td className="px-2 py-1.5">
                          <input
                            value={line.name}
                            onChange={(e) => updateLine(line.key, { name: e.target.value })}
                            className={cellInputClass}
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <input
                            inputMode="decimal"
                            value={line.quantity}
                            onChange={(e) => updateLine(line.key, { quantity: e.target.value })}
                            className={cellInputClass}
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <input
                            inputMode="decimal"
                            value={line.price_unit}
                            onChange={(e) => updateLine(line.key, { price_unit: e.target.value })}
                            className={cellInputClass}
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <input
                            inputMode="decimal"
                            value={line.price_subtotal}
                            placeholder={computed !== null ? numberText(computed) : ''}
                            title="Laissé vide : quantité × prix"
                            onChange={(e) => updateLine(line.key, { price_subtotal: e.target.value })}
                            className={cellInputClass}
                          />
                        </td>
                        <td className="px-2 py-1.5 text-right">
                          <button
                            type="button"
                            onClick={() => setLines((prev) => prev.filter((l) => l.key !== line.key))}
                            className="rounded-lg p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40"
                            title="Retirer la ligne"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400">
              Sous-total laissé vide : calculé à partir de la quantité et du prix lorsque les deux sont renseignés.
            </p>
          </div>

          <div className="flex justify-end gap-2 border-t border-slate-100 pt-4 dark:border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-slate-200 px-4 py-2 font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-2 rounded-xl bg-[#623387] px-4 py-2 font-bold text-white shadow-md hover:bg-[#522870] disabled:opacity-50"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Enregistrer
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
