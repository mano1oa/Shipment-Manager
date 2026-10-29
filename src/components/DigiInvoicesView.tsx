import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FilePlus2,
  FileSpreadsheet,
  Loader2,
  Pencil,
  ReceiptText,
  RefreshCw,
  Search,
  Trash2,
  Wrench,
  PackageCheck,
  X,
  FileText,
  Package,
  ShieldCheck,
  ShieldX,
  Undo2,
} from 'lucide-react';
import {
  DigiConfig,
  DigiInvoice,
  DigiInvoiceSource,
  ODOO_STATE_LABELS,
  SOURCE_LABELS,
  deleteDigiInvoice,
  fetchDigiConfig,
  fetchDigiInvoices,
  formatAmount,
  formatDate,
  formatDateTime,
  formatQuantity,
  syncDigiOdoo,
  isServicesInvoice,
  isAwaitingValidation,
  isGoodsInvoice,
  isInvoiceReceived,
  setInvoiceTriage,
  setInvoiceValidation,
  fetchTrackingSettings,
} from './digiApi';
import { Shipment } from '../types';
import { DigiInvoiceFormModal } from './DigiInvoiceFormModal';
import { DirectInvoiceFormModal } from './DirectInvoiceFormModal';
import { DigiImportModal } from './DigiImportModal';
import { ParcelFormModal } from './ParcelFormModal';
import { InvoiceParcelsPanel } from './InvoiceParcelsPanel';
import { DEFAULT_DEST_PARTNER_NAME } from '../lib/digiInvoices';
import { VALIDATION_STATUS_LABELS, amountInEur, triageDeadline } from '../lib/parcelTracking';
import type { InvoiceTriage, TrackingSettings } from '../lib/parcelTracking';

interface Props {
  canDelete: boolean;
  /** Supply Chain: validates "hors DIGI" invoices, edits validated ones. */
  isSupplyChain: boolean;
  /** Opens a shipment's detail. */
  onOpenShipment: (shipmentId: string) => void;
  /** Shipments changed: the app reloads its shipment lists. */
  onShipmentsChanged: () => void;
  /** Existing shipments, to attach an invoice to one of them. */
  shipments: Shipment[];
  /** Deletes a shipment left without invoices (SUPPLY_CHAIN only). */
  onDeleteShipment?: (shipmentId: string) => Promise<void> | void;
}

/**
 * to_sort: DIGI invoices not sorted yet · goods: tracked (parcels) ·
 * services: nothing to ship · validation: "hors DIGI" waiting for Supply Chain.
 */
type Section = 'to_sort' | 'goods' | 'services' | 'validation';

const sectionsOf = (inv: DigiInvoice): Section[] => {
  if (isServicesInvoice(inv)) return ['services'];
  const sections: Section[] = [];
  if (isAwaitingValidation(inv)) sections.push('validation');
  if (isGoodsInvoice(inv)) sections.push('goods');
  else if (inv.is_digi) sections.push('to_sort');
  return sections;
};

/** Where a tracked invoice stands on the way to Orly. */
type ParcelFilter = 'all' | 'no_parcel' | 'waiting' | 'received';

const PARCEL_FILTER_LABELS: Record<ParcelFilter, string> = {
  all: 'Tous les colis',
  no_parcel: 'Sans colis',
  waiting: 'Colis pas tous reçus',
  received: 'Reçue à Orly (tous les colis)',
};

const parcelState = (inv: DigiInvoice): Exclude<ParcelFilter, 'all'> =>
  inv.parcel_count === 0 ? 'no_parcel' : isInvoiceReceived(inv) ? 'received' : 'waiting';

const NO_SUPPLIER = '— Sans fournisseur —';
const supplierOf = (inv: DigiInvoice) => inv.supplier_display || NO_SUPPLIER;

const SOURCE_BADGES: Record<DigiInvoiceSource, string> = {
  odoo: 'bg-[#EAD7F9] text-[#623387] dark:bg-purple-950 dark:text-[#B688FF]',
  excel: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  manual: 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
};

const formatInvoiceAmount = (inv: DigiInvoice) =>
  `${formatAmount(inv.amount_total)}${inv.amount_total !== null && inv.currency === 'USD' ? ' $' : ''}`;

export const DigiInvoicesView: React.FC<Props> = ({
  canDelete,
  isSupplyChain,
  onOpenShipment,
  onShipmentsChanged,
  shipments,
  onDeleteShipment,
}) => {
  const [config, setConfig] = useState<DigiConfig | null>(null);
  const [invoices, setInvoices] = useState<DigiInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState<'all' | DigiInvoiceSource>('all');
  const [section, setSection] = useState<Section>('to_sort');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [supplierFilter, setSupplierFilter] = useState('all');
  const [parcelFilter, setParcelFilter] = useState<ParcelFilter>('all');
  const [settings, setSettings] = useState<TrackingSettings | undefined>(undefined);
  const [editingDirect, setEditingDirect] = useState<DigiInvoice | 'new' | null>(null);
  const [parcelFor, setParcelFor] = useState<DigiInvoice[] | null>(null);
  const [groupBySupplier, setGroupBySupplier] = useState(true);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkProgress, setBulkProgress] = useState<string | null>(null);

  const [editing, setEditing] = useState<DigiInvoice | 'new' | null>(null);
  const [showImport, setShowImport] = useState(false);

  const destination = config?.dest_partner_name || DEFAULT_DEST_PARTNER_NAME;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [cfg, list] = await Promise.all([fetchDigiConfig(), fetchDigiInvoices()]);
      setConfig(cfg);
      setInvoices(list);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    // Alert delays: the defaults apply when they cannot be read
    fetchTrackingSettings().then(setSettings).catch(() => {});
  }, [load]);

  /** Reloads the list (parcel counters changed). */
  const reloadInvoices = () => fetchDigiInvoices().then(setInvoices).catch((err) => setError(err.message));

  const handleSync = async () => {
    setSyncing(true);
    setError(null);
    setMessage(null);
    try {
      const r = await syncDigiOdoo();
      const parts = [
        `${r.listed} facture(s) ${destination} dans Odoo`,
        `${r.created} nouvelle(s)`,
        `${r.updated} mise(s) à jour`,
      ];
      if (r.failed > 0) parts.push(`${r.failed} en échec`);
      if (r.missing > 0) parts.push(`${r.missing} absente(s) d'Odoo`);
      if (r.cancelled_removed > 0) parts.push(`${r.cancelled_removed} annulée(s) retirée(s)`);
      setMessage(
        `Synchronisation Odoo : ${parts.join(', ')}.` +
          (r.complete ? '' : ` ${r.remaining} restante(s) : relancez la synchronisation.`)
      );
      setInvoices(await fetchDigiInvoices());
    } catch (err: any) {
      setError(err.message);
    } finally {
      fetchDigiConfig().then(setConfig).catch(() => {});
      setSyncing(false);
    }
  };

  const handleDelete = async (invoice: DigiInvoice) => {
    if (!window.confirm(`Supprimer la facture ${invoice.ref ?? ''} de ${invoice.supplier_name ?? ''} ?`)) return;
    setError(null);
    try {
      await deleteDigiInvoice(invoice.id);
      setInvoices((prev) => prev.filter((i) => i.id !== invoice.id));
      setMessage('Facture supprimée.');
    } catch (err: any) {
      setError(err.message);
    }
  };

  const replaceInvoice = (updated: DigiInvoice) =>
    setInvoices((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));

  const TRIAGE_DONE: Record<InvoiceTriage, string> = {
    goods: 'classée en marchandises (suivi des colis)',
    services: 'classée en services (pas de colis)',
    to_sort: 'remise à trier',
  };

  const handleTriage = async (inv: DigiInvoice, triage: InvoiceTriage) => {
    if (
      triage === 'services' &&
      inv.shipment_id &&
      inv.shipment_exists &&
      !window.confirm(
        `Classer la facture ${inv.ref ?? ''} en services ? Elle sera détachée de l'expédition ${inv.shipment_id}, qui reste à supprimer si elle n'a plus lieu d'être.`
      )
    ) {
      return;
    }
    setBusyId(inv.id);
    setError(null);
    try {
      const { invoice, detached_shipment_id } = await setInvoiceTriage(inv.id, triage);
      replaceInvoice(invoice);
      if (detached_shipment_id) onShipmentsChanged();
      setMessage(`Facture ${inv.ref ?? ''} ${TRIAGE_DONE[triage]}.`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const handleValidate = async (inv: DigiInvoice) => {
    setBusyId(inv.id);
    setError(null);
    try {
      replaceInvoice(await setInvoiceValidation(inv.id, 'validated'));
      setMessage(`Facture ${inv.ref ?? ''} validée : elle pourra entrer dans une expédition.`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const handleReject = async (list: DigiInvoice[]) => {
    const reason = window.prompt(
      `Motif du refus (${list.length} facture(s)) — il sera affiché à l'acheteur :`
    )?.trim();
    if (!reason) return;
    const done = await runBulk('Refus', list, async (inv) => {
      replaceInvoice(await setInvoiceValidation(inv.id, 'rejected', reason));
    });
    if (done > 0) setMessage(`${done} facture(s) refusée(s).`);
  };

  /** A parcel covers invoices of one supplier only. */
  const openParcelForm = (list: DigiInvoice[]) => {
    const names = new Set(list.map(supplierOf));
    if (names.size > 1) {
      setError('Un colis ne peut regrouper que des factures d\'un même fournisseur : sélectionnez un seul fournisseur.');
      return;
    }
    setParcelFor(list);
  };

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const isDeletable = (inv: DigiInvoice) => canDelete && (inv.source !== 'odoo' || inv.odoo_missing);
  /** Sourcing corrects its "hors DIGI" invoices until they are validated. */
  const canEditDirect = (inv: DigiInvoice) => isSupplyChain || inv.validation_status !== 'validated';

  const today = new Date().toISOString().slice(0, 10);
  const isTriageLate = (inv: DigiInvoice) => {
    const deadline = triageDeadline(inv.created_at, settings);
    return deadline !== null && today > deadline;
  };

  const sectionInvoices = useMemo(
    () => invoices.filter((inv) => sectionsOf(inv).includes(section)),
    [invoices, section]
  );
  const sectionCounts = useMemo(() => {
    const counts: Record<Section, number> = { to_sort: 0, goods: 0, services: 0, validation: 0 };
    invoices.forEach((inv) => sectionsOf(inv).forEach((s) => counts[s]++));
    return counts;
  }, [invoices]);

  // "À trier" is hidden when empty: open on the goods instead
  useEffect(() => {
    if (!loading && section === 'to_sort' && sectionCounts.to_sort === 0) setSection('goods');
  }, [loading, section, sectionCounts.to_sort]);

  const suppliers = useMemo(
    () => Array.from(new Set<string>(sectionInvoices.map(supplierOf))).sort((a, b) => a.localeCompare(b, 'fr')),
    [sectionInvoices]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sectionInvoices.filter((inv) => {
      if (sourceFilter !== 'all' && inv.source !== sourceFilter) return false;
      if (supplierFilter !== 'all' && supplierOf(inv) !== supplierFilter) return false;
      if (section === 'goods' && parcelFilter !== 'all' && parcelState(inv) !== parcelFilter) return false;
      if (!q) return true;
      return [
        inv.supplier_name,
        inv.supplier_display,
        inv.ref,
        inv.amazon_order_ref,
        inv.sale_move_ref,
        inv.odoo_move_name,
        inv.buyer,
        ...inv.lines.map((l) => l.name),
      ].some((v) => v && v.toLowerCase().includes(q));
    });
  }, [sectionInvoices, search, sourceFilter, supplierFilter, parcelFilter, section]);

  const groups = useMemo(() => {
    const bySupplier = new Map<string, DigiInvoice[]>();
    for (const inv of filtered) {
      const key = supplierOf(inv);
      bySupplier.set(key, [...(bySupplier.get(key) || []), inv]);
    }
    return Array.from(bySupplier.entries()).sort(([a], [b]) => a.localeCompare(b, 'fr'));
  }, [filtered]);

  // A supplier picked in one tab may not exist in the other
  useEffect(() => {
    if (supplierFilter !== 'all' && !suppliers.includes(supplierFilter)) setSupplierFilter('all');
  }, [suppliers, supplierFilter]);

  // ---- Multiple selection (only the invoices currently shown count) ----
  useEffect(() => setSelected(new Set()), [section]);

  const selectedInvoices = useMemo(() => filtered.filter((i) => selected.has(i.id)), [filtered, selected]);
  // In EUR: USD amounts converted with the rate of the settings (left out without rate)
  const eurTotal = (list: DigiInvoice[]) =>
    list.reduce((sum, i) => sum + (amountInEur(i.amount_total, i.currency, settings?.usd_eur_rate ?? null) ?? 0), 0);
  const selectedTotal = eurTotal(selectedInvoices);

  const setSelection = (ids: string[], on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => (on ? next.add(id) : next.delete(id)));
      return next;
    });

  const selectionState = (list: DigiInvoice[]): boolean | 'mixed' => {
    const n = list.filter((i) => selected.has(i.id)).length;
    return n === 0 ? false : n === list.length ? true : 'mixed';
  };

  const toGoods = selectedInvoices.filter((i) => i.is_digi && i.triage !== 'goods' && !isServicesInvoice(i));
  const toServices = selectedInvoices.filter((i) => i.is_digi && i.triage !== 'services');
  // Fee-only invoices stay in services: only the ones sorted by hand go back
  const backToSort = selectedInvoices.filter((i) => i.is_digi && i.triage !== 'to_sort' && (i.triage !== 'services' || i.has_items));
  const forParcel = selectedInvoices.filter((i) => isGoodsInvoice(i));
  const toValidate = selectedInvoices.filter((i) => i.validation_status === 'pending');
  const toReject = selectedInvoices.filter((i) => !i.is_digi && i.validation_status === 'pending');
  const toDelete = selectedInvoices.filter(isDeletable);

  /** Runs one request per invoice, in sequence, and reports what failed. */
  const runBulk = async (
    label: string,
    list: DigiInvoice[],
    action: (inv: DigiInvoice) => Promise<void>
  ): Promise<number> => {
    setError(null);
    setMessage(null);
    const failures: string[] = [];
    let done = 0;
    for (let index = 0; index < list.length; index++) {
      const inv = list[index];
      setBulkProgress(`${label} : ${index + 1} / ${list.length}…`);
      try {
        await action(inv);
        done++;
        setSelection([inv.id], false);
      } catch (err: any) {
        failures.push(`${inv.ref || inv.odoo_move_name || inv.id} (${err.message})`);
      }
    }
    setBulkProgress(null);
    if (failures.length > 0) {
      setError(`${failures.length} facture(s) non traitée(s) : ${failures.join(' ; ')}`);
    }
    return done;
  };

  const handleBulkTriage = async (triage: InvoiceTriage) => {
    const list = triage === 'goods' ? toGoods : triage === 'services' ? toServices : backToSort;
    const withShipment = list.filter((i) => i.shipment_id && i.shipment_exists);
    const question =
      triage === 'services'
        ? `Classer ${list.length} facture(s) en services (pas de colis) ?` +
          (withShipment.length > 0
            ? ` ${withShipment.length} seront détachées de leur expédition, qui reste à supprimer si elle n'a plus lieu d'être.`
            : '')
        : triage === 'goods'
        ? `Classer ${list.length} facture(s) en marchandises ? Leurs colis seront suivis jusqu'à Orly (alertes de perte).`
        : `Remettre ${list.length} facture(s) à trier ?`;
    if (!window.confirm(question)) return;
    let detached = false;
    const done = await runBulk('Tri', list, async (inv) => {
      const r = await setInvoiceTriage(inv.id, triage);
      replaceInvoice(r.invoice);
      if (r.detached_shipment_id) detached = true;
    });
    if (detached) onShipmentsChanged();
    if (done > 0) setMessage(`${done} facture(s) traitée(s) : ${TRIAGE_DONE[triage]}.`);
  };

  const handleBulkValidate = async () => {
    if (!window.confirm(`Valider ${toValidate.length} facture(s) hors DIGI ?`)) return;
    const done = await runBulk('Validation', toValidate, async (inv) => {
      replaceInvoice(await setInvoiceValidation(inv.id, 'validated'));
    });
    if (done > 0) setMessage(`${done} facture(s) validée(s).`);
  };

  const handleBulkDelete = async () => {
    if (!window.confirm(`Supprimer définitivement ${toDelete.length} facture(s) ?`)) return;
    const done = await runBulk('Suppression', toDelete, async (inv) => {
      await deleteDigiInvoice(inv.id);
      setInvoices((prev) => prev.filter((i) => i.id !== inv.id));
    });
    if (done > 0) setMessage(`${done} facture(s) supprimée(s).`);
  };

  const lastSync = config?.last_sync ?? null;

  /** Orly → Mada shipment of the invoice, if any. */
  const renderShipmentCell = (inv: DigiInvoice) => {
    if (inv.shipment_id && inv.shipment_exists) {
      return (
        <button
          onClick={() => onOpenShipment(inv.shipment_id!)}
          className="text-left font-mono font-semibold text-[#623387] hover:underline dark:text-[#B688FF]"
          title={inv.shipment_global_status || undefined}
        >
          {inv.shipment_id}
          <span className="ml-1 font-sans text-[10px] font-normal text-slate-400">{inv.shipment_global_status}</span>
        </button>
      );
    }
    return <span className="text-slate-400">—</span>;
  };

  /** Parcels received at Orly / expected, for a tracked invoice. */
  const renderParcelsCell = (inv: DigiInvoice) => {
    if (isServicesInvoice(inv)) return <span className="text-slate-400">Service</span>;
    if (!isGoodsInvoice(inv)) return <span className="text-slate-400">—</span>;
    if (inv.parcel_count === 0) {
      return (
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800 dark:bg-amber-950 dark:text-amber-300">
          Sans colis
        </span>
      );
    }
    const received = isInvoiceReceived(inv);
    return (
      <span
        className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
          received
            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
            : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
        }`}
      >
        {received ? 'Reçue à Orly' : `${inv.parcel_received_count} / ${inv.parcel_count} reçu(s)`}
      </span>
    );
  };

  const button =
    'flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-bold shadow-sm transition disabled:opacity-50';
  const bulkButton =
    'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-bold shadow-sm transition disabled:cursor-not-allowed disabled:opacity-40';
  const selectClass =
    'rounded-xl border border-slate-200 bg-slate-50 py-2 px-3 text-xs text-slate-800 focus:border-[#623387] focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100';

  const renderInvoice = (inv: DigiInvoice) => {
    const isOpen = expanded.has(inv.id);
    const editable = inv.source !== 'odoo';
    const deletable = isDeletable(inv);
    const isSelected = selected.has(inv.id);
    return (
      <React.Fragment key={inv.id}>
        <tr
          onClick={() => toggle(inv.id)}
          className={`cursor-pointer transition ${
            isSelected
              ? 'bg-[#F8EEFF]/70 hover:bg-[#F8EEFF] dark:bg-purple-950/30 dark:hover:bg-purple-950/40'
              : 'hover:bg-slate-50/90 dark:hover:bg-slate-700/40'
          }`}
        >
          <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
            <SelectBox
              state={isSelected}
              label={`Sélectionner la facture ${inv.ref || inv.odoo_move_name || ''}`}
              onChange={(on) => setSelection([inv.id], on)}
            />
          </td>
          <td className="px-3 py-3 text-slate-400">
            {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </td>
          <td className="px-3 py-3 font-bold text-slate-800 dark:text-slate-100">
            {inv.supplier_display || '—'}
            {inv.supplier_name && inv.supplier_display !== inv.supplier_name && (
              <div className="text-[10px] font-normal text-slate-400" title="Vendeur indiqué sur la facture">
                Vendeur : {inv.supplier_name}
              </div>
            )}
          </td>
          <td className="px-3 py-3">
            <div className="font-semibold">{inv.ref || '—'}</div>
            {inv.odoo_move_name && (
              <div className="text-[10px] text-slate-400">Odoo : {inv.odoo_move_name}</div>
            )}
            {inv.buyer && <div className="text-[10px] text-slate-400">Acheteur : {inv.buyer}</div>}
          </td>
          <td className="px-3 py-3">
            {formatDate(inv.invoice_date)}
            {section === 'to_sort' && isTriageLate(inv) && (
              <span
                title={`Arrivée le ${formatDate(inv.created_at)} : à trier sous ${settings?.triage_alert_days ?? 3} jours`}
                className="mt-0.5 block w-fit rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold text-rose-700 dark:bg-rose-950 dark:text-rose-300"
              >
                Tri en retard
              </span>
            )}
          </td>
          <td className="px-3 py-3 font-mono">{inv.amazon_order_ref || '—'}</td>
          <td className="px-3 py-3">{inv.sale_move_ref || '—'}</td>
          <td className="px-3 py-3">{renderParcelsCell(inv)}</td>
          <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
            {renderShipmentCell(inv)}
          </td>
          <td className="px-3 py-3 text-right">{inv.is_digi ? inv.lines.length : '—'}</td>
          <td className="px-3 py-3 text-right font-semibold">{formatInvoiceAmount(inv)}</td>
          <td className="px-3 py-3">
            <div className="flex flex-wrap gap-1">
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${SOURCE_BADGES[inv.source]}`}>
                {inv.is_digi ? SOURCE_LABELS[inv.source] : 'Hors DIGI'}
              </span>
              {!inv.is_digi && inv.validation_status !== 'validated' && (
                <span
                  title={inv.rejection_reason || undefined}
                  className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                    inv.validation_status === 'rejected'
                      ? 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300'
                      : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                  }`}
                >
                  {VALIDATION_STATUS_LABELS[inv.validation_status]}
                </span>
              )}
              {inv.odoo_state && inv.odoo_state !== 'posted' && (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                  {ODOO_STATE_LABELS[inv.odoo_state] || inv.odoo_state}
                </span>
              )}
              {inv.odoo_missing && (
                <span
                  title="Cette facture n'est plus renvoyée par Odoo pour cette destination"
                  className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-700 dark:bg-rose-950 dark:text-rose-300"
                >
                  Absente d'Odoo
                </span>
              )}
            </div>
          </td>
          <td className="px-3 py-3 text-right" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-end gap-1">
              {isSupplyChain && inv.validation_status === 'pending' && (
                <>
                  <button
                    onClick={() => handleValidate(inv)}
                    disabled={busyId === inv.id}
                    title="Valider la facture hors DIGI"
                    className="rounded-lg p-1.5 text-emerald-600 hover:bg-emerald-50 disabled:opacity-50 dark:hover:bg-emerald-950/40"
                  >
                    <ShieldCheck className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => handleReject([inv])}
                    title="Refuser (avec motif)"
                    className="rounded-lg p-1.5 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                  >
                    <ShieldX className="h-4 w-4" />
                  </button>
                </>
              )}
              {isGoodsInvoice(inv) && (
                <button
                  onClick={() => openParcelForm([inv])}
                  title="Ajouter un colis (n° de suivi)"
                  className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-[#623387] dark:hover:bg-slate-700"
                >
                  <Package className="h-4 w-4" />
                </button>
              )}
              {inv.is_digi && inv.triage !== 'goods' && !isServicesInvoice(inv) && (
                <button
                  onClick={() => handleTriage(inv, 'goods')}
                  disabled={busyId === inv.id}
                  title="Marchandises : suivre ses colis jusqu'à Orly"
                  className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-[#623387] disabled:opacity-50 dark:hover:bg-slate-700"
                >
                  <PackageCheck className="h-4 w-4" />
                </button>
              )}
              {inv.is_digi && inv.triage !== 'services' && (
                <button
                  onClick={() => handleTriage(inv, 'services')}
                  disabled={busyId === inv.id}
                  title="Services : pas de colis"
                  className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-[#623387] disabled:opacity-50 dark:hover:bg-slate-700"
                >
                  <Wrench className="h-4 w-4" />
                </button>
              )}
              {inv.is_digi && inv.triage !== 'to_sort' && (inv.triage !== 'services' || inv.has_items) && (
                <button
                  onClick={() => handleTriage(inv, 'to_sort')}
                  disabled={busyId === inv.id}
                  title="Remettre à trier"
                  className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-[#623387] disabled:opacity-50 dark:hover:bg-slate-700"
                >
                  <Undo2 className="h-4 w-4" />
                </button>
              )}
              {editable && (inv.is_digi || canEditDirect(inv)) && (
                <button
                  onClick={() => (inv.is_digi ? setEditing(inv) : setEditingDirect(inv))}
                  title="Modifier"
                  className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-[#623387] dark:hover:bg-slate-700"
                >
                  <Pencil className="h-4 w-4" />
                </button>
              )}
              {deletable && (
                <button
                  onClick={() => handleDelete(inv)}
                  title="Supprimer"
                  className="rounded-lg p-1.5 text-slate-500 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          </td>
        </tr>
        {isOpen && (
          <tr className="bg-slate-50/60 dark:bg-slate-900/40">
            <td colSpan={2} />
            <td colSpan={11} className="px-3 py-3">
              {isGoodsInvoice(inv) && (
                <InvoiceParcelsPanel
                  invoice={inv}
                  canEdit
                  isSupplyChain={isSupplyChain}
                  settings={settings}
                  onChanged={reloadInvoices}
                />
              )}
              {!inv.is_digi ? (
                <div className="grid grid-cols-2 gap-2 rounded-xl border border-slate-200 bg-white p-3 sm:grid-cols-4 dark:border-slate-700 dark:bg-slate-800">
                  <div>
                    <div className="text-[10px] uppercase text-slate-500">Montant</div>
                    <div className="font-semibold">{formatAmount(inv.amount_total)} {inv.currency}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase text-slate-500">Acheteur / demandeur</div>
                    <div className="font-semibold">{inv.buyer || '—'}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase text-slate-500">Validation Supply Chain</div>
                    <div className="font-semibold">{VALIDATION_STATUS_LABELS[inv.validation_status]}</div>
                    {inv.validated_by_email && (
                      <div className="text-[10px] text-slate-400">
                        {inv.validated_by_email} le {formatDate(inv.validated_at)}
                      </div>
                    )}
                  </div>
                  {inv.rejection_reason && (
                    <div>
                      <div className="text-[10px] uppercase text-slate-500">Motif du refus</div>
                      <div className="font-semibold text-rose-600">{inv.rejection_reason}</div>
                    </div>
                  )}
                </div>
              ) : inv.lines.length === 0 ? (
                <p className="text-slate-500">Aucune ligne de facture.</p>
              ) : (
                <table className="w-full rounded-xl border border-slate-200 bg-white text-left dark:border-slate-700 dark:bg-slate-800">
                  <thead className="text-[10px] uppercase tracking-wider text-slate-500">
                    <tr>
                      <th className="px-3 py-2">Libellé</th>
                      <th className="px-3 py-2 text-right">Quantité</th>
                      <th className="px-3 py-2 text-right">Prix</th>
                      <th className="px-3 py-2 text-right">Sous-total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                    {inv.lines.map((line) => (
                      <tr key={line.id} className={line.is_service ? 'text-slate-400' : ''}>
                        <td className="px-3 py-2 whitespace-pre-line">
                          {line.is_service && (
                            <span className="mr-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-500 dark:bg-slate-700 dark:text-slate-300">
                              Service
                            </span>
                          )}
                          {line.name}
                        </td>
                        <td className="px-3 py-2 text-right">{formatQuantity(line.quantity)}</td>
                        <td className="px-3 py-2 text-right">{formatAmount(line.price_unit)}</td>
                        <td className="px-3 py-2 text-right font-semibold">
                          {formatAmount(line.price_subtotal)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <p className="mt-2 text-[10px] text-slate-400">
                {inv.source === 'odoo'
                  ? 'Facture Odoo : modifiable uniquement dans Odoo, puis resynchronisée.'
                  : `Ajoutée par ${inv.created_by_email || '—'} le ${formatDate(inv.created_at)}` +
                    (inv.updated_by_email && inv.updated_at !== inv.created_at
                      ? ` · modifiée par ${inv.updated_by_email} le ${formatDate(inv.updated_at)}`
                      : '')}
              </p>
            </td>
          </tr>
        )}
      </React.Fragment>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-extrabold text-slate-900 dark:text-white">
            <ReceiptText className="h-6 w-6 text-[#623387]" /> Factures fournisseurs
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Factures DIGI LOGISTIC à destination de <strong>{destination}</strong> (Odoo, import Excel, saisie) et
            factures hors DIGI. Triez chaque facture DIGI : <strong>marchandises</strong> (ses colis sont suivis jusqu'à
            Orly) ou <strong>services</strong> (pas de colis). Ajoutez ensuite les colis (n° de suivi) : une facture est
            reçue à Orly quand tous ses colis sont confirmés par Antoine. Les factures hors DIGI saisies par le Sourcing
            sont validées par la Supply Chain.
          </p>
          {config?.odoo_configured && (
            <p className="mt-0.5 text-[11px] text-slate-400">
              Synchronisation automatique chaque jour vers 8 h (heure de Madagascar), et à la demande avec le bouton.
              {lastSync && (
                <>
                  {' '}Dernière : {formatDateTime(lastSync.finished_at)} (
                  {lastSync.trigger === 'cron' ? 'automatique' : lastSync.actor_email || 'manuelle'})
                  {lastSync.success ? (
                    lastSync.result?.complete === false ? ' — incomplète, à relancer.' : ' — réussie.'
                  ) : (
                    <span className="font-semibold text-rose-500"> — en échec : {lastSync.error}</span>
                  )}
                </>
              )}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={handleSync}
            disabled={syncing || !config?.odoo_configured}
            title={
              config?.odoo_configured
                ? 'Récupérer les factures depuis Odoo DIGI LOGISTIC'
                : 'Connexion Odoo non configurée (variables ODOO_* côté serveur)'
            }
            className={`${button} bg-[#623387] text-white hover:bg-[#522870]`}
          >
            {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Synchroniser Odoo
          </button>
          <button
            onClick={() => setShowImport(true)}
            className={`${button} border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300`}
          >
            <FileSpreadsheet className="h-4 w-4" /> Importer Excel
          </button>
          <button
            onClick={() => setEditing('new')}
            className={`${button} border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200`}
          >
            <FilePlus2 className="h-4 w-4" /> Saisie DIGI
          </button>
          <button
            onClick={() => setEditingDirect('new')}
            className={`${button} border border-[#623387] bg-white text-[#623387] hover:bg-[#F8EEFF] dark:bg-slate-800 dark:text-[#B688FF]`}
          >
            <FileText className="h-4 w-4" /> Facture hors DIGI
          </button>
        </div>
      </div>

      {config && !config.odoo_configured && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            La connexion à Odoo DIGI LOGISTIC n'est pas encore configurée : l'import Excel et la saisie manuelle restent
            disponibles.
          </span>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {message && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-semibold text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{message}</span>
        </div>
      )}

      {/* Sections: "À trier" only when it holds invoices */}
      <div className="flex max-w-full gap-1 overflow-x-auto rounded-xl bg-slate-200/60 p-1 text-xs font-semibold w-fit dark:bg-slate-800">
        {(
          [
            ['to_sort', 'À trier'],
            ['goods', 'Marchandises (suivi colis)'],
            ['services', 'Services'],
            ['validation', 'Hors DIGI à valider'],
          ] as [Section, string][]
        )
          .filter(([key]) => key !== 'to_sort' || sectionCounts.to_sort > 0)
          .map(([key, label]) => (
            <button
              key={key}
              onClick={() => setSection(key)}
              className={`shrink-0 rounded-lg px-3 py-1.5 transition ${
                section === key
                  ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white'
                  : 'text-slate-500 hover:text-slate-800 dark:text-slate-400'
              }`}
            >
              {label} <span className="ml-1 text-slate-400">{sectionCounts[key]}</span>
            </button>
          ))}
      </div>

      <p className="-mt-3 text-xs text-slate-500 dark:text-slate-400">
        {section === 'to_sort' &&
          `Factures DIGI pas encore triées : aucune alerte de perte tant qu'elles ne sont pas classées en marchandises. Signalées « Tri en retard » après ${settings?.triage_alert_days ?? 3} jours.`}
        {section === 'goods' &&
          'Factures dont les colis sont suivis jusqu\'à Orly (alerte de perte si un colis n\'est pas confirmé à temps). Les factures hors DIGI à valider y figurent aussi : leurs colis peuvent déjà être suivis.'}
        {section === 'services' &&
          'Factures sans article à expédier (frais DEEE, RCP, port… ou classées à la main) : pas de colis, traitement manuel.'}
        {section === 'validation' &&
          (isSupplyChain
            ? 'Factures hors DIGI saisies par le Sourcing : validez-les pour qu\'elles puissent entrer dans une expédition, ou refusez-les avec un motif.'
            : 'Vos factures hors DIGI en attente de la Supply Chain, ou refusées (motif affiché) : corrigez-les pour les renvoyer en validation.')}
      </p>

      {/* Filters */}
      <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-xs lg:flex-row lg:flex-wrap lg:items-center dark:border-slate-800 dark:bg-slate-800">
        <div className="relative min-w-0 flex-1 sm:min-w-[16rem]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Fournisseur, référence, commande Amazon, facture vente, produit…"
            className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-xs text-slate-800 focus:border-[#623387] focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          />
        </div>
        <select
          value={supplierFilter}
          onChange={(e) => setSupplierFilter(e.target.value)}
          className={`max-w-[16rem] ${selectClass}`}
          title="Filtrer par fournisseur"
        >
          <option value="all">Tous les fournisseurs ({suppliers.length})</option>
          {suppliers.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        {section === 'goods' && (
          <select
            value={parcelFilter}
            onChange={(e) => setParcelFilter(e.target.value as ParcelFilter)}
            className={selectClass}
            title="Où en sont les colis de la facture"
          >
            {(Object.keys(PARCEL_FILTER_LABELS) as ParcelFilter[]).map((k) => (
              <option key={k} value={k}>
                {PARCEL_FILTER_LABELS[k]}
              </option>
            ))}
          </select>
        )}
        <select
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value as typeof sourceFilter)}
          className={selectClass}
        >
          <option value="all">Toutes les sources</option>
          {(Object.keys(SOURCE_LABELS) as DigiInvoiceSource[]).map((s) => (
            <option key={s} value={s}>
              {SOURCE_LABELS[s]}
            </option>
          ))}
        </select>
        <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300">
          <input
            type="checkbox"
            checked={groupBySupplier}
            onChange={(e) => setGroupBySupplier(e.target.checked)}
            className="h-4 w-4 accent-[#623387]"
          />
          Grouper par fournisseur
        </label>
        <span className="text-xs font-semibold text-slate-500">
          {filtered.length} facture(s) · {filtered.reduce((n, i) => n + i.lines.length, 0)} ligne(s)
        </span>
      </div>

      {/* Actions on the selected invoices */}
      {(selectedInvoices.length > 0 || bulkProgress) && (
        <div className="sticky top-20 z-10 flex flex-col gap-3 rounded-2xl border border-[#623387]/40 bg-[#F8EEFF] p-3 shadow-md lg:flex-row lg:items-center dark:border-purple-800 dark:bg-slate-900">
          <div className="flex flex-1 items-center gap-2 text-xs font-bold text-slate-800 dark:text-slate-100">
            {bulkProgress ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin text-[#623387]" /> {bulkProgress}
              </>
            ) : (
              <>
                {selectedInvoices.length} facture(s) sélectionnée(s) · {formatAmount(selectedTotal)} €
                <button
                  onClick={() => setSelected(new Set())}
                  title="Tout désélectionner"
                  className="rounded-lg p-1 text-slate-400 hover:bg-white hover:text-slate-700 dark:hover:bg-slate-800"
                >
                  <X className="h-4 w-4" />
                </button>
              </>
            )}
          </div>
          {!bulkProgress && (
            <div className="flex flex-wrap gap-2">
              {section === 'to_sort' && (
                <button
                  onClick={() => handleBulkTriage('goods')}
                  disabled={toGoods.length === 0}
                  title="Marchandises : leurs colis sont suivis jusqu'à Orly"
                  className={`${bulkButton} bg-[#623387] text-white hover:bg-[#522870]`}
                >
                  <PackageCheck className="h-3.5 w-3.5" /> Marchandises ({toGoods.length})
                </button>
              )}
              {section === 'goods' && (
                <button
                  onClick={() => openParcelForm(forParcel)}
                  disabled={forParcel.length === 0}
                  title="Un colis (n° de suivi) pour les factures sélectionnées d'un même fournisseur"
                  className={`${bulkButton} bg-[#623387] text-white hover:bg-[#522870]`}
                >
                  <Package className="h-3.5 w-3.5" /> Ajouter un colis ({forParcel.length})
                </button>
              )}
              {(section === 'to_sort' || section === 'goods') && (
                <button
                  onClick={() => handleBulkTriage('services')}
                  disabled={toServices.length === 0}
                  title="Services : pas de colis"
                  className={`${bulkButton} border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200`}
                >
                  <Wrench className="h-3.5 w-3.5" /> Services ({toServices.length})
                </button>
              )}
              {(section === 'goods' || section === 'services') && (
                <button
                  onClick={() => handleBulkTriage('to_sort')}
                  disabled={backToSort.length === 0}
                  title="Seules les factures DIGI triées à la main reviennent ; celles qui ne contiennent que des frais restent en services."
                  className={`${bulkButton} border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200`}
                >
                  <Undo2 className="h-3.5 w-3.5" /> Remettre à trier ({backToSort.length})
                </button>
              )}
              {section === 'validation' && isSupplyChain && (
                <>
                  <button
                    onClick={handleBulkValidate}
                    disabled={toValidate.length === 0}
                    className={`${bulkButton} bg-emerald-600 text-white hover:bg-emerald-700`}
                  >
                    <ShieldCheck className="h-3.5 w-3.5" /> Valider ({toValidate.length})
                  </button>
                  <button
                    onClick={() => handleReject(toReject)}
                    disabled={toReject.length === 0}
                    className={`${bulkButton} border border-rose-200 bg-white text-rose-600 hover:bg-rose-50 dark:border-rose-900 dark:bg-slate-800 dark:text-rose-300`}
                  >
                    <ShieldX className="h-3.5 w-3.5" /> Refuser ({toReject.length})
                  </button>
                </>
              )}
              {canDelete && (
                <button
                  onClick={handleBulkDelete}
                  disabled={toDelete.length === 0}
                  title="Les factures Odoo encore présentes dans Odoo ne se suppriment pas ici"
                  className={`${bulkButton} border border-rose-200 bg-white text-rose-600 hover:bg-rose-50 dark:border-rose-900 dark:bg-slate-800 dark:text-rose-300`}
                >
                  <Trash2 className="h-3.5 w-3.5" /> Supprimer ({toDelete.length})
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Table */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-800">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500 dark:bg-slate-900/60 dark:text-slate-400">
              <tr>
                <th className="w-8 px-3 py-3">
                  <SelectBox
                    state={filtered.length > 0 && selectionState(filtered)}
                    label="Sélectionner toutes les factures affichées"
                    onChange={(on) => setSelection(filtered.map((i) => i.id), on)}
                  />
                </th>
                <th className="w-8 px-3 py-3" />
                <th className="px-3 py-3 font-semibold">Fournisseur</th>
                <th className="px-3 py-3 font-semibold">Réf. facture</th>
                <th className="px-3 py-3 font-semibold">Date de facturation</th>
                <th className="px-3 py-3 font-semibold">Commande Amazon</th>
                <th className="px-3 py-3 font-semibold">Facture vente</th>
                <th className="px-3 py-3 font-semibold">Colis</th>
                <th className="px-3 py-3 font-semibold">Expédition</th>
                <th className="px-3 py-3 text-right font-semibold">Lignes</th>
                <th className="px-3 py-3 text-right font-semibold">Total</th>
                <th className="px-3 py-3 font-semibold">Source</th>
                <th className="px-3 py-3 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
              {loading ? (
                <tr>
                  <td colSpan={13} className="px-4 py-12 text-center text-slate-500">
                    <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={13} className="px-4 py-12 text-center text-slate-500">
                    {invoices.length === 0
                      ? 'Aucune facture DIGI enregistrée : synchronisez Odoo, importez un fichier Excel ou saisissez une facture.'
                      : 'Aucune facture ne correspond à vos filtres.'}
                  </td>
                </tr>
              ) : groupBySupplier ? (
                groups.map(([supplier, list]) => {
                  const collapsed = collapsedGroups.has(supplier);
                  const state = selectionState(list);
                  const withoutParcel = list.filter((i) => isGoodsInvoice(i) && i.parcel_count === 0).length;
                  return (
                    <React.Fragment key={`group-${supplier}`}>
                      <tr
                        onClick={() =>
                          setCollapsedGroups((prev) => {
                            const next = new Set(prev);
                            if (next.has(supplier)) next.delete(supplier);
                            else next.add(supplier);
                            return next;
                          })
                        }
                        className="cursor-pointer bg-slate-100/80 hover:bg-slate-100 dark:bg-slate-900/70 dark:hover:bg-slate-900"
                      >
                        <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                          <SelectBox
                            state={state}
                            label={`Sélectionner les factures de ${supplier}`}
                            onChange={(on) => setSelection(list.map((i) => i.id), on)}
                          />
                        </td>
                        <td className="px-3 py-2 text-slate-400">
                          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        </td>
                        <td colSpan={8} className="px-3 py-2 font-extrabold text-slate-900 dark:text-white">
                          {supplier}
                          <span className="ml-2 text-[11px] font-semibold text-slate-500">
                            {list.length} facture(s)
                            {section === 'goods' && withoutParcel > 0 && (
                              <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                                {withoutParcel} sans colis
                              </span>
                            )}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right font-bold text-slate-900 dark:text-white">
                          {formatAmount(eurTotal(list))}
                        </td>
                        <td colSpan={2} />
                      </tr>
                      {!collapsed && list.map(renderInvoice)}
                    </React.Fragment>
                  );
                })
              ) : (
                filtered.map(renderInvoice)
              )}
            </tbody>
          </table>
        </div>
      </div>

      {editing && (
        <DigiInvoiceFormModal
          invoice={editing === 'new' ? null : editing}
          defaultDestination={destination}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            setInvoices((prev) =>
              prev.some((i) => i.id === saved.id) ? prev.map((i) => (i.id === saved.id ? saved : i)) : [saved, ...prev]
            );
            setMessage(editing === 'new' ? 'Facture enregistrée.' : 'Facture modifiée.');
            setEditing(null);
          }}
        />
      )}

      {editingDirect && (
        <DirectInvoiceFormModal
          invoice={editingDirect === 'new' ? null : editingDirect}
          isSupplyChain={isSupplyChain}
          onClose={() => setEditingDirect(null)}
          onSaved={(saved) => {
            setInvoices((prev) =>
              prev.some((i) => i.id === saved.id) ? prev.map((i) => (i.id === saved.id ? saved : i)) : [saved, ...prev]
            );
            setMessage(
              saved.validation_status === 'pending'
                ? `Facture ${saved.ref ?? ''} enregistrée : en attente de validation par la Supply Chain.`
                : `Facture ${saved.ref ?? ''} enregistrée.`
            );
            setEditingDirect(null);
          }}
        />
      )}

      {parcelFor && (
        <ParcelFormModal
          invoices={parcelFor}
          canCreateCarrier={isSupplyChain}
          onClose={() => setParcelFor(null)}
          onSaved={(parcel, existed) => {
            setParcelFor(null);
            setSelection(
              parcelFor.map((i) => i.id),
              false
            );
            setMessage(
              existed
                ? `Le colis ${parcel.tracking_number} existait déjà : les factures y sont rattachées.`
                : `Colis ${parcel.tracking_number || 'sans n° de suivi'} ajouté à ${parcelFor.length} facture(s).`
            );
            reloadInvoices();
          }}
        />
      )}

      {showImport && (
        <DigiImportModal
          destination={destination}
          maxInvoices={config?.import_max_invoices ?? 2000}
          onClose={() => setShowImport(false)}
          onImported={() => {
            fetchDigiInvoices().then(setInvoices).catch((err) => setError(err.message));
          }}
        />
      )}
    </div>
  );
};

/** Checkbox that can show a partial selection (some invoices of a group). */
const SelectBox: React.FC<{ state: boolean | 'mixed'; label: string; onChange: (on: boolean) => void }> = ({
  state,
  label,
  onChange,
}) => (
  <input
    type="checkbox"
    aria-label={label}
    title={label}
    checked={state === true}
    ref={(el) => {
      if (el) el.indeterminate = state === 'mixed';
    }}
    onChange={() => onChange(state !== true)}
    className="h-4 w-4 cursor-pointer accent-[#623387]"
  />
);
