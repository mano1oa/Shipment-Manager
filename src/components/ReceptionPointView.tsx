import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  Camera,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ImageOff,
  Link2,
  Loader2,
  PackagePlus,
  Plus,
  Trash2,
  Unlink,
  Upload,
  X,
} from 'lucide-react';
import { detectTrackingNumber } from '../lib/carrierDetection';
import { parcelStatusLabel } from '../lib/parcelTracking';
import type { ParcelDestination } from '../lib/parcelTracking';
import {
  DigiInvoice,
  Parcel,
  PointPhoto,
  ReceptionPoint,
  createReceptionPoint,
  deletePointPhoto,
  fetchDigiInvoices,
  fetchReceptionPoint,
  fetchReceptionPoints,
  formatDate,
  formatDateTime,
  inputClass,
  isGoodsInvoice,
  isInvoiceReceived,
  linkPointPhoto,
  uploadPointPhoto,
} from './digiApi';
import { compressPhoto } from './photoCompression';
import { PARCEL_STATUS_BADGES } from './InvoiceParcelsPanel';

interface Props {
  destination: ParcelDestination;
  /** Every parcel (matching by the number read on the label). */
  parcels: Parcel[];
  onClose: () => void;
  /** Parcels changed (receptions confirmed, parcels created). */
  onChanged: () => void;
}

const normalize = (text: string) => (detectTrackingNumber(text).number || text.replace(/\s+/g, '')).toUpperCase();
const supplierOf = (inv: DigiInvoice) => inv.supplier_display || '—';
const today = () => new Date().toISOString().slice(0, 10);

/**
 * Point Antoine (Orly) / reception at Rouen, in two steps:
 * 1. all the photos of the point are uploaded at once;
 * 2. photo by photo, the number read on the label is typed: it matches a
 *    parcel (or creates one for the chosen invoices) and confirms its
 *    reception at the point date.
 */
export const ReceptionPointView: React.FC<Props> = ({ destination, parcels, onClose, onChanged }) => {
  const hub = destination === 'ORLY' ? 'Orly' : 'Rouen';
  const title = destination === 'ORLY' ? 'Point Antoine' : 'Réception Rouen';

  const [points, setPoints] = useState<ReceptionPoint[] | null>(null);
  const [configured, setConfigured] = useState(true);
  const [newDate, setNewDate] = useState(today());
  const [current, setCurrent] = useState<{ point: ReceptionPoint; photos: PointPhoto[] } | null>(null);
  const [index, setIndex] = useState(0);
  const [onlyToMatch, setOnlyToMatch] = useState(true);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // Match form of the current photo
  const [number, setNumber] = useState('');
  const [invoices, setInvoices] = useState<DigiInvoice[] | null>(null);
  const [supplier, setSupplier] = useState('');
  const [chosenInvoices, setChosenInvoices] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const numberInput = useRef<HTMLInputElement>(null);

  const loadPoints = useCallback(() => {
    fetchReceptionPoints(destination)
      .then((d) => {
        setPoints(d.points);
        setConfigured(d.storage_configured);
      })
      .catch((err) => setError(err.message));
  }, [destination]);

  useEffect(loadPoints, [loadPoints]);

  // Tracked invoices still waiting for parcels: for parcels not announced
  useEffect(() => {
    fetchDigiInvoices()
      .then((list) => setInvoices(list.filter((i) => isGoodsInvoice(i) && !isInvoiceReceived(i))))
      .catch(() => setInvoices([]));
  }, []);

  const openPoint = async (id: string, keepIndex = false) => {
    setError(null);
    try {
      const d = await fetchReceptionPoint(id);
      setCurrent({ point: d.point, photos: d.photos });
      setConfigured(d.storage_configured);
      if (!keepIndex) setIndex(0);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleCreate = async () => {
    setError(null);
    try {
      const point = await createReceptionPoint(destination, newDate);
      loadPoints();
      await openPoint(point.id);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleFiles = async (files: FileList | File[] | null) => {
    if (!current || !files || files.length === 0) return;
    setError(null);
    setMessage(null);
    const list = Array.from(files);
    const failures: string[] = [];
    for (let i = 0; i < list.length; i++) {
      setProgress(`Photo ${i + 1} / ${list.length} : compression et envoi…`);
      try {
        await uploadPointPhoto(current.point.id, await compressPhoto(list[i]));
      } catch (err: any) {
        failures.push(`${list[i].name} (${err.message})`);
      }
    }
    setProgress(null);
    if (fileInput.current) fileInput.current.value = '';
    if (failures.length > 0) setError(`Non envoyée(s) : ${failures.join(' ; ')}`);
    else setMessage(`${list.length} photo(s) ajoutée(s) : rattachez-les une à une.`);
    await openPoint(current.point.id, true);
  };

  // ---- Navigation between photos ----
  const visible = useMemo(
    () => (current ? (onlyToMatch ? current.photos.filter((p) => !p.parcel_id) : current.photos) : []),
    [current, onlyToMatch]
  );
  const photo = visible[Math.min(index, Math.max(visible.length - 1, 0))] ?? null;
  const parcelById = useMemo(() => new Map(parcels.map((p) => [p.id, p])), [parcels]);
  const linkedParcel = photo?.parcel_id ? parcelById.get(photo.parcel_id) ?? null : null;

  // A new photo: empty form, cursor in the number field
  useEffect(() => {
    setNumber('');
    setSupplier('');
    setChosenInvoices(new Set());
    if (photo && !photo.parcel_id) setTimeout(() => numberInput.current?.focus(), 0);
  }, [photo?.id]);

  const go = (delta: number) => setIndex((i) => Math.min(Math.max(i + delta, 0), Math.max(visible.length - 1, 0)));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(target?.tagName)) return;
      if (e.key === 'ArrowRight') go(1);
      if (e.key === 'ArrowLeft') go(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible.length]);

  // ---- Matching by the number read on the label ----
  const typed = number.trim() ? normalize(number) : '';
  const exact = typed ? parcels.find((p) => p.tracking_number && p.tracking_number.toUpperCase() === typed) ?? null : null;
  const suggestions = useMemo(() => {
    if (exact || typed.length < 4) return [];
    return parcels
      .filter((p) => p.tracking_number && p.tracking_number.toUpperCase().includes(typed))
      .sort((a, b) => Number(b.destination === destination) - Number(a.destination === destination))
      .slice(0, 5);
  }, [typed, exact, parcels, destination]);

  const suppliers = useMemo(
    () => Array.from(new Set<string>((invoices || []).map(supplierOf))).sort((a, b) => a.localeCompare(b, 'fr')),
    [invoices]
  );
  const supplierInvoices = useMemo(() => (invoices || []).filter((i) => supplierOf(i) === supplier), [invoices, supplier]);

  /** After a match: refresh, then the next photo to match. */
  const afterLink = async (text: string) => {
    setMessage(text);
    onChanged();
    if (current) await openPoint(current.point.id, true);
    // With "to match only", the matched photo leaves the list: same index = next photo
    if (!onlyToMatch) go(1);
  };

  const link = async (body: Parameters<typeof linkPointPhoto>[2], label: string) => {
    if (!current || !photo) return;
    setSaving(true);
    setError(null);
    try {
      const r = await linkPointPhoto(current.point.id, photo.id, body);
      const p = r.parcel;
      await afterLink(
        p
          ? `${label} : colis ${p.tracking_number || 'sans n°'} (${p.supplier_name || '—'})${
              r.reception_confirmed ? ` reçu à ${hub} le ${formatDate(current.point.point_date)}` : ''
            }.`
          : 'Photo détachée : elle est de nouveau à rattacher.'
      );
      // Invoices may now be fully received
      fetchDigiInvoices()
        .then((list) => setInvoices(list.filter((i) => isGoodsInvoice(i) && !isInvoiceReceived(i))))
        .catch(() => {});
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDeletePhoto = async () => {
    if (!current || !photo) return;
    if (!window.confirm('Supprimer cette photo du point ? (doublon, photo floue…)')) return;
    try {
      await deletePointPhoto(current.point.id, photo.id);
      await openPoint(current.point.id, true);
      if (photo.parcel_id) onChanged();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const toggleInvoice = (id: string) =>
    setChosenInvoices((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const linkedCount = current ? current.photos.filter((p) => p.parcel_id).length : 0;
  const label = 'text-[11px] font-semibold text-slate-600 dark:text-slate-300';

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-100 text-xs dark:bg-slate-950">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
        {current && (
          <button
            onClick={() => {
              setCurrent(null);
              loadPoints();
            }}
            title="Retour aux points"
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
        )}
        <Camera className="h-5 w-5 text-[#643288]" />
        <h2 className="text-base font-extrabold text-slate-900 dark:text-white">
          {title}
          {current && ` du ${formatDate(current.point.point_date)}`}
        </h2>
        {current && (
          <span
            className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
              linkedCount === current.photos.length && current.photos.length > 0
                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
            }`}
          >
            {linkedCount} / {current.photos.length} photo(s) rattachée(s)
          </span>
        )}
        <button
          onClick={onClose}
          className="ml-auto rounded-xl p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {(error || message || !configured) && (
        <div className="space-y-2 px-4 pt-3">
          {!configured && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300">
              Le stockage des photos (Neon Object Storage) n'est pas encore configuré : variables NEON_API_KEY,
              NEON_STORAGE_PROJECT_ID, NEON_STORAGE_BRANCH_ID et NEON_STORAGE_BUCKET côté serveur.
            </div>
          )}
          {error && (
            <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 font-semibold text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300">
              <AlertCircle className="h-4 w-4 shrink-0" /> {error}
            </div>
          )}
          {message && (
            <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 font-semibold text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300">
              <CheckCircle2 className="h-4 w-4 shrink-0" /> {message}
            </div>
          )}
        </div>
      )}

      {!current ? (
        /* ---- List of points ---- */
        <div className="mx-auto w-full max-w-3xl flex-1 overflow-y-auto p-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">Nouveau point</h3>
            <p className="mt-1 text-slate-500">
              {destination === 'ORLY'
                ? 'Date du point avec Antoine : vous déposerez ensuite toutes ses photos, puis les rattacherez une à une.'
                : 'Date de la réception au quai de Rouen : vous déposerez ensuite toutes les photos.'}
            </p>
            <div className="mt-3 flex items-end gap-2">
              <label>
                <span className={label}>Date du point</span>
                <input
                  type="date"
                  value={newDate}
                  max={today()}
                  onChange={(e) => setNewDate(e.target.value)}
                  className={inputClass}
                />
              </label>
              <button
                onClick={handleCreate}
                disabled={!newDate}
                className="mb-0.5 flex items-center gap-1.5 rounded-xl bg-[#643288] px-4 py-2.5 font-bold text-white hover:bg-[#522870] disabled:opacity-50"
              >
                <Plus className="h-4 w-4" /> Créer le point
              </button>
            </div>
          </div>

          <h3 className="mt-6 text-sm font-bold text-slate-900 dark:text-white">Points précédents</h3>
          {points === null ? (
            <Loader2 className="mt-3 h-5 w-5 animate-spin text-slate-400" />
          ) : points.length === 0 ? (
            <p className="mt-2 text-slate-500">Aucun point pour l'instant.</p>
          ) : (
            <div className="mt-2 divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
              {points.map((pt) => (
                <button
                  key={pt.id}
                  onClick={() => openPoint(pt.id)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  <span className="font-bold text-slate-900 dark:text-white">{formatDate(pt.point_date)}</span>
                  <span className="text-slate-500">par {pt.created_by_email || '—'}</span>
                  <span
                    className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-bold ${
                      pt.photo_count > 0 && pt.linked_count === pt.photo_count
                        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                        : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                    }`}
                  >
                    {pt.linked_count} / {pt.photo_count} rattachée(s)
                  </span>
                  <ChevronRight className="h-4 w-4 text-slate-400" />
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        /* ---- A point: photos + matching ---- */
        <div className="flex min-h-0 flex-1 flex-col gap-3 p-4 lg:flex-row">
          {/* Photo viewer */}
          <div
            className="flex min-h-0 flex-1 flex-col rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              handleFiles(e.dataTransfer.files);
            }}
          >
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3 dark:border-slate-800">
              <input
                ref={fileInput}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => handleFiles(e.target.files)}
              />
              <button
                onClick={() => fileInput.current?.click()}
                disabled={progress !== null || !configured}
                className="flex items-center gap-1.5 rounded-xl bg-[#643288] px-3 py-2 font-bold text-white hover:bg-[#522870] disabled:opacity-50"
              >
                {progress ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Déposer les photos
              </button>
              <span className="text-slate-500">{progress || 'ou glissez-les ici (toutes d\'un coup)'}</span>
              <label className="ml-auto flex cursor-pointer items-center gap-1.5 font-semibold text-slate-600 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={onlyToMatch}
                  onChange={(e) => {
                    setOnlyToMatch(e.target.checked);
                    setIndex(0);
                  }}
                  className="h-4 w-4 accent-[#643288]"
                />
                À rattacher seulement
              </label>
            </div>

            <div className="relative flex min-h-[18rem] flex-1 items-center justify-center bg-slate-900/95">
              {!photo ? (
                <p className="p-6 text-center text-slate-300">
                  {current.photos.length === 0
                    ? 'Déposez toutes les photos du point.'
                    : 'Toutes les photos sont rattachées. Décochez « À rattacher seulement » pour les revoir.'}
                </p>
              ) : photo.url ? (
                <img src={photo.url} alt="Photo du point" className="max-h-full max-w-full object-contain" />
              ) : (
                <ImageOff className="h-10 w-10 text-slate-500" />
              )}
              {visible.length > 1 && (
                <>
                  <button
                    onClick={() => go(-1)}
                    disabled={index === 0}
                    title="Photo précédente (←)"
                    className="absolute left-3 rounded-full bg-white/90 p-2 text-slate-800 shadow disabled:opacity-30"
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </button>
                  <button
                    onClick={() => go(1)}
                    disabled={index >= visible.length - 1}
                    title="Photo suivante (→)"
                    className="absolute right-3 rounded-full bg-white/90 p-2 text-slate-800 shadow disabled:opacity-30"
                  >
                    <ChevronRight className="h-5 w-5" />
                  </button>
                </>
              )}
              {photo && (
                <span className="absolute bottom-3 left-3 rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-semibold text-white">
                  {Math.min(index, visible.length - 1) + 1} / {visible.length}
                </span>
              )}
            </div>

            {/* Thumbnails */}
            {current.photos.length > 0 && (
              <div className="flex gap-2 overflow-x-auto border-t border-slate-100 p-2 dark:border-slate-800">
                {visible.map((p, i) => (
                  <button
                    key={p.id}
                    onClick={() => setIndex(i)}
                    className={`relative h-14 w-14 shrink-0 overflow-hidden rounded-lg border-2 ${
                      photo?.id === p.id ? 'border-[#643288]' : 'border-transparent'
                    }`}
                  >
                    {p.url ? (
                      <img src={p.url} alt="" className="h-full w-full object-cover" loading="lazy" />
                    ) : (
                      <span className="flex h-full w-full items-center justify-center bg-slate-200 dark:bg-slate-800">
                        <ImageOff className="h-4 w-4 text-slate-400" />
                      </span>
                    )}
                    {p.parcel_id && (
                      <CheckCircle2 className="absolute right-0.5 top-0.5 h-4 w-4 rounded-full bg-white text-emerald-600" />
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Matching panel */}
          <div className="w-full shrink-0 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-4 lg:w-96 dark:border-slate-800 dark:bg-slate-900">
            {!photo ? (
              <p className="text-slate-500">Aucune photo sélectionnée.</p>
            ) : photo.parcel_id ? (
              <div className="space-y-3">
                <h3 className="flex items-center gap-1.5 text-sm font-bold text-emerald-700 dark:text-emerald-300">
                  <CheckCircle2 className="h-4 w-4" /> Photo rattachée
                </h3>
                {linkedParcel ? (
                  <ParcelCard parcel={linkedParcel} />
                ) : (
                  <p className="text-slate-500">Colis rattaché (rechargez si ses informations n'apparaissent pas).</p>
                )}
                <p className="text-[10px] text-slate-400">
                  Par {photo.linked_by_email || '—'} le {formatDateTime(photo.linked_at)}
                </p>
                <button
                  onClick={() => link({ parcel_id: null }, 'Détachée')}
                  disabled={saving}
                  className="flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300"
                >
                  <Unlink className="h-4 w-4" /> Détacher (le colis reste reçu)
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <label className="block">
                  <span className={label}>N° du colis lu sur la photo</span>
                  <input
                    ref={numberInput}
                    value={number}
                    onChange={(e) => setNumber(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && exact && !saving) link({ parcel_id: exact.id }, 'Rattachée');
                    }}
                    placeholder="Recopier le n° de l'étiquette"
                    className={`${inputClass} font-mono`}
                  />
                </label>

                {exact ? (
                  <div className="space-y-2">
                    <ParcelCard parcel={exact} />
                    {exact.destination !== destination && (
                      <p className="text-[11px] font-semibold text-amber-600">
                        Ce colis était attendu à {exact.destination === 'ORLY' ? 'Orly' : 'Rouen'}.
                      </p>
                    )}
                    <button
                      onClick={() => link({ parcel_id: exact.id }, 'Rattachée')}
                      disabled={saving}
                      className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-2.5 font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
                    >
                      {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
                      Rattacher — reçu le {formatDate(current.point.point_date)} (Entrée)
                    </button>
                  </div>
                ) : (
                  <>
                    {suggestions.length > 0 && (
                      <div>
                        <span className={label}>Colis proches</span>
                        <div className="mt-1 space-y-1">
                          {suggestions.map((s) => (
                            <button
                              key={s.id}
                              onClick={() => setNumber(s.tracking_number || '')}
                              className="block w-full rounded-lg border border-slate-200 px-2 py-1.5 text-left hover:border-[#643288] dark:border-slate-700"
                            >
                              <span className="font-mono font-semibold">{s.tracking_number}</span>
                              <span className="ml-2 text-slate-500">{s.supplier_name || '—'}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="rounded-xl border border-dashed border-slate-300 p-3 dark:border-slate-700">
                      <h4 className="flex items-center gap-1.5 font-bold text-slate-800 dark:text-slate-100">
                        <PackagePlus className="h-4 w-4" />
                        {typed ? 'Colis non annoncé : choisir sa facture' : 'N° illisible : rattacher à une facture'}
                      </h4>
                      <label className="mt-2 block">
                        <span className={label}>Fournisseur</span>
                        <select
                          value={supplier}
                          onChange={(e) => {
                            setSupplier(e.target.value);
                            setChosenInvoices(new Set());
                          }}
                          className={inputClass}
                        >
                          <option value="">{invoices === null ? 'Chargement…' : '— Sélectionner —'}</option>
                          {suppliers.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                      </label>
                      {supplier && (
                        <div className="mt-2 max-h-48 space-y-1 overflow-y-auto">
                          {supplierInvoices.map((inv) => (
                            <label
                              key={inv.id}
                              className="flex cursor-pointer items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-slate-50 dark:hover:bg-slate-800"
                            >
                              <input
                                type="checkbox"
                                checked={chosenInvoices.has(inv.id)}
                                onChange={() => toggleInvoice(inv.id)}
                                className="h-4 w-4 accent-[#643288]"
                              />
                              <span className="font-semibold">{inv.ref || '—'}</span>
                              <span className="text-slate-500">
                                {formatDate(inv.invoice_date)} ·{' '}
                                {inv.parcel_count === 0 ? 'sans colis' : `${inv.parcel_received_count}/${inv.parcel_count} reçu(s)`}
                              </span>
                            </label>
                          ))}
                        </div>
                      )}
                      <button
                        onClick={() =>
                          link(
                            { new_parcel: { tracking_number: number.trim() || null, invoice_ids: Array.from(chosenInvoices) } },
                            'Colis créé et rattaché'
                          )
                        }
                        disabled={saving || chosenInvoices.size === 0}
                        className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl bg-[#643288] px-3 py-2.5 font-bold text-white hover:bg-[#522870] disabled:opacity-40"
                      >
                        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackagePlus className="h-4 w-4" />}
                        Créer le colis et rattacher ({chosenInvoices.size})
                      </button>
                    </div>
                  </>
                )}

                <div className="flex items-center justify-between border-t border-slate-100 pt-3 dark:border-slate-800">
                  <button
                    onClick={() => go(1)}
                    disabled={index >= visible.length - 1}
                    className="flex items-center gap-1 font-bold text-slate-500 hover:text-slate-800 disabled:opacity-30 dark:hover:text-slate-200"
                  >
                    Passer <ChevronRight className="h-4 w-4" />
                  </button>
                  <button
                    onClick={handleDeletePhoto}
                    className="flex items-center gap-1 font-semibold text-rose-500 hover:text-rose-700"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Supprimer la photo
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const ParcelCard: React.FC<{ parcel: Parcel }> = ({ parcel }) => (
  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800">
    <div className="flex items-center justify-between gap-2">
      <span className="font-mono font-bold">{parcel.tracking_number || 'sans n° de suivi'}</span>
      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${PARCEL_STATUS_BADGES[parcel.status]}`}>
        {parcelStatusLabel(parcel.status, parcel.destination)}
      </span>
    </div>
    <div className="mt-1 font-semibold">{parcel.supplier_name || '—'}</div>
    <div className="text-slate-500">
      Facture(s) : {parcel.invoices.map((i) => i.ref || '—').join(', ') || '—'}
      {parcel.carrier_name && ` · ${parcel.carrier_name}`}
      {parcel.expected_delivery && ` · prévu le ${formatDate(parcel.expected_delivery)}`}
    </div>
  </div>
);
