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
