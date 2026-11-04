/**
 * SLA transporteurs, hub → Madagascar: the date promised for an expedition
 * against its real arrival in Madagascar, with a tolerance (Paramètres).
 *
 * - Air: promised = ETA MADA S du (from the Orly scan), real = date de récep Mada.
 * - Sea: promised = ETA d'arrivée Madagascar, real = date réelle d'arrivée.
 *
 * Measured: delivered expeditions with both dates, plus those still on the
 * way whose promise (+ tolerance) is already passed (late for sure).
 */
import type { Shipment } from '../types';
import { calculateEtaMadaSDu } from './rulesEngine';

const ISO = /^\d{4}-\d{2}-\d{2}/;
const iso = (v?: string | null) => (v && ISO.test(v) ? v.slice(0, 10) : null);

const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86400000);

export const promisedDate = (s: Shipment): string | null =>
  s.mode === 'Air' ? iso(calculateEtaMadaSDu(s.orly_scan_date)) : iso(s.arrival_madagascar_eta);

export const madaArrivalDate = (s: Shipment): string | null =>
  s.mode === 'Air' ? iso(s.mada_receipt_date) || iso(s.actual_arrival_date) : iso(s.actual_arrival_date) || iso(s.mada_receipt_date);

/** Departure from the hub: real when known, else the computed one. */
export const hubDepartureDate = (s: Shipment): string | null => iso(s.departure_madagascar) || iso(s.etd) || iso(s.orly_scan_date);

export type SlaOutcome = 'on_time' | 'late' | 'late_in_transit';

export interface ShipmentSla {
  shipment: Shipment;
  promised: string;
  arrival: string | null;
  outcome: SlaOutcome;
  /** Days after the promised date (0 or less = on time). */
  delayDays: number;
}

const DEPARTED = ['Expédiée vers Mada', 'Bloquée douane', 'Livrée entrepôt'];

/** SLA of one expedition, or null when it cannot be measured yet. */
export function shipmentSla(s: Shipment, toleranceDays: number, today: string): ShipmentSla | null {
  if (!DEPARTED.includes(s.global_status)) return null;
  const promised = promisedDate(s);
  if (!promised) return null;
  const deadline = addDays(promised, toleranceDays);
  const arrival = madaArrivalDate(s);
  if (arrival) {
    return { shipment: s, promised, arrival, outcome: arrival <= deadline ? 'on_time' : 'late', delayDays: daysBetween(promised, arrival) };
  }
  if (s.global_status !== 'Livrée entrepôt' && today > deadline) {
    return { shipment: s, promised, arrival: null, outcome: 'late_in_transit', delayDays: daysBetween(promised, today) };
  }
  return null;
}

export interface SlaSummary {
  measured: number;
  onTime: number;
  late: number;
  lateInTransit: number;
  /** % on time, null when nothing is measured. */
  rate: number | null;
  /** Mean delay of the late ones, in days. */
  meanDelay: number | null;
}

export function summarizeSla(list: ShipmentSla[]): SlaSummary {
  const onTime = list.filter((x) => x.outcome === 'on_time').length;
  const lateOnes = list.filter((x) => x.outcome !== 'on_time');
  return {
    measured: list.length,
    onTime,
    late: lateOnes.filter((x) => x.outcome === 'late').length,
    lateInTransit: lateOnes.filter((x) => x.outcome === 'late_in_transit').length,
    rate: list.length > 0 ? Math.round((onTime / list.length) * 100) : null,
    meanDelay: lateOnes.length > 0 ? Math.round((lateOnes.reduce((a, x) => a + x.delayDays, 0) / lateOnes.length) * 10) / 10 : null,
  };
}

/** Measured SLAs of the expeditions. */
export function carrierSlas(shipments: Shipment[], toleranceDays: number, today = new Date().toISOString().slice(0, 10)) {
  return shipments.map((s) => shipmentSla(s, toleranceDays, today)).filter((x): x is ShipmentSla => x !== null);
}

/** Mean transit hub → Madagascar (departure → arrival) in days, per mode. */
export function meanTransitDays(shipments: Shipment[], mode: Shipment['mode']): { days: number | null; count: number } {
  const list = shipments
    .filter((s) => s.mode === mode)
    .map((s) => {
      const dep = hubDepartureDate(s);
      const arr = madaArrivalDate(s);
      return dep && arr ? daysBetween(dep, arr) : null;
    })
    .filter((d): d is number => d !== null && d >= 0);
  return {
    days: list.length > 0 ? Math.round((list.reduce((a, b) => a + b, 0) / list.length) * 10) / 10 : null,
    count: list.length,
  };
}

/**
 * SLA transporteurs, fournisseur → hub (UPS, Chronopost, GLS…): a parcel is on
 * time when received at Orly / Rouen by its expected delivery (same rule as the
 * dashboard card "Colis reçus à temps"). Lost parcels are counted apart.
 */
export interface ParcelCarrierSla {
  carrier: string;
  /** Hub most of its parcels go to. */
  destination: 'ORLY' | 'ROUEN';
  measured: number;
  onTime: number;
  late: number;
  /** Mean days late, late parcels only. */
  meanDelay: number | null;
  lost: number;
  rate: number | null;
}

interface SlaParcel {
  carrier: string;
  carrier_name: string | null;
  destination: 'ORLY' | 'ROUEN';
  status: string;
  expected_delivery: string | null;
  received_at: string | null;
}

export function parcelCarrierSlas(parcels: SlaParcel[], labelOf: (p: SlaParcel) => string): ParcelCarrierSla[] {
  const groups = new Map<string, SlaParcel[]>();
  for (const p of parcels) groups.set(labelOf(p), [...(groups.get(labelOf(p)) ?? []), p]);
  return Array.from(groups.entries())
    .map(([carrier, list]) => {
      const measured = list.filter((p) => iso(p.received_at) && iso(p.expected_delivery));
      const delays = measured.map((p) => daysBetween(iso(p.expected_delivery)!, iso(p.received_at)!));
      const lateDelays = delays.filter((d) => d > 0);
      const orly = list.filter((p) => p.destination === 'ORLY').length;
      return {
        carrier,
        destination: (orly >= list.length - orly ? 'ORLY' : 'ROUEN') as 'ORLY' | 'ROUEN',
        measured: measured.length,
        onTime: delays.length - lateDelays.length,
        late: lateDelays.length,
        meanDelay:
          lateDelays.length > 0 ? Math.round((lateDelays.reduce((a, b) => a + b, 0) / lateDelays.length) * 10) / 10 : null,
        lost: list.filter((p) => p.status === 'lost').length,
        rate: measured.length > 0 ? Math.round(((delays.length - lateDelays.length) / measured.length) * 100) : null,
      };
    })
    .filter((x) => x.measured > 0 || x.lost > 0)
    .sort((a, b) => b.measured - a.measured);
}
