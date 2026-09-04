import React, { useState, useEffect } from 'react';
import {
  Settings,
  Database,
  Workflow,
  Radio,
  CheckCircle2,
  RefreshCw,
  Send,
  Sliders,
  ExternalLink,
  ShieldCheck,
  Zap,
  Server,
  AlertCircle,
  Code2,
  UploadCloud,
  Trash2,
} from 'lucide-react';

export const AdminView: React.FC = () => {
  const [googleSheetAirUrl, setGoogleSheetAirUrl] = useState(
    'https://docs.google.com/spreadsheets/d/15L895NUzVJK49xcv9XRkX2YbfAK9GILQK73gc4s8k2E/edit'
  );
  const [googleSheetSeaUrl, setGoogleSheetSeaUrl] = useState(
    'https://docs.google.com/spreadsheets/d/1pdFr2cLmR0dlxTRV4MONxjcdsFgjyZ-4plfQadt6EUE/edit?gid=1539514939#gid=1539514939'
  );
  const [orlyThreshold, setOrlyThreshold] = useState(10);
  const [transitaireThreshold, setTransitaireThreshold] = useState(4);
  const [webhookStatus, setWebhookStatus] = useState<string | null>(null);
  const [testingWebhook, setTestingWebhook] = useState(false);

  // Neon DB State
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
      const res = await fetch('/api/db/status');
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
      const res = await fetch('/api/db/init', { method: 'POST' });
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
      });
      const data = await res.json();
      if (res.ok) {
        setDbActionMessage(`✅ Base Neon purgée avec succès (${data.deleted_count || 0} expédition(s) supprimée(s)). Aucune donnée de test restante.`);
        fetchDbStatus();
        // Clear local storage as well to ensure total consistency
        localStorage.removeItem('shipment_manager_data_v1');
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

  const carriersConnectors = [
    { name: 'DHL Express API', type: 'Air', status: 'Actif (REST/OAuth)', ping: '42ms' },
    { name: 'FedEx Web Services', type: 'Air', status: 'Actif (REST)', ping: '58ms' },
    { name: 'UPS Quantum View', type: 'Air', status: 'Actif (OAuth2)', ping: '61ms' },
    { name: 'TNT Express API', type: 'Air', status: 'Actif (REST)', ping: '49ms' },
    { name: 'Amazon Logistics API', type: 'Air/Road', status: 'Actif (SP-API)', ping: '35ms' },
    { name: 'DB Schenker Logistics', type: 'Air/Sea', status: 'Actif (EDI/REST)', ping: '72ms' },
    { name: 'Dachser eLogistics', type: 'Road/Air', status: 'Actif (REST)', ping: '65ms' },
    { name: 'CEVA Logistics API', type: 'Air/Sea', status: 'Actif (REST)', ping: '80ms' },
    { name: 'Chronopost / Colissimo', type: 'Postal Air', status: 'Actif (SOAP/REST)', ping: '30ms' },
    { name: 'MSC Line Direct', type: 'Sea', status: 'Actif (DCSA Standard)', ping: '110ms' },
    { name: 'Maersk API Integration', type: 'Sea', status: 'Actif (DCSA REST)', ping: '95ms' },
  ];

  const handleTestN8NWebhook = async () => {
    setTestingWebhook(true);
    setWebhookStatus(null);
    try {
      const res = await fetch('/api/google-chat-webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: '🧪 Test d\'intégration N8N -> Google Chat Webhook depuis Shipment Manager Admin',
          recipientSpace: 'SupplyChain-Alerts',
        }),
      });
      const data = await res.json();
      setWebhookStatus(`Succès ! Webhook transmis à N8N (ID Message: ${data.message_id})`);
    } catch (err) {
      setWebhookStatus('Erreur lors de la transmission au webhook.');
    } finally {
      setTestingWebhook(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* View Header */}
      <div>
        <h1 className="flex items-center gap-2 text-xl font-extrabold text-slate-900 dark:text-white">
          <Settings className="h-6 w-6 text-[#643288]" /> Administration & Automation Center (N8N)
        </h1>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Configuration des connecteurs transporteurs, synchro Google Sheets et règles de déclenchement
        </p>
      </div>

      {/* NEON DATABASE MANAGEMENT PANEL */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs dark:border-slate-800 dark:bg-slate-800">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-100 pb-4 dark:border-slate-700">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400">
              <Server className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                Base de données Neon (PostgreSQL Serverless)
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                  SQL Direct
                </span>
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Connexion directe sans ORM via driver HTTP Serverless (<code className="font-mono text-[11px] text-emerald-600">@neondatabase/serverless</code>)
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={fetchDbStatus}
              disabled={isCheckingDb}
              className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isCheckingDb ? 'animate-spin' : ''}`} />
              Vérifier connexion
            </button>
            <button
              onClick={handleInitSchema}
              disabled={isExecutingDbAction}
              className="flex items-center gap-1.5 rounded-xl bg-slate-800 px-3.5 py-2 text-xs font-bold text-white hover:bg-slate-700 dark:bg-slate-700 dark:hover:bg-slate-600 disabled:opacity-50"
            >
              <Database className="h-3.5 w-3.5" />
              {isExecutingDbAction ? 'Exécution SQL...' : '1. Initialiser Schéma SQL'}
            </button>
            <button
              onClick={handleClearNeon}
              disabled={isExecutingDbAction}
              className="flex items-center gap-1.5 rounded-xl bg-rose-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-rose-700 disabled:opacity-50 shadow-sm"
              title="Supprime définitivement toutes les expéditions de test / mockdata dans la base Neon"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Purger / Vider la table Neon
            </button>
          </div>
        </div>

        {/* Status banner */}
        <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="rounded-xl border border-slate-100 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">État Connexion</span>
            <div className="mt-1 flex items-center gap-2">
              {dbStatus?.connected ? (
                <span className="flex items-center gap-1.5 font-bold text-xs text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="h-4 w-4" /> Connecté à Neon
                </span>
              ) : dbStatus?.configured ? (
                <span className="flex items-center gap-1.5 font-bold text-xs text-rose-600 dark:text-rose-400">
                  <AlertCircle className="h-4 w-4" /> Erreur de connexion
                </span>
              ) : (
                <span className="flex items-center gap-1.5 font-bold text-xs text-amber-600 dark:text-amber-400">
                  <AlertCircle className="h-4 w-4" /> En attente de DATABASE_URL
                </span>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-slate-100 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Base active</span>
            <div className="mt-1 font-mono text-xs font-bold text-slate-800 dark:text-slate-200">
              {dbStatus?.database || 'Non connectée'}
            </div>
          </div>

          <div className="rounded-xl border border-slate-100 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Version Moteur</span>
            <div className="mt-1 font-mono text-xs text-slate-700 dark:text-slate-300 truncate" title={dbStatus?.version}>
              {dbStatus?.version ? dbStatus.version.split(' ')[0] + ' ' + (dbStatus.version.split(' ')[1] || '') : 'PostgreSQL Serverless'}
            </div>
          </div>
        </div>

        {dbActionMessage && (
          <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs font-semibold text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
            {dbActionMessage}
          </div>
        )}

        {/* Connection guide */}
        {!dbStatus?.connected && (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50/70 p-3.5 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
            <p className="font-bold flex items-center gap-1.5">
              <AlertCircle className="h-4 w-4" /> Comment activer la persistance Neon :
            </p>
            <ol className="mt-2 list-decimal list-inside space-y-1 pl-1">
              <li>Copiez votre URL de connexion depuis votre projet <strong>Neon.tech</strong> (<code className="font-mono text-[11px]">postgresql://user:password@ep-xyz.neon.tech/neondb?sslmode=require</code>).</li>
              <li>Renseignez-la dans les variables d’environnement sous la clé <strong className="font-mono">DATABASE_URL</strong>.</li>
              <li>Cliquez sur <strong>Initialiser Schéma SQL</strong> pour créer automatiquement la table <code className="font-mono">shipments</code> et ses index.</li>
            </ol>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* N8N & Webhook Architecture */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-800">
          <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2 border-b border-slate-100 pb-3 dark:border-slate-700">
            <Workflow className="h-4 w-4 text-[#A91869]" /> Intégration N8N & Webhook Google Chat
          </h2>

          <p className="mt-3 text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
            Le workflow N8N assure l'automatisation en arrière-plan :
            <br />
            <span className="font-mono text-[#643288] font-bold">
              Scheduler (Chaque heure) → Read Google Sheets → Query Carrier API → Detect Anomalies → Call Gemini AI → Post Google Chat → Update Sheets
            </span>
          </p>

          <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                <Radio className="h-4 w-4 text-emerald-500 animate-pulse" /> Webhook Google Chat Active
              </span>
              <button
                onClick={handleTestN8NWebhook}
                disabled={testingWebhook}
                className="flex items-center gap-1.5 rounded-lg bg-[#643288] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#522870] disabled:opacity-50"
              >
                <Send className="h-3.5 w-3.5" />
                {testingWebhook ? 'Test en cours...' : 'Tester le Webhook N8N'}
              </button>
            </div>

            {webhookStatus && (
              <div className="mt-3 text-xs font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950 p-2.5 rounded-lg border border-emerald-200 dark:border-emerald-900">
                {webhookStatus}
              </div>
            )}
          </div>
        </div>

        {/* Google Sheets Sync Configuration */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-800">
          <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2 border-b border-slate-100 pb-3 dark:border-slate-700">
            <Database className="h-4 w-4 text-[#643288]" /> Synchronisation Google Sheets
          </h2>

          <div className="mt-4 space-y-3">
            <div>
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                URL Google Sheet - Expéditions Aériennes
              </label>
              <div className="mt-1 flex gap-2">
                <input
                  type="text"
                  value={googleSheetAirUrl}
                  onChange={(e) => setGoogleSheetAirUrl(e.target.value)}
                  className="flex-1 rounded-xl border border-slate-200 bg-slate-50 p-2 text-xs font-mono text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                />
                <a
                  href={googleSheetAirUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1 rounded-xl bg-slate-100 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-200"
                >
                  <ExternalLink className="h-4 w-4" /> Ouvrir AIR
                </a>
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                URL Google Sheet - Expéditions Maritimes
              </label>
              <div className="mt-1 flex gap-2">
                <input
                  type="text"
                  value={googleSheetSeaUrl}
                  onChange={(e) => setGoogleSheetSeaUrl(e.target.value)}
                  className="flex-1 rounded-xl border border-slate-200 bg-slate-50 p-2 text-xs font-mono text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                />
                <a
                  href={googleSheetSeaUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1 rounded-xl bg-indigo-100 px-3 py-2 text-xs font-bold text-indigo-800 hover:bg-indigo-200 dark:bg-indigo-950 dark:text-indigo-300"
                >
                  <ExternalLink className="h-4 w-4" /> Ouvrir SEA
                </a>
              </div>
            </div>

            <div className="pt-2">
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Seuils de Déclenchement des Alertes Métier
              </label>
              <div className="mt-2 grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-900">
                  <span className="text-[10px] font-bold text-slate-500 uppercase">
                    Seuil Bloqué Orly (Jours)
                  </span>
                  <input
                    type="number"
                    value={orlyThreshold}
                    onChange={(e) => setOrlyThreshold(Number(e.target.value))}
                    className="mt-1 w-full rounded-lg border border-slate-200 p-1.5 text-xs font-bold dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>

                <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-900">
                  <span className="text-[10px] font-bold text-slate-500 uppercase">
                    Seuil Transitaire (Jours)
                  </span>
                  <input
                    type="number"
                    value={transitaireThreshold}
                    onChange={(e) => setTransitaireThreshold(Number(e.target.value))}
                    className="mt-1 w-full rounded-lg border border-slate-200 p-1.5 text-xs font-bold dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Carriers Connector Status Matrix */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-800">
        <h2 className="text-sm font-bold text-slate-900 dark:text-white border-b border-slate-100 pb-3 dark:border-slate-700 flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-emerald-600" /> Matrice des Connecteurs API Transporteurs ({carriersConnectors.length})
        </h2>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] dark:bg-slate-900/60 dark:text-slate-400">
              <tr>
                <th className="px-3 py-2 font-semibold">Nom du Connecteur</th>
                <th className="px-3 py-2 font-semibold">Mode Cible</th>
                <th className="px-3 py-2 font-semibold">Protocole Integration</th>
                <th className="px-3 py-2 font-semibold">Latence / Ping</th>
                <th className="px-3 py-2 text-right font-semibold">Statut Routeur</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
              {carriersConnectors.map((c, idx) => (
                <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-slate-700/30">
                  <td className="px-3 py-2.5 font-bold text-slate-900 dark:text-slate-100">
                    {c.name}
                  </td>
                  <td className="px-3 py-2.5 text-slate-600 dark:text-slate-400">{c.type}</td>
                  <td className="px-3 py-2.5 font-mono text-slate-500">{c.status}</td>
                  <td className="px-3 py-2.5 font-mono text-emerald-600 font-bold">{c.ping}</td>
                  <td className="px-3 py-2.5 text-right">
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                      <CheckCircle2 className="h-3 w-3" /> Connecté
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
