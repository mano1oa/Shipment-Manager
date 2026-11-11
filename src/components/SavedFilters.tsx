import React, { useState } from 'react';
import { Bookmark, BookmarkPlus, X } from 'lucide-react';

/** A named set of filters, kept in this browser. */
export interface SavedFilter<T> {
  name: string;
  value: T;
}

const read = <T,>(key: string): SavedFilter<T>[] => {
  try {
    const list = JSON.parse(localStorage.getItem(`saved_filters:${key}`) || '[]');
    return Array.isArray(list) ? list.filter((f) => f && typeof f.name === 'string' && f.value) : [];
  } catch {
    return [];
  }
};

interface Props<T> {
  /** One list of saved filters per screen (e.g. "parcels-ORLY"). */
  storageKey: string;
  /** Filters in use now (what « Enregistrer » keeps). */
  current: T;
  /** True when the current filters are the default ones (nothing to save). */
  isDefault: boolean;
  onApply: (value: T) => void;
  /** Same filters as a saved one: shown as active. */
  equals: (a: T, b: T) => boolean;
}

/**
 * « Mes filtres »: one click brings back a set of filters saved under a name
 * (« Amazon en retard », « Rouen reçus cette semaine »…).
 */
export function SavedFilters<T>({ storageKey, current, isDefault, onApply, equals }: Props<T>) {
  const [list, setList] = useState<SavedFilter<T>[]>(() => read<T>(storageKey));
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');

  const persist = (next: SavedFilter<T>[]) => {
    setList(next);
    try {
      localStorage.setItem(`saved_filters:${storageKey}`, JSON.stringify(next));
    } catch {
      // storage unavailable: kept for this visit only
    }
  };

  const save = () => {
    const n = name.trim();
    if (!n) return;
    persist([...list.filter((f) => f.name !== n), { name: n, value: current }]);
    setName('');
    setNaming(false);
  };

  if (list.length === 0 && isDefault && !naming) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 text-[13px]">
      {list.length > 0 && (
        <span className="flex items-center gap-1.5 font-medium text-[#5E5869] dark:text-slate-400">
          <Bookmark className="h-3.5 w-3.5" /> Mes filtres
        </span>
      )}
      {list.map((f) => {
        const active = equals(f.value, current);
        return (
          <span
            key={f.name}
            className={`flex h-8 items-center rounded-full border pl-3 pr-1 ${
              active
                ? 'border-[#623387] bg-[#F1E9F8] text-[#623387] dark:border-[#B688FF] dark:bg-purple-950/40 dark:text-[#D7BCE8]'
                : 'border-[#E1DDE7] bg-white text-[#3A3444] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'
            }`}
          >
            <button type="button" onClick={() => onApply(f.value)} className="font-semibold">
              {f.name}
            </button>
            <button
              type="button"
              onClick={() => persist(list.filter((x) => x.name !== f.name))}
              aria-label={`Supprimer le filtre ${f.name}`}
              className="ml-1 flex h-6 w-6 items-center justify-center rounded-full opacity-60 hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        );
      })}
      {naming ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
          className="flex items-center gap-1.5"
        >
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setNaming(false)}
            placeholder="Nom du filtre"
            aria-label="Nom du filtre"
            className="h-8 w-44 rounded-lg border border-[#E1DDE7] bg-white px-2.5 text-[13px] focus:border-[#623387] focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          />
          <button type="submit" disabled={!name.trim()} className="h-8 rounded-lg bg-[#623387] px-3 font-semibold text-white disabled:opacity-50">
            Enregistrer
          </button>
          <button type="button" onClick={() => setNaming(false)} className="h-8 rounded-lg px-2 text-[#5E5869] hover:bg-[#F5F4F7] dark:text-slate-400 dark:hover:bg-slate-800">
            Annuler
          </button>
        </form>
      ) : (
        !isDefault && (
          <button
            type="button"
            onClick={() => setNaming(true)}
            className="flex h-8 items-center gap-1.5 rounded-full border border-dashed border-[#C9B6DD] px-3 font-semibold text-[#623387] hover:bg-[#FAF6FD] dark:border-purple-800 dark:text-[#B688FF] dark:hover:bg-purple-950/30"
          >
            <BookmarkPlus className="h-3.5 w-3.5" /> Enregistrer ce filtre
          </button>
        )
      )}
    </div>
  );
}
