import { neon, NeonQueryFunction } from '@neondatabase/serverless';

/**
 * Client Neon pour requêtes SQL directes (Serverless PostgreSQL)
 * Utilise la variable d'environnement DATABASE_URL.
 */

let currentConnectionUrl: string | null = null;
let sqlClient: NeonQueryFunction<false, false> | null = null;

/**
 * Détecte l'URL de connexion PostgreSQL (Neon / Vercel Neon Integration)
 * Supporte DATABASE_URL, POSTGRES_URL, POSTGRES_URL_NON_POOLING injectés par Vercel
 */
export function getConnectionString(): string | null {
  const url =
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_URL_NON_POOLING ||
    process.env.POSTGRES_PRISMA_URL;

  if (url && url.trim().startsWith('postgres')) {
    return url.trim();
  }
  return null;
}

/**
 * Vérifie si la configuration Neon est présente
 */
export function isNeonConfigured(): boolean {
  return getConnectionString() !== null;
}

/**
 * Retourne l'instance du client SQL direct Neon (initialisation différée / lazy)
 */
export function getDb(): NeonQueryFunction<false, false> {
  const databaseUrl = getConnectionString();

  if (!databaseUrl) {
    throw new Error(
      'La variable d’environnement DATABASE_URL (ou POSTGRES_URL fournie par Vercel) est manquante. Veuillez renseigner votre URI de connexion Neon dans les variables d’environnement de votre projet.'
    );
  }

  if (!sqlClient || currentConnectionUrl !== databaseUrl) {
    currentConnectionUrl = databaseUrl;
    // Initialisation du client Neon HTTP ultra-rapide (compatible Serverless & Edge)
    sqlClient = neon(databaseUrl);
  }

  return sqlClient;
}

/**
 * Exécute une requête SQL directe avec paramètres préparés
 * Exemple:
 *   const rows = await executeQuery<Shipment>('SELECT * FROM shipments WHERE mode = $1', ['Air']);
 */
export async function executeQuery<T = any>(
  queryText: string,
  params: any[] = []
): Promise<T[]> {
  const sql = getDb();
  
  // Neon supporte l'appel direct sql(query, params) ou les requêtes préparées
  try {
    const result = await sql.query(queryText, params);
    return (result || []) as T[];
  } catch (error: any) {
    // Params are not logged: they may contain personal or sensitive values.
    console.error('Erreur lors de l’exécution SQL directe sur Neon:', {
      query: queryText,
      error: error?.message || error,
    });
    throw error;
  }
}

/**
 * Teste la connexion directe à la base de données Neon
 */
export async function testNeonConnection(): Promise<{
  connected: boolean;
  version?: string;
  database?: string;
  tableExists?: boolean;
  shipmentsCount?: number;
  error?: string;
}> {
  if (!isNeonConfigured()) {
    return {
      connected: false,
      error: 'DATABASE_URL non configurée',
    };
  }

  try {
    const sql = getDb();
    const rows = await sql`SELECT current_database() as db_name, version() as pg_version, NOW() as server_time;`;
    
    let tableExists = false;
    let shipmentsCount = 0;
    try {
      const chk = await sql`SELECT EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = 'shipments'
      ) as exists;`;
      tableExists = Boolean(chk?.[0]?.exists);
      if (tableExists) {
        const countRes = await sql`SELECT COUNT(*)::int as count FROM shipments;`;
        shipmentsCount = countRes?.[0]?.count || 0;
      }
    } catch {
      // Table check silent fallback
    }

    return {
      connected: true,
      database: rows?.[0]?.db_name,
      version: rows?.[0]?.pg_version,
      tableExists,
      shipmentsCount,
    };
  } catch (err: any) {
    console.error('[Neon] Connection test failed:', err);
    return {
      connected: false,
      error: 'Échec de connexion à Neon (voir les logs serveur)',
    };
  }
}

/**
 * Initialise le schéma SQL complet dans Neon (Tables, Index, Contraintes)
 * S'exécute automatiquement via requêtes directes CREATE TABLE IF NOT EXISTS
 */
export async function initNeonSchema(): Promise<void> {
  const sql = getDb();

  console.log('📦 Initialisation du schéma SQL dans Neon...');

  // 1. Table principale des expéditions
  await sql`
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
  `;

  // 2. Index de performance
  await sql`CREATE INDEX IF NOT EXISTS idx_shipments_mode ON shipments (mode);`;
  await sql`CREATE INDEX IF NOT EXISTS idx_shipments_tracking_no ON shipments (tracking_no);`;
  await sql`CREATE INDEX IF NOT EXISTS idx_shipments_global_status ON shipments (global_status);`;
  await sql`CREATE INDEX IF NOT EXISTS idx_shipments_carrier ON shipments (carrier);`;
  await sql`CREATE INDEX IF NOT EXISTS idx_shipments_orly_scan_date ON shipments (orly_scan_date);`;
  await sql`CREATE INDEX IF NOT EXISTS idx_shipments_container_no ON shipments (container_no);`;
  await sql`CREATE INDEX IF NOT EXISTS idx_shipments_swb_no ON shipments (swb_no);`;

  // 3. Table des utilisateurs & Rôles
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      display_name VARCHAR(100) NOT NULL,
      role VARCHAR(20) NOT NULL CHECK (role IN ('SUPPLY_CHAIN', 'SOURCING', 'DIRECTION')),
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      last_login_at TIMESTAMPTZ
    );
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);`;

  // 4. Table des sessions utilisateurs (Tokens sécurisés)
  await sql`
    CREATE TABLE IF NOT EXISTS user_sessions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash VARCHAR(64) UNIQUE NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      last_used_at TIMESTAMPTZ DEFAULT NOW()
    );
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_user_sessions_token_hash ON user_sessions (token_hash);`;
  await sql`CREATE INDEX IF NOT EXISTS idx_user_sessions_expires_at ON user_sessions (expires_at);`;

  // 5. Table de suivi des modifications / audit log
  await sql`
    CREATE TABLE IF NOT EXISTS system_audit_logs (
      id BIGSERIAL PRIMARY KEY,
      entity_type VARCHAR(50) NOT NULL,
      entity_id VARCHAR(50) NOT NULL,
      action VARCHAR(50) NOT NULL,
      user_role VARCHAR(50),
      details JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `;

  console.log('✅ Schéma SQL Neon initialisé avec succès.');

  await initReferenceSchema();
}

/**
 * Reference data tables (carriers, suppliers).
 *
 * Kept separate from initNeonSchema() because ensureNeonSchema() only runs the
 * full init when the "shipments" table is missing: on an existing database the
 * reference tables are created lazily by ensureReferenceSchema().
 *
 * Idempotent (CREATE ... IF NOT EXISTS). Tables start EMPTY: no seed data.
 */
export async function initReferenceSchema(): Promise<void> {
  const sql = getDb();

  await sql`
    CREATE TABLE IF NOT EXISTS shipment_carriers (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(100) NOT NULL,
      transport_mode VARCHAR(10) NOT NULL
        CHECK (transport_mode IN ('Air', 'Sea', 'BOTH')),
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_shipment_carriers_name_unique_ci
      ON shipment_carriers (LOWER(TRIM(name)));
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_shipment_carriers_active
      ON shipment_carriers (is_active);
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS shipment_suppliers (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(150) NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_shipment_suppliers_name_unique_ci
      ON shipment_suppliers (LOWER(TRIM(name)));
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_shipment_suppliers_active
      ON shipment_suppliers (is_active);
  `;
}

let referenceSchemaPromise: Promise<void> | null = null;

/**
 * Ensures the reference tables exist (once per server instance).
 */
export function ensureReferenceSchema(): Promise<void> {
  if (!referenceSchemaPromise) {
    referenceSchemaPromise = initReferenceSchema().catch((err) => {
      referenceSchemaPromise = null; // allow retry on next call
      throw err;
    });
  }
  return referenceSchemaPromise;
}
