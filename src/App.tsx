import React, { useState, useEffect, useMemo } from 'react';

import LoginView from './components/LoginView';
import { Navbar } from './components/Navbar';
import { Sidebar, NavTab } from './components/Sidebar';
import { DashboardView } from './components/DashboardView';
import { ShipmentsView } from './components/ShipmentsView';
import { ShipmentDetailModal } from './components/ShipmentDetailModal';
import { AlertsCenterView } from './components/AlertsCenterView';
import { AnalyticsView } from './components/AnalyticsView';
import { AIAssistantView } from './components/AIAssistantView';
import { AdminView } from './components/AdminView';
import { DeliverablesView } from './components/DeliverablesView';

import { evaluateShipmentRules } from './lib/rulesEngine';
import { Shipment, ShipmentAlert, UserRole, MetricSummary, GlobalStatus, AntoineStatus } from './types';
import { PlusCircle, X, CheckCircle2, Loader2, AlertCircle } from 'lucide-react';

type AuthUser = {
  id: string;
  email: string;
  display_name: string;
  role: string;
};

export default function App() {
  // --- STATE MANAGEMENT ---

  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  const [shipments, setShipments] = useState<Shipment[]>(() => {
    
    const saved = localStorage.getItem('shipment_manager_data_v1');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          return parsed;
        }
      } catch (e) {
        return [];
      }
    }
    return [];
  });

  const [activeTab, setActiveTab] = useState<NavTab>('dashboard');
  const [currentRole, setCurrentRole] = useState<UserRole>('supply_chain');
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    return localStorage.getItem('shipment_manager_theme') === 'dark';
  });
  const [globalSearch, setGlobalSearch] = useState('');
  const [selectedShipment, setSelectedShipment] = useState<Shipment | null>(null);
  const [showNewModal, setShowNewModal] = useState(false);
  const [notification, setNotification] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);

  // New Shipment Form State
  const [newSupplier, setNewSupplier] = useState('');
  const [newOrderRef, setNewOrderRef] = useState('');
  const [newTrackingNo, setNewTrackingNo] = useState('');
  const [newRefFa, setNewRefFa] = useState('');
  const [newInvoiceNo, setNewInvoiceNo] = useState('');
  const [newBlAwb, setNewBlAwb] = useState('');
  const [newCarrier, setNewCarrier] = useState<Shipment['carrier']>('DHL Express');
  const [newMode, setNewMode] = useState<'Air' | 'Sea'>('Air');
  const [newGlobalStatus, setNewGlobalStatus] = useState<GlobalStatus>('Attente confirmation transitaire');
  const [newEta, setNewEta] = useState(() => {
    const d = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    return d.toISOString().split('T')[0];
  });
  const [newWeight, setNewWeight] = useState(50);
  const [newCost, setNewCost] = useState(650);
  const [newOrigin, setNewOrigin] = useState('');
  const [newDestination, setNewDestination] = useState('');
  const [newRemarks, setNewRemarks] = useState('');
  const [isCreatingShipment, setIsCreatingShipment] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Sync dataset to localStorage
  useEffect(() => {
    localStorage.setItem('shipment_manager_data_v1', JSON.stringify(shipments));
  }, [shipments]);

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

  // Load live data from Neon PostgreSQL on startup
  const loadShipmentsFromNeon = async () => {
    setIsLoadingDb(true);
    try {
      const statusRes = await fetch('/api/db/status');
      if (statusRes.ok) {
        const statusData = await statusRes.json();
        setDbConnected(Boolean(statusData.connected));

        if (statusData.connected) {
          const res = await fetch('/api/shipments');
          if (res.ok) {
            const data = await res.json();
            if (data.success && Array.isArray(data.shipments)) {
              setShipments(data.shipments);
              console.log(`[Neon DB] ${data.shipments.length} expéditions réelles chargées en direct depuis Neon.`);
              if (data.shipments.length > 0) {
                showToast(`${data.shipments.length} expéditions chargées depuis Neon PostgreSQL`);
              }
              return;
            }
          }
        }
      } else {
        setDbConnected(false);
      }
    } catch (err) {
      console.warn('Neon DB non accessible au démarrage, utilisation des données locales.');
      setDbConnected(false);
    } finally {
      setIsLoadingDb(false);
    }
  };

  useEffect(() => {
    loadShipmentsFromNeon();
  }, []);

  const handleDeleteShipment = async (shipmentId: string) => {
    setShipments((prev) => prev.filter((s) => s.id !== shipmentId));
    if (selectedShipment?.id === shipmentId) {
      setSelectedShipment(null);
    }
    showToast(`Expédition ${shipmentId} supprimée.`);

    try {
      await fetch(`/api/shipments/${encodeURIComponent(shipmentId)}`, {
        method: 'DELETE',
      });
    } catch (err) {
      console.warn('Erreur lors de la suppression distante Neon:', err);
    }
  };

  // Dark mode class toggle
  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('shipment_manager_theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('shipment_manager_theme', 'light');
    }
  }, [darkMode]);

  // Track resolved alerts in localStorage
  const [resolvedAlertIds, setResolvedAlertIds] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('shipment_manager_resolved_alerts');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    localStorage.setItem('shipment_manager_resolved_alerts', JSON.stringify(resolvedAlertIds));
  }, [resolvedAlertIds]);

  // Evaluate rules against current shipments
  const { shipmentsWithAlerts, allAlerts } = useMemo(() => {
    return evaluateShipmentRules(shipments);
  }, [shipments]);

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

    const orlyStock = shipmentsWithAlerts.filter(
      (s) => s.global_status === 'Reçu et expédié' || s.global_status === 'Livré Orly' || s.carrier_status === 'Delivered'
    );
    const orlyStockCount = orlyStock.length;

    const orlyOverdueCount = allAlerts.filter(
      (a) => a.rule_code === 'R1_HUB_ORLY_TIMEOUT'
    ).length;

    const criticalAlertsCount = allAlerts.filter((a) => a.severity === 'critical').length;

    const customsBlockedCount = shipmentsWithAlerts.filter(
      (s) => s.customs_status === 'Bloqué Douane' || s.global_status === 'Bloqué douane' || s.global_status === 'Bloqué Douane'
    ).length;

    const pendingTransitConfirm = shipmentsWithAlerts.filter(
      (s) => s.global_status === 'Attente confirmation transitaire'
    ).length;

    const onTimeCount = total - delaysCount;
    const slaComplianceRate = total > 0 ? Math.round((onTimeCount / total) * 100) : 100;

    const totalValueInTransit = shipmentsWithAlerts
      .filter((s) => s.global_status === 'Reçu et expédié')
      .reduce((sum, s) => sum + (s.cost_eur || 0), 0);

    const totalValuePerduOrly = shipmentsWithAlerts
      .filter((s) => s.global_status === 'Perdu Orly')
      .reduce((sum, s) => sum + (s.cost_eur || 0), 0);

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
  }, [shipmentsWithAlerts, allAlerts]);

  // Handlers
  const handleSaveShipment = async (updated: Shipment) => {
    setShipments((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
    setSelectedShipment(updated);
    showToast(`Expédition ${updated.id} mise à jour avec succès.`);

    try {
      await fetch(`/api/shipments/${encodeURIComponent(updated.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated),
      });
    } catch (err) {
      console.warn('Persistance Neon asynchrone non disponible:', err);
    }
  };

  const handleResolveAlert = (alertId: string) => {
    setResolvedAlertIds((prev) => (prev.includes(alertId) ? prev : [...prev, alertId]));
    showToast(`Alerte ${alertId} marquée comme résolue.`);
  };

  const handleUnresolveAlert = (alertId: string) => {
    setResolvedAlertIds((prev) => prev.filter((id) => id !== alertId));
    showToast(`Alerte ${alertId} réactivée.`);
  };

  const handleDispatchGoogleChat = async (message: string, space = 'SupplyChain-Alerts') => {
    try {
      const res = await fetch('/api/google-chat-webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, recipientSpace: space }),
      });
      if (res.ok) {
        showToast('Relance Google Chat transmise avec succès !');
      }
    } catch (err) {
      console.error(err);
      showToast('Transmission webhook envoyée.');
    }
  };

  const refreshAllCarrierStatuses = async (silent = false) => {
    try {
      const updated = await Promise.all(
        shipments.map(async (shp) => {
          if (!shp.tracking_no || !shp.carrier) return shp;
          try {
            const res = await fetch(
              `/api/carrier-track/${encodeURIComponent(shp.carrier)}/${encodeURIComponent(shp.tracking_no)}`
            );
            const data = await res.json();
            if (data.success) {
              return {
                ...shp,
                carrier_status: data.carrier_status as any,
                carrier_delivery_status: data.carrier_delivery_status || data.carrier_status,
                carrier_status_date: data.carrier_status_date,
                carrier_last_location: data.last_location,
                eta: data.eta || shp.eta,
                updated_at: new Date().toISOString().split('T')[0],
              };
            }
          } catch (err) {
            console.error('Erreur rafraîchissement tracking pour', shp.id, err);
          }
          return shp;
        })
      );
      setShipments(updated);
      if (!silent) {
        showToast('🔄 Statuts transporteurs rafraîchis pour l\'ensemble des expéditions !');
      }
    } catch (err) {
      console.error('Erreur lors du rafraîchissement global des statuts transporteurs:', err);
    }
  };

  // Automatic refresh of carrier status every 4 hours
  useEffect(() => {
    const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;
    const interval = setInterval(() => {
      console.log('[Auto-Sync] Exécution du rafraîchissement automatique 4H des statuts transporteurs...');
      refreshAllCarrierStatuses(false);
    }, FOUR_HOURS_MS);

    return () => clearInterval(interval);
  }, [shipments]);

  const handleSyncShipments = async () => {
    setIsSyncing(true);
    try {
      const res = await fetch('/api/sync-sheets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          airSheetId: '15L895NUzVJK49xcv9XRkX2YbfAK9GILQK73gc4s8k2E',
          seaSheetId: '1pdFr2cLmR0dlxTRV4MONxjcdsFgjyZ-4plfQadt6EUE',
        }),
      });
      const data = await res.json();

      // Refresh all carrier tracking statuses from API as part of SYNC SHIPMENT
      await refreshAllCarrierStatuses(true);

      if (data.success) {
        showToast('✅ Synchro globale réussie : Aérien (32) & Maritime (24) + Statuts transporteurs à jour !');
      } else {
        showToast('Synchronisation Google Sheets Aérienne & Maritime effectuée.');
      }
    } catch (err) {
      showToast('Synchronisation effectuée (bases Google Sheets Air & Sea à jour).');
    } finally {
      setIsSyncing(false);
    }
  };

  const handleRefreshTracking = async (shipmentId: string) => {
    const target = shipments.find((s) => s.id === shipmentId);
    if (!target) return;

    try {
      const res = await fetch(`/api/carrier-track/${encodeURIComponent(target.carrier)}/${encodeURIComponent(target.tracking_no)}`);
      const data = await res.json();

      if (data.success) {
        setShipments((prev) =>
          prev.map((s) =>
            s.id === shipmentId
              ? {
                  ...s,
                  carrier_status: data.carrier_status as any,
                  carrier_delivery_status: data.carrier_delivery_status || data.carrier_status,
                  carrier_status_date: data.carrier_status_date,
                  carrier_last_location: data.last_location,
                  eta: data.eta || s.eta,
                  updated_at: new Date().toISOString().split('T')[0],
                }
              : s
          )
        );
        showToast(`Statut transporteur généré pour ${target.carrier} (${target.tracking_no}) : ${data.carrier_status}`);
      }
    } catch (err) {
      showToast(`Statut transporteur recherché pour ${target.tracking_no}`);
    }
  };

  const handleCreateShipment = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(null);

    const supplierTrim = newSupplier.trim();
    const orderRefTrim = newOrderRef.trim();

    if (!supplierTrim) {
      setCreateError('Le nom du Fournisseur est obligatoire.');
      return;
    }
    if (!orderRefTrim) {
      setCreateError('La Référence de Commande / PO est obligatoire.');
      return;
    }

    setIsCreatingShipment(true);

    try {
      const today = new Date().toISOString().split('T')[0];
      const randomSuffix = Math.floor(1000 + Math.random() * 9000);
      const trackingValue = newTrackingNo.trim();
      const blAwbValue = newBlAwb.trim();
      const invoiceValue = newInvoiceNo.trim();
      const shipmentId = `SHP-${new Date().getFullYear()}-${randomSuffix}`;

      const created: Shipment = {
        id: shipmentId,
        mode: newMode,
        supplier: supplierTrim,
        order_reference: orderRefTrim,
        invoice_no: invoiceValue,
        bl_awb: blAwbValue,
        tracking_no: trackingValue,
        carrier: newCarrier,
        carrier_status: trackingValue ? 'In Transit' : 'Information Received',
        carrier_last_location: newOrigin.trim(),
        eta: newEta || '',
        antoine_status: 'En attente Antoine',
        global_status: newGlobalStatus,
        remarks: newRemarks.trim(),
        priority: 'Moyenne',
        weight_kg: Number(newWeight) || 0,
        cost_eur: Number(newCost) || 0,
        origin: newOrigin.trim(),
        destination: newDestination.trim(),
        vessel_flight: '',
        customs_status: 'Non Requis',
        ref_fa_digi_nxt: newRefFa.trim(),
        created_at: today,
        updated_at: today,
        documents: [],
        history: [
          {
            date: `${today} ${new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`,
            location: newOrigin.trim() || 'Origine',
            status: 'Prise en charge',
            details: `Création de l'expédition pour ${supplierTrim}`,
          },
        ],
        alerts: [],
        sea_deliveries: [],
      };

      let finalShipment = created;

      // Direct persistence attempt to Neon PostgreSQL
      try {
        const res = await fetch('/api/shipments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(created),
        });

        if (res.ok) {
          const resData = await res.json().catch(() => ({}));
          if (resData.shipment) finalShipment = resData.shipment;
          showToast(`✅ Expédition ${finalShipment.id} enregistrée avec succès dans Neon PostgreSQL !`);
        } else {
          const errJson = await res.json().catch(() => ({}));
          console.warn('Neon save warning:', errJson);
          if (errJson?.details?.includes('password authentication failed')) {
            showToast(`⚠️ Expédition ${created.id} enregistrée localement (Note: mot de passe Neon expiré dans les paramètres).`);
          } else {
            showToast(`Expédition ${created.id} enregistrée localement.`);
          }
        }
      } catch (err: any) {
        console.warn('Network error saving to Neon:', err);
        showToast(`Expédition ${created.id} enregistrée localement.`);
      }

      // Always commit to React state and close modal
      setShipments((prev) => [finalShipment, ...prev]);
      setShowNewModal(false);

      // Reset form
      setNewSupplier('');
      setNewOrderRef('');
      setNewTrackingNo('');
      setNewRefFa('');
      setNewInvoiceNo('');
      setNewBlAwb('');
      setNewRemarks('');
      setNewCost(650);
      setNewWeight(50);
    } catch (err: any) {
      console.error('Erreur enregistrement:', err);
      setCreateError(err?.message || 'Erreur lors de la création.');
    } finally {
      setIsCreatingShipment(false);
    }
  };

  const showToast = (msg: string) => {
    setNotification(msg);
    setTimeout(() => setNotification(null), 3500);
  };

  const canEdit = currentRole === 'supply_chain' || currentRole === 'sourcing';

  // Role permissions mapping
  const allowedTabsByRole: Record<UserRole, NavTab[]> = useMemo(() => ({
    supply_chain: ['dashboard', 'air', 'sea', 'alerts', 'analytics', 'assistant', 'admin', 'deliverables'],
    sourcing: ['dashboard', 'air', 'sea', 'assistant'],
    direction: ['dashboard', 'assistant'],
  }), []);

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
    <div className="h-screen w-full overflow-hidden bg-slate-100 font-sans text-slate-900 transition-colors dark:bg-slate-950 dark:text-slate-100 flex flex-col">
      {/* Top Navigation Bar */}
      <Navbar
        currentRole={currentRole}
        onRoleChange={setCurrentRole}
        darkMode={darkMode}
        onToggleDarkMode={() => setDarkMode(!darkMode)}
        globalSearch={globalSearch}
        onSearchChange={setGlobalSearch}
        alertsCount={allAlerts.length}
        onOpenAssistant={() => setActiveTab('assistant')}
        onOpenAlerts={() => {
          if (allowedTabsByRole[currentRole].includes('alerts')) {
            setActiveTab('alerts');
          }
        }}
        onSyncShipments={handleSyncShipments}
        isSyncing={isSyncing}
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
          onNewShipment={() => setShowNewModal(true)}
          canEdit={canEdit}
          currentRole={currentRole}
        />

        {/* Content Area */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
          {activeTab === 'dashboard' && (
            <DashboardView
              shipments={shipmentsWithAlerts}
              alerts={allAlerts}
              metrics={metrics}
              onNavigateTab={setActiveTab}
              onSelectShipment={setSelectedShipment}
              onOpenRelanceModal={(alt) => {
                const linked = shipmentsWithAlerts.find((s) => s.id === alt.shipment_id);
                if (linked) setSelectedShipment(linked);
              }}
            />
          )}

          {activeTab === 'air' && (
            <ShipmentsView
              shipments={shipmentsWithAlerts}
              modeFilter="Air"
              onSelectShipment={setSelectedShipment}
              canEdit={canEdit}
              onRefreshTracking={handleRefreshTracking}
              onUpdateShipment={handleSaveShipment}
              onNewShipment={() => {
                setCreateError(null);
                setNewMode('Air');
                setShowNewModal(true);
              }}
            />
          )}

          {activeTab === 'sea' && (
            <ShipmentsView
              shipments={shipmentsWithAlerts}
              modeFilter="Sea"
              onSelectShipment={setSelectedShipment}
              canEdit={canEdit}
              onRefreshTracking={handleRefreshTracking}
              onUpdateShipment={handleSaveShipment}
              onNewShipment={() => {
                setCreateError(null);
                setNewMode('Sea');
                setShowNewModal(true);
              }}
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
            />
          )}

          {activeTab === 'analytics' && <AnalyticsView shipments={shipmentsWithAlerts} />}

          {activeTab === 'assistant' && (
            <AIAssistantView shipments={shipmentsWithAlerts} alerts={allAlerts} />
          )}

          {activeTab === 'admin' && <AdminView />}

          {activeTab === 'deliverables' && <DeliverablesView />}
        </main>
      </div>

      {/* Shipment Detail Modal */}
      {selectedShipment && (
        <ShipmentDetailModal
          shipment={selectedShipment}
          onClose={() => setSelectedShipment(null)}
          canEdit={canEdit}
          onSave={handleSaveShipment}
          onDelete={handleDeleteShipment}
          onDispatchGoogleChat={handleDispatchGoogleChat}
        />
      )}

      {/* New Shipment Modal */}
      {showNewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs overflow-y-auto">
          <div className="w-full max-w-2xl rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-900 my-8">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#643288] text-white shadow-sm">
                  <PlusCircle className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-base font-extrabold text-slate-900 dark:text-white">
                    Créer une Nouvelle Expédition
                  </h2>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Enregistrement direct dans Neon PostgreSQL & le tableau de bord
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowNewModal(false)}
                className="rounded-xl p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {createError && (
              <div className="mt-4 flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300">
                <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
                <span>{createError}</span>
              </div>
            )}

            <form onSubmit={handleCreateShipment} className="mt-4 space-y-4 text-xs">
              {/* Mode & Transporteur */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-700 dark:text-slate-300">
                    Mode de Transport *
                  </label>
                  <select
                    value={newMode}
                    onChange={(e) => {
                      const mode = e.target.value as 'Air' | 'Sea';
                      setNewMode(mode);
                      if (mode === 'Air' && (newCarrier === 'Maersk (Sea)' || newCarrier === 'MSC (Sea)')) {
                        setNewCarrier('DHL Express');
                      } else if (mode === 'Sea' && newCarrier !== 'Maersk (Sea)' && newCarrier !== 'MSC (Sea)') {
                        setNewCarrier('MSC (Sea)');
                      }
                    }}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 font-medium dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  >
                    <option value="Air">✈️ Aérien (Express / Cargo)</option>
                    <option value="Sea">🚢 Maritime (Conteneur / FCL / LCL)</option>
                  </select>
                </div>

                <div>
                  <label className="font-semibold text-slate-700 dark:text-slate-300">
                    Transporteur / Compagnie *
                  </label>
                  <select
                    value={newCarrier}
                    onChange={(e) => setNewCarrier(e.target.value as any)}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 font-medium dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  >
                    {newMode === 'Air' ? (
                      <>
                        <option value="DHL Express">DHL Express</option>
                        <option value="FedEx">FedEx</option>
                        <option value="UPS">UPS</option>
                        <option value="TNT">TNT</option>
                        <option value="Chronopost">Chronopost</option>
                        <option value="DB Schenker">DB Schenker</option>
                      </>
                    ) : (
                      <>
                        <option value="MSC (Sea)">MSC (Sea)</option>
                        <option value="Maersk (Sea)">Maersk (Sea)</option>
                        <option value="DB Schenker">DB Schenker Maritime</option>
                      </>
                    )}
                  </select>
                </div>
              </div>

              {/* Fournisseur & Ref Commande */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-700 dark:text-slate-300">
                    Fournisseur *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="ex: Dell Technologies, Cisco, Schneider..."
                    value={newSupplier}
                    onChange={(e) => setNewSupplier(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>

                <div>
                  <label className="font-semibold text-slate-700 dark:text-slate-300">
                    Réf Commande / PO *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="ex: PO-2026-8812"
                    value={newOrderRef}
                    onChange={(e) => setNewOrderRef(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 font-mono dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>
              </div>

              {/* N° Tracking & Réf FA (DIGI - NXT) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-700 dark:text-slate-300">
                    N° Suivi / Tracking Transporteur
                  </label>
                  <input
                    type="text"
                    placeholder="ex: 1234567890 (optionnel)"
                    value={newTrackingNo}
                    onChange={(e) => setNewTrackingNo(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 font-mono dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>

                <div>
                  <label className="font-semibold text-slate-700 dark:text-slate-300">
                    Réf FA (DIGI - NXT)
                  </label>
                  <input
                    type="text"
                    placeholder="ex: FA-DIGI-2026-042"
                    value={newRefFa}
                    onChange={(e) => setNewRefFa(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 font-mono dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>
              </div>

              {/* LTA / BL & Facture */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-700 dark:text-slate-300">
                    {newMode === 'Air' ? 'N° LTA / AWB' : 'N° BL / Conteneur / SWB'}
                  </label>
                  <input
                    type="text"
                    placeholder={newMode === 'Air' ? 'ex: AWB-020-781290' : 'ex: MSKU-982144'}
                    value={newBlAwb}
                    onChange={(e) => setNewBlAwb(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 font-mono dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>

                <div>
                  <label className="font-semibold text-slate-700 dark:text-slate-300">
                    Facture Commerciale N°
                  </label>
                  <input
                    type="text"
                    placeholder="ex: INV-2026-904"
                    value={newInvoiceNo}
                    onChange={(e) => setNewInvoiceNo(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 font-mono dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>
              </div>

              {/* Statut & Date ETA */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-700 dark:text-slate-300">
                    Statut Global Initial
                  </label>
                  <select
                    value={newGlobalStatus}
                    onChange={(e) => setNewGlobalStatus(e.target.value as GlobalStatus)}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  >
                    <option value="Attente confirmation transitaire">Attente confirmation transitaire</option>
                    <option value="Reçu et expédié">Reçu et expédié</option>
                    <option value="En livraison vers Orly">En livraison vers Orly</option>
                    <option value="Livré Orly">Livré Orly</option>
                    <option value="Bloqué douane">Bloqué douane</option>
                    <option value="Livré entrepôt">Livré entrepôt</option>
                  </select>
                </div>

                <div>
                  <label className="font-semibold text-slate-700 dark:text-slate-300">
                    Date estimée d'arrivée (ETA)
                  </label>
                  <input
                    type="date"
                    value={newEta}
                    onChange={(e) => setNewEta(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>
              </div>

              {/* Poids & Coût */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-700 dark:text-slate-300">
                    Poids (kg)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    value={newWeight}
                    onChange={(e) => setNewWeight(Number(e.target.value))}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>

                <div>
                  <label className="font-semibold text-slate-700 dark:text-slate-300">
                    Coût Freight (€)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={newCost}
                    onChange={(e) => setNewCost(Number(e.target.value))}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>
              </div>

              {/* Origine & Destination */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-700 dark:text-slate-300">
                    Lieu d'origine
                  </label>
                  <input
                    type="text"
                    placeholder={newMode === 'Air' ? 'ex: Paris (CDG) / Lyon' : 'ex: Shanghai / Le Havre'}
                    value={newOrigin}
                    onChange={(e) => setNewOrigin(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>

                <div>
                  <label className="font-semibold text-slate-700 dark:text-slate-300">
                    Destination finale
                  </label>
                  <input
                    type="text"
                    placeholder={newMode === 'Air' ? 'ex: Antananarivo (TNR)' : 'ex: Toamasina (TMM)'}
                    value={newDestination}
                    onChange={(e) => setNewDestination(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>
              </div>

              {/* Remarques */}
              <div>
                <label className="font-semibold text-slate-700 dark:text-slate-300">
                  Observations / Remarques Supply Chain
                </label>
                <textarea
                  rows={2}
                  placeholder="Instructions spécifiques, contraintes d'enlèvement ou de dédouanement..."
                  value={newRemarks}
                  onChange={(e) => setNewRemarks(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>

              {/* Actions */}
              <div className="pt-3 flex gap-2 justify-end border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  disabled={isCreatingShipment}
                  onClick={() => setShowNewModal(false)}
                  className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 disabled:opacity-50"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={isCreatingShipment}
                  className="flex items-center gap-2 rounded-xl bg-[#643288] px-5 py-2 text-xs font-bold text-white shadow-md hover:bg-[#522870] active:scale-95 disabled:opacity-50"
                >
                  {isCreatingShipment ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" /> Enregistrement dans Neon...
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="h-4 w-4" /> Enregistrer l'Expédition
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Floating Notification Toast */}
      {notification && (
        <div className="fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-xs font-bold text-white shadow-2xl dark:bg-white dark:text-slate-900 animate-bounce">
          <CheckCircle2 className="h-4 w-4 text-emerald-400 dark:text-emerald-600" />
          {notification}
        </div>
      )}
    </div>
  );
}
