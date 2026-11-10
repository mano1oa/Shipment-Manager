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
import { carrierSlas, meanTransitDays, parcelCarrierSlas, summarizeSla } from '../lib/carrierSla';
import { CARRIER_LABELS } from '../lib/carrierDetection';
import type { Parcel } from './digiApi';

interface AnalyticsViewProps {
  shipments: Shipment[];
  /** Supplier parcels (null while loading): SLA of the carriers supplier → hub. */
  parcels: Parcel[] | null;
  /** Paramètres: days of tolerance after the promised date. */
  slaToleranceDays: number;
}

export const AnalyticsView: React.FC<AnalyticsViewProps> = ({ shipments, parcels, slaToleranceDays }) => {
  // SLA transporteurs fournisseur → hub: received by the expected delivery
  const carrierStats = useMemo(
    () =>
      parcelCarrierSlas(parcels || [], (p) =>
        p.carrier_name || (p.carrier !== 'UNKNOWN' ? CARRIER_LABELS[p.carrier as keyof typeof CARRIER_LABELS] : '') || 'Non renseigné'
      ),
    [parcels]
  );
  // SLA transitaire hub → Madagascar: promised arrival vs real arrival (+ tolerance)
  const forwarderSla = useMemo(() => summarizeSla(carrierSlas(shipments, slaToleranceDays)), [shipments, slaToleranceDays]);

  const transitAir = useMemo(() => meanTransitDays(shipments, 'Air'), [shipments]);
  const transitSea = useMemo(() => meanTransitDays(shipments, 'Sea'), [shipments]);

  // Supplier Breakdown
  // A shipment grouping several suppliers is labelled "3 fournisseurs": count its real
  // suppliers instead, from the invoices of its parcels (each shipment once per supplier).
  const topSuppliers = useMemo(() => {
    const byShipment = new Map<string, Set<string>>();
    for (const p of parcels || []) {
      const names = p.invoices.map((i) => i.supplier_display?.trim()).filter((n): n is string => Boolean(n));
      if (names.length === 0 && p.supplier_name?.trim()) names.push(p.supplier_name.trim());
      for (const id of p.shipment_ids) {
        const set = byShipment.get(id) ?? new Set<string>();
        names.forEach((n) => set.add(n));
        byShipment.set(id, set);
      }
    }
    const counts = new Map<string, number>();
    for (const s of shipments) {
      const fromParcels = byShipment.get(s.id);
      const names =
        fromParcels && fromParcels.size > 0
          ? Array.from(fromParcels)
          : s.supplier && !/^\d+ fournisseurs?$/.test(s.supplier.trim()) && s.supplier.trim() !== '—'
            ? [s.supplier.trim()]
            : [];
      names.forEach((n) => counts.set(n, (counts.get(n) ?? 0) + 1));
    }
    return Array.from(counts.entries())
      .map(([supplier, count]) => ({ supplier, count }))
      .sort((a, b) => b.count - a.count || a.supplier.localeCompare(b.supplier, 'fr'))
      .slice(0, 5);
  }, [shipments, parcels]);

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
            <Award className="h-4 w-4 text-[#9E1B65]" /> SLA transporteurs (fournisseur → Orly / Rouen)
          </h2>
          <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
            Colis reçus au hub au plus tard à leur date de livraison prévue. Les colis perdus sont comptés à part.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-[11px] text-slate-600 dark:bg-slate-900/60 dark:text-slate-300">
            <span className="font-bold text-slate-800 dark:text-slate-100">SLA transitaire (Orly → Mada) :</span>
            <span
              className={`font-mono font-bold ${
                forwarderSla.rate === null
                  ? ''
                  : forwarderSla.rate >= 85
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-rose-600 dark:text-rose-400'
              }`}
            >
              {forwarderSla.rate === null ? '—' : `${forwarderSla.rate}%`}
            </span>
            <span>
              {forwarderSla.measured > 0
                ? `${forwarderSla.onTime}/${forwarderSla.measured} expédition(s) arrivée(s) à la date promise (aérien : ETA MADA S du ; maritime : ETA d’arrivée), tolérance +${slaToleranceDays} j`
                : 'aucune expédition arrivée à Madagascar à mesurer'}
              {forwarderSla.meanDelay !== null && ` · retard moyen +${forwarderSla.meanDelay.toLocaleString('fr-FR')} j`}
            </span>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 uppercase tracking-wider text-[10px] dark:bg-slate-900/60 dark:text-slate-400">
                <tr>
                  <th className="px-3 py-2 font-semibold">Transporteur</th>
                  <th className="px-3 py-2 font-semibold">Hub</th>
                  <th className="px-3 py-2 font-semibold text-center">Mesurés</th>
                  <th className="px-3 py-2 font-semibold text-center">À l'heure</th>
                  <th className="px-3 py-2 font-semibold text-center">Retards</th>
                  <th className="px-3 py-2 font-semibold text-center">Retard moyen</th>
                  <th className="px-3 py-2 font-semibold text-center">Perdus</th>
                  <th className="px-3 py-2 text-right font-semibold">Taux SLA</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                {carrierStats.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-xs text-slate-400 dark:text-slate-500">
                      {parcels === null ? 'Chargement des colis…' : 'Aucun colis reçu avec une date de livraison prévue à mesurer.'}
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
                        {item.destination === 'ORLY' ? <Plane className="h-3 w-3" /> : <Ship className="h-3 w-3" />}{' '}
                        {item.destination === 'ORLY' ? 'Orly' : 'Rouen'}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-center font-mono font-bold text-slate-800 dark:text-slate-200">
                      {item.measured}
                    </td>
                    <td className="px-3 py-3 text-center font-mono text-emerald-600 font-bold">
                      {item.onTime}
                    </td>
                    <td className="px-3 py-3 text-center font-mono text-rose-600 font-bold">
                      {item.late}
                    </td>
                    <td className="px-3 py-3 text-center font-mono text-slate-600 dark:text-slate-300">
                      {item.meanDelay === null ? '—' : `+${item.meanDelay.toLocaleString('fr-FR')} j`}
                    </td>
                    <td className="px-3 py-3 text-center font-mono text-slate-600 dark:text-slate-300">{item.lost}</td>
                    <td className="px-3 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-20 bg-slate-100 h-2 rounded-full overflow-hidden dark:bg-slate-700 hidden sm:block">
                          <div
                            className={`h-full rounded-full ${
                              (item.rate ?? 0) >= 85
                                ? 'bg-emerald-500'
                                : (item.rate ?? 0) >= 70
                                ? 'bg-amber-500'
                                : 'bg-rose-500'
                            }`}
                            style={{ width: `${item.rate === null ? '—' : `${item.rate}%`}` }}
                          />
                        </div>
                        <span
                          className={`font-bold font-mono text-xs ${
                            (item.rate ?? 0) >= 85
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : (item.rate ?? 0) >= 70
                              ? 'text-amber-600 dark:text-amber-400'
                              : 'text-rose-600 dark:text-rose-400'
                          }`}
                        >
                          {(item.rate ?? 0)}%
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
                    {sup.count} expédition{sup.count > 1 ? 's' : ''}
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
