export type TransportMode = 'Air' | 'Sea';

export type GlobalStatus =
  | 'Attente confirmation transitaire'
  | 'Reçu et expédié'
  | 'En livraison vers Orly'
  | 'Bloqué douane'
  | 'Perdu Orly'
  | 'Livré entrepôt'
  | 'Statut non défini';

export type AntoineStatus =
  | 'Confirmé'
  | 'En attente Antoine'
  | 'Transmis transitaire'
  | 'A vérifier';

export type CarrierStatus =
  | 'Information Received'
  | 'In Transit'
  | 'Customs Clearance'
  | 'Out for Delivery'
  | 'Delivered'
  | 'Exception / Delay';

export type CarrierName =
  | 'DHL Express'
  | 'FedEx'
  | 'UPS'
  | 'TNT'
  | 'GLS'
  | 'DPD'
  | 'Chronopost'
  | 'Colissimo'
  | 'Amazon Logistics'
  | 'DB Schenker'
  | 'Dachser'
  | 'CEVA Logistics'
  | 'MSC (Sea)'
  | 'Maersk (Sea)';

export interface ShipmentDocument {
  id: string;
  shipment_id: string;
  type: 'Invoice' | 'BL_AWB' | 'Customs' | 'PackingList' | 'Other';
  filename: string;
  url: string;
  uploaded_at: string;
  size_kb: number;
}

export interface ShipmentAlert {
  id: string;
  shipment_id: string;
  tracking_no: string;
  severity: 'critical' | 'warning' | 'info';
  rule_code: string;
  title: string;
  reason: string;
  created_at: string;
  resolved: boolean;
  suggested_action: string;
  relance_draft?: string;
}

export type DeliveryType = 'Livraison par fournisseur' | 'Enlèvement à prévoir';
export type RecepRouenStatus = 'Oui' | 'Non' | 'A confirmer svp';

export interface SeaDeliveryItem {
  id: string;
  item_no: string; // "01", "02", etc. (automatique)
  description: string; // Saisie manuel
  colisage_info: string; // Nb de colis, dimensions et poids
  volume_m3: number; // Volume estimé (m³)
  supplier: string; // Fournisseurs
  delivery_type: DeliveryType; // Liste déroulante
  tracking_no: string; // N° de suivi transporteur
  carrier: string; // Transporteur
  carrier_delivery_status: string; // Statut de livraison transporteur
  recep_rouen: RecepRouenStatus; // Liste déroulante: Oui - Non - A confirmer svp
  remarks: string; // Remarque
}

export interface TrackingHistoryStep {
  date: string;
  location: string;
  status: string;
  details: string;
}

export interface Shipment {
  id: string;
  mode: TransportMode;
  supplier: string;
  order_reference: string;
  invoice_no: string;
  bl_awb: string;
  tracking_no: string;
  carrier: CarrierName;
  carrier_status: CarrierStatus;
  carrier_last_location: string;
  eta: string;
  actual_delivery?: string;
  antoine_status: AntoineStatus;
  departure_madagascar?: string;
  arrival_madagascar_eta?: string;
  global_status: GlobalStatus;
  remarks: string;
  priority: 'Haute' | 'Moyenne' | 'Basse';
  weight_kg: number;
  origin: string;
  destination: string;
  vessel_flight: string;
  cost_eur: number;
  customs_status: 'Dédouané' | 'En cours' | 'Bloqué Douane' | 'Non Requis';
  created_at: string;
  updated_at: string;
  documents: ShipmentDocument[];
  history: TrackingHistoryStep[];
  alerts?: ShipmentAlert[];
  sea_deliveries?: SeaDeliveryItem[];
  // Air Shipment Tracking Columns
  carrier_status_date?: string; // Date de statut transporteur
  carrier_delivery_status?: string; // Statut de livraison transporteur
  orly_shipment_status?: string; // Statut d'expédition par Orly
  orly_scan_date?: string; // Date de scan Orly (saisie manuelle)
  ref_fa_digi_nxt?: string; // Ref FA (DIGI - NXT) : format texte
  mada_receipt_date?: string; // Date de récep Mada (après ETA/ARRIVEE)
  // Maritime & Extended Tracking Fields
  etd?: string; // Date de départ estimée / réelle (ETD)
  actual_arrival_date?: string; // Date réelle d'arrivée
  container_no?: string; // Numéro de conteneur (ex: MSCU1234567)
  swb_no?: string; // Numéro Sea Way Bill / Bill of Lading
  port_of_loading?: string; // Port de départ (ex: Le Havre / Rouen)
  port_of_discharge?: string; // Port de destination (ex: Port de Toamasina)
  transshipment_ports?: string[]; // Escales / Transbordement
}

export interface SeaTrackingEvent {
  date: string;
  location: string;
  vessel?: string;
  voyage?: string;
  status: string;
  details: string;
}

export interface SeaTrackingResult {
  search_query: string;
  search_type: 'container' | 'swb' | 'unknown';
  carrier: string;
  container_no?: string;
  swb_no?: string;
  vessel_name?: string;
  voyage_no?: string;
  status: string;
  current_location: string;
  port_of_loading: string;
  port_of_discharge: string;
  etd?: string;
  eta?: string;
  actual_arrival_date?: string;
  estimated_lead_time_days?: number;
  actual_lead_time_days?: number;
  transshipment_ports?: string[];
  last_update: string;
  events: SeaTrackingEvent[];
}

export type UserRole = 'supply_chain' | 'sourcing' | 'direction';

export interface FilterState {
  search: string;
  mode: 'all' | 'Air' | 'Sea';
  carrier: string;
  globalStatus: string;
  delayOnly: boolean;
  alertOnly: boolean;
  supplier: string;
  priority: string;
}

export interface MetricSummary {
  totalShipments: number;
  airCount: number;
  seaCount: number;
  delaysCount: number;
  orlyStockCount: number; // Delivered to Orly hub
  orlyOverdueCount: number; // Delivered to Orly > 10 days without Madagascar departure
  criticalAlertsCount: number;
  customsBlockedCount: number;
  pendingTransitConfirm: number;
  slaComplianceRate: number; // percentage
  totalValueInTransit: number; // Sum cost_eur for "Reçu et expédié"
  totalValuePerduOrly: number; // Sum cost_eur for "Perdu Orly"
}
