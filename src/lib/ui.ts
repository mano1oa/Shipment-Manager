/**
 * Shared look of the redesign (NextHope 2026): neutral white cards on a light
 * violet-grey ground, color kept for statuses only.
 */
export const ui = {
  card: 'rounded-2xl border border-[#E7E4EC] bg-white dark:border-slate-800 dark:bg-slate-900',
  /** Grey inner block (inside a card). */
  well: 'rounded-xl bg-[#F8F7FA] dark:bg-slate-800/60',
  title: 'text-[#17111F] dark:text-white',
  text: 'text-[#3A3444] dark:text-slate-300',
  muted: 'text-[#5E5869] dark:text-slate-400',
  sectionTitle: 'text-[15px] font-semibold text-[#17111F] dark:text-white',
  /** Neutral outlined button. */
  button:
    'inline-flex items-center justify-center gap-2 rounded-xl border border-[#E1DDE7] bg-white px-3.5 text-sm font-semibold text-[#17111F] transition hover:bg-[#F5F4F7] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800',
  /** Segmented control (tabs). */
  segmented: 'inline-flex flex-wrap rounded-xl bg-[#ECE9F0] p-1 dark:bg-slate-800',
  segment: (active: boolean) =>
    `inline-flex items-center gap-2 rounded-[9px] px-4 py-2 text-[13px] transition ${
      active
        ? 'bg-white font-semibold text-[#17111F] shadow-sm dark:bg-slate-950 dark:text-white'
        : 'font-medium text-[#5E5869] hover:text-[#17111F] dark:text-slate-400 dark:hover:text-white'
    }`,
};
