import React, { useState } from 'react';
import { Camera, Loader2, Plus, Trash2 } from 'lucide-react';
import { PARCEL_NUMBER_KINDS, PARCEL_NUMBER_KIND_LABELS, boxSummary, parcelNumberKindText } from '../lib/parcelBoxes';
import type { ParcelNumberKind } from '../lib/parcelBoxes';
import { Parcel, addParcelNumber, formatDate, inputClass, removeParcelNumber } from './digiApi';

interface Props {
  parcel: Parcel;
  /** Saved at once (not with the form): the parcel as it is now. */
  onChanged: (parcel: Parcel) => void;
}

/**
 * Parcel form, existing parcel: its other numbers (supplier, carrier, box —
 * any of them finds the parcel) and the boxes received (one per photo matched
 * at a point).
 */
export const ParcelBoxesSection: React.FC<Props> = ({ parcel, onChanged }) => {
  const [kind, setKind] = useState<ParcelNumberKind>('supplier');
  const [number, setNumber] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const summary = boxSummary(parcel);
  const label = 'font-semibold text-slate-700 dark:text-slate-300';

  const run = async (action: () => Promise<Parcel>) => {
    setBusy(true);
    setError(null);
    try {
      onChanged(await action());
      setNumber('');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4 space-y-4 border-t border-slate-100 pt-4 dark:border-slate-800">
      <div>
        <span className={label}>Autres n° (BL / transporteur / pièce)</span>
        <p className="text-[10px] text-slate-500">Quel que soit le n° saisi au Point ou dans la recherche, on retombe sur ce colis.</p>
        {parcel.numbers.length > 0 && (
          <ul className="mt-1 space-y-1">
            {parcel.numbers.map((n) => (
              <li key={n.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-2 py-1 dark:border-slate-700">
                <span>
                  <span className="text-slate-500">{PARCEL_NUMBER_KIND_LABELS[n.kind]} :</span>{' '}
                  <span className="font-mono font-semibold">{n.number}</span>
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    window.confirm(`Supprimer le ${parcelNumberKindText(n.kind)} ${n.number} ?`) &&
                    run(() => removeParcelNumber(parcel.id, n.id))
                  }
                  title="Supprimer ce n°"
                  className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50 dark:hover:bg-rose-950/40"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-1 flex gap-1.5">
          <select value={kind} onChange={(e) => setKind(e.target.value as ParcelNumberKind)} className={`${inputClass} w-40`}>
            {PARCEL_NUMBER_KINDS.map((k) => (
              <option key={k} value={k}>
                {PARCEL_NUMBER_KIND_LABELS[k]}
              </option>
            ))}
          </select>
          <input
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            onKeyDown={(e) => {
              // Enter adds the number, it does not submit the form
              if (e.key === 'Enter') {
                e.preventDefault();
                if (number.trim()) run(() => addParcelNumber(parcel.id, number, kind));
              }
            }}
            placeholder="N°"
            className={`${inputClass} font-mono`}
          />
          <button
            type="button"
            disabled={busy || !number.trim()}
            onClick={() => run(() => addParcelNumber(parcel.id, number, kind))}
            className="flex shrink-0 items-center gap-1 rounded-xl border border-slate-200 px-2.5 font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:text-slate-300"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Ajouter
          </button>
        </div>
        {error && <p className="mt-1 text-[11px] font-semibold text-rose-600">{error}</p>}
      </div>

      <div>
        <span className={label}>
          Boîtes reçues : {summary.received}
          {summary.expected !== null ? ` / ${summary.expected}` : ''}
        </span>
        {summary.over && (
          <p className="text-[11px] font-semibold text-rose-600">Plus de boîtes que prévu : une photo est peut-être en double.</p>
        )}
        {parcel.boxes.length === 0 ? (
          <p className="text-[10px] text-slate-500">Aucune boîte reçue.</p>
        ) : (
          <ul className="mt-1 space-y-1">
            {parcel.boxes.map((b, i) => (
              <li key={b.id} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-2 py-1 dark:bg-slate-800">
                <span>
                  <span className="font-semibold">Boîte {b.box_index ?? i + 1}</span>
                  {parcel.boxes_expected ? ` / ${parcel.boxes_expected}` : ''} · reçue le {formatDate(b.received_at)}
                  {b.point_date ? ' (point)' : ' (sans photo)'}
                  {b.piece_number && (
                    <>
                      {' '}
                      · n° <span className="font-mono">{b.piece_number}</span>
                    </>
                  )}
                </span>
                {b.photo_id && (
                  <a
                    href={`/api/photos/${b.photo_id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 text-[#623387] hover:underline dark:text-[#B688FF]"
                  >
                    <Camera className="h-3.5 w-3.5" /> Photo
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};
