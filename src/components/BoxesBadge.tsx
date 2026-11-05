import React from 'react';
import { boxSummary } from '../lib/parcelBoxes';
import type { Parcel } from './digiApi';

/**
 * Boxes received next to the status: "2/3 boîtes", "Complet 3/3", or
 * "2 boîtes" without count. Nothing for a single box without count.
 */
export const BoxesBadge: React.FC<{ parcel: Pick<Parcel, 'boxes' | 'boxes_expected'> }> = ({ parcel }) => {
  const s = boxSummary(parcel);
  if (!s.label) return null;
  const tone = s.over
    ? 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
    : s.expected !== null && !s.complete
      ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
      : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300';
  return (
    <span
      className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold ${tone}`}
      title={s.over ? 'Plus de boîtes reçues que prévu : doublon de photo probable' : undefined}
    >
      {s.label}
      {s.over && ' ⚠'}
    </span>
  );
};
