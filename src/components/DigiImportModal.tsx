import React, { useState } from 'react';
import { AlertCircle, CheckCircle2, FileSpreadsheet, Loader2, Upload, X } from 'lucide-react';
import { readSheet } from 'read-excel-file/browser';
import { parseDigiSheet, SheetParseResult } from '../lib/digiInvoices';
import { DigiImportResult, formatAmount, formatDate, importDigiInvoices } from './digiApi';

interface Props {
  destination: string;
  maxInvoices: number;
  onClose: () => void;
  onImported: () => void;
}

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const PREVIEW_ROWS = 20;
const SHOWN_ERRORS = 50;

/** CSV exported by Excel (";" in French locale, "," otherwise), with quoted fields. */
function parseCsv(text: string): string[][] {
  const firstLine = text.slice(0, text.indexOf('\n') > -1 ? text.indexOf('\n') : undefined);
  const delimiter = (firstLine.match(/;/g)?.length ?? 0) >= (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === delimiter) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += c;
    }
  }
  if (field || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

async function readRows(file: File): Promise<unknown[][]> {
  if (/\.csv$/i.test(file.name)) {
    return parseCsv((await file.text()).replace(/^﻿/, ''));
  }
  return (await readSheet(file)) as unknown[][];
}

export const DigiImportModal: React.FC<Props> = ({ destination, maxInvoices, onClose, onImported }) => {
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parsed, setParsed] = useState<SheetParseResult | null>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<DigiImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFile = async (file: File | undefined) => {
    setParsed(null);
    setResult(null);
    setError(null);
    if (!file) return;
    if (!/\.(xlsx|csv)$/i.test(file.name)) {
      setError('Format non pris en charge : utilisez un fichier .xlsx ou .csv (les anciens .xls doivent être réenregistrés en .xlsx).');
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setError('Fichier trop volumineux (10 Mo maximum).');
      return;
    }

    setFileName(file.name);
    setParsing(true);
    try {
      setParsed(parseDigiSheet(await readRows(file), destination));
    } catch (err: any) {
      console.error('[DIGI Import] Could not read file:', err);
      setError('Impossible de lire ce fichier. Vérifiez qu\'il s\'agit bien d\'un export Excel valide.');
    } finally {
      setParsing(false);
    }
  };

  const handleImport = async () => {
    if (!parsed || parsed.invoices.length === 0 || !fileName) return;
    setImporting(true);
    setError(null);
    try {
      setResult(await importDigiInvoices(parsed.invoices, fileName));
      onImported();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setImporting(false);
    }
  };

  const totalLines = parsed?.invoices.reduce((sum, inv) => sum + inv.lines.length, 0) ?? 0;
  const tooMany = (parsed?.invoices.length ?? 0) > maxInvoices;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs overflow-y-auto">
      <div className="w-full max-w-4xl rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-900 my-8 text-xs">
        <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-600 text-white shadow-sm">
              <FileSpreadsheet className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-extrabold text-slate-900 dark:text-white">Importer un fichier Excel DIGI</h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Première feuille du classeur · une ligne par ligne de facture
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-4 space-y-4">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-slate-600 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300">
            <p className="font-semibold text-slate-800 dark:text-slate-100">Colonnes reconnues (libellés Odoo ou noms techniques)</p>
            <p className="mt-1">
              Fournisseur (partner_id) *, Référence (ref) *, Date de facturation (invoice_date), Commande AMAZON
              (num_cmd_amz), Facture Vente (sale_move_id), Entité de destination (dest_partner_id), Lignes de
              facture/Libellé, Quantité, Prix, Sous-total.
            </p>
            <p className="mt-1">
              Si la colonne « Entité de destination » est présente, seules les factures {destination} sont importées.
              Une facture déjà connue (même fournisseur et même référence) n'est jamais écrasée.
            </p>
          </div>

          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 p-5 font-semibold text-slate-600 hover:border-[#643288] hover:text-[#643288] dark:border-slate-700 dark:text-slate-300">
            {parsing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {fileName ? `Fichier : ${fileName} — choisir un autre fichier` : 'Choisir un fichier .xlsx ou .csv'}
            <input
              type="file"
              accept=".xlsx,.csv"
              className="hidden"
              onChange={(e) => {
                handleFile(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </label>

          {error && (
            <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 font-semibold text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300">
              <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
              <span>{error}</span>
            </div>
          )}

          {result && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300">
              <p className="flex items-center gap-2 font-bold">
                <CheckCircle2 className="h-4 w-4" /> {result.created} facture(s) importée(s)
              </p>
              {result.duplicates.length > 0 && (
                <p className="mt-1">
                  {result.duplicates.length} déjà présente(s), laissée(s) inchangée(s) :{' '}
                  {result.duplicates.slice(0, 30).join(', ')}
                  {result.duplicates.length > 30 ? '…' : ''}
                </p>
              )}
              {result.rejected.length > 0 && (
                <p className="mt-1 text-rose-700 dark:text-rose-300">
                  {result.rejected.length} refusée(s) par le serveur :{' '}
                  {result.rejected.slice(0, 10).map((r) => `${r.ref ?? '?'} (${r.errors.join(' ')})`).join(' ; ')}
                </p>
              )}
            </div>
          )}

          {parsed && !result && (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  { label: 'Factures à importer', value: parsed.invoices.length, tone: 'text-[#643288]' },
                  { label: 'Lignes de produits', value: totalLines, tone: 'text-slate-800 dark:text-slate-100' },
                  {
                    label: `Hors ${destination} (ignorées)`,
                    value: parsed.hasDestinationColumn ? parsed.skippedOtherDestination : '—',
                    tone: 'text-slate-500',
                  },
                  { label: 'Factures en erreur', value: parsed.rejectedInvoices, tone: 'text-rose-600' },
                ].map((tile) => (
                  <div key={tile.label} className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{tile.label}</p>
                    <p className={`mt-1 text-lg font-extrabold ${tile.tone}`}>{tile.value}</p>
                  </div>
                ))}
              </div>

              {!parsed.hasDestinationColumn && parsed.invoices.length > 0 && (
                <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 font-semibold text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300">
                  Pas de colonne « Entité de destination » : toutes les factures du fichier seront importées. Vérifiez
                  qu'il ne contient que des factures {destination}.
                </p>
              )}

              {parsed.errors.length > 0 && (
                <div className="max-h-40 overflow-y-auto rounded-xl border border-rose-200 bg-rose-50 p-3 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300">
                  <p className="font-bold">Lignes non lues (les factures concernées ne seront pas importées)</p>
                  <ul className="mt-1 list-disc pl-5">
                    {parsed.errors.slice(0, SHOWN_ERRORS).map((issue, i) => (
                      <li key={i}>
                        Ligne {issue.row} : {issue.message}
                      </li>
                    ))}
                  </ul>
                  {parsed.errors.length > SHOWN_ERRORS && <p>… et {parsed.errors.length - SHOWN_ERRORS} autre(s).</p>}
                </div>
              )}

              {parsed.invoices.length > 0 && (
                <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
                  <table className="w-full text-left">
                    <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                      <tr>
                        <th className="px-3 py-2">Fournisseur</th>
                        <th className="px-3 py-2">Référence</th>
                        <th className="px-3 py-2">Date</th>
                        <th className="px-3 py-2">Commande Amazon</th>
                        <th className="px-3 py-2">Facture vente</th>
                        <th className="px-3 py-2 text-right">Lignes</th>
                        <th className="px-3 py-2 text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {parsed.invoices.slice(0, PREVIEW_ROWS).map((inv) => {
                        const hasTotals = inv.lines.some((l) => l.price_subtotal !== null);
                        return (
                          <tr key={`${inv.supplier_name}|${inv.ref}`}>
                            <td className="px-3 py-2 font-semibold">{inv.supplier_name}</td>
                            <td className="px-3 py-2">{inv.ref}</td>
                            <td className="px-3 py-2">{formatDate(inv.invoice_date)}</td>
                            <td className="px-3 py-2">{inv.amazon_order_ref || '—'}</td>
                            <td className="px-3 py-2">{inv.sale_move_ref || '—'}</td>
                            <td className="px-3 py-2 text-right">{inv.lines.length}</td>
                            <td className="px-3 py-2 text-right">
                              {hasTotals
                                ? formatAmount(inv.lines.reduce((s, l) => s + (l.price_subtotal ?? 0), 0))
                                : '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {parsed.invoices.length > PREVIEW_ROWS && (
                    <p className="px-3 py-2 text-slate-500">
                      … et {parsed.invoices.length - PREVIEW_ROWS} autre(s) facture(s).
                    </p>
                  )}
                </div>
              )}

              {tooMany && (
                <p className="font-semibold text-rose-600">
                  {maxInvoices} factures maximum par import : découpez le fichier.
                </p>
              )}
            </>
          )}

          <div className="flex justify-end gap-2 border-t border-slate-100 pt-4 dark:border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-slate-200 px-4 py-2 font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              {result ? 'Fermer' : 'Annuler'}
            </button>
            {!result && (
              <button
                type="button"
                onClick={handleImport}
                disabled={!parsed || parsed.invoices.length === 0 || tooMany || importing}
                className="flex items-center gap-2 rounded-xl bg-[#643288] px-4 py-2 font-bold text-white shadow-md hover:bg-[#522870] disabled:opacity-50"
              >
                {importing && <Loader2 className="h-4 w-4 animate-spin" />}
                Importer {parsed ? parsed.invoices.length : ''} facture(s)
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
