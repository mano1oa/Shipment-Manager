import { Shipment, ShipmentAlert } from '../types';
import { formatDate } from './dateFormat';

/**
 * Calculates Departure Madagascar ("DEPART MADA"):
 * - Condition 1: If DATE SCAN ORLY (MANUELLE) is empty -> "Non parti"
 * - Condition 2: If DATE SCAN ORLY (MANUELLE) is defined -> Saturday following the Orly scan date
 */
export function calculateDepartureMadagascar(orlyScanDate?: string): string {
  if (!orlyScanDate || orlyScanDate.trim() === '') {
    return 'Non parti';
  }

  const parts = orlyScanDate.trim().split('-');
  if (parts.length !== 3) {
    return 'Non parti';
  }

  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1;
  const day = parseInt(parts[2], 10);

  const date = new Date(year, month, day);
  if (isNaN(date.getTime())) {
    return 'Non parti';
  }

  const dayOfWeek = date.getDay(); // 0 (Sun) to 6 (Sat)
  const daysToAdd = (6 - dayOfWeek + 7) % 7;

  date.setDate(date.getDate() + daysToAdd);

  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');

  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Calculates "ETA MADA S du":
 * - Condition 1: If DATE SCAN ORLY (MANUELLE) is empty -> "Non parti"
 * - Condition 2: If DATE SCAN ORLY (MANUELLE) is Monday, Tuesday, Wednesday or Thursday
 *   -> Monday of the following week
 * - Condition 3: If DATE SCAN ORLY (MANUELLE) is Friday, Saturday or Sunday
 *   -> Monday of the second week following
 */
export function calculateEtaMadaSDu(orlyScanDate?: string): string {
  if (!orlyScanDate || orlyScanDate.trim() === '') {
    return 'Non parti';
  }

  const parts = orlyScanDate.trim().split('-');
  if (parts.length !== 3) {
    return 'Non parti';
  }

  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1;
  const day = parseInt(parts[2], 10);

  const date = new Date(year, month, day);
  if (isNaN(date.getTime())) {
    return 'Non parti';
  }

  const dayOfWeek = date.getDay(); // 0 (Sun), 1 (Mon), 2 (Tue), 3 (Wed), 4 (Thu), 5 (Fri), 6 (Sat)
  let daysToAdd = 0;

  if (dayOfWeek >= 1 && dayOfWeek <= 4) {
    // Mon, Tue, Wed, Thu -> Lundi de la semaine d'après
    daysToAdd = 8 - dayOfWeek;
  } else if (dayOfWeek === 5) {
    // Vendredi -> Lundi de la 2ème semaine d'après
    daysToAdd = 10;
  } else if (dayOfWeek === 6) {
    // Samedi -> Lundi de la 2ème semaine d'après
    daysToAdd = 9;
  } else if (dayOfWeek === 0) {
    // Dimanche -> Lundi de la 2ème semaine d'après
    daysToAdd = 8;
  }

  date.setDate(date.getDate() + daysToAdd);

  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');

  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Calculates the number of days between two date strings (YYYY-MM-DD or ISO)
 */
export function calculateDaysBetween(fromDateStr: string, toDateStr?: string): number {
  if (!fromDateStr) return 0;
  const start = new Date(fromDateStr).getTime();
  const end = toDateStr ? new Date(toDateStr).getTime() : new Date().getTime();
  if (isNaN(start) || isNaN(end)) return 0;
  const diffTime = Math.abs(end - start);
  return Math.floor(diffTime / (1000 * 60 * 60 * 24));
}

/**
 * Evaluates business rules against a list of shipments and returns generated alerts.
 * `valueOf` gives the shipment value shown in claim messages (linked DIGI invoice
 * amount, else cost_eur); defaults to cost_eur.
 */
export function evaluateShipmentRules(
  shipments: Shipment[],
  valueOf: (s: Shipment) => number = (s) => s.cost_eur || 0
): {
  shipmentsWithAlerts: Shipment[];
  allAlerts: ShipmentAlert[];
} {
  const allAlerts: ShipmentAlert[] = [];

  // Parcel losses (before Orly, "Avis de recherche") are alerts on the parcels,
  // not on the shipments: the former "Perdu Orly" rule (same Réf FA) is gone.

  const updatedShipments = shipments.map((shipment) => {
    const alerts: ShipmentAlert[] = [];
    const today = new Date().toISOString().split('T')[0];

    // CONDITION 0 : expédition reprise de l'ancien modèle, pas partie → à regrouper ou supprimer
    if (shipment.needs_review && shipment.global_status === 'En préparation') {
      alerts.push({
        id: `ALT-REVIEW-${shipment.id}`,
        shipment_id: shipment.id,
        tracking_no: shipment.tracking_no,
        severity: 'warning',
        rule_code: 'R0_LEGACY_REVIEW',
        title: 'Expédition à revoir (ancien modèle)',
        reason: `Créée avant le suivi par colis (ancien statut : ${shipment.legacy_global_status || 'non défini'}) et pas encore partie.`,
        created_at: today,
        resolved: false,
        suggested_action: 'Regrouper ses factures dans l’expédition Orly → Mada de la semaine, ou la supprimer.',
      });
    }

    // CONDITION 2 : expédition aérienne en préparation depuis 10 jours ou plus, sans départ vers Madagascar
    const daysInPreparation = calculateDaysBetween(shipment.created_at);
    if (
      shipment.mode === 'Air' &&
      shipment.global_status === 'En préparation' &&
      !shipment.needs_review &&
      daysInPreparation >= 10
    ) {
      const alertId = `ALT-ORLY-${shipment.id}`;
      const relanceMsg = `⚠️ EXPEDITION EN ATTENTE DE DEPART
👉 En préparation à Orly depuis ${daysInPreparation} jours sans départ vers Madagascar. Merci de confirmer la prise en charge par le transitaire et la date de vol/départ programmée.
- Réf FA: ${shipment.ref_fa_digi_nxt || 'N/A'}
- LTA: ${shipment.bl_awb || 'N/A'}`;

      alerts.push({
        id: alertId,
        shipment_id: shipment.id,
        tracking_no: shipment.tracking_no,
        severity: 'critical',
        rule_code: 'R1_HUB_ORLY_TIMEOUT',
        title: '⚠️ EXPEDITION EN ATTENTE DE DEPART',
        reason: `En préparation depuis ${daysInPreparation} jours sans départ vers Madagascar.`,
        created_at: today,
        resolved: false,
        suggested_action: 'Merci de confirmer la prise en charge par le transitaire et la date de vol/départ programmée.',
        relance_draft: relanceMsg,
      });
    }

    // CONDITION 3 : Blocage douanier. Expédition retenue par les services de douane. Facture ou document manquant.
    if (shipment.customs_status === 'Bloqué Douane' || shipment.global_status === 'Bloquée douane') {
      const alertId = `ALT-CUST-${shipment.id}`;
      const relanceMsg = `🛑 *ALERTE DOUANE - Expédition Bloquée*
Bloqué aux douanes d'origine ou d'arrivée. Documents complémentaires requis.
👉 Transmettre la facture commerciale certifiée et la nomenclature douanière H.S. Code.
- Ref: ${shipment.order_reference || 'N/A'} | Facture: ${shipment.invoice_no || 'N/A'}
- Transporteur/LTA: ${shipment.carrier || 'N/A'} - ${shipment.tracking_no || 'N/A'}
- Fournisseur: ${shipment.supplier || 'N/A'}`;

      alerts.push({
        id: alertId,
        shipment_id: shipment.id,
        tracking_no: shipment.tracking_no,
        severity: 'critical',
        rule_code: 'R3_CUSTOMS_BLOCKED',
        title: '🛑 ALERTE DOUANE - Expédition Bloquée',
        reason: 'Expédition retenue par les services de douane. Facture ou document manquant.',
        created_at: today,
        resolved: false,
        suggested_action: 'Transmettre la facture commerciale certifiée et la nomenclature douanière H.S. Code.',
        relance_draft: relanceMsg,
      });
    }

    // RULE 4: Carrier ETA Overdue
    if (
      shipment.eta &&
      shipment.carrier_status !== 'Delivered' &&
      shipment.global_status !== 'Livrée entrepôt' &&
      new Date(shipment.eta) < new Date(today)
    ) {
      const overdueDays = calculateDaysBetween(shipment.eta);
      if (overdueDays > 0) {
        const alertId = `ALT-ETA-${shipment.id}`;
        alerts.push({
          id: alertId,
          shipment_id: shipment.id,
          tracking_no: shipment.tracking_no,
          severity: 'warning',
          rule_code: 'R4_CARRIER_ETA_OVERDUE',
          title: 'Retard de Livraison ETA',
          reason: `L’ETA (${formatDate(shipment.eta)}) est dépassée de ${overdueDays} jour(s) sans livraison confirmée.`,
          created_at: today,
          resolved: false,
          suggested_action: 'Vérifier la position exacte via l’API du transporteur et avertir le client final.',
          relance_draft: `📢 *Avis de Retard Transporteur*\n📌 Ref: ${shipment.order_reference} (${shipment.carrier})\nETA initiale: ${formatDate(shipment.eta)} dépassée de ${overdueDays}j. Statut actuel: ${shipment.carrier_last_location}.`,
        });
      }
    }

    // Add generated alerts to overall collection
    allAlerts.push(...alerts);

    return {
      ...shipment,
      alerts,
    };
  });

  return { shipmentsWithAlerts: updatedShipments, allAlerts };
}
