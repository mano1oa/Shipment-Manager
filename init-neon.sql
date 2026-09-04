  -- ==============================================================================
  -- SCRIPT D'INITIALISATION COMPLET - NEON POSTGRESQL (VERCEL DEPLOYMENT)
  -- Application: NextHope Logistics & Supply Chain Platform
  -- Ce script crée la structure de table, les contraintes et les index sans données fictives (0 mock data).
  -- ==============================================================================

  -- 1. Table principale : shipments
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
      carrier_status_date VARCHAR(50),
      carrier_delivery_status VARCHAR(255),
      orly_shipment_status VARCHAR(255),
      orly_scan_date VARCHAR(50),
      ref_fa_digi_nxt VARCHAR(100),
      mada_receipt_date VARCHAR(50),
      etd VARCHAR(50),
      actual_arrival_date VARCHAR(50),
      container_no VARCHAR(100),
      swb_no VARCHAR(100),
      port_of_loading VARCHAR(100),
      port_of_discharge VARCHAR(100),
      transshipment_ports JSONB DEFAULT '[]'::jsonb,
      documents JSONB DEFAULT '[]'::jsonb,
      history JSONB DEFAULT '[]'::jsonb,
      alerts JSONB DEFAULT '[]'::jsonb,
      sea_deliveries JSONB DEFAULT '[]'::jsonb,
      created_at VARCHAR(50) NOT NULL,
      updated_at VARCHAR(50) NOT NULL
  );

  -- 2. Index de performance pour les recherches rapides
  CREATE INDEX IF NOT EXISTS idx_shipments_mode ON shipments (mode);
  CREATE INDEX IF NOT EXISTS idx_shipments_tracking_no ON shipments (tracking_no);
  CREATE INDEX IF NOT EXISTS idx_shipments_global_status ON shipments (global_status);
  CREATE INDEX IF NOT EXISTS idx_shipments_carrier ON shipments (carrier);
  CREATE INDEX IF NOT EXISTS idx_shipments_orly_scan_date ON shipments (orly_scan_date);
  CREATE INDEX IF NOT EXISTS idx_shipments_container_no ON shipments (container_no);
  CREATE INDEX IF NOT EXISTS idx_shipments_swb_no ON shipments (swb_no);

  -- 3. Table de journalisation et audit
  CREATE TABLE IF NOT EXISTS system_audit_logs (
      id BIGSERIAL PRIMARY KEY,
      entity_type VARCHAR(50) NOT NULL,
      entity_id VARCHAR(50) NOT NULL,
      action VARCHAR(50) NOT NULL,
      user_role VARCHAR(50),
      details JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW()
  );
