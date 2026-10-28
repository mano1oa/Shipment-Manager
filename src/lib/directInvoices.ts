/**
 * "Hors DIGI" invoices: supplier invoices that do not go through DIGI LOGISTIC
 * but still need parcel tracking. Entered by hand, without item lines.
 * Shared by the browser (form) and the server (API validation).
 */
import { DIGI_TEXT_MAX_LENGTH, parseDateValue } from './digiInvoices.js';
import { CURRENCIES } from './parcelTracking.js';
import type { Currency } from './parcelTracking.js';

export interface DirectInvoiceInput {
  supplier_name: string;
  ref: string;
  invoice_date: string; // YYYY-MM-DD
  amount: number;
  currency: Currency;
  buyer: string;
}

export const DIRECT_INVOICE_MAX_AMOUNT = 1e10;

function requiredText(value: unknown, label: string, errors: string[]): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) errors.push(`${label} : obligatoire.`);
  else if (text.length > DIGI_TEXT_MAX_LENGTH) errors.push(`${label} : ${DIGI_TEXT_MAX_LENGTH} caractères maximum.`);
  return text;
}

export function validateDirectInvoiceInput(raw: any): { value: DirectInvoiceInput | null; errors: string[] } {
  const errors: string[] = [];
  if (!raw || typeof raw !== 'object') return { value: null, errors: ['Facture invalide.'] };

  const supplier = requiredText(raw.supplier_name, 'Fournisseur', errors);
  const ref = requiredText(raw.ref, 'Référence', errors);
  const buyer = requiredText(raw.buyer, 'Acheteur / demandeur', errors);

  const invoiceDate = typeof raw.invoice_date === 'string' ? parseDateValue(raw.invoice_date) : undefined;
  if (!invoiceDate) errors.push('Date de facture : obligatoire (JJ/MM/AAAA).');

  const amount = raw.amount;
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0 || amount >= DIRECT_INVOICE_MAX_AMOUNT) {
    errors.push('Montant : nombre positif obligatoire.');
  }
  if (!(CURRENCIES as readonly string[]).includes(raw.currency)) {
    errors.push(`Devise : ${CURRENCIES.join(' ou ')}.`);
  }

  if (errors.length > 0) return { value: null, errors };
  return {
    value: {
      supplier_name: supplier,
      ref,
      invoice_date: invoiceDate as string,
      amount: Math.round(amount * 100) / 100,
      currency: raw.currency,
      buyer,
    },
    errors,
  };
}
