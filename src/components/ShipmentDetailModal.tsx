import React, { useEffect, useState } from 'react';
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
  Copy,
  Check,
  Edit2,
  Save,
  Download,
  Trash2,
  ReceiptText,
  Warehouse,
  Loader2,
} from 'lucide-react';
import { Shipment, GlobalStatus, AntoineStatus, shipmentValue, ANTOINE_STATUSES, ANTOINE_STATUS_LABELS } from '../types';
import { SHIPMENT_STATUSES, applyAutomaticShipmentStatus } from '../lib/parcelTracking';
import { SeaDeliveriesTable } from './SeaDeliveriesTable';
import { TrackingPanel } from './TrackingPanel';
import { calculateDepartureMadagascar, calculateEtaMadaSDu } from '../lib/rulesEngine';
import { DigiInvoice, fetchShipmentInvoices, formatAmount, formatDate, formatQuantity } from './digiApi';

interface ShipmentDetailModalProps {
  shipment: Shipment | null;
  onClose: () => void;
  canEdit: boolean;
  onSave: (updatedShipment: Shipment) => void;
  onDelete?: (shipmentId: string) => void;
  onDispatchGoogleChat: (message: string, space?: string) => Promise<void>;
}

const GLOBAL_STATUSES: readonly GlobalStatus[] = SHIPMENT_STATUSES;
const CUSTOMS_STATUSES: Shipment['customs_status'][] = ['Non Requis', 'En cours', 'Dédouané', 'Bloqué Douane'];

const inputClass =
  'mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-900 focus:border-[#643288] focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-white';
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
}) => {
  if (!shipment) return null;

  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState<Shipment>(shipment);
  const [carriers, setCarriers] = useState<string[]>([]);
  const [invoices, setInvoices] = useState<DigiInvoice[] | null>(null);
  const [invoicesError, setInvoicesError] = useState<string | null>(null);
  const [copiedRelance, setCopiedRelance] = useState(false);
  const [dispatchingChat, setDispatchingChat] = useState(false);
  const [chatSuccess, setChatSuccess] = useState(false);

  useEffect(() => {
    setDraft(shipment);
    setIsEditing(false);
  }, [shipment]);

  useEffect(() => {
    setInvoices(null);
    setInvoicesError(null);
    fetchShipmentInvoices(shipment.id)
      .then(setInvoices)
      .catch((err) => setInvoicesError(err.message));
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
      orly_shipment_status: draft.orly_scan_date ? 'Scanné & Expédié Orly' : shipment.orly_shipment_status,
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

  const departureMada = calculateDepartureMadagascar(view.orly_scan_date);
  const etaMada = calculateEtaMadaSDu(view.orly_scan_date);
  const actualArrival = view.actual_arrival_date || view.actual_delivery;
  const estimatedLeadTime = daysBetween(view.etd, view.eta);
  const actualLeadTime = daysBetween(view.etd, actualArrival);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs overflow-y-auto">
      <div className="relative w-full max-w-4xl rounded-3xl border border-slate-200 bg-slate-50 shadow-2xl dark:border-slate-800 dark:bg-slate-900 my-8">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 rounded-t-3xl border-b border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              {isSea ? <Ship className="h-5 w-5" /> : <Plane className="h-5 w-5" />}
            </div>
            <div>
              <h2 className="text-lg font-extrabold text-slate-900 dark:text-white">
                {shipment.id}
                <span className="ml-2 text-sm font-semibold text-slate-400">{isSea ? 'Maritime' : 'Aérien'}</span>
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {[
                  shipment.supplier,
                  shipment.order_reference && `Commande ${shipment.order_reference}`,
                  shipment.ref_fa_digi_nxt && `FA ${shipment.ref_fa_digi_nxt}`,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {canEdit && isEditing && onDelete && (
              <button
                type="button"
                onClick={() => {
                  if (window.confirm(`Confirmez-vous la suppression définitive de l'expédition ${shipment.id} ?`)) {
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
                className="flex items-center gap-1.5 rounded-xl bg-[#643288] px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-[#522870]"
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
              onClick={onClose}
              className="rounded-xl p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-white"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="max-h-[75vh] space-y-5 overflow-y-auto p-6">
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
                              className="flex items-center gap-1 rounded-lg bg-[#643288] px-3 py-1 text-[11px] font-semibold text-white hover:bg-[#522870] disabled:opacity-50"
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

          {/* 1. Main information */}
          <div className={cardClass}>
            <div className="grid grid-cols-2 gap-5 sm:grid-cols-4">
              <Field label="Transporteur">
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

              <Field label={isSea ? 'BL & conteneur' : 'LTA'}>
                {isEditing ? (
                  <>
                    <input
                      value={draft.bl_awb || ''}
                      placeholder={isSea ? 'N° BL' : 'N° LTA'}
                      onChange={(e) => set('bl_awb', e.target.value)}
                      className={inputClass}
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
                  <input
                    type="date"
                    value={draft.eta || ''}
                    onChange={(e) => set('eta', e.target.value)}
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

          {/* 2. Carrier tracking, next to the carrier */}
          <TrackingPanel shipmentId={shipment.id} canEdit={canEdit} />

          {/* 3. Invoice lines */}
          <div className={cardClass}>
            <SectionTitle icon={ReceiptText}>Lignes de facture</SectionTitle>
            {invoicesError ? (
              <p className="text-xs text-rose-600">{invoicesError}</p>
            ) : invoices === null ? (
              <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
            ) : invoices.length === 0 ? (
              <p className="text-xs text-slate-400">Aucune facture DIGI rattachée à cette expédition.</p>
            ) : (
              <div className="space-y-4">
                {invoices.map((inv) => (
                  <div key={inv.id}>
                    <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2 text-xs">
                      <span className="font-semibold text-slate-800 dark:text-slate-100">
                        Facture {inv.ref || inv.odoo_move_name || '—'}
                        <span className="ml-2 font-normal text-slate-400">
                          {[
                            formatDate(inv.invoice_date),
                            inv.amazon_order_ref && `Amazon ${inv.amazon_order_ref}`,
                            inv.sale_move_ref && `Vente ${inv.sale_move_ref}`,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      </span>
                      <span className="font-semibold text-slate-800 dark:text-slate-100">
                        {formatAmount(inv.amount_total)} €
                      </span>
                    </div>
                    <table className="w-full text-left text-xs">
                      <thead className="text-[10px] uppercase tracking-wide text-slate-400">
                        <tr className="border-b border-slate-100 dark:border-slate-700">
                          <th className="py-1.5 pr-2 font-medium">Libellé</th>
                          <th className="w-16 py-1.5 px-2 text-right font-medium">Qté</th>
                          <th className="w-24 py-1.5 px-2 text-right font-medium">Prix</th>
                          <th className="w-24 py-1.5 pl-2 text-right font-medium">Sous-total</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                        {inv.lines.map((line) => (
                          <tr key={line.id} className={line.is_service ? 'text-slate-400' : 'text-slate-700 dark:text-slate-200'}>
                            <td className="py-1.5 pr-2">{line.name}</td>
                            <td className="py-1.5 px-2 text-right">{formatQuantity(line.quantity)}</td>
                            <td className="py-1.5 px-2 text-right">{formatAmount(line.price_unit)}</td>
                            <td className="py-1.5 pl-2 text-right">{formatAmount(line.price_subtotal)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 4. Orly → Madagascar */}
          <div className={cardClass}>
            <SectionTitle icon={Warehouse}>Suivi Orly → Madagascar</SectionTitle>
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
              <Field label="Statut global">
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

              <Field label="Statut du colis à Orly" hint="Antoine">
                {isEditing ? (
                  <select
                    value={draft.antoine_status}
                    onChange={(e) => set('antoine_status', e.target.value as AntoineStatus)}
                    className={inputClass}
                  >
                    {/* A former status stays selectable on the shipment that has it */}
                    {[
                      ...(shipment.antoine_status && !ANTOINE_STATUSES.includes(shipment.antoine_status)
                        ? [shipment.antoine_status]
                        : []),
                      ...ANTOINE_STATUSES,
                    ].map((s) => (
                      <option key={s} value={s}>
                        {ANTOINE_STATUS_LABELS[s] || s}
                      </option>
                    ))}
                  </select>
                ) : (
                  (view.antoine_status && (ANTOINE_STATUS_LABELS[view.antoine_status] || view.antoine_status)) || empty
                )}
              </Field>

              {!isSea && (
                <Field label="Date de scan Orly">
                  {isEditing ? (
                    <input
                      type="date"
                      value={draft.orly_scan_date || ''}
                      onChange={(e) => set('orly_scan_date', e.target.value)}
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
                  <input
                    type="date"
                    value={draft.mada_receipt_date || ''}
                    onChange={(e) => set('mada_receipt_date', e.target.value)}
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

          {/* 5. Lead times */}
          <div className={cardClass}>
            <SectionTitle icon={Clock}>Délais d'acheminement</SectionTitle>
            <div className="grid grid-cols-2 gap-5 sm:grid-cols-4">
              <Field label="ETD (départ)">
                {isEditing ? (
                  <input
                    type="date"
                    value={draft.etd || ''}
                    onChange={(e) => set('etd', e.target.value)}
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
                  <input
                    type="date"
                    value={draft.actual_arrival_date || ''}
                    onChange={(e) => set('actual_arrival_date', e.target.value)}
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
