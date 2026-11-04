import React, { useMemo } from 'react';
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
import type { ParcelsOverview } from './digiApi';
import { journeyStage } from './InTransitParcelsList';
import { carrierSlas, summarizeSla } from '../lib/carrierSla';

/** Days at the hub before a parcel is flagged (no departure to Madagascar). */
const HUB_OVERDUE_DAYS = 10;

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
  /** Parcels loaded by the app: the cards follow their statuses. */
  parcelsOverview: ParcelsOverview | null;
  parcelsLoading: boolean;
  /** Paramètres: days of tolerance of the SLA transporteurs. */
  slaToleranceDays: number;
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
  slaToleranceDays,
}) => {
  const canOpen = (tab: string) => !allowedTabs || allowedTabs.includes(tab);
  const criticalAlerts = alerts.filter((a) => a.severity === 'critical');
  // Latest changes first
  const recentShipments = [...shipments]
    .sort((a, b) => (b.updated_at || b.created_at || '').localeCompare(a.updated_at || a.created_at || ''))
    .slice(0, 6);

  /** Figures of the parcels (supplier → hub → Madagascar), from their statuses. */
  const pm = useMemo(() => {
    const parcels = parcelsOverview?.parcels ?? [];
    const byId = new Map<string, Shipment>(shipments.map((s) => [s.id, s]));
    const today = new Date().toISOString().slice(0, 10);
    const limit = new Date(Date.now() - HUB_OVERDUE_DAYS * 86400000).toISOString().slice(0, 10);
    const atHub = parcels.filter((p) => journeyStage(p, byId) === 'at_hub');
    // Received with an expected date: on time when received by that date
    const measured = parcels.filter((p) => p.received_at && p.expected_delivery);
    const onTime = measured.filter((p) => p.received_at!.slice(0, 10) <= p.expected_delivery!);

    // Expected at the hub in the next 7 days (today included)
    const in7 = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    const expectedWeek = parcels.filter(
      (p) => p.status === 'to_receive' && p.expected_delivery && p.expected_delivery >= today && p.expected_delivery <= in7
    );

    // Value at risk: invoices of the lost / searched parcels, each counted once
    const atRisk = new Map<string, { amount: number | null; currency: string }>();
    parcels
      .filter((p) => p.status === 'lost' || p.status === 'search')
      .forEach((p) => p.invoices.forEach((i) => atRisk.set(i.id, { amount: i.amount_total, currency: i.currency })));
    const riskByCurrency = new Map<string, number>();
    atRisk.forEach(({ amount, currency }) => {
      if (amount !== null) riskByCurrency.set(currency, (riskByCurrency.get(currency) ?? 0) + amount);
    });

    // Days between two YYYY-MM-DD dates
    const days = (from: string, to: string) => Math.round((Date.parse(to.slice(0, 10)) - Date.parse(from.slice(0, 10))) / 86400000);
    const avg = (list: number[]) => (list.length > 0 ? Math.round((list.reduce((a, b) => a + b, 0) / list.length) * 10) / 10 : null);
    const shipmentsOf = (p: (typeof parcels)[number]) =>
      p.shipment_ids.map((id) => byId.get(id)).filter((s): s is Shipment => Boolean(s));
    const departureOf = (s: Shipment) => s.departure_madagascar || s.etd || null;
    const madaReceiptOf = (s: Shipment) => s.mada_receipt_date || s.actual_arrival_date || null;

    // Time at the hub: reception → departure of its shipment
    const hubDelays: number[] = [];
    // Supplier → Madagascar: invoice date → reception at the Madagascar warehouse
    const endToEnd: number[] = [];
    for (const p of parcels) {
      const own = shipmentsOf(p);
      const departed = own.find((s) => s.global_status !== 'En préparation' && departureOf(s));
      if (p.received_at && departed) {
        const d = days(p.received_at, departureOf(departed)!);
        if (d >= 0) hubDelays.push(d);
      }
      const delivered = own.find((s) => s.global_status === 'Livrée entrepôt' && madaReceiptOf(s));
      const invoiceDate = p.invoices.map((i) => i.invoice_date).filter((d): d is string => Boolean(d)).sort()[0];
      if (delivered && invoiceDate) {
        const d = days(invoiceDate, madaReceiptOf(delivered)!);
        if (d >= 0) endToEnd.push(d);
      }
    }
    const waitingNow = atHub.filter((p) => p.received_at).map((p) => days(p.received_at!, today));

    return {
      expectedWeek: expectedWeek.length,
      expectedWeekOrly: expectedWeek.filter((p) => p.destination === 'ORLY').length,
      expectedWeekRouen: expectedWeek.filter((p) => p.destination === 'ROUEN').length,
      riskInvoices: atRisk.size,
      riskEur: riskByCurrency.get('EUR') ?? 0,
      riskOther: Array.from(riskByCurrency.entries()).filter(([c]) => c !== 'EUR'),
      hubDelay: avg(hubDelays),
      hubDelayCount: hubDelays.length,
      waitingNow: avg(waitingNow),
      endToEnd: avg(endToEnd),
      endToEndCount: endToEnd.length,
      total: parcels.length,
      lost: parcels.filter((p) => p.status === 'lost').length,
      search: parcels.filter((p) => p.status === 'search').length,
      atHubOrly: atHub.filter((p) => p.destination === 'ORLY').length,
      atHubRouen: atHub.filter((p) => p.destination === 'ROUEN').length,
      atHubOverdue: atHub.filter((p) => p.received_at && p.received_at.slice(0, 10) < limit).length,
      late: parcels.filter((p) => p.status === 'to_receive' && p.expected_delivery && p.expected_delivery < today).length,
      measured: measured.length,
      slaRate: measured.length > 0 ? Math.round((onTime.length / measured.length) * 100) : null,
    };
  }, [parcelsOverview, shipments]);
  // SLA transitaire hub → Madagascar
  const sla = useMemo(() => summarizeSla(carrierSlas(shipments, slaToleranceDays)), [shipments, slaToleranceDays]);
  const ongoing = shipments.filter((s) => s.global_status !== 'Livrée entrepôt');
  const shipmentExceptions = shipments.filter((s) => s.carrier_status === 'Exception / Delay').length;
  const lossRate = pm.total > 0 ? Math.round(((pm.lost + pm.search) / pm.total) * 1000) / 10 : 0;
  /** Parcels not loaded yet: "…" instead of misleading zeros. */
  const pending = parcelsLoading && !parcelsOverview ? '…' : null;

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
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-[#623387] to-[#9E1B65] px-5 py-3 text-white shadow-md">
        <div className="relative z-10 flex flex-col justify-between gap-3 md:flex-row md:items-center">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-base font-extrabold tracking-tight md:text-lg">Tableau de bord exécutif et opérationnel</h1>
            <span className="inline-flex items-center gap-1 rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-semibold">
              <Zap className="h-3 w-3 text-amber-300" /> Pilotage IA Supply Chain
            </span>
          </div>
          <div className="flex gap-2">
            <button
              id="dash-btn-air-tab"
              hidden={!canOpen('air')}
              onClick={() => onNavigateTab('air')}
              className="flex items-center gap-2 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur transition hover:bg-white/20"
            >
              <Plane className="h-4 w-4" /> Suivi aérien ({metrics.airCount})
            </button>
            <button
              id="dash-btn-sea-tab"
              hidden={!canOpen('sea')}
              onClick={() => onNavigateTab('sea')}
              className="flex items-center gap-2 rounded-lg bg-white px-3 py-1.5 text-xs font-bold text-[#623387] shadow-sm transition hover:bg-[#F8EEFF]"
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
              Expéditions en cours
            </span>
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#623387]/10 text-[#623387] dark:bg-[#623387]/30 dark:text-[#ED5DB2]">
              <Package className="h-5 w-5" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline justify-between">
            <span className="text-3xl font-extrabold text-slate-900 dark:text-white">
              {ongoing.length}
            </span>
            <div className="flex gap-2 text-xs font-medium text-slate-500">
              <span className="flex items-center gap-0.5 text-sky-600 dark:text-sky-400">
                <Plane className="h-3 w-3" /> {ongoing.filter((s) => s.mode === 'Air').length}
              </span>
              <span className="flex items-center gap-0.5 text-sky-600 dark:text-sky-400">
                <Ship className="h-3 w-3" /> {ongoing.filter((s) => s.mode === 'Sea').length}
              </span>
            </div>
          </div>
          <div className="mt-3 text-xs text-slate-500 dark:text-slate-400">
            Non livrées à Madagascar · {metrics.totalShipments - ongoing.length} livrée(s) · {pending ?? pm.total} colis suivis
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
            <span className="text-3xl font-extrabold text-rose-700 dark:text-rose-300">
              {pending ?? `${lossRate.toLocaleString('fr-FR')} %`}
            </span>
            <span className="text-xs font-bold text-rose-700 dark:text-rose-300">
              {pm.lost} perdu(s) · {pm.search} recherche(s)
            </span>
          </div>
          <div className="mt-3 text-xs text-rose-800/80 dark:text-rose-300/80">
            Colis perdus ou en avis de recherche, sur {pm.total} colis
            {metrics.totalValuePerduOrly > 0 && ` · anciens « Perdu Orly » : ${formatCurrency(metrics.totalValuePerduOrly)}`}
          </div>
        </div>

        {/* Orly Stock & Critical Hub Timeout */}
        <div className="rounded-2xl border border-amber-200 bg-amber-50/50 p-5 shadow-sm transition hover:shadow-md dark:border-amber-900/50 dark:bg-amber-950/20">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-amber-800 dark:text-amber-300">
              Colis au hub, à expédier
            </span>
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500/20 text-amber-700 dark:text-amber-300">
              <Building2 className="h-5 w-5" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline justify-between">
            <span className="text-3xl font-extrabold text-amber-900 dark:text-amber-100">
              {pending ?? pm.atHubOrly + pm.atHubRouen}
            </span>
            {pm.atHubOverdue > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-xs font-bold text-rose-700 dark:bg-rose-950 dark:text-rose-300">
                ⚠️ {pm.atHubOverdue} &gt; {HUB_OVERDUE_DAYS} jours
              </span>
            )}
          </div>
          <div className="mt-3 text-xs text-amber-800/80 dark:text-amber-300/80">
            Reçus, pas encore partis vers Madagascar · Orly {pm.atHubOrly} · Rouen {pm.atHubRouen}
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
              {pending ?? pm.late + shipmentExceptions}
            </span>
            <span className="text-xs font-bold text-rose-700 dark:text-rose-300">
              {metrics.customsBlockedCount} Douane
            </span>
          </div>
          <div className="mt-3 text-xs text-slate-500 dark:text-slate-400">
            {pm.late} colis attendus en retard · {shipmentExceptions} expédition(s) en exception
          </div>
        </div>

        {/* SLA Compliance */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:shadow-md dark:border-slate-800 dark:bg-slate-800">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Colis reçus à temps
            </span>
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400">
              <TrendingUp className="h-5 w-5" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline justify-between">
            <span className="text-3xl font-extrabold text-emerald-600 dark:text-emerald-400">
              {pending ?? (pm.slaRate === null ? '—' : `${pm.slaRate}%`)}
            </span>
            {pm.slaRate !== null && (
              <span
                className={`text-xs font-semibold ${
                  pm.slaRate >= 85 ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300'
                }`}
              >
                {pm.slaRate >= 85 ? 'Conforme' : 'Sous l’objectif'}
              </span>
            )}
          </div>
          <div className="mt-3 text-xs text-slate-500 dark:text-slate-400">
            {pm.measured > 0
              ? `Colis reçus au hub à la date prévue (${pm.measured} mesurés) · objectif > 85 %`
              : 'Aucun colis reçu avec une livraison prévue'}
          </div>
        </div>
      </div>

      {/* Parcel indicators */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:shadow-md dark:border-slate-800 dark:bg-slate-800">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Attendus sous 7 jours</span>
          <div className="mt-3 text-3xl font-extrabold text-slate-900 dark:text-white">{pending ?? pm.expectedWeek}</div>
          <div className="mt-3 text-xs text-slate-500 dark:text-slate-400">Colis à recevoir · Orly {pm.expectedWeekOrly} · Rouen {pm.expectedWeekRouen}</div>
        </div>
        <button
          type="button"
          disabled={!canOpen('digi')}
          onClick={() => onNavigateTab('digi')}
          className="rounded-2xl border border-amber-200 bg-amber-50/50 p-5 text-left shadow-sm transition hover:shadow-md disabled:cursor-default dark:border-amber-900/50 dark:bg-amber-950/20"
        >
          <span className="text-xs font-bold uppercase tracking-wider text-amber-800 dark:text-amber-300">Factures sans colis</span>
          <div className="mt-3 text-3xl font-extrabold text-amber-900 dark:text-amber-100">
            {pending ?? parcelsOverview?.invoices_without_parcel.length ?? 0}
          </div>
          <div className="mt-3 text-xs text-amber-800/80 dark:text-amber-300/80">
            Factures marchandises sans aucun colis{canOpen('digi') ? ' · ouvrir les factures →' : ''}
          </div>
        </button>
        <div className="rounded-2xl border border-rose-200 bg-rose-50/50 p-5 shadow-sm transition hover:shadow-md dark:border-rose-900/50 dark:bg-rose-950/20">
          <span className="text-xs font-bold uppercase tracking-wider text-rose-900 dark:text-rose-300">Valeur à risque</span>
          <div className="mt-3 text-2xl font-extrabold font-mono text-rose-700 dark:text-rose-300">
            {pending ?? formatCurrency(pm.riskEur)}
          </div>
          <div className="mt-3 text-xs text-rose-800/80 dark:text-rose-300/80">
            {pm.riskInvoices} facture(s) des colis perdus ou en recherche
            {pm.riskOther.map(([c, v]) => ` · ${Math.round(v).toLocaleString('fr-FR')} ${c}`).join('')}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:shadow-md dark:border-slate-800 dark:bg-slate-800">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Délai moyen au hub</span>
          <div className="mt-3 text-3xl font-extrabold text-slate-900 dark:text-white">{pending ?? (pm.hubDelay === null ? '—' : `${pm.hubDelay.toLocaleString('fr-FR')} j`)}</div>
          <div className="mt-3 text-xs text-slate-500 dark:text-slate-400">Réception → départ vers Madagascar ({pm.hubDelayCount} colis)
            {pm.waitingNow !== null && ` · en attente : ${pm.waitingNow.toLocaleString('fr-FR')} j en moyenne`}</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:shadow-md dark:border-slate-800 dark:bg-slate-800">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Fournisseur → Madagascar</span>
          <div className="mt-3 text-3xl font-extrabold text-slate-900 dark:text-white">{pending ?? (pm.endToEnd === null ? '—' : `${pm.endToEnd.toLocaleString('fr-FR')} j`)}</div>
          <div className="mt-3 text-xs text-slate-500 dark:text-slate-400">Date de facture → réception à l’entrepôt ({pm.endToEndCount} colis livrés)</div>
        </div>
        <button
          type="button"
          disabled={!onOpenAnalytics}
          onClick={onOpenAnalytics}
          title="Date d’arrivée à Madagascar promise (aérien : ETA MADA S du ; maritime : ETA d’arrivée) comparée à la date réelle"
          className="rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:shadow-md disabled:cursor-default dark:border-slate-800 dark:bg-slate-800"
        >
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            SLA transitaire (Orly → Mada)
          </span>
          <div className="mt-3 flex items-baseline justify-between">
            <span
              className={`text-3xl font-extrabold ${
                sla.rate === null
                  ? 'text-slate-900 dark:text-white'
                  : sla.rate >= 85
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-rose-600 dark:text-rose-400'
              }`}
            >
              {sla.rate === null ? '—' : `${sla.rate}%`}
            </span>
            {sla.rate !== null && (
              <span className={`text-xs font-semibold ${sla.rate >= 85 ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300'}`}>
                {sla.rate >= 85 ? 'Conforme' : 'Sous l’objectif'}
              </span>
            )}
          </div>
          <div className="mt-3 text-xs text-slate-500 dark:text-slate-400">
            {sla.measured > 0
              ? `Hub → Madagascar à la date promise (+${slaToleranceDays} j) · ${sla.measured} expédition(s)${
                  sla.lateInTransit > 0 ? ` · ${sla.lateInTransit} en retard en route` : ''
                }`
              : 'Aucune expédition arrivée à Madagascar à mesurer'}
          </div>
        </button>
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
                      {pm.atHubOverdue} colis au hub depuis plus de {HUB_OVERDUE_DAYS} j
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
