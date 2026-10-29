import React from 'react';
import {
  Package,
  Plane,
  Ship,
  AlertTriangle,
  Clock,
  CheckCircle2,
  TrendingUp,
  ShieldAlert,
  ArrowRight,
  Send,
  Building2,
  Zap,
  Coins,
  XCircle,
} from 'lucide-react';
import { Shipment, ShipmentAlert, MetricSummary } from '../types';
import { formatDate } from '../lib/dateFormat';

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
      {/* Top Welcome Banner */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-[#623387] to-[#9E1B65] p-6 text-white shadow-xl">
        <div className="relative z-10 flex flex-col justify-between gap-4 md:flex-row md:items-center">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-white/20 px-3 py-1 text-xs font-semibold backdrop-blur">
              <Zap className="h-3.5 w-3.5 text-amber-300" /> Pilotage IA Supply Chain
            </div>
            <h1 className="mt-2 text-2xl font-extrabold tracking-tight md:text-3xl">
              Tableau de bord exécutif et opérationnel
            </h1>
            <p className="mt-1 text-sm text-[#F8EEFF] max-w-2xl">
              Suivi centralisé des expéditions aériennes et maritimes, détection automatique des
              anomalies à Orly et relances automatisées via Google Chat.
            </p>
          </div>
          <div className="flex gap-3">
            <button
              id="dash-btn-air-tab"
              hidden={!canOpen('air')}
              onClick={() => onNavigateTab('air')}
              className="flex items-center gap-2 rounded-xl bg-white/10 px-4 py-2 text-xs font-semibold text-white backdrop-blur transition hover:bg-white/20"
            >
              <Plane className="h-4 w-4" /> Suivi aérien ({metrics.airCount})
            </button>
            <button
              id="dash-btn-sea-tab"
              hidden={!canOpen('sea')}
              onClick={() => onNavigateTab('sea')}
              className="flex items-center gap-2 rounded-xl bg-white px-4 py-2 text-xs font-bold text-[#623387] shadow-md transition hover:bg-[#F8EEFF]"
            >
              <Ship className="h-4 w-4" /> Suivi maritime ({metrics.seaCount})
            </button>
          </div>
        </div>
      </div>

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

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {/* Total Shipments */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:shadow-md dark:border-slate-800 dark:bg-slate-800">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Expéditions totales
            </span>
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#623387]/10 text-[#623387] dark:bg-[#623387]/30 dark:text-[#ED5DB2]">
              <Package className="h-5 w-5" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline justify-between">
            <span className="text-3xl font-extrabold text-slate-900 dark:text-white">
              {metrics.totalShipments}
            </span>
            <div className="flex gap-2 text-xs font-medium text-slate-500">
              <span className="flex items-center gap-0.5 text-sky-600 dark:text-sky-400">
                <Plane className="h-3 w-3" /> {metrics.airCount}
              </span>
              <span className="flex items-center gap-0.5 text-sky-600 dark:text-sky-400">
                <Ship className="h-3 w-3" /> {metrics.seaCount}
              </span>
            </div>
          </div>
          <div className="mt-3 text-xs text-slate-500 dark:text-slate-400">
            Flux actifs enregistrés en base
          </div>
        </div>

        {/* Valeur Totale en Transit */}
        <div id="dash-card-value-in-transit" className="rounded-2xl border border-sky-200 bg-sky-50/50 p-5 shadow-sm transition hover:shadow-md dark:border-sky-900/50 dark:bg-sky-950/20">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-sky-900 dark:text-sky-300">
              Valeur totale en transit
            </span>
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-500/20 text-sky-700 dark:text-sky-300">
              <Coins className="h-5 w-5" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline justify-between">
            <span className="text-2xl font-extrabold text-sky-950 dark:text-sky-100 font-mono">
              {formatCurrency(metrics.totalValueInTransit)}
            </span>
          </div>
          <div className="mt-3 text-xs text-sky-800/80 dark:text-sky-300/80">
            Expédiées vers Mada
          </div>
        </div>

        {/* Taux de Perte & Divergences */}
        <div id="dash-card-loss-rate" className="rounded-2xl border border-rose-200 bg-rose-50/50 p-5 shadow-sm transition hover:shadow-md dark:border-rose-900/50 dark:bg-rose-950/20">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-rose-900 dark:text-rose-300">
              Taux de perte et divergences
            </span>
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-rose-500/20 text-rose-700 dark:text-rose-300">
              <XCircle className="h-5 w-5" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline justify-between">
            <span className="text-2xl font-extrabold text-rose-700 dark:text-rose-300 font-mono">
              {formatCurrency(metrics.totalValuePerduOrly)}
            </span>
          </div>
          <div className="mt-3 text-xs text-rose-800/80 dark:text-rose-300/80">
            Anciennes expéditions « Perdu Orly »
          </div>
        </div>

        {/* Orly Stock & Critical Hub Timeout */}
        <div className="rounded-2xl border border-amber-200 bg-amber-50/50 p-5 shadow-sm transition hover:shadow-md dark:border-amber-900/50 dark:bg-amber-950/20">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-amber-800 dark:text-amber-300">
              Expéditions en préparation
            </span>
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500/20 text-amber-700 dark:text-amber-300">
              <Building2 className="h-5 w-5" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline justify-between">
            <span className="text-3xl font-extrabold text-amber-900 dark:text-amber-100">
              {metrics.orlyStockCount}
            </span>
            {metrics.orlyOverdueCount > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-xs font-bold text-rose-700 dark:bg-rose-950 dark:text-rose-300">
                ⚠️ {metrics.orlyOverdueCount} &gt; 10 jours
              </span>
            )}
          </div>
          <div className="mt-3 text-xs text-amber-800/80 dark:text-amber-300/80">
            À Orly, pas encore parties vers Madagascar
          </div>
        </div>

        {/* Retards & Bloqués Douane */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:shadow-md dark:border-slate-800 dark:bg-slate-800">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Retards et bloqués douane
            </span>
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-rose-100 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400">
              <AlertTriangle className="h-5 w-5" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline justify-between">
            <span className="text-3xl font-extrabold text-rose-600 dark:text-rose-400">
              {metrics.delaysCount}
            </span>
            <span className="text-xs font-bold text-rose-700 dark:text-rose-300">
              {metrics.customsBlockedCount} Douane
            </span>
          </div>
          <div className="mt-3 text-xs text-slate-500 dark:text-slate-400">
            Dépassements d’ETA et alertes douanières
          </div>
        </div>

        {/* SLA Compliance */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:shadow-md dark:border-slate-800 dark:bg-slate-800">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Respect SLA transporteurs
            </span>
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400">
              <TrendingUp className="h-5 w-5" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline justify-between">
            <span className="text-3xl font-extrabold text-emerald-600 dark:text-emerald-400">
              {metrics.slaComplianceRate}%
            </span>
            <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">
              Conforme
            </span>
          </div>
          <div className="mt-3 text-xs text-slate-500 dark:text-slate-400">
            Objectif cible &gt; 85% respecté
          </div>
        </div>
      </div>

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
