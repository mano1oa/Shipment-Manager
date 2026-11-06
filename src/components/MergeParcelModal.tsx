import React, { useMemo, useState } from 'react';
import { AlertCircle, Combine, Loader2, X } from 'lucide-react';
import { parcelStatusLabel } from '../lib/parcelTracking';
import { Parcel, inputClass, mergeParcelInto } from './digiApi';
import { PARCEL_STATUS_BADGES } from './InvoiceParcelsPanel';
import { BoxesBadge } from './BoxesBadge';

interface Props {
  /** Parcel created apart: in fact a box of the main parcel. */
  merged: Parcel;
  /** Parcels of the hub (main parcel candidates). */
  parcels: Parcel[];
  /** Main parcel proposed (from "Colis à fusionner ?"). */
  initialPrincipalId?: string | null;
  onClose: () => void;
  onMerged: (principal: Parcel) => void;
}

const same = (a: string | null, b: string | null) => (a || '').trim().toUpperCase() === (b || '').trim().toUpperCase();
const compact = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

/**
 * "Fusionner dans le colis principal…" (Supply Chain): a box of a FedEx
 * shipment of several boxes, created apart at the point because its label
 * was not the main number, goes into the main parcel. Nothing changes before
 * the confirmation.
 */
export const MergeParcelModal: React.FC<Props> = ({ merged, parcels, initialPrincipalId, onClose, onMerged }) => {
  const [query, setQuery] = useState('');
  const [principalId, setPrincipalId] = useState<string | null>(initialPrincipalId ?? null);
  const [boxes, setBoxes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Same supplier and hub only (refused otherwise); the lost ones first
  const candidates = useMemo(() => {
    const q = compact(query);
    return parcels
      .filter((p) => p.id !== merged.id && p.destination === merged.destination && same(p.supplier_name, merged.supplier_name))
      .filter(
        (p) =>
          !q ||
          [p.tracking_number, ...p.numbers.map((n) => n.number), ...p.invoices.map((i) => i.ref)].some(
            (v) => v && compact(v).includes(q)
          )
      )
      .sort(
        (a, b) =>
          Number(b.status === 'lost') - Number(a.status === 'lost') ||
          Number(b.invoices.some((i) => merged.invoices.some((m) => m.id === i.id))) -
            Number(a.invoices.some((i) => merged.invoices.some((m) => m.id === i.id)))
      )
      .slice(0, 8);
  }, [parcels, merged, query]);
  const principal = principalId ? parcels.find((p) => p.id === principalId) ?? null : null;
  const boxCount = boxes.trim() ? Number(boxes) : null;
  const boxesAfter = principal ? principal.boxes.length + Math.max(merged.boxes.length, merged.status === 'received' ? 1 : 0) : 0;

  const submit = async () => {
    if (!principal) return;
    if (boxCount !== null && (!Number.isInteger(boxCount) || boxCount < 1 || boxCount > 999)) {
      setError('Nombre de boîtes : un nombre entier de 1 à 999.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      onMerged(await mergeParcelInto(merged.id, principal.id, boxCount));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const label = 'font-semibold text-slate-700 dark:text-slate-300';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-900/60 p-4 backdrop-blur-xs">
      <div className="my-8 w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-6 text-xs shadow-2xl dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-100 pb-4 dark:border-slate-800">
          <h2 className="flex items-center gap-2 text-base font-extrabold text-slate-900 dark:text-white">
            <Combine className="h-5 w-5 text-[#623387]" /> Fusionner dans le colis principal
          </h2>
          <button onClick={onClose} className="rounded-xl p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="mt-3 text-slate-600 dark:text-slate-300">
          Le colis <span className="font-mono font-bold">{merged.tracking_number || 'sans n°'}</span> ({merged.supplier_name || '—'})
          est en fait une boîte d'un autre colis. Ses boîtes, photos et factures passent sur le colis principal, son n°
          devient un « n° de pièce » de ce colis, puis la ligne est supprimée.
        </p>

        {error && (
          <div className="mt-3 flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 font-semibold text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300">
            <AlertCircle className="h-4 w-4 shrink-0" /> {error}
          </div>
        )}

        <label className="mt-4 block">
          <span className={label}>Colis principal (même fournisseur, même hub)</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="N° principal, autre n° ou facture"
            className={`${inputClass} font-mono`}
            autoFocus
          />
        </label>
        <div className="mt-1 space-y-1">
          {candidates.length === 0 && <p className="text-slate-500">Aucun colis du même fournisseur trouvé.</p>}
          {candidates.map((p) => (
            <button
              key={p.id}
              onClick={() => setPrincipalId(p.id)}
              className={`block w-full rounded-lg border px-2 py-1.5 text-left ${
                principalId === p.id
                  ? 'border-[#623387] bg-[#F8EEFF] dark:bg-purple-950/40'
                  : 'border-slate-200 hover:border-[#623387] dark:border-slate-700'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono font-semibold">{p.tracking_number || 'sans n°'}</span>
                <span className="flex items-center gap-1">
                  <BoxesBadge parcel={p} />
                  <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold ${PARCEL_STATUS_BADGES[p.status]}`}>
                    {parcelStatusLabel(p.status, p.destination)}
                  </span>
                </span>
              </div>
              <div className="text-[10px] text-slate-500">
                Facture(s) {p.invoices.map((i) => i.ref || '—').join(', ') || '—'} · {p.carrier_name || p.carrier}
              </div>
            </button>
          ))}
        </div>

        <label className="mt-3 block">
          <span className={label}>Nombre de boîtes attendues (facultatif)</span>
          <input
            inputMode="numeric"
            value={boxes}
            onChange={(e) => setBoxes(e.target.value.replace(/\D/g, ''))}
            placeholder={principal?.boxes_expected ? String(principal.boxes_expected) : '« x of N » de l’étiquette'}
            className={`${inputClass} w-40`}
          />
        </label>

        {principal && (
          <p className="mt-3 rounded-xl bg-slate-50 p-3 text-slate-700 dark:bg-slate-800 dark:text-slate-200">
            Après la fusion : colis <span className="font-mono font-bold">{principal.tracking_number || 'sans n°'}</span>,{' '}
            {boxesAfter} boîte(s) reçue(s){(boxCount ?? principal.boxes_expected) ? ` sur ${boxCount ?? principal.boxes_expected}` : ''}
            {boxesAfter > 0 && (principal.status === 'lost' || principal.status === 'to_receive')
              ? `, il passe « reçu »${principal.status === 'lost' ? ' (la perte est annulée)' : ''}`
              : ''}
            .
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2 border-t border-slate-100 pt-4 dark:border-slate-800">
          <button
            onClick={onClose}
            className="rounded-xl border border-slate-200 px-4 py-2 font-bold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300"
          >
            Annuler
          </button>
          <button
            onClick={submit}
            disabled={saving || !principal}
            className="flex items-center gap-2 rounded-xl bg-[#623387] px-4 py-2 font-bold text-white hover:bg-[#522870] disabled:opacity-50"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} Fusionner
          </button>
        </div>
      </div>
    </div>
  );
};
