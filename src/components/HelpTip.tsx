import React, { useEffect, useRef, useState } from 'react';
import { HelpCircle } from 'lucide-react';

/** Small « ? » next to a title: the long explanation opens on click. */
export const HelpTip: React.FC<{ label?: string; children: React.ReactNode }> = ({ label = 'Aide', children }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onClick);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <span ref={ref} className="relative inline-flex align-middle">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={label}
        aria-expanded={open}
        className="flex h-7 w-7 items-center justify-center rounded-full text-[#6f6979] transition hover:bg-[#ECE9F0] hover:text-[#623387] dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-[#B688FF]"
      >
        <HelpCircle className="h-4 w-4" />
      </button>
      {open && (
        <span
          role="note"
          className="absolute left-0 top-full z-40 mt-2 block w-[min(26rem,calc(100vw-2rem))] rounded-xl border border-[#E7E4EC] bg-white p-4 text-left text-[13px] font-normal leading-relaxed text-[#3A3444] shadow-xl dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
        >
          {children}
        </span>
      )}
    </span>
  );
};
