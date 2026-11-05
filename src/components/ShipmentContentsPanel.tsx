import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  ClipboardCheck,
  Loader2,
  Lock,
  Package,
  Plus,
  Printer,
  ReceiptText,
  SearchX,
  Undo2,
  X,
} from 'lucide-react';
import { Shipment, shipmentLabel } from '../types';
import { parcelStatusHint, parcelStatusLabel } from '../lib/parcelTracking';
import {
  DigiInvoice,
  Parcel,
  fetchShipmentParcels,
  formatAmount,
  formatDate,
  formatQuantity,
  isInvoiceReceived,
  removeInvoiceFromShipment,
  setParcelStatus,
} from './digiApi';
import { PARCEL_STATUS_BADGES } from './InvoiceParcelsPanel';
import { ShipmentInvoicesModal } from './ShipmentInvoicesModal';
import { ReceivedArticle, articleKey, fetchReceivedArticles, receivedGap } from './shipmentApi';
import { ReceivedQuantityInput } from './ReceivedQuantityInput';

interface Props {
  shipment: Shipment;
  invoices: DigiInvoice[] | null;
  invoicesError: string | null;
  /** Supply Chain: adds / removes invoices, flags parcels missing on arrival. */
  isSupplyChain: boolean;
  /** Sourcing and Supply Chain: type the quantities received in Madagascar. */
  canEditReceipts: boolean;
  shipments: Shipment[];
  /** Invoices or parcels changed: reload the shipment, its invoices and the parcels. */
  onChanged: (emptied?: string[]) => void;
}

const escapeHtml = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Goods line of an invoice: what to find in the parcels on arrival. */
interface ControlArticle {
  key: string;
  supplier: string;
  invoice: string;
  name: string;
  quantity: number;
  /** Typed on arrival (confirmed shipment), null while not checked. */
  received: number | null;
}

const controlArticles = (invoices: DigiInvoice[], received: Map<string, ReceivedArticle>): ControlArticle[] =>
  invoices.flatMap((inv) =>
    inv.lines
      .filter((line) => !line.is_service)
      .map((line) => ({
        key: line.id,
        supplier: inv.supplier_display || '—',
        invoice: inv.ref || inv.odoo_move_name || '—',
        name: line.name,
        quantity: line.quantity,
        received: received.get(articleKey({ invoice_id: inv.id, position: line.position }))?.quantity_received ?? null,
      }))
  );

/** Printable sheet to tick the parcels and articles received in Madagascar; false if the pop-up is blocked. */
function printControlSheet(shipment: Shipment, parcels: Parcel[], articles: ControlArticle[]): boolean {
  const box = '<td class="box"></td>';
  const parcelRows = parcels
    .map(
      (p) =>
        `<tr>${box}<td class="mono">${escapeHtml(p.tracking_number || '— (inconnu)')}</td><td>${escapeHtml(
          p.supplier_name || '—'
        )}</td><td>${escapeHtml(p.invoices.map((i) => i.ref || '—').join(', ') || 'Sans facture')}</td><td></td></tr>`
    )
    .join('');
  const articleRows = articles
    .map(
      (a) =>
        `<tr>${box}<td>${escapeHtml(a.name)}</td><td class="num">${escapeHtml(formatQuantity(a.quantity))}</td><td>${escapeHtml(
          a.supplier
        )}</td><td>${escapeHtml(a.invoice)}</td><td class="num">${a.received === null ? '' : escapeHtml(formatQuantity(a.received))}</td></tr>`
    )
    .join('');
  const subtitle = [
    shipment.order_reference && `Réf. ordre ${shipment.order_reference}`,
    shipment.bl_awb && `LTA/BL ${shipment.bl_awb}`,
    shipment.carrier,
  ]
    .filter(Boolean)
    .join(' · ');
  const name = shipmentLabel(shipment);
  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Contrôle ${escapeHtml(name)}</title>
<style>body{font:11px Arial,sans-serif;margin:16px;color:#111}h1{font-size:16px;margin:0}h2{font-size:13px;margin:18px 0 6px}
p{margin:2px 0;color:#555}table{width:100%;border-collapse:collapse}th,td{border:1px solid #bbb;padding:4px 6px;text-align:left;vertical-align:top}
th{background:#f1f1f1}td.box{width:18px}td.num{text-align:right;white-space:nowrap}.mono{font-family:monospace}</style></head><body>
<h1>Contrôle de réception à Madagascar — ${escapeHtml(name)}</h1><p>${escapeHtml(subtitle)}</p>
<p>${parcels.length} colis · ${articles.length} article(s). Cochez ce qui est reçu, notez les écarts.</p>
<h2>Colis (${parcels.length})</h2><table><tr><th></th><th>N° de suivi</th><th>Fournisseur</th><th>Factures</th><th>Remarque</th></tr>${parcelRows}</table>
<h2>Articles (${articles.length})</h2><table><tr><th></th><th>Article</th><th>Qté</th><th>Fournisseur</th><th>Facture</th><th>Qté reçue</th></tr>${articleRows}</table>
</body></html>`;
  const w = window.open('', '_blank');
  if (!w) return false;
  w.document.write(html);
  w.document.close();
  w.focus();
  w.print();
  return true;
}

const cardClass =
  'rounded-2xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-800/60';

/**
 * Contents of a shipment Orly / Rouen → Mada: its invoices (one sale invoice
 * = Réf FA) and their parcels. On arrival in Madagascar, a parcel received at
 * the hub but missing is flagged "Avis de recherche" (claim).
 */
export const ShipmentContentsPanel: React.FC<Props> = ({
  shipment,
  invoices,
  invoicesError,
  isSupplyChain,
  canEditReceipts,
  shipments,
  onChanged,
}) => {
  const hub = shipment.mode === 'Air' ? 'Orly' : 'Rouen';
  const locked = Boolean(shipment.confirmed_at);
  const canChange = isSupplyChain && !locked;
  const [parcels, setParcels] = useState<Parcel[] | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showControl, setShowControl] = useState(locked);
  /** Received quantities of a confirmed shipment, by invoice + line position. */
  const [received, setReceived] = useState<Map<string, ReceivedArticle>>(new Map());
  const articles = useMemo(() => controlArticles(invoices || [], received), [invoices, received]);
  const allOpen = Boolean(invoices && invoices.length > 0 && invoices.every((i) => open.has(i.id)));
  const receivedList = useMemo(() => Array.from(received.values()) as ReceivedArticle[], [received]);
  const checked = receivedList.filter((a) => a.quantity_received !== null);
  const gaps = checked.filter((a) => receivedGap(a) !== 0).length;

  const loadParcels = useCallback(() => {
    fetchShipmentParcels(shipment.id)
      .then(setParcels)
      .catch((err) => setError(err.message));
  }, [shipment.id]);

  useEffect(loadParcels, [loadParcels, invoices]);

  useEffect(() => {
    if (!locked) {
      setReceived(new Map());
      return;
    }
    setShowControl(true);
    fetchReceivedArticles(shipment.id)
      .then((list) => setReceived(new Map(list.map((a) => [articleKey(a), a]))))
      .catch((err) => setError(err.message));
  }, [shipment.id, locked, invoices]);

  const updateReceived = (a: ReceivedArticle, quantity: number | null) =>
    setReceived((prev) => new Map(prev).set(articleKey(a), { ...a, quantity_received: quantity }));

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const handleRemove = async (inv: DigiInvoice) => {
    if (!window.confirm(`Retirer la facture ${inv.ref || ''} de l'expédition ${shipmentLabel(shipment)} ? Elle redevient à expédier.`)) return;
    setBusy(inv.id);
    setError(null);
    try {
      await removeInvoiceFromShipment(shipment.id, inv.id);
      onChanged();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const handleParcel = async (p: Parcel, status: 'search' | 'received') => {
    const question =
      status === 'search'
        ? `Colis ${p.tracking_number || ''} absent à l'arrivée à Madagascar : ouvrir un avis de recherche ?`
        : `Le colis ${p.tracking_number || ''} a été retrouvé : annuler l'avis de recherche ?`;
    if (!window.confirm(question)) return;
    setBusy(p.id);
    setError(null);
    try {
      await setParcelStatus(p.id, status, p.received_at);
      loadParcels();
      onChanged();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const delivered = shipment.global_status === 'Livrée entrepôt';

  return (
    <div className={cardClass}>
      <div className="mb-4 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
          <ReceiptText className="h-4 w-4 text-slate-400" /> Factures et colis
          {invoices && <span className="text-xs font-semibold text-slate-400">{invoices.length} facture(s)</span>}
        </h3>
        <div className="flex items-center gap-1.5">
          {invoices && invoices.length > 0 && (
            <button
              onClick={() => setOpen(allOpen ? new Set() : new Set(invoices.map((i) => i.id)))}
              className="flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-700"
            >
              {allOpen ? <ChevronsDownUp className="h-3 w-3" /> : <ChevronsUpDown className="h-3 w-3" />}
              {allOpen ? 'Tout replier' : 'Tout déplier'}
            </button>
          )}
          {canChange && (
            <button
              onClick={() => setAdding(true)}
              className="flex items-center gap-1 rounded-lg bg-[#623387] px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-[#522870]"
            >
              <Plus className="h-3 w-3" /> Ajouter des factures
            </button>
          )}
        </div>
      </div>

      {(invoicesError || error) && <p className="mb-2 text-xs text-rose-600">{invoicesError || error}</p>}

      {locked && (
        <p className="mb-3 flex items-center gap-1.5 rounded-xl bg-slate-50 px-3 py-2 text-[11px] text-slate-600 dark:bg-slate-900 dark:text-slate-300">
          <Lock className="h-3.5 w-3.5 shrink-0 text-slate-400" />
          Expédition confirmée : plus d'ajout ni de retrait de factures ou de colis.
          {isSupplyChain && ' Déverrouillez-la (en haut) pour corriger.'}
        </p>
      )}

      {invoices === null ? (
        <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
      ) : invoices.length === 0 ? (
        <p className="text-xs text-slate-400">
          Aucune facture dans cette expédition.{canChange && ' Ajoutez les factures reçues à ' + hub + '.'}
        </p>
      ) : (
        <div className="divide-y divide-slate-100 text-xs dark:divide-slate-700/60">
          {invoices.map((inv) => {
            const isOpen = open.has(inv.id);
            return (
              <div key={inv.id} className="py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <button onClick={() => toggle(inv.id)} className="text-slate-400">
                    {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </button>
                  <span className="font-semibold text-slate-800 dark:text-slate-100">
                    {inv.supplier_display || '—'} · {inv.ref || inv.odoo_move_name || '—'}
                  </span>
                  <span className="text-slate-400">{formatDate(inv.invoice_date)}</span>
                  {!inv.is_digi && <span className="text-[10px] text-slate-500">hors DIGI</span>}
                  {!isInvoiceReceived(inv) && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                      {inv.parcel_received_count}/{inv.parcel_count} colis reçu(s)
                    </span>
                  )}
                  <span className="ml-auto font-semibold text-slate-800 dark:text-slate-100">
                    {formatAmount(inv.amount_total)} {inv.currency === 'USD' ? '$' : '€'}
                  </span>
                  {canChange && (
                    <button
                      onClick={() => handleRemove(inv)}
                      disabled={busy === inv.id}
                      title="Retirer de l'expédition"
                      className="rounded-lg p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50 dark:hover:bg-rose-950/40"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                {isOpen &&
                  (inv.lines.length === 0 ? (
                    <p className="ml-6 mt-1 text-slate-400">
                      {inv.is_digi ? 'Aucune ligne.' : `Facture hors DIGI — acheteur : ${inv.buyer || '—'}`}
                    </p>
                  ) : (
                    <table className="ml-6 mt-1 w-[calc(100%-1.5rem)] text-left">
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                        {inv.lines.map((line) => (
                          <tr key={line.id} className={line.is_service ? 'text-slate-400' : 'text-slate-700 dark:text-slate-200'}>
                            <td className="py-1 pr-2">{line.name}</td>
                            <td className="w-16 py-1 px-2 text-right">{formatQuantity(line.quantity)}</td>
                            <td className="w-24 py-1 pl-2 text-right">{formatAmount(line.price_subtotal)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ))}
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-4 border-t border-slate-100 pt-3 dark:border-slate-700">
        <h4 className="mb-2 flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wider text-slate-500">
          <Package className="h-3.5 w-3.5" /> Colis ({parcels?.length ?? '…'})
        </h4>
        {isSupplyChain && delivered && (
          <p className="mb-2 text-[11px] text-slate-500">
            Arrivée à Madagascar : signalez « Absent à l'arrivée » chaque colis manquant (avis de recherche, réclamation
            {shipment.mode === 'Air' ? ' MIDEX' : ' transitaire'}).
          </p>
        )}
        {parcels === null ? (
          <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
        ) : parcels.length === 0 ? (
          <p className="text-xs text-slate-400">Aucun colis enregistré pour ces factures.</p>
        ) : (
          <table className="w-full text-left text-xs">
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
              {parcels.map((p) => (
                <tr key={p.id}>
                  <td className="py-1.5 pr-2 font-mono font-semibold">{p.tracking_number || '— (inconnu)'}</td>
                  <td className="py-1.5 pr-2">{p.supplier_name || '—'}</td>
                  <td className="py-1.5 pr-2 text-slate-500">{p.invoices.map((i) => i.ref || '—').join(', ')}</td>
                  <td className="py-1.5 pr-2">
                    <span
                      title={parcelStatusHint(p.status, p.destination)}
                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${PARCEL_STATUS_BADGES[p.status]}`}
                    >
                      {parcelStatusLabel(p.status, p.destination)}
                    </span>
                  </td>
                  <td className="py-1.5 text-right">
                    {isSupplyChain && p.status === 'received' && (
                      <button
                        onClick={() => handleParcel(p, 'search')}
                        disabled={busy === p.id}
                        title="Absent à l'arrivée à Madagascar : avis de recherche"
                        className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold text-amber-700 hover:bg-amber-50 disabled:opacity-50 dark:text-amber-300 dark:hover:bg-amber-950/40"
                      >
                        <SearchX className="h-3.5 w-3.5" /> Absent à l'arrivée
                      </button>
                    )}
                    {isSupplyChain && p.status === 'search' && (
                      <button
                        onClick={() => handleParcel(p, 'received')}
                        disabled={busy === p.id}
                        title="Colis retrouvé"
                        className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-50 dark:text-slate-300 dark:hover:bg-slate-700"
                      >
                        <Undo2 className="h-3.5 w-3.5" /> Retrouvé
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Arrival check: every parcel and article of the shipment */}
      <div className="mt-4 border-t border-slate-100 pt-3 dark:border-slate-700">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setShowControl((v) => !v)}
            className="flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wider text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
          >
            {showControl ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            <ClipboardCheck className="h-3.5 w-3.5" /> Contrôle à la réception : {parcels?.length ?? '…'} colis ·{' '}
            {articles.length} article(s)
          </button>
          {locked && articles.length > 0 && (
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                checked.length < articles.length
                  ? 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                  : gaps > 0
                  ? 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
                  : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
              }`}
            >
              {checked.length}/{articles.length} contrôlé(s){gaps > 0 ? ` · ${gaps} écart(s)` : ''}
            </span>
          )}
          <button
            onClick={() => {
              if (!printControlSheet(shipment, parcels || [], articles)) setError('Autorisez les fenêtres pop-up pour imprimer.');
            }}
            disabled={parcels === null || invoices === null}
            className="ml-auto flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-700"
          >
            <Printer className="h-3 w-3" /> Imprimer la liste de contrôle
          </button>
        </div>
        {showControl && !locked && articles.length > 0 && (
          <p className="mt-2 text-[11px] text-slate-500">
            Les quantités reçues se saisissent une fois l'expédition confirmée.
          </p>
        )}
        {showControl &&
          (articles.length === 0 ? (
            <p className="mt-2 text-xs text-slate-400">Aucun article : factures sans lignes (hors DIGI) ou pas encore chargées.</p>
          ) : locked ? (
            <table className="mt-2 w-full text-left text-xs">
              <thead className="text-[10px] uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="py-1 pr-2">Article</th>
                  <th className="px-2 py-1">Fournisseur</th>
                  <th className="px-2 py-1">Facture</th>
                  <th className="w-16 px-2 py-1 text-right">Qté</th>
                  <th className="w-24 px-2 py-1 text-right">Qté reçue</th>
                  <th className="w-14 py-1 pl-2 text-right">Écart</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                {receivedList.map((a) => {
                  const gap = receivedGap(a);
                  return (
                    <tr key={articleKey(a)} className="text-slate-700 dark:text-slate-200">
                      <td className="py-1 pr-2">{a.name}</td>
                      <td className="px-2 py-1">{a.supplier || '—'}</td>
                      <td className="px-2 py-1 text-slate-500">{a.invoice_ref || '—'}</td>
                      <td className="px-2 py-1 text-right font-semibold">{formatQuantity(a.quantity)}</td>
                      <td className="px-2 py-1 text-right">
                        <ReceivedQuantityInput article={a} canEdit={canEditReceipts} onSaved={(q) => updateReceived(a, q)} />
                      </td>
                      <td
                        className={`py-1 pl-2 text-right font-semibold ${
                          gap === null ? 'text-slate-300' : gap === 0 ? 'text-emerald-600' : 'text-rose-600'
                        }`}
                      >
                        {gap === null ? '—' : gap > 0 ? `+${formatQuantity(gap)}` : formatQuantity(gap)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <table className="mt-2 w-full text-left text-xs">
              <thead className="text-[10px] uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="py-1 pr-2">Article</th>
                  <th className="w-16 px-2 py-1 text-right">Qté</th>
                  <th className="px-2 py-1">Fournisseur</th>
                  <th className="py-1 pl-2">Facture</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                {articles.map((a) => (
                  <tr key={a.key} className="text-slate-700 dark:text-slate-200">
                    <td className="py-1 pr-2">{a.name}</td>
                    <td className="px-2 py-1 text-right font-semibold">{formatQuantity(a.quantity)}</td>
                    <td className="px-2 py-1">{a.supplier}</td>
                    <td className="py-1 pl-2 text-slate-500">{a.invoice}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-slate-200 font-bold dark:border-slate-700">
                  <td className="py-1 pr-2">Total</td>
                  <td className="px-2 py-1 text-right">{formatQuantity(articles.reduce((sum, a) => sum + a.quantity, 0))}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          ))}
      </div>

      {adding && (
        <ShipmentInvoicesModal
          mode={shipment.mode}
          shipment={shipment}
          shipments={shipments}
          onClose={() => setAdding(false)}
          onDone={(_id, emptied) => {
            setAdding(false);
            onChanged(emptied);
          }}
        />
      )}
    </div>
  );
};
