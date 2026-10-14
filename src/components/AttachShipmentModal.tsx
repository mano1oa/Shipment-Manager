import React, { useMemo, useState } from 'react';
import { Link2, Loader2, Search, X } from 'lucide-react';
import { Shipment } from '../types';
import { DigiInvoice, formatAmount, formatDate } from './digiApi';

interface Props {
  invoice: DigiInvoice;
  shipments: Shipment[];
  onClose: () => void;
  /** shipmentId null = detach the invoice from its shipment */
  onConfirm: (shipmentId: string | null) => Promise<void>;
}

const MAX_SHOWN = 50;

/**
 * Attach a DIGI invoice to an existing shipment (several invoices travelling
 * together), or detach it.
 */
export const AttachShipmentModal: React.FC<Props> = ({ invoice, shipments, onClose, onConfirm }) => {
  // Same supplier first, then most recent
  const [search, setSearch] = useState(invoice.supplier_name || '');
  const [selected, setSelected] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const candidates = useMemo(() => {
    const q = search.trim().toLowerCase();
    return shipments
      .filter((s) => s.id !== invoice.shipment_id)
      .filter(
        (s) =>
          !q ||
          [s.id, s.supplier, s.order_reference, s.carrier, s.bl_awb, s.ref_fa_digi_nxt].some(
            (v) => v && String(v).toLowerCase().includes(q)
          )
      )
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  }, [shipments, search, invoice.shipment_id]);

  const submit = async (shipmentId: string | null) => {
    setSaving(true);
    setError(null);
    try {
      await onConfirm(shipmentId);
    } catch (err: any) {
      setError(err.message);
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs overflow-y-auto">
      <div className="w-full max-w-2xl rounded-3xl border border-slate-200 bg-white p-6 text-xs shadow-2xl dark:border-slate-800 dark:bg-slate-900 my-8">
        <div className="flex items-start justify-between border-b border-slate-100 pb-4 dark:border-slate-800">
          <div>
            <h2 className="flex items-center gap-2 text-base font-extrabold text-slate-900 dark:text-white">
              <Link2 className="h-4 w-4 text-slate-400" /> Rattacher à une expédition
            </h2>
            <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
              Facture {invoice.ref || invoice.odoo_move_name} · {invoice.supplier_name || '—'} ·{' '}
              {formatAmount(invoice.amount_total)} €
              {invoice.shipment_id && invoice.shipment_exists && <> · actuellement dans {invoice.shipment_id}</>}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-xl p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="relative mt-4">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="N° d'expédition, fournisseur, commande, LTA…"
            className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-slate-800 focus:border-[#643288] focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
          />
        </div>

        <div className="mt-3 max-h-80 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-700">
          {candidates.length === 0 ? (
            <p className="p-4 text-center text-slate-400">Aucune expédition ne correspond.</p>
          ) : (
            candidates.slice(0, MAX_SHOWN).map((s) => (
              <label
                key={s.id}
                className={`flex cursor-pointer items-center gap-3 border-b border-slate-100 px-3 py-2.5 last:border-0 dark:border-slate-800 ${
                  selected === s.id ? 'bg-slate-100 dark:bg-slate-800' : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                }`}
              >
                <input
                  type="radio"
                  name="target-shipment"
                  checked={selected === s.id}
                  onChange={() => setSelected(s.id)}
                  className="text-[#643288] focus:ring-[#643288]"
                />
                <div className="flex-1">
                  <div className="font-semibold text-slate-800 dark:text-slate-100">
                    <span className="font-mono">{s.id}</span>
                    <span className="ml-2 font-normal text-slate-400">{s.mode === 'Sea' ? 'Maritime' : 'Aérien'}</span>
                  </div>
                  <div className="text-slate-500">
                    {[s.supplier, s.order_reference && `Cde ${s.order_reference}`, s.carrier, s.global_status]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                </div>
                <div className="text-right text-slate-500">
                  {s.digi_invoice_count ? `${s.digi_invoice_count} facture(s)` : ''}
                  <div className="text-[10px] text-slate-400">{formatDate(String(s.created_at).slice(0, 10))}</div>
                </div>
              </label>
            ))
          )}
        </div>
        {candidates.length > MAX_SHOWN && (
          <p className="mt-1 text-slate-400">{candidates.length - MAX_SHOWN} autre(s) : affinez la recherche.</p>
        )}

        {error && <p className="mt-3 font-semibold text-rose-600">{error}</p>}

        <div className="mt-4 flex items-center justify-between gap-2 border-t border-slate-100 pt-4 dark:border-slate-800">
          {invoice.shipment_id && invoice.shipment_exists ? (
            <button
              type="button"
              onClick={() => submit(null)}
              disabled={saving}
              className="rounded-xl px-3 py-2 font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-50 dark:hover:bg-slate-800"
            >
              Détacher de {invoice.shipment_id}
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-slate-200 px-4 py-2 font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={() => selected && submit(selected)}
              disabled={!selected || saving}
              className="flex items-center gap-2 rounded-xl bg-[#643288] px-4 py-2 font-bold text-white shadow-md hover:bg-[#522870] disabled:opacity-50"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Rattacher
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
