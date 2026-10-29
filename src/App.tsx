import React, { useState, useEffect, useMemo } from 'react';

import LoginView from './components/LoginView';
import { Navbar } from './components/Navbar';
import { Sidebar, NavTab } from './components/Sidebar';
import { DashboardView } from './components/DashboardView';
import { TransportTrackingView } from './components/TransportTrackingView';
import { ShipmentDetailModal } from './components/ShipmentDetailModal';
import { AlertsCenterView } from './components/AlertsCenterView';
import { AnalyticsView } from './components/AnalyticsView';
import { AIAssistantBubble } from './components/AIAssistantBubble';
import { SettingsView } from './components/SettingsView';
import { DigiInvoicesView } from './components/DigiInvoicesView';
import { apiJson, fetchAllParcels, fetchTrackingSettings, ParcelsOverview } from './components/digiApi';
import { evaluateParcelAlerts } from './lib/parcelAlerts';
import type { TrackingSettings } from './lib/parcelTracking';
import { buildDigiValueLookup, DigiInvoiceForValue, DigiValueMatch } from './lib/digiShipmentValue';
import { ShipmentInvoicesModal } from './components/ShipmentInvoicesModal';
import { evaluateShipmentRules } from './lib/rulesEngine';
import { Shipment, UserRole, MetricSummary, shipmentValue } from './types';
import { CheckCircle2, AlertCircle, LayoutDashboard, BarChart3 } from 'lucide-react';

type AuthUser = {
  id: string;
  email: string;
  display_name: string;
  role: 'SUPPLY_CHAIN' | 'SOURCING' | 'DIRECTION';

};

export default function App() {
  // --- STATE MANAGEMENT ---

  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  // Shipments state: strictly sourced from Neon PostgreSQL via GET /api/shipments
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [shipmentsError, setShipmentsError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<NavTab>('dashboard');
  // Dashboard & KPI: overview / analytics sub-tabs
  const [dashboardTab, setDashboardTab] = useState<'overview' | 'analytics'>('overview');
  const [assistantOpen, setAssistantOpen] = useState(false);
  const currentRole: UserRole =
  authUser?.role === 'SUPPLY_CHAIN'
    ? 'supply_chain'
    : authUser?.role === 'SOURCING'
      ? 'sourcing'
      : 'direction';
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    try {
      return localStorage.getItem('shipment_manager_theme') === 'dark';
    } catch {
      return false;
    }
  });
  const [globalSearch, setGlobalSearch] = useState('');
  const [selectedShipment, setSelectedShipment] = useState<Shipment | null>(null);
  const [showNewModal, setShowNewModal] = useState(false);
  const [notification, setNotification] = useState<string | null>(null);

  // New shipment = grouping of received invoices (Supply Chain)
  const [newMode, setNewMode] = useState<'Air' | 'Sea'>('Air');

useEffect(() => {
  async function checkAuthentication() {
    try {
      const response = await fetch('/api/auth/me', {
        credentials: 'include',
      });

      if (!response.ok) {
        setAuthUser(null);
        return;
      }

      const data = await response.json();

      if (data.authenticated && data.user) {
        setAuthUser(data.user);
      } else {
        setAuthUser(null);
      }
    } catch (error) {
      console.error('Authentication check failed:', error);
      setAuthUser(null);
    } finally {
      setAuthLoading(false);
    }
  }

  checkAuthentication();
}, []);

  const [dbConnected, setDbConnected] = useState<boolean | null>(null);
  const [isLoadingDb, setIsLoadingDb] = useState(false);

  // Load live data from Neon PostgreSQL on startup - Neon is the sole source of truth
  const loadShipmentsFromNeon = async () => {
    setIsLoadingDb(true);
    setShipmentsError(null);
    try {
      const res = await fetch('/api/shipments', {
        credentials: 'include',
      });
      const data = await res.json().catch(() => ({}));

      if (res.ok && data.success && Array.isArray(data.shipments)) {
        setShipments(data.shipments);
        setDbConnected(true);
        console.log(`[Neon DB] ${data.shipments.length} expédition(s) chargée(s) depuis Neon.`);
      } else {
        const errorMsg =
          data?.message ||
          data?.error ||
          'Impossible de charger les expéditions depuis la base Neon PostgreSQL.';
        setShipments([]);
        setDbConnected(false);
        setShipmentsError(errorMsg);
        showToast(`❌ Erreur Neon: ${errorMsg}`);
      }
    } catch (err: any) {
      const networkMsg =
        err?.message || 'Erreur réseau lors de la communication avec l\'API Neon.';
      setShipments([]);
      setDbConnected(false);
      setShipmentsError(networkMsg);
      showToast(`❌ Erreur de connexion Neon: ${networkMsg}`);
    } finally {
      setIsLoadingDb(false);
    }
  };

  /** Phone / tablet: side menu opened from the top bar. */
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Parcels (supplier → Orly / Rouen): tabs of the air / sea tracking and parcel alerts
  const [parcelsOverview, setParcelsOverview] = useState<ParcelsOverview | null>(null);
  const [parcelsLoading, setParcelsLoading] = useState(false);
  const [parcelsError, setParcelsError] = useState<string | null>(null);
  const [trackingSettings, setTrackingSettings] = useState<TrackingSettings | undefined>(undefined);

  const loadParcels = async () => {
    setParcelsLoading(true);
    setParcelsError(null);
    try {
      setParcelsOverview(await fetchAllParcels());
    } catch (err: any) {
      setParcelsError(err.message);
    } finally {
      setParcelsLoading(false);
    }
  };

  // Load once the session is known: before login the API answers 401.
  // Parcels after the shipments: their first load prepares the parcel tables.
  useEffect(() => {
    if (authUser) {
      loadShipmentsFromNeon().then(loadParcels);
      fetchTrackingSettings().then(setTrackingSettings).catch(() => {});
    }
  }, [authUser?.id]);

  // Fresh parcel states when opening the air / sea tracking
  useEffect(() => {
    if (authUser && (activeTab === 'air' || activeTab === 'sea') && parcelsOverview) loadParcels();
  }, [activeTab]);

  const handleDeleteShipment = async (shipmentId: string) => {
    try {
      const res = await fetch(`/api/shipments/${encodeURIComponent(shipmentId)}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.success) {
        const errMsg = data?.error || 'Échec de la suppression dans Neon PostgreSQL.';
        showToast(`❌ Erreur suppression Neon: ${errMsg}`);
        return;
      }

      // Persisted successfully in Neon -> commit to UI state
      setShipments((prev) => prev.filter((s) => s.id !== shipmentId));
      if (selectedShipment?.id === shipmentId) {
        setSelectedShipment(null);
      }
      showToast(`✅ Expédition ${shipmentId} supprimée de Neon PostgreSQL.`);
    } catch (err: any) {
      showToast(`❌ Erreur réseau lors de la suppression de ${shipmentId}: ${err?.message || 'Erreur inconnue'}`);
    }
  };

  // Dark mode class toggle (the Tailwind `dark:` variant is bound to this class in index.css)
  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    document.documentElement.style.colorScheme = darkMode ? 'dark' : 'light';
    try {
      localStorage.setItem('shipment_manager_theme', darkMode ? 'dark' : 'light');
    } catch {
      // storage unavailable: the theme still applies for this session
    }
  }, [darkMode]);

  // Shipment value = total of the DIGI invoices linked to the shipment; for older
  // shipments without linked invoice, the DIGI invoice matching its Ref FA /
  // invoice number; else cost_eur (the value entered on the shipment). Reloaded when opening the dashboard or
  // the Air / Sea lists so a fresh Odoo sync shows up.
  const [digiValues, setDigiValues] = useState<DigiInvoiceForValue[]>([]);

  useEffect(() => {
    if (!authUser || (activeTab !== 'dashboard' && activeTab !== 'air' && activeTab !== 'sea')) return;
    let cancelled = false;
    apiJson<{ values: DigiInvoiceForValue[] }>('/api/digi-invoices/values')
      .then((data) => {
        if (!cancelled) setDigiValues(data.values || []);
      })
      .catch((err) => console.error('[DIGI] Unable to load invoice values:', err));
    return () => {
      cancelled = true;
    };
  }, [authUser?.id, activeTab]);

  const digiValueFor = useMemo(() => {
    const byReference = buildDigiValueLookup(digiValues);
    return (s: Shipment): DigiValueMatch | null =>
      s.digi_invoice_total != null
        ? {
            amount: s.digi_invoice_total,
            invoiceLabel: s.digi_invoice_count === 1 ? '1 facture DIGI liée' : `${s.digi_invoice_count} factures DIGI liées`,
          }
        : byReference(s);
  }, [digiValues]);
  const valueOfShipment = (s: Shipment) => digiValueFor(s)?.amount ?? shipmentValue(s);

  // Resolved alerts: shared state persisted in Neon (GET /api/alerts/resolved).
  // Other users' changes appear on reload or when the Alerts tab is opened.
  const [resolvedAlertIds, setResolvedAlertIds] = useState<string[]>([]);

  const loadResolvedAlerts = async () => {
    try {
      const res = await fetch('/api/alerts/resolved', { credentials: 'include' });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.success && Array.isArray(data.resolved)) {
        setResolvedAlertIds(data.resolved.map((r: { alert_id: string }) => r.alert_id));
      } else if (res.status !== 401) {
        showToast('❌ Impossible de charger les alertes résolues.');
      }
    } catch {
      showToast('❌ Impossible de charger les alertes résolues (erreur réseau).');
    }
  };

  useEffect(() => {
    // Remove the legacy per-browser copy (business state now lives in Neon)
    try {
      localStorage.removeItem('shipment_manager_resolved_alerts');
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (authUser) {
      loadResolvedAlerts();
    }
  }, [authUser?.id]);

  useEffect(() => {
    if (authUser && activeTab === 'alerts') {
      loadResolvedAlerts();
    }
  }, [activeTab]);

  // Evaluate rules against current shipments (claim messages use the effective value)
  const { shipmentsWithAlerts, allAlerts } = useMemo(() => {
    const evaluated = evaluateShipmentRules(shipments, valueOfShipment);
    // Parcel alerts: lost before the hub, avis de recherche, DIGI invoices not sorted
    const parcelAlerts = parcelsOverview
      ? evaluateParcelAlerts(parcelsOverview.parcels, parcelsOverview.late_triage_invoices)
      : [];
    return { ...evaluated, allAlerts: [...evaluated.allAlerts, ...parcelAlerts] };
  }, [shipments, digiValueFor, parcelsOverview]);

  // Combine alerts with resolved status from state
  const allAlertsWithResolved = useMemo(() => {
    return allAlerts.map((a) => ({
      ...a,
      resolved: resolvedAlertIds.includes(a.id),
    }));
  }, [allAlerts, resolvedAlertIds]);

  // Compute Metrics Summary
  const metrics: MetricSummary = useMemo(() => {
    const total = shipmentsWithAlerts.length;
    const airCount = shipmentsWithAlerts.filter((s) => s.mode === 'Air').length;
    const seaCount = shipmentsWithAlerts.filter((s) => s.mode === 'Sea').length;

    const delaysCount = shipmentsWithAlerts.filter(
      (s) => s.carrier_status === 'Exception / Delay' || (s.alerts && s.alerts.length > 0)
    ).length;

    // At Orly, not departed yet
    const orlyStock = shipmentsWithAlerts.filter((s) => s.global_status === 'En préparation');
    const orlyStockCount = orlyStock.length;

    const orlyOverdueCount = allAlerts.filter(
      (a) => a.rule_code === 'R1_HUB_ORLY_TIMEOUT'
    ).length;

    const criticalAlertsCount = allAlerts.filter((a) => a.severity === 'critical').length;

    const customsBlockedCount = shipmentsWithAlerts.filter(
      (s) => s.customs_status === 'Bloqué Douane' || s.global_status === 'Bloquée douane'
    ).length;

    // Shipments saved before the parcel model, to regroup or delete
    const pendingTransitConfirm = shipmentsWithAlerts.filter((s) => s.needs_review).length;

    const onTimeCount = total - delaysCount;
    const slaComplianceRate = total > 0 ? Math.round((onTimeCount / total) * 100) : 100;

    const totalValueInTransit = shipmentsWithAlerts
      .filter((s) => s.global_status === 'Expédiée vers Mada')
      .reduce((sum, s) => sum + valueOfShipment(s), 0);

    // Former "Perdu Orly" shipments; new losses are tracked on the parcels
    const totalValuePerduOrly = shipmentsWithAlerts
      .filter((s) => s.legacy_global_status === 'Perdu Orly')
      .reduce((sum, s) => sum + valueOfShipment(s), 0);

    return {
      totalShipments: total,
      airCount,
      seaCount,
      delaysCount,
      orlyStockCount,
      orlyOverdueCount,
      criticalAlertsCount,
      customsBlockedCount,
      pendingTransitConfirm,
      slaComplianceRate,
      totalValueInTransit,
      totalValuePerduOrly,
    };
  }, [shipmentsWithAlerts, allAlerts, digiValueFor]);

  async function handleLogout() {
  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'include',
    });
  } catch (error) {
    console.error('Logout error:', error);
  } finally {
    // Drop the previous user's data so the next login starts clean
    setAuthUser(null);
    setShipments([]);
    setShipmentsError(null);
    setDbConnected(null);
    setResolvedAlertIds([]);
    setSelectedShipment(null);
    setShowNewModal(false);
    setGlobalSearch('');
    setActiveTab('dashboard');
    setDashboardTab('overview');
    setAssistantOpen(false);
    setDigiValues([]);
  }
}

  // Handlers
  const handleSaveShipment = async (updated: Shipment) => {
    try {
      const res = await fetch(`/api/shipments/${encodeURIComponent(updated.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(updated),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.success) {
        const errMsg = data?.error || 'Échec de l\'enregistrement dans Neon PostgreSQL.';
        showToast(`❌ Erreur mise à jour Neon: ${errMsg}`);
        return;
      }

      // The value from the DIGI invoices is computed by the list endpoint only
      const savedShipment: Shipment = {
        ...(data.shipment || updated),
        digi_invoice_count: updated.digi_invoice_count,
        digi_invoice_total: updated.digi_invoice_total,
      };
      setShipments((prev) => prev.map((s) => (s.id === savedShipment.id ? savedShipment : s)));
      // Refresh the open detail view only: inline edits in the lists must not open it
      setSelectedShipment((prev) => (prev && prev.id === savedShipment.id ? savedShipment : prev));
      showToast(`✅ Expédition ${savedShipment.id} mise à jour dans Neon PostgreSQL.`);
    } catch (err: any) {
      showToast(`❌ Erreur réseau lors de la mise à jour: ${err?.message || 'Erreur inconnue'}`);
    }
  };

  const handleResolveAlert = async (alertId: string) => {
    const alert = allAlerts.find((a) => a.id === alertId);
    try {
      const res = await fetch(`/api/alerts/${encodeURIComponent(alertId)}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          shipment_id: alert?.shipment_id,
          rule_code: alert?.rule_code,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) {
        showToast(`❌ Échec de la résolution : ${data?.error || `erreur ${res.status}`}`);
        return;
      }
      setResolvedAlertIds((prev) => (prev.includes(alertId) ? prev : [...prev, alertId]));
      showToast(
        data.already_resolved
          ? `Alerte ${alertId} déjà résolue par ${data.resolved?.resolved_by_email || 'un autre utilisateur'}.`
          : `Alerte ${alertId} marquée comme résolue.`
      );
    } catch {
      showToast('❌ Échec de la résolution (erreur réseau).');
    }
  };

  const handleUnresolveAlert = async (alertId: string) => {
    try {
      const res = await fetch(`/api/alerts/${encodeURIComponent(alertId)}/resolve`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) {
        showToast(`❌ Échec de la réactivation : ${data?.error || `erreur ${res.status}`}`);
        return;
      }
      setResolvedAlertIds((prev) => prev.filter((id) => id !== alertId));
      showToast(`Alerte ${alertId} réactivée.`);
    } catch {
      showToast('❌ Échec de la réactivation (erreur réseau).');
    }
  };

  const handleDispatchGoogleChat = async (message: string, _space?: string) => {
    try {
      const res = await fetch('/api/google-chat-webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ message }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.success) {
        showToast('Relance Google Chat transmise avec succès !');
      } else {
        showToast(`❌ Échec de l'envoi Google Chat : ${data?.error || `erreur ${res.status}`}`);
      }
    } catch (err) {
      console.error(err);
      showToast('❌ Échec de l\'envoi Google Chat (erreur réseau).');
    }
  };

  // Restart the timer on each message: an older timer must not hide a newer toast
  const toastTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = (msg: string) => {
    setNotification(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setNotification(null), 3500);
  };

  // The open shipment follows a reload (invoices added / removed change its supplier, value, history)
  useEffect(() => {
    if (!selectedShipment) return;
    const fresh = shipmentsWithAlerts.find((s) => s.id === selectedShipment.id);
    if (fresh && fresh.updated_at !== selectedShipment.updated_at) setSelectedShipment(fresh);
  }, [shipmentsWithAlerts]);

  const openShipmentById = (id: string) => {
    const linked = shipmentsWithAlerts.find((s) => s.id === id);
    if (linked) setSelectedShipment(linked);
    else showToast('Expédition introuvable : rechargez la liste des expéditions.');
  };

  const canEdit = currentRole === 'supply_chain' || currentRole === 'sourcing';

  // Role permissions mapping
  const allowedTabsByRole: Record<UserRole, NavTab[]> = useMemo(() => ({
    supply_chain: ['dashboard', 'air', 'sea', 'digi', 'alerts', 'settings'],
    sourcing: ['dashboard', 'air', 'sea', 'digi', 'alerts'],
    direction: ['dashboard', 'air', 'sea'], // read only (canEdit false)
  }), []);

  const allowedTabs = allowedTabsByRole[currentRole];
  // « Analyses & SLAs » sub-tab of the dashboard
  const canViewAnalytics = currentRole === 'supply_chain' || currentRole === 'direction';

  useEffect(() => {
    if (!canViewAnalytics && dashboardTab === 'analytics') setDashboardTab('overview');
  }, [canViewAnalytics, dashboardTab]);

  const navigateTab = (tab: NavTab) => {
    if (allowedTabs.includes(tab)) setActiveTab(tab);
  };

  const openNewShipment = (mode?: 'Air' | 'Sea') => {
    if (mode) setNewMode(mode);
    setShowNewModal(true);
  };

  /** Former shipments left without invoice after a regrouping: offered for deletion. */
  const offerToDeleteEmptied = async (emptied: string[]) => {
    for (const id of emptied) {
      if (window.confirm(`L'expédition ${id} (ancien modèle) n'a plus aucune facture. La supprimer ?`)) {
        await handleDeleteShipment(id);
      }
    }
  };

  // The navbar search filters the Air / Sea lists: jump to one when typing elsewhere
  const handleGlobalSearchChange = (value: string) => {
    setGlobalSearch(value);
    if (value.trim() && activeTab !== 'air' && activeTab !== 'sea') {
      navigateTab('air');
    }
  };

  // Ensure active tab stays within allowed tabs for the current role
  useEffect(() => {
    const allowed = allowedTabsByRole[currentRole];
    if (allowed && !allowed.includes(activeTab)) {
      setActiveTab('dashboard');
    }
  }, [currentRole, activeTab, allowedTabsByRole]);

if (authLoading) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <p className="text-sm text-slate-500">
        Chargement...
      </p>
    </div>
  );
}

if (!authUser) {
  return (
    <LoginView
      onLoginSuccess={(user) => {
        setAuthUser(user);
      }}
    />
  );
}

  return (
    <div className="h-dvh w-full overflow-hidden bg-[#F7F7F7] font-sans text-slate-900 transition-colors dark:bg-slate-950 dark:text-slate-100 flex flex-col">
      {/* Top Navigation Bar */}
      <Navbar
        onToggleMobileNav={() => setMobileNavOpen((open) => !open)}
        mobileNavOpen={mobileNavOpen}
        currentRole={currentRole}
        authUser={authUser}
        onLogout={handleLogout}
        onRoleChange={() => {}}
        darkMode={darkMode}
        onToggleDarkMode={() => setDarkMode(!darkMode)}
        globalSearch={globalSearch}
        onSearchChange={handleGlobalSearchChange}
        showSearch={allowedTabsByRole[currentRole].includes('air')}
        alertsCount={allAlertsWithResolved.filter((a) => !a.resolved).length}
        onOpenAssistant={() => setAssistantOpen(true)}
        onOpenAlerts={() => navigateTab('alerts')}
        dbConnected={dbConnected}
        isLoadingDb={isLoadingDb}
        onRefreshDb={loadShipmentsFromNeon}
      />

      {/* Main Container */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Sidebar */}
        <Sidebar
          activeTab={activeTab}
          onTabChange={setActiveTab}
          criticalAlertsCount={metrics.criticalAlertsCount}
          onNewShipment={() => openNewShipment()}
          canEdit={canEdit}
          currentRole={currentRole}
          mobileOpen={mobileNavOpen}
          onCloseMobile={() => setMobileNavOpen(false)}
        />

        {/* Content Area */}
        <main className="min-w-0 flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
          {shipmentsError && (
            <div className="mb-6 flex items-center justify-between rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 shadow-sm dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
              <div className="flex items-center gap-3">
                <AlertCircle className="h-5 w-5 shrink-0 text-red-600 dark:text-red-400" />
                <div>
                  <p className="font-semibold">Erreur de chargement de la base Neon PostgreSQL</p>
                  <p className="text-xs text-red-600 dark:text-red-300">{shipmentsError}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={loadShipmentsFromNeon}
                disabled={isLoadingDb}
                className="ml-4 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-red-700 disabled:opacity-50"
              >
                {isLoadingDb ? 'Tentative en cours...' : 'Réessayer'}
              </button>
            </div>
          )}

          {activeTab === 'dashboard' && (
            <div className="space-y-6">
              {canViewAnalytics && (
                <div role="tablist" className="inline-flex rounded-xl border border-slate-200 bg-white p-1 shadow-xs dark:border-slate-800 dark:bg-slate-900">
                  {([
                    { id: 'overview', label: "Vue d'ensemble", icon: LayoutDashboard },
                    { id: 'analytics', label: 'Analyses et SLAs', icon: BarChart3 },
                  ] as const).map((t) => {
                    const Icon = t.icon;
                    const active = dashboardTab === t.id;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        onClick={() => setDashboardTab(t.id)}
                        className={`flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold transition ${
                          active
                            ? 'bg-[#623387] text-white shadow-sm'
                            : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                        }`}
                      >
                        <Icon className="h-4 w-4" /> {t.label}
                      </button>
                    );
                  })}
                </div>
              )}

              {dashboardTab === 'analytics' && canViewAnalytics ? (
                <AnalyticsView shipments={shipmentsWithAlerts} />
              ) : (
                <DashboardView
                  shipments={shipmentsWithAlerts}
                  alerts={allAlerts}
                  metrics={metrics}
                  allowedTabs={allowedTabs}
                  onNavigateTab={navigateTab}
                  onSelectShipment={setSelectedShipment}
                  onOpenRelanceModal={(alt) => {
                    const linked = shipmentsWithAlerts.find((s) => s.id === alt.shipment_id);
                    if (linked) setSelectedShipment(linked);
                  }}
                  onOpenAssistant={() => setAssistantOpen(true)}
                  onOpenAnalytics={canViewAnalytics ? () => setDashboardTab('analytics') : undefined}
                />
              )}
            </div>
          )}

          {(activeTab === 'air' || activeTab === 'sea') && (
            <TransportTrackingView
              key={activeTab}
              mode={activeTab === 'air' ? 'Air' : 'Sea'}
              shipments={shipmentsWithAlerts}
              globalSearch={globalSearch}
              onClearGlobalSearch={() => setGlobalSearch('')}
              onSelectShipment={setSelectedShipment}
              onOpenShipment={openShipmentById}
              parcelsOverview={parcelsOverview}
              parcelsLoading={parcelsLoading}
              parcelsError={parcelsError}
              onReloadParcels={loadParcels}
              settings={trackingSettings}
              isSupplyChain={currentRole === 'supply_chain'}
              canEdit={canEdit}
              onUpdateShipment={canEdit ? handleSaveShipment : undefined}
              onNewShipment={
                currentRole === 'supply_chain' ? () => openNewShipment(activeTab === 'air' ? 'Air' : 'Sea') : undefined
              }
              digiValueFor={digiValueFor}
            />
          )}

          {activeTab === 'digi' && (
            <DigiInvoicesView
              canDelete={currentRole === 'supply_chain'}
              isSupplyChain={currentRole === 'supply_chain'}
              onOpenShipment={openShipmentById}
              onShipmentsChanged={loadShipmentsFromNeon}
              shipments={shipmentsWithAlerts}
              onDeleteShipment={currentRole === 'supply_chain' ? handleDeleteShipment : undefined}
            />
          )}

          {activeTab === 'alerts' && (
            <AlertsCenterView
              alerts={allAlertsWithResolved}
              shipments={shipmentsWithAlerts}
              onSelectShipment={setSelectedShipment}
              onDispatchGoogleChat={handleDispatchGoogleChat}
              onResolveAlert={handleResolveAlert}
              onUnresolveAlert={handleUnresolveAlert}
              canResolve={canEdit}
            />
          )}
          {activeTab === 'settings' && currentRole === 'supply_chain' && <SettingsView currentUserId={authUser.id} />}
        </main>
      </div>

      {/* Shipment AI: floating chat available on every screen */}
      <AIAssistantBubble
        shipments={shipmentsWithAlerts}
        alerts={allAlerts}
        open={assistantOpen}
        onOpenChange={setAssistantOpen}
      />

      {/* Shipment Detail Modal */}
      {selectedShipment && (
        <ShipmentDetailModal
          key={selectedShipment.id}
          shipment={selectedShipment}
          onClose={() => setSelectedShipment(null)}
          canEdit={canEdit}
          onSave={handleSaveShipment}
          onDelete={currentRole === 'supply_chain' ? handleDeleteShipment : undefined}
          onDispatchGoogleChat={handleDispatchGoogleChat}
          isSupplyChain={currentRole === 'supply_chain'}
          shipments={shipmentsWithAlerts}
          onContentsChanged={async (emptied) => {
            await loadShipmentsFromNeon();
            loadParcels();
            await offerToDeleteEmptied(emptied);
          }}
        />
      )}

      {/* New shipment: grouping of the invoices received at the hub (Supply Chain) */}
      {showNewModal && (
        <ShipmentInvoicesModal
          mode={newMode}
          shipments={shipmentsWithAlerts}
          onClose={() => setShowNewModal(false)}
          onDone={async (shipmentId, emptied) => {
            setShowNewModal(false);
            await loadShipmentsFromNeon();
            loadParcels();
            showToast(`✅ Expédition ${shipmentId} créée.`);
            await offerToDeleteEmptied(emptied);
          }}
        />
      )}

      {/* Floating Notification Toast */}
      {notification && (
        <div className="fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-xs font-bold text-white shadow-2xl dark:bg-white dark:text-slate-900 animate-bounce">
          <CheckCircle2 className="h-4 w-4 text-emerald-400 dark:text-emerald-600" />
          {notification}
        </div>
      )}
    </div>
  );
}
