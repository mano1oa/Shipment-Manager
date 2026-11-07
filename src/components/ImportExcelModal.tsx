import React, { useEffect, useState } from 'react';
import { ArrowLeft, ChevronRight, FileSpreadsheet, Loader2, Package, ReceiptText, X } from 'lucide-react';
import { DigiImportModal } from './DigiImportModal';
import { AmazonReportImportModal } from './AmazonReportImportModal';
import { DigiConfig, fetchDigiConfig } from './digiApi';
import { DEFAULT_DEST_PARTNER_NAME } from '../lib/digiInvoices';
import type { ParcelDestination } from '../lib/parcelTracking';
import { ui } from '../lib/ui';

interface Props {
  /** The Amazon shipment report creates parcels: Supply Chain only. */
  canImportShipments: boolean;
  onClose: () => void;
  onInvoicesImported: () => void;
  onShipmentsImported: () => void;
}

type Step = { kind: 'choose' } | { kind: 'hub' } | { kind: 'invoices' } | { kind: 'shipments'; destination: ParcelDestination };

/**
 * Single entry point of the Excel imports: pick what the file holds, then the
 * matching import opens (DIGI invoices, or the Amazon shipment report per hub).
 */
export const ImportExcelModal: React.FC<Props> = ({ canImportShipments, onClose, onInvoicesImported, onShipmentsImported }) => {
  const [step, setStep] = useState<Step>({ kind: 'choose' });
  const [config, setConfig] = useState<DigiConfig | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);

  useEffect(() => {
    fetchDigiConfig()
      .then(setConfig)
      .catch((err) => setConfigError(err.message));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && step.kind !== 'invoices' && step.kind !== 'shipments' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step.kind, onClose]);

  if (step.kind === 'invoices') {
    return (
      <DigiImportModal
        destination={config?.dest_partner_name || DEFAULT_DEST_PARTNER_NAME}
        maxInvoices={config?.import_max_invoices ?? 2000}
        onClose={onClose}
        onImported={onInvoicesImported}
      />
    );
  }

  if (step.kind === 'shipments') {
    return <AmazonReportImportModal destination={step.destination} onClose={onClose} onImported={onShipmentsImported} />;
  }

  const choice =
    'flex w-full items-center gap-4 rounded-2xl border border-[#E7E4EC] p-4 text-left transition hover:border-[#C9B6DD] hover:bg-[#FAF6FD] disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:border-[#E7E4EC] disabled:hover:bg-transparent dark:border-slate-800 dark:hover:border-purple-800 dark:hover:bg-purple-950/20';
  const choiceIcon =
    'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#EEE2F8] text-[#623387] dark:bg-purple-950 dark:text-[#B688FF]';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#17111F]/50 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-excel-title"
        className={`${ui.card} w-full max-w-lg p-6 shadow-2xl`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            {step.kind === 'hub' && (
              <button
                type="button"
                onClick={() => setStep({ kind: 'choose' })}
                aria-label="Retour"
                className={`-ml-2 flex h-9 w-9 items-center justify-center rounded-lg hover:bg-[#F5F4F7] dark:hover:bg-slate-800 ${ui.muted}`}
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
            )}
            <div>
              <h2 id="import-excel-title" className={`flex items-center gap-2 text-lg font-semibold ${ui.title}`}>
                <FileSpreadsheet className="h-5 w-5 text-[#623387] dark:text-[#B688FF]" /> Importer un fichier Excel
              </h2>
              <p className={`mt-0.5 text-sm ${ui.muted}`}>
                {step.kind === 'choose' ? 'Que contient votre fichier ?' : 'Vers quel hub vont ces colis ?'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className={`flex h-9 w-9 items-center justify-center rounded-lg hover:bg-[#F5F4F7] dark:hover:bg-slate-800 ${ui.muted}`}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {step.kind === 'choose' ? (
          <div className="space-y-3">
            <button type="button" disabled={!config && !configError} onClick={() => setStep({ kind: 'invoices' })} className={choice}>
              <span className={choiceIcon}>
                {!config && !configError ? <Loader2 className="h-5 w-5 animate-spin" /> : <ReceiptText className="h-5 w-5" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className={`block text-[15px] font-semibold ${ui.title}`}>Factures</span>
                <span className={`block text-[13px] ${ui.muted}`}>
                  Export des factures DIGI LOGISTIC : elles s’ajoutent aux factures fournisseurs.
                </span>
              </span>
              <ChevronRight className={`h-4 w-4 ${ui.muted}`} />
            </button>
            <button
              type="button"
              disabled={!canImportShipments}
              onClick={() => setStep({ kind: 'hub' })}
              className={choice}
              title={canImportShipments ? undefined : 'Réservé à la Supply Chain'}
            >
              <span className={choiceIcon}>
                <Package className="h-5 w-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className={`block text-[15px] font-semibold ${ui.title}`}>Expéditions (rapport Amazon)</span>
                <span className={`block text-[13px] ${ui.muted}`}>
                  {canImportShipments
                    ? 'Rapport d’expédition Amazon : n° de commande → n° de suivi, crée les colis des factures.'
                    : 'Réservé à la Supply Chain.'}
                </span>
              </span>
              <ChevronRight className={`h-4 w-4 ${ui.muted}`} />
            </button>
            {configError && (
              <p className="text-xs text-[#B42318] dark:text-rose-300">
                Réglages des factures non chargés ({configError}) : l’import utilisera les valeurs par défaut.
              </p>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {(['ORLY', 'ROUEN'] as ParcelDestination[]).map((d) => (
              <button key={d} type="button" onClick={() => setStep({ kind: 'shipments', destination: d })} className={`${choice} flex-col items-start`}>
                <span className={`text-[15px] font-semibold ${ui.title}`}>{d === 'ORLY' ? 'Orly' : 'Rouen'}</span>
                <span className={`text-[13px] ${ui.muted}`}>{d === 'ORLY' ? 'Colis du suivi aérien' : 'Colis du suivi maritime'}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
