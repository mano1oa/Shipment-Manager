import { Shipment } from '../types';

export const INITIAL_SHIPMENTS: Shipment[] = [
  // 1. Critical Alert: Delivered to Orly > 10 days without departure to Madagascar
  {
    id: 'SHP-1001',
    mode: 'Air',
    supplier: 'Dell Technologies Europe',
    order_reference: 'PO-2026-8812',
    invoice_no: 'INV-DELL-9912',
    bl_awb: 'AWB-020-94817263',
    tracking_no: 'DHL-8472910384',
    carrier: 'DHL Express',
    carrier_status: 'Delivered',
    carrier_last_location: 'Hub Roissy / Orly Cargo, France',
    eta: '2026-07-02',
    actual_delivery: '2026-07-02',
    antoine_status: 'En attente Antoine',
    departure_madagascar: '',
    arrival_madagascar_eta: '2026-07-15',
    global_status: 'Reçu et expédié',
    remarks: 'Lot de 50 PC portables Latitude. En souffrance en zone sous douane Orly.',
    priority: 'Haute',
    weight_kg: 185,
    origin: 'Frankfurt (FRA)',
    destination: 'Antananarivo (TNR)',
    vessel_flight: 'AF 934 (Paris-TNR)',
    cost_eur: 2450,
    customs_status: 'En cours',
    created_at: '2026-06-25',
    updated_at: '2026-07-02',
    documents: [
      {
        id: 'DOC-101',
        shipment_id: 'SHP-1001',
        type: 'Invoice',
        filename: 'Invoice_Dell_9912.pdf',
        url: '#',
        uploaded_at: '2026-06-26',
        size_kb: 420,
      },
      {
        id: 'DOC-102',
        shipment_id: 'SHP-1001',
        type: 'BL_AWB',
        filename: 'AWB_020_94817263.pdf',
        url: '#',
        uploaded_at: '2026-06-28',
        size_kb: 310,
      },
    ],
    carrier_status_date: '2026-07-02',
    carrier_delivery_status: 'Livré au quai transitaire Orly',
    orly_shipment_status: 'Scanné & Expédié Orly',
    orly_scan_date: '2026-07-02',
    ref_fa_digi_nxt: 'FA-2026-8801',
    mada_receipt_date: '2026-07-16',
    history: [
      { date: '2026-06-28 10:00', location: 'Frankfurt Airport', status: 'Enlèvement effectué', details: 'Colis pris en charge' },
      { date: '2026-06-30 18:30', location: 'Hub DHL Leipzig', status: 'Transit', details: 'En cours de tri' },
      { date: '2026-07-02 09:15', location: 'Orly Airport Hub', status: 'Livré', details: 'Livré au quai transitaire Orly' },
    ],
  },

  // 2. Critical Alert: Customs blocked
  {
    id: 'SHP-1002',
    mode: 'Sea',
    supplier: 'Schneider Electric Asia',
    order_reference: 'PO-2026-4401',
    invoice_no: 'INV-SE-30219',
    bl_awb: 'BL-MSCU-8839201',
    tracking_no: 'MSC-99382104',
    carrier: 'MSC (Sea)',
    carrier_status: 'Customs Clearance',
    carrier_last_location: 'Port de Toamasina (Tamatave)',
    eta: '2026-07-10',
    etd: '2026-05-20',
    actual_arrival_date: '',
    container_no: 'MSCU8839201',
    swb_no: 'SWB-MSC-99382104',
    port_of_loading: 'Ningbo Port (NGB)',
    port_of_discharge: 'Port de Toamasina (TMM)',
    transshipment_ports: ['Port-Louis (Maurice)'],
    antoine_status: 'Transmis transitaire',
    departure_madagascar: '2026-06-10',
    arrival_madagascar_eta: '2026-07-10',
    global_status: 'Bloqué douane',
    remarks: 'Conteneur 40HC Armoires électriques. Blocage sur certificat de conformité H.S. Code.',
    priority: 'Haute',
    weight_kg: 12400,
    origin: 'Ningbo Port (NGB)',
    destination: 'Toamasina (TMM)',
    vessel_flight: 'MSC EMMA / V.622',
    cost_eur: 6800,
    customs_status: 'Bloqué Douane',
    created_at: '2026-05-18',
    updated_at: '2026-07-12',
    documents: [
      {
        id: 'DOC-103',
        shipment_id: 'SHP-1002',
        type: 'BL_AWB',
        filename: 'Bill_of_Lading_MSCU8839201.pdf',
        url: '#',
        uploaded_at: '2026-05-20',
        size_kb: 890,
      },
      {
        id: 'DOC-104',
        shipment_id: 'SHP-1002',
        type: 'Customs',
        filename: 'Notification_Blocage_Douane.pdf',
        url: '#',
        uploaded_at: '2026-07-11',
        size_kb: 190,
      },
    ],
    history: [
      { date: '2026-05-22 14:00', location: 'Ningbo Port', status: 'Chargement Conteneur', details: 'Embarqué sur navire' },
      { date: '2026-06-15 08:00', location: 'Port Louis Transit', status: 'Escale', details: 'Transbordement réussi' },
      { date: '2026-07-10 11:00', location: 'Port de Toamasina', status: 'Arrivée Port', details: 'En attente douanes' },
      { date: '2026-07-11 16:20', location: 'Port de Toamasina', status: 'Blocage', details: 'Contrôle documentaire rejeté' },
    ],
    sea_deliveries: [
      {
        id: 'DEL-1002-01',
        item_no: '01',
        description: 'Armoires électriques blindées BT/HT',
        colisage_info: '3 palettes bois (120x100x180cm), 1250 kg',
        volume_m3: 6.48,
        supplier: 'Schneider Electric Grenoble',
        delivery_type: 'Livraison par fournisseur',
        tracking_no: 'SCH-994821',
        carrier: 'Dachser Logistics',
        carrier_delivery_status: 'Livré au quai Rouen',
        recep_rouen: 'Oui',
        remarks: 'Emballage sous thermorétractable OK',
      },
      {
        id: 'DEL-1002-02',
        item_no: '02',
        description: 'Module disjoncteurs et coffrets de commande',
        colisage_info: '8 caisses renforcées (80x60x60cm), 420 kg',
        volume_m3: 2.30,
        supplier: 'Schneider Electric Moirans',
        delivery_type: 'Enlèvement à prévoir',
        tracking_no: 'SCHE-441092',
        carrier: 'Kuehne+Nagel',
        carrier_delivery_status: 'En transit vers Hub Rouen',
        recep_rouen: 'A confirmer svp',
        remarks: 'Enlèvement usine programmé',
      },
    ],
  },

  // 3. Critical Alert: Orly > 10 days
  {
    id: 'SHP-1003',
    mode: 'Air',
    supplier: 'Cisco Systems Intl',
    order_reference: 'PO-2026-9010',
    invoice_no: 'INV-CS-7711',
    bl_awb: 'AWB-057-38291029',
    tracking_no: 'FDX-7739201948',
    carrier: 'FedEx',
    carrier_status: 'Delivered',
    carrier_last_location: 'Plateforme FedEx Orly Cargo',
    eta: '2026-07-05',
    actual_delivery: '2026-07-05',
    antoine_status: 'En attente Antoine',
    departure_madagascar: '',
    arrival_madagascar_eta: '2026-07-18',
    global_status: 'Reçu et expédié',
    remarks: 'Switchs réseau Enterprise Catalyst. Relance transitaire restée sans réponse.',
    priority: 'Haute',
    weight_kg: 92,
    origin: 'Amsterdam (AMS)',
    destination: 'Antananarivo (TNR)',
    vessel_flight: 'MD 051 (Air Madagascar)',
    cost_eur: 1890,
    customs_status: 'En cours',
    created_at: '2026-06-28',
    updated_at: '2026-07-05',
    documents: [],
    history: [
      { date: '2026-07-02 11:00', location: 'Amsterdam Schiphol', status: 'Prise en charge', details: 'Expédié via FedEx' },
      { date: '2026-07-05 14:00', location: 'Orly Cargo', status: 'Livré', details: 'Remis à l\'entrepôt transit' },
    ],
  },

  // 4. In Transit Normal
  {
    id: 'SHP-1004',
    mode: 'Air',
    supplier: 'Apple Logistics Europe',
    order_reference: 'PO-2026-1102',
    invoice_no: 'INV-APL-8820',
    bl_awb: 'AWB-020-11928374',
    tracking_no: 'UPS-1Z9999999999',
    carrier: 'UPS',
    carrier_status: 'In Transit',
    carrier_last_location: 'Hub Roissy CDG, France',
    eta: '2026-07-24',
    antoine_status: 'Confirmé',
    departure_madagascar: '2026-07-23',
    arrival_madagascar_eta: '2026-07-25',
    global_status: 'En livraison vers Orly',
    remarks: '20 MacBooks Pro M3 pour équipe technique.',
    priority: 'Moyenne',
    weight_kg: 48,
    origin: 'Cork (ORK), Irlande',
    destination: 'Antananarivo (TNR)',
    vessel_flight: 'AF 934',
    cost_eur: 1120,
    customs_status: 'En cours',
    created_at: '2026-07-18',
    updated_at: '2026-07-21',
    documents: [
      {
        id: 'DOC-105',
        shipment_id: 'SHP-1004',
        type: 'Invoice',
        filename: 'Invoice_Apple_8820.pdf',
        url: '#',
        uploaded_at: '2026-07-19',
        size_kb: 280,
      },
    ],
    history: [
      { date: '2026-07-19 09:00', location: 'Cork Depot', status: 'Enlèvement', details: 'UPS Express Air' },
      { date: '2026-07-21 17:30', location: 'CDG Airport', status: 'En transit', details: 'Transfert camion vers Orly' },
    ],
  },

  // 5. Customs Exception
  {
    id: 'SHP-1005',
    mode: 'Air',
    supplier: 'HP Inc EMEA',
    order_reference: 'PO-2026-5531',
    invoice_no: 'INV-HP-9910',
    bl_awb: 'AWB-172-8829102',
    tracking_no: 'TNT-991029384',
    carrier: 'TNT',
    carrier_status: 'Customs Clearance',
    carrier_last_location: 'Ivato International Airport (TNR)',
    eta: '2026-07-20',
    antoine_status: 'Transmis transitaire',
    departure_madagascar: '2026-07-19',
    arrival_madagascar_eta: '2026-07-20',
    global_status: 'Bloqué douane',
    remarks: 'Serveurs ProLiant Gen11. Valeur douanière en cours de vérification par l\'Administration.',
    priority: 'Haute',
    weight_kg: 210,
    origin: 'Grenoble (GNB)',
    destination: 'Antananarivo (TNR)',
    vessel_flight: 'AF 934',
    cost_eur: 3100,
    customs_status: 'Bloqué Douane',
    created_at: '2026-07-12',
    updated_at: '2026-07-21',
    documents: [],
    history: [
      { date: '2026-07-15 10:00', location: 'Lyon St Exupéry', status: 'Expédié', details: 'Vol cargo Paris' },
      { date: '2026-07-19 22:00', location: 'Paris CDG', status: 'Embarqué', details: 'AF 934 à destination d\'Ivato' },
      { date: '2026-07-20 15:00', location: 'Ivato Airport', status: 'Arrivé', details: 'Déchargé et scellé douane' },
    ],
  },

  // 6. Delivered Normal
  {
    id: 'SHP-1006',
    mode: 'Sea',
    supplier: 'Legrand Electric Shanghai',
    order_reference: 'PO-2026-2291',
    invoice_no: 'INV-LEG-40192',
    bl_awb: 'BL-MAEU-99102938',
    tracking_no: 'MAE-00293841',
    carrier: 'Maersk (Sea)',
    carrier_status: 'Delivered',
    carrier_last_location: 'Entrepôt Central Antananarivo',
    eta: '2026-07-14',
    etd: '2026-06-01',
    actual_arrival_date: '2026-07-14',
    container_no: 'MAEU9910293',
    swb_no: 'SWB-MAE-00293841',
    port_of_loading: 'Shanghai Port (SHA)',
    port_of_discharge: 'Port de Toamasina (TMM)',
    transshipment_ports: ['Port de La Réunion'],
    actual_delivery: '2026-07-14',
    antoine_status: 'Confirmé',
    departure_madagascar: '2026-06-01',
    arrival_madagascar_eta: '2026-07-10',
    global_status: 'Livré entrepôt',
    remarks: '2 conteneurs 20ft de goulottes et disjoncteurs. Reçu conforme.',
    priority: 'Moyenne',
    weight_kg: 28400,
    origin: 'Shanghai Port (SHA)',
    destination: 'Toamasina (TMM)',
    vessel_flight: 'MAERSK MC-KINNEY / V.102',
    cost_eur: 11400,
    customs_status: 'Dédouané',
    created_at: '2026-05-10',
    updated_at: '2026-07-14',
    documents: [
      {
        id: 'DOC-106',
        shipment_id: 'SHP-1006',
        type: 'Invoice',
        filename: 'Invoice_Legrand_40192.pdf',
        url: '#',
        uploaded_at: '2026-05-12',
        size_kb: 510,
      },
    ],
    history: [
      { date: '2026-06-01 12:00', location: 'Shanghai Port', status: 'Départ', details: 'Embarquement navire' },
      { date: '2026-07-10 08:00', location: 'Toamasina Port', status: 'Arrivée', details: 'Déchargement conteneur' },
      { date: '2026-07-12 14:00', location: 'Route Nationale 2', status: 'Transit routier', details: 'Camionnage vers Tana' },
      { date: '2026-07-14 11:30', location: 'Tana Entrepôt', status: 'Livré', details: 'Réception valide' },
    ],
    sea_deliveries: [
      {
        id: 'DEL-1006-01',
        item_no: '01',
        description: 'Goulottes PVC industrielles 2 mètres',
        colisage_info: '12 fardeaux (200x40x40cm), 820 kg',
        volume_m3: 3.84,
        supplier: 'Legrand Normandie',
        delivery_type: 'Livraison par fournisseur',
        tracking_no: 'LEG-883920',
        carrier: 'DB Schenker',
        carrier_delivery_status: 'Livré au quai Rouen',
        recep_rouen: 'Oui',
        remarks: 'Contrôle quantitatif conforme à la commande',
      },
      {
        id: 'DEL-1006-02',
        item_no: '02',
        description: 'Disjoncteurs modulaires & appareillage',
        colisage_info: '4 palettes (120x80x140cm), 610 kg',
        volume_m3: 4.30,
        supplier: 'Legrand Malaunay',
        delivery_type: 'Livraison par fournisseur',
        tracking_no: 'LEG-112093',
        carrier: 'Geodis',
        carrier_delivery_status: 'Livré au quai Rouen',
        recep_rouen: 'Oui',
        remarks: 'Réceptionné sans réserve',
      },
    ],
  },

  // Generate 44 additional realistic entries dynamically with consistent properties
  ...Array.from({ length: 44 }).map((_, i) => {
    const idx = i + 7;
    const mode: 'Air' | 'Sea' = idx % 3 === 0 ? 'Sea' : 'Air';
    const carriers: Shipment['carrier'][] = [
      'DHL Express',
      'FedEx',
      'UPS',
      'Chronopost',
      'Colissimo',
      'Amazon Logistics',
      'DB Schenker',
      'Dachser',
      'CEVA Logistics',
      'GLS',
      'DPD',
      'MSC (Sea)',
      'Maersk (Sea)',
    ];
    const carrier = carriers[idx % carriers.length];

    const suppliers = [
      'Lenovo Global Supply',
      'Huawei Technologies',
      'Samsung Electronics',
      'Western Digital Intl',
      'Eaton Power Quality',
      'Honeywell Building Solutions',
      'Philips Healthcare Supply',
      'Xiaomi Distribution',
      'MikroTik Europe',
      'Ubiquiti Inc',
    ];
    const supplier = suppliers[idx % suppliers.length];

    let global_status: Shipment['global_status'] = 'Attente confirmation transitaire';
    let carrier_status: Shipment['carrier_status'] = 'In Transit';
    let customs_status: Shipment['customs_status'] = 'En cours';
    let antoine_status: Shipment['antoine_status'] = 'Confirmé';

    let priority: 'Haute' | 'Moyenne' | 'Basse' = 'Moyenne';
    let actual_delivery: string | undefined = undefined;
    let departure_madagascar: string | undefined = '2026-07-10';

    // Distribute realistic delays, alerts, in-transit
    if (idx <= 12) {
      // Retards ETA
      carrier_status = 'Exception / Delay';
      global_status = 'Attente confirmation transitaire';
      antoine_status = 'En attente Antoine';
      departure_madagascar = undefined;
      priority = 'Haute';
    } else if (idx <= 16) {
      // Customs exceptions
      carrier_status = 'Customs Clearance';
      customs_status = 'Bloqué Douane';
      global_status = 'Bloqué douane';
      priority = 'Haute';
    } else if (idx <= 22) {
      // Delivered Orly Pending
      carrier_status = 'Delivered';
      global_status = 'Reçu et expédié';
      departure_madagascar = undefined;
      actual_delivery = `2026-07-0${(idx % 8) + 1}`;
    } else if (idx <= 32) {
      // Fully Delivered
      carrier_status = 'Delivered';
      global_status = 'Livré entrepôt';
      customs_status = 'Dédouané';
      actual_delivery = `2026-07-${(idx % 15) + 5}`;
    } else {
      // In transit
      carrier_status = 'In Transit';
      global_status = mode === 'Air' ? 'En livraison vers Orly' : 'Reçu et expédié';
    }

    const order_reference = `PO-2026-${3000 + idx * 17}`;
    const tracking_no = `${carrier.substring(0, 3).toUpperCase()}-${99000000 + idx * 8321}`;
    const bl_awb = mode === 'Air' ? `AWB-020-${110000 + idx * 921}` : `BL-SEAL-${44000 + idx * 102}`;

    return {
      id: `SHP-${1000 + idx}`,
      mode,
      supplier,
      order_reference,
      invoice_no: `INV-${supplier.substring(0, 3).toUpperCase()}-${8000 + idx}`,
      bl_awb,
      tracking_no,
      carrier,
      carrier_status,
      carrier_last_location:
        mode === 'Air' ? 'Hub Cargo Orly / CDG, France' : 'Port de Transit Pointe des Galets',
      eta: `2026-07-${(idx % 20) + 10}`,
      etd: mode === 'Sea' ? `2026-06-${(idx % 15) + 1}` : `2026-07-02`,
      actual_arrival_date: actual_delivery || (carrier_status === 'Delivered' ? `2026-07-${(idx % 15) + 5}` : ''),
      container_no: mode === 'Sea' ? `MSCU${7700000 + idx * 3192}` : undefined,
      swb_no: mode === 'Sea' ? `SWB-BL-${8800000 + idx * 4312}` : undefined,
      port_of_loading: mode === 'Sea' ? 'Port de Le Havre / Rouen' : 'CDG / Orly',
      port_of_discharge: mode === 'Sea' ? 'Port de Toamasina' : 'Ivato TNR',
      transshipment_ports: mode === 'Sea' ? ['Port de La Réunion'] : undefined,
      actual_delivery,
      antoine_status,
      departure_madagascar,
      arrival_madagascar_eta: `2026-07-${(idx % 18) + 12}`,
      global_status,
      remarks: `Expédition automatique lot #${idx} - Matériel IT / Infrastructures.`,
      priority,
      weight_kg: mode === 'Air' ? 25 + idx * 12 : 1200 + idx * 350,
      origin: mode === 'Air' ? 'Paris (CDG)' : 'Shenzhen (SZX)',
      destination: mode === 'Air' ? 'Antananarivo (TNR)' : 'Toamasina (TMM)',
      vessel_flight: mode === 'Air' ? `AF ${930 + (idx % 10)}` : `MSC ${supplier.substring(0, 4).toUpperCase()} / V.${10 + idx}`,
      cost_eur: mode === 'Air' ? 450 + idx * 80 : 3200 + idx * 210,
      customs_status,
      created_at: `2026-06-${(idx % 25) + 1}`,
      updated_at: `2026-07-${(idx % 15) + 5}`,
      documents: [
        {
          id: `DOC-${idx}1`,
          shipment_id: `SHP-${1000 + idx}`,
          type: 'Invoice',
          filename: `Invoice_${order_reference}.pdf`,
          url: '#',
          uploaded_at: `2026-06-15`,
          size_kb: 340,
        },
      ],
      history: [
        {
          date: `2026-06-20 09:30`,
          location: 'Entrepôt Origine',
          status: 'Prise en charge',
          details: 'Mise à disposition transporteur',
        },
        {
          date: `2026-07-01 14:15`,
          location: 'Hub de Transit',
          status: carrier_status,
          details: 'En cours d’acheminement',
        },
      ],
      carrier_status_date: mode === 'Air' ? `2026-07-${(idx % 18) + 1}` : undefined,
      carrier_delivery_status:
        mode === 'Air'
          ? idx % 2 === 0
            ? 'Livré Hub Orly Cargo'
            : 'En cours de dédouanement CDG'
          : undefined,
      orly_shipment_status:
        mode === 'Air'
          ? idx % 3 === 0
            ? 'Scanné & Expédié Orly'
            : idx % 2 === 0
            ? 'En attente scan Orly'
            : 'Pli sous douane'
          : undefined,
      orly_scan_date: mode === 'Air' && idx % 3 === 0 ? `2026-07-${(idx % 10) + 10}` : '',
      ref_fa_digi_nxt: `FA-2026-${8800 + (idx % 6)}`,
      mada_receipt_date: idx % 4 === 0 ? `2026-07-${(idx % 12) + 12}` : '',
      sea_deliveries:
        mode === 'Sea'
          ? [
              {
                id: `DEL-${idx}-01`,
                item_no: '01',
                description: `Lot matériel ${supplier.split(' ')[0]}`,
                colisage_info: `${(idx % 4) + 1} palettes (${120 + idx}x80x150cm), ${200 + idx * 30}kg`,
                volume_m3: Number((1.2 + idx * 0.15).toFixed(2)),
                supplier: supplier,
                delivery_type: idx % 2 === 0 ? 'Livraison par fournisseur' : 'Enlèvement à prévoir',
                tracking_no: `TRK-RN-${500000 + idx * 111}`,
                carrier: idx % 2 === 0 ? 'DB Schenker' : 'Kuehne+Nagel',
                carrier_delivery_status: idx % 3 === 0 ? 'Livré au quai Rouen' : 'En transit vers Hub Rouen',
                recep_rouen: idx % 3 === 0 ? 'Oui' : idx % 2 === 0 ? 'A confirmer svp' : 'Non',
                remarks: `Suivi automatique transitaire Rouen #${idx}`,
              },
            ]
          : undefined,
    } as Shipment;
  }),
];
