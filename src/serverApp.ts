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
import { ANTOINE_STATUSES, CONTAINER_TYPES } from './types.js';

import {
  listDigiInvoices,
  getDigiInvoice,
  createDigiInvoice,
  updateDigiInvoice,
  deleteDigiInvoice,
  importDigiInvoices,
  planDigiImport,
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
  updateReceptionPointDate,
  deleteReceptionPoint,
  listPointPhotos,
  addPointPhoto,
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
  checkPhotoStorage,
  PhotoStorageError,
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
  assignParcelTrackingNumber,
  findByTrackingNumber,
  findAmazonOrderInvoices,
  linkParcelInvoices,
  describeParcelOwner,
  receiveBox,
  removeBoxOfPhoto,
  BoxError,
  setBoxesExpected,
  addParcelNumber,
  removeParcelNumber,
  NumberTakenError,
  setParcelCarrierIfEmpty,
  mergeParcelInto,
} from './db/parcels.js';
import { PARCEL_NUMBER_KIND_LABELS, isParcelNumberKind, normalizeParcelNumber, parcelNumberKindText } from './lib/parcelBoxes.js';
import { AMAZON_IMPORT_MAX_ROWS, orderKey } from './lib/amazonReport.js';
import type { AmazonImportLine } from './lib/amazonReport.js';
import { processAmazonGroups, keepPendingAmazonParcels, resolvePendingAmazonParcels } from './services/amazonReportImport.js';
import type { AmazonGroup } from './services/amazonReportImport.js';
import { listPendingAmazonParcels, deletePendingAmazonParcels } from './db/amazonPending.js';
import type { CarrierCode } from './lib/carrierDetection.js';
import { validateDigiInvoiceInput, DIGI_IMPORT_MAX_INVOICES } from './lib/digiInvoices.js';
import { isMirrorConfigured, MirrorError } from './services/odoo/mirrorClient.js';
import {
  createShipmentFromInvoices,
  addInvoicesToShipment,
  removeInvoiceFromShipment,
  confirmShipment,
  unlockShipment,
  confirmedMessage,
  ShipmentGroupingError,
  checkInternalRef,
} from './services/digiShipments.js';
import { findConfirmedShipmentOfInvoices, nextInternalRef } from './db/shipments.js';
import { listReceivedArticles, setLineReceipt } from './db/lineReceipts.js';
import { runDigiOdooSync, getDestinationFilter } from './services/odoo/digiInvoiceSync.js';
import { runInvoicesWithoutParcelDigest } from './services/invoicesWithoutParcelNotifier.js';
import { buildWeeklySummary, runWeeklySummary } from './services/weeklySummaryNotifier.js';
import { postToWebhook, sendChatMessage } from './services/googleChat.js';
import { createChatWebhook, deleteChatWebhook, getChatWebhook, listChatWebhooks, updateChatWebhook } from './db/chatWebhooks.js';
import type { ChatWebhookInput } from './db/chatWebhooks.js';
import { chatWebhookPurposeLabel, isChatWebhookPurpose, isGoogleChatWebhookUrl } from './lib/chatWebhooks.js';
import type { ChatWebhook } from './lib/chatWebhooks.js';
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

    // Same run: list of the invoices still without parcel for the Supply Chain
    // (webhooks "Factures sans colis"). Logged only, never blocks the sync.
    try {
      console.log('[Invoices Cron]', JSON.stringify(await runInvoicesWithoutParcelDigest()));
    } catch (err: any) {
      console.error('[Invoices Cron] Failed:', err);
    }

    if (!isMirrorConfigured()) {
      console.log('[DIGI Cron] Mirror API is not configured: nothing to sync.');
      return res.json({ success: true, skipped: 'MIRROR_NOT_CONFIGURED', parcel_losses: parcelLosses });
    }

    try {
      const startedAt = Date.now();
      const result = await runDigiOdooSync({
        trigger: 'cron',
        actor: null,
        timeBudgetMs: ODOO_SYNC_TIME_BUDGET_MS,
      });
      await resolvePendingAmazonParcels('cron');
      console.log('[DIGI Cron]', JSON.stringify(result));
      return res.json({ success: true, duration_ms: Date.now() - startedAt, ...result, parcel_losses: parcelLosses });
    } catch (err: any) {
      console.error('[DIGI Cron] Failed:', err);
      return res.status(500).json({ success: false, error: 'DIGI invoices sync failed' });
    }
  });

  // Weekly summary for the management, Monday morning (same CRON_SECRET rules as above).
  app.get('/api/cron/weekly-summary', async (req, res) => {
    const cronSecret = process.env.CRON_SECRET;

    if (!cronSecret) {
      console.error('[Weekly Cron] CRON_SECRET is not configured: job not run.');
      return res.status(500).json({ success: false, error: 'Cron configuration error' });
    }

    if (req.headers.authorization !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    try {
      const result = await runWeeklySummary();
      console.log('[Weekly Cron]', JSON.stringify(result));
      return res.json({ success: true, ...result });
    } catch (err: any) {
      console.error('[Weekly Cron] Failed:', err);
      return res.status(500).json({ success: false, error: 'Weekly summary failed' });
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
  // Model changeable without a code change (Vercel variable GEMINI_MODEL)
  const AI_MODEL = process.env.GEMINI_MODEL?.trim() || 'gemini-3.6-flash';

  /** Message for the user from a Gemini failure: says why, not only that it failed. */
  const aiErrorMessage = (err: any): string => {
    const status = Number(err?.status ?? err?.code ?? err?.error?.code);
    const text = String(err?.message || '');
    if (status === 429 || /quota|RESOURCE_EXHAUSTED/i.test(text)) {
      return 'Shipment AI : quota Gemini atteint (trop de demandes ou crédit épuisé). Réessayez plus tard ou vérifiez le compte Google AI.';
    }
    if (/API_KEY_INVALID|API key not valid|PERMISSION_DENIED/i.test(text) || status === 401 || status === 403) {
      return 'Shipment AI : la clé GEMINI_API_KEY est refusée par Google (invalide, expirée ou sans accès). Vérifiez-la dans Vercel.';
    }
    if (status === 404 || /not found|is not supported/i.test(text)) {
      return `Shipment AI : le modèle « ${AI_MODEL} » n'est pas disponible pour cette clé. Changez la variable GEMINI_MODEL dans Vercel.`;
    }
    if (status === 503 || /overloaded|UNAVAILABLE/i.test(text)) {
      return 'Shipment AI : le service Gemini est momentanément surchargé. Réessayez dans quelques minutes.';
    }
    if (status === 400) {
      return 'Shipment AI : la demande a été refusée par Gemini (contexte trop long ou contenu invalide).';
    }
    return 'Erreur lors de la communication avec l\'assistant IA Shipment AI (détail dans les logs du serveur).';
  };

  // --- API ENDPOINTS ---

  // 3. Google Chat — manual reminders (Alerts center, shipment detail).
  // Sent to the webhooks of type "Relances manuelles" configured in Paramètres;
  // a URL sent by the browser is never used (prevents SSRF).
  app.post('/api/google-chat-webhook', requireRole('SUPPLY_CHAIN', 'SOURCING'), async (req, res) => {
    const { message } = req.body || {};
    if (typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ success: false, error: 'Message is required' });
    }
    try {
      const { sent, error } = await sendChatMessage('reminders', message.slice(0, 4000));
      if (sent === 0) return res.status(502).json({ success: false, error });
      return res.json({ success: true, sent, warning: error, delivered_at: new Date().toISOString() });
    } catch (err: any) {
      console.error('[Google Chat Webhook]', err);
      return res.status(500).json({ success: false, error: 'Failed to dispatch Google Chat webhook' });
    }
  });

  // Paramètres › Webhooks Google Chat (SUPPLY_CHAIN only)
  const parseChatWebhook = (body: any, partial: boolean): { value: Partial<ChatWebhookInput>; error: string | null } => {
    const value: Partial<ChatWebhookInput> = {};
    if (!body || typeof body !== 'object') return { value, error: 'Données invalides.' };
    if (!partial || 'name' in body) {
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      if (!name || name.length > 100) return { value, error: 'Nom requis (100 caractères maximum).' };
      value.name = name;
    }
    if (!partial || 'url' in body) {
      const url = typeof body.url === 'string' ? body.url.trim() : '';
      if (!isGoogleChatWebhookUrl(url) || url.length > 2000) {
        return {
          value,
          error: 'Adresse invalide : collez l’URL du webhook Google Chat (https://chat.googleapis.com/v1/spaces/…/messages?key=…&token=…).',
        };
      }
      value.url = url;
    }
    if (!partial || 'purpose' in body) {
      if (!isChatWebhookPurpose(body.purpose)) return { value, error: 'Type de webhook inconnu.' };
      value.purpose = body.purpose;
    }
    if (!partial || 'active' in body) {
      if (body.active !== undefined && typeof body.active !== 'boolean') return { value, error: 'Statut invalide.' };
      value.active = body.active !== false;
    }
    return { value, error: null };
  };

  const auditWebhook = (req: any, id: string, action: string, w: ChatWebhook | null) =>
    // Never the URL: it holds the key and token of the space
    writeAuditLog({
      entityType: 'CHAT_WEBHOOK',
      entityId: id,
      action,
      actor: req.user,
      details: w ? { name: w.name, purpose: w.purpose, active: w.active } : {},
    });

  app.get('/api/settings/chat-webhooks', requireRole('SUPPLY_CHAIN'), async (_req, res) => {
    try {
      return res.json({
        success: true,
        webhooks: await listChatWebhooks(),
        env_fallback: Boolean(process.env.GOOGLE_CHAT_WEBHOOK_URL),
      });
    } catch (err: any) {
      console.error('[Chat webhooks] List error:', err);
      return res.status(500).json({ success: false, error: 'Impossible de charger les webhooks' });
    }
  });

  app.post('/api/settings/chat-webhooks', requireRole('SUPPLY_CHAIN'), async (req: any, res) => {
    const { value, error } = parseChatWebhook(req.body, false);
    if (error) return res.status(400).json({ success: false, error });
    try {
      const webhook = await createChatWebhook(value as ChatWebhookInput, req.user.email);
      await auditWebhook(req, webhook.id, 'CREATE_CHAT_WEBHOOK', webhook);
      return res.json({ success: true, webhook });
    } catch (err: any) {
      console.error('[Chat webhooks] Create error:', err);
      return res.status(500).json({ success: false, error: 'Impossible de créer le webhook' });
    }
  });

  // Sends the daily list "Factures sans colis" now (same as the 8 h run)
  app.post('/api/settings/chat-webhooks/send-invoices-without-parcel', requireRole('SUPPLY_CHAIN'), async (_req, res) => {
    try {
      const result = await runInvoicesWithoutParcelDigest();
      if (result.invoices > 0 && result.sent === 0) return res.status(502).json({ success: false, error: result.error });
      return res.json({ success: true, ...result });
    } catch (err: any) {
      console.error('[Chat webhooks] Digest error:', err);
      return res.status(500).json({ success: false, error: 'Impossible d’envoyer la liste' });
    }
  });

  // Preview of the Monday summary, sent now on one webhook only (even inactive)
  app.post('/api/settings/chat-webhooks/:id/send-weekly-summary', requireRole('SUPPLY_CHAIN'), async (req: any, res) => {
    if (!UUID_RE.test(req.params.id)) return res.status(404).json({ success: false, error: 'Webhook introuvable' });
    try {
      const webhook = await getChatWebhook(req.params.id);
      if (!webhook || webhook.purpose !== 'weekly_summary') {
        return res.status(404).json({ success: false, error: 'Webhook introuvable' });
      }
      const { text } = await buildWeeklySummary();
      const error = await postToWebhook(webhook.url, text);
      if (error) return res.status(502).json({ success: false, error });
      return res.json({ success: true });
    } catch (err: any) {
      console.error('[Chat webhooks] Weekly summary error:', err);
      return res.status(500).json({ success: false, error: 'Impossible d’envoyer l’aperçu' });
    }
  });

  app.put('/api/settings/chat-webhooks/:id', requireRole('SUPPLY_CHAIN'), async (req: any, res) => {
    if (!UUID_RE.test(req.params.id)) return res.status(404).json({ success: false, error: 'Webhook introuvable' });
    const { value, error } = parseChatWebhook(req.body, true);
    if (error) return res.status(400).json({ success: false, error });
    try {
      const webhook = await updateChatWebhook(req.params.id, value, req.user.email);
      if (!webhook) return res.status(404).json({ success: false, error: 'Webhook introuvable' });
      await auditWebhook(req, webhook.id, 'UPDATE_CHAT_WEBHOOK', webhook);
      return res.json({ success: true, webhook });
    } catch (err: any) {
      console.error('[Chat webhooks] Update error:', err);
      return res.status(500).json({ success: false, error: 'Impossible de modifier le webhook' });
    }
  });

  app.delete('/api/settings/chat-webhooks/:id', requireRole('SUPPLY_CHAIN'), async (req: any, res) => {
    if (!UUID_RE.test(req.params.id)) return res.status(404).json({ success: false, error: 'Webhook introuvable' });
    try {
      const before = await getChatWebhook(req.params.id);
      if (!before || !(await deleteChatWebhook(req.params.id))) {
        return res.status(404).json({ success: false, error: 'Webhook introuvable' });
      }
      await auditWebhook(req, req.params.id, 'DELETE_CHAT_WEBHOOK', before);
      return res.json({ success: true });
    } catch (err: any) {
      console.error('[Chat webhooks] Delete error:', err);
      return res.status(500).json({ success: false, error: 'Impossible de supprimer le webhook' });
    }
  });

  // Test message on one webhook (even inactive)
  app.post('/api/settings/chat-webhooks/:id/test', requireRole('SUPPLY_CHAIN'), async (req: any, res) => {
    if (!UUID_RE.test(req.params.id)) return res.status(404).json({ success: false, error: 'Webhook introuvable' });
    try {
      const webhook = await getChatWebhook(req.params.id);
      if (!webhook) return res.status(404).json({ success: false, error: 'Webhook introuvable' });
      const error = await postToWebhook(
        webhook.url,
        `🧪 Test Shipment Manager — webhook « ${webhook.name} » (${chatWebhookPurposeLabel(webhook.purpose)}), envoyé par ${req.user.email}.`
      );
      if (error) return res.status(502).json({ success: false, error });
      return res.json({ success: true });
    } catch (err: any) {
      console.error('[Chat webhooks] Test error:', err);
      return res.status(500).json({ success: false, error: 'Impossible d’envoyer le test' });
    }
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
        model: AI_MODEL,
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
      console.error(`Error calling Gemini API (model ${AI_MODEL}):`, err);
      res.status(502).json({ error: aiErrorMessage(err) });
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
        model: AI_MODEL,
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
      console.error(`Error analyzing shipments (model ${AI_MODEL}):`, err);
      res.status(502).json({ error: aiErrorMessage(err) });
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
      odoo_configured: isMirrorConfigured(),
      dest_partner_name: dest.name,
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
      await resolvePendingAmazonParcels(req.user.email);
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
          error: `Une facture avec le BL ${value.ref} existe déjà (même fournisseur, ou facture Odoo).`,
        });
      }
      console.error('[DIGI] Create invoice error:', err);
      return res.status(500).json({ success: false, error: 'Impossible d\'enregistrer la facture' });
    }
  });

  // Dry run of the import: which invoices would be created, which are already known
  app.post('/api/digi-invoices/import/preview', requireRole('SUPPLY_CHAIN', 'SOURCING'), async (req: any, res) => {
    const items = req.body?.invoices;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, error: 'Aucune facture à vérifier.' });
    }
    if (items.length > DIGI_IMPORT_MAX_INVOICES) {
      return res.status(400).json({ success: false, error: `${DIGI_IMPORT_MAX_INVOICES} factures maximum par import.` });
    }
    const valid = [];
    const rejected: { supplier_name: string | null; ref: string | null; errors: string[] }[] = [];
    for (const item of items) {
      const { value, errors } = validateDigiInvoiceInput(item);
      if (value) valid.push(value);
      else
        rejected.push({
          supplier_name: typeof item?.supplier_name === 'string' ? item.supplier_name : null,
          ref: typeof item?.ref === 'string' ? item.ref : null,
          errors,
        });
    }
    try {
      const { fresh, duplicates } = await planDigiImport(valid);
      const key = (i: { supplier_name: string; ref: string }) => ({ supplier_name: i.supplier_name, ref: i.ref });
      return res.json({ success: true, fresh: fresh.map(key), duplicates: duplicates.map(key), rejected });
    } catch (err: any) {
      console.error('[DIGI] Import preview error:', err);
      return res.status(500).json({ success: false, error: 'Vérification de l’import impossible' });
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
      await resolvePendingAmazonParcels(req.user.email);
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
      if (await refuseIfConfirmed([req.params.id], res)) return;
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
      return res
        .status(err.status)
        .json({ success: false, error: err.message, not_received: err.notReceived, reception_dates: err.receptionDates });
    }
    console.error('[Shipments] Grouping error:', err);
    return res.status(500).json({ success: false, error: fallback });
  };

  /** Sends a 409 and returns true when one of the invoices is in a confirmed shipment (frozen lines and parcels). */
  const refuseIfConfirmed = async (invoiceIds: string[], res: any): Promise<boolean> => {
    const locked = await findConfirmedShipmentOfInvoices(invoiceIds);
    if (!locked) return false;
    res.status(409).json({ success: false, error: confirmedMessage(locked) });
    return true;
  };

  // Confirmation: frozen invoices and parcels, memo of the parcels on Google Chat
  app.post('/api/shipments/:id/confirm', requireRole('SUPPLY_CHAIN'), async (req: any, res) => {
    try {
      return res.json({ success: true, ...(await confirmShipment(req.params.id, req.user)) });
    } catch (err: any) {
      return sendGroupingError(res, err, 'Impossible de confirmer l\'expédition');
    }
  });

  app.post('/api/shipments/:id/unlock', requireRole('SUPPLY_CHAIN'), async (req: any, res) => {
    try {
      return res.json({ success: true, shipment: await unlockShipment(req.params.id, req.user) });
    } catch (err: any) {
      return sendGroupingError(res, err, 'Impossible de déverrouiller l\'expédition');
    }
  });

  // Arrival check in Madagascar: goods lines of the confirmed shipments and their received quantities
  app.get('/api/received-articles', requireRole('SUPPLY_CHAIN', 'SOURCING', 'DIRECTION'), async (req: any, res) => {
    const shipmentId = typeof req.query?.shipment_id === 'string' ? req.query.shipment_id.slice(0, 50) : undefined;
    try {
      return res.json({ success: true, articles: await listReceivedArticles(shipmentId) });
    } catch (err: any) {
      console.error('[Receipts] List error:', err);
      return res.status(500).json({ success: false, error: 'Impossible de charger les articles' });
    }
  });

  app.put('/api/received-articles', requireRole('SUPPLY_CHAIN', 'SOURCING'), async (req: any, res) => {
    const { invoice_id: invoiceId, position, quantity_received: raw } = req.body || {};
    if (typeof invoiceId !== 'string' || !UUID_RE.test(invoiceId) || !Number.isInteger(position)) {
      return res.status(404).json({ success: false, error: 'Article introuvable' });
    }
    const quantity = raw === null || raw === '' ? null : Number(raw);
    if (quantity !== null && (!Number.isFinite(quantity) || quantity < 0 || quantity > 1e9)) {
      return res.status(400).json({ success: false, error: 'Quantité reçue invalide.' });
    }
    try {
      if (!(await setLineReceipt(invoiceId, position, quantity, req.user.email))) {
        return res.status(409).json({ success: false, error: 'Article introuvable ou expédition pas encore confirmée.' });
      }
      await writeAuditLog({
        entityType: 'DIGI_INVOICE',
        entityId: invoiceId,
        action: 'SET_RECEIVED_QUANTITY',
        actor: req.user,
        details: { position, quantity_received: quantity },
      });
      return res.json({ success: true });
    } catch (err: any) {
      console.error('[Receipts] Save error:', err);
      return res.status(500).json({ success: false, error: 'Impossible d\'enregistrer la quantité reçue' });
    }
  });

  /** Sea: next free internal ref of the year (MAR/2026/014), suggested in the creation form. */
  app.get('/api/shipments/next-internal-ref', requireRole('SUPPLY_CHAIN'), async (_req, res) => {
    try {
      return res.json({ success: true, internal_ref: await nextInternalRef('MAR') });
    } catch (err: any) {
      console.error('[Shipments] Next internal ref:', err);
      return res.status(500).json({ success: false, error: 'Impossible de proposer la réf interne' });
    }
  });

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
          mixed_dates: body.mixed_dates === true,
          internal_ref: text(body.internal_ref, 30),
          container_type: CONTAINER_TYPES.includes(body.container_type) ? body.container_type : '',
          shipping_line: text(body.shipping_line, 100),
          weight_kg: body.weight_kg === undefined || body.weight_kg === '' ? 0 : Number(body.weight_kg),
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
      const outcome = await addInvoicesToShipment(
        req.params.id,
        req.body.invoice_ids,
        req.body?.force === true,
        req.user,
        req.body?.mixed_dates === true
      );
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
      if (await refuseIfConfirmed([req.params.id], res)) return;
      const found = await updateDigiInvoice(req.params.id, value, req.user.email);
      if (!found) {
        return res.status(404).json({ success: false, error: 'Facture introuvable' });
      }
      await resolvePendingAmazonParcels(req.user.email);
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
          error: `Une facture avec le BL ${value.ref} existe déjà (même fournisseur, ou facture Odoo).`,
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
      await resolvePendingAmazonParcels(req.user.email);
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
      if (await refuseIfConfirmed([req.params.id], res)) return;
      await updateDirectInvoice(req.params.id, value, req.user.email, req.user.role === 'SUPPLY_CHAIN');
      await resolvePendingAmazonParcels(req.user.email);
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

  // Sort of an invoice: goods (tracked, the default) / services
  app.patch('/api/digi-invoices/:id/triage', requireRole('SUPPLY_CHAIN', 'SOURCING'), async (req: any, res) => {
    if (!UUID_RE.test(req.params.id)) return res.status(404).json({ success: false, error: 'Facture introuvable' });
    const triage = req.body?.triage;
    if (!(INVOICE_TRIAGES as readonly string[]).includes(triage)) {
      return res.status(400).json({ success: false, error: 'Tri invalide.' });
    }
    try {
      if (await refuseIfConfirmed([req.params.id], res)) return;
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
    if (await refuseIfConfirmed(invoiceIds, res)) return undefined;
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

  /** Number of boxes (1..999): null when absent, undefined when invalid. */
  const parseBoxCount = (value: unknown): number | null | undefined => {
    if (value === undefined || value === null || value === '') return null;
    const n = typeof value === 'string' ? Number(value.trim()) : value;
    return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 999 ? n : undefined;
  };

  /** Optional box fields of a photo matched at the point; a string is the error to show. */
  const parseBoxFields = (
    body: any
  ): { piece_number: string | null; box_index: number | null; boxes_expected: number | null } | string => {
    const box_index = parseBoxCount(body?.box_index);
    const boxes_expected = parseBoxCount(body?.boxes_expected);
    if (box_index === undefined) return 'N° de boîte (x) invalide.';
    if (boxes_expected === undefined) return 'Nombre de boîtes (N) invalide.';
    if (box_index !== null && boxes_expected !== null && box_index > boxes_expected) return 'La boîte x ne peut pas dépasser N.';
    let piece_number: string | null = null;
    if (typeof body?.piece_number === 'string' && body.piece_number.trim()) {
      piece_number = normalizeParcelNumber('piece', body.piece_number);
      if (!piece_number || piece_number.length > 100) return 'N° de pièce invalide.';
    }
    return { piece_number, box_index, boxes_expected };
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
      const [parcels, invoicesWithoutParcel] = await Promise.all([listParcels(), listGoodsInvoicesWithoutParcel()]);
      return res.json({
        success: true,
        parcels,
        invoices_without_parcel: invoicesWithoutParcel,
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

  /** Contents of a parcel: its invoices with their lines (aperçu depuis les suivis). */
  app.get('/api/parcels/:id/contents', requireRole('SUPPLY_CHAIN', 'SOURCING', 'DIRECTION'), async (req: any, res) => {
    if (!UUID_RE.test(req.params.id)) return res.status(404).json({ success: false, error: 'Colis introuvable' });
    try {
      const parcel = await getParcel(req.params.id);
      if (!parcel) return res.status(404).json({ success: false, error: 'Colis introuvable' });
      const invoices = (await Promise.all(parcel.invoices.map((i) => getDigiInvoice(i.id)))).filter(Boolean).map((inv) => ({
        id: inv!.id,
        ref: inv!.ref,
        supplier_display: inv!.supplier_display,
        invoice_date: inv!.invoice_date,
        amazon_order_ref: inv!.amazon_order_ref,
        amount_total: inv!.amount_total,
        currency: inv!.currency,
        lines: inv!.lines,
      }));
      return res.json({ success: true, invoices });
    } catch (err: any) {
      console.error('[Parcels] Contents error:', err);
      return res.status(500).json({ success: false, error: 'Impossible de charger le contenu du colis' });
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
      // BL typed in the form: another number of the parcel, refused when another parcel has it
      const bl =
        typeof req.body?.bl_number === 'string' && req.body.bl_number.trim()
          ? normalizeParcelNumber('supplier', req.body.bl_number)
          : null;
      if (bl && bl.length > 100) return res.status(400).json({ success: false, error: 'BL : 100 caractères maximum.' });
      const blOwner = bl ? (await findByTrackingNumber(bl))?.id ?? null : null;
      const numberOwner = value.tracking_number ? (await findByTrackingNumber(value.tracking_number))?.id ?? null : null;
      if (blOwner && blOwner !== numberOwner) {
        return res.status(409).json({ success: false, error: `Le BL ${bl} est déjà utilisé par le ${await describeParcelOwner(blOwner)}.` });
      }

      const { id, existed, matched } = await createParcel(value, invoiceIds, supplier, req.user.email);
      if (bl && blOwner !== id) {
        try {
          await addParcelNumber(id, bl, 'supplier', req.user.email);
        } catch (err: any) {
          // The BL is the number just given (same text): nothing to add
          if (!(err instanceof NumberTakenError)) throw err;
        }
      }
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
          bl_number: bl,
          carrier: value.carrier,
          destination: value.destination,
          invoice_ids: invoiceIds,
          received: receivedNow,
          matched_by: matched,
        },
      });
      // Found by another number of the parcel: told to the user ("trouvé par son BL")
      return res
        .status(existed ? 200 : 201)
        .json({ success: true, existed, matched_by: matched, parcel: await getParcel(id) });
    } catch (err: any) {
      console.error('[Parcels] Create error:', err);
      return res.status(500).json({ success: false, error: 'Impossible d\'enregistrer le colis' });
    }
  });

  /**
   * Amazon shipment report: { destination, rows: [{ line, order_ref, tracking_number,
   * carrier_text?, expected_delivery? }], apply }. Each tracking number becomes a
   * parcel of the invoice(s) of its Amazon order: a parcel announced without
   * number gets it first, a known number gets the invoice. Without `apply`,
   * only the preview of what would be done.
   */
  /** Amazon report numbers waiting for their invoice (page Colis vers Orly / Rouen). */
  app.get('/api/parcels/amazon-pending', async (req: any, res) => {
    const destination = req.query?.destination;
    if (!isParcelDestination(destination)) return res.status(400).json({ success: false, error: 'Destination invalide.' });
    try {
      const pending = (await listPendingAmazonParcels()).filter((p) => p.destination === destination);
      return res.json({ success: true, pending });
    } catch (err: any) {
      console.error('[Parcels] Amazon pending list error:', err);
      return res.status(500).json({ success: false, error: 'Impossible de charger les colis en attente de facture' });
    }
  });

  /** Removed by hand (order cancelled, returned, never invoiced). */
  app.delete('/api/parcels/amazon-pending/:number', requireRole('SUPPLY_CHAIN', 'SOURCING'), async (req: any, res) => {
    const number = String(req.params.number || '').trim().slice(0, 100);
    if (!number) return res.status(404).json({ success: false, error: 'N° introuvable' });
    try {
      await deletePendingAmazonParcels([number]);
      await writeAuditLog({
        entityType: 'PARCEL',
        entityId: '*',
        action: 'DELETE_AMAZON_PENDING',
        actor: req.user,
        details: { tracking_number: number },
      });
      return res.json({ success: true });
    } catch (err: any) {
      console.error('[Parcels] Amazon pending delete error:', err);
      return res.status(500).json({ success: false, error: 'Impossible de retirer ce n°' });
    }
  });

  app.post('/api/parcels/import-amazon', requireRole('SUPPLY_CHAIN', 'SOURCING'), async (req: any, res) => {
    const destination = req.body?.destination;
    const rows = req.body?.rows;
    const apply = req.body?.apply === true;
    if (!isParcelDestination(destination)) return res.status(400).json({ success: false, error: 'Destination invalide.' });
    if (!Array.isArray(rows) || rows.length === 0 || rows.length > AMAZON_IMPORT_MAX_ROWS) {
      return res.status(400).json({ success: false, error: `Le rapport doit contenir de 1 à ${AMAZON_IMPORT_MAX_ROWS} lignes.` });
    }
    const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
    try {
      // One parcel per tracking number, possibly for several orders
      const groups = new Map<
        string,
        AmazonGroup
      >();
      const lines: AmazonImportLine[] = [];
      for (const r of rows) {
        const line = Number.isInteger(r?.line) ? r.line : 0;
        const orderRef = text(r?.order_ref, 100);
        const raw = text(r?.tracking_number, 120);
        const detected = detectTrackingNumber(raw);
        if (!orderRef || !detected.number || detected.number.length > 100) {
          lines.push({ line, order_ref: orderRef, tracking_number: raw, outcome: 'invalid_tracking', invoice_refs: [] });
          continue;
        }
        const g = groups.get(detected.number) ?? {
          number: detected.number,
          carrier: detected.carrier,
          carrierText: text(r?.carrier_text, 100),
          expected: typeof r?.expected_delivery === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.expected_delivery) ? r.expected_delivery : null,
          sources: [],
          lines: [],
        };
        // Amazon invoice number of the row (several invoices per order: one per seller)
        g.sources.push({ order: orderKey(orderRef), ref: orderKey(text(r?.invoice_ref, 100)) });
        g.lines.push({ line, order_ref: orderRef });
        groups.set(detected.number, g);
      }

      const list = Array.from(groups.values());
      const done = await processAmazonGroups(list, destination, apply, req.user.email);
      lines.push(...done.lines);
      lines.sort((a, b) => a.line - b.line);
      const counts = done.counts;
      // Orders without invoice: kept, their parcels are made when the invoice arrives
      if (apply) await keepPendingAmazonParcels(list, done.outcomes, destination, req.user.email);

      if (apply) {
        await writeAuditLog({
          entityType: 'PARCEL',
          entityId: '*',
          action: 'IMPORT_AMAZON_REPORT',
          actor: req.user,
          details: { destination, rows: rows.length, parcels: groups.size, counts },
        });
      }
      return res.json({ success: true, applied: apply, counts, lines });
    } catch (err: any) {
      console.error('[Parcels] Amazon import error:', err);
      return res.status(500).json({ success: false, error: "Impossible d'importer le rapport Amazon" });
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
        const owner =
          err.existingId === req.params.id ? 'un autre n° de ce colis' : `utilisé par le ${await describeParcelOwner(err.existingId)}`;
        return res.status(409).json({ success: false, error: `Le n° de suivi ${value.tracking_number} est déjà ${owner}.` });
      }
      console.error('[Parcels] Update error:', err);
      return res.status(500).json({ success: false, error: 'Impossible de modifier le colis' });
    }
  });

  /**
   * Other numbers of a parcel (supplier, carrier, box): any of them finds the
   * parcel. A number belongs to one parcel only (main number or other).
   */
  app.post('/api/parcels/:id/numbers', requireRole('SUPPLY_CHAIN', 'SOURCING'), async (req: any, res) => {
    if (!UUID_RE.test(req.params.id)) return res.status(404).json({ success: false, error: 'Colis introuvable' });
    const kind = req.body?.kind;
    if (!isParcelNumberKind(kind)) return res.status(400).json({ success: false, error: 'Type de n° invalide.' });
    const number = typeof req.body?.number === 'string' ? normalizeParcelNumber(kind, req.body.number) : '';
    if (!number || number.length > 100) return res.status(400).json({ success: false, error: 'N° invalide.' });
    try {
      const parcel = await getParcel(req.params.id);
      if (!parcel) return res.status(404).json({ success: false, error: 'Colis introuvable' });
      const added = await addParcelNumber(parcel.id, number, kind, req.user.email);
      await writeAuditLog({
        entityType: 'PARCEL',
        entityId: parcel.id,
        action: 'ADD_PARCEL_NUMBER',
        actor: req.user,
        details: { number, kind, tracking_number: parcel.tracking_number },
      });
      return res.status(201).json({ success: true, number: added, parcel: await getParcel(parcel.id) });
    } catch (err: any) {
      if (err instanceof NumberTakenError) {
        const owner = err.ownerId === req.params.id ? 'déjà un n° de ce colis' : `déjà utilisé par le ${await describeParcelOwner(err.ownerId)}`;
        return res.status(409).json({ success: false, error: `Le ${parcelNumberKindText(kind)} ${number} est ${owner}.` });
      }
      console.error('[Parcels] Add number error:', err);
      return res.status(500).json({ success: false, error: "Impossible d'ajouter ce n°" });
    }
  });

  app.delete('/api/parcels/:id/numbers/:numberId', requireRole('SUPPLY_CHAIN', 'SOURCING'), async (req: any, res) => {
    if (!UUID_RE.test(req.params.id) || !UUID_RE.test(req.params.numberId)) {
      return res.status(404).json({ success: false, error: 'N° introuvable' });
    }
    try {
      const removed = await removeParcelNumber(req.params.id, req.params.numberId);
      if (!removed) return res.status(404).json({ success: false, error: 'N° introuvable' });
      await writeAuditLog({
        entityType: 'PARCEL',
        entityId: req.params.id,
        action: 'REMOVE_PARCEL_NUMBER',
        actor: req.user,
        details: { number: removed.number, kind: removed.kind },
      });
      return res.json({ success: true, parcel: await getParcel(req.params.id) });
    } catch (err: any) {
      console.error('[Parcels] Remove number error:', err);
      return res.status(500).json({ success: false, error: 'Impossible de supprimer ce n°' });
    }
  });

  // Boxes announced (supplier notice, "x of N" of the label); null = unknown (no "Reçu partiel" alert)
  app.patch('/api/parcels/:id/boxes-expected', requireRole('SUPPLY_CHAIN', 'SOURCING'), async (req: any, res) => {
    if (!UUID_RE.test(req.params.id)) return res.status(404).json({ success: false, error: 'Colis introuvable' });
    const boxes = parseBoxCount(req.body?.boxes_expected);
    if (boxes === undefined) return res.status(400).json({ success: false, error: 'Nombre de boîtes invalide (1 à 999).' });
    try {
      const previous = await setBoxesExpected(req.params.id, boxes, req.user.email);
      if (previous === undefined) return res.status(404).json({ success: false, error: 'Colis introuvable' });
      if (previous !== boxes) {
        await writeAuditLog({
          entityType: 'PARCEL',
          entityId: req.params.id,
          action: 'SET_BOXES_EXPECTED',
          actor: req.user,
          details: { from: previous, to: boxes },
        });
      }
      return res.json({ success: true, parcel: await getParcel(req.params.id) });
    } catch (err: any) {
      console.error('[Parcels] Boxes expected error:', err);
      return res.status(500).json({ success: false, error: 'Impossible de modifier le nombre de boîtes' });
    }
  });

  /**
   * Merges a parcel created apart (a box whose label was not found at the
   * point) into the main parcel of the shipment: its boxes, photos, numbers and
   * invoices move, its number becomes a box number, the row is deleted. Same
   * supplier and hub only. Supply Chain.
   */
  app.post('/api/parcels/:id/merge-into', requireRole('SUPPLY_CHAIN'), async (req: any, res) => {
    const principalId = req.body?.principal_id;
    if (!UUID_RE.test(req.params.id) || typeof principalId !== 'string' || !UUID_RE.test(principalId)) {
      return res.status(404).json({ success: false, error: 'Colis introuvable' });
    }
    if (principalId === req.params.id) return res.status(400).json({ success: false, error: 'Choisissez un autre colis principal.' });
    const boxes = parseBoxCount(req.body?.boxes_expected);
    if (boxes === undefined) return res.status(400).json({ success: false, error: 'Nombre de boîtes invalide (1 à 999).' });
    try {
      const [merged, principal] = await Promise.all([getParcel(req.params.id), getParcel(principalId)]);
      if (!merged || !principal) return res.status(404).json({ success: false, error: 'Colis introuvable' });
      const norm = (s: string | null) => (s || '').trim().toUpperCase();
      if (norm(merged.supplier_name) !== norm(principal.supplier_name)) {
        return res.status(409).json({ success: false, error: 'Les deux colis n\'ont pas le même fournisseur : fusion impossible.' });
      }
      if (merged.destination !== principal.destination) {
        return res.status(409).json({ success: false, error: 'Les deux colis ne vont pas au même hub (Orly / Rouen) : fusion impossible.' });
      }
      if (merged.status === 'search') {
        return res.status(409).json({ success: false, error: 'Ce colis est en avis de recherche : fusion impossible.' });
      }
      await mergeParcelInto(merged, principal, boxes, req.user.email);
      const after = await getParcel(principal.id);
      await writeAuditLog({
        entityType: 'PARCEL',
        entityId: principal.id,
        action: 'MERGE_PARCEL',
        actor: req.user,
        details: {
          merged_id: merged.id,
          merged_tracking_number: merged.tracking_number,
          merged_status: merged.status,
          principal_tracking_number: principal.tracking_number,
          status_before: principal.status,
          status_after: after?.status,
          boxes_after: after?.boxes.length,
          boxes_expected: after?.boxes_expected ?? null,
        },
      });
      return res.json({ success: true, parcel: after });
    } catch (err: any) {
      if (err?.code === '23505') {
        return res.status(409).json({ success: false, error: 'Une boîte du colis fusionné est déjà reçue sur le colis principal.' });
      }
      console.error('[Parcels] Merge error:', err);
      return res.status(500).json({ success: false, error: 'Impossible de fusionner les colis' });
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
      if (await refuseIfConfirmed([req.params.invoiceId], res)) return;
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

  // New date of the point: the parcels it confirmed at the old date follow
  app.patch('/api/reception-points/:id', requireRole('SUPPLY_CHAIN'), async (req: any, res) => {
    if (!UUID_RE.test(req.params.id)) return res.status(404).json({ success: false, error: 'Point introuvable' });
    const pointDate = parseReceptionDate(req.body?.point_date);
    if (!pointDate) return res.status(400).json({ success: false, error: 'Date du point invalide (pas dans le futur).' });
    try {
      const previous = await updateReceptionPointDate(req.params.id, pointDate, req.user.email);
      if (previous === null) return res.status(404).json({ success: false, error: 'Point introuvable' });
      await writeAuditLog({
        entityType: 'RECEPTION_POINT',
        entityId: req.params.id,
        action: 'UPDATE_RECEPTION_POINT',
        actor: req.user,
        details: { point_date: { before: previous, after: pointDate } },
      });
      return res.json({ success: true, point: await getReceptionPoint(req.params.id) });
    } catch (err: any) {
      console.error('[Points] Update error:', err);
      return res.status(500).json({ success: false, error: 'Impossible de modifier le point de réception' });
    }
  });

  // Deletes the point: matched photos stay on their parcel, the others are trashed
  app.delete('/api/reception-points/:id', requireRole('SUPPLY_CHAIN'), async (req: any, res) => {
    if (!UUID_RE.test(req.params.id)) return res.status(404).json({ success: false, error: 'Point introuvable' });
    try {
      const point = await getReceptionPoint(req.params.id);
      if (!point) return res.status(404).json({ success: false, error: 'Point introuvable' });
      const outcome = await deleteReceptionPoint(point.id);
      if (!outcome) return res.status(404).json({ success: false, error: 'Point introuvable' });
      await removePhotoObjects(outcome.removedKeys);
      await writeAuditLog({
        entityType: 'RECEPTION_POINT',
        entityId: point.id,
        action: 'DELETE_RECEPTION_POINT',
        actor: req.user,
        details: {
          destination: point.destination,
          point_date: point.point_date,
          deleted_photos: outcome.removedKeys.length,
          kept_photos: outcome.keptPhotos,
        },
      });
      return res.json({ success: true, deleted_photos: outcome.removedKeys.length, kept_photos: outcome.keptPhotos });
    } catch (err: any) {
      console.error('[Points] Delete error:', err);
      return res.status(500).json({ success: false, error: 'Impossible de supprimer le point de réception' });
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
        // The Drive refusal says what to fix (folder, rights, quota): shown to Supply Chain
        const detail = err instanceof PhotoStorageError ? ` (${err.message})` : '';
        return res.status(502).json({ success: false, error: `Google Drive n'a pas accepté la photo${detail}.` });
      }
    }
  );

  // Step-by-step check of the Google Drive set-up (Supply Chain)
  app.get('/api/photos/diagnostic', requireRole('SUPPLY_CHAIN'), async (_req, res) => {
    try {
      return res.json({ success: true, ...(await checkPhotoStorage()) });
    } catch (err: any) {
      console.error('[Photos] Diagnostic error:', err);
      return res.status(500).json({ success: false, error: err?.message || 'Diagnostic impossible' });
    }
  });

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
   * - { parcel_id }: an existing parcel (number read on the label), optionally
   *   completed by tracking_number (parcel without one), bl_number, carrier_name;
   * - { new_parcel: { tracking_number?, bl_number?, carrier_name?, invoice_ids } }: a parcel not announced
   *   (or label unreadable), created for invoices of one supplier;
   * - { parcel_id: null }: back to "to match": its box is removed (a received
   *   parcel with no box left goes back to "to receive").
   * Each photo matched is one box received at the point date; the parcel is
   * received from its first box. Optional: piece_number (number of the box),
   * box_index / boxes_expected ("x of N"); a different N needs confirm_boxes_expected.
   */
  app.patch('/api/reception-points/:id/photos/:photoId', requireRole('SUPPLY_CHAIN'), async (req: any, res) => {
    if (!UUID_RE.test(req.params.id) || !UUID_RE.test(req.params.photoId)) {
      return res.status(404).json({ success: false, error: 'Photo introuvable' });
    }
    try {
      const point = await getReceptionPoint(req.params.id);
      if (!point) return res.status(404).json({ success: false, error: 'Point introuvable' });

      if (req.body?.parcel_id === null) {
        const removed = await removeBoxOfPhoto(point.id, req.params.photoId, req.user.email);
        if (!removed) return res.status(404).json({ success: false, error: 'Photo introuvable' });
        await writeAuditLog({
          entityType: 'PARCEL',
          entityId: removed.parcel_id,
          action: 'UNRECEIVE_BOX',
          actor: req.user,
          details: {
            point_id: point.id,
            photo_id: req.params.photoId,
            piece_number: removed.piece_number,
            back_to_receive: removed.back_to_receive,
          },
        });
        return res.json({ success: true, parcel: null, back_to_receive: removed.back_to_receive });
      }

      const box = parseBoxFields(req.body);
      if (typeof box === 'string') return res.status(400).json({ success: false, error: box });
      // Box number of another parcel: refused before anything is created
      if (box.piece_number) {
        const owner = await findByTrackingNumber(box.piece_number);
        if (owner && owner.id !== req.body?.parcel_id) {
          return res.status(409).json({
            success: false,
            error: `Le n° de pièce ${box.piece_number} est déjà utilisé par le ${await describeParcelOwner(owner.id)}.`,
          });
        }
      }

      // BL of the parcel (form of the point): refused before anything is created when another parcel has it
      const blInput = typeof req.body?.bl_number === 'string' ? req.body.bl_number : req.body?.new_parcel?.bl_number;
      const bl = typeof blInput === 'string' && blInput.trim() ? normalizeParcelNumber('supplier', blInput) : null;
      if (bl && bl.length > 100) return res.status(400).json({ success: false, error: 'BL : 100 caractères maximum.' });
      let blOwner: string | null = null;
      if (bl) {
        blOwner = (await findByTrackingNumber(bl))?.id ?? null;
        if (blOwner && blOwner !== req.body?.parcel_id) {
          return res.status(409).json({
            success: false,
            error: `Le BL ${bl} est déjà utilisé par le ${await describeParcelOwner(blOwner)} : choisissez ce colis.`,
          });
        }
      }

      let parcelId: string;
      let created = false;
      if (typeof req.body?.parcel_id === 'string') {
        const target = UUID_RE.test(req.body.parcel_id) ? await getParcel(req.body.parcel_id) : null;
        if (!target) return res.status(404).json({ success: false, error: 'Colis introuvable' });
        parcelId = target.id;
        // A parcel announced without number: the number read on the label completes it
        const typed = typeof req.body?.tracking_number === 'string' ? detectTrackingNumber(req.body.tracking_number) : null;
        if (typed?.number && !target.tracking_number) {
          if (!(await assignParcelTrackingNumber(parcelId, typed.number, typed.carrier, req.user.email))) {
            return res.status(409).json({
              success: false,
              error: `Le n° ${typed.number} est déjà utilisé par un autre colis : choisissez ce colis.`,
            });
          }
        }
        // Carrier chosen in the form of the point: only for a parcel without one
        const carrierName = typeof req.body?.carrier_name === 'string' ? req.body.carrier_name.trim() : '';
        if (carrierName && !target.carrier_name) {
          const resolved = await resolveParcelCarrier(carrierName, target.carrier);
          if (!resolved) {
            return res.status(400).json({
              success: false,
              error: `Transporteur « ${carrierName} » inconnu ou désactivé : ajoutez-le dans Paramètres › Transporteurs.`,
            });
          }
          const code = resolved.trackingCode && isCarrierCode(resolved.trackingCode) ? resolved.trackingCode : null;
          await setParcelCarrierIfEmpty(parcelId, resolved.name, code, req.user.email);
        }
      } else if (req.body?.new_parcel?.without_invoice === true) {
        // Received before its invoice is in the base: the invoice is linked later by the same number
        const input = req.body.new_parcel;
        const supplier = typeof input.supplier_name === 'string' ? input.supplier_name.trim().slice(0, 200) : '';
        if (!supplier) return res.status(400).json({ success: false, error: 'Choisissez le fournisseur du colis.' });
        const { value, errors } = validateParcelInput({ ...input, destination: point.destination });
        if (!value) return res.status(400).json({ success: false, error: errors.join(' ') });
        if (!value.tracking_number) {
          return res.status(400).json({ success: false, error: 'Le n° de suivi est obligatoire pour un colis sans facture.' });
        }
        if (!(await applyParcelCarrier(value, res))) return;
        const outcome = await createParcel(value, [], supplier, req.user.email, { createdAtPointId: point.id });
        parcelId = outcome.id;
        created = !outcome.existed;
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
        const outcome = await createParcel(value, input.invoice_ids, supplier, req.user.email, { createdAtPointId: point.id });
        parcelId = outcome.id;
        created = !outcome.existed;
      }

      // The BL becomes another number of the parcel (any of them finds it)
      if (bl && blOwner !== parcelId) {
        try {
          await addParcelNumber(parcelId, bl, 'supplier', req.user.email);
          await writeAuditLog({
            entityType: 'PARCEL',
            entityId: parcelId,
            action: 'ADD_PARCEL_NUMBER',
            actor: req.user,
            details: { number: bl, kind: 'supplier', source: 'point' },
          });
        } catch (err: any) {
          // Taken meanwhile, or the BL is the number just given: the photo is still matched
          if (!(err instanceof NumberTakenError)) throw err;
        }
      }

      const outcome = await receiveBox({
        parcelId,
        pointId: point.id,
        photoId: req.params.photoId,
        pointDate: point.point_date,
        pieceNumber: box.piece_number,
        boxIndex: box.box_index,
        boxesExpected: box.boxes_expected,
        confirmBoxesExpected: req.body?.confirm_boxes_expected === true,
        actorEmail: req.user.email,
      });
      await writeAuditLog({
        entityType: 'PARCEL',
        entityId: parcelId,
        action: 'LINK_POINT_PHOTO',
        actor: req.user,
        details: { point_id: point.id, photo_id: req.params.photoId, created, reception_confirmed: outcome.confirmed },
      });
      await writeAuditLog({
        entityType: 'PARCEL',
        entityId: parcelId,
        action: 'RECEIVE_BOX',
        actor: req.user,
        details: {
          point_id: point.id,
          photo_id: req.params.photoId,
          received_at: point.point_date,
          piece_number: box.piece_number,
          box_index: box.box_index,
        },
      });
      if (outcome.boxes_expected_after !== outcome.boxes_expected_before) {
        await writeAuditLog({
          entityType: 'PARCEL',
          entityId: parcelId,
          action: 'SET_BOXES_EXPECTED',
          actor: req.user,
          details: { from: outcome.boxes_expected_before, to: outcome.boxes_expected_after, source: 'point' },
        });
      }
      return res.json({
        success: true,
        created,
        reception_confirmed: outcome.confirmed,
        duplicate_box_index: outcome.duplicate_index,
        parcel: await getParcel(parcelId),
      });
    } catch (err: any) {
      if (err instanceof BoxError) {
        return res.status(err.status).json({ success: false, error: err.message, code: err.code });
      }
      console.error('[Points] Link photo error:', err);
      return res.status(500).json({ success: false, error: 'Impossible de rattacher la photo' });
    }
  });

  app.delete('/api/reception-points/:id/photos/:photoId', requireRole('SUPPLY_CHAIN'), async (req: any, res) => {
    if (!UUID_RE.test(req.params.id) || !UUID_RE.test(req.params.photoId)) {
      return res.status(404).json({ success: false, error: 'Photo introuvable' });
    }
    try {
      const deleted = await deletePointPhoto(req.params.id, req.params.photoId, req.user.email);
      if (!deleted) return res.status(404).json({ success: false, error: 'Photo introuvable' });
      await removePhotoObjects([deleted.storage_key]);
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
      const key = await deleteParcelPhoto(req.params.id, req.params.photoId, req.user.email);
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
      if (await refuseIfConfirmed([req.params.id], res)) return;
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
    if (!isMirrorConfigured()) {
      return res.status(503).json({ success: false, error: 'L\'API du miroir Odoo DIGI LOGISTIC n\'est pas configurée.' });
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
      await resolvePendingAmazonParcels(req.user.email);
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
      const message = err instanceof MirrorError ? err.publicMessage : 'Échec de la synchronisation Odoo';
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
      // Order reference and LTA: Supply Chain only
      const user = (req as any).user;
      if (
        user?.role !== 'SUPPLY_CHAIN' &&
        (['order_reference', 'bl_awb'] as const).some(
          (key) => req.body?.[key] !== undefined && (req.body[key] || '') !== (previous[key] || '')
        )
      ) {
        return res.status(403).json({ success: false, error: 'Seule la Supply Chain modifie la référence d\'ordre et la LTA.' });
      }
      // Sea internal ref (name of the shipment): Supply Chain only, MAR/2026/014, unique
      const body = { ...req.body };
      const previousRef = (previous.internal_ref || '').trim().toUpperCase();
      if (body.internal_ref === undefined) body.internal_ref = previousRef;
      if (body.container_type === undefined) body.container_type = previous.container_type || '';
      if (body.shipping_line === undefined) body.shipping_line = previous.shipping_line || '';
      const nextRef = String(body.internal_ref || '').trim().toUpperCase();
      if (nextRef !== previousRef) {
        if (user?.role !== 'SUPPLY_CHAIN') {
          return res.status(403).json({ success: false, error: 'Seule la Supply Chain modifie la réf interne.' });
        }
        if (previous.mode !== 'Sea') {
          return res.status(400).json({ success: false, error: 'La réf interne concerne les expéditions maritimes.' });
        }
        try {
          body.internal_ref = await checkInternalRef(nextRef, previous.id);
        } catch (refErr) {
          return sendGroupingError(res, refErr, 'Réf interne invalide');
        }
      }
      if (body.container_type !== undefined && body.container_type !== '' && !CONTAINER_TYPES.includes(body.container_type)) {
        return res.status(400).json({ success: false, error: 'Type d\'envoi invalide.' });
      }
      const data = applyAutomaticShipmentStatus({ ...body, id: req.params.id });
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
      if (previous.confirmed_at) {
        return res.status(409).json({ success: false, error: confirmedMessage(previous) });
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
