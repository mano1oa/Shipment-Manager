import React, { useMemo } from 'react';
import {
  BarChart3,
  TrendingUp,
  Award,
  AlertTriangle,
  Plane,
  Ship,
  Clock,
  CheckCircle2,
  PieChart,
} from 'lucide-react';
import { Shipment } from '../types';

interface AnalyticsViewProps {
  shipments: Shipment[];
}

export const AnalyticsView: React.FC<AnalyticsViewProps> = ({ shipments }) => {
  // Carrier SLA calculation
  const carrierStats = useMemo(() => {
    const stats: Record<
      string,
      { total: number; delays: number; onTime: number; mode: string }
    > = {};

    shipments.forEach((shp) => {
      if (!stats[shp.carrier]) {
        stats[shp.carrier] = { total: 0, delays: 0, onTime: 0, mode: shp.mode };
      }
      stats[shp.carrier].total += 1;
      const isDelayed =
        shp.carrier_status === 'Exception / Delay' ||
        (shp.alerts && shp.alerts.length > 0);
      if (isDelayed) {
        stats[shp.carrier].delays += 1;
      } else {
        stats[shp.carrier].onTime += 1;
      }
    });

    return Object.entries(stats).map(([carrier, data]) => {
      const slaRate = Math.round((data.onTime / data.total) * 100);
      return {
        carrier,
        mode: data.mode,
        total: data.total,
        delays: data.delays,
        onTime: data.onTime,
        slaRate,
      };
    });
  }, [shipments]);

  // Supplier Breakdown
  const topSuppliers = useMemo(() => {
    const counts: Record<string, number> = {};
    shipments.forEach((s) => {
      counts[s.supplier] = (counts[s.supplier] || 0) + 1;
    });
    return Object.entries(counts)
      .map(([supplier, count]) => ({ supplier, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }, [shipments]);

  return (
    <div className="space-y-6">
      {/* View Header */}
      <div>
        <h1 className="flex items-center gap-2 text-xl font-extrabold text-slate-900 dark:text-white">
          <BarChart3 className="h-6 w-6 text-[#643288]" /> Analyses de Performance & Scorecards Transporteurs
        </h1>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Suivi des SLAs, temps de transit moyens, taux de retards et performance des fournisseurs
        </p>
      </div>

      {/* SLA Leaderboard Grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Carrier SLA Table */}
        <div className="lg:col-span-2 rounded-2xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-800">
          <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2 border-b border-slate-100 pb-3 dark:border-slate-700">
            <Award className="h-4 w-4 text-[#A91869]" /> Respect des SLAs par Transporteur
          </h2>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 uppercase tracking-wider text-[10px] dark:bg-slate-900/60 dark:text-slate-400">
                <tr>
                  <th className="px-3 py-2 font-semibold">Transporteur</th>
                  <th className="px-3 py-2 font-semibold">Mode Principal</th>
                  <th className="px-3 py-2 font-semibold text-center">Expéditions</th>
                  <th className="px-3 py-2 font-semibold text-center">À l'Heure</th>
                  <th className="px-3 py-2 font-semibold text-center">Retards</th>
                  <th className="px-3 py-2 text-right font-semibold">Taux SLA</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                {carrierStats.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-xs text-slate-400 dark:text-slate-500">
                      Aucune expédition enregistrée pour le calcul des indicateurs SLA.
                    </td>
                  </tr>
                ) : (
                  carrierStats.map((item) => (
                  <tr key={item.carrier} className="hover:bg-slate-50 dark:hover:bg-slate-700/30">
                    <td className="px-3 py-3 font-bold text-slate-900 dark:text-slate-100">
                      {item.carrier}
                    </td>
                    <td className="px-3 py-3">
                      <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-700 dark:bg-slate-700 dark:text-slate-300">
                        {item.mode === 'Air' ? <Plane className="h-3 w-3" /> : <Ship className="h-3 w-3" />} {item.mode}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-center font-mono font-bold text-slate-800 dark:text-slate-200">
                      {item.total}
                    </td>
                    <td className="px-3 py-3 text-center font-mono text-emerald-600 font-bold">
                      {item.onTime}
                    </td>
                    <td className="px-3 py-3 text-center font-mono text-rose-600 font-bold">
                      {item.delays}
                    </td>
                    <td className="px-3 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-20 bg-slate-100 h-2 rounded-full overflow-hidden dark:bg-slate-700 hidden sm:block">
                          <div
                            className={`h-full rounded-full ${
                              item.slaRate >= 85
                                ? 'bg-emerald-500'
                                : item.slaRate >= 70
                                ? 'bg-amber-500'
                                : 'bg-rose-500'
                            }`}
                            style={{ width: `${item.slaRate}%` }}
                          />
                        </div>
                        <span
                          className={`font-bold font-mono text-xs ${
                            item.slaRate >= 85
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : item.slaRate >= 70
                              ? 'text-amber-600 dark:text-amber-400'
                              : 'text-rose-600 dark:text-rose-400'
                          }`}
                        >
                          {item.slaRate}%
                        </span>
                      </div>
                    </td>
                  </tr>
                )))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Top Suppliers & Metrics */}
        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-800">
            <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2 border-b border-slate-100 pb-3 dark:border-slate-700">
              <PieChart className="h-4 w-4 text-[#643288]" /> Top Fournisseurs
            </h2>

            <div className="mt-4 space-y-3">
              {topSuppliers.length === 0 ? (
                <div className="py-4 text-center text-xs text-slate-400 dark:text-slate-500">
                  Aucun fournisseur répertorié.
                </div>
              ) : (
                topSuppliers.map((sup, idx) => (
                <div
                  key={sup.supplier}
                  className="flex items-center justify-between rounded-xl bg-slate-50 p-2.5 text-xs dark:bg-slate-900/60"
                >
                  <div className="flex items-center gap-2">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#643288] text-[10px] font-bold text-white">
                      {idx + 1}
                    </span>
                    <span className="font-bold text-slate-800 dark:text-slate-200">
                      {sup.supplier}
                    </span>
                  </div>
                  <span className="font-mono font-bold text-[#643288] dark:text-pink-400">
                    {sup.count} expéditions
                  </span>
                </div>
              )))}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-800">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">
              SLA Moyen de Transit
            </h3>
            <div className="mt-3 space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-slate-500">Vol Aérien Express (CDG -&gt; TNR)</span>
                <span className="font-bold text-slate-900 dark:text-white">4.2 jours</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-slate-500">Transit Maritime (SHA -&gt; TMM)</span>
                <span className="font-bold text-slate-900 dark:text-white">32.5 jours</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-slate-500">Temps Moyen Dédouanement Ivato</span>
                <span className="font-bold text-slate-900 dark:text-white">1.8 jours</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
