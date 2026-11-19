import type { DigiInvoice } from '../components/digiApi';

/** Invoice matching a search (supplier, n°, Amazon order, sale invoice, buyer, article). */
export const invoiceMatches = (inv: DigiInvoice, query: string) => {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [
    inv.supplier_name,
    inv.supplier_display,
    inv.ref,
    inv.amazon_order_ref,
    inv.sale_move_ref,
    inv.odoo_move_name,
    inv.buyer,
    ...inv.lines.map((l) => l.name),
  ].some((v) => v && v.toLowerCase().includes(q));
};
