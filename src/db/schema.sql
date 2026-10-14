-- ==============================================================================
-- SCHÉMA SQL COMPLET POUR BASE DE DONNÉES NEON (POSTGRESQL SERVERLESS)
-- Application: NextHope Logistics & Supply Chain Platform
-- Mode: Requêtes SQL directes (@neondatabase/serverless)
-- ==============================================================================

-- Activation de l'extension pgcrypto pour les identifiants uniques si besoin
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ------------------------------------------------------------------------------
-- 1. TABLE PRINCIPALE : shipments (Expéditions Aériennes & Maritimes)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS shipments (
    id VARCHAR(50) PRIMARY KEY,
    mode VARCHAR(10) NOT NULL CHECK (mode IN ('Air', 'Sea')),
    supplier VARCHAR(255) NOT NULL,
    order_reference VARCHAR(100),
    invoice_no VARCHAR(100),
    bl_awb VARCHAR(100),
    tracking_no VARCHAR(100),
    carrier VARCHAR(100),
    carrier_status VARCHAR(100),
    carrier_last_location TEXT,
    eta VARCHAR(50),
    actual_delivery VARCHAR(50),
    antoine_status VARCHAR(50),
    departure_madagascar VARCHAR(50),
    arrival_madagascar_eta VARCHAR(50),
    global_status VARCHAR(100),
    remarks TEXT,
    priority VARCHAR(20) DEFAULT 'Moyenne',
    weight_kg NUMERIC(10, 2) DEFAULT 0,
    origin VARCHAR(100),
    destination VARCHAR(100),
    vessel_flight VARCHAR(100),
    cost_eur NUMERIC(12, 2) DEFAULT 0,
    customs_status VARCHAR(50) DEFAULT 'Non Requis',
    
    -- Colonnes Suivi Aérien / Hub Orly
    carrier_status_date VARCHAR(50),
    carrier_delivery_status VARCHAR(255),
    orly_shipment_status VARCHAR(255),
    orly_scan_date VARCHAR(50),
    ref_fa_digi_nxt VARCHAR(100),
    mada_receipt_date VARCHAR(50),

    -- Colonnes Suivi Maritime
    etd VARCHAR(50),
    actual_arrival_date VARCHAR(50),
    container_no VARCHAR(100),
    swb_no VARCHAR(100),
    port_of_loading VARCHAR(100),
    port_of_discharge VARCHAR(100),
    transshipment_ports JSONB DEFAULT '[]'::jsonb,

    -- Données structurées JSONB pour performance et modularité
    documents JSONB DEFAULT '[]'::jsonb,
    history JSONB DEFAULT '[]'::jsonb,
    alerts JSONB DEFAULT '[]'::jsonb,
    sea_deliveries JSONB DEFAULT '[]'::jsonb,

    created_at VARCHAR(50) NOT NULL,
    updated_at VARCHAR(50) NOT NULL
);

-- Index pour requêtes ultra-rapides et filtres fréquents
CREATE INDEX IF NOT EXISTS idx_shipments_mode ON shipments (mode);
CREATE INDEX IF NOT EXISTS idx_shipments_tracking_no ON shipments (tracking_no);
CREATE INDEX IF NOT EXISTS idx_shipments_global_status ON shipments (global_status);
CREATE INDEX IF NOT EXISTS idx_shipments_carrier ON shipments (carrier);
CREATE INDEX IF NOT EXISTS idx_shipments_orly_scan_date ON shipments (orly_scan_date);
CREATE INDEX IF NOT EXISTS idx_shipments_container_no ON shipments (container_no);
CREATE INDEX IF NOT EXISTS idx_shipments_swb_no ON shipments (swb_no);

-- ------------------------------------------------------------------------------
-- 2. TABLE OPTIONNELLE NORMALISÉE : sea_delivery_items (Colisage Maritime Rouen)
-- Permet des requêtes SQL relationnelles dédiées sur les livraisons maritimes
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sea_delivery_items (
    id VARCHAR(50) PRIMARY KEY,
    shipment_id VARCHAR(50) REFERENCES shipments(id) ON DELETE CASCADE,
    item_no VARCHAR(20) NOT NULL,
    description TEXT,
    colisage_info TEXT,
    volume_m3 NUMERIC(8, 3) DEFAULT 0,
    supplier VARCHAR(255),
    delivery_type VARCHAR(100),
    tracking_no VARCHAR(100),
    carrier VARCHAR(100),
    carrier_delivery_status VARCHAR(255),
    recep_rouen VARCHAR(50),
    remarks TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sea_items_shipment_id ON sea_delivery_items (shipment_id);

-- ------------------------------------------------------------------------------
-- 3. TABLE AUDIT / LOGS : system_audit_logs (Traçabilité des modifications)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS system_audit_logs (
    id BIGSERIAL PRIMARY KEY,
    entity_type VARCHAR(50) NOT NULL,
    entity_id VARCHAR(50) NOT NULL,
    action VARCHAR(50) NOT NULL, -- 'INSERT', 'UPDATE', 'DELETE'
    user_role VARCHAR(50),
    details JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ------------------------------------------------------------------------------
-- 4. RÉFÉRENTIELS : transporteurs et fournisseurs
-- Créés automatiquement au premier appel de /api/reference/* (ensureReferenceSchema).
-- Tables vides au départ : aucune donnée de démonstration.
-- shipments.carrier / shipments.supplier restent des champs texte (compatibilité).
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS shipment_carriers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    transport_mode VARCHAR(10) NOT NULL CHECK (transport_mode IN ('Air', 'Sea', 'BOTH')),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_shipment_carriers_name_unique_ci
    ON shipment_carriers (LOWER(TRIM(name)));
CREATE INDEX IF NOT EXISTS idx_shipment_carriers_active
    ON shipment_carriers (is_active);

CREATE TABLE IF NOT EXISTS shipment_suppliers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(150) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_shipment_suppliers_name_unique_ci
    ON shipment_suppliers (LOWER(TRIM(name)));
CREATE INDEX IF NOT EXISTS idx_shipment_suppliers_active
    ON shipment_suppliers (is_active);

-- ------------------------------------------------------------------------------
-- 5. ALERTES RÉSOLUES (état partagé entre utilisateurs)
-- Créée automatiquement au premier appel de /api/alerts/* (ensureAlertsSchema).
-- alert_id = identifiant déterministe produit par le moteur de règles.
-- L'historique résolution/réouverture est dans system_audit_logs.
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS resolved_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    alert_id VARCHAR(100) NOT NULL UNIQUE,
    shipment_id VARCHAR(50),
    rule_code VARCHAR(50),
    resolved_by_user_id UUID NOT NULL,
    resolved_by_email VARCHAR(255) NOT NULL,
    resolved_by_name VARCHAR(100),
    resolved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolution_note TEXT
);

CREATE INDEX IF NOT EXISTS idx_resolved_alerts_shipment_id
    ON resolved_alerts (shipment_id);

-- ------------------------------------------------------------------------------
-- 6. FACTURES DIGI LOGISTIC → NEXTHOPE ("colis à suivre")
-- Créées automatiquement au premier appel de /api/digi-invoices (ensureDigiInvoicesSchema).
-- source = 'odoo' (lecture seule, identifiée par odoo_move_id), 'excel' ou 'manual'
-- (identifiées par fournisseur + référence, sans tenir compte de la casse).
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS digi_invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source VARCHAR(10) NOT NULL CHECK (source IN ('odoo', 'excel', 'manual')),
    supplier_name VARCHAR(255),          -- partner_id
    supplier_odoo_id INTEGER,
    dest_partner_name VARCHAR(255),      -- dest_partner_id
    dest_partner_odoo_id INTEGER,
    ref VARCHAR(255),                    -- ref
    invoice_date DATE,                   -- invoice_date
    amazon_order_ref VARCHAR(255),       -- num_cmd_amz
    sale_move_ref VARCHAR(255),          -- sale_move_id
    sale_move_odoo_id INTEGER,
    odoo_move_id INTEGER UNIQUE,
    odoo_move_name VARCHAR(255),
    odoo_state VARCHAR(30),
    odoo_write_date VARCHAR(30),
    odoo_missing BOOLEAN NOT NULL DEFAULT FALSE,
    odoo_synced_at TIMESTAMPTZ,
    created_by_email VARCHAR(255),
    updated_by_email VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_digi_invoices_supplier_ref_ci
    ON digi_invoices (LOWER(TRIM(supplier_name)), LOWER(TRIM(ref)))
    WHERE odoo_move_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_digi_invoices_date ON digi_invoices (invoice_date DESC);
CREATE INDEX IF NOT EXISTS idx_digi_invoices_amazon ON digi_invoices (amazon_order_ref);

CREATE TABLE IF NOT EXISTS digi_invoice_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id UUID NOT NULL REFERENCES digi_invoices(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    name TEXT NOT NULL,                  -- name
    quantity NUMERIC(14, 4),             -- quantity
    price_unit NUMERIC(14, 4),           -- price_unit
    price_subtotal NUMERIC(14, 2),       -- price_subtotal
    odoo_line_id INTEGER
);

CREATE INDEX IF NOT EXISTS idx_digi_invoice_lines_invoice
    ON digi_invoice_lines (invoice_id, position);

-- Historique des synchronisations Odoo (bouton « Synchroniser Odoo » ou cron quotidien)
CREATE TABLE IF NOT EXISTS digi_odoo_sync_runs (
    id BIGSERIAL PRIMARY KEY,
    trigger VARCHAR(10) NOT NULL CHECK (trigger IN ('manual', 'cron')),
    actor_email VARCHAR(255),
    started_at TIMESTAMPTZ NOT NULL,
    finished_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    success BOOLEAN NOT NULL,
    result JSONB,
    error TEXT
);

CREATE INDEX IF NOT EXISTS idx_digi_odoo_sync_runs_started
    ON digi_odoo_sync_runs (started_at DESC);
