import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, Camera, ImageOff, Loader2, Trash2, Upload, X } from 'lucide-react';
import { Parcel, ParcelPhoto, deleteParcelPhoto, fetchParcelPhotos, formatDateTime, uploadParcelPhoto } from './digiApi';
import { compressPhoto } from './photoCompression';

interface Props {
  parcel: Parcel;
  /** Supply Chain: adds and deletes photos. */
  canEdit: boolean;
  onClose: () => void;
  /** Photo count changed. */
  onChanged: () => void;
}

/** Antoine's photos of a parcel: proof of reception, used for claims. */
export const ParcelPhotosModal: React.FC<Props> = ({ parcel, canEdit, onClose, onChanged }) => {
  const [photos, setPhotos] = useState<ParcelPhoto[] | null>(null);
  const [configured, setConfigured] = useState(true);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState<ParcelPhoto | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    fetchParcelPhotos(parcel.id)
      .then((d) => {
        setPhotos(d.photos);
        setConfigured(d.storage_configured);
      })
      .catch((err) => setError(err.message));
  }, [parcel.id]);

  useEffect(load, [load]);

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setError(null);
    const failures: string[] = [];
    const list = Array.from(files);
    for (let i = 0; i < list.length; i++) {
      setProgress(`Photo ${i + 1} / ${list.length} : compression et envoi…`);
      try {
        await uploadParcelPhoto(parcel.id, await compressPhoto(list[i]));
      } catch (err: any) {
        failures.push(`${list[i].name} (${err.message})`);
      }
    }
    setProgress(null);
    if (input.current) input.current.value = '';
    if (failures.length > 0) setError(`Non envoyée(s) : ${failures.join(' ; ')}`);
    load();
    onChanged();
  };

  const handleDelete = async (photo: ParcelPhoto) => {
    if (!window.confirm('Supprimer cette photo ? Elle peut servir de preuve en cas de réclamation.')) return;
    try {
      await deleteParcelPhoto(parcel.id, photo.id);
      load();
      onChanged();
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-900/60 p-4 backdrop-blur-xs">
      <div className="my-8 w-full max-w-3xl rounded-3xl border border-slate-200 bg-white p-6 text-xs shadow-2xl dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-100 pb-4 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#643288] text-white shadow-sm">
              <Camera className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-extrabold text-slate-900 dark:text-white">Photos du colis</h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {parcel.supplier_name || '—'} · {parcel.tracking_number || 'sans n° de suivi'} · facture(s){' '}
                {parcel.invoices.map((i) => i.ref || '—').join(', ')}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-xl p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {!configured && (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300">
            Le stockage des photos (Neon Object Storage) n'est pas encore configuré : variables NEON_API_KEY,
            NEON_STORAGE_PROJECT_ID, NEON_STORAGE_BRANCH_ID et NEON_STORAGE_BUCKET côté serveur.
          </div>
        )}
        {error && (
          <div className="mt-4 flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 font-semibold text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300">
            <AlertCircle className="h-4 w-4 shrink-0" /> {error}
          </div>
        )}

        {canEdit && configured && (
          <div className="mt-4 flex items-center gap-3">
            <input
              ref={input}
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => handleFiles(e.target.files)}
              className="hidden"
            />
            <button
              onClick={() => input.current?.click()}
              disabled={progress !== null}
              className="flex items-center gap-2 rounded-xl bg-[#643288] px-4 py-2 font-bold text-white hover:bg-[#522870] disabled:opacity-50"
            >
              {progress ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Ajouter des photos
            </button>
            <span className="text-slate-500">
              {progress || 'Réduites à 1 600 px avant envoi. Une photo = ce colis (un seul fournisseur).'}
            </span>
          </div>
        )}

        <div className="mt-4">
          {photos === null ? (
            <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
          ) : photos.length === 0 ? (
            <p className="text-slate-500">Aucune photo pour ce colis (la photo est facultative).</p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {photos.map((photo) => (
                <figure key={photo.id} className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700">
                  {photo.url ? (
                    <button onClick={() => setZoom(photo)} className="block w-full">
                      <img src={photo.url} alt="Photo du colis" className="h-40 w-full object-cover" loading="lazy" />
                    </button>
                  ) : (
                    <div className="flex h-40 items-center justify-center bg-slate-50 text-slate-400 dark:bg-slate-800">
                      <ImageOff className="h-6 w-6" />
                    </div>
                  )}
                  <figcaption className="flex items-center justify-between gap-2 p-2 text-[10px] text-slate-500">
                    <span>
                      {formatDateTime(photo.uploaded_at)}
                      <br />
                      {photo.uploaded_by_email || '—'}
                    </span>
                    {canEdit && (
                      <button
                        onClick={() => handleDelete(photo)}
                        title="Supprimer la photo"
                        className="rounded-lg p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </figcaption>
                </figure>
              ))}
            </div>
          )}
          <p className="mt-3 text-[10px] text-slate-400">
            Liens d'affichage temporaires (10 minutes) : rouvrez la fenêtre si une photo ne s'affiche plus.
          </p>
        </div>
      </div>

      {zoom?.url && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4" onClick={() => setZoom(null)}>
          <img src={zoom.url} alt="Photo du colis" className="max-h-full max-w-full rounded-xl" />
        </div>
      )}
    </div>
  );
};
