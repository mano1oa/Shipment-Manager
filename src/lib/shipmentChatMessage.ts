/**
 * Google Chat memo posted when a shipment Orly / Rouen → Madagascar is
 * confirmed: the other suppliers first (Fournisseur - N° colis - N° facture,
 * one line per invoice, "(N Colis)" when it has several parcels), then the
 * Amazon parcels (N° colis - N° commande Amazon - N° facture, one line per
 * parcel and invoice).
 */

export interface ChatMessageInvoice {
  id: string;
  ref: string | null;
  /** AMAZON for an Amazon order (see trackingSupplierName). */
  supplier: string | null;
  amazon_order_ref: string | null;
}

export interface ChatMessageParcel {
  tracking_number: string | null;
  invoice_ids: string[];
}

const isAmazon = (inv: ChatMessageInvoice) => (inv.supplier || '').trim().toUpperCase() === 'AMAZON';
const join = (parts: (string | null | undefined)[]) =>
  parts.map((p) => (p || '').trim()).filter(Boolean).join(' - ');

/** "2026-11-03" → "03/11/2026". */
const chatDate = (isoDate: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : isoDate;
};

export function shipmentChatMessage(
  date: string,
  invoices: ChatMessageInvoice[],
  parcels: ChatMessageParcel[],
  destName = 'NextHope'
): string {
  const parcelsOf = (invoiceId: string) => parcels.filter((p) => p.invoice_ids.includes(invoiceId));
  const numbers = (list: ChatMessageParcel[]) =>
    list.map((p) => p.tracking_number?.trim()).filter((n): n is string => Boolean(n));

  const others = invoices
    .filter((inv) => !isAmazon(inv))
    .map((inv) => {
      const own = parcelsOf(inv.id);
      const line = join([inv.supplier, numbers(own).join(', '), inv.ref]);
      return own.length > 1 ? `${line} (${own.length} Colis)` : line;
    });

  const amazon = invoices.filter(isAmazon).flatMap((inv) => {
    const own = parcelsOf(inv.id);
    if (own.length === 0) return [join([inv.amazon_order_ref, inv.ref])];
    return own.map((p) => join([p.tracking_number, inv.amazon_order_ref, inv.ref]));
  });

  const bullets = (lines: string[]) => lines.map((l) => `• ${l}`).join('\n');
  const parts = [`Pour mémo, ci-après nos colis facturés ${destName} ce ${chatDate(date)}`];
  if (others.length > 0) parts.push(bullets(others));
  if (amazon.length > 0) parts.push(`\nCi-après les AMAZON :\n${bullets(amazon)}`);
  return parts.join('\n');
}
