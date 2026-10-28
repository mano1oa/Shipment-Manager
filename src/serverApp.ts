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
  changeUserPassword,
  resetUserPassword,
  PASSWORD_MIN_LENGTH,
} from './db/users.js';

import {
  createSession,
  getSessionUser,
  deleteSession,
  deleteOtherSessions,
} from './db/sessions.js';

import {
  getActiveCarriers,
  getAllCarriers,
  createCarrier,
  updateCarrier,
  getTrackingCodeForCarrierName,
  resolveParcelCarrier,
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
import { ANTOINE_STATUSES } from './types.js';

import {
  listDigiInvoices,
  getDigiInvoice,
  createDigiInvoice,
  updateDigiInvoice,
  deleteDigiInvoice,
  importDigiInvoices,
  getLastOdooSyncRun,
  getInvoiceTotalsByShipment,
  listDigiInvoicesForShipment,
  setInvoiceNoShipment,
  DuplicateDigiInvoiceError,
  ReadOnlyDigiInvoiceError,
  WrongInvoiceKindError,
  ensureDigiInvoicesSchema,
  createDirectInvoice,
  updateDirectInvoice,
  setInvoiceValidation,
  setInvoiceTriage,
} from './db/digiInvoices.js';
import { getTrackingSettings, validateTrackingSettings, saveTrackingSettings } from './db/settings.js';
import {
  isShipmentStatus,
  applyAutomaticShipmentStatus,
  validateParcelInput,
  isParcelStatus,
  isParcelDestination,
  INVOICE_TRIAGES,
} from './lib/parcelTracking.js';
import {
  listReceptionPoints,
  getReceptionPoint,
  createReceptionPoint,
  listPointPhotos,
  addPointPhoto,
  linkPointPhoto,
  deletePointPhoto,
  setPointFolder,
  getPhotoFile,
} from './db/receptionPoints.js';
import {
  isPhotoStorageConfigured,
  createPhotoFolder,
  uploadPhoto,
  downloadPhoto,
  deletePhotoObject,
  PHOTO_CONTENT_TYPES,
  PHOTO_MAX_BYTES,
} from './services/photoStorage.js';
import { validateDirectInvoiceInput } from './lib/directInvoices.js';
import type { ParcelInput } from './lib/parcelTracking.js';
import {
  listParcelsForInvoice,
  listParcels,
  listParcelsForShipment,
  listGoodsInvoicesWithoutParcel,
  listLateTriageInvoices,
  markOverdueParcelsLost,
  setParcelStatus,
  listParcelPhotos,
  deleteParcelPhoto,
  getParcel,
  createParcel,
  updateParcel,
  unlinkParcelInvoice,
  commonSupplierOf,
  DuplicateParcelError,
} from './db/parcels.js';
import { validateDigiInvoiceInput, DIGI_IMPORT_MAX_INVOICES } from './lib/digiInvoices.js';
import { isOdooConfigured, OdooError } from './services/odoo/client.js';
import {
  createShipmentFromInvoices,
  addInvoicesToShipment,
  removeInvoiceFromShipment,
  ShipmentGroupingError,
} from './services/digiShipments.js';
import { runDigiOdooSync, getDestinationFilter } from './services/odoo/digiInvoiceSync.js';
import { runParcelLossCheck } from './services/parcelLossNotifier.js';

// Odoo DIGI sync: on demand, within the serverless time limit (300 s).
const ODOO_SYNC_TIME_BUDGET_MS = 240_000;
const ODOO_SYNC_MIN_INTERVAL_SECONDS = 30;

import {
  listTrackingForShipment,
  getTrackingNumber,
  addTrackingNumber,
  addTrackingNumbersFromText,
  updateTrackingNumber,
  deleteTrackingNumber,
  recordTrackingEvents,
  isCarrierCode,
  isTrackingStatus,
  DuplicateTrackingNumberError,
} from './db/tracking.js';

import { detectTrackingNumber } from './lib/carrierDetection.js';
import { syncShipmentTracking, syncDueTracking } from './services/tracking/syncService.js';
import { getAutomatedCarriers } from './services/tracking/registry.js';

// Daily cron (Vercel Hobby: max 300 s per function). Keep a safety margin.
const CRON_SYNC_LIMIT = 300;
const CRON_TIME_BUDGET_MS = 240_000;

import {
  listResolvedAlerts,
  resolveAlert,
  unresolveAlert,
} from './db/alerts.js';

import {
  consumeRateLimit,
  peekRateLimit,
  resetRateLimit,
  getClientIp,
} from './db/rateLimit.js';

// Rate limits (fixed windows, persisted in Neon)
const LOGIN_IP_LIMIT = 30; // login attempts per IP
const LOGIN_EMAIL_FAILURE_LIMIT = 8; // failed logins per email address
const LOGIN_WINDOW_SECONDS = 15 * 60;
const AI_USER_LIMIT = 40; // Gemini calls per user (chat + analysis)
const AI_WINDOW_SECONDS = 60 * 60;
const AI_PROMPT_MAX_LENGTH = 4000;
const PASSWORD_CHANGE_LIMIT = 10; // password change attempts per user
const PASSWORD_CHANGE_WINDOW_SECONDS = 15 * 60;

function sendTooManyRequests(res: any, retryAfterSeconds: number, message: string) {
  const retryAfter = Math.max(1, Math.ceil(retryAfterSeconds || 60));
  res.setHeader('Retry-After', String(retryAfter));
  return res.status(429).json({
    success: false,
    error: message,
    retry_after_seconds: retryAfter,
  });
}

async function checkAiRateLimit(req: any, res: any): Promise<boolean> {
  const limit = await consumeRateLimit(`ai:user:${req.user.id}`, AI_USER_LIMIT, AI_WINDOW_SECONDS);
  if (!limit.allowed) {
    const minutes = Math.ceil(limit.retryAfterSeconds / 60);
    sendTooManyRequests(
      res,
      limit.retryAfterSeconds,
      `Limite d'utilisation de l'assistant IA atteinte (${AI_USER_LIMIT} requêtes par heure). Réessayez dans ${minutes} min.`
    );
    return false;
  }
  return true;
}

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

      if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
        return res.status(400).json({
          success: false,
          error: 'Email et mot de passe requis',
        });
      }

      // Brute-force protection: per-IP attempts and per-email failures
      const ipLimit = await consumeRateLimit(
        `login:ip:${getClientIp(req)}`,
        LOGIN_IP_LIMIT,
        LOGIN_WINDOW_SECONDS
      );
      if (!ipLimit.allowed) {
        return sendTooManyRequests(
          res,
          ipLimit.retryAfterSeconds,
          'Trop de tentatives de connexion. Veuillez réessayer plus tard.'
        );
      }

      const emailBucket = `login:email:${email.trim().toLowerCase().slice(0, 200)}`;
      const emailLimit = await peekRateLimit(
        emailBucket,
        LOGIN_EMAIL_FAILURE_LIMIT,
        LOGIN_WINDOW_SECONDS
      );
      if (!emailLimit.allowed) {
        return sendTooManyRequests(
          res,
          emailLimit.retryAfterSeconds,
          'Trop de tentatives échouées pour ce compte. Veuillez réessayer plus tard.'
        );
      }

      const user = await findUserByEmail(email);

      if (!user || !user.is_active) {
        await consumeRateLimit(emailBucket, LOGIN_EMAIL_FAILURE_LIMIT, LOGIN_WINDOW_SECONDS);
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
        await consumeRateLimit(emailBucket, LOGIN_EMAIL_FAILURE_LIMIT, LOGIN_WINDOW_SECONDS);
        return res.status(401).json({
          success: false,
          error: 'Email ou mot de passe incorrect',
        });
      }

      await resetRateLimit(emailBucket);

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

      // Public endpoint: never expose database/internal details to the caller.
      return res.status(503).json({
        success: false,
        error: 'Service temporairement indisponible. Veuillez réessayer plus tard.',
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

  // Healthcheck public
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', app: 'Shipment Manager', timestamp: new Date().toISOString() });
  });

  // =========================================================
  // VERCEL CRON — daily tracking refresh
  // Declared BEFORE requireAuth: Vercel Cron authenticates with
  // "Authorization: Bearer <CRON_SECRET>", not with a user session.
  // Fail-closed: never runs when CRON_SECRET is missing.
  // =========================================================
  app.get('/api/cron/update-tracking', async (req, res) => {
    const cronSecret = process.env.CRON_SECRET;

    if (!cronSecret) {
      console.error('[Tracking Cron] CRON_SECRET is not configured: job not run.');
      return res.status(500).json({ success: false, error: 'Cron configuration error' });
    }

    if (req.headers.authorization !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    try {
      const startedAt = Date.now();
      const result = await syncDueTracking({
        limit: CRON_SYNC_LIMIT,
        timeBudgetMs: CRON_TIME_BUDGET_MS,
      });
      console.log('[Tracking Cron]', JSON.stringify(result));
      return res.json({ success: true, duration_ms: Date.now() - startedAt, ...result });
    } catch (err: any) {
      console.error('[Tracking Cron] Failed:', err);
      return res.status(500).json({ success: false, error: 'Tracking cron failed' });
    }
  });

  // Daily Odoo DIGI invoices sync (same CRON_SECRET rules as above).
  app.get('/api/cron/sync-digi-invoices', async (req, res) => {
    const cronSecret = process.env.CRON_SECRET;

    if (!cronSecret) {
      console.error('[DIGI Cron] CRON_SECRET is not configured: job not run.');
      return res.status(500).json({ success: false, error: 'Cron configuration error' });
    }

    if (req.headers.authorization !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    // Same daily run (8 h, Madagascar): lost parcels + Google Chat summary.
    // Independent of Odoo: a failure here never blocks the invoices sync.
    let parcelLosses: Record<string, unknown> | null = null;
    try {
      parcelLosses = await runParcelLossCheck();
      console.log('[Parcels Cron]', JSON.stringify(parcelLosses));
    } catch (err: any) {
      console.error('[Parcels Cron] Failed:', err);
      parcelLosses = { error: 'Parcel loss check failed' };
    }

    if (!isOdooConfigured()) {
      console.log('[DIGI Cron] Odoo is not configured: nothing to sync.');
      return res.json({ success: true, skipped: 'ODOO_NOT_CONFIGURED', parcel_losses: parcelLosses });
    }

    try {
      const startedAt = Date.now();
      const result = await runDigiOdooSync({
        trigger: 'cron',
        actor: null,
        timeBudgetMs: ODOO_SYNC_TIME_BUDGET_MS,
      });
      console.log('[DIGI Cron]', JSON.stringify(result));
      return res.json({ success: true, duration_ms: Date.now() - startedAt, ...result, parcel_losses: parcelLosses });
    } catch (err: any) {
      console.error('[DIGI Cron] Failed:', err);
      return res.status(500).json({ success: false, error: 'DIGI invoices sync failed' });
    }
  });

    app.use('/api', requireAuth);

  // Own password change (any role). The user's other sessions are signed out.
  app.post('/api/auth/change-password', async (req: any, res) => {
    const { currentPassword, newPassword } = req.body || {};

    if (typeof currentPassword !== 'string' || typeof newPassword !== 'string' || !currentPassword || !newPassword) {
      return res.status(400).json({ success: false, error: 'Mot de passe actuel et nouveau mot de passe requis.' });
    }
    if (newPassword.length < PASSWORD_MIN_LENGTH) {
      return res.status(400).json({
        success: false,
        error: `Le nouveau mot de passe doit contenir au moins ${PASSWORD_MIN_LENGTH} caractères.`,
      });
    }
    if (newPassword.length > 200) {
      return res.status(400).json({ success: false, error: 'Le nouveau mot de passe est trop long.' });
    }
    if (newPassword === currentPassword) {
      return res.status(400).json({ success: false, error: 'Le nouveau mot de passe doit être différent de l’actuel.' });
    }

    try {
      const limit = await consumeRateLimit(
        `password-change:user:${req.user.id}`,
        PASSWORD_CHANGE_LIMIT,
        PASSWORD_CHANGE_WINDOW_SECONDS
      );
      if (!limit.allowed) {
        return sendTooManyRequests(
          res,
          limit.retryAfterSeconds,
          'Trop de tentatives de changement de mot de passe. Veuillez réessayer plus tard.'
        );
      }

      const result = await changeUserPassword(req.user.id, currentPassword, newPassword);
      if (!result.ok) {
        return res.status(result.reason === 'INVALID_CURRENT' ? 400 : 404).json({
          success: false,
          error: result.reason === 'INVALID_CURRENT' ? 'Le mot de passe actuel est incorrect.' : 'Utilisateur introuvable.',
        });
      }

      const token = getCookie(req, 'shipment_session');
      if (token) {
        await deleteOtherSessions(req.user.id, token);
      }

      await writeAuditLog({
        entityType: 'USER',
        entityId: req.user.id,
        action: 'CHANGE_PASSWORD',
        actor: req.user,
      });

      return res.json({ success: true });
    } catch (error) {
      console.error('Change password error:', error);
      return res.status(500).json({ success: false, error: 'Impossible de changer le mot de passe.' });
    }
  });

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

// Réinitialiser le mot de passe d'un autre utilisateur (mot de passe oublié).
// Son propre mot de passe se change depuis le profil (mot de passe actuel exigé).
app.put(
  '/api/admin/users/:id/password',
  requireRole('SUPPLY_CHAIN'),
  async (req: any, res) => {
    const { password } = req.body || {};

    if (!UUID_RE.test(req.params.id)) {
      return res.status(404).json({ success: false, error: 'Utilisateur introuvable.' });
    }
    if (req.params.id === req.user.id) {
      return res.status(400).json({
        success: false,
        error: 'Pour votre propre compte, utilisez « Changer le mot de passe » dans votre profil.',
      });
    }
    if (typeof password !== 'string' || password.length < PASSWORD_MIN_LENGTH) {
      return res.status(400).json({
        success: false,
        error: `Le mot de passe doit contenir au moins ${PASSWORD_MIN_LENGTH} caractères.`,
      });
    }
    if (password.length > 200) {
      return res.status(400).json({ success: false, error: 'Le mot de passe est trop long.' });
    }

    try {
      const found = await resetUserPassword(req.params.id, password);
      if (!found) {
        return res.status(404).json({ success: false, error: 'Utilisateur introuvable.' });
      }

      await writeAuditLog({
        entityType: 'USER',
        entityId: req.params.id,
        action: 'RESET_PASSWORD',
        actor: req.user,
      });

      return res.json({ success: true });
    } catch (error) {
      console.error('Reset password error:', error);
      return res.status(500).json({ success: false, error: 'Impossible de réinitialiser le mot de passe.' });
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

      if ('reason' in result) {
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

      if ('reason' in result) {
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

      const { prompt, shipmentContext } = req.body || {};

      if (typeof prompt !== 'string' || !prompt.trim()) {
        return res.status(400).json({ error: 'Prompt requis' });
      }
      if (prompt.length > AI_PROMPT_MAX_LENGTH) {
        return res.status(400).json({
          error: `La question ne doit pas dépasser ${AI_PROMPT_MAX_LENGTH} caractères.`,
        });
      }

      if (!(await checkAiRateLimit(req, res))) return;

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
      });
    }
  });

  // 5. Automated AI Dataset Analysis Endpoint
  app.post('/api/analyze-shipments', async (req, res) => {
    try {
      if (!ai) {
        return res.status(500).json({ error: 'GEMINI_API_KEY non configurée' });
      }

      const { shipments } = req.body || {};

      if (!(await checkAiRateLimit(req, res))) return;

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
      res.status(500).json({ error: 'Erreur lors de l\'analyse automatique.' });
    }
  });

  // --- TRACKING NUMBERS & EVENTS (source of truth: Neon) ---
  // Reads: any authenticated user. Changes: SUPPLY_CHAIN + SOURCING.
  // Sync all: SUPPLY_CHAIN only. Nothing is ever simulated.

  app.get('/api/tracking/config', (_req, res) => {
    res.json({ success: true, automated_carriers: getAutomatedCarriers() });
  });

  app.get('/api/shipments/:id/tracking', async (req, res) => {
    try {
      const shipment = await getShipmentByIdFromNeon(req.params.id);
      if (!shipment) {
        return res.status(404).json({ success: false, error: 'Expédition introuvable' });
      }
      const data = await listTrackingForShipment(req.params.id);
      return res.json({ success: true, ...data, automated_carriers: getAutomatedCarriers() });
    } catch (err: any) {
      console.error('[Tracking] List error:', err);
      return res.status(500).json({ success: false, error: 'Impossible de charger le suivi' });
    }
  });

  app.post(
    '/api/shipments/:id/tracking-numbers',
    requireRole('SUPPLY_CHAIN', 'SOURCING'),
    async (req: any, res) => {
      const rawInput = typeof req.body?.tracking_number === 'string' ? req.body.tracking_number : '';
      const detected = detectTrackingNumber(rawInput);

      if (!detected.number || detected.warnings.includes('NOT_A_TRACKING_NUMBER')) {
        return res.status(400).json({ success: false, error: 'Numéro de suivi invalide.' });
      }
      if (detected.number.length > 100) {
        return res.status(400).json({ success: false, error: 'Numéro de suivi trop long.' });
      }

      const requestedCarrier = req.body?.carrier;
      if (requestedCarrier !== undefined && requestedCarrier !== null && !isCarrierCode(requestedCarrier)) {
        return res.status(400).json({ success: false, error: 'Transporteur invalide.' });
      }

      try {
        const shipment = await getShipmentByIdFromNeon(req.params.id);
        if (!shipment) {
          return res.status(404).json({ success: false, error: 'Expédition introuvable' });
        }

        // Unrecognised number format: fall back to the connector linked to the shipment's carrier
        let carrierCode = requestedCarrier || detected.carrier;
        if (carrierCode === 'UNKNOWN') {
          const linked = await getTrackingCodeForCarrierName(shipment.carrier);
          if (linked && isCarrierCode(linked)) carrierCode = linked;
        }

        const record = await addTrackingNumber({
          shipmentId: req.params.id,
          number: detected.number,
          rawInput: detected.raw,
          carrier: carrierCode,
        });

        await writeAuditLog({
          entityType: 'SHIPMENT',
          entityId: req.params.id,
          action: 'ADD_TRACKING_NUMBER',
          actor: req.user,
          details: { tracking_number: record.tracking_number, carrier: record.carrier },
        });

        return res.status(201).json({ success: true, tracking_number: record, warnings: detected.warnings });
      } catch (err: any) {
        if (err instanceof DuplicateTrackingNumberError) {
          return res.status(409).json({
            success: false,
            error: 'Ce numéro de suivi est déjà rattaché à cette expédition.',
          });
        }
        console.error('[Tracking] Add number error:', err);
        return res.status(500).json({ success: false, error: 'Impossible d\'ajouter le numéro de suivi' });
      }
    }
  );

  app.patch(
    '/api/tracking-numbers/:id',
    requireRole('SUPPLY_CHAIN', 'SOURCING'),
    async (req: any, res) => {
      if (!UUID_RE.test(req.params.id)) {
        return res.status(404).json({ success: false, error: 'Numéro de suivi introuvable' });
      }
      const { carrier, is_active } = req.body || {};
      if (carrier !== undefined && !isCarrierCode(carrier)) {
        return res.status(400).json({ success: false, error: 'Transporteur invalide.' });
      }
      if (is_active !== undefined && typeof is_active !== 'boolean') {
        return res.status(400).json({ success: false, error: 'is_active doit être un booléen.' });
      }

      try {
        const before = await getTrackingNumber(req.params.id);
        if (!before) {
          return res.status(404).json({ success: false, error: 'Numéro de suivi introuvable' });
        }
        const updated = await updateTrackingNumber(req.params.id, { carrier, is_active });

        await writeAuditLog({
          entityType: 'SHIPMENT',
          entityId: before.shipment_id,
          action: 'UPDATE_TRACKING_NUMBER',
          actor: req.user,
          details: {
            tracking_number: before.tracking_number,
            carrier: carrier !== undefined ? { from: before.carrier, to: carrier } : undefined,
            is_active: is_active !== undefined ? { from: before.is_active, to: is_active } : undefined,
          },
        });

        return res.json({ success: true, tracking_number: updated });
      } catch (err: any) {
        console.error('[Tracking] Update number error:', err);
        return res.status(500).json({ success: false, error: 'Impossible de modifier le numéro de suivi' });
      }
    }
  );

  app.delete(
    '/api/tracking-numbers/:id',
    requireRole('SUPPLY_CHAIN', 'SOURCING'),
    async (req: any, res) => {
      if (!UUID_RE.test(req.params.id)) {
        return res.status(404).json({ success: false, error: 'Numéro de suivi introuvable' });
      }
      try {
        const removed = await deleteTrackingNumber(req.params.id);
        if (!removed) {
          return res.status(404).json({ success: false, error: 'Numéro de suivi introuvable' });
        }

        await writeAuditLog({
          entityType: 'SHIPMENT',
          entityId: removed.shipment_id,
          action: 'REMOVE_TRACKING_NUMBER',
          actor: req.user,
          details: { tracking_number: removed.tracking_number, carrier: removed.carrier },
        });

        return res.json({ success: true });
      } catch (err: any) {
        console.error('[Tracking] Delete number error:', err);
        return res.status(500).json({ success: false, error: 'Impossible de supprimer le numéro de suivi' });
      }
    }
  );

  // Manual event (e.g. "Livré Orly" confirmed by Antoine, carrier website check)
  app.post(
    '/api/tracking-numbers/:id/events',
    requireRole('SUPPLY_CHAIN', 'SOURCING'),
    async (req: any, res) => {
      if (!UUID_RE.test(req.params.id)) {
        return res.status(404).json({ success: false, error: 'Numéro de suivi introuvable' });
      }

      const { event_at, status, description, location } = req.body || {};
      const eventDate = typeof event_at === 'string' ? new Date(event_at) : null;

      if (!eventDate || Number.isNaN(eventDate.getTime())) {
        return res.status(400).json({ success: false, error: 'Date de l\'événement invalide.' });
      }
      if (eventDate.getTime() > Date.now() + 24 * 60 * 60 * 1000) {
        return res.status(400).json({ success: false, error: 'La date de l\'événement ne peut pas être dans le futur.' });
      }
      if (!isTrackingStatus(status) || status === 'UNKNOWN') {
        return res.status(400).json({ success: false, error: 'Statut invalide.' });
      }
      if (typeof description !== 'string' || !description.trim()) {
        return res.status(400).json({ success: false, error: 'La description est obligatoire.' });
      }

      try {
        const number = await getTrackingNumber(req.params.id);
        if (!number) {
          return res.status(404).json({ success: false, error: 'Numéro de suivi introuvable' });
        }

        const inserted = await recordTrackingEvents(number.id, [
          {
            eventAt: eventDate.toISOString(),
            status,
            description: description.trim(),
            location: typeof location === 'string' && location.trim() ? location.trim() : null,
            source: 'manual',
            createdByEmail: req.user.email,
          },
        ]);

        if (inserted > 0) {
          await writeAuditLog({
            entityType: 'SHIPMENT',
            entityId: number.shipment_id,
            action: 'ADD_TRACKING_EVENT',
            actor: req.user,
            details: {
              tracking_number: number.tracking_number,
              status,
              event_at: eventDate.toISOString(),
            },
          });
        }

        return res.status(inserted > 0 ? 201 : 200).json({ success: true, created: inserted > 0 });
      } catch (err: any) {
        console.error('[Tracking] Add event error:', err);
        return res.status(500).json({ success: false, error: 'Impossible d\'ajouter l\'événement' });
      }
    }
  );

  app.post(
    '/api/tracking/sync/:shipmentId',
    requireRole('SUPPLY_CHAIN', 'SOURCING'),
    async (req: any, res) => {
      try {
        const shipment = await getShipmentByIdFromNeon(req.params.shipmentId);
        if (!shipment) {
          return res.status(404).json({ success: false, error: 'Expédition introuvable' });
        }
        const results = await syncShipmentTracking(req.params.shipmentId);
        return res.json({ success: true, results });
      } catch (err: any) {
        console.error('[Tracking] Sync shipment error:', err);
        return res.status(500).json({ success: false, error: 'Échec de la synchronisation du suivi' });
      }
    }
  );

  app.post(
    '/api/tracking/sync-all',
    requireRole('SUPPLY_CHAIN'),
    async (req: any, res) => {
      try {
        const result = await syncDueTracking({
          limit: CRON_SYNC_LIMIT,
          timeBudgetMs: CRON_TIME_BUDGET_MS,
        });

        await writeAuditLog({
          entityType: 'SHIPMENT',
          entityId: '*',
          action: 'SYNC_ALL_TRACKING',
          actor: req.user,
          details: result,
        });

        return res.json({ success: true, ...result });
      } catch (err: any) {
        console.error('[Tracking] Sync all error:', err);
        return res.status(500).json({ success: false, error: 'Échec de la synchronisation globale' });
      }
    }
  );

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

  // Creation reserved to SUPPLY_CHAIN (they also edit carriers in Settings)
  app.post(
    '/api/reference/carriers',
    requireRole('SUPPLY_CHAIN'),
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

  // Settings: full carrier list (inactive included) and edition. SUPPLY_CHAIN only.
  app.get('/api/reference/carriers/all', requireRole('SUPPLY_CHAIN'), async (_req, res) => {
    try {
      const carriers = await getAllCarriers();
      return res.json({ success: true, carriers });
    } catch (err: any) {
      console.error('[Reference] List all carriers error:', err);
      return res.status(500).json({ success: false, error: 'Unable to load carriers' });
    }
  });

  app.put('/api/reference/carriers/:id', requireRole('SUPPLY_CHAIN'), async (req: any, res) => {
    const id = String(req.params.id || '');
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const transportMode = req.body?.transport_mode;
    const isActive = req.body?.is_active;
    const trackingCode = req.body?.tracking_carrier_code ?? null;

    if (!UUID_RE.test(id)) {
      return res.status(404).json({ success: false, error: 'Transporteur introuvable.' });
    }
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
    if (typeof isActive !== 'boolean') {
      return res.status(400).json({ success: false, error: 'Le statut actif/inactif est obligatoire.' });
    }
    if (trackingCode !== null && (!isCarrierCode(trackingCode) || trackingCode === 'UNKNOWN')) {
      return res.status(400).json({ success: false, error: 'Connecteur de suivi invalide.' });
    }

    try {
      const carrier = await updateCarrier(id, {
        name,
        transport_mode: transportMode,
        tracking_carrier_code: trackingCode,
        is_active: isActive,
      });
      if (!carrier) {
        return res.status(404).json({ success: false, error: 'Transporteur introuvable.' });
      }

      await writeAuditLog({
        entityType: 'CARRIER',
        entityId: carrier.id,
        action: 'UPDATE_CARRIER',
        actor: req.user,
        details: {
          name: carrier.name,
          transport_mode: carrier.transport_mode,
          tracking_carrier_code: carrier.tracking_carrier_code,
          is_active: carrier.is_active,
        },
      });

      return res.json({ success: true, carrier });
    } catch (err: any) {
      if (err instanceof DuplicateReferenceError) {
        return res.status(409).json({
          success: false,
          error: `Le transporteur « ${err.existing.name} » existe déjà.`,
          existing: err.existing,
        });
      }
      console.error('[Reference] Update carrier error:', err);
      return res.status(500).json({ success: false, error: 'Unable to update carrier' });
    }
  });

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

  // =========================================================
  // DIGI LOGISTIC INVOICES → NextHope ("colis à suivre")
  // Sources: Odoo DIGI LOGISTIC (read only), Excel import, manual entry.
  // Reads and changes: SUPPLY_CHAIN + SOURCING. Delete: SUPPLY_CHAIN.
  // =========================================================

  app.get('/api/digi-invoices/config', requireRole('SUPPLY_CHAIN', 'SOURCING'), async (_req, res) => {
    const dest = getDestinationFilter();
    let lastRun = null;
    try {
      lastRun = await getLastOdooSyncRun();
    } catch (err: any) {
      console.error('[DIGI] Could not read last sync run:', err?.message || err);
    }
    res.json({
      success: true,
      odoo_configured: isOdooConfigured(),
      dest_partner_name: dest.name,
      dest_partner_id: dest.id,
      import_max_invoices: DIGI_IMPORT_MAX_INVOICES,
      last_sync: lastRun,
    });
  });

  // Shipment values only (references + total), for every role: the lists and the
  // dashboard KPIs show the linked invoice amount as the shipment value.
  app.get('/api/digi-invoices/values', async (_req, res) => {
    try {
      const invoices = await listDigiInvoices();
      return res.json({
        success: true,
        values: invoices.map((inv) => ({
          ref: inv.ref,
          odoo_move_name: inv.odoo_move_name,
          sale_move_ref: inv.sale_move_ref,
          odoo_missing: inv.odoo_missing,
          amount_total: inv.amount_total,
        })),
      });
    } catch (err: any) {
      console.error('[DIGI] List invoice values error:', err);
      return res.status(500).json({ success: false, error: 'Impossible de charger les valeurs DIGI' });
    }
  });

  app.get('/api/digi-invoices', requireRole('SUPPLY_CHAIN', 'SOURCING'), async (_req, res) => {
    try {
      const invoices = await listDigiInvoices();
      return res.json({ success: true, invoices });
    } catch (err: any) {
      console.error('[DIGI] List invoices error:', err);
      return res.status(500).json({ success: false, error: 'Impossible de charger les factures DIGI' });
    }
  });

  app.post('/api/digi-invoices', requireRole('SUPPLY_CHAIN', 'SOURCING'), async (req: any, res) => {
    const { value, errors } = validateDigiInvoiceInput(req.body);
    if (!value) {
      return res.status(400).json({ success: false, error: errors.join(' ') });
    }

    try {
      const id = await createDigiInvoice(value, 'manual', req.user.email);
      await writeAuditLog({
        entityType: 'DIGI_INVOICE',
        entityId: id,
        action: 'CREATE_DIGI_INVOICE',
        actor: req.user,
        details: { supplier: value.supplier_name, ref: value.ref, lines: value.lines.length },
      });
      return res.status(201).json({ success: true, invoice: await getDigiInvoice(id) });
    } catch (err: any) {
      if (err instanceof DuplicateDigiInvoiceError) {
        return res.status(409).json({
          success: false,
          error: `La facture ${value.ref} de ${value.supplier_name} existe déjà.`,
        });
      }
      console.error('[DIGI] Create invoice error:', err);
      return res.status(500).json({ success: false, error: 'Impossible d\'enregistrer la facture' });
    }
  });

  app.post('/api/digi-invoices/import', requireRole('SUPPLY_CHAIN', 'SOURCING'), async (req: any, res) => {
    const items = req.body?.invoices;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, error: 'Aucune facture à importer.' });
    }
    if (items.length > DIGI_IMPORT_MAX_INVOICES) {
      return res.status(400).json({
        success: false,
        error: `${DIGI_IMPORT_MAX_INVOICES} factures maximum par import.`,
      });
    }

    const valid = [];
    const rejected: { ref: string | null; errors: string[] }[] = [];
    for (const item of items) {
      const { value, errors } = validateDigiInvoiceInput(item);
      if (value) valid.push(value);
      else rejected.push({ ref: typeof item?.ref === 'string' ? item.ref : null, errors });
    }

    try {
      const { created, duplicates } = await importDigiInvoices(valid, req.user.email);
      await writeAuditLog({
        entityType: 'DIGI_INVOICE',
        entityId: '*',
        action: 'IMPORT_DIGI_INVOICES',
        actor: req.user,
        details: {
          file_name: typeof req.body?.file_name === 'string' ? req.body.file_name.slice(0, 255) : null,
          received: items.length,
          created,
          duplicates: duplicates.length,
          rejected: rejected.length,
        },
      });
      return res.json({ success: true, created, duplicates, rejected });
    } catch (err: any) {
      console.error('[DIGI] Import error:', err);
      return res.status(500).json({ success: false, error: 'Échec de l\'import des factures' });
    }
  });

  // Services only (nothing to ship, manual work) ↔ to ship
  app.patch('/api/digi-invoices/:id/services', requireRole('SUPPLY_CHAIN', 'SOURCING'), async (req: any, res) => {
    if (!UUID_RE.test(req.params.id)) {
      return res.status(404).json({ success: false, error: 'Facture introuvable' });
    }
    const noShipment = req.body?.no_shipment;
    if (typeof noShipment !== 'boolean') {
      return res.status(400).json({ success: false, error: 'no_shipment doit être un booléen.' });
    }
    try {
      const outcome = await setInvoiceNoShipment(req.params.id, noShipment);
      if (!outcome) {
        return res.status(404).json({ success: false, error: 'Facture introuvable' });
      }
      await writeAuditLog({
        entityType: 'DIGI_INVOICE',
        entityId: req.params.id,
        action: noShipment ? 'MARK_DIGI_INVOICE_SERVICES' : 'UNMARK_DIGI_INVOICE_SERVICES',
        actor: req.user,
        details: { detached_shipment_id: outcome.previous_shipment_id },
      });
      return res.json({
        success: true,
        detached_shipment_id: outcome.previous_shipment_id,
        invoice: await getDigiInvoice(req.params.id),
      });
    } catch (err: any) {
      console.error('[DIGI] Services flag error:', err);
      return res.status(500).json({ success: false, error: 'Impossible de modifier la facture' });
    }
  });

  // ---------------------------------------------------------------------------
  // Shipments Orly / Rouen → Mada: grouping of received invoices (Supply Chain)
  // ---------------------------------------------------------------------------

  const sendGroupingError = (res: any, err: any, fallback: string) => {
    if (err instanceof ShipmentGroupingError) {
      return res.status(err.status).json({ success: false, error: err.message, not_received: err.notReceived });
    }
    console.error('[Shipments] Grouping error:', err);
    return res.status(500).json({ success: false, error: fallback });
  };

  /**
   * New shipment from invoices received at the hub, with its Réf FA DIGI-NXT.
   * not_received in a 409 answer: invoices to confirm with force (exception).
   */
  app.post('/api/shipments/from-invoices', requireRole('SUPPLY_CHAIN'), async (req: any, res) => {
    const body = req.body || {};
    if (!['Air', 'Sea'].includes(body.mode)) return res.status(400).json({ success: false, error: 'Mode invalide.' });
    if (!isUuidList(body.invoice_ids)) return res.status(400).json({ success: false, error: 'Sélectionnez les factures.' });
    const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
    try {
      const outcome = await createShipmentFromInvoices(
        {
          mode: body.mode,
          ref_fa_digi_nxt: text(body.ref_fa_digi_nxt, 100),
          bl_awb: text(body.bl_awb, 100),
          carrier: text(body.carrier, 100),
          remarks: text(body.remarks, 2000),
          invoice_ids: body.invoice_ids,
          force: body.force === true,
        },
        req.user
      );
      return res.status(201).json({ success: true, ...outcome });
    } catch (err: any) {
      return sendGroupingError(res, err, 'Impossible de créer l\'expédition');
    }
  });

  app.post('/api/shipments/:id/invoices', requireRole('SUPPLY_CHAIN'), async (req: any, res) => {
    if (!isUuidList(req.body?.invoice_ids)) return res.status(400).json({ success: false, error: 'Sélectionnez les factures.' });
    try {
      const outcome = await addInvoicesToShipment(req.params.id, req.body.invoice_ids, req.body?.force === true, req.user);
      return res.json({ success: true, ...outcome });
    } catch (err: any) {
      return sendGroupingError(res, err, 'Impossible d\'ajouter les factures');
    }
  });

  app.delete('/api/shipments/:id/invoices/:invoiceId', requireRole('SUPPLY_CHAIN'), async (req: any, res) => {
    if (!UUID_RE.test(req.params.invoiceId)) return res.status(404).json({ success: false, error: 'Facture introuvable' });
    try {
      const shipment = await removeInvoiceFromShipment(req.params.id, req.params.invoiceId, req.user);
      return res.json({ success: true, shipment });
    } catch (err: any) {
      return sendGroupingError(res, err, 'Impossible de retirer la facture');
    }
  });

  // Parcels of the shipment's invoices (arrival check in Madagascar)
  app.get('/api/shipments/:id/parcels', async (req: any, res) => {
    try {
      return res.json({ success: true, parcels: await listParcelsForShipment(req.params.id) });
    } catch (err: any) {
      console.error('[Shipments] Parcels error:', err);
      return res.status(500).json({ success: false, error: 'Impossible de charger les colis de l\'expédition' });
    }
  });

  app.get('/api/shipments/:id/digi-invoices', async (req, res) => {
    try {
      const invoices = await listDigiInvoicesForShipment(req.params.id);
      return res.json({ success: true, invoices });
    } catch (err: any) {
      console.error('[DIGI] Shipment invoices error:', err);
      return res.status(500).json({ success: false, error: 'Impossible de charger les factures de l\'expédition' });
    }
  });

  app.put('/api/digi-invoices/:id', requireRole('SUPPLY_CHAIN', 'SOURCING'), async (req: any, res) => {
    if (!UUID_RE.test(req.params.id)) {
      return res.status(404).json({ success: false, error: 'Facture introuvable' });
    }
    const { value, errors } = validateDigiInvoiceInput(req.body);
    if (!value) {
      return res.status(400).json({ success: false, error: errors.join(' ') });
    }

    try {
      const found = await updateDigiInvoice(req.params.id, value, req.user.email);
      if (!found) {
        return res.status(404).json({ success: false, error: 'Facture introuvable' });
      }
      await writeAuditLog({
        entityType: 'DIGI_INVOICE',
        entityId: req.params.id,
        action: 'UPDATE_DIGI_INVOICE',
        actor: req.user,
        details: { supplier: value.supplier_name, ref: value.ref, lines: value.lines.length },
      });
      return res.json({ success: true, invoice: await getDigiInvoice(req.params.id) });
    } catch (err: any) {
      if (err instanceof ReadOnlyDigiInvoiceError) {
        return res.status(409).json({
          success: false,
          error: 'Cette facture vient d\'Odoo : elle se modifie dans Odoo, puis se resynchronise.',
        });
      }
      if (err instanceof WrongInvoiceKindError) {
        return res.status(409).json({
          success: false,
          error: 'Cette facture est une facture hors DIGI : elle se modifie depuis son propre formulaire.',
        });
      }
      if (err instanceof DuplicateDigiInvoiceError) {
        return res.status(409).json({
          success: false,
          error: `La facture ${value.ref} de ${value.supplier_name} existe déjà.`,
        });
      }
      console.error('[DIGI] Update invoice error:', err);
      return res.status(500).json({ success: false, error: 'Impossible de modifier la facture' });
    }
  });

  // ---------------------------------------------------------------------------
  // "Hors DIGI" invoices, sort, validation
  // ---------------------------------------------------------------------------

  // Supply Chain's are validated at once; Sourcing's wait for Supply Chain
  app.post('/api/digi-invoices/direct', requireRole('SUPPLY_CHAIN', 'SOURCING'), async (req: any, res) => {
    const { value, errors } = validateDirectInvoiceInput(req.body);
    if (!value) return res.status(400).json({ success: false, error: errors.join(' ') });
    const validated = req.user.role === 'SUPPLY_CHAIN';
    try {
      const id = await createDirectInvoice(value, req.user.email, validated);
      await writeAuditLog({
        entityType: 'DIGI_INVOICE',
        entityId: id,
        action: 'CREATE_DIRECT_INVOICE',
        actor: req.user,
        details: { supplier: value.supplier_name, ref: value.ref, amount: value.amount, currency: value.currency, validated },
      });
      return res.status(201).json({ success: true, invoice: await getDigiInvoice(id) });
    } catch (err: any) {
      if (err instanceof DuplicateDigiInvoiceError) {
        return res.status(409).json({ success: false, error: `La facture ${value.ref} de ${value.supplier_name} existe déjà.` });
      }
      console.error('[Invoices] Create direct invoice error:', err);
      return res.status(500).json({ success: false, error: 'Impossible d\'enregistrer la facture' });
    }
  });

  // Sourcing can only correct its invoices not validated yet
  app.put('/api/digi-invoices/:id/direct', requireRole('SUPPLY_CHAIN', 'SOURCING'), async (req: any, res) => {
    if (!UUID_RE.test(req.params.id)) return res.status(404).json({ success: false, error: 'Facture introuvable' });
    const { value, errors } = validateDirectInvoiceInput(req.body);
    if (!value) return res.status(400).json({ success: false, error: errors.join(' ') });
    try {
      const current = await getDigiInvoice(req.params.id);
      if (!current) return res.status(404).json({ success: false, error: 'Facture introuvable' });
      if (req.user.role !== 'SUPPLY_CHAIN' && current.validation_status === 'validated') {
        return res.status(403).json({ success: false, error: 'Facture validée : seule la Supply Chain peut la modifier.' });
      }
      await updateDirectInvoice(req.params.id, value, req.user.email, req.user.role === 'SUPPLY_CHAIN');
      await writeAuditLog({
        entityType: 'DIGI_INVOICE',
        entityId: req.params.id,
        action: 'UPDATE_DIRECT_INVOICE',
        actor: req.user,
        details: { supplier: value.supplier_name, ref: value.ref, amount: value.amount, currency: value.currency },
      });
      return res.json({ success: true, invoice: await getDigiInvoice(req.params.id) });
    } catch (err: any) {
      if (err instanceof WrongInvoiceKindError) {
        return res.status(409).json({ success: false, error: 'Cette facture est une facture DIGI.' });
      }
      if (err instanceof DuplicateDigiInvoiceError) {
        return res.status(409).json({ success: false, error: `La facture ${value.ref} de ${value.supplier_name} existe déjà.` });
      }
      console.error('[Invoices] Update direct invoice error:', err);
      return res.status(500).json({ success: false, error: 'Impossible de modifier la facture' });
    }
  });

  app.patch('/api/digi-invoices/:id/validation', requireRole('SUPPLY_CHAIN'), async (req: any, res) => {
    if (!UUID_RE.test(req.params.id)) return res.status(404).json({ success: false, error: 'Facture introuvable' });
    const decision = req.body?.decision;
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 1000) : '';
    if (decision !== 'validated' && decision !== 'rejected') {
      return res.status(400).json({ success: false, error: 'Décision invalide.' });
    }
    if (decision === 'rejected' && !reason) {
      return res.status(400).json({ success: false, error: 'Le motif du refus est obligatoire.' });
    }
    try {
      const outcome = await setInvoiceValidation(req.params.id, decision, reason || null, req.user.email);
      if (!outcome) return res.status(404).json({ success: false, error: 'Facture hors DIGI introuvable' });
      await writeAuditLog({
        entityType: 'DIGI_INVOICE',
        entityId: req.params.id,
        action: decision === 'validated' ? 'VALIDATE_DIRECT_INVOICE' : 'REJECT_DIRECT_INVOICE',
        actor: req.user,
        details: { previous: outcome.previous, reason: reason || null },
      });
      return res.json({ success: true, invoice: await getDigiInvoice(req.params.id) });
    } catch (err: any) {
      console.error('[Invoices] Validation error:', err);
      return res.status(500).json({ success: false, error: 'Impossible d\'enregistrer la décision' });
    }
  });

  // Sort of a DIGI invoice: to_sort / goods (tracked) / services
  app.patch('/api/digi-invoices/:id/triage', requireRole('SUPPLY_CHAIN', 'SOURCING'), async (req: any, res) => {
    if (!UUID_RE.test(req.params.id)) return res.status(404).json({ success: false, error: 'Facture introuvable' });
    const triage = req.body?.triage;
    if (!(INVOICE_TRIAGES as readonly string[]).includes(triage)) {
      return res.status(400).json({ success: false, error: 'Tri invalide.' });
    }
    try {
      const outcome = await setInvoiceTriage(req.params.id, triage, req.user.email);
      if (!outcome) return res.status(404).json({ success: false, error: 'Facture introuvable' });
      await writeAuditLog({
        entityType: 'DIGI_INVOICE',
        entityId: req.params.id,
        action: 'SORT_DIGI_INVOICE',
        actor: req.user,
        details: { triage, detached_shipment_id: outcome.previous_shipment_id },
      });
      return res.json({
        success: true,
        detached_shipment_id: outcome.previous_shipment_id,
        invoice: await getDigiInvoice(req.params.id),
      });
    } catch (err: any) {
      console.error('[Invoices] Sort error:', err);
      return res.status(500).json({ success: false, error: 'Impossible de trier la facture' });
    }
  });

  // ---------------------------------------------------------------------------
  // Parcels (supplier → Orly)
  // ---------------------------------------------------------------------------

  /**
   * Invoices of a new parcel: they exist, are not services and have one
   * supplier. Returns that supplier, or undefined after answering the error.
   */
  const checkParcelInvoices = async (invoiceIds: string[], res: any): Promise<string | null | undefined> => {
    const { supplier, mixed } = await commonSupplierOf(invoiceIds);
    if (mixed) {
      res.status(400).json({ success: false, error: 'Un colis ne peut regrouper que des factures d\'un même fournisseur.' });
      return undefined;
    }
    const invoices = await Promise.all(invoiceIds.map((id: string) => getDigiInvoice(id)));
    if (invoices.some((inv) => !inv)) {
      res.status(404).json({ success: false, error: 'Facture introuvable' });
      return undefined;
    }
    if (invoices.some((inv) => inv!.triage === 'services')) {
      res.status(409).json({ success: false, error: 'Une facture classée en services n\'a pas de colis.' });
      return undefined;
    }
    return supplier;
  };

  const isUuidList = (ids: unknown): ids is string[] =>
    Array.isArray(ids) && ids.length > 0 && ids.length <= 100 && ids.every((id) => typeof id === 'string' && UUID_RE.test(id));

  /** Reception date: YYYY-MM-DD, null when absent (today), undefined when invalid or in the future. */
  const parseReceptionDate = (value: unknown): string | null | undefined => {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
    const today = new Date().toISOString().slice(0, 10);
    return value > today ? undefined : value;
  };

  /** Trashes photo files in Google Drive; a failure only leaves an orphan file (logged). */
  const removePhotoObjects = async (keys: string[]) => {
    if (keys.length === 0 || !isPhotoStorageConfigured()) return;
    for (const key of keys) {
      await deletePhotoObject(key).catch((err) => console.error('[Parcels] Photo object not deleted:', key, err?.message));
    }
  };

  /**
   * Carrier of a parcel from the Settings list (or from the number format).
   * Returns false (and answers 400) when the picked carrier is unknown.
   */
  const applyParcelCarrier = async (value: ParcelInput, res: any): Promise<boolean> => {
    const resolved = await resolveParcelCarrier(value.carrier_name, value.carrier);
    if (!resolved) {
      res.status(400).json({
        success: false,
        error: `Transporteur « ${value.carrier_name} » inconnu ou désactivé : ajoutez-le dans Paramètres › Transporteurs.`,
      });
      return false;
    }
    value.carrier_name = resolved.name;
    if (resolved.trackingCode && isCarrierCode(resolved.trackingCode)) value.carrier = resolved.trackingCode;
    return true;
  };

  // Suivi Aérien › Colis vers Orly (read: every role)
  app.get('/api/parcels', async (_req, res) => {
    try {
      // Parcels not confirmed in time become "lost" (alert, claim to the supplier)
      const settings = await getTrackingSettings();
      const markedLost = await markOverdueParcelsLost(settings);
      if (markedLost > 0) {
        await writeAuditLog({
          entityType: 'PARCEL',
          entityId: '*',
          action: 'AUTO_MARK_PARCELS_LOST',
          actor: { id: 'system', email: 'alerte-automatique', role: 'SYSTEM' },
          details: { count: markedLost },
        });
      }
      const [parcels, invoicesWithoutParcel, lateTriage] = await Promise.all([
        listParcels(),
        listGoodsInvoicesWithoutParcel(),
        listLateTriageInvoices(settings),
      ]);
      return res.json({
        success: true,
        parcels,
        invoices_without_parcel: invoicesWithoutParcel,
        late_triage_invoices: lateTriage,
        photo_storage_configured: isPhotoStorageConfigured(),
      });
    } catch (err: any) {
      console.error('[Parcels] List all error:', err);
      return res.status(500).json({ success: false, error: 'Impossible de charger les colis' });
    }
  });

  app.get('/api/digi-invoices/:id/parcels', requireRole('SUPPLY_CHAIN', 'SOURCING', 'DIRECTION'), async (req: any, res) => {
    if (!UUID_RE.test(req.params.id)) return res.status(404).json({ success: false, error: 'Facture introuvable' });
    try {
      return res.json({ success: true, parcels: await listParcelsForInvoice(req.params.id) });
    } catch (err: any) {
      console.error('[Parcels] List error:', err);
      return res.status(500).json({ success: false, error: 'Impossible de charger les colis' });
    }
  });

  /**
   * Adds a parcel to invoices of one supplier. A tracking number already known
   * links the invoices to that parcel (one parcel can cover several invoices).
   */
  app.post('/api/parcels', requireRole('SUPPLY_CHAIN', 'SOURCING'), async (req: any, res) => {
    const invoiceIds = req.body?.invoice_ids;
    if (!Array.isArray(invoiceIds) || invoiceIds.length === 0 || invoiceIds.length > 100 || !invoiceIds.every((id) => UUID_RE.test(id))) {
      return res.status(400).json({ success: false, error: 'Factures du colis invalides.' });
    }
    const { value, errors } = validateParcelInput(req.body);
    if (!value) return res.status(400).json({ success: false, error: errors.join(' ') });
    try {
      if (!(await applyParcelCarrier(value, res))) return;
      const supplier = await checkParcelInvoices(invoiceIds, res);
      if (supplier === undefined) return;
      // Parcel created at reception (tracking number unknown until Antoine's photo): Supply Chain only
      const receivedNow = req.body?.received === true;
      if (receivedNow && req.user.role !== 'SUPPLY_CHAIN') {
        return res.status(403).json({ success: false, error: 'Seule la Supply Chain confirme une réception.' });
      }
      const receivedAt = receivedNow ? parseReceptionDate(req.body?.received_at) : null;
      if (receivedAt === undefined) return res.status(400).json({ success: false, error: 'Date de réception invalide.' });

      const { id, existed } = await createParcel(value, invoiceIds, supplier, req.user.email);
      if (receivedNow) await setParcelStatus(id, 'received', receivedAt, req.user.email);
      const parcel = await getParcel(id);
      if (existed && parcel) {
        // The known parcel must stay single-supplier
        const check = await commonSupplierOf(parcel.invoices.map((i) => i.id));
        if (check.mixed) {
          for (const invoiceId of invoiceIds) await unlinkParcelInvoice(id, invoiceId);
          return res.status(409).json({
            success: false,
            error: `Le n° de suivi ${value.tracking_number} est déjà utilisé par un colis d'un autre fournisseur.`,
          });
        }
      }
      await writeAuditLog({
        entityType: 'PARCEL',
        entityId: id,
        action: existed ? 'LINK_PARCEL_INVOICES' : 'CREATE_PARCEL',
        actor: req.user,
        details: {
          tracking_number: value.tracking_number,
          carrier: value.carrier,
          destination: value.destination,
          invoice_ids: invoiceIds,
          received: receivedNow,
        },
      });
      return res.status(existed ? 200 : 201).json({ success: true, existed, parcel: await getParcel(id) });
    } catch (err: any) {
      console.error('[Parcels] Create error:', err);
      return res.status(500).json({ success: false, error: 'Impossible d\'enregistrer le colis' });
    }
  });

  app.put('/api/parcels/:id', requireRole('SUPPLY_CHAIN', 'SOURCING'), async (req: any, res) => {
    if (!UUID_RE.test(req.params.id)) return res.status(404).json({ success: false, error: 'Colis introuvable' });
    const { value, errors } = validateParcelInput(req.body);
    if (!value) return res.status(400).json({ success: false, error: errors.join(' ') });
    try {
      if (!(await applyParcelCarrier(value, res))) return;
      const updated = await updateParcel(req.params.id, value, req.user.email);
      if (!updated) return res.status(404).json({ success: false, error: 'Colis introuvable' });
      await writeAuditLog({
        entityType: 'PARCEL',
        entityId: req.params.id,
        action: 'UPDATE_PARCEL',
        actor: req.user,
        details: { tracking_number: value.tracking_number, carrier: value.carrier, expected_delivery: value.expected_delivery },
      });
      return res.json({ success: true, parcel: await getParcel(req.params.id) });
    } catch (err: any) {
      if (err instanceof DuplicateParcelError) {
        return res.status(409).json({ success: false, error: `Le n° de suivi ${value.tracking_number} est déjà utilisé par un autre colis.` });
      }
      console.error('[Parcels] Update error:', err);
      return res.status(500).json({ success: false, error: 'Impossible de modifier le colis' });
    }
  });

  // Detaches a parcel from one invoice (deleted when it has no invoice left)
  app.delete('/api/parcels/:id/invoices/:invoiceId', requireRole('SUPPLY_CHAIN', 'SOURCING'), async (req: any, res) => {
    if (!UUID_RE.test(req.params.id) || !UUID_RE.test(req.params.invoiceId)) {
      return res.status(404).json({ success: false, error: 'Colis introuvable' });
    }
    try {
      const parcel = await getParcel(req.params.id);
      if (!parcel) return res.status(404).json({ success: false, error: 'Colis introuvable' });
      // Proof of reception: only Supply Chain removes a parcel received at Orly
      if (parcel.status !== 'to_receive' && req.user.role !== 'SUPPLY_CHAIN') {
        return res.status(403).json({ success: false, error: 'Colis déjà traité à Orly : seule la Supply Chain peut le retirer.' });
      }
      const outcome = await unlinkParcelInvoice(req.params.id, req.params.invoiceId);
      if (!outcome.unlinked) return res.status(404).json({ success: false, error: 'Ce colis n\'est pas rattaché à cette facture' });
      await removePhotoObjects(outcome.photo_keys);
      await writeAuditLog({
        entityType: 'PARCEL',
        entityId: req.params.id,
        action: outcome.deleted ? 'DELETE_PARCEL' : 'UNLINK_PARCEL_INVOICE',
        actor: req.user,
        details: { tracking_number: parcel.tracking_number, invoice_id: req.params.invoiceId },
      });
      return res.json({ success: true, deleted: outcome.deleted });
    } catch (err: any) {
      console.error('[Parcels] Unlink error:', err);
      return res.status(500).json({ success: false, error: 'Impossible de retirer le colis' });
    }
  });

  // ---------------------------------------------------------------------------
  // Réception Orly / Rouen (Supply Chain): status and photos
  // ---------------------------------------------------------------------------

  /**
   * Status of a parcel at the hub:
   * - received: confirmed by Antoine (Orly) or at Rouen; date defaults to today;
   * - search: received but missing on arrival in Madagascar (claim);
   * - lost: not received (claim to the supplier); to_receive: back to waiting.
   */
  app.patch('/api/parcels/:id/status', requireRole('SUPPLY_CHAIN'), async (req: any, res) => {
    if (!UUID_RE.test(req.params.id)) return res.status(404).json({ success: false, error: 'Colis introuvable' });
    const status = req.body?.status;
    if (!isParcelStatus(status)) return res.status(400).json({ success: false, error: 'État invalide.' });
    const receivedAt = parseReceptionDate(req.body?.received_at);
    if (receivedAt === undefined) return res.status(400).json({ success: false, error: 'Date de réception invalide.' });
    try {
      const parcel = await getParcel(req.params.id);
      if (!parcel) return res.status(404).json({ success: false, error: 'Colis introuvable' });
      if (status === 'search' && parcel.status !== 'received' && parcel.status !== 'search') {
        return res.status(409).json({
          success: false,
          error: 'Un avis de recherche concerne un colis reçu : confirmez d\'abord sa réception.',
        });
      }
      const outcome = await setParcelStatus(req.params.id, status, receivedAt, req.user.email);
      if (!outcome) return res.status(404).json({ success: false, error: 'Colis introuvable' });
      await writeAuditLog({
        entityType: 'PARCEL',
        entityId: req.params.id,
        action: 'SET_PARCEL_STATUS',
        actor: req.user,
        details: { from: outcome.previous, to: status, received_at: receivedAt, tracking_number: parcel.tracking_number },
      });
      return res.json({ success: true, parcel: await getParcel(req.params.id) });
    } catch (err: any) {
      console.error('[Parcels] Status error:', err);
      return res.status(500).json({ success: false, error: 'Impossible de modifier l\'état du colis' });
    }
  });

  // Photos with short display URLs (every role, reading is a proof for claims)
  app.get('/api/parcels/:id/photos', async (req: any, res) => {
    if (!UUID_RE.test(req.params.id)) return res.status(404).json({ success: false, error: 'Colis introuvable' });
    try {
      const photos = await listParcelPhotos(req.params.id);
      const configured = isPhotoStorageConfigured();
      const withUrls = await Promise.all(
        photos.map(async (p) => ({
          id: p.id,
          content_type: p.content_type,
          size_bytes: p.size_bytes,
          uploaded_by_email: p.uploaded_by_email,
          uploaded_at: p.uploaded_at,
          url: configured ? `/api/photos/${p.id}` : null,
        }))
      );
      return res.json({ success: true, storage_configured: configured, photos: withUrls });
    } catch (err: any) {
      console.error('[Parcels] Photos list error:', err);
      return res.status(500).json({ success: false, error: 'Impossible de charger les photos' });
    }
  });

  // ---------------------------------------------------------------------------
  // Point Antoine (Orly) / reception at Rouen: photos uploaded in one go, then
  // matched one by one to a parcel (matching confirms the reception)
  // ---------------------------------------------------------------------------

  app.get('/api/reception-points', async (req: any, res) => {
    const destination = req.query?.destination ?? 'ORLY';
    if (!isParcelDestination(destination)) return res.status(400).json({ success: false, error: 'Destination invalide.' });
    try {
      return res.json({
        success: true,
        points: await listReceptionPoints(destination),
        storage_configured: isPhotoStorageConfigured(),
      });
    } catch (err: any) {
      console.error('[Points] List error:', err);
      return res.status(500).json({ success: false, error: 'Impossible de charger les points de réception' });
    }
  });

  app.post('/api/reception-points', requireRole('SUPPLY_CHAIN'), async (req: any, res) => {
    const destination = req.body?.destination ?? 'ORLY';
    if (!isParcelDestination(destination)) return res.status(400).json({ success: false, error: 'Destination invalide.' });
    const pointDate = parseReceptionDate(req.body?.point_date);
    if (!pointDate) return res.status(400).json({ success: false, error: 'Date du point invalide (pas dans le futur).' });
    const notes = typeof req.body?.notes === 'string' && req.body.notes.trim() ? req.body.notes.trim().slice(0, 2000) : null;
    try {
      const id = await createReceptionPoint(destination, pointDate, notes, req.user.email);
      await writeAuditLog({
        entityType: 'RECEPTION_POINT',
        entityId: id,
        action: 'CREATE_RECEPTION_POINT',
        actor: req.user,
        details: { destination, point_date: pointDate },
      });
      return res.status(201).json({ success: true, point: await getReceptionPoint(id) });
    } catch (err: any) {
      console.error('[Points] Create error:', err);
      return res.status(500).json({ success: false, error: 'Impossible de créer le point de réception' });
    }
  });

  // The point with its photos (short display URLs)
  app.get('/api/reception-points/:id', async (req: any, res) => {
    if (!UUID_RE.test(req.params.id)) return res.status(404).json({ success: false, error: 'Point introuvable' });
    try {
      const point = await getReceptionPoint(req.params.id);
      if (!point) return res.status(404).json({ success: false, error: 'Point introuvable' });
      const configured = isPhotoStorageConfigured();
      const photos = await Promise.all(
        (await listPointPhotos(point.id)).map(async (p) => ({
          id: p.id,
          parcel_id: p.parcel_id,
          content_type: p.content_type,
          size_bytes: p.size_bytes,
          uploaded_at: p.uploaded_at,
          uploaded_by_email: p.uploaded_by_email,
          linked_by_email: p.linked_by_email,
          linked_at: p.linked_at,
          url: configured ? `/api/photos/${p.id}` : null,
        }))
      );
      return res.json({ success: true, point, photos, storage_configured: configured });
    } catch (err: any) {
      console.error('[Points] Read error:', err);
      return res.status(500).json({ success: false, error: 'Impossible de charger le point de réception' });
    }
  });

  /**
   * Uploads one photo of the point (already compressed by the browser) into the
   * point's Google Drive folder, created at the first photo. Body: the image
   * itself (Content-Type image/jpeg, png or webp). The database keeps the Drive id.
   */
  app.post(
    '/api/reception-points/:id/photos',
    requireRole('SUPPLY_CHAIN'),
    express.raw({ type: [...PHOTO_CONTENT_TYPES], limit: PHOTO_MAX_BYTES }),
    async (req: any, res) => {
      if (!UUID_RE.test(req.params.id)) return res.status(404).json({ success: false, error: 'Point introuvable' });
      if (!isPhotoStorageConfigured()) {
        return res.status(503).json({ success: false, error: 'Le stockage des photos (Google Drive) n\'est pas configuré.' });
      }
      const contentType = String(req.headers['content-type'] || '').split(';')[0].trim();
      if (!(PHOTO_CONTENT_TYPES as readonly string[]).includes(contentType) || !Buffer.isBuffer(req.body) || req.body.length === 0) {
        return res.status(400).json({ success: false, error: 'Photo invalide (JPEG, PNG ou WebP attendu).' });
      }
      try {
        const point = await getReceptionPoint(req.params.id);
        if (!point) return res.status(404).json({ success: false, error: 'Point introuvable' });
        let folderId = point.drive_folder_id;
        if (!folderId) {
          const hub = point.destination === 'ORLY' ? 'Point Antoine' : 'Réception Rouen';
          folderId = await setPointFolder(point.id, await createPhotoFolder(`${hub} ${point.point_date} (${point.id.slice(0, 8)})`));
        }
        const ext = contentType === 'image/png' ? 'png' : contentType === 'image/webp' ? 'webp' : 'jpg';
        const name = `${point.point_date}_${crypto.randomUUID().slice(0, 8)}.${ext}`;
        const fileId = await uploadPhoto(folderId, name, contentType, req.body);
        const id = await addPointPhoto(point.id, fileId, contentType, req.body.length, req.user.email);
        return res.status(201).json({ success: true, id });
      } catch (err: any) {
        console.error('[Points] Upload photo error:', err);
        return res.status(502).json({ success: false, error: 'Google Drive n\'a pas accepté la photo. Réessayez.' });
      }
    }
  );

  // Shows a photo to a signed-in user (the Drive files are never public)
  app.get('/api/photos/:photoId', async (req: any, res) => {
    if (!UUID_RE.test(req.params.photoId)) return res.status(404).end();
    try {
      const photo = await getPhotoFile(req.params.photoId);
      if (!photo || !isPhotoStorageConfigured()) return res.status(404).end();
      const { data, contentType } = await downloadPhoto(photo.storage_key);
      res.setHeader('Content-Type', photo.content_type || contentType);
      res.setHeader('Cache-Control', 'private, max-age=86400');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      return res.send(data);
    } catch (err: any) {
      console.error('[Photos] Read error:', err?.message || err);
      return res.status(502).end();
    }
  });

  /**
   * Matches a photo of the point:
   * - { parcel_id }: an existing parcel (number read on the label);
   * - { new_parcel: { tracking_number?, invoice_ids } }: a parcel not announced
   *   (or label unreadable), created for invoices of one supplier;
   * - { parcel_id: null }: back to "to match" (the parcel keeps its state).
   * The parcel is confirmed "received" at the point date (unless already received).
   */
  app.patch('/api/reception-points/:id/photos/:photoId', requireRole('SUPPLY_CHAIN'), async (req: any, res) => {
    if (!UUID_RE.test(req.params.id) || !UUID_RE.test(req.params.photoId)) {
      return res.status(404).json({ success: false, error: 'Photo introuvable' });
    }
    try {
      const point = await getReceptionPoint(req.params.id);
      if (!point) return res.status(404).json({ success: false, error: 'Point introuvable' });

      if (req.body?.parcel_id === null) {
        if (!(await linkPointPhoto(point.id, req.params.photoId, null, req.user.email))) {
          return res.status(404).json({ success: false, error: 'Photo introuvable' });
        }
        return res.json({ success: true, parcel: null });
      }

      let parcelId: string;
      let created = false;
      if (typeof req.body?.parcel_id === 'string') {
        if (!UUID_RE.test(req.body.parcel_id) || !(await getParcel(req.body.parcel_id))) {
          return res.status(404).json({ success: false, error: 'Colis introuvable' });
        }
        parcelId = req.body.parcel_id;
      } else {
        const input = req.body?.new_parcel;
        if (!input || !isUuidList(input.invoice_ids)) {
          return res.status(400).json({ success: false, error: 'Choisissez la ou les factures de ce colis.' });
        }
        const { value, errors } = validateParcelInput({ ...input, destination: point.destination });
        if (!value) return res.status(400).json({ success: false, error: errors.join(' ') });
        if (!(await applyParcelCarrier(value, res))) return;
        const supplier = await checkParcelInvoices(input.invoice_ids, res);
        if (supplier === undefined) return;
        const outcome = await createParcel(value, input.invoice_ids, supplier, req.user.email);
        parcelId = outcome.id;
        created = !outcome.existed;
      }

      if (!(await linkPointPhoto(point.id, req.params.photoId, parcelId, req.user.email))) {
        return res.status(404).json({ success: false, error: 'Photo introuvable' });
      }
      const parcel = await getParcel(parcelId);
      const confirmed = parcel && parcel.status !== 'received' && parcel.status !== 'search';
      if (confirmed) await setParcelStatus(parcelId, 'received', point.point_date, req.user.email);
      await writeAuditLog({
        entityType: 'PARCEL',
        entityId: parcelId,
        action: 'LINK_POINT_PHOTO',
        actor: req.user,
        details: { point_id: point.id, photo_id: req.params.photoId, created, reception_confirmed: Boolean(confirmed) },
      });
      return res.json({ success: true, created, reception_confirmed: Boolean(confirmed), parcel: await getParcel(parcelId) });
    } catch (err: any) {
      console.error('[Points] Link photo error:', err);
      return res.status(500).json({ success: false, error: 'Impossible de rattacher la photo' });
    }
  });

  app.delete('/api/reception-points/:id/photos/:photoId', requireRole('SUPPLY_CHAIN'), async (req: any, res) => {
    if (!UUID_RE.test(req.params.id) || !UUID_RE.test(req.params.photoId)) {
      return res.status(404).json({ success: false, error: 'Photo introuvable' });
    }
    try {
      const key = await deletePointPhoto(req.params.id, req.params.photoId);
      if (!key) return res.status(404).json({ success: false, error: 'Photo introuvable' });
      await removePhotoObjects([key]);
      await writeAuditLog({
        entityType: 'RECEPTION_POINT',
        entityId: req.params.id,
        action: 'DELETE_POINT_PHOTO',
        actor: req.user,
        details: { photo_id: req.params.photoId },
      });
      return res.json({ success: true });
    } catch (err: any) {
      console.error('[Points] Delete photo error:', err);
      return res.status(500).json({ success: false, error: 'Impossible de supprimer la photo' });
    }
  });

  app.delete('/api/parcels/:id/photos/:photoId', requireRole('SUPPLY_CHAIN'), async (req: any, res) => {
    if (!UUID_RE.test(req.params.id) || !UUID_RE.test(req.params.photoId)) {
      return res.status(404).json({ success: false, error: 'Photo introuvable' });
    }
    try {
      const key = await deleteParcelPhoto(req.params.id, req.params.photoId);
      if (!key) return res.status(404).json({ success: false, error: 'Photo introuvable' });
      await removePhotoObjects([key]);
      await writeAuditLog({
        entityType: 'PARCEL',
        entityId: req.params.id,
        action: 'DELETE_PARCEL_PHOTO',
        actor: req.user,
        details: { photo_id: req.params.photoId },
      });
      return res.json({ success: true });
    } catch (err: any) {
      console.error('[Parcels] Delete photo error:', err);
      return res.status(500).json({ success: false, error: 'Impossible de supprimer la photo' });
    }
  });

  // ---------------------------------------------------------------------------
  // Tracking settings (Paramètres › Intégrations)
  // ---------------------------------------------------------------------------

  app.get('/api/settings/tracking', async (_req, res) => {
    try {
      return res.json({ success: true, settings: await getTrackingSettings() });
    } catch (err: any) {
      console.error('[Settings] Read error:', err);
      return res.status(500).json({ success: false, error: 'Impossible de charger les paramètres' });
    }
  });

  app.put('/api/settings/tracking', requireRole('SUPPLY_CHAIN'), async (req: any, res) => {
    const { value, errors } = validateTrackingSettings(req.body);
    if (errors.length > 0) return res.status(400).json({ success: false, error: errors.join(' ') });
    try {
      const settings = await saveTrackingSettings(value, req.user.email);
      await writeAuditLog({
        entityType: 'SETTINGS',
        entityId: 'tracking',
        action: 'UPDATE_TRACKING_SETTINGS',
        actor: req.user,
        details: value as Record<string, unknown>,
      });
      return res.json({ success: true, settings });
    } catch (err: any) {
      console.error('[Settings] Save error:', err);
      return res.status(500).json({ success: false, error: 'Impossible d\'enregistrer les paramètres' });
    }
  });

  app.delete('/api/digi-invoices/:id', requireRole('SUPPLY_CHAIN'), async (req: any, res) => {
    if (!UUID_RE.test(req.params.id)) {
      return res.status(404).json({ success: false, error: 'Facture introuvable' });
    }
    try {
      const current = await getDigiInvoice(req.params.id);
      if (!current) {
        return res.status(404).json({ success: false, error: 'Facture introuvable' });
      }
      // An Odoo invoice still in Odoo would come back at the next sync
      if (current.source === 'odoo' && !current.odoo_missing) {
        return res.status(409).json({
          success: false,
          error: 'Cette facture est toujours présente dans Odoo : elle ne peut pas être supprimée ici.',
        });
      }
      const removed = await deleteDigiInvoice(req.params.id);
      if (!removed) {
        return res.status(404).json({ success: false, error: 'Facture introuvable' });
      }
      await writeAuditLog({
        entityType: 'DIGI_INVOICE',
        entityId: req.params.id,
        action: 'DELETE_DIGI_INVOICE',
        actor: req.user,
        details: { supplier: removed.supplier_name, ref: removed.ref, source: removed.source },
      });
      return res.json({ success: true });
    } catch (err: any) {
      console.error('[DIGI] Delete invoice error:', err);
      return res.status(500).json({ success: false, error: 'Impossible de supprimer la facture' });
    }
  });

  app.post('/api/digi-invoices/sync-odoo', requireRole('SUPPLY_CHAIN', 'SOURCING'), async (req: any, res) => {
    if (!isOdooConfigured()) {
      return res.status(503).json({ success: false, error: 'La connexion Odoo DIGI LOGISTIC n\'est pas configurée.' });
    }

    // Throttle Odoo syncs across all users
    const limit = await consumeRateLimit('digi:odoo-sync', 1, ODOO_SYNC_MIN_INTERVAL_SECONDS);
    if (!limit.allowed) {
      return sendTooManyRequests(
        res,
        limit.retryAfterSeconds,
        `Une synchronisation Odoo vient d'être lancée. Réessayez dans ${limit.retryAfterSeconds} s.`
      );
    }

    try {
      const startedAt = Date.now();
      const result = await runDigiOdooSync({
        trigger: 'manual',
        actor: req.user,
        timeBudgetMs: ODOO_SYNC_TIME_BUDGET_MS,
      });
      await writeAuditLog({
        entityType: 'DIGI_INVOICE',
        entityId: '*',
        action: 'SYNC_DIGI_INVOICES_ODOO',
        actor: req.user,
        details: { ...result, duration_ms: Date.now() - startedAt },
      });
      return res.json({ success: true, ...result });
    } catch (err: any) {
      console.error('[DIGI] Odoo sync error:', err);
      const message = err instanceof OdooError ? err.publicMessage : 'Échec de la synchronisation Odoo';
      return res.status(502).json({ success: false, error: message });
    }
  });

  // Legacy Google Sheets links (Administration): kept out of the public code
  app.get('/api/admin/links', requireRole('SUPPLY_CHAIN'), (_req, res) => {
    const url = (v?: string) => (v && /^https:\/\//.test(v.trim()) ? v.trim() : null);
    res.json({
      success: true,
      google_sheet_air_url: url(process.env.GOOGLE_SHEET_AIR_URL),
      google_sheet_sea_url: url(process.env.GOOGLE_SHEET_SEA_URL),
    });
  });

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
      console.error('[Neon Status]', err);
      res.status(500).json({
        configured: isNeonConfigured(),
        connected: false,
        error: 'Erreur de test Neon (voir les logs serveur)',
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
      res.status(500).json({ error: 'Erreur d\'initialisation du schéma Neon' });
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
      // Converts the shipments saved before the parcel model (once) before reading them
      try {
        await ensureDigiInvoicesSchema();
      } catch (schemaErr) {
        console.error('[Parcels] Could not prepare the parcel model:', schemaErr);
      }
      const shipments = await getShipmentsFromNeon();
      // Value of each shipment = total of its invoices
      try {
        const { usd_eur_rate } = await getTrackingSettings();
        const totals = await getInvoiceTotalsByShipment(usd_eur_rate);
        for (const shipment of shipments as any[]) {
          const t = totals.get(shipment.id);
          shipment.digi_invoice_count = t?.count ?? 0;
          shipment.digi_invoice_total = t?.total ?? null;
        }
      } catch (totalsErr) {
        console.error('[DIGI] Could not compute shipment values:', totalsErr);
      }
      res.json({
        success: true,
        count: shipments.length,
        shipments,
      });
    } catch (err: any) {
      console.error('Error fetching shipments from Neon:', err);
      res.status(500).json({ error: 'Erreur lors de la récupération des expéditions' });
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
      console.error('Error fetching shipment from Neon:', err);
      res.status(500).json({ error: 'Erreur lors de la récupération de l\'expédition' });
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
      if (!isShipmentStatus(data.global_status)) missing.push('global_status');
      if (!ANTOINE_STATUSES.includes(data.antoine_status)) {
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

      const saved = await upsertShipmentInNeon(applyAutomaticShipmentStatus(data));

      // Attach the tracking number(s) typed in the creation form
      if (typeof data.tracking_no === 'string' && data.tracking_no.trim()) {
        try {
          const linkedCode = await getTrackingCodeForCarrierName(saved.carrier);
          await addTrackingNumbersFromText(
            saved.id,
            data.tracking_no,
            linkedCode && isCarrierCode(linkedCode) ? linkedCode : undefined
          );
        } catch (trackingErr) {
          // The shipment is saved; numbers can still be added from its detail view.
          console.error('[Tracking] Could not attach tracking numbers at creation:', trackingErr);
        }
      }

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
      res.status(500).json({ error: 'Erreur lors de l\'enregistrement' });
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

      if (req.body?.global_status !== undefined && !isShipmentStatus(req.body.global_status)) {
        return res.status(400).json({ success: false, error: 'Statut d\'expédition invalide.' });
      }
      const data = applyAutomaticShipmentStatus({ ...req.body, id: req.params.id });
      const saved = await upsertShipmentInNeon(data);

      // Record which fields changed (names only: values may be large JSON)
      const changedFields = Object.keys(req.body || {}).filter(
        (key) =>
          !['id', 'updated_at', 'created_at', 'alerts', 'digi_invoice_count', 'digi_invoice_total'].includes(key) &&
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
      res.status(500).json({ error: 'Erreur lors de la mise à jour' });
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
      console.error('Error deleting shipment in Neon:', err);
      res.status(500).json({ error: 'Erreur lors de la suppression' });
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
      res.status(500).json({ error: 'Erreur lors de la suppression des données Neon' });
    }
  });

  return app;
}
