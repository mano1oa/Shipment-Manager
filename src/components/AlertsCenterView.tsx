import React, { useState } from 'react';
import {
  AlertTriangle,
  ShieldAlert,
  Send,
  CheckCircle2,
  Filter,
  Copy,
  Check,
  Building2,
  Clock,
  ArrowRight,
  RefreshCw,
} from 'lucide-react';
import { ShipmentAlert, Shipment } from '../types';

interface AlertsCenterViewProps {
  alerts: ShipmentAlert[];
  shipments: Shipment[];
  onSelectShipment: (shipment: Shipment) => void;
  onDispatchGoogleChat: (message: string, space?: string) => Promise<void>;
  onResolveAlert: (alertId: string) => void;
  onUnresolveAlert?: (alertId: string) => void;
}

export const AlertsCenterView: React.FC<AlertsCenterViewProps> = ({
  alerts,
  shipments,
  onSelectShipment,
  onDispatchGoogleChat,
  onResolveAlert,
  onUnresolveAlert,
}) => {
  const [severityFilter, setSeverityFilter] = useState<'all' | 'critical' | 'warning'>('all');
  const [showResolvedOnly, setShowResolvedOnly] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [dispatchingId, setDispatchingId] = useState<string | null>(null);

  const activeAlerts = alerts.filter((alt) => !alt.resolved);
  const resolvedAlerts = alerts.filter((alt) => alt.resolved);

  const currentList = showResolvedOnly ? resolvedAlerts : activeAlerts;

  const filteredAlerts = currentList.filter((alt) => {
    if (severityFilter !== 'all' && alt.severity !== severityFilter) return false;
    return true;
  });

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleSendChat = async (id: string, text: string) => {
    setDispatchingId(id);
    try {
      await onDispatchGoogleChat(text, 'SupplyChain-Alerts');
    } catch (err) {
      console.error(err);
    } finally {
      setDispatchingId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-extrabold text-slate-900 dark:text-white">
            <ShieldAlert className="h-6 w-6 text-rose-600" /> Centre de Traitement des Alertes & Anomalies
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Détection automatique selon les règles métier (Orly &gt; 10j, blocages douaniers, retards)
          </p>
        </div>

        {/* Severity & Resolved Filters */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Severity Filter Pills */}
          <div className="flex items-center gap-2 bg-slate-100 p-1 rounded-xl dark:bg-slate-800">
            <button
              onClick={() => setSeverityFilter('all')}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                severityFilter === 'all'
                  ? 'bg-white text-slate-900 shadow dark:bg-slate-700 dark:text-white'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              Toutes ({currentList.length})
            </button>
            <button
              onClick={() => setSeverityFilter('critical')}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                severityFilter === 'critical'
                  ? 'bg-rose-600 text-white shadow'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              Critiques ({currentList.filter((a) => a.severity === 'critical').length})
            </button>
            <button
              onClick={() => setSeverityFilter('warning')}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                severityFilter === 'warning'
                  ? 'bg-amber-500 text-white shadow'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              Avertissements ({currentList.filter((a) => a.severity === 'warning').length})
            </button>
          </div>

          {/* Dedicated "Résolu" Toggle Button */}
          <button
            id="btn-show-resolved-alerts"
            onClick={() => setShowResolvedOnly(!showResolvedOnly)}
            className={`flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-bold transition border ${
              showResolvedOnly
                ? 'bg-emerald-600 text-white border-emerald-600 shadow'
                : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-200'
            }`}
          >
            <CheckCircle2 className={`h-4 w-4 ${showResolvedOnly ? 'text-white' : 'text-emerald-600'}`} />
            <span>Résolu</span>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-extrabold ${
                showResolvedOnly
                  ? 'bg-emerald-700 text-white'
                  : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
              }`}
            >
              {resolvedAlerts.length}
            </span>
          </button>
        </div>
      </div>

      {/* Resolved Mode Banner */}
      {showResolvedOnly && (
        <div className="flex items-center justify-between rounded-2xl bg-emerald-50 p-4 border border-emerald-200 dark:bg-emerald-950/40 dark:border-emerald-800/60 shadow-xs">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 className="h-6 w-6" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-emerald-950 dark:text-emerald-100">
                Dossiers d'alertes résolus ({resolvedAlerts.length})
              </h3>
              <p className="text-xs text-emerald-800/80 dark:text-emerald-300/80">
                Ces dossiers d'alertes ont été traités et marqués comme résolus. Vous pouvez consulter les détails ou réactiver une alerte.
              </p>
            </div>
          </div>
          <button
            onClick={() => setShowResolvedOnly(false)}
            className="shrink-0 rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-bold text-white shadow hover:bg-emerald-700 transition"
          >
            ← Revenir aux alertes actives ({activeAlerts.length})
          </button>
        </div>
      )}

      {/* Alerts Grid */}
      {filteredAlerts.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center dark:border-slate-800 dark:bg-slate-800">
          <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-500" />
          <h3 className="mt-3 text-base font-bold text-slate-800 dark:text-slate-200">
            {showResolvedOnly ? 'Aucun dossier résolu' : 'Aucune alerte active'}
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            {showResolvedOnly
              ? 'Aucune alerte n’a été marquée comme résolue pour le moment.'
              : 'Tous les flux d’expéditions respectent les règles métiers et SLAs.'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredAlerts.map((alt) => {
            const linkedShipment = shipments.find((s) => s.id === alt.shipment_id);

            return (
              <div
                key={alt.id}
                className={`rounded-2xl border p-5 shadow-xs transition hover:shadow-md ${
                  alt.resolved
                    ? 'border-emerald-200 bg-emerald-50/30 dark:border-emerald-900/40 dark:bg-emerald-950/10'
                    : alt.severity === 'critical'
                    ? 'border-rose-200 bg-rose-50/50 dark:border-rose-900/60 dark:bg-rose-950/20'
                    : 'border-amber-200 bg-amber-50/50 dark:border-amber-900/60 dark:bg-amber-950/20'
                }`}
              >
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      {alt.resolved ? (
                        <span className="rounded-full bg-emerald-600 px-2.5 py-0.5 text-[10px] font-extrabold uppercase text-white flex items-center gap-1">
                          <CheckCircle2 className="h-3 w-3" /> Résolu
                        </span>
                      ) : (
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-[10px] font-extrabold uppercase text-white ${
                            alt.severity === 'critical' ? 'bg-rose-600' : 'bg-amber-500'
                          }`}
                        >
                          {alt.severity}
                        </span>
                      )}
                      <span className="text-xs font-mono font-bold text-slate-500 dark:text-slate-400">
                        Code Règle: {alt.rule_code}
                      </span>
                    </div>

                    <h3 className="text-base font-extrabold text-slate-900 dark:text-white">
                      {alt.title}
                    </h3>
                    <p className="text-xs text-slate-700 dark:text-slate-300 max-w-2xl">
                      {alt.reason}
                    </p>

                    {linkedShipment && (
                      <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600 dark:text-slate-400 pt-1">
                        <span>
                          Ref: <strong className="text-slate-900 dark:text-white">{linkedShipment.order_reference}</strong>
                        </span>
                        <span>
                          Fournisseur: <strong className="text-slate-900 dark:text-white">{linkedShipment.supplier}</strong>
                        </span>
                        <span>
                          Transporteur: <strong className="text-slate-900 dark:text-white">{linkedShipment.carrier}</strong>
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex flex-col gap-2 shrink-0 sm:flex-row lg:flex-col lg:items-end">
                    {linkedShipment && (
                      <button
                        onClick={() => onSelectShipment(linkedShipment)}
                        className="flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 shadow-xs hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                      >
                        Voir la fiche <ArrowRight className="h-3.5 w-3.5" />
                      </button>
                    )}

                    {alt.resolved ? (
                      onUnresolveAlert && (
                        <button
                          onClick={() => onUnresolveAlert(alt.id)}
                          className="flex items-center justify-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 shadow-xs hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 transition"
                        >
                          <RefreshCw className="h-3.5 w-3.5" /> Réactiver l'alerte
                        </button>
                      )
                    ) : (
                      <button
                        onClick={() => onResolveAlert(alt.id)}
                        className="flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-bold text-white shadow-xs hover:bg-emerald-700 transition"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" /> Marquer Résolu
                      </button>
                    )}
                  </div>
                </div>

                {/* Pre-drafted Google Chat Relance Box */}
                {alt.relance_draft && (
                  <div className="mt-4 rounded-xl border border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900">
                    <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
                      <span className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                        <Send className="h-3.5 w-3.5 text-[#643288]" /> Proposition de Message Google Chat (N8N)
                      </span>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleCopy(alt.id, alt.relance_draft!)}
                          className="flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200"
                        >
                          {copiedId === alt.id ? (
                            <>
                              <Check className="h-3 w-3 text-emerald-600" /> Copié
                            </>
                          ) : (
                            <>
                              <Copy className="h-3 w-3" /> Copier
                            </>
                          )}
                        </button>
                        <button
                          onClick={() => handleSendChat(alt.id, alt.relance_draft!)}
                          disabled={dispatchingId === alt.id}
                          className="flex items-center gap-1 rounded-lg bg-[#643288] px-3 py-1 text-[11px] font-semibold text-white hover:bg-[#522870] disabled:opacity-50"
                        >
                          <Send className="h-3 w-3" />
                          {dispatchingId === alt.id ? 'Envoi...' : 'Envoyer au Chat'}
                        </button>
                      </div>
                    </div>
                    <pre className="mt-2 text-xs font-sans text-slate-700 dark:text-slate-300 whitespace-pre-wrap leading-relaxed bg-slate-50 dark:bg-slate-950 p-2.5 rounded-lg">
                      {alt.relance_draft}
                    </pre>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
