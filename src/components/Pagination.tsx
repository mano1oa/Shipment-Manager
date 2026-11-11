import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { ui } from '../lib/ui';

/** Rows per page offered (0 = everything, like Odoo's "show all"). */
export const PAGE_SIZES = [80, 100, 200, 0] as const;
const DEFAULT_PAGE_SIZE = 80;

const readSize = (key: string) => {
  try {
    const v = Number(localStorage.getItem(`page_size:${key}`));
    return (PAGE_SIZES as readonly number[]).includes(v) ? v : DEFAULT_PAGE_SIZE;
  } catch {
    return DEFAULT_PAGE_SIZE;
  }
};

/**
 * Long lists in pages. The page size is remembered per list in this browser;
 * `resetKey` (filters, search…) brings the list back to its first page.
 */
export function usePagination<T>(items: T[], storageKey: string, resetKey: unknown) {
  const [size, setSizeState] = useState(() => readSize(storageKey));
  const [page, setPage] = useState(1);
  const pageCount = size === 0 ? 1 : Math.max(1, Math.ceil(items.length / size));

  useEffect(() => setPage(1), [resetKey, size]);
  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  const pageItems = useMemo(
    () => (size === 0 ? items : items.slice((page - 1) * size, page * size)),
    [items, page, size]
  );

  const setSize = (next: number) => {
    setSizeState(next);
    try {
      localStorage.setItem(`page_size:${storageKey}`, String(next));
    } catch {
      // storage unavailable: the size applies for this visit only
    }
  };

  return { pageItems, page, setPage, pageCount, size, setSize, total: items.length };
}

interface PaginationProps {
  page: number;
  pageCount: number;
  size: number;
  total: number;
  onPage: (page: number) => void;
  onSize: (size: number) => void;
  /** "colis", "factures"… */
  unit: string;
  className?: string;
}

/** "1–80 sur 284 colis · ‹ › · Lignes par page [80]". */
export const Pagination: React.FC<PaginationProps> = ({ page, pageCount, size, total, onPage, onSize, unit, className = '' }) => {
  if (total === 0) return null;
  const from = size === 0 ? 1 : (page - 1) * size + 1;
  const to = size === 0 ? total : Math.min(page * size, total);
  const arrow =
    'flex h-9 w-9 items-center justify-center rounded-lg border border-[#E1DDE7] bg-white text-[#17111F] transition hover:bg-[#F5F4F7] disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800';

  return (
    <div className={`flex flex-wrap items-center justify-between gap-3 text-[13px] ${ui.muted} ${className}`}>
      <span className="tabular-nums">
        <strong className={`font-semibold ${ui.title}`}>
          {from}–{to}
        </strong>{' '}
        sur {total} {unit}
      </span>
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2">
          Lignes par page
          <select
            value={size}
            onChange={(e) => onSize(Number(e.target.value))}
            className="h-9 rounded-lg border border-[#E1DDE7] bg-white px-2 text-[13px] text-[#17111F] focus:border-[#623387] focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          >
            {PAGE_SIZES.map((s) => (
              <option key={s} value={s}>
                {s === 0 ? 'Tout' : s}
              </option>
            ))}
          </select>
        </label>
        {pageCount > 1 && (
          <div className="flex items-center gap-1.5">
            <button type="button" className={arrow} onClick={() => onPage(page - 1)} disabled={page <= 1} aria-label="Page précédente">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="min-w-[4.5rem] text-center tabular-nums">
              Page {page} / {pageCount}
            </span>
            <button type="button" className={arrow} onClick={() => onPage(page + 1)} disabled={page >= pageCount} aria-label="Page suivante">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
