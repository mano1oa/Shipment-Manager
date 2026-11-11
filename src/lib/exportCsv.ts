/**
 * « Exporter » on the lists: a CSV file Excel opens directly (French Excel:
 * ";" separator, UTF-8 with BOM so accents display correctly).
 */
export type CsvValue = string | number | null | undefined;

const cell = (v: CsvValue) => {
  if (v === null || v === undefined) return '';
  const text = typeof v === 'number' ? String(v).replace('.', ',') : String(v);
  return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export function toCsv(headers: string[], rows: CsvValue[][]): string {
  return [headers, ...rows].map((r) => r.map(cell).join(';')).join('\r\n');
}

export function downloadCsv(baseName: string, headers: string[], rows: CsvValue[][]) {
  const blob = new Blob(['﻿' + toCsv(headers, rows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${baseName}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
