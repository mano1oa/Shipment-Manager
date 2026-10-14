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
  Link2,
  PlusCircle,
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
  formatQuantity,
  syncDigiOdoo,
  createShipmentFromInvoice,
  setInvoiceServices,
  isServicesInvoice,
  assignInvoiceShipment,
} from './digiApi';
import { AttachShipmentModal } from './AttachShipmentModal';
import { Shipment } from '../types';
import { DigiInvoiceFormModal } from './DigiInvoiceFormModal';
import { DigiImportModal } from './DigiImportModal';
import { DEFAULT_DEST_PARTNER_NAME } from '../lib/digiInvoices';

interface Props {
  canDelete: boolean;
  /** Opens a shipment's detail (shipment created from an invoice). */
  onOpenShipment: (shipmentId: string) => void;
  /** Shipments were created: the app reloads its shipment lists. */
  onShipmentsChanged: () => void;
  /** Existing shipments, to attach an invoice to one of them. */
  shipments: Shipment[];
  /** Deletes a shipment left without invoices (SUPPLY_CHAIN only). */
  onDeleteShipment?: (shipmentId: string) => Promise<void> | void;
}

type Section = 'to_ship' | 'services';

const SOURCE_BADGES: Record<DigiInvoiceSource, string> = {
  odoo: 'bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300',
  excel: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  manual: 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
};

export const DigiInvoicesView: React.FC<Props> = ({
  canDelete,
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
  const [section, setSection] = useState<Section>('to_ship');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [attaching, setAttaching] = useState<DigiInvoice | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

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
  }, [load]);

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
      if (r.shipments_created) parts.push(`${r.shipments_created} expédition(s) créée(s)`);
      if (r.shipments_created) onShipmentsChanged();
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

  const handleCreateShipment = async (inv: DigiInvoice) => {
    setBusyId(inv.id);
    setError(null);
    try {
      const { invoice, shipment } = await createShipmentFromInvoice(inv.id);
      replaceInvoice(invoice);
      onShipmentsChanged();
      setMessage(`Expédition ${shipment.id} créée.`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const handleAssign = async (inv: DigiInvoice, shipmentId: string | null) => {
    const r = await assignInvoiceShipment(inv.id, shipmentId);
    replaceInvoice(r.invoice);
    setAttaching(null);
    onShipmentsChanged();
    setMessage(
      shipmentId
        ? `Facture ${inv.ref ?? ''} rattachée à l'expédition ${shipmentId}.`
        : `Facture ${inv.ref ?? ''} détachée de ${r.previous_shipment_id}.`
    );
    const emptied = r.previous_shipment_empty ? r.previous_shipment_id : null;
    if (emptied) {
      if (
        onDeleteShipment &&
        window.confirm(`L'expédition ${emptied} n'a plus aucune facture. La supprimer ?`)
      ) {
        await onDeleteShipment(emptied);
      } else if (!onDeleteShipment) {
        setMessage(`Facture rattachée. L'expédition ${emptied} n'a plus de facture : demandez à Supply Chain de la supprimer si besoin.`);
      }
    }
  };

  const handleToggleServices = async (inv: DigiInvoice) => {
    const toServices = !inv.no_shipment;
    if (
      toServices &&
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
      const { invoice, detached_shipment_id } = await setInvoiceServices(inv.id, toServices);
      replaceInvoice(invoice);
      if (detached_shipment_id) onShipmentsChanged();
      setMessage(
        toServices
          ? `Facture ${inv.ref ?? ''} classée en services (pas d'expédition).`
          : `Facture ${inv.ref ?? ''} remise dans les factures à expédier.`
      );
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return invoices.filter((inv) => {
      if ((section === 'services') !== isServicesInvoice(inv)) return false;
      if (sourceFilter !== 'all' && inv.source !== sourceFilter) return false;
      if (!q) return true;
      return [
        inv.supplier_name,
        inv.ref,
        inv.amazon_order_ref,
        inv.sale_move_ref,
        inv.odoo_move_name,
        ...inv.lines.map((l) => l.name),
      ].some((v) => v && v.toLowerCase().includes(q));
    });
  }, [invoices, search, sourceFilter, section]);

  const servicesCount = useMemo(() => invoices.filter(isServicesInvoice).length, [invoices]);

  const lastSync = config?.last_sync ?? null;

  const renderShipmentCell = (inv: DigiInvoice) => {
    if (inv.shipment_id && inv.shipment_exists) {
      return (
        <button
          onClick={() => onOpenShipment(inv.shipment_id!)}
          className="font-mono font-semibold text-[#643288] hover:underline dark:text-purple-300"
          title={inv.shipment_global_status || undefined}
        >
          {inv.shipment_id}
          <span className="ml-1 font-sans text-[10px] font-normal text-slate-400">{inv.shipment_mode}</span>
        </button>
      );
    }
    if (isServicesInvoice(inv)) return <span className="text-slate-400">Service</span>;
    if (!inv.has_items) return <span className="text-slate-400">—</span>;
    return createShipmentButton(inv);
  };

  /** Creates the shipment of an invoice that has none (old, draft, deleted, detached). */
  const createShipmentButton = (inv: DigiInvoice) => {
    const isDraft = Boolean(inv.odoo_state && inv.odoo_state !== 'posted');
    return (
      <button
        onClick={() => handleCreateShipment(inv)}
        disabled={busyId === inv.id}
        title={
          isDraft
            ? 'Brouillon Odoo : l\'expédition serait créée automatiquement à la validation, mais vous pouvez la créer dès maintenant.'
            : 'Créer une expédition à partir de cette facture'
        }
        className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg bg-[#643288] px-2.5 py-1 text-[11px] font-semibold text-white shadow-sm hover:bg-[#522870] disabled:opacity-50"
      >
        {busyId === inv.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <PlusCircle className="h-3 w-3" />}
        {inv.shipment_id ? 'Recréer l\'expédition' : 'Créer l\'expédition'}
      </button>
    );
  };

  const button =
    'flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-bold shadow-sm transition disabled:opacity-50';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-extrabold text-slate-900 dark:text-white">
            <ReceiptText className="h-6 w-6 text-[#643288]" /> Colis à suivre — Factures DIGI
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Factures DIGI LOGISTIC dont l'entité de destination est <strong>{destination}</strong>, avec leurs lignes de
            produits. Sources : Odoo, import Excel, saisie manuelle.
          </p>
          {config?.odoo_configured && (
            <p className="mt-0.5 text-[11px] text-slate-400">
              Synchronisation automatique chaque jour vers 8 h (heure de Madagascar), et à la demande avec le bouton.
              {lastSync && (
                <>
                  {' '}Dernière : {new Date(lastSync.finished_at).toLocaleString('fr-FR')} (
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
            className={`${button} bg-[#643288] text-white hover:bg-[#522870]`}
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
            <FilePlus2 className="h-4 w-4" /> Saisie manuelle
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

      {/* Sections */}
      <div className="flex gap-1 rounded-xl bg-slate-200/60 p-1 text-xs font-semibold w-fit dark:bg-slate-800">
        {(
          [
            ['to_ship', 'À expédier', invoices.length - servicesCount],
            ['services', 'Services (non expédiés)', servicesCount],
          ] as [Section, string, number][]
        ).map(([key, label, count]) => (
          <button
            key={key}
            onClick={() => setSection(key)}
            className={`rounded-lg px-3 py-1.5 transition ${
              section === key
                ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white'
                : 'text-slate-500 hover:text-slate-800 dark:text-slate-400'
            }`}
          >
            {label} <span className="ml-1 text-slate-400">{count}</span>
          </button>
        ))}
      </div>
      {section === 'services' && (
        <p className="-mt-3 text-xs text-slate-500 dark:text-slate-400">
          Factures sans article à expédier (frais DEEE, RCP, port… ou classées à la main) : traitement manuel, aucune
          expédition n'est créée.
        </p>
      )}

      {/* Filters */}
      <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-xs sm:flex-row sm:items-center dark:border-slate-800 dark:bg-slate-800">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Fournisseur, référence, commande Amazon, facture vente, produit…"
            className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-xs text-slate-800 focus:border-[#643288] focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          />
        </div>
        <select
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value as typeof sourceFilter)}
          className="rounded-xl border border-slate-200 bg-slate-50 py-2 px-3 text-xs text-slate-800 focus:border-[#643288] focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        >
          <option value="all">Toutes les sources</option>
          {(Object.keys(SOURCE_LABELS) as DigiInvoiceSource[]).map((s) => (
            <option key={s} value={s}>
              {SOURCE_LABELS[s]}
            </option>
          ))}
        </select>
        <span className="text-xs font-semibold text-slate-500">
          {filtered.length} facture(s) · {filtered.reduce((n, i) => n + i.lines.length, 0)} ligne(s)
        </span>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-800">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500 dark:bg-slate-900/60 dark:text-slate-400">
              <tr>
                <th className="w-8 px-3 py-3" />
                <th className="px-3 py-3 font-semibold">Fournisseur</th>
                <th className="px-3 py-3 font-semibold">Réf. facture</th>
                <th className="px-3 py-3 font-semibold">Date de facturation</th>
                <th className="px-3 py-3 font-semibold">Commande Amazon</th>
                <th className="px-3 py-3 font-semibold">Facture vente</th>
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
                  <td colSpan={11} className="px-4 py-12 text-center text-slate-500">
                    <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-4 py-12 text-center text-slate-500">
                    {invoices.length === 0
                      ? 'Aucune facture DIGI enregistrée : synchronisez Odoo, importez un fichier Excel ou saisissez une facture.'
                      : 'Aucune facture ne correspond à vos filtres.'}
                  </td>
                </tr>
              ) : (
                filtered.map((inv) => {
                  const isOpen = expanded.has(inv.id);
                  const editable = inv.source !== 'odoo';
                  const deletable = canDelete && (inv.source !== 'odoo' || inv.odoo_missing);
                  return (
                    <React.Fragment key={inv.id}>
                      <tr
                        onClick={() => toggle(inv.id)}
                        className="cursor-pointer transition hover:bg-slate-50/90 dark:hover:bg-slate-700/40"
                      >
                        <td className="px-3 py-3 text-slate-400">
                          {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </td>
                        <td className="px-3 py-3 font-bold text-slate-800 dark:text-slate-100">
                          {inv.supplier_name || '—'}
                        </td>
                        <td className="px-3 py-3">
                          <div className="font-semibold">{inv.ref || '—'}</div>
                          {inv.odoo_move_name && (
                            <div className="text-[10px] text-slate-400">Odoo : {inv.odoo_move_name}</div>
                          )}
                        </td>
                        <td className="px-3 py-3">{formatDate(inv.invoice_date)}</td>
                        <td className="px-3 py-3 font-mono">{inv.amazon_order_ref || '—'}</td>
                        <td className="px-3 py-3">{inv.sale_move_ref || '—'}</td>
                        <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                          {renderShipmentCell(inv)}
                        </td>
                        <td className="px-3 py-3 text-right">{inv.lines.length}</td>
                        <td className="px-3 py-3 text-right font-semibold">{formatAmount(inv.amount_total)}</td>
                        <td className="px-3 py-3">
                          <div className="flex flex-wrap gap-1">
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${SOURCE_BADGES[inv.source]}`}>
                              {SOURCE_LABELS[inv.source]}
                            </span>
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
                            {inv.has_items && !inv.no_shipment && (
                              <button
                                onClick={() => setAttaching(inv)}
                                title="Rattacher à une expédition existante (envoi groupé)"
                                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-[#643288] dark:hover:bg-slate-700"
                              >
                                <Link2 className="h-4 w-4" />
                              </button>
                            )}
                            <button
                              onClick={() => handleToggleServices(inv)}
                              disabled={busyId === inv.id}
                              title={inv.no_shipment ? 'Remettre dans les factures à expédier' : 'Classer en services (pas d\'expédition)'}
                              className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-[#643288] disabled:opacity-50 dark:hover:bg-slate-700"
                            >
                              {inv.no_shipment ? <PackageCheck className="h-4 w-4" /> : <Wrench className="h-4 w-4" />}
                            </button>
                            {editable && (
                              <button
                                onClick={() => setEditing(inv)}
                                title="Modifier"
                                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-[#643288] dark:hover:bg-slate-700"
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
                          <td />
                          <td colSpan={10} className="px-3 py-3">
                            {inv.has_items && !isServicesInvoice(inv) && !(inv.shipment_id && inv.shipment_exists) && (
                              <div className="mb-3 flex items-center gap-3 rounded-xl border border-dashed border-slate-300 bg-white p-3 dark:border-slate-600 dark:bg-slate-800">
                                <span className="flex-1 text-slate-600 dark:text-slate-300">
                                  {inv.shipment_id
                                    ? `L'expédition ${inv.shipment_id} de cette facture a été supprimée.`
                                    : 'Cette facture n\'a pas encore d\'expédition.'}
                                </span>
                                {createShipmentButton(inv)}
                                <button
                                  onClick={() => setAttaching(inv)}
                                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:border-[#643288] hover:text-[#643288] dark:border-slate-600 dark:text-slate-200"
                                >
                                  <Link2 className="h-3 w-3" /> Rattacher à une expédition existante
                                </button>
                              </div>
                            )}
                            {inv.lines.length === 0 ? (
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
                                : `Ajoutée par ${inv.created_by_email || '—'} le ${new Date(inv.created_at).toLocaleDateString('fr-FR')}` +
                                  (inv.updated_by_email && inv.updated_at !== inv.created_at
                                    ? ` · modifiée par ${inv.updated_by_email} le ${new Date(inv.updated_at).toLocaleDateString('fr-FR')}`
                                    : '')}
                            </p>
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

      {attaching && (
        <AttachShipmentModal
          invoice={attaching}
          shipments={shipments}
          onClose={() => setAttaching(null)}
          onConfirm={(shipmentId) => handleAssign(attaching, shipmentId)}
        />
      )}

      {showImport && (
        <DigiImportModal
          destination={destination}
          maxInvoices={config?.import_max_invoices ?? 2000}
          onClose={() => setShowImport(false)}
          onImported={(result) => {
            fetchDigiInvoices().then(setInvoices).catch((err) => setError(err.message));
            if (result.shipments_created) onShipmentsChanged();
          }}
        />
      )}
    </div>
  );
};
