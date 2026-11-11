/** Room of shipments.supplier (VARCHAR 255). */
export const SUPPLIER_LABEL_MAX = 255;

/**
 * Supplier label of a shipment from its invoices: the names themselves
 * ("Fournisseur A, Fournisseur B"), each once, in invoice order — no longer
 * "3 fournisseurs", which hid them from search, tables and claims. Cut with
 * "… (+N)" when the names do not fit the column.
 */
export function shipmentSupplierLabel(names: (string | null | undefined)[]): string {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const raw of names) {
    const name = (raw || '').trim();
    if (!name || name === '—') continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(name);
  }
  if (unique.length === 0) return '—';

  const full = unique.join(', ');
  if (full.length <= SUPPLIER_LABEL_MAX) return full;

  // Keep as many whole names as fit, then say how many are left out
  for (let kept = unique.length - 1; kept >= 1; kept--) {
    const label = `${unique.slice(0, kept).join(', ')}… (+${unique.length - kept})`;
    if (label.length <= SUPPLIER_LABEL_MAX) return label;
  }
  return `${unique[0].slice(0, SUPPLIER_LABEL_MAX - 12)}… (+${unique.length - 1})`;
}
