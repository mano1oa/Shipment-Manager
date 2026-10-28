/**
 * Display formats: DD-MM-YYYY and DD-MM-YYYY HH:mm.
 *
 * Display only: dates are stored and exchanged as YYYY-MM-DD (or ISO), the
 * format the date inputs, the rules engine and the database expect.
 */

const pad = (n: number) => String(n).padStart(2, '0');

const fromDate = (d: Date, withTime: boolean) => {
  const date = `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`;
  return withTime ? `${date} ${pad(d.getHours())}:${pad(d.getMinutes())}` : date;
};

/**
 * "2026-10-21" → "21-10-2026"; "2026-10-21 14:05" → "21-10-2026 14:05";
 * ISO timestamp → local date. Any other text (e.g. "Non parti") is returned unchanged.
 */
export function formatDate(value?: string | null, fallback = '—'): string {
  if (!value || !value.trim()) return fallback;
  const text = value.trim();

  const plain = /^(\d{4})-(\d{2})-(\d{2})(?:[ ](\d{2}:\d{2}))?$/.exec(text);
  if (plain) {
    const [, y, m, d, time] = plain;
    return time ? `${d}-${m}-${y} ${time}` : `${d}-${m}-${y}`;
  }

  if (/^\d{4}-\d{2}-\d{2}T/.test(text)) {
    const d = new Date(text);
    if (!isNaN(d.getTime())) return fromDate(d, false);
  }

  return text;
}

/** Timestamp (ISO or Date) → "DD-MM-YYYY HH:mm" in local time. */
export function formatDateTime(value?: string | Date | null, fallback = '—'): string {
  if (!value) return fallback;
  const d = value instanceof Date ? value : new Date(value);
  return isNaN(d.getTime()) ? fallback : fromDate(d, true);
}

/** Today as "DD-MM-YYYY". */
export const formatToday = () => fromDate(new Date(), false);
