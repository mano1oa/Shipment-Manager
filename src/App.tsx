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
import { SettingsUsersView } from './components/SettingsUsersView';
import { ReferenceSelect, ReferenceTransportMode, ReferenceCreateResult } from './components/ReferenceSelect';
import { evaluateShipmentRules } from './lib/rulesEngine';
import { Shipment, ShipmentAlert, UserRole, MetricSummary, GlobalStatus, AntoineStatus } from './types';

type ReferenceCarrier = { id: string; name: string; transport_mode: ReferenceTransportMode };
type ReferenceSupplier = { id: string; name: string };
type ShipmentPriority = Shipment['priority'];
type CustomsStatus = Shipment['customs_status'];
import { PlusCircle, X, CheckCircle2, Loader2, AlertCircle } from 'lucide-react';

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
  const currentRole: UserRole =
  authUser?.role === 'SUPPLY_CHAIN'
    ? 'supply_chain'
    : authUser?.role === 'SOURCING'
      ? 'sourcing'
      : 'direction';  const [darkMode, setDarkMode] = useState<boolean>(() => {
    return localStorage.getItem('shipment_manager_theme') === 'dark';
  });
  const [globalSearch, setGlobalSearch] = useState('');
  const [selectedShipment, setSelectedShipment] = useState<Shipment | null>(null);
  const [showNewModal, setShowNewModal] = useState(false);
  const [notification, setNotification] = useState<string | null>(null);

  // New Shipment Form State
  const [newSupplier, setNewSupplier] = useState('');
  const [newOrderRef, setNewOrderRef] = useState('');
  const [newTrackingNo, setNewTrackingNo] = useState('');
  const [newRefFa, setNewRefFa] = useState('');
  const [newInvoiceNo, setNewInvoiceNo] = useState('');
  const [newBlAwb, setNewBlAwb] = useState('');
  const [newCarrier, setNewCarrier] = useState('');
  const [newMode, setNewMode] = useState<'Air' | 'Sea'>('Air');
  const [newGlobalStatus, setNewGlobalStatus] = useState<GlobalStatus | ''>('');
  const [newAntoineStatus, setNewAntoineStatus] = useState<AntoineStatus | ''>('');
  const [newPriority, setNewPriority] = useState<ShipmentPriority | ''>('');
  const [newCustomsStatus, setNewCustomsStatus] = useState<CustomsStatus | ''>('');
  const [newEta, setNewEta] = useState('');
  // Numeric inputs are kept as strings ('' = unknown) and converted on submit.
  const [newWeight, setNewWeight] = useState('');
  const [newCost, setNewCost] = useState('');
  const [newOrigin, setNewOrigin] = useState('');
  const [newDestination, setNewDestination] = useState('');
  const [newRemarks, setNewRemarks] = useState('');
  const [isCreatingShipment, setIsCreatingShipment] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Reference lists (Neon): carriers & suppliers for the creation form
  const [refCarriers, setRefCarriers] = useState<ReferenceCarrier[]>([]);
  const [refSuppliers, setRefSuppliers] = useState<ReferenceSupplier[]>([]);
  const [refLoading, setRefLoading] = useState(false);
  const [refCarriersError, setRefCarriersError] = useState<string | null>(null);
  const [refSuppliersError, setRefSuppliersError] = useState<string | null>(null);

  const sortByName = <T extends { name: string }>(items: T[]) =>
    [...items].sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));

  const loadReferenceLists = async () => {
    setRefLoading(true);
    setRefCarriersError(null);
    setRefSuppliersError(null);
    try {
      const [carriersRes, suppliersRes] = await Promise.all([
        fetch('/api/reference/carriers', { credentials: 'include' }),
        fetch('/api/reference/suppliers', { credentials: 'include' }),
      ]);
      const carriersData = await carriersRes.json().catch(() => ({}));
      const suppliersData = await suppliersRes.json().catch(() => ({}));

      if (carriersRes.ok && carriersData?.success) {
        setRefCarriers(carriersData.carriers || []);
      } else {
        setRefCarriersError('Impossible de charger la liste des transporteurs.');
      }
      if (suppliersRes.ok && suppliersData?.success) {
        setRefSuppliers(suppliersData.suppliers || []);
      } else {
        setRefSuppliersError('Impossible de charger la liste des fournisseurs.');
      }
    } catch {
      setRefCarriersError('Impossible de charger la liste des transporteurs (erreur réseau).');
      setRefSuppliersError('Impossible de charger la liste des fournisseurs (erreur réseau).');
    } finally {
      setRefLoading(false);
    }
  };

  // Reload lists each time the creation form opens (picks up other users' additions)
  useEffect(() => {
    if (showNewModal) {
      loadReferenceLists();
    }
  }, [showNewModal]);

  const carrierAppliesToMode = (carrier: ReferenceCarrier, mode: 'Air' | 'Sea') =>
    carrier.transport_mode === 'BOTH' || carrier.transport_mode === mode;

  const carriersForMode = useMemo(
    () => refCarriers.filter((c) => carrierAppliesToMode(c, newMode)),
    [refCarriers, newMode]
  );

  const handleCreateCarrier = async (
    name: string,
    mode?: ReferenceTransportMode
  ): Promise<ReferenceCreateResult> => {
    try {
      const res = await fetch('/api/reference/carriers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name, transport_mode: mode }),
      });
      const data = await res.json().catch(() => ({}));

      if (res.ok && data?.success && data.carrier) {
        const carrier: ReferenceCarrier = data.carrier;
        setRefCarriers((prev) => sortByName([...prev.filter((c) => c.id !== carrier.id), carrier]));
        if (carrierAppliesToMode(carrier, newMode)) {
          setNewCarrier(carrier.name);
          return { ok: true };
        }
        return {
          ok: false,
          error: `« ${carrier.name} » a été ajouté, mais il n'est pas disponible pour le mode ${newMode === 'Air' ? 'aérien' : 'maritime'}.`,
        };
      }

      if (res.status === 409 && data?.existing) {
        const existing: ReferenceCarrier = data.existing;
        if (carrierAppliesToMode(existing, newMode)) {
          setRefCarriers((prev) =>
            prev.some((c) => c.id === existing.id) ? prev : sortByName([...prev, existing])
          );
          setNewCarrier(existing.name);
          return { ok: true };
        }
      }

      return { ok: false, error: data?.error || `Erreur ${res.status}` };
    } catch {
      return { ok: false, error: 'Erreur réseau lors de l\'ajout du transporteur.' };
    }
  };

  const handleCreateSupplier = async (name: string): Promise<ReferenceCreateResult> => {
    try {
      const res = await fetch('/api/reference/suppliers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name }),
      });
      const data = await res.json().catch(() => ({}));

      if (res.ok && data?.success && data.supplier) {
        const supplier: ReferenceSupplier = data.supplier;
        setRefSuppliers((prev) => sortByName([...prev.filter((s) => s.id !== supplier.id), supplier]));
        setNewSupplier(supplier.name);
        return { ok: true };
      }

      if (res.status === 409 && data?.existing) {
        // Already exists (maybe with different casing): select the canonical entry
        const existing: ReferenceSupplier = data.existing;
        setRefSuppliers((prev) =>
          prev.some((s) => s.id === existing.id) ? prev : sortByName([...prev, existing])
        );
        setNewSupplier(existing.name);
        return { ok: true };
      }

      return { ok: false, error: data?.error || `Erreur ${res.status}` };
    } catch {
      return { ok: false, error: 'Erreur réseau lors de l\'ajout du fournisseur.' };
    }
  };

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

  useEffect(() => {
    loadShipmentsFromNeon();
  }, []);

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

  async function handleLogout() {
  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'include',
    });
  } catch (error) {
    console.error('Logout error:', error);
  } finally {
    setAuthUser(null);
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

      const savedShipment: Shipment = data.shipment || updated;
      setShipments((prev) => prev.map((s) => (s.id === savedShipment.id ? savedShipment : s)));
      setSelectedShipment(savedShipment);
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
    if (!newCarrier) {
      setCreateError('Le Transporteur est obligatoire.');
      return;
    }
    if (!newGlobalStatus) {
      setCreateError('Le Statut global initial est obligatoire.');
      return;
    }
    if (!newAntoineStatus) {
      setCreateError('Le Statut Antoine est obligatoire.');
      return;
    }
    if (!newPriority) {
      setCreateError('La Priorité est obligatoire.');
      return;
    }
    if (!newCustomsStatus) {
      setCreateError('Le Statut douane est obligatoire.');
      return;
    }

    // Numeric fields: '' = unknown (stored as 0, the column is NOT NULL); never NaN.
    const parseAmount = (raw: string): number | null => {
      if (raw.trim() === '') return 0;
      const n = Number(raw.replace(',', '.'));
      return Number.isFinite(n) && n >= 0 ? n : null;
    };
    const weightValue = parseAmount(newWeight);
    const costValue = parseAmount(newCost);
    if (weightValue === null) {
      setCreateError('Le Poids doit être un nombre positif.');
      return;
    }
    if (costValue === null) {
      setCreateError('Le Coût Freight doit être un nombre positif.');
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
        carrier_status: '', // unknown until a real carrier status is recorded
        carrier_last_location: '',
        eta: newEta || '',
        antoine_status: newAntoineStatus,
        global_status: newGlobalStatus,
        remarks: newRemarks.trim(),
        priority: newPriority,
        weight_kg: weightValue,
        cost_eur: costValue,
        origin: newOrigin.trim(),
        destination: newDestination.trim(),
        vessel_flight: '',
        customs_status: newCustomsStatus,
        ref_fa_digi_nxt: newRefFa.trim(),
        created_at: today,
        updated_at: today,
        documents: [],
        history: [
          {
            date: `${today} ${new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`,
            location: newOrigin.trim(),
            status: 'Création',
            details: `Création de l'expédition pour ${supplierTrim}`,
          },
        ],
        alerts: [],
        sea_deliveries: [],
      };

      let finalShipment = created;

      // Direct persistence attempt to Neon PostgreSQL - Single source of truth
      const res = await fetch('/api/shipments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(created),
      });

      const resData = await res.json().catch(() => ({}));

      if (!res.ok || !resData.success) {
        const errMsg =
          resData?.message ||
          resData?.error ||
          'Erreur lors de l\'enregistrement dans la base Neon PostgreSQL.';
        setCreateError(errMsg);
        showToast(`❌ Erreur création Neon: ${errMsg}`);
        return;
      }

      if (resData.shipment) {
        finalShipment = resData.shipment;
      }

      showToast(`✅ Expédition ${finalShipment.id} enregistrée avec succès dans Neon PostgreSQL !`);

      // Commit to React state and close modal only after successful Neon persistence
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
      setNewCarrier('');
      setNewGlobalStatus('');
      setNewAntoineStatus('');
      setNewPriority('');
      setNewCustomsStatus('');
      setNewEta('');
      setNewCost('');
      setNewWeight('');
      setNewOrigin('');
      setNewDestination('');
    } catch (err: any) {
      console.error('Erreur enregistrement:', err);
      const networkMsg = err?.message || 'Erreur réseau lors de la création.';
      setCreateError(networkMsg);
      showToast(`❌ ${networkMsg}`);
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
    supply_chain: ['dashboard', 'air', 'sea', 'alerts', 'analytics', 'assistant', 'admin', 'deliverables','settings'],
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
        authUser={authUser}
        onLogout={handleLogout}
        onRoleChange={() => {}}
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
              canResolve={canEdit}
            />
          )}
          {activeTab === 'settings' && currentRole === 'supply_chain' && (<SettingsUsersView />
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
          onDelete={currentRole === 'supply_chain' ? handleDeleteShipment : undefined}
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
                      // Drop the selected carrier if it does not apply to the new mode
                      const current = refCarriers.find((c) => c.name === newCarrier);
                      if (current && !carrierAppliesToMode(current, mode)) {
                        setNewCarrier('');
                      }
                    }}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 font-medium dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  >
                    <option value="Air">✈️ Aérien (Express / Cargo)</option>
                    <option value="Sea">🚢 Maritime (Conteneur / FCL / LCL)</option>
                  </select>
                </div>

                <ReferenceSelect
                  label="Transporteur / Compagnie"
                  entityLabel="transporteur"
                  required
                  withModeChoice
                  options={carriersForMode}
                  value={newCarrier}
                  onChange={setNewCarrier}
                  onCreate={handleCreateCarrier}
                  loading={refLoading}
                  loadError={refCarriersError}
                  emptyHint={`Aucun transporteur ${newMode === 'Air' ? 'aérien' : 'maritime'} enregistré : utilisez « + Ajouter un transporteur… ».`}
                />
              </div>

              {/* Fournisseur & Ref Commande */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <ReferenceSelect
                  label="Fournisseur"
                  entityLabel="fournisseur"
                  required
                  options={refSuppliers}
                  value={newSupplier}
                  onChange={setNewSupplier}
                  onCreate={(name) => handleCreateSupplier(name)}
                  loading={refLoading}
                  loadError={refSuppliersError}
                  emptyHint="Aucun fournisseur enregistré : utilisez « + Ajouter un fournisseur… »."
                />

                <div>
                  <label className="font-semibold text-slate-700 dark:text-slate-300">
                    Réf Commande / PO *
                  </label>
                  <input
                    type="text"
                    required
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
                    value={newInvoiceNo}
                    onChange={(e) => setNewInvoiceNo(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 font-mono dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>
              </div>

              {/* Statut global & ETA */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-700 dark:text-slate-300">
                    Statut Global Initial *
                  </label>
                  <select
                    required
                    value={newGlobalStatus}
                    onChange={(e) => setNewGlobalStatus(e.target.value as GlobalStatus | '')}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  >
                    <option value="">— Sélectionner —</option>
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

              {/* Statut Antoine, Priorité & Douane */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="font-semibold text-slate-700 dark:text-slate-300">
                    Statut Antoine *
                  </label>
                  <select
                    required
                    value={newAntoineStatus}
                    onChange={(e) => setNewAntoineStatus(e.target.value as AntoineStatus | '')}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  >
                    <option value="">— Sélectionner —</option>
                    <option value="En attente Antoine">En attente Antoine</option>
                    <option value="Confirmé">Confirmé</option>
                    <option value="Transmis transitaire">Transmis transitaire</option>
                    <option value="A vérifier">A vérifier</option>
                  </select>
                </div>

                <div>
                  <label className="font-semibold text-slate-700 dark:text-slate-300">
                    Priorité *
                  </label>
                  <select
                    required
                    value={newPriority}
                    onChange={(e) => setNewPriority(e.target.value as ShipmentPriority | '')}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  >
                    <option value="">— Sélectionner —</option>
                    <option value="Haute">Haute</option>
                    <option value="Moyenne">Moyenne</option>
                    <option value="Basse">Basse</option>
                  </select>
                </div>

                <div>
                  <label className="font-semibold text-slate-700 dark:text-slate-300">
                    Statut Douane *
                  </label>
                  <select
                    required
                    value={newCustomsStatus}
                    onChange={(e) => setNewCustomsStatus(e.target.value as CustomsStatus | '')}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  >
                    <option value="">— Sélectionner —</option>
                    <option value="Non Requis">Non Requis</option>
                    <option value="En cours">En cours</option>
                    <option value="Dédouané">Dédouané</option>
                    <option value="Bloqué Douane">Bloqué Douane</option>
                  </select>
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
                    min="0"
                    step="0.1"
                    inputMode="decimal"
                    value={newWeight}
                    onChange={(e) => setNewWeight(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>

                <div>
                  <label className="font-semibold text-slate-700 dark:text-slate-300">
                    Coût Freight (€)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    value={newCost}
                    onChange={(e) => setNewCost(e.target.value)}
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
