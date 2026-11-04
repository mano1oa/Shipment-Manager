import React from 'react';
import {
  Plane,
  Ship,
  AlertTriangle,
  TrendingUp,
  ShieldAlert,
  ArrowRight,
  Send,
  Zap,
} from 'lucide-react';
import { Shipment, ShipmentAlert, MetricSummary } from '../types';
import { formatDate } from '../lib/dateFormat';
import type { ParcelsOverview } from './digiApi';
import { ParcelFunnelDashboard } from './ParcelFunnelDashboard';

interface DashboardViewProps {
  shipments: Shipment[];
  alerts: ShipmentAlert[];
  metrics: MetricSummary;
  /** Tabs the current role may open: shortcuts to other tabs are hidden. */
  allowedTabs?: string[];
  onNavigateTab: (tab: any) => void;
  onSelectShipment: (shipment: Shipment) => void;
  onOpenRelanceModal: (alert: ShipmentAlert) => void;
  /** Opens the floating AI assistant. */
  onOpenAssistant: () => void;
  /** Opens the « Analyses & SLAs » tab; hidden when undefined (role not allowed). */
  onOpenAnalytics?: () => void;
  /** Parcels loaded by the app: the figures follow their statuses. */
  parcelsOverview: ParcelsOverview | null;
  parcelsLoading: boolean;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  shipments,
  alerts,
  metrics,
  allowedTabs,
  onNavigateTab,
  onSelectShipment,
  onOpenRelanceModal,
  onOpenAssistant,
  onOpenAnalytics,
  parcelsOverview,
  parcelsLoading,
}) => {
  const canOpen = (tab: string) => !allowedTabs || allowedTabs.includes(tab);
  const criticalAlerts = alerts.filter((a) => a.severity === 'critical');
  const recentShipments = shipments.slice(0, 6);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency: 'EUR',
      maximumFractionDigits: 0,
    }).format(amount);
  };

  return (
    <div className="space-y-6">
      {/* Key figures first, then exceptions and details (funnel reading) */}
      <ParcelFunnelDashboard
        overview={parcelsOverview}
        loading={parcelsLoading}
        shipments={shipments}
        onOpenHub={(hub) => {
          const tab = hub === 'ORLY' ? 'air' : 'sea';
          if (canOpen(tab)) onNavigateTab(tab);
        }}
      />

      {/* Critical Alert Ticker if any */}
      {criticalAlerts.length > 0 && (
        <div
          id="dash-critical-alerts-ticker"
          className="rounded-xl border border-rose-200 bg-rose-50/90 p-4 dark:border-rose-900/60 dark:bg-rose-950/40"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-600 text-white shadow-sm">
                <ShieldAlert className="h-5 w-5 animate-pulse" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-rose-900 dark:text-rose-200">
                  {criticalAlerts.length} alertes critiques nécessitant une action immédiate
                </h3>
                <p className="text-xs text-rose-700 dark:text-rose-300">
                  {criticalAlerts[0]?.title} — {criticalAlerts[0]?.reason}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {criticalAlerts[0]?.relance_draft && (
                <button
                  id="dash-btn-quick-relance"
                  onClick={() => onOpenRelanceModal(criticalAlerts[0])}
                  className="flex items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white shadow transition hover:bg-rose-700"
                >
                  <Send className="h-3.5 w-3.5" /> Générer relance chat
                </button>
              )}
              <button
                id="dash-btn-view-all-alerts"
                hidden={!canOpen('alerts')}
                onClick={() => onNavigateTab('alerts')}
                className="flex items-center gap-1 text-xs font-bold text-rose-800 hover:underline dark:text-rose-300"
              >
                Tout voir <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Grid: Recent Shipments & Quick Action Column */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Recent Shipments Table (2 cols) */}
        <div className="lg:col-span-2 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-800">
          <div className="flex items-center justify-between border-b border-slate-100 pb-4 dark:border-slate-700">
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                Dernières expéditions mises à jour
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Aperçu des mouvements récents et statuts globaux
              </p>
            </div>
            <button
              id="dash-btn-all-shipments"
              hidden={!canOpen('air')}
              onClick={() => onNavigateTab('air')}
              className="text-xs font-bold text-[#623387] hover:underline dark:text-[#ED5DB2]"
            >
              Voir la liste complète &rarr;
            </button>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 dark:bg-slate-900/50 dark:text-slate-400">
                <tr>
                  <th className="px-3 py-2 font-semibold">Mode / Ref</th>
                  <th className="px-3 py-2 font-semibold">Fournisseur</th>
                  <th className="px-3 py-2 font-semibold">Transporteur</th>
                  <th className="px-3 py-2 font-semibold">Statut global</th>
                  <th className="px-3 py-2 font-semibold">ETA</th>
                  <th className="px-3 py-2 text-right font-semibold">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
                {recentShipments.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-xs text-slate-400 dark:text-slate-500">
                      Aucune expédition enregistrée pour le moment. Cliquez sur « Nouvelle expédition » pour commencer.
                    </td>
                  </tr>
                ) : (
                  recentShipments.map((shp) => (
                  <tr
                    key={shp.id}
                    className="hover:bg-slate-50/80 transition dark:hover:bg-slate-700/30 cursor-pointer"
                    onClick={() => onSelectShipment(shp)}
                  >
                    <td className="px-3 py-3 font-semibold text-slate-900 dark:text-slate-100">
                      <div className="flex items-center gap-2">
                        {shp.mode === 'Air' ? (
                          <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300">
                            <Plane className="h-3.5 w-3.5" />
                          </span>
                        ) : (
                          <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300">
                            <Ship className="h-3.5 w-3.5" />
                          </span>
                        )}
                        <div>
                          <div className="font-bold">{shp.order_reference}</div>
                          <div className="text-[10px] text-slate-400">{shp.tracking_no}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-slate-700 dark:text-slate-300 font-medium">
                      {shp.supplier}
                    </td>
                    <td className="px-3 py-3 text-slate-600 dark:text-slate-400">
                      {shp.carrier}
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-0.5 text-[10px] font-bold ${
                          shp.global_status === 'Livrée entrepôt'
                            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                            : shp.global_status === 'En préparation'
                            ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                            : shp.global_status === 'Bloquée douane'
                            ? 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
                            : 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300'
                        }`}
                      >
                        {shp.global_status}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-slate-600 dark:text-slate-400 font-mono">
                      {formatDate(shp.eta)}
                    </td>
                    <td className="px-3 py-3 text-right">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectShipment(shp);
                        }}
                        className="rounded-lg bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-[#623387] hover:text-white dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-[#623387]"
                      >
                        Détails
                      </button>
                    </td>
                  </tr>
                )))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Quick Operational Panel */}
        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-800">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">
              Actions rapides Supply Chain
            </h3>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Règles d'automatisation et relances
            </p>

            <div className="mt-4 space-y-2.5">
              <button
                id="dash-quick-btn-assistant"
                onClick={onOpenAssistant}
                className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-slate-50 p-3 text-left transition hover:border-[#623387] hover:bg-[#F8EEFF]/50 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-[#623387]"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#623387] text-white">
                    <Zap className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-slate-900 dark:text-white">
                      Analyse globale par l'IA
                    </div>
                    <div className="text-[10px] text-slate-500">
                      Générer un bilan synthétique immédiat
                    </div>
                  </div>
                </div>
                <ArrowRight className="h-4 w-4 text-slate-400" />
              </button>

              <button
                id="dash-quick-btn-alerts"
                hidden={!canOpen('alerts')}
                onClick={() => onNavigateTab('alerts')}
                className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-slate-50 p-3 text-left transition hover:border-rose-400 hover:bg-rose-50/50 dark:border-slate-700 dark:bg-slate-900"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-600 text-white">
                    <AlertTriangle className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-slate-900 dark:text-white">
                      Traiter le stock Orly en souffrance
                    </div>
                    <div className="text-[10px] text-slate-500">
                      {metrics.orlyOverdueCount} dossiers en dépassement 10j
                    </div>
                  </div>
                </div>
                <ArrowRight className="h-4 w-4 text-slate-400" />
              </button>

              <button
                id="dash-quick-btn-analytics"
                hidden={!onOpenAnalytics}
                onClick={onOpenAnalytics}
                className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-slate-50 p-3 text-left transition hover:border-sky-400 hover:bg-sky-50/50 dark:border-slate-700 dark:bg-slate-900"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-600 text-white">
                    <TrendingUp className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-slate-900 dark:text-white">
                      Scorecards transporteurs
                    </div>
                    <div className="text-[10px] text-slate-500">
                      Consulter le classement SLA
                    </div>
                  </div>
                </div>
                <ArrowRight className="h-4 w-4 text-slate-400" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
