import React, { useState, useEffect } from 'react';
import {
  Database,
  CheckCircle2,
  RefreshCw,
  ExternalLink,
  Server,
  AlertCircle,
  Trash2,
  Bell,
} from 'lucide-react';
import { CARRIER_CODES } from '../lib/carrierDetection';

// Fixed in src/lib/rulesEngine.ts ("expédition en attente de départ")
const ORLY_ALERT_DAYS = 10;

/** Card used by every settings section, so they all share one layout. */
export const SettingsCard: React.FC<{
  icon: React.ElementType;
  iconClass?: string;
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
}> = ({ icon: Icon, iconClass = 'bg-[#623387]/10 text-[#623387] dark:bg-[#623387]/30 dark:text-[#D7BCE8]', title, description, actions, children }) => (
  <section className="rounded-2xl border border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900">
    <div className="flex flex-col gap-3 border-b border-slate-100 p-5 dark:border-slate-800 md:flex-row md:items-center md:justify-between">
      <div className="flex items-start gap-3">
        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${iconClass}`}>
          <Icon className="h-4 w-4" />
        </div>
        <div>
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">{title}</h2>
          {description && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
    <div className="p-5">{children}</div>
  </section>
);

// ---------------------------------------------------------------------------
// Base de données Neon
// ---------------------------------------------------------------------------

export const NeonDatabasePanel: React.FC = () => {
  const [dbStatus, setDbStatus] = useState<{
    configured: boolean;
    connected: boolean;
    database?: string;
    version?: string;
    error?: string;
    message?: string;
  } | null>(null);
  const [isCheckingDb, setIsCheckingDb] = useState(false);
  const [dbActionMessage, setDbActionMessage] = useState<string | null>(null);
  const [isExecutingDbAction, setIsExecutingDbAction] = useState(false);

  const fetchDbStatus = async () => {
    setIsCheckingDb(true);
    try {
      const res = await fetch('/api/db/status', {
        credentials: 'include',
      });
      const data = await res.json();
      setDbStatus(data);
    } catch (err: any) {
      setDbStatus({
        configured: false,
        connected: false,
        error: err?.message || 'Impossible de contacter le serveur',
      });
    } finally {
      setIsCheckingDb(false);
    }
  };

  useEffect(() => {
    fetchDbStatus();
  }, []);

  const handleInitSchema = async () => {
    setIsExecutingDbAction(true);
    setDbActionMessage(null);
    try {
      const res = await fetch('/api/db/init', {
        method: 'POST',
        credentials: 'include',
      });
      const data = await res.json();
      if (res.ok) {
        setDbActionMessage('✅ ' + (data.message || 'Schéma Neon initialisé avec succès.'));
        fetchDbStatus();
      } else {
        setDbActionMessage('❌ ' + (data.error || 'Erreur lors de l\'initialisation du schéma.'));
      }
    } catch (err: any) {
      setDbActionMessage('❌ Erreur: ' + err.message);
    } finally {
      setIsExecutingDbAction(false);
    }
  };

  const handleClearNeon = async () => {
    if (
      !window.confirm(
        'Êtes-vous certain de vouloir vider toutes les données d’expéditions dans la base Neon ? Cette action supprimera définitivement toutes les données de test/mock.'
      )
    ) {
      return;
    }
    setIsExecutingDbAction(true);
    setDbActionMessage(null);
    try {
      const res = await fetch('/api/shipments/clear-all', {
        method: 'POST',
        credentials: 'include',
      });
      const data = await res.json();
      if (res.ok) {
        setDbActionMessage(`✅ Base Neon purgée avec succès (${data.deleted_count || 0} expédition(s) supprimée(s)). Aucune donnée de test restante.`);
        fetchDbStatus();
        setTimeout(() => {
          window.location.reload();
        }, 1200);
      } else {
        setDbActionMessage('❌ ' + (data.error || 'Erreur lors de la purge de la base.'));
      }
    } catch (err: any) {
      setDbActionMessage('❌ Erreur: ' + err.message);
    } finally {
      setIsExecutingDbAction(false);
    }
  };

  return (
    <div className="space-y-6">
      <SettingsCard
        icon={Server}
        iconClass="bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400"
        title="Base de données Neon (PostgreSQL serverless)"
        description={
          <>
            Connexion directe sans ORM via driver HTTP serverless (
            <code className="font-mono text-[11px] text-emerald-600">@neondatabase/serverless</code>)
          </>
        }
        actions={
          <button
            onClick={fetchDbStatus}
            disabled={isCheckingDb}
            className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isCheckingDb ? 'animate-spin' : ''}`} />
            Vérifier la connexion
          </button>
        }
      >
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="rounded-xl border border-slate-100 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">État connexion</span>
            <div className="mt-1 flex items-center gap-2">
              {dbStatus?.connected ? (
                <span className="flex items-center gap-1.5 text-xs font-bold text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="h-4 w-4" /> Connecté à Neon
                </span>
              ) : dbStatus?.configured ? (
                <span className="flex items-center gap-1.5 text-xs font-bold text-rose-600 dark:text-rose-400">
                  <AlertCircle className="h-4 w-4" /> Erreur de connexion
                </span>
              ) : (
                <span className="flex items-center gap-1.5 text-xs font-bold text-amber-600 dark:text-amber-400">
                  <AlertCircle className="h-4 w-4" /> En attente de DATABASE_URL
                </span>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-slate-100 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Base active</span>
            <div className="mt-1 font-mono text-xs font-bold text-slate-800 dark:text-slate-200">
              {dbStatus?.database || 'Non connectée'}
            </div>
          </div>

          <div className="rounded-xl border border-slate-100 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Version moteur</span>
            <div className="mt-1 truncate font-mono text-xs text-slate-700 dark:text-slate-300" title={dbStatus?.version}>
              {dbStatus?.version ? dbStatus.version.split(' ')[0] + ' ' + (dbStatus.version.split(' ')[1] || '') : 'PostgreSQL serverless'}
            </div>
          </div>
        </div>

        {/* Connection guide */}
        {!dbStatus?.connected && (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50/70 p-3.5 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
            <p className="flex items-center gap-1.5 font-bold">
              <AlertCircle className="h-4 w-4" /> Statut de la connexion Neon :
            </p>
            {dbStatus?.error && (
              <div className="mt-2 rounded-lg border border-rose-200 bg-white/70 p-2.5 font-mono text-[11px] text-rose-700 dark:border-rose-900 dark:bg-slate-900/80 dark:text-rose-300">
                <strong>Diagnostic Neon :</strong> {dbStatus.error}
                {dbStatus.error.includes('password authentication failed') && (
                  <p className="mt-1 font-sans text-xs font-semibold text-slate-700 dark:text-slate-300">
                    💡 Le mot de passe de l'utilisateur <code className="font-mono text-[11px]">neondb_owner</code> a été réinitialisé sur Neon ou ne correspond pas à votre URL actuelle.
                    Copiez la chaîne de connexion récente depuis votre console <strong>Neon.tech</strong> et mettez à jour <code className="font-mono text-[11px]">DATABASE_URL</code>.
                  </p>
                )}
              </div>
            )}
            <ol className="mt-2.5 list-inside list-decimal space-y-1 pl-1">
              <li>Copiez votre URL de connexion depuis votre projet <strong>Neon.tech</strong> (<code className="font-mono text-[11px]">postgresql://user:password@ep-xyz.neon.tech/neondb?sslmode=require</code>).</li>
              <li>Renseignez-la dans les variables d’environnement sous la clé <strong className="font-mono">DATABASE_URL</strong>.</li>
              <li>Cliquez sur <strong>Initialiser le schéma SQL</strong> pour créer automatiquement la table <code className="font-mono">shipments</code> et ses index.</li>
            </ol>
          </div>
        )}
      </SettingsCard>

      <SettingsCard
        icon={Database}
        title="Maintenance de la base"
        description="Actions techniques : à utiliser avec précaution."
      >
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="flex flex-col justify-between gap-3 rounded-xl border border-slate-200 p-4 dark:border-slate-700">
            <div>
              <p className="text-xs font-bold text-slate-900 dark:text-white">Initialiser le schéma SQL</p>
              <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                Crée les tables et index manquants. Sans effet sur les données existantes.
              </p>
            </div>
            <button
              onClick={handleInitSchema}
              disabled={isExecutingDbAction}
              className="flex items-center justify-center gap-1.5 self-start rounded-xl bg-slate-800 px-3.5 py-2 text-xs font-bold text-white hover:bg-slate-700 disabled:opacity-50 dark:bg-slate-700 dark:hover:bg-slate-600"
            >
              <Database className="h-3.5 w-3.5" />
              {isExecutingDbAction ? 'Exécution SQL...' : 'Initialiser le schéma SQL'}
            </button>
          </div>

          <div className="flex flex-col justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50/40 p-4 dark:border-rose-900/60 dark:bg-rose-950/20">
            <div>
              <p className="text-xs font-bold text-rose-700 dark:text-rose-300">Purger les expéditions</p>
              <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                Supprime définitivement toutes les expéditions de la base Neon.
              </p>
            </div>
            <button
              onClick={handleClearNeon}
              disabled={isExecutingDbAction}
              className="flex items-center justify-center gap-1.5 self-start rounded-xl bg-rose-600 px-3.5 py-2 text-xs font-bold text-white shadow-sm hover:bg-rose-700 disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Vider la table des expéditions
            </button>
          </div>
        </div>

        {dbActionMessage && (
          <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs font-semibold text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
            {dbActionMessage}
          </div>
        )}
      </SettingsCard>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Intégrations : Google Sheets, seuils d'alerte (Google Chat : SettingsWebhooksPanel)
// ---------------------------------------------------------------------------

export const IntegrationsPanel: React.FC = () => {
  // Legacy Google Sheets (read only, no sync): URLs come from server env vars, not from the code
  const [sheetLinks, setSheetLinks] = useState<{ air: string | null; sea: string | null }>({ air: null, sea: null });

  useEffect(() => {
    fetch('/api/admin/links', { credentials: 'include' })
      .then((res) => res.json())
      .then((data) => setSheetLinks({ air: data?.google_sheet_air_url ?? null, sea: data?.google_sheet_sea_url ?? null }))
      .catch(() => {});
  }, []);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <SettingsCard
          icon={Database}
          title="Fichiers Google Sheets"
          description="Consultation uniquement : Neon est la seule source de données."
        >
          <div className="space-y-3">
            {[
              { label: 'Expéditions aériennes', url: sheetLinks.air, envVar: 'GOOGLE_SHEET_AIR_URL', button: 'Ouvrir AIR' },
              { label: 'Expéditions maritimes', url: sheetLinks.sea, envVar: 'GOOGLE_SHEET_SEA_URL', button: 'Ouvrir SEA' },
            ].map((sheet) => (
              <div key={sheet.envVar} className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">{sheet.label}</span>
                {sheet.url ? (
                  <a
                    href={sheet.url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 rounded-xl bg-slate-100 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                  >
                    <ExternalLink className="h-4 w-4" /> {sheet.button}
                  </a>
                ) : (
                  <span className="text-[11px] text-slate-400">
                    Non configuré (<code className="font-mono">{sheet.envVar}</code>)
                  </span>
                )}
              </div>
            ))}
          </div>
        </SettingsCard>

        <SettingsCard
          icon={Bell}
          iconClass="bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-300"
          title="Seuils d'alerte métier"
          description="Règles appliquées par le moteur d'alertes."
        >
          <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800">
            <span className="text-[10px] font-bold uppercase text-slate-500">Expédition aérienne en préparation</span>
            <div className="mt-1 text-xs font-bold text-slate-900 dark:text-white">{ORLY_ALERT_DAYS} jours</div>
            <p className="mt-1 text-[10px] text-slate-500">
              Seuil fixé dans le moteur de règles : il n'est pas modifiable depuis l'application.
            </p>
          </div>
        </SettingsCard>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Connecteurs de suivi
// ---------------------------------------------------------------------------

/** Tracking connectors (fixed list) that a carrier of the Settings list can be linked to. */
export const TRACKING_CONNECTOR_CODES = CARRIER_CODES.filter((c) => c !== 'OTHER' && c !== 'UNKNOWN');

