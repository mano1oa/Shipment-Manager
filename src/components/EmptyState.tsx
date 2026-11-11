import React from 'react';

/** Grey placeholder rows while a table loads (instead of a lone spinner). */
export const SkeletonRows: React.FC<{ columns: number; rows?: number }> = ({ columns, rows = 6 }) => (
  <>
    {Array.from({ length: rows }, (_, r) => (
      <tr key={r} aria-hidden="true">
        {Array.from({ length: columns }, (_, c) => (
          <td key={c} className="px-3 py-3.5">
            <span
              className="block h-3 animate-pulse rounded-full bg-[#ECE9F0] dark:bg-slate-800"
              style={{ width: `${c === 0 ? 40 : 45 + ((r * 7 + c * 13) % 45)}%` }}
            />
          </td>
        ))}
      </tr>
    ))}
  </>
);

/** Friendly empty list: an icon, one sentence, an optional way out. */
export const EmptyState: React.FC<{
  icon: React.ElementType;
  title: string;
  detail?: string;
  action?: { label: string; onClick: () => void };
}> = ({ icon: Icon, title, detail, action }) => (
  <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
    <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[#F1EEF5] text-[#623387] dark:bg-slate-800 dark:text-[#B688FF]">
      <Icon className="h-5 w-5" />
    </span>
    <p className="text-sm font-semibold text-[#17111F] dark:text-white">{title}</p>
    {detail && <p className="max-w-sm text-[13px] text-[#5E5869] dark:text-slate-400">{detail}</p>}
    {action && (
      <button
        type="button"
        onClick={action.onClick}
        className="mt-1 rounded-lg border border-[#E1DDE7] px-3 py-1.5 text-[13px] font-semibold text-[#623387] hover:bg-[#FAF6FD] dark:border-slate-700 dark:text-[#B688FF] dark:hover:bg-slate-800"
      >
        {action.label}
      </button>
    )}
  </div>
);
