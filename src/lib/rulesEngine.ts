import { Shipment, ShipmentAlert } from '../types';

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
 */
export function evaluateShipmentRules(shipments: Shipment[]): {
  shipmentsWithAlerts: Shipment[];
  allAlerts: ShipmentAlert[];
} {
  const allAlerts: ShipmentAlert[] = [];

  // Helper to check if a shipment is considered received
  const isShipmentReceived = (s: Shipment): boolean => {
    return (
      s.global_status === 'Reçu et expédié' ||
      s.global_status === 'Livré entrepôt' ||
      s.carrier_status === 'Delivered' ||
      Boolean(s.orly_scan_date && s.orly_scan_date.trim() !== '') ||
      Boolean(s.mada_receipt_date && s.mada_receipt_date.trim() !== '') ||
      s.orly_shipment_status === 'Scanné & Expédié Orly'
    );
  };

  // Group shipments by ref_fa_digi_nxt
  const faGroups: Record<string, { received: boolean; total: number; receivedCount: number }> = {};
  shipments.forEach((s) => {
    if (s.ref_fa_digi_nxt && s.ref_fa_digi_nxt.trim() !== '') {
      const key = s.ref_fa_digi_nxt.trim().toUpperCase();
      if (!faGroups[key]) {
        faGroups[key] = { received: false, total: 0, receivedCount: 0 };
      }
      faGroups[key].total += 1;
      if (isShipmentReceived(s)) {
        faGroups[key].received = true;
        faGroups[key].receivedCount += 1;
      }
    }
  });

  const updatedShipments = shipments.map((shipment) => {
    const alerts: ShipmentAlert[] = [];
    const today = new Date().toISOString().split('T')[0];

    // RULE 5: Ref FA (DIGI - NXT) Mismatch (Identical FA Ref with unreceived lines when other lines are received)
    if (shipment.ref_fa_digi_nxt && shipment.ref_fa_digi_nxt.trim() !== '') {
      const key = shipment.ref_fa_digi_nxt.trim().toUpperCase();
      const group = faGroups[key];
      if (group && group.received && !isShipmentReceived(shipment)) {
        shipment.global_status = 'Perdu Orly';
      }
    }

    // CONDITION 1 : Statut Orly - Mada = Perdu Orly
    if (shipment.global_status === 'Perdu Orly') {
      const alertId = `ALT-LOST-${shipment.id}`;
      const faValue = shipment.ref_fa_digi_nxt || shipment.invoice_no || 'N/A';
      const relanceMsg = `🚨 COLIS MANQUANT A LA RECEPTION - PERDU ORLY
👉 Veuillez transmettre le dossier de réclamation pour indemnisation.
- Réf FA: ${faValue} / Commande : ${shipment.order_reference || 'N/A'}
- Fournisseur: ${shipment.supplier || 'N/A'} / Transporteur: ${shipment.carrier || 'N/A'}
- N° Suivi: ${shipment.tracking_no || 'N/A'}
- Valeur: ${shipment.cost_eur ? shipment.cost_eur + ' €' : 'N/A'}`;

      alerts.push({
        id: alertId,
        shipment_id: shipment.id,
        tracking_no: shipment.tracking_no,
        severity: 'critical',
        rule_code: 'R5_PERDU_ORLY',
        title: '🚨 COLIS MANQUANT A LA RECEPTION - PERDU ORLY',
        reason: 'Colis manquant à la réception - déclaré Perdu Orly.',
        created_at: today,
        resolved: false,
        suggested_action: 'Veuillez transmettre le dossier de réclamation pour indemnisation.',
        relance_draft: relanceMsg,
      });
    }

    // CONDITION 2 : Date statut transporteur + 10, mais statut Orly - Mada différent de "Reçu et expédié"
    const carrierStatusDate =
      shipment.carrier_status_date ||
      shipment.actual_delivery ||
      shipment.updated_at ||
      shipment.created_at;
    const daysSinceCarrierStatus = calculateDaysBetween(carrierStatusDate);

    if (daysSinceCarrierStatus >= 10 && shipment.global_status !== 'Reçu et expédié') {
      const alertId = `ALT-ORLY-${shipment.id}`;
      const relanceMsg = `⚠️ COLIS EN ATTENTE D'EXPEDITION
👉 Livré à Orly depuis ${daysSinceCarrierStatus} jours sans départ vers Madagascar. Merci de confirmer la prise en charge par le transitaire et la date de vol/départ programmée.
- Fournisseur : ${shipment.supplier || 'N/A'}
- Transporteur: ${shipment.carrier || 'N/A'}
- N° Suivi: ${shipment.tracking_no || 'N/A'}
- Colis/BL: ${shipment.bl_awb || shipment.tracking_no || 'N/A'}`;

      alerts.push({
        id: alertId,
        shipment_id: shipment.id,
        tracking_no: shipment.tracking_no,
        severity: 'critical',
        rule_code: 'R1_HUB_ORLY_TIMEOUT',
        title: '⚠️ COLIS EN ATTENTE D\'EXPEDITION',
        reason: `Statut transporteur depuis ${daysSinceCarrierStatus} jours sans départ vers Madagascar (Statut Orly - Mada ≠ Reçu et expédié).`,
        created_at: today,
        resolved: false,
        suggested_action: 'Merci de confirmer la prise en charge par le transitaire et la date de vol/départ programmée.',
        relance_draft: relanceMsg,
      });
    }

    // CONDITION 3 : Blocage douanier. Expédition retenue par les services de douane. Facture ou document manquant.
    if (shipment.customs_status === 'Bloqué Douane' || shipment.global_status === 'Bloqué douane') {
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
          reason: `L’ETA (${shipment.eta}) est dépassée de ${overdueDays} jour(s) sans livraison confirmée.`,
          created_at: today,
          resolved: false,
          suggested_action: 'Vérifier la position exacte via l’API du transporteur et avertir le client final.',
          relance_draft: `📢 *Avis de Retard Transporteur*\n📌 Ref: ${shipment.order_reference} (${shipment.carrier})\nETA initiale: ${shipment.eta} dépassée de ${overdueDays}j. Statut actuel: ${shipment.carrier_last_location}.`,
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
