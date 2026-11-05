import React, { useEffect, useRef, useState } from 'react';
import { CalendarDays } from 'lucide-react';
import { formatDate } from '../lib/dateFormat';

/**
 * Date field typed and shown as DD-MM-YYYY whatever the browser language (the
 * native date input follows it, e.g. MM/DD/YYYY in an English browser). The
 * value in and out stays YYYY-MM-DD ('' = empty); onChange only fires for a
 * complete valid date (within min/max) or an emptied field. The calendar
 * button opens the native picker.
 */
interface DateInputProps {
  value: string;
  onChange: (value: string) => void;
  min?: string;
  max?: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  /** Width of the field (full width by default). */
  wrapperClassName?: string;
  'aria-label'?: string;
}

const toIso = (text: string): string | null => {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(text);
  if (!m) return null;
  const [, d, mo, y] = m;
  const date = new Date(Number(y), Number(mo) - 1, Number(d));
  if (date.getFullYear() !== Number(y) || date.getMonth() !== Number(mo) - 1 || date.getDate() !== Number(d)) return null;
  return `${y}-${mo}-${d}`;
};

/** Keeps the digits and puts the dashes: "05112026" → "05-11-2026". */
const mask = (raw: string) => {
  const digits = raw.replace(/\D/g, '').slice(0, 8);
  return [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4)].filter(Boolean).join('-');
};

export default function DateInput({ value, onChange, min, max, disabled, required, className, wrapperClassName = 'w-full', ...rest }: DateInputProps) {
  const [text, setText] = useState(value ? formatDate(value) : '');
  const picker = useRef<HTMLInputElement>(null);

  // Value changed from outside (or by the picker): show it
  useEffect(() => {
    setText((current) => (toIso(current) === value ? current : value ? formatDate(value) : ''));
  }, [value]);

  const iso = toIso(text);
  const invalid = text !== '' && (!iso || (min && iso < min) || (max && iso > max));

  const handleText = (raw: string) => {
    const next = mask(raw);
    setText(next);
    if (next === '') return onChange('');
    const parsed = toIso(next);
    if (parsed && (!min || parsed >= min) && (!max || parsed <= max)) onChange(parsed);
  };

  const openPicker = () => {
    const el = picker.current;
    if (!el) return;
    try {
      el.showPicker();
    } catch {
      el.focus();
    }
  };

  return (
    <span className={`relative inline-flex items-center ${wrapperClassName}`}>
      <input
        type="text"
        inputMode="numeric"
        placeholder="JJ-MM-AAAA"
        value={text}
        disabled={disabled}
        required={required}
        onChange={(e) => handleText(e.target.value)}
        // Leaving an incomplete or invalid date: back to the last valid value
        onBlur={() => invalid && setText(value ? formatDate(value) : '')}
        aria-invalid={invalid || undefined}
        className={`${className ?? ''} w-full pr-8 ${invalid ? '!border-rose-400' : ''}`}
        aria-label={rest['aria-label']}
      />
      <button
        type="button"
        onClick={openPicker}
        disabled={disabled}
        tabIndex={-1}
        aria-label="Ouvrir le calendrier"
        className="absolute right-2 text-slate-400 hover:text-slate-600 disabled:opacity-40 dark:hover:text-slate-200"
      >
        <CalendarDays className="h-4 w-4" />
      </button>
      <input
        ref={picker}
        type="date"
        value={value}
        min={min}
        max={max}
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => onChange(e.target.value)}
        className="pointer-events-none absolute bottom-0 right-0 h-0 w-0 opacity-0"
      />
    </span>
  );
}
