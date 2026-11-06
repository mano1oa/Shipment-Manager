import React, { useEffect, useState } from 'react';
import {
  X,
  Maximize2,
  Minimize2,
  Plane,
  Ship,
  FileText,
  AlertTriangle,
  Send,
  CheckCircle2,
  Clock,
  MapPin,
  Copy,
  Check,
  Edit2,
  Save,
  Download,
  Trash2,
  Warehouse,
  Loader2,
  Lock,
  LockOpen,
} from 'lucide-react';
import {
  CONTAINER_TYPES,
  ContainerType,
  Shipment,
  GlobalStatus,
  shipmentValue,
  shipmentLabel,
} from '../types';
import { confirmShipment, unlockShipment, ConfirmationResult } from './shipmentApi';
import { formatDateTime } from '../lib/dateFormat';
import { SHIPMENT_STATUSES, applyAutomaticShipmentStatus } from '../lib/parcelTracking';
import { SeaDeliveriesTable } from './SeaDeliveriesTable';
import { calculateDepartureMadagascar, calculateEtaMadaSDu } from '../lib/rulesEngine';
import { DigiInvoice, fetchShipmentInvoices, formatDate } from './digiApi';
import { ShipmentContentsPanel } from './ShipmentContentsPanel';
import DateInput from './DateInput';

interface ShipmentDetailModalProps {
  shipment: Shipment | null;
  onClose: () => void;
  canEdit: boolean;
  onSave: (updatedShipment: Shipment) => void;
  onDelete?: (shipmentId: string) => void;
  onDispatchGoogleChat: (message: string, space?: string) => Promise<void>;
  /** Supply Chain: changes the invoices of the shipment, flags missing parcels. */
  isSupplyChain?: boolean;
  /** Every shipment (invoices of former shipments "to review" can be regrouped). */
  shipments?: Shipment[];
  /** Invoices / parcels changed; emptied = former shipments left without invoice. */
  onContentsChanged?: (emptied: string[]) => void;
}

const GLOBAL_STATUSES: readonly GlobalStatus[] = SHIPMENT_STATUSES;
const CUSTOMS_STATUSES: Shipment['customs_status'][] = ['Non Requis', 'En cours', 'Dédouané', 'Bloqué Douane'];

const inputClass =
  'mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-900 focus:border-[#623387] focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-white';
const cardClass = 'rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-800/60';
const amountFormat = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Days between two dates, null when one is missing or invalid. */
function daysBetween(from?: string, to?: string): number | null {
  if (!from || !to) return null;
  const a = new Date(from);
  const b = new Date(to);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

const Field: React.FC<{ label: string; hint?: string; children: React.ReactNode }> = ({ label, hint, children }) => (
  <div>
    <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-400">
      {label}
      {hint && <span className="normal-case tracking-normal text-slate-400/80">· {hint}</span>}
    </div>
    <div className="mt-0.5 text-sm font-semibold text-slate-900 dark:text-white">{children}</div>
  </div>
);

const SectionTitle: React.FC<{ icon: React.ElementType; children: React.ReactNode; right?: React.ReactNode }> = ({
  icon: Icon,
  children,
  right,
}) => (
  <div className="mb-4 flex items-center justify-between">
    <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
      <Icon className="h-4 w-4 text-slate-400" /> {children}
    </h3>
    {right}
  </div>
);

const empty = <span className="font-normal text-slate-400">—</span>;

export const ShipmentDetailModal: React.FC<ShipmentDetailModalProps> = ({
  shipment,
  onClose,
  canEdit,
  onSave,
  onDelete,
  onDispatchGoogleChat,
  isSupplyChain = false,
  shipments = [],
  onContentsChanged = (_emptied: string[]) => {},
}) => {
  if (!shipment) return null;

  const [isEditing, setIsEditing] = useState(false);
  /** Whole screen: invoices and their lines readable without scrolling a small box. */
  const [fullScreen, setFullScreen] = useState(false);
  const [draft, setDraft] = useState<Shipment>(shipment);
  const [carriers, setCarriers] = useState<string[]>([]);
  const [invoices, setInvoices] = useState<DigiInvoice[] | null>(null);
  const [invoicesError, setInvoicesError] = useState<string | null>(null);
  const [copiedRelance, setCopiedRelance] = useState(false);
  const [dispatchingChat, setDispatchingChat] = useState(false);
  const [chatSuccess, setChatSuccess] = useState(false);
  const [locking, setLocking] = useState(false);
  /** Memo of the last confirmation (to copy when Google Chat did not receive it). */
  const [confirmation, setConfirmation] = useState<ConfirmationResult | null>(null);
  const [copiedMemo, setCopiedMemo] = useState(false);
  const label = shipmentLabel(shipment);
  const confirmed = Boolean(shipment.confirmed_at);

  useEffect(() => {
    setDraft(shipment);
    setIsEditing(false);
  }, [shipment]);

  const loadInvoices = () => {
    setInvoicesError(null);
    fetchShipmentInvoices(shipment.id)
      .then(setInvoices)
      .catch((err) => setInvoicesError(err.message));
  };

  useEffect(() => {
    setInvoices(null);
    loadInvoices();
  }, [shipment.id]);

  useEffect(() => {
    if (!isEditing || carriers.length > 0) return;
    fetch('/api/reference/carriers', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => setCarriers((d?.carriers || []).map((c: { name: string }) => c.name)))
      .catch(() => setCarriers([]));
  }, [isEditing, carriers.length]);

  const set = <K extends keyof Shipment>(key: K, value: Shipment[K]) => setDraft((prev) => ({ ...prev, [key]: value }));
  const view = isEditing ? draft : shipment;
  const isSea = view.mode === 'Sea';
  const activeAlert = shipment.alerts && shipment.alerts.length > 0 ? shipment.alerts[0] : null;

  const invoicesTotal =
    invoices && invoices.some((i) => i.amount_total !== null)
      ? invoices.reduce((sum, i) => sum + (i.amount_total ?? 0), 0)
      : null;
  // The API total converts "hors DIGI" USD amounts; the local sum is a fallback
  const value =
    invoices && invoices.length > 0 ? shipment.digi_invoice_total ?? invoicesTotal : shipmentValue(shipment) || null;

  const handleSave = () => {
    const updated: Shipment = {
      ...applyAutomaticShipmentStatus(draft),
      departure_madagascar: calculateDepartureMadagascar(draft.orly_scan_date),
      updated_at: new Date().toISOString().split('T')[0],
    };
    onSave(updated);
    setIsEditing(false);
  };

  const handleCopyRelance = (text: string) => {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopiedRelance(true);
        setTimeout(() => setCopiedRelance(false), 2500);
      })
      .catch(() => window.alert('Copie impossible : le navigateur a refusé l’accès au presse-papier.'));
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

  const handleConfirm = async () => {
    if (
      !window.confirm(
        `Confirmer l'expédition ${label} ?\n\nSes factures et colis seront verrouillés (plus d'ajout ni de retrait) et le récapitulatif des colis sera envoyé sur Google Chat.`
      )
    )
      return;
    setLocking(true);
    try {
      setConfirmation(await confirmShipment(shipment.id));
      onContentsChanged([]);
    } catch (err: any) {
      window.alert(err.message);
    } finally {
      setLocking(false);
    }
  };

  const handleUnlock = async () => {
    if (!window.confirm(`Déverrouiller l'expédition ${label} pour corriger ses factures ou colis ?\n\nIl faudra la confirmer à nouveau (le message Google Chat sera renvoyé).`)) return;
    setLocking(true);
    try {
      await unlockShipment(shipment.id);
      setConfirmation(null);
      onContentsChanged([]);
    } catch (err: any) {
      window.alert(err.message);
    } finally {
      setLocking(false);
    }
  };

  const departureMada = calculateDepartureMadagascar(view.orly_scan_date);
  const etaMada = calculateEtaMadaSDu(view.orly_scan_date);
  const actualArrival = view.actual_arrival_date || view.actual_delivery;
  const estimatedLeadTime = daysBetween(view.etd, view.eta);
  const actualLeadTime = daysBetween(view.etd, actualArrival);

  return (
    <div
      className={`fixed inset-0 z-50 flex justify-center bg-slate-900/60 backdrop-blur-xs ${
        fullScreen ? '' : 'items-center overflow-y-auto p-4'
      }`}
    >
      <div
        className={`relative w-full border-slate-200 bg-slate-50 shadow-2xl dark:border-slate-800 dark:bg-slate-900 ${
          fullScreen ? 'flex h-full flex-col' : 'my-8 max-w-4xl rounded-3xl border'
        }`}
      >
        {/* Header */}
        <div className={`flex items-start justify-between gap-4 ${fullScreen ? '' : 'rounded-t-3xl'} border-b border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900`}>
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              {isSea ? <Ship className="h-5 w-5" /> : <Plane className="h-5 w-5" />}
            </div>
            <div>
              <h2 className="flex flex-wrap items-center gap-x-2 text-lg font-extrabold text-slate-900 dark:text-white">
                {label}
                <span className="text-sm font-semibold text-slate-400">{isSea ? 'Maritime' : 'Aérien'}</span>
                {confirmed && (
                  <span
                    title={`Confirmée le ${formatDateTime(shipment.confirmed_at)} par ${shipment.confirmed_by_email || '—'}`}
                    className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                  >
                    <Lock className="h-3 w-3" /> Confirmée
                  </span>
                )}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {[
                  // "0 fournisseurs": shipment without invoice yet
                  !/^0 fournisseur/.test(shipment.supplier || '') && shipment.supplier,
                  shipment.order_reference && `Réf. ordre ${shipment.order_reference}`,
                  // Named by its internal ref: its sale invoice shown beside
                  shipment.internal_ref && shipment.ref_fa_digi_nxt && `FA ${shipment.ref_fa_digi_nxt}`,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {isSupplyChain && !isEditing && !shipment.needs_review && (
              <button
                type="button"
                onClick={confirmed ? handleUnlock : handleConfirm}
                disabled={locking}
                title={
                  confirmed
                    ? 'Rouvrir les factures et colis pour les corriger'
                    : 'Verrouiller les factures et colis et envoyer le récapitulatif sur Google Chat'
                }
                className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold disabled:opacity-50 ${
                  confirmed
                    ? 'border border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800'
                    : 'bg-emerald-600 text-white shadow-sm hover:bg-emerald-700'
                }`}
              >
                {locking ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : confirmed ? (
                  <LockOpen className="h-3.5 w-3.5" />
                ) : (
                  <Lock className="h-3.5 w-3.5" />
                )}
                {confirmed ? 'Déverrouiller' : "Confirmer l'expédition"}
              </button>
            )}
            {canEdit && isEditing && onDelete && !confirmed && (
              <button
                type="button"
                onClick={() => {
                  if (window.confirm(`Confirmez-vous la suppression définitive de l'expédition ${label} ?`)) {
                    onDelete(shipment.id);
                    onClose();
                  }
                }}
                className="flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-50 dark:border-slate-700 dark:hover:bg-rose-950/40"
              >
                <Trash2 className="h-3.5 w-3.5" /> Supprimer
              </button>
            )}
            {canEdit && isEditing && (
              <button
                type="button"
                onClick={() => {
                  setDraft(shipment);
                  setIsEditing(false);
                }}
                className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                Annuler
              </button>
            )}
            {canEdit && (
              <button
                type="button"
                onClick={() => (isEditing ? handleSave() : setIsEditing(true))}
                className="flex items-center gap-1.5 rounded-xl bg-[#623387] px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-[#522870]"
              >
                {isEditing ? (
                  <>
                    <Save className="h-3.5 w-3.5" /> Enregistrer
                  </>
                ) : (
                  <>
                    <Edit2 className="h-3.5 w-3.5" /> Modifier
                  </>
                )}
              </button>
            )}
            <button
              type="button"
              onClick={() => setFullScreen((v) => !v)}
              title={fullScreen ? 'Quitter le plein écran' : 'Plein écran'}
              className="rounded-xl p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-white"
            >
              {fullScreen ? <Minimize2 className="h-5 w-5" /> : <Maximize2 className="h-5 w-5" />}
            </button>
            <button
              onClick={onClose}
              className="rounded-xl p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-white"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className={`space-y-5 overflow-y-auto p-6 ${fullScreen ? 'min-h-0 flex-1' : 'max-h-[75vh]'}`}>
          {/* Active alert */}
          {activeAlert && (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 dark:border-rose-900/60 dark:bg-rose-950/30">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-600 dark:text-rose-400" />
                <div className="flex-1 space-y-2">
                  <h3 className="text-sm font-bold text-rose-900 dark:text-rose-200">{activeAlert.title}</h3>
                  <p className="text-xs text-rose-800 dark:text-rose-300">{activeAlert.reason}</p>

                  {activeAlert.relance_draft && (
                    <div className="mt-3 rounded-xl border border-rose-100 bg-white p-3 dark:border-rose-900/50 dark:bg-slate-900">
                      <div className="flex items-center justify-between border-b border-slate-100 pb-2 dark:border-slate-800">
                        <span className="flex items-center gap-1.5 text-xs font-bold text-slate-800 dark:text-slate-200">
                          <Send className="h-3.5 w-3.5 text-slate-400" /> Message de relance
                        </span>
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleCopyRelance(activeAlert.relance_draft!)}
                            className="flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200"
                          >
                            {copiedRelance ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                            {copiedRelance ? 'Copié' : 'Copier'}
                          </button>
                          {canEdit && (
                            <button
                              onClick={() => handleSendChat(activeAlert.relance_draft!)}
                              disabled={dispatchingChat}
                              className="flex items-center gap-1 rounded-lg bg-[#623387] px-3 py-1 text-[11px] font-semibold text-white hover:bg-[#522870] disabled:opacity-50"
                            >
                              <Send className="h-3 w-3" />
                              {dispatchingChat ? 'Envoi...' : 'Envoyer Google Chat'}
                            </button>
                          )}
                        </div>
                      </div>
                      <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-slate-50 p-2.5 font-sans text-xs leading-relaxed text-slate-700 dark:bg-slate-950 dark:text-slate-300">
                        {activeAlert.relance_draft}
                      </pre>
                      {chatSuccess && (
                        <div className="mt-2 flex items-center gap-1.5 text-xs font-bold text-emerald-600 dark:text-emerald-400">
                          <CheckCircle2 className="h-4 w-4" /> Message envoyé sur Google Chat.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {shipment.needs_review && shipment.global_status === 'En préparation' && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
              <strong>Expédition de l'ancien modèle, pas encore partie</strong> (ancien statut :{' '}
              {shipment.legacy_global_status || 'non défini'}). Elle correspondait à un colis fournisseur : regroupez ses
              factures dans l'expédition {isSea ? 'Rouen' : 'Orly'} → Mada de la semaine (« Nouvelle expédition »), puis
              supprimez-la.
            </div>
          )}

          {confirmation && (
            <div
              className={`rounded-2xl border p-4 text-xs ${
                confirmation.chat_sent
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200'
                  : 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <strong className="flex items-center gap-1.5">
                  <CheckCircle2 className="h-4 w-4" />
                  {confirmation.chat_sent
                    ? 'Expédition confirmée, récapitulatif envoyé sur Google Chat.'
                    : `Expédition confirmée, mais message Google Chat non envoyé : ${confirmation.chat_error}`}
                </strong>
                <button
                  onClick={() =>
                    navigator.clipboard.writeText(confirmation.message).then(() => {
                      setCopiedMemo(true);
                      setTimeout(() => setCopiedMemo(false), 2500);
                    })
                  }
                  className="flex shrink-0 items-center gap-1 rounded-lg border border-current/20 px-2.5 py-1 text-[11px] font-semibold"
                >
                  {copiedMemo ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                  {copiedMemo ? 'Copié' : 'Copier le message'}
                </button>
              </div>
              <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-white/70 p-2.5 font-sans leading-relaxed text-slate-700 dark:bg-slate-950 dark:text-slate-300">
                {confirmation.message}
              </pre>
            </div>
          )}

          {/* 1. Main information */}
          <div className={cardClass}>
            <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-5">
              <Field label="Transitaire">
                {isEditing ? (
                  <>
                    <input
                      list="shipment-carriers"
                      value={draft.carrier || ''}
                      onChange={(e) => set('carrier', e.target.value)}
                      className={inputClass}
                    />
                    <datalist id="shipment-carriers">
                      {carriers.map((c) => (
                        <option key={c} value={c} />
                      ))}
                    </datalist>
                    <select
                      value={draft.mode}
                      onChange={(e) => set('mode', e.target.value as Shipment['mode'])}
                      className={inputClass}
                    >
                      <option value="Air">Aérien</option>
                      <option value="Sea">Maritime</option>
                    </select>
                  </>
                ) : (
                  view.carrier || empty
                )}
              </Field>

              <Field label="Référence d'ordre">
                {isEditing && isSupplyChain ? (
                  <input
                    value={draft.order_reference || ''}
                    onChange={(e) => set('order_reference', e.target.value)}
                    className={inputClass}
                  />
                ) : (
                  <span className="font-mono">{view.order_reference || empty}</span>
                )}
              </Field>

              {isSea && (
                <>
                  <Field label="Réf interne" hint="MAR/2026/014">
                    {isEditing && isSupplyChain ? (
                      <input
                        value={draft.internal_ref || ''}
                        placeholder="MAR/2026/001"
                        onChange={(e) => set('internal_ref', e.target.value.toUpperCase())}
                        className={`${inputClass} font-mono`}
                      />
                    ) : (
                      <span className="font-mono">{view.internal_ref || empty}</span>
                    )}
                  </Field>

                  <Field label="Type d'envoi">
                    {isEditing ? (
                      <select
                        value={draft.container_type || ''}
                        onChange={(e) => set('container_type', e.target.value as ContainerType | '')}
                        className={inputClass}
                      >
                        <option value="">—</option>
                        {CONTAINER_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    ) : (
                      view.container_type || empty
                    )}
                  </Field>

                  <Field label="Compagnie maritime">
                    {isEditing ? (
                      <input
                        value={draft.shipping_line || ''}
                        placeholder="MSC, CMA CGM…"
                        onChange={(e) => set('shipping_line', e.target.value)}
                        className={inputClass}
                      />
                    ) : (
                      view.shipping_line || empty
                    )}
                  </Field>

                  <Field label="Poids total">
                    {isEditing ? (
                      <input
                        type="number"
                        min={0}
                        step="0.1"
                        value={draft.weight_kg || ''}
                        onChange={(e) => set('weight_kg', Number(e.target.value) || 0)}
                        className={inputClass}
                      />
                    ) : view.weight_kg ? (
                      `${amountFormat.format(view.weight_kg)} kg`
                    ) : (
                      empty
                    )}
                  </Field>
                </>
              )}

              <Field label={isSea ? 'BL et conteneur' : 'LTA'}>
                {isEditing ? (
                  <>
                    <input
                      value={draft.bl_awb || ''}
                      placeholder={isSea ? 'N° BL' : 'N° LTA'}
                      onChange={(e) => set('bl_awb', e.target.value)}
                      disabled={!isSupplyChain}
                      title={isSupplyChain ? undefined : 'Modifiable par la Supply Chain'}
                      className={`${inputClass} disabled:opacity-60`}
                    />
                    {isSea && (
                      <input
                        value={draft.container_no || ''}
                        placeholder="N° conteneur"
                        onChange={(e) => set('container_no', e.target.value)}
                        className={inputClass}
                      />
                    )}
                  </>
                ) : (
                  <span className="font-mono">
                    {view.bl_awb || view.swb_no || empty}
                    {isSea && (
                      <span className="block text-xs font-normal text-slate-500">
                        Conteneur : {view.container_no || '—'}
                      </span>
                    )}
                  </span>
                )}
              </Field>

              <Field label="ETA">
                {isEditing ? (
                  <DateInput
                    value={draft.eta || ''}
                    onChange={(v) => set('eta', v)}
                    className={inputClass}
                  />
                ) : view.eta ? (
                  formatDate(view.eta.slice(0, 10))
                ) : (
                  empty
                )}
              </Field>

              <Field
                label="Valeur"
                hint={
                  invoices && invoices.length > 0
                    ? `${invoices.length} facture${invoices.length > 1 ? 's' : ''}`
                    : value
                    ? 'saisie manuelle'
                    : undefined
                }
              >
                {invoices === null && !invoicesError ? (
                  <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
                ) : value !== null ? (
                  `${amountFormat.format(value)} €`
                ) : (
                  empty
                )}
              </Field>
            </div>
          </div>

          {/* 2. Orly → Madagascar */}
          <div className={cardClass}>
            <SectionTitle icon={Warehouse}>Suivi {isSea ? 'Rouen' : 'Orly'} → Madagascar</SectionTitle>
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
              <Field label="Statut de l'expédition">
                {isEditing ? (
                  <select
                    value={draft.global_status}
                    onChange={(e) => set('global_status', e.target.value as GlobalStatus)}
                    className={inputClass}
                  >
                    {GLOBAL_STATUSES.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                ) : (
                  view.global_status || empty
                )}
              </Field>

              {!isSea && (
                <Field label="Remise / scan à Orly" hint="donne le départ du samedi">
                  {isEditing ? (
                    <DateInput
                      value={draft.orly_scan_date || ''}
                      onChange={(v) => set('orly_scan_date', v)}
                      className={inputClass}
                    />
                  ) : view.orly_scan_date ? (
                    formatDate(view.orly_scan_date)
                  ) : (
                    empty
                  )}
                </Field>
              )}

              <Field label="Départ Madagascar" hint="auto">
                {departureMada !== 'Non parti' ? formatDate(departureMada) : <span className="font-normal text-slate-400">Non parti</span>}
              </Field>

              <Field label="ETA Mada (semaine du)" hint="auto">
                {etaMada !== 'Non parti' ? formatDate(etaMada) : <span className="font-normal text-slate-400">Non parti</span>}
              </Field>

              <Field label="Réception Madagascar">
                {isEditing ? (
                  <DateInput
                    value={draft.mada_receipt_date || ''}
                    onChange={(v) => set('mada_receipt_date', v)}
                    className={inputClass}
                  />
                ) : view.mada_receipt_date ? (
                  formatDate(view.mada_receipt_date)
                ) : (
                  empty
                )}
              </Field>

              <Field label="Réf FA DIGI → NXT">
                {isEditing ? (
                  <input
                    value={draft.ref_fa_digi_nxt || ''}
                    onChange={(e) => set('ref_fa_digi_nxt', e.target.value)}
                    className={inputClass}
                  />
                ) : (
                  <span className="font-mono">{view.ref_fa_digi_nxt || empty}</span>
                )}
              </Field>

              <Field label="Douane">
                {isEditing ? (
                  <select
                    value={draft.customs_status}
                    onChange={(e) => set('customs_status', e.target.value as Shipment['customs_status'])}
                    className={inputClass}
                  >
                    {CUSTOMS_STATUSES.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                ) : (
                  view.customs_status || empty
                )}
              </Field>
            </div>

            <div className="mt-5">
              <Field label="Remarques">
                {isEditing ? (
                  <textarea
                    rows={2}
                    value={draft.remarks || ''}
                    onChange={(e) => set('remarks', e.target.value)}
                    className={inputClass}
                  />
                ) : (
                  <span className="font-normal text-slate-700 dark:text-slate-300">{view.remarks || '—'}</span>
                )}
              </Field>
            </div>
          </div>

          {/* 3. Lead times */}
          <div className={cardClass}>
            <SectionTitle icon={Clock}>Délais d'acheminement</SectionTitle>
            <div className="grid grid-cols-2 gap-5 sm:grid-cols-4">
              <Field label="ETD (départ)">
                {isEditing ? (
                  <DateInput
                    value={draft.etd || ''}
                    onChange={(v) => set('etd', v)}
                    className={inputClass}
                  />
                ) : view.etd ? (
                  formatDate(view.etd.slice(0, 10))
                ) : (
                  empty
                )}
              </Field>
              <Field label="Arrivée réelle">
                {isEditing ? (
                  <DateInput
                    value={draft.actual_arrival_date || ''}
                    onChange={(v) => set('actual_arrival_date', v)}
                    className={inputClass}
                  />
                ) : actualArrival ? (
                  formatDate(actualArrival.slice(0, 10))
                ) : (
                  empty
                )}
              </Field>
              <Field label="Lead time estimé" hint="ETA − ETD">
                {estimatedLeadTime !== null ? `${estimatedLeadTime} j` : empty}
              </Field>
              <Field label="Lead time réel" hint="arrivée − ETD">
                {actualLeadTime !== null ? `${actualLeadTime} j` : empty}
              </Field>
            </div>
          </div>

          {/* 4. Invoices and parcels of the shipment, arrival check */}
          <ShipmentContentsPanel
            shipment={shipment}
            invoices={invoices}
            invoicesError={invoicesError}
            isSupplyChain={isSupplyChain}
            canEditReceipts={canEdit}
            shipments={shipments}
            onChanged={(emptied) => {
              loadInvoices();
              onContentsChanged(emptied || []);
            }}
          />

          {/* Maritime deliveries (Rouen) */}
          {isSea && (
            <div className={cardClass}>
              <SeaDeliveriesTable shipment={shipment} onUpdateShipment={onSave} canEdit={canEdit} />
            </div>
          )}

          {/* 6. History */}
          <div className={cardClass}>
            <SectionTitle icon={Clock}>Historique</SectionTitle>
            {shipment.history.length === 0 ? (
              <p className="text-xs text-slate-400">Aucune étape enregistrée.</p>
            ) : (
              <ol className="space-y-3 border-l border-slate-200 pl-4 dark:border-slate-700">
                {shipment.history.map((step, idx) => (
                  <li key={idx} className="relative text-xs">
                    <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full bg-slate-300 ring-4 ring-white dark:bg-slate-600 dark:ring-slate-800" />
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-semibold text-slate-800 dark:text-slate-100">{step.status}</span>
                      <span className="font-mono text-[10px] text-slate-400">{formatDate(step.date)}</span>
                    </div>
                    {step.location && (
                      <div className="mt-0.5 flex items-center gap-1 text-slate-500">
                        <MapPin className="h-3 w-3" /> {step.location}
                      </div>
                    )}
                    {step.details && <div className="mt-0.5 text-slate-500">{step.details}</div>}
                  </li>
                ))}
              </ol>
            )}
          </div>

          {/* 7. Documents */}
          <div className={cardClass}>
            <SectionTitle icon={FileText}>Documents ({shipment.documents.length})</SectionTitle>
            {shipment.documents.length === 0 ? (
              <p className="text-xs text-slate-400">Aucun document.</p>
            ) : (
              <div className="space-y-2">
                {shipment.documents.map((doc) => (
                  <div
                    key={doc.id}
                    className="flex items-center justify-between rounded-xl border border-slate-100 p-3 text-xs dark:border-slate-700"
                  >
                    <div className="flex items-center gap-3">
                      <FileText className="h-4 w-4 text-slate-400" />
                      <div>
                        <div className="font-semibold text-slate-800 dark:text-slate-200">{doc.filename}</div>
                        <div className="text-[10px] text-slate-400">
                          {doc.type} · {doc.size_kb} KB · {formatDate(doc.uploaded_at)}
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled
                      title="Stockage des fichiers pas encore disponible : seules les informations du document sont enregistrées."
                      className="flex items-center gap-1 text-xs font-semibold text-slate-400 cursor-not-allowed"
                    >
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
