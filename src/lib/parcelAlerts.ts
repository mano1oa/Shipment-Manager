import type { ShipmentAlert } from '../types';
import { formatDate } from './dateFormat';
import type { ParcelDestination, ParcelStatus } from './parcelTracking';

/** What the alert rules need from a parcel (see Parcel in components/digiApi). */
export interface ParcelForAlerts {
  id: string;
  tracking_number: string | null;
  carrier_name: string | null;
  supplier_name: string | null;
  destination: ParcelDestination;
  status: ParcelStatus;
  expected_delivery: string | null;
  received_at: string | null;
  status_changed_at: string | null;
  photo_count: number;
  shipment_ids: string[];
  invoices: { ref: string | null; invoice_date: string | null }[];
}

export interface LateTriageForAlerts {
  id: string;
  ref: string | null;
  supplier_display: string | null;
  created_at: string;
}

const hubOf = (d: ParcelDestination) => (d === 'ORLY' ? 'Orly' : 'Rouen');

/**
 * Parcel alerts, shown in the Alerts center next to the shipment alerts:
 * - R6 lost before the hub (set automatically after the delay) → claim to the supplier;
 * - R7 "Avis de recherche": received at the hub, missing in Madagascar → claim to MIDEX / forwarder;
 * - R8 DIGI invoice not sorted in time.
 * Alert ids are stable so that "resolved" survives reloads.
 */
export function evaluateParcelAlerts(parcels: ParcelForAlerts[], lateTriage: LateTriageForAlerts[]): ShipmentAlert[] {
  const today = new Date().toISOString().split('T')[0];
  const alerts: ShipmentAlert[] = [];

  for (const p of parcels) {
    const hub = hubOf(p.destination);
    const refs = p.invoices.map((i) => i.ref || '—').join(', ') || 'N/A';
    const tracking = p.tracking_number || 'sans n° de suivi';

    if (p.status === 'lost') {
      alerts.push({
        id: `ALT-PARCEL-LOST-${p.id}`,
        shipment_id: p.shipment_ids[0] || '',
        tracking_no: p.tracking_number || '',
        severity: 'critical',
        rule_code: 'R6_PARCEL_LOST',
        title: `🚨 COLIS NON REÇU À ${hub.toUpperCase()}`,
        reason: `Colis ${tracking} (${p.supplier_name || 'fournisseur inconnu'}) non confirmé à ${hub}${
          p.expected_delivery ? ` — livraison prévue le ${formatDate(p.expected_delivery)}` : ''
        }.`,
        created_at: (p.status_changed_at || today).slice(0, 10),
        resolved: false,
        suggested_action: `Réclamer au fournisseur (preuve de livraison à ${hub}) et ouvrir une enquête transporteur.`,
        relance_draft: `🚨 COLIS NON REÇU À ${hub.toUpperCase()}
👉 Merci de nous transmettre la preuve de livraison ou d'ouvrir une enquête auprès du transporteur.
- Fournisseur : ${p.supplier_name || 'N/A'}
- Facture(s) : ${refs}
- Transporteur : ${p.carrier_name || 'N/A'} / N° de suivi : ${tracking}
- Livraison prévue : ${p.expected_delivery ? formatDate(p.expected_delivery) : 'N/A'}`,
      });
    }

    if (p.status === 'search') {
      const claimTo = p.destination === 'ORLY' ? 'de MIDEX (Antoine)' : 'du transitaire';
      alerts.push({
        id: `ALT-PARCEL-SEARCH-${p.id}`,
        shipment_id: p.shipment_ids[0] || '',
        tracking_no: p.tracking_number || '',
        severity: 'critical',
        rule_code: 'R7_AVIS_RECHERCHE',
        title: '🔎 AVIS DE RECHERCHE — COLIS ABSENT À MADAGASCAR',
        reason: `Colis ${tracking} reçu à ${hub}${p.received_at ? ` le ${formatDate(p.received_at)}` : ''} mais absent à l'arrivée à Madagascar.`,
        created_at: (p.status_changed_at || today).slice(0, 10),
        resolved: false,
        suggested_action: `Ouvrir un avis de recherche auprès ${claimTo}${p.photo_count > 0 ? ', photo de réception jointe' : ''}.`,
        relance_draft: `🔎 AVIS DE RECHERCHE
👉 Colis reçu à ${hub} mais absent à l'arrivée à Madagascar : merci de le localiser.
- Fournisseur : ${p.supplier_name || 'N/A'}
- Facture(s) : ${refs}
- N° de suivi : ${tracking}
- Reçu à ${hub} le : ${p.received_at ? formatDate(p.received_at) : 'N/A'}
- Expédition : ${p.shipment_ids.join(', ') || 'N/A'}
- Photo de réception : ${p.photo_count > 0 ? `${p.photo_count} (dans l'application)` : 'aucune'}`,
      });
    }
  }

  for (const inv of lateTriage) {
    alerts.push({
      id: `ALT-TRIAGE-${inv.id}`,
      shipment_id: '',
      tracking_no: '',
      severity: 'warning',
      rule_code: 'R8_TRIAGE_LATE',
      title: 'Facture DIGI à trier',
      reason: `Facture ${inv.ref || '—'} (${inv.supplier_display || '—'}) arrivée le ${formatDate(inv.created_at)}, pas encore triée.`,
      created_at: today,
      resolved: false,
      suggested_action: 'La classer en marchandises (suivi des colis) ou en services dans Factures fournisseurs.',
    });
  }

  return alerts;
}
