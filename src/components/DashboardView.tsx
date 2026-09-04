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

interface DashboardViewProps {
  shipments: Shipment[];
  alerts: ShipmentAlert[];
  metrics: MetricSummary;
  onNavigateTab: (tab: any) => void;
  onSelectShipment: (shipment: Shipment) => void;
  onOpenRelanceModal: (alert: ShipmentAlert) => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  shipments,
  alerts,
  metrics,
  onNavigateTab,
  onSelectShipment,
  onOpenRelanceModal,
}) => {
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
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-[#643288] via-[#832c7f] to-[#A91869] p-6 text-white shadow-xl">
        <div className="relative z-10 flex flex-col justify-between gap-4 md:flex-row md:items-center">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-white/20 px-3 py-1 text-xs font-semibold backdrop-blur">
              <Zap className="h-3.5 w-3.5 text-amber-300" /> Pilotage IA Supply Chain
            </div>
            <h1 className="mt-2 text-2xl font-extrabold tracking-tight md:text-3xl">
              Tableau de Bord Exécutif & Opérationnel
            </h1>
            <p className="mt-1 text-sm text-purple-100 max-w-2xl">
              Suivi centralisé des expéditions aériennes et maritimes, détection automatique des
              anomalies à Orly et relances automatisées via Google Chat.
            </p>
          </div>
          <div className="flex gap-3">
            <button
              id="dash-btn-air-tab"
              onClick={() => onNavigateTab('air')}
              className="flex items-center gap-2 rounded-xl bg-white/10 px-4 py-2 text-xs font-semibold text-white backdrop-blur transition hover:bg-white/20"
            >
              <Plane className="h-4 w-4" /> Suivi Aérien ({metrics.airCount})
            </button>
            <button
              id="dash-btn-sea-tab"
              onClick={() => onNavigateTab('sea')}
              className="flex items-center gap-2 rounded-xl bg-white px-4 py-2 text-xs font-bold text-[#643288] shadow-md transition hover:bg-purple-50"
            >
              <Ship className="h-4 w-4" /> Suivi Maritime ({metrics.seaCount})
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
                  {criticalAlerts.length} Alertes Critiques Nécessitant une Action Immédiate
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
                  <Send className="h-3.5 w-3.5" /> Générer Relance Chat
                </button>
              )}
              <button
                id="dash-btn-view-all-alerts"
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
              Expéditions Totales
            </span>
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#643288]/10 text-[#643288] dark:bg-[#643288]/30 dark:text-pink-300">
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
              <span className="flex items-center gap-0.5 text-indigo-600 dark:text-indigo-400">
                <Ship className="h-3 w-3" /> {metrics.seaCount}
              </span>
            </div>
          </div>
          <div className="mt-3 text-xs text-slate-500 dark:text-slate-400">
            Flux actifs enregistrés en base
          </div>
        </div>

        {/* Valeur Totale en Transit */}
        <div id="dash-card-value-in-transit" className="rounded-2xl border border-indigo-200 bg-indigo-50/50 p-5 shadow-sm transition hover:shadow-md dark:border-indigo-900/50 dark:bg-indigo-950/20">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-indigo-900 dark:text-indigo-300">
              Valeur Totale en Transit
            </span>
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-500/20 text-indigo-700 dark:text-indigo-300">
              <Coins className="h-5 w-5" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline justify-between">
            <span className="text-2xl font-extrabold text-indigo-950 dark:text-indigo-100 font-mono">
              {formatCurrency(metrics.totalValueInTransit)}
            </span>
          </div>
          <div className="mt-3 text-xs text-indigo-800/80 dark:text-indigo-300/80">
            Reçu et expédié
          </div>
        </div>

        {/* Taux de Perte & Divergences */}
        <div id="dash-card-loss-rate" className="rounded-2xl border border-rose-200 bg-rose-50/50 p-5 shadow-sm transition hover:shadow-md dark:border-rose-900/50 dark:bg-rose-950/20">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-rose-900 dark:text-rose-300">
              Taux de Perte & Divergences
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
            Perdu Orly
          </div>
        </div>

        {/* Orly Stock & Critical Hub Timeout */}
        <div className="rounded-2xl border border-amber-200 bg-amber-50/50 p-5 shadow-sm transition hover:shadow-md dark:border-amber-900/50 dark:bg-amber-950/20">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-amber-800 dark:text-amber-300">
              Colis Hub Orly
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
            Reçus en zone transit avant vol Madagascar
          </div>
        </div>

        {/* Retards & Bloqués Douane */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:shadow-md dark:border-slate-800 dark:bg-slate-800">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Retards & Bloqués Douane
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
              Respect SLA Transporteurs
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
                Dernières Expéditions Mises à Jour
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Aperçu des mouvements récents et statuts globaux
              </p>
            </div>
            <button
              id="dash-btn-all-shipments"
              onClick={() => onNavigateTab('air')}
              className="text-xs font-bold text-[#643288] hover:underline dark:text-pink-400"
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
                  <th className="px-3 py-2 font-semibold">Statut Global</th>
                  <th className="px-3 py-2 font-semibold">ETA</th>
                  <th className="px-3 py-2 text-right font-semibold">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
                {recentShipments.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-xs text-slate-400 dark:text-slate-500">
                      Aucune expédition enregistrée pour le moment. Cliquez sur « Nouvelle Expédition » pour commencer.
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
                          <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
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
                          shp.global_status === 'Livré Client/Entrepôt'
                            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                            : shp.global_status === 'Livré Orly'
                            ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                            : shp.global_status === 'Bloqué Douane'
                            ? 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
                            : 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300'
                        }`}
                      >
                        {shp.global_status}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-slate-600 dark:text-slate-400 font-mono">
                      {shp.eta}
                    </td>
                    <td className="px-3 py-3 text-right">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectShipment(shp);
                        }}
                        className="rounded-lg bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-[#643288] hover:text-white dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-[#643288]"
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
              Actions Rapides Supply Chain
            </h3>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Règles d'automatisation & relances
            </p>

            <div className="mt-4 space-y-2.5">
              <button
                id="dash-quick-btn-assistant"
                onClick={() => onNavigateTab('assistant')}
                className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-slate-50 p-3 text-left transition hover:border-[#643288] hover:bg-purple-50/50 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-[#643288]"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#643288] text-white">
                    <Zap className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-slate-900 dark:text-white">
                      Analyse Globale par l'IA
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
                onClick={() => onNavigateTab('alerts')}
                className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-slate-50 p-3 text-left transition hover:border-rose-400 hover:bg-rose-50/50 dark:border-slate-700 dark:bg-slate-900"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-600 text-white">
                    <AlertTriangle className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-slate-900 dark:text-white">
                      Traiter le Stock Orly Souffrance
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
                onClick={() => onNavigateTab('analytics')}
                className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-slate-50 p-3 text-left transition hover:border-indigo-400 hover:bg-indigo-50/50 dark:border-slate-700 dark:bg-slate-900"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-white">
                    <TrendingUp className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-slate-900 dark:text-white">
                      Scorecards Transporteurs
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
