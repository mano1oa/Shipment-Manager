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

import {
  getActiveCarriers,
  createCarrier,
  DuplicateReferenceError,
  CARRIER_TRANSPORT_MODES,
  CARRIER_NAME_MAX_LENGTH,
} from './db/carriers.js';

import {
  getActiveSuppliers,
  createSupplier,
  DuplicateSupplierError,
  SUPPLIER_NAME_MAX_LENGTH,
} from './db/suppliers.js';

import { writeAuditLog } from './db/audit.js';

import {
  listResolvedAlerts,
  resolveAlert,
  unresolveAlert,
} from './db/alerts.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALERT_ID_RE = /^[A-Za-z0-9_-]{1,100}$/;

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

    next();
  } catch (error) {
    console.error('Authentication middleware error:', error);

    return res.status(500).json({
      success: false,
      error: 'Authentication check failed',
    });
  }
}

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

    next();
  };
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

      await writeAuditLog({
        entityType: 'USER',
        entityId: user.id,
        action: 'LOGIN',
        actor: { id: user.id, email: user.email, role: user.role },
      });

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

      const errorMessage = error?.message || '';
      if (
        errorMessage.includes('password authentication failed') ||
        errorMessage.includes('authentication failed') ||
        errorMessage.includes('NeonDbError')
      ) {
        return res.status(503).json({
          success: false,
          error:
            'Impossible de se connecter à la base de données Neon : identifiants PostgreSQL incorrects ou expirés. Veuillez vérifier DATABASE_URL dans les paramètres.',
        });
      }

      return res.status(500).json({
        success: false,
        error: error?.message || 'Erreur lors de la connexion',
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
    } catch (error: any) {
      console.error('Auth me error:', error);

      return res.status(500).json({
        authenticated: false,
        error: error?.message || 'Erreur de session',
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

  // Healthcheck public
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', app: 'Shipment Manager', timestamp: new Date().toISOString() });
  });

    app.use('/api', requireAuth);

    // Liste des utilisateurs (accessible uniquement aux rôles SUPPLY_CHAIN)
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
      console.error('List users error:', error);

      return res.status(500).json({
        success: false,
        error: 'Unable to load users',
      });
    }
  }
);

// Créer un utilisateur 
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

      await writeAuditLog({
        entityType: 'USER',
        entityId: user.id,
        action: 'CREATE_USER',
        actor: (req as any).user,
        details: { email: user.email, role: user.role },
      });

      return res.status(201).json({
        success: true,
        user,
      });
    } catch (error) {
      console.error('Create user error:', error);

      return res.status(500).json({
        success: false,
        error: 'Unable to create user',
      });
    }
  }
);

// Modifier le rôle 

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

      const actor = (req as any).user;

      if (!UUID_RE.test(req.params.id)) {
        return res.status(404).json({
          success: false,
          error: 'User not found',
        });
      }

      if (req.params.id === actor.id && role !== 'SUPPLY_CHAIN') {
        return res.status(400).json({
          success: false,
          error: 'Vous ne pouvez pas retirer votre propre rôle Supply Chain.',
        });
      }

      const result = await updateUserRole(
        req.params.id,
        role
      );

      if (!result.ok) {
        if (result.reason === 'NOT_FOUND') {
          return res.status(404).json({
            success: false,
            error: 'User not found',
          });
        }
        return res.status(409).json({
          success: false,
          error: 'Impossible : il doit rester au moins un compte Supply Chain actif.',
        });
      }

      if (result.previous.role !== result.user.role) {
        await writeAuditLog({
          entityType: 'USER',
          entityId: result.user.id,
          action: 'UPDATE_ROLE',
          actor,
          details: {
            email: result.user.email,
            from: result.previous.role,
            to: result.user.role,
          },
        });
      }

      return res.json({
        success: true,
        user: result.user,
      });
    } catch (error) {
      console.error('Update user role error:', error);

      return res.status(500).json({
        success: false,
        error: 'Unable to update user role',
      });
    }
  }
);

// Activier ou désactiver un rôle

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

      const actor = (req as any).user;

      if (!UUID_RE.test(req.params.id)) {
        return res.status(404).json({
          success: false,
          error: 'User not found',
        });
      }

      if (req.params.id === actor.id && !isActive) {
        return res.status(400).json({
          success: false,
          error: 'Vous ne pouvez pas désactiver votre propre compte.',
        });
      }

      const result = await updateUserStatus(
        req.params.id,
        isActive
      );

      if (!result.ok) {
        if (result.reason === 'NOT_FOUND') {
          return res.status(404).json({
            success: false,
            error: 'User not found',
          });
        }
        return res.status(409).json({
          success: false,
          error: 'Impossible : il doit rester au moins un compte Supply Chain actif.',
        });
      }

      if (result.previous.is_active !== result.user.is_active) {
        await writeAuditLog({
          entityType: 'USER',
          entityId: result.user.id,
          action: isActive ? 'ENABLE_USER' : 'DISABLE_USER',
          actor,
          details: { email: result.user.email },
        });
      }

      return res.json({
        success: true,
        user: result.user,
      });
    } catch (error) {
      console.error('Update user status error:', error);

      return res.status(500).json({
        success: false,
        error: 'Unable to update user status',
      });
    }
  }
);
    
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

  // 3. Google Chat Webhook Endpoint
  // The destination is ALWAYS the server-side GOOGLE_CHAT_WEBHOOK_URL.
  // A client-supplied URL is never accepted (prevents SSRF).
  app.post(
    '/api/google-chat-webhook',
    requireRole('SUPPLY_CHAIN', 'SOURCING'),
    async (req, res) => {
      const { message } = req.body || {};
      const targetUrl = process.env.GOOGLE_CHAT_WEBHOOK_URL || '';

      if (!targetUrl) {
        return res.status(500).json({
          success: false,
          error: 'GOOGLE_CHAT_WEBHOOK_URL is not configured',
        });
      }

      if (typeof message !== 'string' || !message.trim()) {
        return res.status(400).json({
          success: false,
          error: 'Message is required',
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
          console.error(
            '[Google Chat Webhook] Rejected:',
            webhookRes.status,
            errorText
          );

          return res.status(502).json({
            success: false,
            error: 'Google Chat webhook rejected the request',
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
          message_id: webhookData?.name || null,
          status: 'DISPATCHED_TO_GOOGLE_CHAT',
          delivered_at: new Date().toISOString(),
        });
      } catch (err: any) {
        console.error('[Google Chat Webhook]', err);

        return res.status(500).json({
          success: false,
          error: 'Failed to dispatch Google Chat webhook',
        });
      }
    }
  );

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

  // --- RESOLVED ALERTS (shared, persisted in Neon) ---
  // Reads: any authenticated user. Resolve/reopen: SUPPLY_CHAIN + SOURCING.

  app.get('/api/alerts/resolved', async (_req, res) => {
    try {
      const resolved = await listResolvedAlerts();
      return res.json({ success: true, resolved });
    } catch (err: any) {
      console.error('[Alerts] List resolved error:', err);
      return res.status(500).json({ success: false, error: 'Unable to load resolved alerts' });
    }
  });

  app.post(
    '/api/alerts/:alertId/resolve',
    requireRole('SUPPLY_CHAIN', 'SOURCING'),
    async (req: any, res) => {
      const { alertId } = req.params;
      if (!ALERT_ID_RE.test(alertId)) {
        return res.status(400).json({ success: false, error: 'Invalid alert id' });
      }

      const body = req.body || {};
      const shipmentId =
        typeof body.shipment_id === 'string' && body.shipment_id.trim()
          ? body.shipment_id.trim().slice(0, 50)
          : null;
      const ruleCode =
        typeof body.rule_code === 'string' && body.rule_code.trim()
          ? body.rule_code.trim().slice(0, 50)
          : null;
      const note =
        typeof body.note === 'string' && body.note.trim()
          ? body.note.trim().slice(0, 2000)
          : null;

      try {
        const { record, created } = await resolveAlert({
          alertId,
          shipmentId,
          ruleCode,
          user: req.user,
          note,
        });

        if (created) {
          await writeAuditLog({
            entityType: 'ALERT',
            entityId: alertId,
            action: 'RESOLVE_ALERT',
            actor: req.user,
            details: { shipment_id: shipmentId, rule_code: ruleCode, note },
          });
        }

        return res.json({ success: true, resolved: record, already_resolved: !created });
      } catch (err: any) {
        console.error('[Alerts] Resolve error:', err);
        return res.status(500).json({ success: false, error: 'Unable to resolve alert' });
      }
    }
  );

  app.delete(
    '/api/alerts/:alertId/resolve',
    requireRole('SUPPLY_CHAIN', 'SOURCING'),
    async (req: any, res) => {
      const { alertId } = req.params;
      if (!ALERT_ID_RE.test(alertId)) {
        return res.status(400).json({ success: false, error: 'Invalid alert id' });
      }

      try {
        const removed = await unresolveAlert(alertId);

        if (removed) {
          await writeAuditLog({
            entityType: 'ALERT',
            entityId: alertId,
            action: 'UNRESOLVE_ALERT',
            actor: req.user,
            details: {
              shipment_id: removed.shipment_id,
              rule_code: removed.rule_code,
              previously_resolved_by: removed.resolved_by_email,
              previously_resolved_at: removed.resolved_at,
            },
          });
        }

        return res.json({ success: true, reopened: Boolean(removed) });
      } catch (err: any) {
        console.error('[Alerts] Unresolve error:', err);
        return res.status(500).json({ success: false, error: 'Unable to reopen alert' });
      }
    }
  );

  // --- REFERENCE DATA: carriers & suppliers (source of truth: Neon) ---
  // Reads: any authenticated user. Creation: SUPPLY_CHAIN + SOURCING.
  // Selected names are still written as text into shipments.carrier / .supplier.

  app.get('/api/reference/carriers', async (_req, res) => {
    try {
      const carriers = await getActiveCarriers();
      return res.json({ success: true, carriers });
    } catch (err: any) {
      console.error('[Reference] List carriers error:', err);
      return res.status(500).json({ success: false, error: 'Unable to load carriers' });
    }
  });

  app.post(
    '/api/reference/carriers',
    requireRole('SUPPLY_CHAIN', 'SOURCING'),
    async (req: any, res) => {
      const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
      const transportMode = req.body?.transport_mode;

      if (!name) {
        return res.status(400).json({ success: false, error: 'Le nom du transporteur est obligatoire.' });
      }
      if (name.length > CARRIER_NAME_MAX_LENGTH) {
        return res.status(400).json({
          success: false,
          error: `Le nom du transporteur ne doit pas dépasser ${CARRIER_NAME_MAX_LENGTH} caractères.`,
        });
      }
      if (!CARRIER_TRANSPORT_MODES.includes(transportMode)) {
        return res.status(400).json({
          success: false,
          error: 'Le mode du transporteur est obligatoire (Air, Sea ou BOTH).',
        });
      }

      try {
        const carrier = await createCarrier(name, transportMode);

        await writeAuditLog({
          entityType: 'CARRIER',
          entityId: carrier.id,
          action: 'CREATE_CARRIER',
          actor: req.user,
          details: { name: carrier.name, transport_mode: carrier.transport_mode },
        });

        return res.status(201).json({ success: true, carrier });
      } catch (err: any) {
        if (err instanceof DuplicateReferenceError) {
          return res.status(409).json({
            success: false,
            error: `Le transporteur « ${err.existing.name} » existe déjà.`,
            existing: err.existing,
          });
        }
        console.error('[Reference] Create carrier error:', err);
        return res.status(500).json({ success: false, error: 'Unable to create carrier' });
      }
    }
  );

  app.get('/api/reference/suppliers', async (_req, res) => {
    try {
      const suppliers = await getActiveSuppliers();
      return res.json({ success: true, suppliers });
    } catch (err: any) {
      console.error('[Reference] List suppliers error:', err);
      return res.status(500).json({ success: false, error: 'Unable to load suppliers' });
    }
  });

  app.post(
    '/api/reference/suppliers',
    requireRole('SUPPLY_CHAIN', 'SOURCING'),
    async (req: any, res) => {
      const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';

      if (!name) {
        return res.status(400).json({ success: false, error: 'Le nom du fournisseur est obligatoire.' });
      }
      if (name.length > SUPPLIER_NAME_MAX_LENGTH) {
        return res.status(400).json({
          success: false,
          error: `Le nom du fournisseur ne doit pas dépasser ${SUPPLIER_NAME_MAX_LENGTH} caractères.`,
        });
      }

      try {
        const supplier = await createSupplier(name);

        await writeAuditLog({
          entityType: 'SUPPLIER',
          entityId: supplier.id,
          action: 'CREATE_SUPPLIER',
          actor: req.user,
          details: { name: supplier.name },
        });

        return res.status(201).json({ success: true, supplier });
      } catch (err: any) {
        if (err instanceof DuplicateSupplierError) {
          return res.status(409).json({
            success: false,
            error: `Le fournisseur « ${err.existing.name} » existe déjà.`,
            existing: err.existing,
          });
        }
        console.error('[Reference] Create supplier error:', err);
        return res.status(500).json({ success: false, error: 'Unable to create supplier' });
      }
    }
  );

  // --- NEON POSTGRESQL DIRECT SQL ENDPOINTS ---

  // Statut de la connexion Neon
  app.get('/api/db/status', requireRole('SUPPLY_CHAIN'), async (req, res) => {
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
  app.post('/api/db/init', requireRole('SUPPLY_CHAIN'), async (req, res) => {
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
    app.post(
      '/api/shipments',
       requireRole('SUPPLY_CHAIN', 'SOURCING'),
      async (req, res) => {
  
    try {
      if (!isNeonConfigured()) {
        return res.status(503).json({ error: 'DATABASE_NOT_CONFIGURED' });
      }
      const data = req.body || {};

      // Creation-time validation: required business fields must be provided
      // explicitly by the user (no server-side invented defaults).
      const requiredText = (v: any) => typeof v === 'string' && v.trim() !== '';
      const missing: string[] = [];
      if (!['Air', 'Sea'].includes(data.mode)) missing.push('mode');
      if (!requiredText(data.supplier)) missing.push('supplier');
      if (!requiredText(data.order_reference)) missing.push('order_reference');
      if (!requiredText(data.global_status)) missing.push('global_status');
      if (!['Confirmé', 'En attente Antoine', 'Transmis transitaire', 'A vérifier'].includes(data.antoine_status)) {
        missing.push('antoine_status');
      }
      if (!['Haute', 'Moyenne', 'Basse'].includes(data.priority)) missing.push('priority');
      if (!['Dédouané', 'En cours', 'Bloqué Douane', 'Non Requis'].includes(data.customs_status)) {
        missing.push('customs_status');
      }
      if (missing.length > 0) {
        return res.status(400).json({
          success: false,
          error: `Champs obligatoires manquants ou invalides : ${missing.join(', ')}`,
        });
      }

      // POST is creation only: never silently overwrite an existing shipment.
      if (data.id && (await getShipmentByIdFromNeon(data.id))) {
        return res.status(409).json({
          success: false,
          error: `Une expédition avec l'identifiant ${data.id} existe déjà. Veuillez réessayer.`,
        });
      }

      const saved = await upsertShipmentInNeon(data);

      await writeAuditLog({
        entityType: 'SHIPMENT',
        entityId: saved.id,
        action: 'CREATE_SHIPMENT',
        actor: (req as any).user,
        details: {
          mode: saved.mode,
          supplier: saved.supplier,
          carrier: saved.carrier,
          order_reference: saved.order_reference,
        },
      });

      res.json({ success: true, shipment: saved });
    } catch (err: any) {
      console.error('Error upserting shipment in Neon:', err);
      res.status(500).json({ error: 'Erreur SQL lors de l\'enregistrement', details: err?.message });
    }
  });

  // Mettre à jour une expédition
    app.put(
      '/api/shipments/:id',
        requireRole('SUPPLY_CHAIN', 'SOURCING'),
        async (req, res) => {

  try {
      if (!isNeonConfigured()) {
        return res.status(503).json({ error: 'DATABASE_NOT_CONFIGURED' });
      }
      const previous = await getShipmentByIdFromNeon(req.params.id);
      if (!previous) {
        // PUT only updates: creation goes through POST (validated).
        return res.status(404).json({ success: false, error: 'Expédition introuvable' });
      }

      const data = { ...req.body, id: req.params.id };
      const saved = await upsertShipmentInNeon(data);

      // Record which fields changed (names only: values may be large JSON)
      const changedFields = Object.keys(req.body || {}).filter(
        (key) =>
          !['id', 'updated_at', 'created_at', 'alerts'].includes(key) &&
          JSON.stringify((req.body as any)[key] ?? null) !==
            JSON.stringify((previous as any)[key] ?? null)
      );

      if (changedFields.length > 0) {
        await writeAuditLog({
          entityType: 'SHIPMENT',
          entityId: saved.id,
          action: 'UPDATE_SHIPMENT',
          actor: (req as any).user,
          details: { changed_fields: changedFields },
        });
      }

      res.json({ success: true, shipment: saved });
    } catch (err: any) {
      console.error('Error updating shipment in Neon:', err);
      res.status(500).json({ error: 'Erreur SQL lors de la mise à jour', details: err?.message });
    }
  });

  // Supprimer une expédition
    app.delete(
        '/api/shipments/:id',
        requireRole('SUPPLY_CHAIN'),
        async (req, res) => {

  try {
      if (!isNeonConfigured()) {
        return res.status(503).json({ error: 'DATABASE_NOT_CONFIGURED' });
      }
      const previous = await getShipmentByIdFromNeon(req.params.id);
      if (!previous) {
        return res.status(404).json({ success: false, error: 'Expédition introuvable' });
      }

      await deleteShipmentInNeon(req.params.id);

      await writeAuditLog({
        entityType: 'SHIPMENT',
        entityId: req.params.id,
        action: 'DELETE_SHIPMENT',
        actor: (req as any).user,
        details: {
          mode: previous.mode,
          supplier: previous.supplier,
          order_reference: previous.order_reference,
        },
      });

      res.json({ success: true, deleted_id: req.params.id });
    } catch (err: any) {
      res.status(500).json({ error: 'Erreur SQL lors de la suppression', details: err?.message });
    }
  });

  // Purge complète de toutes les données dans Neon (0 mock data)
  app.post(
    '/api/shipments/clear-all',
    requireRole('SUPPLY_CHAIN'),
    async (req, res) => {
      try {
      if (!isNeonConfigured()) {
        return res.status(503).json({ error: 'DATABASE_NOT_CONFIGURED' });
      }
      const count = await clearAllShipmentsInNeon();

      await writeAuditLog({
        entityType: 'SHIPMENT',
        entityId: '*',
        action: 'CLEAR_ALL_SHIPMENTS',
        actor: (req as any).user,
        details: { deleted_count: count },
      });

      res.json({ success: true, deleted_count: count });
    } catch (err: any) {
      console.error('Erreur lors de la purge Neon:', err);
      res.status(500).json({ error: 'Erreur lors de la suppression des données Neon', details: err?.message });
    }
  });

  return app;
}
