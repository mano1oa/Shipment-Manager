import { getDb, initNeonSchema, isNeonConfigured } from './neon.js';
import { Shipment } from '../types.js';

let schemaEnsuredPromise: Promise<void> | null = null;

/**
 * Garantit que le schéma SQL et la table "shipments" existent dans Neon.
 * Crée la table et les index si nécessaire, sans injecter aucune fausse donnée.
 */
export async function ensureNeonSchema(): Promise<void> {
  if (!isNeonConfigured()) return;
  if (!schemaEnsuredPromise) {
    schemaEnsuredPromise = (async () => {
      try {
        const sql = getDb();
        const chk = await sql`
          SELECT EXISTS (
            SELECT 1 FROM information_schema.tables 
            WHERE table_schema = 'public' AND table_name = 'shipments'
          ) as exists;
        `;
        const exists = Boolean(chk?.[0]?.exists);
        if (!exists) {
          console.log('⚡ Table "shipments" inexistante dans Neon. Création du schéma SQL...');
          await initNeonSchema();
        }
      } catch (err: any) {
        console.error('Erreur lors de ensureNeonSchema:', err?.message || err);
        schemaEnsuredPromise = null; // Permet de réessayer lors de l'appel suivant
        throw err;
      }
    })();
  }
  return schemaEnsuredPromise;
}

/**
 * Récupère l'ensemble des expéditions depuis la base Neon via requête SQL directe
 */
export async function getShipmentsFromNeon(): Promise<Shipment[]> {
  await ensureNeonSchema();
  const sql = getDb();

  try {
    const rows = await sql`
      SELECT 
        id,
        mode,
        supplier,
        order_reference,
        invoice_no,
        bl_awb,
        tracking_no,
        carrier,
        carrier_status,
        carrier_last_location,
        eta,
        actual_delivery,
        antoine_status,
        departure_madagascar,
        arrival_madagascar_eta,
        global_status,
        remarks,
        priority,
        weight_kg::float,
        origin,
        destination,
        vessel_flight,
        cost_eur::float,
        customs_status,
        carrier_status_date,
        carrier_delivery_status,
        orly_shipment_status,
        orly_scan_date,
        ref_fa_digi_nxt,
        mada_receipt_date,
        etd,
        actual_arrival_date,
        container_no,
        swb_no,
        port_of_loading,
        port_of_discharge,
        transshipment_ports,
        documents,
        history,
        alerts,
        sea_deliveries,
        created_at,
        updated_at
      FROM shipments
      ORDER BY created_at DESC;
    `;

    return (rows || []) as unknown as Shipment[];
  } catch (err: any) {
    // Si la table n'existe pas encore (code 42P01 en PostgreSQL), créer la table et renvoyer un tableau vide
    if (
      err?.code === '42P01' ||
      err?.message?.includes('relation "shipments" does not exist') ||
      err?.message?.includes('does not exist')
    ) {
      console.warn('⚡ Table absente détectée. Initialisation du schéma SQL pur (0 mock data)...');
      await initNeonSchema();
      return [];
    }
    throw err;
  }
}

/**
 * Récupère une expédition par son identifiant unique
 */
export async function getShipmentByIdFromNeon(id: string): Promise<Shipment | null> {
  await ensureNeonSchema();
  const sql = getDb();

  const rows = await sql`
    SELECT * FROM shipments WHERE id = ${id} LIMIT 1;
  `;

  if (!rows || rows.length === 0) return null;
  return rows[0] as unknown as Shipment;
}

/**
 * Insère ou met à jour une expédition dans Neon (Requête SQL directe UPSERT)
 */
export async function upsertShipmentInNeon(shipment: Shipment, skipEnsure = false): Promise<Shipment> {
  if (!skipEnsure) {
    await ensureNeonSchema();
  }
  const sql = getDb();

  const id = shipment.id || `SHP-${Date.now()}`;
  const mode = shipment.mode || 'Air';
  const supplier = shipment.supplier || 'Fournisseur Inconnu';
  const order_reference = shipment.order_reference || '';
  const invoice_no = shipment.invoice_no || '';
  const bl_awb = shipment.bl_awb || '';
  const tracking_no = shipment.tracking_no || '';
  const carrier = shipment.carrier || 'DHL Express';
  const carrier_status = shipment.carrier_status || 'In Transit';
  const carrier_last_location = shipment.carrier_last_location || '';
  const eta = shipment.eta || '';
  const actual_delivery = shipment.actual_delivery || '';
  const antoine_status = shipment.antoine_status || 'En attente Antoine';
  const departure_madagascar = shipment.departure_madagascar || '';
  const arrival_madagascar_eta = shipment.arrival_madagascar_eta || '';
  const global_status = shipment.global_status || 'Statut non défini';
  const remarks = shipment.remarks || '';
  const priority = shipment.priority || 'Moyenne';
  const weight_kg = Number(shipment.weight_kg) || 0;
  const origin = shipment.origin || '';
  const destination = shipment.destination || '';
  const vessel_flight = shipment.vessel_flight || '';
  const cost_eur = Number(shipment.cost_eur) || 0;
  const customs_status = shipment.customs_status || 'Non Requis';

  const carrier_status_date = shipment.carrier_status_date || '';
  const carrier_delivery_status = shipment.carrier_delivery_status || '';
  const orly_shipment_status = shipment.orly_shipment_status || '';
  const orly_scan_date = shipment.orly_scan_date || '';
  const ref_fa_digi_nxt = shipment.ref_fa_digi_nxt || '';
  const mada_receipt_date = shipment.mada_receipt_date || '';

  const etd = shipment.etd || '';
  const actual_arrival_date = shipment.actual_arrival_date || '';
  const container_no = shipment.container_no || '';
  const swb_no = shipment.swb_no || '';
  const port_of_loading = shipment.port_of_loading || '';
  const port_of_discharge = shipment.port_of_discharge || '';
  const transshipment_ports = JSON.stringify(shipment.transshipment_ports || []);

  const documents = JSON.stringify(shipment.documents || []);
  const history = JSON.stringify(shipment.history || []);
  const alerts = JSON.stringify(shipment.alerts || []);
  const sea_deliveries = JSON.stringify(shipment.sea_deliveries || []);

  const now = new Date().toISOString();
  const created_at = shipment.created_at || now;
  const updated_at = now;

  await sql`
    INSERT INTO shipments (
      id, mode, supplier, order_reference, invoice_no, bl_awb, tracking_no,
      carrier, carrier_status, carrier_last_location, eta, actual_delivery,
      antoine_status, departure_madagascar, arrival_madagascar_eta, global_status,
      remarks, priority, weight_kg, origin, destination, vessel_flight,
      cost_eur, customs_status, carrier_status_date, carrier_delivery_status,
      orly_shipment_status, orly_scan_date, ref_fa_digi_nxt, mada_receipt_date,
      etd, actual_arrival_date, container_no, swb_no, port_of_loading,
      port_of_discharge, transshipment_ports, documents, history, alerts,
      sea_deliveries, created_at, updated_at
    ) VALUES (
      ${id}, ${mode}, ${supplier}, ${order_reference}, ${invoice_no}, ${bl_awb}, ${tracking_no},
      ${carrier}, ${carrier_status}, ${carrier_last_location}, ${eta}, ${actual_delivery},
      ${antoine_status}, ${departure_madagascar}, ${arrival_madagascar_eta}, ${global_status},
      ${remarks}, ${priority}, ${weight_kg}, ${origin}, ${destination}, ${vessel_flight},
      ${cost_eur}, ${customs_status}, ${carrier_status_date}, ${carrier_delivery_status},
      ${orly_shipment_status}, ${orly_scan_date}, ${ref_fa_digi_nxt}, ${mada_receipt_date},
      ${etd}, ${actual_arrival_date}, ${container_no}, ${swb_no}, ${port_of_loading},
      ${port_of_discharge}, ${transshipment_ports}::jsonb, ${documents}::jsonb, ${history}::jsonb, ${alerts}::jsonb,
      ${sea_deliveries}::jsonb, ${created_at}, ${updated_at}
    )
    ON CONFLICT (id) DO UPDATE SET
      mode = EXCLUDED.mode,
      supplier = EXCLUDED.supplier,
      order_reference = EXCLUDED.order_reference,
      invoice_no = EXCLUDED.invoice_no,
      bl_awb = EXCLUDED.bl_awb,
      tracking_no = EXCLUDED.tracking_no,
      carrier = EXCLUDED.carrier,
      carrier_status = EXCLUDED.carrier_status,
      carrier_last_location = EXCLUDED.carrier_last_location,
      eta = EXCLUDED.eta,
      actual_delivery = EXCLUDED.actual_delivery,
      antoine_status = EXCLUDED.antoine_status,
      departure_madagascar = EXCLUDED.departure_madagascar,
      arrival_madagascar_eta = EXCLUDED.arrival_madagascar_eta,
      global_status = EXCLUDED.global_status,
      remarks = EXCLUDED.remarks,
      priority = EXCLUDED.priority,
      weight_kg = EXCLUDED.weight_kg,
      origin = EXCLUDED.origin,
      destination = EXCLUDED.destination,
      vessel_flight = EXCLUDED.vessel_flight,
      cost_eur = EXCLUDED.cost_eur,
      customs_status = EXCLUDED.customs_status,
      carrier_status_date = EXCLUDED.carrier_status_date,
      carrier_delivery_status = EXCLUDED.carrier_delivery_status,
      orly_shipment_status = EXCLUDED.orly_shipment_status,
      orly_scan_date = EXCLUDED.orly_scan_date,
      ref_fa_digi_nxt = EXCLUDED.ref_fa_digi_nxt,
      mada_receipt_date = EXCLUDED.mada_receipt_date,
      etd = EXCLUDED.etd,
      actual_arrival_date = EXCLUDED.actual_arrival_date,
      container_no = EXCLUDED.container_no,
      swb_no = EXCLUDED.swb_no,
      port_of_loading = EXCLUDED.port_of_loading,
      port_of_discharge = EXCLUDED.port_of_discharge,
      transshipment_ports = EXCLUDED.transshipment_ports,
      documents = EXCLUDED.documents,
      history = EXCLUDED.history,
      alerts = EXCLUDED.alerts,
      sea_deliveries = EXCLUDED.sea_deliveries,
      updated_at = EXCLUDED.updated_at;
  `;

  return {
    ...shipment,
    id,
    updated_at,
  };
}

/**
 * Supprime une expédition par son ID
 */
export async function deleteShipmentInNeon(id: string): Promise<boolean> {
  await ensureNeonSchema();
  const sql = getDb();
  await sql`DELETE FROM shipments WHERE id = ${id};`;
  return true;
}

/**
 * Recherche SQL directe (plein texte / ILIKE) sur les références clés
 */
export async function searchShipmentsInNeon(term: string): Promise<Shipment[]> {
  await ensureNeonSchema();
  const sql = getDb();
  const pattern = `%${term}%`;

  const rows = await sql`
    SELECT * FROM shipments
    WHERE 
      tracking_no ILIKE ${pattern}
      OR supplier ILIKE ${pattern}
      OR invoice_no ILIKE ${pattern}
      OR bl_awb ILIKE ${pattern}
      OR order_reference ILIKE ${pattern}
      OR container_no ILIKE ${pattern}
      OR swb_no ILIKE ${pattern}
      OR ref_fa_digi_nxt ILIKE ${pattern}
    ORDER BY created_at DESC;
  `;

  return (rows || []) as unknown as Shipment[];
}

/**
 * Supprime toutes les expéditions de la base Neon (purge complète / 0 mock data)
 */
export async function clearAllShipmentsInNeon(): Promise<number> {
  if (!isNeonConfigured()) return 0;
  await ensureNeonSchema();
  const sql = getDb();
  const countResult = await sql`SELECT COUNT(*)::int as count FROM shipments;`;
  const count = countResult?.[0]?.count || 0;
  await sql`DELETE FROM shipments;`;
  console.log(`🧹 Base Neon purgée : ${count} expédition(s) supprimée(s).`);
  return count;
}
