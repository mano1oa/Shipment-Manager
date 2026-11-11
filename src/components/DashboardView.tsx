import React, { useMemo } from 'react';
import {
  Plane,
  Ship,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  TrendingUp,
  ShieldAlert,
  Send,
  Building2,
  ReceiptText,
  Sparkles,
} from 'lucide-react';
import { ui } from '../lib/ui';
import { Shipment, ShipmentAlert, MetricSummary, shipmentLabel } from '../types';
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


  /** Where the parcels stand, supplier → hub → Madagascar (lost / searched ones are in the loss rate). */
  const flow = useMemo(() => {
    const parcels = parcelsOverview?.parcels ?? [];
    const byId = new Map<string, Shipment>(shipments.map((s) => [s.id, s]));
    const staged = parcels.map((p) => ({ p, stage: journeyStage(p, byId) }));
    const of = (...stages: string[]) => staged.filter((x) => stages.includes(x.stage));
    const toHub = of('to_hub');
    const atHub = of('at_hub');
    const toMada = of('to_mada', 'customs');
    const delivered = of('delivered');
    const count = (list: typeof staged, dest: 'ORLY' | 'ROUEN') => list.filter((x) => x.p.destination === dest).length;
    return [
      {
        key: 'to_hub',
        label: 'Attendus du fournisseur',
        value: toHub.length,
        detail: `dont ${pm.expectedWeek} sous 7 jours`,
        color: '#C9B6DD',
      },
      {
        key: 'at_hub',
        label: 'Au hub',
        value: atHub.length,
        detail: `Orly ${count(atHub, 'ORLY')} · Rouen ${count(atHub, 'ROUEN')}`,
        color: '#E8A33D',
      },
      {
        key: 'to_mada',
        label: 'En route vers Mada',
        value: toMada.length,
        detail: `Avion ${count(toMada, 'ORLY')} · Bateau ${count(toMada, 'ROUEN')}`,
        color: '#43A0D9',
      },
      {
        key: 'delivered',
        label: 'Reçus à Madagascar',
        value: delivered.length,
        detail: `Avion ${count(delivered, 'ORLY')} · Bateau ${count(delivered, 'ROUEN')}`,
        color: '#2E9E5B',
      },
    ];
  }, [parcelsOverview, shipments, pm.expectedWeek]);
  const flowTotal = flow.reduce((sum, s) => sum + s.value, 0);
  const invoicesWithoutParcel = parcelsOverview?.invoices_without_parcel.length ?? 0;

  /** "À traiter aujourd'hui": only the items that need someone. */
  const todo: {
    key: string;
    tone: 'red' | 'amber' | 'violet';
    icon: React.ElementType;
    title: string;
    detail: string;
    onClick?: () => void;
    action?: { label: string; onClick: () => void };
  }[] = [];
  if (criticalAlerts.length > 0) {
    todo.push({
      key: 'alerts',
      tone: 'red',
      icon: ShieldAlert,
      title: `${criticalAlerts.length} alerte${criticalAlerts.length > 1 ? 's' : ''} critique${criticalAlerts.length > 1 ? 's' : ''}`,
      detail: `${criticalAlerts[0]?.title ?? ''}${criticalAlerts[0]?.reason ? ` — ${criticalAlerts[0].reason}` : ''}`,
      onClick: canOpen('alerts') ? () => onNavigateTab('alerts') : undefined,
      action: criticalAlerts[0]?.relance_draft
        ? { label: 'Générer relance chat', onClick: () => onOpenRelanceModal(criticalAlerts[0]) }
        : undefined,
    });
  }
  if (pm.atHubOverdue > 0) {
    todo.push({
      key: 'hub',
      tone: 'amber',
      icon: Building2,
      title: `${pm.atHubOverdue} colis au hub depuis plus de ${HUB_OVERDUE_DAYS} jours`,
      detail: 'Reçus, pas encore partis vers Madagascar : à grouper dans une expédition',
      onClick: canOpen('air') ? () => onNavigateTab(pm.atHubOrly >= pm.atHubRouen ? 'air' : 'sea') : undefined,
    });
  }
  if (invoicesWithoutParcel > 0) {
    todo.push({
      key: 'invoices',
      tone: 'violet',
      icon: ReceiptText,
      title: `${invoicesWithoutParcel} facture${invoicesWithoutParcel > 1 ? 's' : ''} sans colis`,
      detail: 'Factures marchandises sans aucun colis : ajouter le BL et les colis',
      onClick: canOpen('digi') ? () => onNavigateTab('digi') : undefined,
    });
  }
  const toneClasses = {
    red: {
      box: 'border-[#F5C9C6] bg-[#FFF6F5] dark:border-rose-900/60 dark:bg-rose-950/30',
      icon: 'bg-[#FDE1DF] text-[#B42318] dark:bg-rose-900/50 dark:text-rose-300',
      chevron: 'text-[#B42318] dark:text-rose-300',
    },
    amber: {
      box: 'border-[#F3D9AE] bg-[#FFF9EF] dark:border-amber-900/60 dark:bg-amber-950/30',
      icon: 'bg-[#FCEACB] text-[#8A4B00] dark:bg-amber-900/50 dark:text-amber-300',
      chevron: 'text-[#8A4B00] dark:text-amber-300',
    },
    violet: {
      box: 'border-[#E1D2EE] bg-[#FAF6FD] dark:border-purple-900/60 dark:bg-purple-950/30',
      icon: 'bg-[#EEE2F8] text-[#623387] dark:bg-purple-900/50 dark:text-[#B688FF]',
      chevron: 'text-[#623387] dark:text-[#B688FF]',
    },
  };

  const statusPill = (status: Shipment['global_status']) =>
    status === 'Livrée entrepôt'
      ? 'bg-[#E2F5EA] text-[#1C7A45] dark:bg-emerald-950 dark:text-emerald-300'
      : status === 'En préparation'
        ? 'bg-[#FDF0DC] text-[#8A4B00] dark:bg-amber-950 dark:text-amber-300'
        : status === 'Bloquée douane'
          ? 'bg-[#FDE8E7] text-[#B42318] dark:bg-rose-950 dark:text-rose-300'
          : 'bg-[#E3F1FA] text-[#1F5F8F] dark:bg-sky-950 dark:text-sky-300';

  const rateBadge = (rate: number | null) =>
    rate === null ? null : rate >= 85 ? (
      <span className="rounded-full bg-[#E2F5EA] px-2 py-0.5 text-xs font-semibold text-[#1C7A45] dark:bg-emerald-950 dark:text-emerald-300">
        Conforme
      </span>
    ) : (
      <span className="rounded-full bg-[#FDE8E7] px-2 py-0.5 text-xs font-semibold text-[#B42318] dark:bg-rose-950 dark:text-rose-300">
        Sous l’objectif
      </span>
    );

  /** Progress bar with the 85 % target mark. */
  const rateBar = (rate: number | null) =>
    rate === null ? null : (
      <div className="relative h-1.5 rounded-full bg-[#ECE9F0] dark:bg-slate-800">
        <span
          className={`absolute inset-y-0 left-0 rounded-full ${rate >= 85 ? 'bg-[#2E9E5B]' : 'bg-[#D9534F]'}`}
          style={{ width: `${Math.min(rate, 100)}%` }}
        />
        <span className="absolute -top-[3px] h-3 w-0.5 bg-[#17111F] dark:bg-white" style={{ left: '85%' }} aria-hidden="true" />
      </div>
    );

  const kpiCard = `${ui.card} flex flex-col gap-2 p-5`;
  const kpiLabel = `text-[13px] font-medium ${ui.muted}`;
  const kpiValue = `text-[28px] font-semibold leading-tight tracking-tight tabular-nums ${ui.title}`;
  const kpiDetail = `text-[13px] ${ui.muted}`;

  return (
    <div className="space-y-6">
      {/* À traiter aujourd'hui */}
      <section className="space-y-3">
        <h2 className={ui.sectionTitle}>À traiter aujourd’hui</h2>
        {todo.length === 0 ? (
          <div className={`${ui.card} flex items-center gap-2.5 px-3 py-2.5 text-[13px] ${ui.muted}`}>
            <CheckCircle2 className="h-4 w-4 text-[#2E9E5B]" /> Rien d’urgent : aucune alerte critique, aucun colis bloqué au hub.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
            {todo.map((t) => {
              const Icon = t.icon;
              const tone = toneClasses[t.tone];
              // Alert titles may start with an emoji (🚨): not shown here
              const detail = t.detail.replace(/^[\p{Extended_Pictographic}️\s]+/u, '');
              return (
                <div key={t.key} className={`flex items-center gap-2 rounded-xl border px-3 py-2 ${tone.box}`}>
                  <button
                    type="button"
                    disabled={!t.onClick}
                    onClick={t.onClick}
                    title={detail}
                    className="flex min-w-0 flex-1 items-center gap-2.5 text-left disabled:cursor-default"
                  >
                    <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${tone.icon}`}>
                      <Icon className="h-3.5 w-3.5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate text-[13px] font-semibold ${ui.title}`}>{t.title}</span>
                      <span className={`block truncate text-xs ${ui.muted}`}>{detail}</span>
                    </span>
                  </button>
                  {t.action && (
                    <button
                      type="button"
                      onClick={t.action.onClick}
                      title={t.action.label}
                      className="inline-flex shrink-0 items-center gap-1 rounded-md bg-[#B42318] px-2 py-1 text-[11px] font-semibold text-white hover:bg-[#931c13]"
                    >
                      <Send className="h-3 w-3" /> Relance
                    </button>
                  )}
                  {t.onClick && <ChevronRight className={`h-4 w-4 shrink-0 ${tone.chevron}`} aria-hidden="true" />}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Où sont les colis */}
      <section className={`${ui.card} space-y-5 p-6`}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className={ui.sectionTitle}>Où sont les colis</h2>
          <span className={`text-[13px] ${ui.muted}`}>
            {pending ?? pm.total} colis suivis
            {pm.lost + pm.search > 0 && ` · ${pm.lost} perdu(s), ${pm.search} en recherche`}
          </span>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {flow.map((s) => (
            <div key={s.key} className={`${ui.well} flex flex-col gap-2.5 p-4`}>
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: s.color }} />
                <span className={`text-[13px] font-semibold ${ui.text}`}>{s.label}</span>
              </div>
              <span className={`text-[32px] font-semibold leading-none tracking-tight tabular-nums ${ui.title}`}>
                {pending ?? s.value}
              </span>
              <span className={`text-[13px] ${ui.muted}`}>{pending ? '…' : s.detail}</span>
            </div>
          ))}
        </div>
        {flowTotal > 0 && (
          <div
            className="flex h-2.5 gap-[3px] overflow-hidden rounded-full"
            role="img"
            aria-label={`Répartition des colis : ${flow.map((s) => `${s.value} ${s.label.toLowerCase()}`).join(', ')}`}
          >
            {flow
              .filter((s) => s.value > 0)
              .map((s) => (
                <span key={s.key} style={{ flex: `${s.value} 1 0`, background: s.color }} />
              ))}
          </div>
        )}
      </section>

      {/* Indicateurs clés */}
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div id="dash-card-value-in-transit" className={kpiCard}>
          <span className={kpiLabel}>Valeur en transit</span>
          <span className={kpiValue}>{formatCurrency(metrics.totalValueInTransit)}</span>
          <span className={kpiDetail}>
            Expédiées vers Madagascar · {ongoing.length} expédition(s) en cours
          </span>
        </div>
        <div className={kpiCard}>
          <span className={kpiLabel}>Colis reçus à temps au hub</span>
          <div className="flex items-baseline gap-2">
            <span className={kpiValue}>{pending ?? (pm.slaRate === null ? '—' : `${pm.slaRate} %`)}</span>
            {!pending && rateBadge(pm.slaRate)}
          </div>
          {!pending && rateBar(pm.slaRate)}
          <span className={kpiDetail}>
            {pm.measured > 0 ? `Objectif 85 % · ${pm.measured} colis mesurés` : 'Aucun colis reçu avec une livraison prévue'}
          </span>
        </div>
        <button
          type="button"
          disabled={!onOpenAnalytics}
          onClick={onOpenAnalytics}
          title="Date d’arrivée à Madagascar promise (aérien : ETA MADA S du ; maritime : ETA d’arrivée) comparée à la date réelle"
          className={`${kpiCard} text-left transition enabled:hover:border-[#C9B6DD] disabled:cursor-default`}
        >
          <span className={kpiLabel}>SLA transitaire (hub → Mada)</span>
          <div className="flex items-baseline gap-2">
            <span className={kpiValue}>{sla.rate === null ? '—' : `${sla.rate} %`}</span>
            {rateBadge(sla.rate)}
          </div>
          {rateBar(sla.rate)}
          <span className={kpiDetail}>
            {sla.measured > 0
              ? `À la date promise (+${slaToleranceDays} j) · ${sla.measured} expédition(s)${
                  sla.lateInTransit > 0 ? ` · ${sla.lateInTransit} en retard en route` : ''
                }`
              : 'Aucune expédition arrivée à Madagascar à mesurer'}
          </span>
        </button>
        <div id="dash-card-loss-rate" className={kpiCard}>
          <span className={kpiLabel}>Taux de perte</span>
          <span className={`${kpiValue} ${lossRate > 0 ? '!text-[#B42318] dark:!text-rose-300' : ''}`}>
            {pending ?? `${lossRate.toLocaleString('fr-FR')} %`}
          </span>
          <span className={kpiDetail}>
            {pm.lost} perdu(s) · {pm.search} avis de recherche, sur {pm.total} colis
            {metrics.totalValuePerduOrly > 0 && ` · anciens « Perdu Orly » : ${formatCurrency(metrics.totalValuePerduOrly)}`}
          </span>
        </div>
      </section>

      {/* Autres indicateurs */}
      <section className={`${ui.card} p-5`}>
        <h2 className={`${ui.sectionTitle} mb-4`}>Autres indicateurs</h2>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 xl:grid-cols-3">
          {[
            {
              label: 'Retards et bloqués douane',
              value: pending ?? `${pm.late + shipmentExceptions}`,
              detail: `${pm.late} colis attendus en retard · ${shipmentExceptions} expédition(s) en exception · ${metrics.customsBlockedCount} en douane`,
              alert: pm.late + shipmentExceptions + metrics.customsBlockedCount > 0,
            },
            {
              label: 'Valeur à risque',
              value: pending ?? formatCurrency(pm.riskEur),
              detail: `${pm.riskInvoices} facture(s) des colis perdus ou en recherche${pm.riskOther
                .map(([c, v]) => ` · ${Math.round(v).toLocaleString('fr-FR')} ${c}`)
                .join('')}`,
              alert: pm.riskEur > 0,
            },
            {
              label: 'Colis au hub, à expédier',
              value: pending ?? `${pm.atHubOrly + pm.atHubRouen}`,
              detail: `Orly ${pm.atHubOrly} · Rouen ${pm.atHubRouen}${pm.atHubOverdue > 0 ? ` · ${pm.atHubOverdue} depuis plus de ${HUB_OVERDUE_DAYS} j` : ''}`,
              alert: false,
            },
            {
              label: 'Attendus sous 7 jours',
              value: pending ?? `${pm.expectedWeek}`,
              detail: `Orly ${pm.expectedWeekOrly} · Rouen ${pm.expectedWeekRouen}`,
              alert: false,
            },
            {
              label: 'Délai moyen au hub',
              value: pending ?? (pm.hubDelay === null ? '—' : `${pm.hubDelay.toLocaleString('fr-FR')} j`),
              detail: `Réception → départ vers Madagascar (${pm.hubDelayCount} colis)${
                pm.waitingNow !== null ? ` · en attente : ${pm.waitingNow.toLocaleString('fr-FR')} j en moyenne` : ''
              }`,
              alert: false,
            },
            {
              label: 'Fournisseur → Madagascar',
              value: pending ?? (pm.endToEnd === null ? '—' : `${pm.endToEnd.toLocaleString('fr-FR')} j`),
              detail: `Date de facture → réception à l’entrepôt (${pm.endToEndCount} colis livrés)`,
              alert: false,
            },
          ].map((k) => (
            <div key={k.label} className="flex flex-col gap-1 border-t border-[#EFEDF2] pt-4 first:border-t-0 first:pt-0 dark:border-slate-800 sm:[&:nth-child(2)]:border-t-0 sm:[&:nth-child(2)]:pt-0 xl:[&:nth-child(3)]:border-t-0 xl:[&:nth-child(3)]:pt-0">
              <dt className={`text-[13px] font-medium ${ui.muted}`}>{k.label}</dt>
              <dd className={`text-xl font-semibold tabular-nums ${k.alert ? 'text-[#B42318] dark:text-rose-300' : ui.title}`}>{k.value}</dd>
              <dd className={`text-xs ${ui.muted}`}>{k.detail}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* Dernières expéditions + actions */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <section className={`${ui.card} overflow-hidden lg:col-span-2`}>
          <div className="flex items-center justify-between gap-3 border-b border-[#EFEDF2] px-6 py-5 dark:border-slate-800">
            <h2 className={ui.sectionTitle}>Dernières expéditions</h2>
            <button
              id="dash-btn-all-shipments"
              hidden={!canOpen('air')}
              onClick={() => onNavigateTab('air')}
              className="text-[13px] font-semibold text-[#623387] hover:underline dark:text-[#B688FF]"
            >
              Tout voir
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-[13px]">
              <thead className={ui.muted}>
                <tr>
                  <th className="px-6 py-3 font-medium">Expédition</th>
                  <th className="px-3 py-3 font-medium">Fournisseur</th>
                  <th className="px-3 py-3 font-medium">Transporteur</th>
                  <th className="px-3 py-3 font-medium">Statut</th>
                  <th className="px-6 py-3 font-medium">ETA</th>
                </tr>
              </thead>
              <tbody>
                {recentShipments.length === 0 ? (
                  <tr>
                    <td colSpan={5} className={`px-6 py-8 text-center ${ui.muted}`}>
                      Aucune expédition enregistrée pour le moment. Cliquez sur « Nouvelle expédition » pour commencer.
                    </td>
                  </tr>
                ) : (
                  recentShipments.map((shp) => (
                    <tr
                      key={shp.id}
                      className="cursor-pointer border-t border-[#EFEDF2] transition hover:bg-[#FAF9FB] dark:border-slate-800 dark:hover:bg-slate-800/50"
                      onClick={() => onSelectShipment(shp)}
                    >
                      <td className="px-6 py-3.5">
                        <div className="flex items-center gap-2.5">
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#F1EEF5] text-[#3A3444] dark:bg-slate-800 dark:text-slate-300">
                            {shp.mode === 'Air' ? <Plane className="h-4 w-4" /> : <Ship className="h-4 w-4" />}
                          </span>
                          <div className="min-w-0">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onSelectShipment(shp);
                              }}
                              className={`font-semibold hover:underline ${ui.title}`}
                            >
                              {shp.order_reference?.trim() || shipmentLabel(shp)}
                            </button>
                            {shp.tracking_no && <div className={`text-[11px] ${ui.muted}`}>{shp.tracking_no}</div>}
                          </div>
                        </div>
                      </td>
                      <td className={`px-3 py-3.5 ${ui.text}`}>{!shp.supplier || /^0 fournisseurs?$/.test(shp.supplier) ? '—' : shp.supplier}</td>
                      <td className={`px-3 py-3.5 ${ui.muted}`}>{shp.carrier || '—'}</td>
                      <td className="px-3 py-3.5">
                        <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusPill(shp.global_status)}`}>
                          {shp.global_status}
                        </span>
                      </td>
                      <td className={`px-6 py-3.5 tabular-nums ${ui.text}`}>{formatDate(shp.eta)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <div className="flex flex-col gap-3">
          <section className="flex flex-col gap-3 rounded-2xl bg-[#1E1229] p-5 text-white">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Sparkles className="h-4 w-4 text-[#B688FF]" /> Assistant IA
            </div>
            <p className="text-[13px] leading-relaxed text-white/80">
              Bilan synthétique immédiat, ou une question sur vos expéditions : « Quels colis arrivent cette semaine ? »
            </p>
            <button
              id="dash-quick-btn-assistant"
              type="button"
              onClick={onOpenAssistant}
              className="h-10 rounded-xl border border-white/20 bg-white/10 text-[13px] font-semibold transition hover:bg-white/15"
            >
              Ouvrir l’assistant
            </button>
          </section>

          <section className={`${ui.card} p-2`}>
            {[
              {
                id: 'dash-quick-btn-alerts',
                hidden: !canOpen('alerts'),
                icon: AlertTriangle,
                label: 'Centre d’alertes',
                detail: `${alerts.length} alerte(s) actives`,
                onClick: () => onNavigateTab('alerts'),
              },
              {
                id: 'dash-quick-btn-analytics',
                hidden: !onOpenAnalytics,
                icon: TrendingUp,
                label: 'Scorecards transporteurs',
                detail: 'Classement SLA dans « Analyses et SLAs »',
                onClick: () => onOpenAnalytics?.(),
              },
              {
                id: 'dash-btn-sea-tab',
                hidden: !canOpen('sea'),
                icon: Ship,
                label: 'Suivi maritime',
                detail: `${metrics.seaCount} expédition(s)`,
                onClick: () => onNavigateTab('sea'),
              },
            ]
              .filter((a) => !a.hidden)
              .map((a) => {
                const Icon = a.icon;
                return (
                  <button
                    key={a.id}
                    id={a.id}
                    type="button"
                    onClick={a.onClick}
                    className="flex w-full items-center gap-3 rounded-xl p-3 text-left transition hover:bg-[#F5F4F7] dark:hover:bg-slate-800"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#F1EEF5] text-[#623387] dark:bg-slate-800 dark:text-[#B688FF]">
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={`block text-[13px] font-semibold ${ui.title}`}>{a.label}</span>
                      <span className={`block text-xs ${ui.muted}`}>{a.detail}</span>
                    </span>
                    <ChevronRight className={`h-4 w-4 ${ui.muted}`} />
                  </button>
                );
              })}
          </section>
        </div>
      </div>
    </div>
  );
};
