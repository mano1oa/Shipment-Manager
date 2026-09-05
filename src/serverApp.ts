import express, { Express } from 'express';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';

import { updateActiveTracking } from './services/tracking/updateTrackingJob';

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
} from './db/index.js';

import {
  createUser,
  findUserByEmail,
  verifyUserPassword,
  updateLastLogin,
  listUsers,
  updateUserRole,
  updateUserStatus,
} from './db/users.js';

import {
  createSession,
  getSessionUser,
  deleteSession,
} from './db/sessions.js';

dotenv.config();

/**
 * Read a cookie value from the request.
 */
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

/**
 * Authentication middleware.
 */
async function requireAuth(req: any, res: any, next: any) {
  try {
    const token = getCookie(req, 'shipment_session');

    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
      });
    }

    const sessionUser = await getSessionUser(token);

    if (!sessionUser) {
      return res.status(401).json({
        success: false,
        error: 'Invalid or expired session',
      });
    }

    req.user = {
      id: sessionUser.id,
      email: sessionUser.email,
      display_name: sessionUser.display_name,
      role: sessionUser.role,
    };

    return next();
  } catch (error) {
    console.error('[Auth] Authentication middleware error:', error);

    return res.status(500).json({
      success: false,
      error: 'Authentication check failed',
    });
  }
}

/**
 * Role middleware.
 */
function requireRole(...allowedRoles: string[]) {
  return (req: any, res: any, next: any) => {
    const userRole = req.user?.role;

    if (!userRole) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
      });
    }

    if (!allowedRoles.includes(userRole)) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden',
      });
    }

    return next();
  };
}

export function createServerApp(): Express {
  const app = express();

  app.use(express.json({ limit: '10mb' }));

  /**
   * Neon schema initialization.
   */
  if (isNeonConfigured()) {
    ensureNeonSchema().catch((err) => {
      console.warn(
        '[Neon DB Auto-Init] Schéma Neon vérifié/différé:',
        err?.message || err
      );
    });
  }

  /**
   * Gemini client.
   */
  const geminiApiKey = process.env.GEMINI_API_KEY;

  const ai = geminiApiKey
    ? new GoogleGenAI({
        apiKey: geminiApiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      })
    : null;

  // =========================================================
  // PUBLIC ROUTES
  // =========================================================

  /**
   * Healthcheck.
   */
  app.get('/api/health', (_req, res) => {
    return res.json({
      status: 'ok',
      app: 'Shipment Manager',
      timestamp: new Date().toISOString(),
    });
  });

  // =========================================================
  // AUTHENTICATION
  // =========================================================

  /**
   * Login.
   */
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
    } catch (error) {
      console.error('[Auth] Login error:', error);

      return res.status(500).json({
        success: false,
        error: 'Erreur lors de la connexion',
      });
    }
  });

  /**
   * Current logged-in user.
   */
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
      console.error('[Auth] Auth me error:', error);

      return res.status(500).json({
        authenticated: false,
        error: 'Erreur de session',
      });
    }
  });

  /**
   * Logout.
   */
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
      console.error('[Auth] Logout error:', error);

      return res.status(500).json({
        success: false,
        error: 'Erreur lors de la déconnexion',
      });
    }
  });

  // =========================================================
  // VERCEL CRON
  // IMPORTANT:
  // Must stay BEFORE app.use('/api', requireAuth)
  // because Vercel Cron uses CRON_SECRET instead of user cookies.
  // =========================================================

  app.get('/api/cron/update-tracking', async (req, res) => {
    try {
      const authHeader = req.headers.authorization;

      if (
        !process.env.CRON_SECRET ||
        authHeader !== `Bearer ${process.env.CRON_SECRET}`
      ) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized',
        });
      }

      const startedAt = Date.now();

      const result = await updateActiveTracking();

      return res.json({
        success: true,
        duration_ms: Date.now() - startedAt,
        ...result,
      });
    } catch (error: any) {
      console.error('[Tracking Cron]', error);

      return res.status(500).json({
        success: false,
        error: error?.message || 'Tracking cron failed',
      });
    }
  });

  // =========================================================
  // ALL ROUTES BELOW REQUIRE AUTHENTICATION
  // =========================================================

  app.use('/api', requireAuth);

  // =========================================================
  // ADMIN USERS
  // =========================================================

  /**
   * List users.
   */
  app.get(
    '/api/admin/users',
    requireRole('SUPPLY_CHAIN'),
    async (_req, res) => {
      try {
        const users = await listUsers();

        return res.json({
          success: true,
          users,
        });
      } catch (error) {
        console.error('[Admin] List users error:', error);

        return res.status(500).json({
          success: false,
          error: 'Unable to load users',
        });
      }
    }
  );

  /**
   * Create user.
   */
  app.post(
    '/api/admin/users',
    requireRole('SUPPLY_CHAIN'),
    async (req, res) => {
      try {
        const {
          email,
          password,
          displayName,
          role,
        } = req.body || {};

        if (!email || !password || !displayName || !role) {
          return res.status(400).json({
            success: false,
            error: 'Missing required fields',
          });
        }

        const allowedRoles = [
          'SUPPLY_CHAIN',
          'SOURCING',
          'DIRECTION',
        ];

        if (!allowedRoles.includes(role)) {
          return res.status(400).json({
            success: false,
            error: 'Invalid role',
          });
        }

        if (password.length < 12) {
          return res.status(400).json({
            success: false,
            error: 'Password must contain at least 12 characters',
          });
        }

        const existingUser = await findUserByEmail(email);

        if (existingUser) {
          return res.status(409).json({
            success: false,
            error: 'A user with this email already exists',
          });
        }

        const user = await createUser({
          email,
          password,
          displayName,
          role,
        });

        return res.status(201).json({
          success: true,
          user,
        });
      } catch (error) {
        console.error('[Admin] Create user error:', error);

        return res.status(500).json({
          success: false,
          error: 'Unable to create user',
        });
      }
    }
  );

  /**
   * Update user role.
   */
  app.put(
    '/api/admin/users/:id/role',
    requireRole('SUPPLY_CHAIN'),
    async (req, res) => {
      try {
        const { role } = req.body || {};

        const allowedRoles = [
          'SUPPLY_CHAIN',
          'SOURCING',
          'DIRECTION',
        ];

        if (!allowedRoles.includes(role)) {
          return res.status(400).json({
            success: false,
            error: 'Invalid role',
          });
        }

        const user = await updateUserRole(
          req.params.id,
          role
        );

        if (!user) {
          return res.status(404).json({
            success: false,
            error: 'User not found',
          });
        }

        return res.json({
          success: true,
          user,
        });
      } catch (error) {
        console.error('[Admin] Update user role error:', error);

        return res.status(500).json({
          success: false,
          error: 'Unable to update user role',
        });
      }
    }
  );

  /**
   * Activate/deactivate user.
   */
  app.put(
    '/api/admin/users/:id/status',
    requireRole('SUPPLY_CHAIN'),
    async (req, res) => {
      try {
        const { isActive } = req.body || {};

        if (typeof isActive !== 'boolean') {
          return res.status(400).json({
            success: false,
            error: 'isActive must be a boolean',
          });
        }

        const user = await updateUserStatus(
          req.params.id,
          isActive
        );

        if (!user) {
          return res.status(404).json({
            success: false,
            error: 'User not found',
          });
        }

        return res.json({
          success: true,
          user,
        });
      } catch (error) {
        console.error('[Admin] Update user status error:', error);

        return res.status(500).json({
          success: false,
          error: 'Unable to update user status',
        });
      }
    }
  );

  // =========================================================
  // CARRIER TRACKING MOCK
  // =========================================================

  app.get(
    '/api/carrier-track/:carrier/:tracking',
    (req, res) => {
      const { carrier, tracking } = req.params;

      const now = new Date();

      const formattedDate = now
        .toISOString()
        .replace('T', ' ')
        .substring(0, 16);

      return res.json({
        success: true,
        carrier,
        tracking_no: tracking,
        last_update: formattedDate,
        carrier_status: 'In Transit',
        last_location:
          'Hub International CDG / Orly Freight, Paris',
        eta: new Date(
          now.getTime() +
            3 * 24 * 60 * 60 * 1000
        )
          .toISOString()
          .split('T')[0],
        checkpoints: [
          {
            date: '2026-07-20 08:30',
            location: 'Origine - Entrepôt',
            details: 'Prise en charge colis',
          },
          {
            date: '2026-07-21 14:00',
            location: 'Hub Régional',
            details: 'Tri en cours',
          },
          {
            date: formattedDate,
            location: 'Hub International Cargo',
            details:
              'En attente de départ vol / navire',
          },
        ],
      });
    }
  );

  // =========================================================
  // GOOGLE CHAT
  // =========================================================

  const GOOGLE_CHAT_WEBHOOK_URL =
    process.env.GOOGLE_CHAT_WEBHOOK_URL || '';

  app.post(
    '/api/google-chat-webhook',
    requireRole('SUPPLY_CHAIN', 'SOURCING'),
    async (req, res) => {
      const { message, recipientSpace } = req.body || {};

      if (!message) {
        return res.status(400).json({
          success: false,
          error: 'Message is required',
        });
      }

      if (!GOOGLE_CHAT_WEBHOOK_URL) {
        return res.status(500).json({
          success: false,
          error:
            'GOOGLE_CHAT_WEBHOOK_URL is not configured',
        });
      }

      try {
        const webhookRes = await fetch(
          GOOGLE_CHAT_WEBHOOK_URL,
          {
            method: 'POST',
            headers: {
              'Content-Type':
                'application/json; charset=UTF-8',
            },
            body: JSON.stringify({
              text: message,
            }),
          }
        );

        if (!webhookRes.ok) {
          const errorText = await webhookRes.text();

          return res.status(webhookRes.status).json({
            success: false,
            error:
              'Google Chat webhook rejected the request',
            details: errorText,
          });
        }

        let webhookData: any = {};

        try {
          webhookData = await webhookRes.json();
        } catch {
          // Google Chat can return an empty response.
        }

        return res.json({
          success: true,
          message_id:
            webhookData?.name ||
            `MSG-GCHAT-${Date.now()}`,
          space:
            recipientSpace ||
            'SupplyChain-Alerts',
          status:
            'DISPATCHED_TO_GOOGLE_CHAT',
          delivered_at:
            new Date().toISOString(),
        });
      } catch (error: any) {
        console.error(
          '[Google Chat Webhook]',
          error
        );

        return res.status(500).json({
          success: false,
          error:
            'Failed to dispatch Google Chat webhook',
          details:
            error?.message ||
            'Unknown error',
        });
      }
    }
  );

  // =========================================================
  // GOOGLE SHEETS MOCK
  // =========================================================

  const GOOGLE_SHEET_AIR_ID =
    '15L895NUzVJK49xcv9XRkX2YbfAK9GILQK73gc4s8k2E';

  const GOOGLE_SHEET_SEA_ID =
    '1pdFr2cLmR0dlxTRV4MONxjcdsFgjyZ-4plfQadt6EUE';

  app.post(
    '/api/sync-sheets',
    requireRole('SUPPLY_CHAIN', 'SOURCING'),
    async (req, res) => {
      const {
        airSheetId = GOOGLE_SHEET_AIR_ID,
        seaSheetId = GOOGLE_SHEET_SEA_ID,
      } = req.body || {};

      setTimeout(() => {
        return res.json({
          success: true,
          air_sheet_id: airSheetId,
          sea_sheet_id: seaSheetId,
          air_sheet_url:
            `https://docs.google.com/spreadsheets/d/${airSheetId}/edit`,
          sea_sheet_url:
            `https://docs.google.com/spreadsheets/d/${seaSheetId}/edit?gid=1539514939#gid=1539514939`,
          synced_at:
            new Date().toISOString(),
          air_records_processed: 32,
          sea_records_processed: 24,
          total_synced: 56,
          status: 'SYNCHRONIZED',
          message:
            'Synchronisation globale Aérienne & Maritime exécutée avec succès !',
        });
      }, 600);
    }
  );

  // =========================================================
  // SEA TRACKING MOCK
  // =========================================================

  app.get(
    '/api/sea-tracking/:query',
    (req, res) => {
      const rawQuery =
        (req.params.query || '')
          .trim()
          .toUpperCase();

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

      const estimatedLeadTimeDays = Math.round(
        (etaDate.getTime() -
          etdDate.getTime()) /
          (1000 * 60 * 60 * 24)
      );

      return res.json({
        success: true,

        search_query: rawQuery,

        search_type:
          isContainer
            ? 'container'
            : 'swb',

        carrier:
          rawQuery.startsWith('CMA')
            ? 'CMA CGM (Sea)'
            : rawQuery.startsWith('MAER') ||
              rawQuery.startsWith('MAEU')
            ? 'Maersk (Sea)'
            : 'MSC (Sea)',

        container_no:
          isContainer
            ? rawQuery
            : `MSCU${Math.floor(
                1000000 +
                  Math.random() *
                    9000000
              )}`,

        swb_no:
          !isContainer
            ? rawQuery
            : `SWB-BL-${rawQuery.slice(-6)}`,

        vessel_name:
          'MSC EMMA III / V.622S',

        voyage_no:
          'V.622S',

        status:
          'En Transit Maritime (Escale Réunion)',

        current_location:
          'Port de La Réunion (Pointe des Galets)',

        port_of_loading:
          'Port de Le Havre / Rouen (FR)',

        port_of_discharge:
          'Port de Toamasina (MG)',

        etd,
        eta,

        actual_arrival_date: '',

        estimated_lead_time_days:
          estimatedLeadTimeDays,

        transshipment_ports: [
          'Port de Pointe-des-Galets (La Réunion)',
          'Port-Louis (Maurice)',
        ],

        last_update:
          today
            .toISOString()
            .replace('T', ' ')
            .substring(0, 16),

        events: [
          {
            date: '2026-06-10 14:00',
            location:
              'Entrepôt Transitaire Rouen',
            status:
              'Réception & Colisage',
            details:
              'Livraison marchandises par les fournisseurs et mise en conteneur 40HC.',
          },
          {
            date: '2026-06-12 09:30',
            location:
              'Port de Le Havre (Terminal de France)',
            status:
              'Chargement Navire (ETD)',
            details:
              'Embarquement conteneur sur le navire MSC EMMA III.',
          },
          {
            date: '2026-07-05 18:00',
            location:
              'Port-Louis (Maurice)',
            status:
              'Escale & Transbordement',
            details:
              'Escale technique et rechargement ligne Océan Indien.',
          },
          {
            date: '2026-07-18 08:00',
            location:
              'Pointe des Galets (La Réunion)',
            status: 'En Escale',
            details:
              'Amarrage quai Port-Est. Départ prévu vers Toamasina le 21/07.',
          },
          {
            date:
              '2026-07-22 (Prévu)',
            location:
              'Port de Toamasina (Madagascar)',
            status:
              'Arrivée Estimée (ETA)',
            details:
              'Déchargement quai MICTSL et transmission au déclarant douane.',
          },
        ],
      });
    }
  );

  // =========================================================
  // GEMINI CHAT
  // =========================================================

  app.post('/api/chat', async (req, res) => {
    try {
      if (!ai) {
        return res.status(500).json({
          error:
            'GEMINI_API_KEY non configurée dans le serveur.',
        });
      }

      const {
        prompt,
        shipmentContext,
      } = req.body || {};

      if (!prompt) {
        return res.status(400).json({
          error: 'Prompt requis',
        });
      }

      const systemInstruction = `
Tu es "Shipment AI", l'expert senior en Supply Chain, automatisation et transport international de l'application Shipment Manager.

Ton rôle est d'analyser les expéditions aériennes et maritimes, de détecter les anomalies (retards, blocages douane, colis bloqués à Orly > 10j, retards transitaire), d'expliquer les statuts métier et de générer des messages de relance clairs pour Google Chat.

Règles:
1. Sois précis, professionnel et orienté résultats Supply Chain.
2. Base-toi en priorité sur le contexte fourni.
3. Ne jamais inventer une information absente des données.
4. Réponds toujours en français.
5. Structure les réponses clairement.

Contexte actuel des expéditions:
${
  shipmentContext
    ? JSON.stringify(
        shipmentContext,
        null,
        2
      )
    : 'Aucun contexte fourni'
}
`;

      const response =
        await ai.models.generateContent({
          model: 'gemini-3.6-flash',
          contents: prompt,
          config: {
            systemInstruction,
            temperature: 0.3,
          },
        });

      return res.json({
        reply:
          response.text ||
          'Aucune réponse générée.',
      });
    } catch (error: any) {
      console.error(
        '[Gemini Chat]',
        error
      );

      return res.status(500).json({
        error:
          'Erreur lors de la communication avec Shipment AI.',
        details:
          error?.message,
      });
    }
  });

  // =========================================================
  // GEMINI ANALYSIS
  // =========================================================

  app.post(
    '/api/analyze-shipments',
    async (req, res) => {
      try {
        if (!ai) {
          return res.status(500).json({
            error:
              'GEMINI_API_KEY non configurée',
          });
        }

        const { shipments } =
          req.body || {};

        if (!Array.isArray(shipments)) {
          return res.status(400).json({
            success: false,
            error:
              'shipments must be an array',
          });
        }

        const systemInstruction = `
Tu es le Directeur Supply Chain IA de Shipment Manager.

Analyse le lot d'expéditions transmis et produit une synthèse stratégique opérationnelle en Markdown comprenant:

1. Diagnostique Global
2. Anomalies Critiques Décelées
3. Performance des Transporteurs
4. Plan d'Action Recommandé
`;

        const response =
          await ai.models.generateContent({
            model:
              'gemini-3.6-flash',
            contents:
              `Voici la liste actuelle des expéditions à analyser:\n${JSON.stringify(
                shipments,
                null,
                2
              )}`,
            config: {
              systemInstruction,
              temperature: 0.2,
            },
          });

        return res.json({
          analysis:
            response.text,
        });
      } catch (error: any) {
        console.error(
          '[Gemini Analysis]',
          error
        );

        return res.status(500).json({
          error:
            'Erreur lors de l\'analyse automatique.',
          details:
            error?.message,
        });
      }
    }
  );

  // =========================================================
  // NEON DATABASE
  // =========================================================

  /**
   * Database status.
   */
  app.get('/api/db/status', async (_req, res) => {
    try {
      const configured =
        isNeonConfigured();

      if (!configured) {
        return res.json({
          configured: false,
          connected: false,
          message:
            'DATABASE_URL ou POSTGRES_URL non configurée.',
        });
      }

      const testResult =
        await testNeonConnection();

      return res.json({
        configured: true,
        ...testResult,
      });
    } catch (error: any) {
      return res.status(500).json({
        configured:
          isNeonConfigured(),
        connected: false,
        error:
          error?.message ||
          'Erreur de test Neon',
      });
    }
  });

  /**
   * Initialize Neon schema.
   */
  app.post(
    '/api/db/init',
    requireRole('SUPPLY_CHAIN'),
    async (_req, res) => {
      try {
        if (!isNeonConfigured()) {
          return res.status(400).json({
            error:
              'DATABASE_URL manquante.',
          });
        }

        await initNeonSchema();

        return res.json({
          success: true,
          message:
            'Schéma SQL Neon initialisé avec succès.',
        });
      } catch (error: any) {
        console.error(
          '[Neon Init]',
          error
        );

        return res.status(500).json({
          error:
            'Erreur d\'initialisation du schéma Neon',
          details:
            error?.message,
        });
      }
    }
  );

  // =========================================================
  // SHIPMENTS
  // =========================================================

  /**
   * List shipments.
   */
  app.get(
    '/api/shipments',
    async (_req, res) => {
      try {
        if (!isNeonConfigured()) {
          return res.status(503).json({
            error:
              'DATABASE_NOT_CONFIGURED',
          });
        }

        const shipments =
          await getShipmentsFromNeon();

        return res.json({
          success: true,
          count:
            shipments.length,
          shipments,
        });
      } catch (error: any) {
        console.error(
          '[Shipments] Fetch error:',
          error
        );

        return res.status(500).json({
          error:
            'Erreur SQL lors de la récupération des expéditions',
          details:
            error?.message,
        });
      }
    }
  );

  /**
   * Get shipment by ID.
   */
  app.get(
    '/api/shipments/:id',
    async (req, res) => {
      try {
        if (!isNeonConfigured()) {
          return res.status(503).json({
            error:
              'DATABASE_NOT_CONFIGURED',
          });
        }

        const shipment =
          await getShipmentByIdFromNeon(
            req.params.id
          );

        if (!shipment) {
          return res.status(404).json({
            error:
              'Expédition introuvable',
          });
        }

        return res.json({
          success: true,
          shipment,
        });
      } catch (error: any) {
        return res.status(500).json({
          error: 'Erreur SQL',
          details:
            error?.message,
        });
      }
    }
  );

  /**
   * Create shipment.
   */
  app.post(
    '/api/shipments',
    requireRole('SUPPLY_CHAIN', 'SOURCING'),
    async (req, res) => {
      try {
        if (!isNeonConfigured()) {
          return res.status(503).json({
            error:
              'DATABASE_NOT_CONFIGURED',
          });
        }

        const saved =
          await upsertShipmentInNeon(
            req.body
          );

        return res.json({
          success: true,
          shipment:
            saved,
        });
      } catch (error: any) {
        console.error(
          '[Shipments] Create error:',
          error
        );

        return res.status(500).json({
          error:
            'Erreur SQL lors de l\'enregistrement',
          details:
            error?.message,
        });
      }
    }
  );

  /**
   * Update shipment.
   */
  app.put(
    '/api/shipments/:id',
    requireRole('SUPPLY_CHAIN', 'SOURCING'),
    async (req, res) => {
      try {
        if (!isNeonConfigured()) {
          return res.status(503).json({
            error:
              'DATABASE_NOT_CONFIGURED',
          });
        }

        const data = {
          ...req.body,
          id: req.params.id,
        };

        const saved =
          await upsertShipmentInNeon(
            data
          );

        return res.json({
          success: true,
          shipment:
            saved,
        });
      } catch (error: any) {
        console.error(
          '[Shipments] Update error:',
          error
        );

        return res.status(500).json({
          error:
            'Erreur SQL lors de la mise à jour',
          details:
            error?.message,
        });
      }
    }
  );

  /**
   * Delete shipment.
   */
  app.delete(
    '/api/shipments/:id',
    requireRole('SUPPLY_CHAIN'),
    async (req, res) => {
      try {
        if (!isNeonConfigured()) {
          return res.status(503).json({
            error:
              'DATABASE_NOT_CONFIGURED',
          });
        }

        await deleteShipmentInNeon(
          req.params.id
        );

        return res.json({
          success: true,
          deleted_id:
            req.params.id,
        });
      } catch (error: any) {
        console.error(
          '[Shipments] Delete error:',
          error
        );

        return res.status(500).json({
          error:
            'Erreur SQL lors de la suppression',
          details:
            error?.message,
        });
      }
    }
  );

  /**
   * Clear all shipments.
   *
   * SUPPLY_CHAIN ONLY.
   */
  app.post(
    '/api/shipments/clear-all',
    requireRole('SUPPLY_CHAIN'),
    async (_req, res) => {
      try {
        if (!isNeonConfigured()) {
          return res.status(503).json({
            error:
              'DATABASE_NOT_CONFIGURED',
          });
        }

        const count =
          await clearAllShipmentsInNeon();

        return res.json({
          success: true,
          deleted_count:
            count,
        });
      } catch (error: any) {
        console.error(
          '[Shipments] Clear all error:',
          error
        );

        return res.status(500).json({
          error:
            'Erreur lors de la suppression des données Neon',
          details:
            error?.message,
        });
      }
    }
  );

  return app;
}