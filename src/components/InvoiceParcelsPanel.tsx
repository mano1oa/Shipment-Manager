import React, { useCallback, useEffect, useState } from 'react';
import { Camera, Loader2, Package, Pencil, Plus, Unlink } from 'lucide-react';
import { isParcelOverdue, parcelLossDeadline, parcelStatusHint, parcelStatusLabel } from '../lib/parcelTracking';
import type { ParcelStatus, TrackingSettings } from '../lib/parcelTracking';
import { DigiInvoice, Parcel, fetchInvoiceParcels, formatDate, unlinkParcel } from './digiApi';
import { ParcelFormModal } from './ParcelFormModal';

export const PARCEL_STATUS_BADGES: Record<ParcelStatus, string> = {
  to_receive: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  received: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  lost: 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300',
  search: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
};

interface Props {
  invoice: DigiInvoice;
  canEdit: boolean;
  isSupplyChain: boolean;
  settings: TrackingSettings | undefined;
  /** Parcels changed: the invoice counters must be reloaded. */
  onChanged: () => void;
}

/** Parcels (tracking numbers) of an invoice, shown in its expanded row. */
export const InvoiceParcelsPanel: React.FC<Props> = ({ invoice, canEdit, isSupplyChain, settings, onChanged }) => {
  const [parcels, setParcels] = useState<Parcel[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<Parcel | 'new' | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    fetchInvoiceParcels(invoice.id)
      .then(setParcels)
      .catch((err) => setError(err.message));
  }, [invoice.id]);

  useEffect(load, [load]);

  const handleUnlink = async (parcel: Parcel) => {
    const others = parcel.invoices.length - 1;
    const question =
      others > 0
        ? `Retirer le colis ${parcel.tracking_number || 'sans n° de suivi'} de cette facture ? Il reste rattaché à ${others} autre(s) facture(s).`
        : `Supprimer le colis ${parcel.tracking_number || 'sans n° de suivi'} ?`;
    if (!window.confirm(question)) return;
    setBusyId(parcel.id);
    try {
      await unlinkParcel(parcel.id, invoice.id);
      load();
      onChanged();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="mb-3 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800">
      <div className="mb-2 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wider text-slate-500">
          <Package className="h-3.5 w-3.5" /> Colis fournisseur → Orly
        </span>
        {canEdit && (
          <button
            onClick={() => setForm('new')}
            className="inline-flex items-center gap-1 rounded-lg bg-[#643288] px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-[#522870]"
          >
            <Plus className="h-3 w-3" /> Colis
          </button>
        )}
      </div>

      {error && <p className="text-rose-600">{error}</p>}
      {parcels === null ? (
        <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
      ) : parcels.length === 0 ? (
        <p className="text-slate-500">
          Aucun colis. Ajoutez le n° de suivi du fournisseur, ou laissez la Supply Chain créer le colis à la réception
          à Orly.
        </p>
      ) : (
        <table className="w-full text-left">
          <thead className="text-[10px] uppercase tracking-wider text-slate-500">
            <tr>
              <th className="py-1 pr-3">N° de suivi</th>
              <th className="py-1 pr-3">Transporteur</th>
              <th className="py-1 pr-3">Livraison prévue</th>
              <th className="py-1 pr-3">État</th>
              <th className="py-1 pr-3">Autres factures</th>
              <th className="py-1" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
            {parcels.map((p) => {
              const overdue = isParcelOverdue(p, invoice.invoice_date, today, settings);
              const deadline = parcelLossDeadline(p.expected_delivery, invoice.invoice_date, settings);
              const others = p.invoices.filter((i) => i.id !== invoice.id);
              // Only Supply Chain removes a parcel already handled at Orly
              const removable = canEdit && (p.status === 'to_receive' || isSupplyChain);
              return (
                <tr key={p.id}>
                  <td className="py-1.5 pr-3 font-mono font-semibold">{p.tracking_number || '— (inconnu)'}</td>
                  <td className="py-1.5 pr-3">{p.carrier_name || '—'}</td>
                  <td className="py-1.5 pr-3">{formatDate(p.expected_delivery)}</td>
                  <td className="py-1.5 pr-3">
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
                    {overdue && (
                      <span className="ml-1 rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-700 dark:bg-rose-950 dark:text-rose-300">
                        Non confirmé depuis le {formatDate(deadline)}
                      </span>
                    )}
                  </td>
                  <td className="py-1.5 pr-3 text-slate-500">{others.map((i) => i.ref || '—').join(', ') || '—'}</td>
                  <td className="py-1.5 text-right">
                    {canEdit && (
                      <button
                        onClick={() => setForm(p)}
                        title="Modifier le colis"
                        className="rounded-lg p-1 text-slate-500 hover:bg-slate-100 hover:text-[#643288] dark:hover:bg-slate-700"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    )}
                    {removable && (
                      <button
                        onClick={() => handleUnlink(p)}
                        disabled={busyId === p.id}
                        title="Retirer le colis de cette facture"
                        className="rounded-lg p-1 text-slate-500 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50 dark:hover:bg-rose-950/40"
                      >
                        <Unlink className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {form && (
        <ParcelFormModal
          invoices={[invoice]}
          parcel={form === 'new' ? null : form}
          canCreateCarrier={isSupplyChain}
          onClose={() => setForm(null)}
          onSaved={() => {
            setForm(null);
            load();
            onChanged();
          }}
        />
      )}
    </div>
  );
};
