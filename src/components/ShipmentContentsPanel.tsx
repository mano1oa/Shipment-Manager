import React, { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Loader2, Package, Plus, ReceiptText, SearchX, Undo2, X } from 'lucide-react';
import { Shipment } from '../types';
import { parcelStatusHint, parcelStatusLabel } from '../lib/parcelTracking';
import {
  DigiInvoice,
  Parcel,
  fetchShipmentParcels,
  formatAmount,
  formatDate,
  formatQuantity,
  isInvoiceReceived,
  removeInvoiceFromShipment,
  setParcelStatus,
} from './digiApi';
import { PARCEL_STATUS_BADGES } from './InvoiceParcelsPanel';
import { ShipmentInvoicesModal } from './ShipmentInvoicesModal';

interface Props {
  shipment: Shipment;
  invoices: DigiInvoice[] | null;
  invoicesError: string | null;
  /** Supply Chain: adds / removes invoices, flags parcels missing on arrival. */
  isSupplyChain: boolean;
  shipments: Shipment[];
  /** Invoices or parcels changed: reload the shipment, its invoices and the parcels. */
  onChanged: (emptied?: string[]) => void;
}

const cardClass =
  'rounded-2xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-800/60';

/**
 * Contents of a shipment Orly / Rouen → Mada: its invoices (one sale invoice
 * = Réf FA) and their parcels. On arrival in Madagascar, a parcel received at
 * the hub but missing is flagged "Avis de recherche" (claim).
 */
export const ShipmentContentsPanel: React.FC<Props> = ({
  shipment,
  invoices,
  invoicesError,
  isSupplyChain,
  shipments,
  onChanged,
}) => {
  const hub = shipment.mode === 'Air' ? 'Orly' : 'Rouen';
  const [parcels, setParcels] = useState<Parcel[] | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadParcels = useCallback(() => {
    fetchShipmentParcels(shipment.id)
      .then(setParcels)
      .catch((err) => setError(err.message));
  }, [shipment.id]);

  useEffect(loadParcels, [loadParcels, invoices]);

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const handleRemove = async (inv: DigiInvoice) => {
    if (!window.confirm(`Retirer la facture ${inv.ref || ''} de l'expédition ${shipment.id} ? Elle redevient à expédier.`)) return;
    setBusy(inv.id);
    setError(null);
    try {
      await removeInvoiceFromShipment(shipment.id, inv.id);
      onChanged();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const handleParcel = async (p: Parcel, status: 'search' | 'received') => {
    const question =
      status === 'search'
        ? `Colis ${p.tracking_number || ''} absent à l'arrivée à Madagascar : ouvrir un avis de recherche ?`
        : `Le colis ${p.tracking_number || ''} a été retrouvé : annuler l'avis de recherche ?`;
    if (!window.confirm(question)) return;
    setBusy(p.id);
    setError(null);
    try {
      await setParcelStatus(p.id, status, p.received_at);
      loadParcels();
      onChanged();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const delivered = shipment.global_status === 'Livrée entrepôt';

  return (
    <div className={cardClass}>
      <div className="mb-4 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
          <ReceiptText className="h-4 w-4 text-slate-400" /> Factures et colis
          {invoices && <span className="text-xs font-semibold text-slate-400">{invoices.length} facture(s)</span>}
        </h3>
        {isSupplyChain && (
          <button
            onClick={() => setAdding(true)}
            className="flex items-center gap-1 rounded-lg bg-[#643288] px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-[#522870]"
          >
            <Plus className="h-3 w-3" /> Ajouter des factures
          </button>
        )}
      </div>

      {(invoicesError || error) && <p className="mb-2 text-xs text-rose-600">{invoicesError || error}</p>}

      {invoices === null ? (
        <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
      ) : invoices.length === 0 ? (
        <p className="text-xs text-slate-400">
          Aucune facture dans cette expédition.{isSupplyChain && ' Ajoutez les factures reçues à ' + hub + '.'}
        </p>
      ) : (
        <div className="divide-y divide-slate-100 text-xs dark:divide-slate-700/60">
          {invoices.map((inv) => {
            const isOpen = open.has(inv.id);
            return (
              <div key={inv.id} className="py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <button onClick={() => toggle(inv.id)} className="text-slate-400">
                    {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </button>
                  <span className="font-semibold text-slate-800 dark:text-slate-100">
                    {inv.supplier_display || '—'} · {inv.ref || inv.odoo_move_name || '—'}
                  </span>
                  <span className="text-slate-400">{formatDate(inv.invoice_date)}</span>
                  {!inv.is_digi && <span className="text-[10px] text-slate-500">hors DIGI</span>}
                  {!isInvoiceReceived(inv) && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                      {inv.parcel_received_count}/{inv.parcel_count} colis reçu(s)
                    </span>
                  )}
                  <span className="ml-auto font-semibold text-slate-800 dark:text-slate-100">
                    {formatAmount(inv.amount_total)} {inv.currency === 'USD' ? '$' : '€'}
                  </span>
                  {isSupplyChain && (
                    <button
                      onClick={() => handleRemove(inv)}
                      disabled={busy === inv.id}
                      title="Retirer de l'expédition"
                      className="rounded-lg p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50 dark:hover:bg-rose-950/40"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                {isOpen &&
                  (inv.lines.length === 0 ? (
                    <p className="ml-6 mt-1 text-slate-400">
                      {inv.is_digi ? 'Aucune ligne.' : `Facture hors DIGI — acheteur : ${inv.buyer || '—'}`}
                    </p>
                  ) : (
                    <table className="ml-6 mt-1 w-[calc(100%-1.5rem)] text-left">
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                        {inv.lines.map((line) => (
                          <tr key={line.id} className={line.is_service ? 'text-slate-400' : 'text-slate-700 dark:text-slate-200'}>
                            <td className="py-1 pr-2">{line.name}</td>
                            <td className="w-16 py-1 px-2 text-right">{formatQuantity(line.quantity)}</td>
                            <td className="w-24 py-1 pl-2 text-right">{formatAmount(line.price_subtotal)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ))}
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-4 border-t border-slate-100 pt-3 dark:border-slate-700">
        <h4 className="mb-2 flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wider text-slate-500">
          <Package className="h-3.5 w-3.5" /> Colis ({parcels?.length ?? '…'})
        </h4>
        {isSupplyChain && delivered && (
          <p className="mb-2 text-[11px] text-slate-500">
            Arrivée à Madagascar : signalez « Absent à l'arrivée » chaque colis manquant (avis de recherche, réclamation
            {shipment.mode === 'Air' ? ' MIDEX' : ' transitaire'}).
          </p>
        )}
        {parcels === null ? (
          <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
        ) : parcels.length === 0 ? (
          <p className="text-xs text-slate-400">Aucun colis enregistré pour ces factures.</p>
        ) : (
          <table className="w-full text-left text-xs">
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
              {parcels.map((p) => (
                <tr key={p.id}>
                  <td className="py-1.5 pr-2 font-mono font-semibold">{p.tracking_number || '— (inconnu)'}</td>
                  <td className="py-1.5 pr-2">{p.supplier_name || '—'}</td>
                  <td className="py-1.5 pr-2 text-slate-500">{p.invoices.map((i) => i.ref || '—').join(', ')}</td>
                  <td className="py-1.5 pr-2">
                    <span
                      title={parcelStatusHint(p.status, p.destination)}
                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${PARCEL_STATUS_BADGES[p.status]}`}
                    >
                      {parcelStatusLabel(p.status, p.destination)}
                    </span>
                  </td>
                  <td className="py-1.5 text-right">
                    {isSupplyChain && p.status === 'received' && (
                      <button
                        onClick={() => handleParcel(p, 'search')}
                        disabled={busy === p.id}
                        title="Absent à l'arrivée à Madagascar : avis de recherche"
                        className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold text-amber-700 hover:bg-amber-50 disabled:opacity-50 dark:text-amber-300 dark:hover:bg-amber-950/40"
                      >
                        <SearchX className="h-3.5 w-3.5" /> Absent à l'arrivée
                      </button>
                    )}
                    {isSupplyChain && p.status === 'search' && (
                      <button
                        onClick={() => handleParcel(p, 'received')}
                        disabled={busy === p.id}
                        title="Colis retrouvé"
                        className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-50 dark:text-slate-300 dark:hover:bg-slate-700"
                      >
                        <Undo2 className="h-3.5 w-3.5" /> Retrouvé
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {adding && (
        <ShipmentInvoicesModal
          mode={shipment.mode}
          shipment={shipment}
          shipments={shipments}
          onClose={() => setAdding(false)}
          onDone={(_id, emptied) => {
            setAdding(false);
            onChanged(emptied);
          }}
        />
      )}
    </div>
  );
};
