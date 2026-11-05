import React, { useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, FileSpreadsheet, Loader2, Upload, X } from 'lucide-react';
import {
  AMAZON_IMPORT_MAX_ROWS,
  AMAZON_OUTCOME_LABELS,
  AmazonImportOutcome,
  AmazonReportColumns,
  AmazonReportParse,
  parseAmazonReport,
} from '../lib/amazonReport';
import type { ParcelDestination } from '../lib/parcelTracking';
import { readRows } from './DigiImportModal';
import { AmazonImportResult, importAmazonReport } from './digiApi';

interface Props {
  destination: ParcelDestination;
  onClose: () => void;
  /** Parcels created or completed. */
  onImported: () => void;
}

const MAX_FILE_BYTES = 10 * 1024 * 1024;

const OUTCOME_TONES: Record<AmazonImportOutcome, string> = {
  created: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  completed: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  linked: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300',
  already: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  unknown_order: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  services: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  locked: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  invalid_tracking: 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300',
};

const OUTCOME_ORDER: AmazonImportOutcome[] = ['created', 'completed', 'linked', 'already', 'unknown_order', 'services', 'locked', 'invalid_tracking'];

/**
 * Colis vers Orly / Rouen › Import rapport Amazon: the tracking numbers of the
 * Amazon shipment report become parcels of the invoices of the same Amazon
 * order (one invoice = several parcels when the order was split).
 */
export const AmazonReportImportModal: React.FC<Props> = ({ destination, onClose, onImported }) => {
  const hub = destination === 'ORLY' ? 'Orly' : 'Rouen';
  const [fileName, setFileName] = useState<string | null>(null);
  const [sheet, setSheet] = useState<unknown[][] | null>(null);
  const [forced, setForced] = useState<Partial<AmazonReportColumns>>({});
  const [preview, setPreview] = useState<AmazonImportResult | null>(null);
  const [result, setResult] = useState<AmazonImportResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const parsed: AmazonReportParse | null = useMemo(() => (sheet ? parseAmazonReport(sheet, forced) : null), [sheet, forced]);
  const columnsOk = Boolean(parsed && parsed.columns.order >= 0 && parsed.columns.tracking >= 0);

  const handleFile = async (file: File | undefined) => {
    setSheet(null);
    setForced({});
    setPreview(null);
    setResult(null);
    setError(null);
    if (!file) return;
    if (!/\.(xlsx|csv)$/i.test(file.name)) return setError('Format attendu : .xlsx ou .csv (export du rapport Amazon).');
    if (file.size > MAX_FILE_BYTES) return setError('Fichier trop volumineux (10 Mo maximum).');
    setFileName(file.name);
    setBusy('Lecture du fichier…');
    try {
      setSheet(await readRows(file));
    } catch (err: any) {
      setError(`Lecture impossible : ${err.message}`);
    } finally {
      setBusy(null);
    }
  };

  const send = async (apply: boolean) => {
    if (!parsed || parsed.rows.length === 0) return;
    if (parsed.rows.length > AMAZON_IMPORT_MAX_ROWS) {
      return setError(`${parsed.rows.length} lignes : ${AMAZON_IMPORT_MAX_ROWS} maximum par import, découpez le rapport.`);
    }
    setError(null);
    setBusy(apply ? 'Création des colis…' : 'Recherche des factures…');
    try {
      const r = await importAmazonReport(destination, parsed.rows, apply);
      if (apply) {
        setResult(r);
        onImported();
      } else setPreview(r);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const shown = result ?? preview;
  const toDo = preview ? (preview.counts.created ?? 0) + (preview.counts.completed ?? 0) + (preview.counts.linked ?? 0) : 0;
  const selectClass =
    'w-full rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100';

  const columnSelect = (key: keyof AmazonReportColumns, label: string, optional: boolean) => (
    <label className="block">
      <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">{label}</span>
      <select
        value={parsed?.columns[key] ?? -1}
        onChange={(e) => {
          setPreview(null);
          setForced((f) => ({ ...f, [key]: Number(e.target.value) }));
        }}
        className={selectClass}
      >
        <option value={-1}>{optional ? '— Aucune —' : '— À choisir —'}</option>
        {parsed?.headers.map((h, i) => (
          <option key={i} value={i}>
            {h || `Colonne ${i + 1}`}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
      <div className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <h2 className="flex items-center gap-2 text-base font-bold text-slate-900 dark:text-white">
            <FileSpreadsheet className="h-5 w-5 text-[#623387]" /> Import du rapport d'expédition Amazon — colis vers {hub}
          </h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto p-5 text-xs">
          <p className="text-slate-600 dark:text-slate-300">
            Chaque n° de suivi du rapport devient un colis de sa facture : retrouvée par son <b>n° de facture Amazon</b> (Référence), sinon par sa <b>Commande Amazon</b>. Une
            commande livrée en plusieurs paquets donne plusieurs colis pour la même facture ; un colis annoncé sans n° de
            suivi reçoit d'abord le n° du rapport ; un n° déjà en base est simplement rattaché. Un aperçu est affiché avant
            toute création.
          </p>

          {!result && (
            <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 p-5 font-semibold text-slate-600 hover:border-[#623387] dark:border-slate-700 dark:text-slate-300">
              <Upload className="h-5 w-5" />
              {fileName ? `${fileName} — choisir un autre fichier` : 'Choisir le rapport (.xlsx ou .csv)'}
              <input type="file" accept=".xlsx,.csv" className="hidden" onChange={(e) => handleFile(e.target.files?.[0])} />
            </label>
          )}

          {parsed && !result && (
            <div className="grid gap-3 rounded-xl border border-slate-200 p-3 sm:grid-cols-5 dark:border-slate-800">
              {columnSelect('order', 'N° de commande *', false)}
              {columnSelect('tracking', 'N° de suivi *', false)}
              {columnSelect('invoice', 'N° de facture Amazon', true)}
              {columnSelect('carrier', 'Transporteur', true)}
              {columnSelect('expected', 'Livraison prévue', true)}
              <p className="text-[11px] text-slate-500 sm:col-span-5">
                {columnsOk
                  ? `${parsed.rows.length} n° de suivi lu(s)${
                      parsed.skipped.length > 0 ? `, ${parsed.skipped.length} ligne(s) ignorée(s)` : ''
                    } (en-têtes ligne ${parsed.headerLine + 1}).`
                  : 'Colonnes non reconnues : choisissez la colonne du n° de commande et celle du n° de suivi.'}
              </p>
              {parsed.skipped.length > 0 && (
                <details className="text-[11px] text-slate-500 sm:col-span-5">
                  <summary className="cursor-pointer font-semibold">Lignes ignorées</summary>
                  <ul className="mt-1 max-h-24 overflow-y-auto">
                    {parsed.skipped.slice(0, 100).map((s) => (
                      <li key={s.line}>
                        Ligne {s.line} : {s.reason}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 font-semibold text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300">
              <AlertCircle className="h-4 w-4 shrink-0" /> {error}
            </div>
          )}
          {busy && (
            <p className="flex items-center gap-2 font-semibold text-slate-600 dark:text-slate-300">
              <Loader2 className="h-4 w-4 animate-spin text-[#623387]" /> {busy}
            </p>
          )}

          {shown && (
            <div className="space-y-3">
              {result && (
                <p className="flex items-center gap-2 font-bold text-emerald-700 dark:text-emerald-300">
                  <CheckCircle2 className="h-4 w-4" /> Import terminé.
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                {OUTCOME_ORDER.filter((o) => shown.counts[o]).map((o) => (
                  <span key={o} className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${OUTCOME_TONES[o]}`}>
                    {AMAZON_OUTCOME_LABELS[o]} : {shown.counts[o]}
                  </span>
                ))}
              </div>
              <div className="max-h-80 overflow-auto rounded-xl border border-slate-200 dark:border-slate-800">
                <table className="w-full text-left">
                  <thead className="sticky top-0 bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500 dark:bg-slate-800">
                    <tr>
                      <th className="px-3 py-2">Ligne</th>
                      <th className="px-3 py-2">Commande</th>
                      <th className="px-3 py-2">N° de suivi</th>
                      <th className="px-3 py-2">Facture(s)</th>
                      <th className="px-3 py-2">{result ? 'Résultat' : 'Sera'}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {shown.lines.map((l, i) => (
                      <tr key={`${l.line}-${l.tracking_number}-${i}`}>
                        <td className="px-3 py-1.5 text-slate-400">{l.line}</td>
                        <td className="px-3 py-1.5 font-mono">{l.order_ref || '—'}</td>
                        <td className="px-3 py-1.5 font-mono font-semibold">{l.tracking_number || '—'}</td>
                        <td className="px-3 py-1.5">{l.invoice_refs.join(', ') || '—'}</td>
                        <td className="px-3 py-1.5">
                          <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-bold ${OUTCOME_TONES[l.outcome]}`}>
                            {AMAZON_OUTCOME_LABELS[l.outcome]}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {(shown.counts.unknown_order ?? 0) > 0 && (
                <p className="text-[11px] text-amber-700 dark:text-amber-300">
                  « Commande sans facture » : aucune facture ne porte ce n° de commande Amazon. Renseignez la Commande Amazon
                  de la facture (Factures fournisseurs) puis réimportez le rapport : les lignes déjà traitées seront «
                  Déjà rattaché ».
                </p>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3 dark:border-slate-800">
          <button
            onClick={onClose}
            className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300"
          >
            {result ? 'Fermer' : 'Annuler'}
          </button>
          {!result &&
            (preview ? (
              <button
                onClick={() => send(true)}
                disabled={Boolean(busy) || toDo === 0}
                className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-40"
              >
                Importer ({toDo} colis à créer / compléter / rattacher)
              </button>
            ) : (
              <button
                onClick={() => send(false)}
                disabled={Boolean(busy) || !columnsOk || !parsed || parsed.rows.length === 0}
                className="rounded-xl bg-[#623387] px-4 py-2 text-xs font-bold text-white hover:bg-[#522870] disabled:opacity-40"
              >
                Aperçu
              </button>
            ))}
        </div>
      </div>
    </div>
  );
};
