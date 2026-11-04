import React, { useEffect, useState } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import { Parcel, ParcelContentsInvoice, fetchParcelContents, formatAmount, formatDate, formatQuantity } from './digiApi';

/** Contents already loaded, per parcel (rows opened again stay instant). */
const cache = new Map<string, ParcelContentsInvoice[]>();

/**
 * Aperçu du contenu d'un colis, sous sa ligne dans les suivis: what the parcel
 * holds (description, packing) and the lines of its invoices.
 */
export const ParcelContentsPreview: React.FC<{ parcel: Parcel }> = ({ parcel }) => {
  const [invoices, setInvoices] = useState<ParcelContentsInvoice[] | null>(cache.get(parcel.id) ?? null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetchParcelContents(parcel.id)
      .then((list) => {
        cache.set(parcel.id, list);
        if (alive) setInvoices(list);
      })
      .catch((err) => alive && setError(err.message));
    return () => {
      alive = false;
    };
  }, [parcel.id]);

  const details = [
    parcel.description && `Contenu : ${parcel.description}`,
    parcel.packing_info && `Colisage : ${parcel.packing_info}`,
    parcel.volume_m3 !== null && `Volume : ${parcel.volume_m3} m³`,
    parcel.notes && `Note : ${parcel.notes}`,
  ].filter(Boolean);

  return (
    <div className="space-y-3 bg-slate-50 px-4 py-3 text-xs dark:bg-slate-900/50">
      {details.length > 0 && <p className="text-slate-600 dark:text-slate-300">{details.join(' · ')}</p>}
      {error ? (
        <p className="flex items-center gap-1.5 font-semibold text-rose-600">
          <AlertCircle className="h-4 w-4" /> {error}
        </p>
      ) : invoices === null ? (
        <p className="flex items-center gap-2 text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Chargement du contenu…
        </p>
      ) : invoices.length === 0 ? (
        <p className="text-slate-500">Aucune facture rattachée à ce colis.</p>
      ) : (
        invoices.map((inv) => {
          const goods = inv.lines.filter((l) => !l.is_service);
          return (
            <div key={inv.id} className="rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b border-slate-100 px-3 py-2 dark:border-slate-700">
                <span className="font-bold text-slate-900 dark:text-white">Facture {inv.ref || '—'}</span>
                <span className="text-slate-500">{inv.supplier_display || '—'}</span>
                <span className="text-slate-500">{formatDate(inv.invoice_date)}</span>
                {inv.amazon_order_ref && <span className="font-mono text-slate-500">Commande {inv.amazon_order_ref}</span>}
                {inv.amount_total !== null && (
                  <span className="ml-auto font-semibold text-slate-700 dark:text-slate-200">
                    {`${formatAmount(inv.amount_total)} ${inv.currency}`}
                  </span>
                )}
              </div>
              {goods.length === 0 ? (
                <p className="px-3 py-2 text-slate-500">
                  {inv.lines.length === 0 ? 'Facture saisie sans lignes (hors DIGI).' : 'Uniquement des frais / services.'}
                </p>
              ) : (
                <table className="w-full text-left">
                  <thead className="text-[10px] uppercase tracking-wider text-slate-400">
                    <tr>
                      <th className="px-3 py-1.5">Produit</th>
                      <th className="px-3 py-1.5 text-right">Qté</th>
                      <th className="px-3 py-1.5 text-right">Prix unitaire</th>
                      <th className="px-3 py-1.5 text-right">Total ({inv.currency})</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                    {goods.map((l) => (
                      <tr key={l.id}>
                        <td className="px-3 py-1.5 text-slate-800 dark:text-slate-100">{l.name}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{formatQuantity(l.quantity)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">
                          {l.price_unit !== null ? formatAmount(l.price_unit) : '—'}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums">
                          {l.price_subtotal !== null ? formatAmount(l.price_subtotal) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          );
        })
      )}
      {parcel.invoices.length > 1 && (
        <p className="text-[10px] text-slate-400">
          Ce colis couvre plusieurs factures : le contenu affiché est celui des factures, pas forcément tout dans ce colis.
        </p>
      )}
    </div>
  );
};
