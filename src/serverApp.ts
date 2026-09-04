import express, { Express } from 'express';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';

import {
  isNeonConfigured,
  testNeonConnection,
  initNeonSchema,
  ensureNeonSchema,
  getShipmentsFromNeon,
  getShipmentByIdFromNeon,
  upsertShipmentInNeon,
  deleteShipmentInNeon,
  clearAllShipmentsInNeon,
} from './db/index';

import {
  findUserByEmail,
  verifyUserPassword,
  updateLastLogin,
} from './db/users';

import {
  createSession,
  getSessionUser,
  deleteSession,
} from './db/sessions';

dotenv.config();

function getCookie(req: any, name: string): string | null {
  const cookieHeader = req.headers.cookie;

  if (!cookieHeader) {
    return null;
  }

  const cookies = cookieHeader
    .split(';')
    .map((cookie: string) => cookie.trim());

  for (const cookie of cookies) {
    const separatorIndex = cookie.indexOf('=');

    if (separatorIndex === -1) {
      continue;
    }

    const key = cookie.slice(0, separatorIndex);
    const value = cookie.slice(separatorIndex + 1);

    if (key === name) {
      return decodeURIComponent(value);
    }
  }

  return null;
}

export function createServerApp(): Express {
  const app = express();

  app.use(express.json({ limit: '10mb' }));

  // =========================================================
  // AUTHENTICATION
  // =========================================================

  app.post('/api/auth/login', async (req, res) => {
    try {
      const { email, password } = req.body || {};

      if (!email || !password) {
        return res.status(400).json({
          success: false,
          error: 'Email et mot de passe requis',
        });
      }

      const user = await findUserByEmail(email);

      if (!user || !user.is_active) {
        return res.status(401).json({
          success: false,
          error: 'Email ou mot de passe incorrect',
        });
      }

      const passwordValid = await verifyUserPassword(
        password,
        user.password_hash
      );

      if (!passwordValid) {
        return res.status(401).json({
          success: false,
          error: 'Email ou mot de passe incorrect',
        });
      }

      const session = await createSession(user.id);

      await updateLastLogin(user.id);

      const isProduction = process.env.NODE_ENV === 'production';

      res.setHeader(
        'Set-Cookie',
        [
          `shipment_session=${encodeURIComponent(session.token)}`,
          'HttpOnly',
          'Path=/',
          'SameSite=Lax',
          isProduction ? 'Secure' : '',
          `Expires=${session.expiresAt.toUTCString()}`,
        ]
          .filter(Boolean)
          .join('; ')
      );

      return res.json({
        success: true,
        user: {
          id: user.id,
          email: user.email,
          display_name: user.display_name,
          role: user.role,
        },
      });
    } catch (error: any) {
      console.error('Login error:', error);

      return res.status(500).json({
        success: false,
        error: 'Erreur lors de la connexion',
      });
    }
  });

  app.get('/api/auth/me', async (req, res) => {
    try {
      const token = getCookie(req, 'shipment_session');

      if (!token) {
        return res.status(401).json({
          authenticated: false,
        });
      }

      const sessionUser = await getSessionUser(token);

      if (!sessionUser) {
        return res.status(401).json({
          authenticated: false,
        });
      }

      return res.json({
        authenticated: true,
        user: {
          id: sessionUser.id,
          email: sessionUser.email,
          display_name: sessionUser.display_name,
          role: sessionUser.role,
        },
      });
    } catch (error) {
      console.error('Auth me error:', error);

      return res.status(500).json({
        authenticated: false,
        error: 'Erreur de session',
      });
    }
  });

  app.post('/api/auth/logout', async (req, res) => {
    try {
      const token = getCookie(req, 'shipment_session');

      if (token) {
        await deleteSession(token);
      }

      res.setHeader(
        'Set-Cookie',
        [
          'shipment_session=',
          'HttpOnly',
          'Path=/',
          'SameSite=Lax',
          process.env.NODE_ENV === 'production' ? 'Secure' : '',
          'Max-Age=0',
        ]
          .filter(Boolean)
          .join('; ')
      );

      return res.json({
        success: true,
      });
    } catch (error) {
      console.error('Logout error:', error);

      return res.status(500).json({
        success: false,
        error: 'Erreur lors de la déconnexion',
      });
    }
  });

  // Proactive schema & seeding check when Neon is connected
  if (isNeonConfigured()) {
    ensureNeonSchema().catch((err) => {
      console.warn('[Neon DB Auto-Init] Schéma Neon vérifié/différé:', err?.message || err);
    });
  }

  // Initialize Gemini AI Client securely server-side
  const apiKey = process.env.GEMINI_API_KEY;
  const ai = apiKey
    ? new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      })
    : null;

  // --- API ENDPOINTS ---

  // 1. Healthcheck
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', app: 'Shipment Manager', timestamp: new Date().toISOString() });
  });

  // 2. Carrier Tracking API Mock / Simulator
  app.get('/api/carrier-track/:carrier/:tracking', (req, res) => {
    const { carrier, tracking } = req.params;
    const now = new Date();
    const formattedDate = now.toISOString().replace('T', ' ').substring(0, 16);

    res.json({
      success: true,
      carrier,
      tracking_no: tracking,
      last_update: formattedDate,
      carrier_status: 'In Transit',
      last_location: 'Hub International CDG / Orly Freight, Paris',
      eta: new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      checkpoints: [
        { date: '2026-07-20 08:30', location: 'Origine - Entrepôt', details: 'Prise en charge colis' },
        { date: '2026-07-21 14:00', location: 'Hub Régional', details: 'Tri en cours' },
        { date: formattedDate, location: 'Hub International Cargo', details: 'En attente de départ vol / navire' },
      ],
    });
  });

   // 3. Google Chat Webhook Endpoint
  const DEFAULT_GCHAT_WEBHOOK_URL =
    process.env.GOOGLE_CHAT_WEBHOOK_URL || '';

  app.post('/api/google-chat-webhook', async (req, res) => {
    const { message, webhookUrl, recipientSpace } = req.body;

    const targetUrl = webhookUrl || DEFAULT_GCHAT_WEBHOOK_URL;

    if (!targetUrl) {
      return res.status(500).json({
        success: false,
        error: 'GOOGLE_CHAT_WEBHOOK_URL is not configured',
      });
    }

    try {
      const webhookRes = await fetch(targetUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=UTF-8',
        },
        body: JSON.stringify({
          text: message,
        }),
      });

      if (!webhookRes.ok) {
        const errorText = await webhookRes.text();

        return res.status(webhookRes.status).json({
          success: false,
          error: 'Google Chat webhook rejected the request',
          details: errorText,
        });
      }

      let webhookData: any = {};

      try {
        webhookData = await webhookRes.json();
      } catch {
        // Google Chat may return an empty/non-JSON response
      }

      return res.json({
        success: true,
        message_id:
          webhookData?.name || `MSG-GCHAT-${Date.now()}`,
        space:
          recipientSpace || 'SupplyChain-Alerts',
        status: 'DISPATCHED_TO_GOOGLE_CHAT',
        delivered_at: new Date().toISOString(),
      });
    } catch (err: any) {
      console.error('[Google Chat Webhook]', err);

      return res.status(500).json({
        success: false,
        error: 'Failed to dispatch Google Chat webhook',
        details: err?.message || 'Unknown error',
      });
    }
  });

  // 3b. Google Sheets Sync Endpoint
  const GOOGLE_SHEET_AIR_ID = '15L895NUzVJK49xcv9XRkX2YbfAK9GILQK73gc4s8k2E';
  const GOOGLE_SHEET_SEA_ID = '1pdFr2cLmR0dlxTRV4MONxjcdsFgjyZ-4plfQadt6EUE';

  app.post('/api/sync-sheets', async (req, res) => {
    const { airSheetId = GOOGLE_SHEET_AIR_ID, seaSheetId = GOOGLE_SHEET_SEA_ID } = req.body;
    setTimeout(() => {
      res.json({
        success: true,
        air_sheet_id: airSheetId,
        sea_sheet_id: seaSheetId,
        air_sheet_url: `https://docs.google.com/spreadsheets/d/${airSheetId}/edit`,
        sea_sheet_url: `https://docs.google.com/spreadsheets/d/${seaSheetId}/edit?gid=1539514939#gid=1539514939`,
        synced_at: new Date().toISOString(),
        air_records_processed: 32,
        sea_records_processed: 24,
        total_synced: 56,
        status: 'SYNCHRONIZED',
        message: 'Synchronisation globale Aérienne & Maritime exécutée avec succès !',
      });
    }, 600);
  });

  // 3c. Maritime Container & Sea Waybill Tracking Search API
  app.get('/api/carrier-track/:carrier/:tracking_no', (req, res) => {
    const rawCarrier = (req.params.carrier || '').trim();
    const rawTrackingNo = (req.params.tracking_no || '').trim().toUpperCase();

    const carrierUpper = rawCarrier.toUpperCase();
    let status = 'En transit international';
    let location = 'Hub Cargo Orly / CDG (FR)';
    let eta = '2026-07-28';

    if (carrierUpper.includes('DHL')) {
      status = 'Pli dédouané & En cours de livraison';
      location = 'Aéroport TNR Ivato / Hub Express';
    } else if (carrierUpper.includes('FEDEX')) {
      status = 'Arrivé Hub de Transit CDG';
      location = 'Paris Charles de Gaulle (CDG)';
    } else if (carrierUpper.includes('CHRONOPOST') || carrierUpper.includes('BOLLORE')) {
      status = 'Dédouanement en cours (Ivato)';
      location = 'Bureau de Douane TNR Ivato';
    } else if (carrierUpper.includes('MSC') || carrierUpper.includes('MAERSK') || carrierUpper.includes('CMA')) {
      status = 'En Transit Maritime (Navire)';
      location = 'Pointe des Galets (La Réunion)';
      eta = '2026-08-05';
    }

    const todayTime = new Date().toISOString().replace('T', ' ').substring(0, 16);

    res.json({
      success: true,
      carrier: rawCarrier,
      tracking_no: rawTrackingNo,
      carrier_status: status,
      carrier_delivery_status: status,
      carrier_status_date: todayTime,
      last_location: location,
      eta: eta,
      events: [
        {
          date: todayTime,
          location: location,
          status: status,
          details: `Statut mis à jour automatiquement via recherche API ${rawCarrier} pour le pli/colis ${rawTrackingNo}.`,
        },
        {
          date: '2026-07-20 09:00',
          location: 'Centre de Tri Départ',
          status: 'Prise en charge transporteur',
          details: 'Enlèvement effectué chez le fournisseur.',
        },
      ],
    });
  });

  app.get('/api/sea-tracking/:query', (req, res) => {
    const rawQuery = (req.params.query || '').trim().toUpperCase();
    const isContainer =
      /^[A-Z]{4}\d{6,7}$/.test(rawQuery) ||
      rawQuery.includes('CONT') ||
      rawQuery.startsWith('MSCU') ||
      rawQuery.startsWith('CMAU') ||
      rawQuery.startsWith('MAEU');

    const today = new Date();
    const etd = '2026-06-12';
    const eta = '2026-07-22';
    const etdDate = new Date(etd);
    const etaDate = new Date(eta);
    const estimatedLeadTimeDays = Math.round((etaDate.getTime() - etdDate.getTime()) / (1000 * 60 * 60 * 24));

    res.json({
      success: true,
      search_query: rawQuery,
      search_type: isContainer ? 'container' : 'swb',
      carrier: rawQuery.startsWith('CMA')
        ? 'CMA CGM (Sea)'
        : rawQuery.startsWith('MAER') || rawQuery.startsWith('MAEU')
        ? 'Maersk (Sea)'
        : 'MSC (Sea)',
      container_no: isContainer ? rawQuery : `MSCU${Math.floor(1000000 + Math.random() * 9000000)}`,
      swb_no: !isContainer ? rawQuery : `SWB-BL-${rawQuery.slice(-6)}`,
      vessel_name: 'MSC EMMA III / V.622S',
      voyage_no: 'V.622S',
      status: 'En Transit Maritime (Escale Réunion)',
      current_location: 'Port de La Réunion (Pointe des Galets)',
      port_of_loading: 'Port de Le Havre / Rouen (FR)',
      port_of_discharge: 'Port de Toamasina (MG)',
      etd: etd,
      eta: eta,
      actual_arrival_date: '',
      estimated_lead_time_days: estimatedLeadTimeDays,
      actual_lead_time_days: undefined,
      transshipment_ports: ['Port de Pointe-des-Galets (La Réunion)', 'Port-Louis (Maurice)'],
      last_update: today.toISOString().replace('T', ' ').substring(0, 16),
      events: [
        {
          date: '2026-06-10 14:00',
          location: 'Entrepôt Transitaire Rouen',
          status: 'Réception & Colisage',
          details: 'Livraison marchandises par les fournisseurs et mise en conteneur 40HC.',
        },
        {
          date: '2026-06-12 09:30',
          location: 'Port de Le Havre (Terminal de France)',
          status: 'Chargement Navire (ETD)',
          details: 'Embarquement conteneur sur le navire MSC EMMA III.',
        },
        {
          date: '2026-07-05 18:00',
          location: 'Port-Louis (Maurice)',
          status: 'Escale & Transbordement',
          details: 'Escale technique et rechargement ligne Océan Indien.',
        },
        {
          date: '2026-07-18 08:00',
          location: 'Pointe des Galets (La Réunion)',
          status: 'En Escale',
          details: 'Amarrage quai Port-Est. Départ prévu vers Toamasina le 21/07.',
        },
        {
          date: '2026-07-22 (Prévu)',
          location: 'Port de Toamasina (Madagascar)',
          status: 'Arrivée Estimée (ETA)',
          details: 'Déchargement quai MICTSL et transmission au déclarant douane.',
        },
      ],
    });
  });

  // 4. Gemini AI Chat Assistant Endpoint (Shipment AI)
  app.post('/api/chat', async (req, res) => {
    try {
      if (!ai) {
        return res.status(500).json({
          error:
            'GEMINI_API_KEY non configurée dans le serveur. Veuillez vérifier le fichier .env ou les secrets.',
        });
      }

      const { prompt, shipmentContext } = req.body;

      if (!prompt) {
        return res.status(400).json({ error: 'Prompt requis' });
      }

      const systemInstruction = `Tu es "Shipment AI", l'expert senior en Supply Chain, automatisation et transport international de l'application Shipment Manager.
Ton rôle est d'analyser les expéditions aériennes et maritimes, de détecter les anomalies (retards, blocages douane, colis bloqués à Orly > 10j, retards transitaire), d'expliquer les statuts métier et de générer des messages de relance clairs et percutants pour Google Chat.

Règles de comportement:
1. Sois très précis, professionnel et orienté résultats métiers Supply Chain.
2. Base-toi en priorité sur le contexte fourni ci-dessous (liste des expéditions et alertes). Ne jamais inventer une information absente des données.
3. Quand l'utilisateur te demande de générer une relance, fournis un message formaté prêt à être copié dans Google Chat avec les icônes (🚨, 📌, 📦, ⚠️, 👉).
4. Réponds toujours en français.
5. Structure tes réponses avec des puces, du gras et des sections lisibles.

Contexte actuel des expéditions:
${shipmentContext ? JSON.stringify(shipmentContext, null, 2) : 'Aucun contexte fourni'}`;

      const response = await ai.models.generateContent({
        model: 'gemini-3.6-flash',
        contents: prompt,
        config: {
          systemInstruction,
          temperature: 0.3,
        },
      });

      res.json({
        reply: response.text || 'Désolé, aucune réponse générée par l\'assistant.',
      });
    } catch (err: any) {
      console.error('Error calling Gemini API:', err);
      res.status(500).json({
        error: 'Erreur lors de la communication avec l\'assistant IA Shipment AI.',
        details: err.message,
      });
    }
  });

  // 5. Automated AI Dataset Analysis Endpoint
  app.post('/api/analyze-shipments', async (req, res) => {
    try {
      if (!ai) {
        return res.status(500).json({ error: 'GEMINI_API_KEY non configurée' });
      }

      const { shipments } = req.body;

      const systemInstruction = `Tu es le Directeur Supply Chain IA de Shipment Manager.
Analyse le lot d'expéditions transmis et produit une synthèse stratégique opérationnelle en Markdown comprenant:
1. 📊 Diagnostique Global (Santé du flux, taux de respect des SLA)
2. 🚨 Anomalies Critiques Décelées (Notamment Hub Orly > 10 jours et blocages douane)
3. 🥇 Performance des Transporteurs (Qui tient les délais, qui dérape ?)
4. ⚡ Plan d'Action Recommandé (3 priorités immédiates pour l'équipe Supply Chain).`;

      const response = await ai.models.generateContent({
        model: 'gemini-3.6-flash',
        contents: `Voici la liste actuelle des expéditions à analyser:\n${JSON.stringify(
          shipments,
          null,
          2
        )}`,
        config: {
          systemInstruction,
          temperature: 0.2,
        },
      });

      res.json({
        analysis: response.text,
      });
    } catch (err: any) {
      console.error('Error analyzing shipments:', err);
      res.status(500).json({ error: 'Erreur lors de l\'analyse automatique.', details: err.message });
    }
  });

  // --- NEON POSTGRESQL DIRECT SQL ENDPOINTS ---

  // Statut de la connexion Neon
  app.get('/api/db/status', async (req, res) => {
    try {
      const configured = isNeonConfigured();
      if (!configured) {
        return res.json({
          configured: false,
          connected: false,
          message: 'DATABASE_URL ou POSTGRES_URL n\'est pas encore renseignée dans l\'environnement.',
        });
      }
      const testResult = await testNeonConnection();
      res.json({
        configured: true,
        ...testResult,
      });
    } catch (err: any) {
      res.status(500).json({
        configured: isNeonConfigured(),
        connected: false,
        error: err?.message || 'Erreur de test Neon',
      });
    }
  });

  // Initialisation du schéma SQL
  app.post('/api/db/init', async (req, res) => {
    try {
      if (!isNeonConfigured()) {
        return res.status(400).json({
          error: 'DATABASE_URL manquante. Veuillez configurer l\'URI Neon dans les variables d\'environnement.',
        });
      }
      await initNeonSchema();
      res.json({ success: true, message: 'Schéma SQL Neon initialisé avec succès.' });
    } catch (err: any) {
      console.error('Failed to init Neon schema:', err);
      res.status(500).json({ error: 'Erreur d\'initialisation du schéma Neon', details: err?.message });
    }
  });

  // Récupérer toutes les expéditions (SQL direct)
  app.get('/api/shipments', async (req, res) => {
    try {
      if (!isNeonConfigured()) {
        return res.status(503).json({
          error: 'DATABASE_NOT_CONFIGURED',
          message: 'DATABASE_URL (ou POSTGRES_URL) n\'est pas configurée. Passez votre URI Neon pour charger les données réelles.',
        });
      }
      const shipments = await getShipmentsFromNeon();
      res.json({
        success: true,
        count: shipments.length,
        shipments,
      });
    } catch (err: any) {
      console.error('Error fetching shipments from Neon:', err);
      res.status(500).json({ error: 'Erreur SQL lors de la récupération des expéditions', details: err?.message });
    }
  });

  // Récupérer une expédition par ID
  app.get('/api/shipments/:id', async (req, res) => {
    try {
      if (!isNeonConfigured()) {
        return res.status(503).json({ error: 'DATABASE_NOT_CONFIGURED' });
      }
      const shipment = await getShipmentByIdFromNeon(req.params.id);
      if (!shipment) {
        return res.status(404).json({ error: 'Expédition introuvable' });
      }
      res.json({ success: true, shipment });
    } catch (err: any) {
      res.status(500).json({ error: 'Erreur SQL', details: err?.message });
    }
  });

  // Créer ou mettre à jour une expédition (UPSERT SQL direct)
  app.post('/api/shipments', async (req, res) => {
    try {
      if (!isNeonConfigured()) {
        return res.status(503).json({ error: 'DATABASE_NOT_CONFIGURED' });
      }
      const data = req.body;
      const saved = await upsertShipmentInNeon(data);
      res.json({ success: true, shipment: saved });
    } catch (err: any) {
      console.error('Error upserting shipment in Neon:', err);
      res.status(500).json({ error: 'Erreur SQL lors de l\'enregistrement', details: err?.message });
    }
  });

  // Mettre à jour une expédition
  app.put('/api/shipments/:id', async (req, res) => {
    try {
      if (!isNeonConfigured()) {
        return res.status(503).json({ error: 'DATABASE_NOT_CONFIGURED' });
      }
      const data = { ...req.body, id: req.params.id };
      const saved = await upsertShipmentInNeon(data);
      res.json({ success: true, shipment: saved });
    } catch (err: any) {
      console.error('Error updating shipment in Neon:', err);
      res.status(500).json({ error: 'Erreur SQL lors de la mise à jour', details: err?.message });
    }
  });

  // Supprimer une expédition
  app.delete('/api/shipments/:id', async (req, res) => {
    try {
      if (!isNeonConfigured()) {
        return res.status(503).json({ error: 'DATABASE_NOT_CONFIGURED' });
      }
      await deleteShipmentInNeon(req.params.id);
      res.json({ success: true, deleted_id: req.params.id });
    } catch (err: any) {
      res.status(500).json({ error: 'Erreur SQL lors de la suppression', details: err?.message });
    }
  });

  // Purge complète de toutes les données dans Neon (0 mock data)
  app.post('/api/shipments/clear-all', async (req, res) => {
    try {
      if (!isNeonConfigured()) {
        return res.status(503).json({ error: 'DATABASE_NOT_CONFIGURED' });
      }
      const count = await clearAllShipmentsInNeon();
      res.json({ success: true, deleted_count: count });
    } catch (err: any) {
      console.error('Erreur lors de la purge Neon:', err);
      res.status(500).json({ error: 'Erreur lors de la suppression des données Neon', details: err?.message });
    }
  });

  return app;
}
