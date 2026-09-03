import React, { useState } from 'react';
import {
  X,
  Plane,
  Ship,
  FileText,
  AlertTriangle,
  Send,
  CheckCircle2,
  Clock,
  MapPin,
  Building2,
  DollarSign,
  Weight,
  Copy,
  Check,
  Edit2,
  Save,
  Download,
  Search,
} from 'lucide-react';
import { Shipment, GlobalStatus, AntoineStatus, ShipmentDocument } from '../types';
import { SeaDeliveriesTable } from './SeaDeliveriesTable';
import { calculateDepartureMadagascar, calculateEtaMadaSDu } from '../lib/rulesEngine';

interface ShipmentDetailModalProps {
  shipment: Shipment | null;
  onClose: () => void;
  canEdit: boolean;
  onSave: (updatedShipment: Shipment) => void;
  onDispatchGoogleChat: (message: string, space?: string) => Promise<void>;
}

export const ShipmentDetailModal: React.FC<ShipmentDetailModalProps> = ({
  shipment,
  onClose,
  canEdit,
  onSave,
  onDispatchGoogleChat,
}) => {
  if (!shipment) return null;

  const [isEditing, setIsEditing] = useState(false);
  const [editedStatus, setEditedStatus] = useState<GlobalStatus>(shipment.global_status);
  const [editedAntoine, setEditedAntoine] = useState<AntoineStatus>(shipment.antoine_status);
  const [editedRemarks, setEditedRemarks] = useState(shipment.remarks);
  const [editedOrlyScanDate, setEditedOrlyScanDate] = useState(shipment.orly_scan_date || '');
  const [editedRefFa, setEditedRefFa] = useState(shipment.ref_fa_digi_nxt || '');
  const [editedMadaReceipt, setEditedMadaReceipt] = useState(shipment.mada_receipt_date || '');
  const [copiedRelance, setCopiedRelance] = useState(false);
  const [dispatchingChat, setDispatchingChat] = useState(false);
  const [chatSuccess, setChatSuccess] = useState(false);

  const activeAlert = shipment.alerts && shipment.alerts.length > 0 ? shipment.alerts[0] : null;

  const handleSaveClick = () => {
    const calculatedDepMada = calculateDepartureMadagascar(editedOrlyScanDate);
    const updated: Shipment = {
      ...shipment,
      global_status: editedStatus,
      antoine_status: editedAntoine,
      remarks: editedRemarks,
      orly_scan_date: editedOrlyScanDate,
      departure_madagascar: calculatedDepMada,
      orly_shipment_status: editedOrlyScanDate
        ? 'Scanné & Expédié Orly'
        : shipment.orly_shipment_status,
      ref_fa_digi_nxt: editedRefFa,
      mada_receipt_date: editedMadaReceipt,
      updated_at: new Date().toISOString().split('T')[0],
    };
    onSave(updated);
    setIsEditing(false);
  };

  const handleCopyRelance = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedRelance(true);
    setTimeout(() => setCopiedRelance(false), 2500);
  };

  const handleSendChat = async (text: string) => {
    setDispatchingChat(true);
    try {
      await onDispatchGoogleChat(text, 'SupplyChain-Alerts');
      setChatSuccess(true);
      setTimeout(() => setChatSuccess(false), 3000);
    } catch (err) {
      console.error(err);
    } finally {
      setDispatchingChat(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs overflow-y-auto">
      <div className="relative w-full max-w-4xl rounded-3xl border border-slate-200 bg-white shadow-2xl transition-all dark:border-slate-800 dark:bg-slate-900 my-8">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 p-6 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <div
              className={`flex h-12 w-12 items-center justify-center rounded-2xl text-white shadow-md ${
                shipment.mode === 'Air'
                  ? 'bg-gradient-to-br from-sky-500 to-blue-700'
                  : 'bg-gradient-to-br from-indigo-500 to-purple-800'
              }`}
            >
              {shipment.mode === 'Air' ? (
                <Plane className="h-6 w-6" />
              ) : (
                <Ship className="h-6 w-6" />
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-extrabold text-slate-900 dark:text-white">
                  Expédition {shipment.id}
                </h2>
                <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                  {shipment.mode}
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Commande: <span className="font-bold text-slate-700 dark:text-slate-200">{shipment.order_reference}</span> | Fournisseur: <span className="font-bold text-slate-700 dark:text-slate-200">{shipment.supplier}</span>
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="rounded-xl p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-6 max-h-[75vh] overflow-y-auto">
          {/* Active Alert Banner */}
          {activeAlert && (
            <div className="rounded-2xl border border-rose-200 bg-rose-50/90 p-4 dark:border-rose-900/60 dark:bg-rose-950/40">
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                <div className="flex-1 space-y-2">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-rose-900 dark:text-rose-200">
                      {activeAlert.title}
                    </h3>
                    <span className="rounded-full bg-rose-600 px-2 py-0.5 text-[10px] font-bold text-white uppercase">
                      {activeAlert.severity}
                    </span>
                  </div>
                  <p className="text-xs text-rose-800 dark:text-rose-300">{activeAlert.reason}</p>

                  {/* Pre-drafted Google Chat Relance Box */}
                  {activeAlert.relance_draft && (
                    <div className="mt-3 rounded-xl border border-rose-200/80 bg-white p-3 dark:border-rose-900/50 dark:bg-slate-900">
                      <div className="flex items-center justify-between pb-2 border-b border-rose-100 dark:border-slate-800">
                        <span className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                          <Send className="h-3.5 w-3.5 text-[#643288]" /> Message de Relance Google Chat Généré
                        </span>
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleCopyRelance(activeAlert.relance_draft!)}
                            className="flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200"
                          >
                            {copiedRelance ? (
                              <>
                                <Check className="h-3 w-3 text-emerald-600" /> Copié !
                              </>
                            ) : (
                              <>
                                <Copy className="h-3 w-3" /> Copier
                              </>
                            )}
                          </button>
                          <button
                            onClick={() => handleSendChat(activeAlert.relance_draft!)}
                            disabled={dispatchingChat}
                            className="flex items-center gap-1 rounded-lg bg-[#643288] px-3 py-1 text-[11px] font-semibold text-white hover:bg-[#522870] disabled:opacity-50"
                          >
                            <Send className="h-3 w-3" />
                            {dispatchingChat ? 'Envoi...' : 'Envoyer Google Chat'}
                          </button>
                        </div>
                      </div>
                      <pre className="mt-2 text-xs font-sans text-slate-700 dark:text-slate-300 whitespace-pre-wrap leading-relaxed bg-slate-50 dark:bg-slate-950 p-2.5 rounded-lg border border-slate-100 dark:border-slate-800">
                        {activeAlert.relance_draft}
                      </pre>
                      {chatSuccess && (
                        <div className="mt-2 flex items-center gap-1.5 text-xs font-bold text-emerald-600 dark:text-emerald-400">
                          <CheckCircle2 className="h-4 w-4" /> Message transmis avec succès au webhook Google Chat !
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Quick Metrics Grid */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-800/50">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase text-slate-400">Transporteur</span>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const res = await fetch(`/api/carrier-track/${encodeURIComponent(shipment.carrier)}/${encodeURIComponent(shipment.tracking_no)}`);
                      const data = await res.json();
                      if (data.success && onSave) {
                        onSave({
                          ...shipment,
                          carrier_status: data.carrier_status as any,
                          carrier_delivery_status: data.carrier_delivery_status || data.carrier_status,
                          carrier_status_date: data.carrier_status_date,
                          carrier_last_location: data.last_location,
                          updated_at: new Date().toISOString().split('T')[0],
                        });
                      }
                    } catch (e) {}
                  }}
                  className="rounded-md bg-sky-100 hover:bg-sky-200 text-sky-800 dark:bg-sky-900 dark:text-sky-200 px-2 py-0.5 text-[10px] font-bold flex items-center gap-1 transition shadow-2xs"
                  title="Rechercher et générer le statut à partir du N° Suivi et du Transporteur"
                >
                  <Search className="h-3 w-3" /> Générer Statut
                </button>
              </div>
              <div className="text-sm font-bold text-slate-900 dark:text-white mt-1">
                {shipment.carrier}
              </div>
              <div className="text-[10px] font-mono text-slate-500">{shipment.tracking_no}</div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-800/50">
              <span className="text-[10px] font-bold uppercase text-slate-400">LTA / B/L & Conteneur</span>
              <div className="text-sm font-bold font-mono text-[#643288] dark:text-pink-400 mt-1 truncate">
                {shipment.bl_awb || shipment.swb_no || 'Non Renseigné'}
              </div>
              <div className="text-[10px] font-mono text-slate-500">
                {shipment.container_no ? `Conteneur: ${shipment.container_no}` : 'Document transporteur'}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-800/50">
              <span className="text-[10px] font-bold uppercase text-slate-400">ETA / Arrivée</span>
              <div className="text-sm font-bold font-mono text-slate-900 dark:text-white mt-1">
                {shipment.eta}
              </div>
              <div className="text-[10px] text-slate-500">Destination: {shipment.destination}</div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-800/50">
              <span className="text-[10px] font-bold uppercase text-slate-400">Poids & Valeur</span>
              <div className="text-sm font-bold text-slate-900 dark:text-white mt-1">
                {shipment.weight_kg} kg | {shipment.cost_eur} €
              </div>
              <div className="text-[10px] text-slate-500">Priorité: {shipment.priority}</div>
            </div>
          </div>

          {/* Lead Time & Dates Section */}
          {(() => {
            const etdDate = shipment.etd || shipment.created_at;
            const etaDate = shipment.eta;
            const actualDate = shipment.actual_arrival_date || shipment.actual_delivery;

            const calcDays = (d1Str?: string, d2Str?: string) => {
              if (!d1Str || !d2Str) return null;
              const d1 = new Date(d1Str);
              const d2 = new Date(d2Str);
              if (isNaN(d1.getTime()) || isNaN(d2.getTime())) return null;
              return Math.max(1, Math.round((d1.getTime() - d2.getTime()) / (1000 * 60 * 60 * 24)));
            };

            const estimatedLeadTime = calcDays(etaDate, etdDate);
            const actualLeadTime = calcDays(actualDate, etdDate);

            return (
              <div className="rounded-2xl border border-indigo-200 bg-gradient-to-r from-indigo-50/70 via-purple-50/50 to-slate-50/70 p-4 dark:border-indigo-900/60 dark:bg-slate-800/90 shadow-2xs">
                <div className="flex items-center justify-between pb-3 border-b border-indigo-100 dark:border-slate-700">
                  <span className="text-xs font-bold text-indigo-950 dark:text-indigo-200 uppercase tracking-wider flex items-center gap-1.5">
                    <Clock className="h-4 w-4 text-[#643288]" /> Lead Times & Dates d'Acheminement (ETD / ETA)
                  </span>
                  {shipment.container_no && (
                    <span className="rounded-full bg-indigo-100 px-2.5 py-0.5 text-[10px] font-mono font-bold text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300">
                      N° Conteneur: {shipment.container_no}
                    </span>
                  )}
                </div>

                <div className="mt-3 grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs">
                  <div className="bg-white dark:bg-slate-900 p-2.5 rounded-xl border border-slate-200/80 dark:border-slate-700">
                    <span className="text-[10px] font-semibold text-slate-400 block">ETD (Départ)</span>
                    <span className="font-mono font-bold text-slate-800 dark:text-slate-100 mt-0.5 block">
                      {shipment.etd || '2026-06-12'}
                    </span>
                    <span className="text-[9px] text-slate-400">{shipment.port_of_loading || shipment.origin}</span>
                  </div>

                  <div className="bg-white dark:bg-slate-900 p-2.5 rounded-xl border border-slate-200/80 dark:border-slate-700">
                    <span className="text-[10px] font-semibold text-slate-400 block">ETA (Arrivée estimée)</span>
                    <span className="font-mono font-bold text-slate-800 dark:text-slate-100 mt-0.5 block">
                      {shipment.eta}
                    </span>
                    <span className="text-[9px] text-slate-400">{shipment.port_of_discharge || shipment.destination}</span>
                  </div>

                  <div className="bg-white dark:bg-slate-900 p-2.5 rounded-xl border border-slate-200/80 dark:border-slate-700">
                    <span className="text-[10px] font-semibold text-slate-400 block">Date Réelle d'Arrivée</span>
                    <span className="font-mono font-bold text-emerald-700 dark:text-emerald-400 mt-0.5 block">
                      {actualDate || 'En cours d\'acheminement'}
                    </span>
                    <span className="text-[9px] text-slate-400">Scan quai final</span>
                  </div>

                  <div className="bg-white dark:bg-slate-900 p-2.5 rounded-xl border border-indigo-200 dark:border-indigo-800">
                    <span className="text-[10px] font-bold text-indigo-700 dark:text-indigo-300 block">
                      Lead Time Estimé
                    </span>
                    <span className="font-mono font-extrabold text-indigo-900 dark:text-indigo-100 text-sm mt-0.5 block">
                      {estimatedLeadTime !== null ? `${estimatedLeadTime} jours` : '—'}
                    </span>
                    <span className="text-[9px] text-indigo-500">ETA - ETD</span>
                  </div>

                  <div className="bg-white dark:bg-slate-900 p-2.5 rounded-xl border border-purple-200 dark:border-purple-800 col-span-2 sm:col-span-1">
                    <span className="text-[10px] font-bold text-purple-700 dark:text-purple-300 block">
                      Lead Time Réel
                    </span>
                    <span className="font-mono font-extrabold text-purple-900 dark:text-purple-100 text-sm mt-0.5 block">
                      {actualLeadTime !== null ? `${actualLeadTime} jours` : 'En attente livraison'}
                    </span>
                    <span className="text-[9px] text-purple-500">Arrivée Réelle - ETD</span>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Operational Status Editing / View */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-800">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-700">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Building2 className="h-4 w-4 text-[#643288]" /> Pilotage Opérationnel Métier
              </h3>
              {canEdit && (
                <button
                  onClick={() => (isEditing ? handleSaveClick() : setIsEditing(true))}
                  className="flex items-center gap-1.5 rounded-xl bg-[#643288] px-3 py-1.5 text-xs font-semibold text-white shadow hover:bg-[#522870]"
                >
                  {isEditing ? (
                    <>
                      <Save className="h-3.5 w-3.5" /> Enregistrer les modifications
                    </>
                  ) : (
                    <>
                      <Edit2 className="h-3.5 w-3.5" /> Modifier les statuts
                    </>
                  )}
                </button>
              )}
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <label className="text-xs font-semibold text-slate-600 dark:text-slate-400">
                  Statut Global
                </label>
                {isEditing ? (
                  <select
                    value={editedStatus}
                    onChange={(e) => setEditedStatus(e.target.value as GlobalStatus)}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 p-2 text-xs font-medium dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                  >
                    <option value="Attente confirmation transitaire">Attente confirmation transitaire</option>
                    <option value="Reçu et expédié">Reçu et expédié</option>
                    <option value="En livraison vers Orly">En livraison vers Orly</option>
                    <option value="Bloqué douane">Bloqué douane</option>
                    <option value="Perdu Orly">Perdu Orly</option>
                    <option value="Livré entrepôt">Livré entrepôt</option>
                  </select>
                ) : (
                  <div className="mt-1 font-bold text-slate-900 dark:text-white text-sm">
                    {shipment.global_status}
                  </div>
                )}
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-600 dark:text-slate-400">
                  Statut Confirmation Antoine
                </label>
                {isEditing ? (
                  <select
                    value={editedAntoine}
                    onChange={(e) => setEditedAntoine(e.target.value as AntoineStatus)}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 p-2 text-xs font-medium dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                  >
                    <option value="Confirmé">Confirmé</option>
                    <option value="En attente Antoine">En attente Antoine</option>
                    <option value="Transmis transitaire">Transmis transitaire</option>
                    <option value="A vérifier">A vérifier</option>
                  </select>
                ) : (
                  <div className="mt-1 font-bold text-slate-900 dark:text-white text-sm">
                    {shipment.antoine_status}
                  </div>
                )}
              </div>

              {shipment.mode === 'Air' && (
                <div>
                  <label className="text-xs font-semibold text-amber-700 dark:text-amber-400">
                    Date Scan Orly (Manuelle)
                  </label>
                  {isEditing ? (
                    <input
                      type="date"
                      value={editedOrlyScanDate}
                      onChange={(e) => setEditedOrlyScanDate(e.target.value)}
                      className="mt-1 w-full rounded-xl border border-amber-200 bg-amber-50/50 p-2 text-xs font-mono dark:border-amber-900 dark:bg-amber-950/40 dark:text-white"
                    />
                  ) : (
                    <div className="mt-1 font-mono font-bold text-amber-800 dark:text-amber-300 text-sm">
                      {shipment.orly_scan_date || 'Non renseignée'}
                    </div>
                  )}
                </div>
              )}

              <div>
                <label className="text-xs font-semibold text-slate-600 dark:text-slate-400 flex items-center justify-between">
                  <span>Départ Madagascar</span>
                  <span className="text-[10px] font-mono bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 px-1.5 py-0.5 rounded border border-emerald-200 dark:border-emerald-800">
                    Calcul Automatique (Samedi)
                  </span>
                </label>
                <div className="mt-1 font-mono font-bold text-sm">
                  {(() => {
                    const scanDate = isEditing ? editedOrlyScanDate : shipment.orly_scan_date;
                    const depMada = calculateDepartureMadagascar(scanDate);
                    return depMada !== 'Non parti' ? (
                      <span className="text-emerald-600 dark:text-emerald-400">
                        {depMada}
                      </span>
                    ) : (
                      <span className="text-amber-600 dark:text-amber-400">
                        Non parti
                      </span>
                    );
                  })()}
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-600 dark:text-slate-400 flex items-center justify-between">
                  <span>ETA MADA S du</span>
                  <span className="text-[10px] font-mono bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 px-1.5 py-0.5 rounded border border-indigo-200 dark:border-indigo-800">
                    Calcul Automatique (Lundi)
                  </span>
                </label>
                <div className="mt-1 font-mono font-bold text-sm">
                  {(() => {
                    const scanDate = isEditing ? editedOrlyScanDate : shipment.orly_scan_date;
                    const etaMada = calculateEtaMadaSDu(scanDate);
                    return etaMada !== 'Non parti' ? (
                      <span className="text-indigo-600 dark:text-indigo-400">
                        {etaMada}
                      </span>
                    ) : (
                      <span className="text-amber-600 dark:text-amber-400">
                        Non parti
                      </span>
                    );
                  })()}
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-600 dark:text-slate-400">
                  Ref FA (DIGI - NXT)
                </label>
                {isEditing ? (
                  <input
                    type="text"
                    value={editedRefFa}
                    onChange={(e) => setEditedRefFa(e.target.value)}
                    placeholder="Ref FA (DIGI-NXT)..."
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 p-2 text-xs font-mono dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                  />
                ) : (
                  <div className="mt-1 font-mono font-bold text-indigo-700 dark:text-indigo-300 text-sm">
                    {shipment.ref_fa_digi_nxt || '—'}
                  </div>
                )}
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-600 dark:text-slate-400">
                  Date de Réception Mada
                </label>
                {isEditing ? (
                  <input
                    type="date"
                    value={editedMadaReceipt}
                    onChange={(e) => setEditedMadaReceipt(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 p-2 text-xs font-mono dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                  />
                ) : (
                  <div className="mt-1 font-mono font-bold text-emerald-700 dark:text-emerald-400 text-sm">
                    {shipment.mada_receipt_date || 'En attente'}
                  </div>
                )}
              </div>
            </div>

            <div className="mt-4">
              <label className="text-xs font-semibold text-slate-600 dark:text-slate-400">
                Remarques & Observations Supply Chain
              </label>
              {isEditing ? (
                <textarea
                  rows={2}
                  value={editedRemarks}
                  onChange={(e) => setEditedRemarks(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 p-2 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                />
              ) : (
                <p className="mt-1 text-xs text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-900/50 p-3 rounded-xl border border-slate-100 dark:border-slate-800">
                  {shipment.remarks || 'Aucune observation enregistrée.'}
                </p>
              )}
            </div>
          </div>

          {/* Maritime Deliveries Tracking (Rouen Hub) */}
          {shipment.mode === 'Sea' && (
            <div className="rounded-2xl border border-indigo-200 bg-white p-2 dark:border-indigo-900/60 dark:bg-slate-800 shadow-xs">
              <SeaDeliveriesTable
                shipment={shipment}
                onUpdateShipment={onSave}
                canEdit={canEdit}
              />
            </div>
          )}

          {/* Tracking History Timeline */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-800">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white pb-3 border-b border-slate-100 dark:border-slate-700 flex items-center gap-2">
              <Clock className="h-4 w-4 text-[#643288]" /> Historique des Événements Transporteur
            </h3>

            <div className="mt-4 space-y-4 relative pl-4 before:absolute before:left-1.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-200 dark:before:bg-slate-700">
              {shipment.history.map((step, idx) => (
                <div key={idx} className="relative flex items-start gap-3">
                  <div className="absolute -left-4 top-1.5 h-3 w-3 rounded-full bg-[#643288] ring-4 ring-white dark:ring-slate-800" />
                  <div className="flex-1 rounded-xl border border-slate-100 bg-slate-50/50 p-3 dark:border-slate-800 dark:bg-slate-900/50">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-900 dark:text-white">
                        {step.status}
                      </span>
                      <span className="text-[10px] font-mono text-slate-400">{step.date}</span>
                    </div>
                    <div className="text-xs text-slate-600 dark:text-slate-400 mt-0.5 flex items-center gap-1">
                      <MapPin className="h-3 w-3 text-slate-400" /> {step.location}
                    </div>
                    <div className="text-[11px] text-slate-500 mt-1">{step.details}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Documents Tab */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-800">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-700">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <FileText className="h-4 w-4 text-[#643288]" /> Documents Associés ({shipment.documents.length})
              </h3>
            </div>

            {shipment.documents.length === 0 ? (
              <p className="mt-4 text-xs text-slate-400 text-center py-4">
                Aucun document téléversé (Facture ou BL/AWB requis pour le dédouanement).
              </p>
            ) : (
              <div className="mt-4 space-y-2">
                {shipment.documents.map((doc) => (
                  <div
                    key={doc.id}
                    className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 p-3 text-xs dark:border-slate-800 dark:bg-slate-900"
                  >
                    <div className="flex items-center gap-3">
                      <FileText className="h-4 w-4 text-[#643288]" />
                      <div>
                        <div className="font-bold text-slate-800 dark:text-slate-200">
                          {doc.filename}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          Type: {doc.type} • {doc.size_kb} KB • {doc.uploaded_at}
                        </div>
                      </div>
                    </div>
                    <button className="flex items-center gap-1 text-xs font-semibold text-[#643288] hover:underline dark:text-pink-400">
                      <Download className="h-3.5 w-3.5" /> Télécharger
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
