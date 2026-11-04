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
import { carrierSlas, meanTransitDays, summarizeSla } from '../lib/carrierSla';

interface AnalyticsViewProps {
  shipments: Shipment[];
  /** Paramètres: days of tolerance after the promised date. */
  slaToleranceDays: number;
}

export const AnalyticsView: React.FC<AnalyticsViewProps> = ({ shipments, slaToleranceDays }) => {
  // SLA transporteurs hub → Madagascar: promised arrival vs real arrival (+ tolerance)
  const carrierStats = useMemo(() => {
    const groups = new Map<string, { modes: Record<string, number>; list: ReturnType<typeof carrierSlas> }>();
    for (const x of carrierSlas(shipments, slaToleranceDays)) {
      const name = x.shipment.carrier || '—';
      const g = groups.get(name) ?? { modes: {}, list: [] };
      g.modes[x.shipment.mode] = (g.modes[x.shipment.mode] ?? 0) + 1;
      g.list.push(x);
      groups.set(name, g);
    }
    return Array.from(groups.entries())
      .map(([carrier, g]) => {
        const sum = summarizeSla(g.list);
        return {
          carrier,
          mode: Object.entries(g.modes).sort((a, b) => b[1] - a[1])[0][0],
          total: sum.measured,
          onTime: sum.onTime,
          delays: sum.late + sum.lateInTransit,
          meanDelay: sum.meanDelay,
          slaRate: sum.rate ?? 0,
        };
      })
      .sort((a, b) => b.total - a.total);
  }, [shipments, slaToleranceDays]);

  const transitAir = useMemo(() => meanTransitDays(shipments, 'Air'), [shipments]);
  const transitSea = useMemo(() => meanTransitDays(shipments, 'Sea'), [shipments]);

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
          <BarChart3 className="h-6 w-6 text-[#623387]" /> Analyses de performance et scorecards transporteurs
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
            <Award className="h-4 w-4 text-[#9E1B65]" /> Respect des SLAs par transporteur
          </h2>
          <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
            Hub → Madagascar : arrivée réelle comparée à la date promise (aérien : ETA MADA S du ; maritime : ETA
            d’arrivée), tolérance +{slaToleranceDays} j (Paramètres). Une expédition encore en route après cette date
            compte en retard.
          </p>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 uppercase tracking-wider text-[10px] dark:bg-slate-900/60 dark:text-slate-400">
                <tr>
                  <th className="px-3 py-2 font-semibold">Transporteur</th>
                  <th className="px-3 py-2 font-semibold">Mode principal</th>
                  <th className="px-3 py-2 font-semibold text-center">Mesurées</th>
                  <th className="px-3 py-2 font-semibold text-center">À l'heure</th>
                  <th className="px-3 py-2 font-semibold text-center">Retards</th>
                  <th className="px-3 py-2 font-semibold text-center">Retard moyen</th>
                  <th className="px-3 py-2 text-right font-semibold">Taux SLA</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                {carrierStats.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-xs text-slate-400 dark:text-slate-500">
                      Aucune expédition arrivée à Madagascar (ou en retard en route) à mesurer.
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
                    <td className="px-3 py-3 text-center font-mono text-slate-600 dark:text-slate-300">
                      {item.meanDelay === null ? '—' : `+${item.meanDelay.toLocaleString('fr-FR')} j`}
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
              <PieChart className="h-4 w-4 text-[#623387]" /> Top fournisseurs
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
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#623387] text-[10px] font-bold text-white">
                      {idx + 1}
                    </span>
                    <span className="font-bold text-slate-800 dark:text-slate-200">
                      {sup.supplier}
                    </span>
                  </div>
                  <span className="font-mono font-bold text-[#623387] dark:text-[#ED5DB2]">
                    {sup.count} expéditions
                  </span>
                </div>
              )))}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-800">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">
              Transit moyen hub → Madagascar
            </h3>
            <div className="mt-3 space-y-2">
              {[
                { label: 'Aérien (Orly → Madagascar)', t: transitAir },
                { label: 'Maritime (Rouen → Madagascar)', t: transitSea },
              ].map(({ label, t }) => (
                <div key={label} className="flex justify-between text-xs">
                  <span className="text-slate-500">{label}</span>
                  <span className="font-bold text-slate-900 dark:text-white">
                    {t.days === null ? '—' : `${t.days.toLocaleString('fr-FR')} jours`}
                    <span className="ml-1 font-normal text-slate-400">({t.count})</span>
                  </span>
                </div>
              ))}
              <p className="text-[10px] text-slate-400">Départ du hub → arrivée réelle à Madagascar, expéditions arrivées.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
