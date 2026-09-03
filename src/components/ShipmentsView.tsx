import React, { useState, useMemo } from 'react';
import {
  Plane,
  Ship,
  Search,
  Filter,
  Download,
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  FileSpreadsheet,
  Building2,
  Clock,
  ShieldAlert,
  Package,
  X,
  Copy,
  Check,
  Printer,
} from 'lucide-react';
import { Shipment, TransportMode, FilterState } from '../types';
import { SeaDeliveriesTable } from './SeaDeliveriesTable';
import { SeaTrackingSearch } from './SeaTrackingSearch';
import { calculateDepartureMadagascar, calculateEtaMadaSDu } from '../lib/rulesEngine';

interface ShipmentsViewProps {
  shipments: Shipment[];
  modeFilter: 'Air' | 'Sea' | 'all';
  onSelectShipment: (shipment: Shipment) => void;
  canEdit: boolean;
  onRefreshTracking: (shipmentId: string) => void;
  onUpdateShipment?: (updated: Shipment) => void;
}

export const ShipmentsView: React.FC<ShipmentsViewProps> = ({
  shipments,
  modeFilter,
  onSelectShipment,
  canEdit,
  onRefreshTracking,
  onUpdateShipment,
}) => {
  const [search, setSearch] = useState('');
  const [selectedCarrier, setSelectedCarrier] = useState('all');
  const [selectedGlobalStatus, setSelectedGlobalStatus] = useState('all');
  const [selectedSupplier, setSelectedSupplier] = useState('all');
  const [onlyDelays, setOnlyDelays] = useState(false);
  const [onlyOrlyOverdue, setOnlyOrlyOverdue] = useState(false);
  const [expandedSeaIds, setExpandedSeaIds] = useState<string[]>([]);
  const [showSeaTrackingTool, setShowSeaTrackingTool] = useState(false);
  const [showClaimModal, setShowClaimModal] = useState(false);
  const [copiedClaim, setCopiedClaim] = useState(false);

  const toggleExpandSea = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedSeaIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  // Extract unique carriers and suppliers
  const carriersList = useMemo(() => {
    const list = new Set<string>();
    shipments.forEach((s) => list.add(s.carrier));
    return Array.from(list);
  }, [shipments]);

  const suppliersList = useMemo(() => {
    const list = new Set<string>();
    shipments.forEach((s) => list.add(s.supplier));
    return Array.from(list);
  }, [shipments]);

  // Filtered shipments
  const filteredShipments = useMemo(() => {
    return shipments.filter((shp) => {
      // Mode
      if (modeFilter !== 'all' && shp.mode !== modeFilter) return false;

      // Carrier
      if (selectedCarrier !== 'all' && shp.carrier !== selectedCarrier) return false;

      // Global Status
      if (selectedGlobalStatus !== 'all' && shp.global_status !== selectedGlobalStatus)
        return false;

      // Supplier
      if (selectedSupplier !== 'all' && shp.supplier !== selectedSupplier) return false;

      // Delays
      if (onlyDelays && shp.carrier_status !== 'Exception / Delay' && !shp.alerts?.length)
        return false;

      // Orly Overdue > 10 days
      if (onlyOrlyOverdue) {
        const isOrly = shp.global_status === 'Livré Orly' || shp.carrier_status === 'Delivered';
        const noMadagascar = !shp.departure_madagascar;
        const hasHubAlert = shp.alerts?.some((a) => a.rule_code === 'R1_HUB_ORLY_TIMEOUT');
        if (!isOrly || !noMadagascar || !hasHubAlert) return false;
      }

      // Search Query
      if (search.trim()) {
        const q = search.toLowerCase();
        const matchTracking = shp.tracking_no.toLowerCase().includes(q);
        const matchRef = shp.order_reference.toLowerCase().includes(q);
        const matchSupplier = shp.supplier.toLowerCase().includes(q);
        const matchInvoice = shp.invoice_no.toLowerCase().includes(q);
        const matchBl = shp.bl_awb.toLowerCase().includes(q);
        const matchFa = (shp.ref_fa_digi_nxt || '').toLowerCase().includes(q);
        if (!matchTracking && !matchRef && !matchSupplier && !matchInvoice && !matchBl && !matchFa)
          return false;
      }

      return true;
    });
  }, [
    shipments,
    modeFilter,
    selectedCarrier,
    selectedGlobalStatus,
    selectedSupplier,
    onlyDelays,
    onlyOrlyOverdue,
    search,
  ]);

  // Shipments flagged as "Perdu Orly" for claims
  const perduOrlyShipments = useMemo(() => {
    return shipments.filter((s) => s.global_status === 'Perdu Orly');
  }, [shipments]);

  const totalPerduValue = useMemo(() => {
    return perduOrlyShipments.reduce((acc, s) => acc + (s.cost_eur || 0), 0);
  }, [perduOrlyShipments]);

  // Copy Claim Table text
  const handleCopyClaimText = () => {
    if (perduOrlyShipments.length === 0) return;
    let text = `TABLEAU OFFICIEL DE RÉCLAMATION COLIS PERDUS ORLY\n`;
    text += `Date de génération: ${new Date().toLocaleDateString('fr-FR')}\n`;
    text += `Nombre de colis: ${perduOrlyShipments.length} | Valeur Totale: ${totalPerduValue.toLocaleString()} €\n\n`;
    text += `ID | Ref FA (DIGI-NXT) | Commande | Fournisseur | Transporteur | N° Suivi / LTA | Valeur (€) | Remarques\n`;
    text += `----------------------------------------------------------------------------------------------------\n`;
    perduOrlyShipments.forEach((s) => {
      text += `${s.id} | ${s.ref_fa_digi_nxt || 'N/A'} | ${s.order_reference} | ${s.supplier} | ${s.carrier} | ${s.tracking_no} | ${s.cost_eur} € | ${s.remarks || 'Colis non reçu Orly'}\n`;
    });

    navigator.clipboard.writeText(text);
    setCopiedClaim(true);
    setTimeout(() => setCopiedClaim(false), 3000);
  };

  // Export CSV
  const handleExportCSV = () => {
    const headers = [
      'ID',
      'Mode',
      'Fournisseur',
      'Ref Commande',
      'Facture',
      'Valeur EUR',
      'N° Suivi',
      'LTA_BL',
      'Transporteur',
      'Statut Livraison Transporteur',
      'Date Statut Transporteur',
      'Statut Expédition Orly',
      'Statut Métier Global',
      'Date Scan Orly Manuelle',
      'Ref FA (DIGI-NXT)',
      'Départ Mada',
      'ETA MADA S du',
      'Date Recep Mada',
      'Remarques',
    ];

    const rows = filteredShipments.map((s) => [
      s.id,
      s.mode,
      `"${s.supplier}"`,
      s.order_reference,
      s.invoice_no,
      s.cost_eur,
      s.tracking_no,
      s.bl_awb || '',
      s.carrier,
      `"${s.carrier_delivery_status || s.carrier_status}"`,
      s.carrier_status_date || '',
      `"${s.orly_shipment_status || ''}"`,
      `"${s.global_status}"`,
      s.orly_scan_date || '',
      `"${s.ref_fa_digi_nxt || ''}"`,
      calculateDepartureMadagascar(s.orly_scan_date),
      calculateEtaMadaSDu(s.orly_scan_date),
      s.mada_receipt_date || '',
      `"${s.remarks || ''}"`,
    ]);

    const csvContent =
      'data:text/csv;charset=utf-8,' +
      [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute(
      'download',
      `export_expeditions_${modeFilter}_${new Date().toISOString().split('T')[0]}.csv`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-4">
      {/* View Header */}
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-extrabold text-slate-900 dark:text-white">
            {modeFilter === 'Air' ? (
              <>
                <Plane className="h-6 w-6 text-sky-600" /> Suivi des Expéditions Aériennes
              </>
            ) : modeFilter === 'Sea' ? (
              <>
                <Ship className="h-6 w-6 text-indigo-600" /> Suivi des Expéditions Maritimes
              </>
            ) : (
              <>Toutes les Expéditions ({filteredShipments.length})</>
            )}
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Filtrage dynamique, suivi transporteurs, contrôle Ref FA (DIGI-NXT) et détection automatique "Perdu Orly"
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Claim Button */}
          <button
            id="shipments-btn-generate-claim"
            onClick={() => {
              setSelectedGlobalStatus('Perdu Orly');
              setShowClaimModal(true);
            }}
            className="flex items-center gap-1.5 rounded-xl border border-rose-300 bg-rose-600 px-3.5 py-2 text-xs font-bold text-white shadow-xs transition hover:bg-rose-700 dark:border-rose-800 dark:bg-rose-700 dark:hover:bg-rose-800"
            title="Afficher le tableau officiel de réclamation des colis Perdu Orly"
          >
            <ShieldAlert className="h-4 w-4" /> Générer réclamation
            {perduOrlyShipments.length > 0 && (
              <span className="ml-1 rounded-full bg-white px-2 py-0.2 text-[10px] font-extrabold text-rose-700">
                {perduOrlyShipments.length}
              </span>
            )}
          </button>

          {(modeFilter === 'Sea' || modeFilter === 'all') && (
            <button
              id="shipments-btn-sea-tracking"
              onClick={() => setShowSeaTrackingTool(!showSeaTrackingTool)}
              className={`flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-xs font-bold transition shadow-xs ${
                showSeaTrackingTool
                  ? 'border-indigo-600 bg-indigo-600 text-white'
                  : 'border-indigo-200 bg-indigo-50 text-indigo-900 hover:bg-indigo-100 dark:border-indigo-800 dark:bg-slate-800 dark:text-indigo-300'
              }`}
            >
              <Ship className="h-4 w-4" />
              {showSeaTrackingTool ? 'Masquer Recherche Conteneur' : 'Tracking Conteneur / SWB'}
            </button>
          )}

          <button
            id="shipments-btn-export-csv"
            onClick={handleExportCSV}
            className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-xs transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
          >
            <Download className="h-4 w-4" /> Exporter CSV
          </button>
        </div>
      </div>

      {/* Embedded Sea Tracking Search Module */}
      {(showSeaTrackingTool || modeFilter === 'Sea') && (
        <div className="mb-4">
          <SeaTrackingSearch />
        </div>
      )}

      {/* Filter Toolbar */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs dark:border-slate-800 dark:bg-slate-800/90">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Chercher N°, Ref FA, Fournisseur..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 py-1.5 pl-9 pr-3 text-xs text-slate-800 placeholder-slate-400 focus:border-[#643288] focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
          </div>

          {/* Carrier Selector */}
          <div>
            <select
              value={selectedCarrier}
              onChange={(e) => setSelectedCarrier(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 py-1.5 px-3 text-xs text-slate-800 focus:border-[#643288] focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              <option value="all">Tous les transporteurs</option>
              {carriersList.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          {/* Global Status Selector */}
          <div>
            <select
              value={selectedGlobalStatus}
              onChange={(e) => setSelectedGlobalStatus(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 py-1.5 px-3 text-xs font-semibold text-slate-800 focus:border-[#643288] focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              <option value="all">Tous les statuts Orly - Mada</option>
              <option value="Attente confirmation transitaire">Attente confirmation transitaire</option>
              <option value="Reçu et expédié">Reçu et expédié</option>
              <option value="En livraison vers Orly">En livraison vers Orly</option>
              <option value="Bloqué douane">Bloqué douane</option>
              <option value="Perdu Orly">Perdu Orly</option>
              <option value="Livré entrepôt">Livré entrepôt</option>
            </select>
          </div>

          {/* Supplier Selector */}
          <div>
            <select
              value={selectedSupplier}
              onChange={(e) => setSelectedSupplier(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 py-1.5 px-3 text-xs text-slate-800 focus:border-[#643288] focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              <option value="all">Tous les fournisseurs</option>
              {suppliersList.map((sup) => (
                <option key={sup} value={sup}>
                  {sup}
                </option>
              ))}
            </select>
          </div>

          {/* Quick Toggle Checkboxes */}
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={onlyOrlyOverdue}
                onChange={(e) => setOnlyOrlyOverdue(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-[#643288] focus:ring-[#643288]"
              />
              Orly &gt; 10j
            </label>
            <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={onlyDelays}
                onChange={(e) => setOnlyDelays(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-rose-600 focus:ring-rose-500"
              />
              Retards
            </label>
          </div>
        </div>
      </div>

      {/* Main Table */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-xs overflow-hidden dark:border-slate-800 dark:bg-slate-800">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-500 uppercase tracking-wider text-[10px] dark:bg-slate-900/60 dark:text-slate-400">
              <tr>
                <th className="px-3 py-3 font-semibold">Mode</th>
                <th className="px-3 py-3 font-semibold">Fournisseur</th>
                <th className="px-3 py-3 font-semibold">Réf Facture & Commande</th>
                <th className="px-3 py-3 font-semibold">Valeur (€)</th>
                <th className="px-3 py-3 font-semibold">N° Suivi & LTA/BL</th>
                <th className="px-3 py-3 font-semibold">Transporteur</th>
                {modeFilter === 'Air' && (
                  <>
                    <th className="px-3 py-3 font-semibold text-sky-700 dark:text-sky-400">
                      Statut Livraison Transporteur
                    </th>
                    <th className="px-3 py-3 font-semibold text-sky-700 dark:text-sky-400">
                      Date Statut Transporteur
                    </th>
                  </>
                )}
                <th className="px-3 py-3 font-semibold">Statut Orly - Mada</th>
                {modeFilter === 'Air' && (
                  <th className="px-3 py-3 font-semibold text-amber-700 dark:text-amber-400">
                    Date Scan Orly (Manuelle)
                  </th>
                )}
                <th className="px-3 py-3 font-semibold text-indigo-700 dark:text-indigo-400">
                  Ref FA (DIGI - NXT)
                </th>
                <th className="px-3 py-3 font-semibold">DEPART MADA</th>
                <th className="px-3 py-3 font-semibold">ETA MADA S du</th>
                <th className="px-3 py-3 font-semibold text-emerald-700 dark:text-emerald-400">
                  Date de récep Mada
                </th>
                <th className="px-3 py-3 font-semibold text-center">Alertes</th>
                <th className="px-3 py-3 font-semibold">Remarques</th>
                <th className="px-3 py-3 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
              {filteredShipments.length === 0 ? (
                <tr>
                  <td
                    colSpan={modeFilter === 'Air' ? 17 : 14}
                    className="px-4 py-12 text-center text-slate-400"
                  >
                    Aucune expédition ne correspond aux critères sélectionnés.
                  </td>
                </tr>
              ) : (
                filteredShipments.map((shp) => {
                  const hasAlerts = shp.alerts && shp.alerts.length > 0;
                  const isOrlyBlocked = shp.alerts?.some(
                    (a) => a.rule_code === 'R1_HUB_ORLY_TIMEOUT'
                  );
                  const isPerduOrly = shp.global_status === 'Perdu Orly';
                  const isExpanded = shp.mode === 'Sea' && expandedSeaIds.includes(shp.id);

                  return (
                    <React.Fragment key={shp.id}>
                      <tr
                        onClick={() => onSelectShipment(shp)}
                        className={`hover:bg-slate-50/90 transition dark:hover:bg-slate-700/40 cursor-pointer ${
                          isPerduOrly
                            ? 'bg-rose-100/50 dark:bg-rose-950/30 font-medium'
                            : isOrlyBlocked
                            ? 'bg-amber-50/40 dark:bg-amber-950/20'
                            : hasAlerts
                            ? 'bg-rose-50/30 dark:bg-rose-950/10'
                            : ''
                        }`}
                      >
                        {/* Mode Icon */}
                        <td className="px-3 py-3">
                          {shp.mode === 'Air' ? (
                            <span className="inline-flex items-center gap-1 rounded-lg bg-sky-100 px-2 py-1 text-[10px] font-bold text-sky-800 dark:bg-sky-950 dark:text-sky-300">
                              <Plane className="h-3 w-3" /> AIR
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-lg bg-indigo-100 px-2 py-1 text-[10px] font-bold text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300">
                              <Ship className="h-3 w-3" /> SEA
                            </span>
                          )}
                        </td>

                        {/* Fournisseur */}
                        <td className="px-3 py-3 font-bold text-slate-900 dark:text-slate-100">
                          {shp.supplier}
                        </td>

                        {/* Réf Facture & Commande */}
                        <td className="px-3 py-3">
                          <div className="font-semibold text-slate-800 dark:text-slate-200">
                            Ref: {shp.order_reference}
                          </div>
                          <div className="text-[10px] text-slate-500 font-mono">
                            Facture: {shp.invoice_no}
                          </div>
                        </td>

                        {/* Valeur (€) */}
                        <td className="px-3 py-3 font-mono font-bold text-slate-900 dark:text-slate-100">
                          {shp.cost_eur ? `${shp.cost_eur.toLocaleString()} €` : '—'}
                        </td>

                        {/* Tracking & BL */}
                        <td className="px-3 py-3">
                          <div className="font-mono font-bold text-[#643288] dark:text-pink-400">
                            {shp.tracking_no}
                          </div>
                          <div className="text-[10px] text-slate-500 font-mono">
                            {shp.bl_awb || 'Sans LTA/BL'}
                          </div>
                        </td>

                        {/* Carrier */}
                        <td className="px-3 py-3 text-slate-700 dark:text-slate-300 font-medium">
                          {shp.carrier}
                        </td>

                        {/* Air Specific Columns */}
                        {modeFilter === 'Air' && (
                          <>
                            {/* 1. Statut livraison transporteur */}
                            <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                              <div className="flex items-center gap-1.5">
                                <span className="inline-flex rounded-md bg-sky-50 px-2 py-1 text-[10px] font-semibold text-sky-800 dark:bg-sky-950 dark:text-sky-300 border border-sky-200 dark:border-sky-900">
                                  {shp.carrier_delivery_status || shp.carrier_status || 'En cours'}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => onRefreshTracking(shp.id)}
                                  className="inline-flex items-center gap-1 rounded-md bg-sky-100 hover:bg-sky-200 px-1.5 py-0.5 text-[10px] font-bold text-sky-800 dark:bg-sky-900 dark:text-sky-200 transition shadow-2xs"
                                  title={`Générer le statut transporteur en recherchant (${shp.carrier} - ${shp.tracking_no})`}
                                >
                                  <Search className="h-3 w-3" />
                                  <span className="hidden xl:inline">Générer</span>
                                </button>
                              </div>
                            </td>

                            {/* 2. Date statut transporteur */}
                            <td className="px-3 py-3 font-mono text-slate-700 dark:text-slate-300">
                              {shp.carrier_status_date || shp.updated_at || '—'}
                            </td>
                          </>
                        )}

                        {/* Global Status Pill Dropdown */}
                        <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                          <select
                            value={shp.global_status}
                            onChange={(e) => {
                              if (onUpdateShipment) {
                                onUpdateShipment({
                                  ...shp,
                                  global_status: e.target.value as any,
                                  updated_at: new Date().toISOString().split('T')[0],
                                });
                              }
                            }}
                            className={`rounded-lg px-2 py-1 text-[10px] font-bold border shadow-2xs focus:outline-none ${
                              shp.global_status === 'Livré entrepôt' || shp.global_status === 'Livré Client/Entrepôt'
                                ? 'bg-emerald-50 text-emerald-800 border-emerald-300 dark:bg-emerald-950 dark:text-emerald-300'
                                : shp.global_status === 'Reçu et expédié'
                                ? 'bg-indigo-50 text-indigo-800 border-indigo-300 dark:bg-indigo-950 dark:text-indigo-300'
                                : shp.global_status === 'Attente confirmation transitaire'
                                ? 'bg-amber-50 text-amber-800 border-amber-300 dark:bg-amber-950 dark:text-amber-300'
                                : shp.global_status === 'Perdu Orly'
                                ? 'bg-rose-100 text-rose-900 border-rose-500 font-extrabold dark:bg-rose-950 dark:text-rose-200'
                                : shp.global_status === 'Bloqué Douane' || shp.global_status === 'Bloqué douane'
                                ? 'bg-rose-50 text-rose-800 border-rose-300 dark:bg-rose-950 dark:text-rose-300'
                                : 'bg-blue-50 text-blue-800 border-blue-300 dark:bg-blue-950 dark:text-blue-300'
                            }`}
                          >
                            <option value="Attente confirmation transitaire">Attente confirmation transitaire</option>
                            <option value="Reçu et expédié">Reçu et expédié</option>
                            <option value="En livraison vers Orly">En livraison vers Orly</option>
                            <option value="Bloqué douane">Bloqué douane</option>
                            <option value="Perdu Orly">Perdu Orly</option>
                            <option value="Livré entrepôt">Livré entrepôt</option>
                          </select>
                        </td>

                        {/* Date scan Orly (Manuelle) */}
                        {modeFilter === 'Air' && (
                          <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="date"
                              value={shp.orly_scan_date || ''}
                              onChange={(e) => {
                                const newDate = e.target.value;
                                if (onUpdateShipment) {
                                  onUpdateShipment({
                                    ...shp,
                                    orly_scan_date: newDate,
                                    departure_madagascar: calculateDepartureMadagascar(newDate),
                                    orly_shipment_status: newDate
                                      ? 'Scanné & Expédié Orly'
                                      : shp.orly_shipment_status,
                                    updated_at: new Date().toISOString().split('T')[0],
                                  });
                                }
                              }}
                              className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-mono text-slate-800 shadow-2xs dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                            />
                          </td>
                        )}

                        {/* Ref FA (DIGI - NXT) : Format texte */}
                        <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="text"
                            placeholder="Ref FA..."
                            value={shp.ref_fa_digi_nxt || ''}
                            onChange={(e) => {
                              if (onUpdateShipment) {
                                onUpdateShipment({
                                  ...shp,
                                  ref_fa_digi_nxt: e.target.value,
                                  updated_at: new Date().toISOString().split('T')[0],
                                });
                              }
                            }}
                            className="w-28 rounded-lg border border-slate-200 bg-white px-2 py-1 font-mono text-[11px] text-slate-800 shadow-2xs focus:border-[#643288] focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                          />
                        </td>

                        {/* DEPART MADA */}
                        <td className="px-3 py-3 font-mono">
                          {(() => {
                            const depMada = calculateDepartureMadagascar(shp.orly_scan_date);
                            const isParti = depMada && depMada !== 'Non parti';
                            return isParti ? (
                              <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                                {depMada}
                              </span>
                            ) : (
                              <span className="text-amber-600 dark:text-amber-400 font-bold">
                                Non parti
                              </span>
                            );
                          })()}
                        </td>

                        {/* ETA MADA S du */}
                        <td className="px-3 py-3 font-mono">
                          {(() => {
                            const etaMada = calculateEtaMadaSDu(shp.orly_scan_date);
                            const isParti = etaMada && etaMada !== 'Non parti';
                            return isParti ? (
                              <span className="text-indigo-600 dark:text-indigo-400 font-medium">
                                {etaMada}
                              </span>
                            ) : (
                              <span className="text-amber-600 dark:text-amber-400 font-bold">
                                Non parti
                              </span>
                            );
                          })()}
                        </td>

                        {/* Date de récep Mada */}
                        <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="date"
                            value={shp.mada_receipt_date || ''}
                            onChange={(e) => {
                              if (onUpdateShipment) {
                                onUpdateShipment({
                                  ...shp,
                                  mada_receipt_date: e.target.value,
                                  updated_at: new Date().toISOString().split('T')[0],
                                });
                              }
                            }}
                            className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-mono text-slate-800 shadow-2xs dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                          />
                        </td>

                        {/* Alerts badge */}
                        <td className="px-3 py-3 text-center">
                          {hasAlerts ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-rose-500 px-2 py-0.5 text-[10px] font-bold text-white shadow-xs">
                              <AlertTriangle className="h-3 w-3" /> {shp.alerts?.length}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-slate-400 text-[10px]">
                              <CheckCircle2 className="h-3 w-3 text-emerald-500" /> OK
                            </span>
                          )}
                        </td>

                        {/* Remarques */}
                        <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="text"
                            placeholder="Remarques..."
                            value={shp.remarks || ''}
                            onChange={(e) => {
                              if (onUpdateShipment) {
                                onUpdateShipment({
                                  ...shp,
                                  remarks: e.target.value,
                                  updated_at: new Date().toISOString().split('T')[0],
                                });
                              }
                            }}
                            className="w-32 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-800 shadow-2xs focus:border-[#643288] focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                          />
                        </td>

                        {/* Actions */}
                        <td className="px-3 py-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {shp.mode === 'Sea' && (
                              <button
                                onClick={(e) => toggleExpandSea(shp.id, e)}
                                className="flex items-center gap-1 rounded-lg border border-indigo-200 bg-indigo-50 px-2 py-1 text-[11px] font-bold text-indigo-700 transition hover:bg-indigo-100 dark:border-indigo-900 dark:bg-indigo-950 dark:text-indigo-300"
                                title="Afficher le suivi livraisons transitaire Rouen"
                              >
                                <Package className="h-3 w-3" />
                                <span className="hidden sm:inline">
                                  Rouen (
                                  {shp.sea_deliveries?.filter((d) => d.recep_rouen === 'Oui')
                                    .length || 0}
                                  /{shp.sea_deliveries?.length || 0})
                                </span>
                                {isExpanded ? (
                                  <ChevronUp className="h-3 w-3" />
                                ) : (
                                  <ChevronDown className="h-3 w-3" />
                                )}
                              </button>
                            )}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onRefreshTracking(shp.id);
                              }}
                              className="rounded-lg p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-800 dark:hover:bg-slate-700"
                              title="Rafraîchir le suivi transporteur"
                            >
                              <RefreshCw className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onSelectShipment(shp);
                              }}
                              className="rounded-lg bg-[#643288] px-2.5 py-1 text-[11px] font-semibold text-white transition hover:bg-[#522870]"
                            >
                              Consulter
                            </button>
                          </div>
                        </td>
                      </tr>

                      {isExpanded && (
                        <tr>
                          <td
                            colSpan={modeFilter === 'Air' ? 18 : 14}
                            className="bg-indigo-50/30 p-3 dark:bg-slate-900/80 border-t border-b border-indigo-100 dark:border-slate-800"
                          >
                            <SeaDeliveriesTable
                              shipment={shp}
                              onUpdateShipment={onUpdateShipment || (() => {})}
                              canEdit={canEdit}
                            />
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* MODAL: Official Claim Table ("Générer Réclamation") */}
      {showClaimModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="w-full max-w-5xl rounded-3xl bg-white shadow-2xl border border-slate-200 dark:bg-slate-900 dark:border-slate-800 overflow-hidden my-8">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-rose-100 bg-rose-50/80 px-6 py-4 dark:border-rose-900/40 dark:bg-rose-950/40">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-rose-600 text-white shadow-md">
                  <ShieldAlert className="h-6 w-6" />
                </div>
                <div>
                  <h2 className="text-lg font-extrabold text-slate-900 dark:text-white">
                    Tableau Officiel de Réclamation — Colis "Perdu Orly"
                  </h2>
                  <p className="text-xs text-rose-700 dark:text-rose-300">
                    Généré à des fins de contentieux, litige et remboursement auprès du transporteur / hub Orly.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowClaimModal(false)}
                className="rounded-full p-2 text-slate-400 hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-6 space-y-6">
              {/* Summary KPIs */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 dark:border-rose-900 dark:bg-rose-950/30">
                  <div className="text-xs font-semibold text-rose-700 dark:text-rose-400">
                    Colis Perdus Identifiés
                  </div>
                  <div className="text-2xl font-black text-rose-900 dark:text-rose-100 mt-1">
                    {perduOrlyShipments.length} colis
                  </div>
                </div>

                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/30">
                  <div className="text-xs font-semibold text-amber-700 dark:text-amber-400">
                    Valeur Totale Préjudice
                  </div>
                  <div className="text-2xl font-black text-amber-900 dark:text-amber-100 mt-1">
                    {totalPerduValue.toLocaleString()} €
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-800/50">
                  <div className="text-xs font-semibold text-slate-600 dark:text-slate-400">
                    Motif de Réclamation
                  </div>
                  <div className="text-xs font-bold text-slate-800 dark:text-slate-200 mt-1">
                    Rupture de traçabilité Hub Orly / Incohérence Facture FA (DIGI-NXT)
                  </div>
                </div>
              </div>

              {/* Claims Table Format */}
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                    <FileSpreadsheet className="h-4 w-4 text-rose-600" />
                    Bordereau Récapitulatif des Envois non Reçus
                  </h3>
                  <span className="text-xs text-slate-500 font-mono">
                    Date: {new Date().toLocaleDateString('fr-FR')}
                  </span>
                </div>

                <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-2xs dark:border-slate-700 dark:bg-slate-800">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-100 text-slate-600 uppercase text-[10px] font-bold dark:bg-slate-900 dark:text-slate-300">
                      <tr>
                        <th className="px-3 py-2.5">N° Expédition</th>
                        <th className="px-3 py-2.5 text-indigo-700 dark:text-indigo-400">
                          Ref FA (DIGI - NXT)
                        </th>
                        <th className="px-3 py-2.5">Ref Commande / Facture</th>
                        <th className="px-3 py-2.5">Fournisseur</th>
                        <th className="px-3 py-2.5">Transporteur</th>
                        <th className="px-3 py-2.5">N° Suivi & LTA</th>
                        <th className="px-3 py-2.5 text-right">Valeur (€)</th>
                        <th className="px-3 py-2.5">Remarques</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                      {perduOrlyShipments.length === 0 ? (
                        <tr>
                          <td colSpan={8} className="px-4 py-8 text-center text-slate-400">
                            Aucun colis au statut "Perdu Orly". Tout est en ordre !
                          </td>
                        </tr>
                      ) : (
                        perduOrlyShipments.map((s) => (
                          <tr key={s.id} className="hover:bg-rose-50/40 dark:hover:bg-rose-950/20">
                            <td className="px-3 py-2.5 font-bold font-mono text-slate-900 dark:text-slate-100">
                              {s.id}
                            </td>
                            <td className="px-3 py-2.5 font-mono font-extrabold text-indigo-700 dark:text-indigo-300">
                              {s.ref_fa_digi_nxt || '—'}
                            </td>
                            <td className="px-3 py-2.5">
                              <div className="font-semibold">{s.order_reference}</div>
                              <div className="text-[10px] text-slate-400 font-mono">{s.invoice_no}</div>
                            </td>
                            <td className="px-3 py-2.5 font-medium">{s.supplier}</td>
                            <td className="px-3 py-2.5">{s.carrier}</td>
                            <td className="px-3 py-2.5 font-mono font-bold text-[#643288] dark:text-pink-400">
                              {s.tracking_no}
                            </td>
                            <td className="px-3 py-2.5 text-right font-mono font-black text-rose-700 dark:text-rose-400">
                              {s.cost_eur ? `${s.cost_eur.toLocaleString()} €` : '0 €'}
                            </td>
                            <td className="px-3 py-2.5 text-slate-600 dark:text-slate-300">
                              {s.remarks || 'Colis non réceptionné au Hub Orly'}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Modal Actions Footer */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-6 py-4 dark:border-slate-800 dark:bg-slate-900/60">
              <button
                onClick={handleCopyClaimText}
                disabled={perduOrlyShipments.length === 0}
                className="flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 shadow-2xs hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
              >
                {copiedClaim ? (
                  <>
                    <Check className="h-4 w-4 text-emerald-600" /> Copié dans le presse-papier !
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4" /> Copier la déclaration texte
                  </>
                )}
              </button>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleExportCSV}
                  disabled={perduOrlyShipments.length === 0}
                  className="flex items-center gap-2 rounded-xl border border-emerald-300 bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow-2xs hover:bg-emerald-700 disabled:opacity-50"
                >
                  <Download className="h-4 w-4" /> Exporter le Bordereau CSV
                </button>
                <button
                  onClick={() => window.print()}
                  className="flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 shadow-2xs hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                >
                  <Printer className="h-4 w-4" /> Imprimer
                </button>
                <button
                  onClick={() => setShowClaimModal(false)}
                  className="rounded-xl bg-[#643288] px-5 py-2 text-xs font-bold text-white hover:bg-[#522870]"
                >
                  Fermer
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
