/**
 * Links a shipment to its DIGI LOGISTIC → NextHope invoice to show the
 * shipment value held by the invoice (sum of its lines).
 *
 * Matching keys (case, spaces and dashes ignored):
 *   shipment.ref_fa_digi_nxt ↔ invoice Odoo name, sale invoice or supplier ref
 *   shipment.invoice_no      ↔ invoice supplier ref or Odoo name
 *
 * Nothing is invented: no match, an invoice without amount, or several
 * invoices with different amounts for the same key → no value.
 */

export interface DigiInvoiceForValue {
  ref: string | null;
  odoo_move_name: string | null;
  sale_move_ref: string | null;
  odoo_missing?: boolean;
  amount_total: number | null;
}

export interface ShipmentForValue {
  ref_fa_digi_nxt?: string | null;
  invoice_no?: string | null;
}

export interface DigiValueMatch {
  amount: number;
  /** Invoice reference shown next to the value. */
  invoiceLabel: string;
}

const AMBIGUOUS = Symbol('ambiguous');

export function normalizeInvoiceKey(value: string | null | undefined): string {
  return (value ?? '').toUpperCase().replace(/[\s\-_]/g, '');
}

export function buildDigiValueLookup(
  invoices: DigiInvoiceForValue[]
): (shipment: ShipmentForValue) => DigiValueMatch | null {
  const index = new Map<string, DigiValueMatch | typeof AMBIGUOUS>();

  for (const inv of invoices) {
    if (inv.odoo_missing || inv.amount_total === null) continue;
    const match: DigiValueMatch = {
      amount: inv.amount_total,
      invoiceLabel: `Facture DIGI ${inv.odoo_move_name || inv.ref || inv.sale_move_ref || ''}`.trim(),
    };
    const keys = new Set(
      [inv.ref, inv.odoo_move_name, inv.sale_move_ref].map(normalizeInvoiceKey).filter(Boolean)
    );
    for (const key of keys) {
      const existing = index.get(key);
      if (existing === undefined) {
        index.set(key, match);
      } else if (existing !== AMBIGUOUS && existing.amount !== match.amount) {
        index.set(key, AMBIGUOUS);
      }
    }
  }

  return (shipment) => {
    for (const raw of [shipment.ref_fa_digi_nxt, shipment.invoice_no]) {
      const key = normalizeInvoiceKey(raw);
      if (!key) continue;
      const found = index.get(key);
      if (found && found !== AMBIGUOUS) return found;
    }
    return null;
  };
}
