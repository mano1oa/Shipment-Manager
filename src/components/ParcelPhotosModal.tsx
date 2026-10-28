import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Camera, ImageOff, Loader2, Trash2, X } from 'lucide-react';
import { Parcel, ParcelPhoto, deleteParcelPhoto, fetchParcelPhotos, formatDateTime } from './digiApi';

interface Props {
  parcel: Parcel;
  /** Supply Chain: deletes photos (they are added at the point Antoine). */
  canEdit: boolean;
  onClose: () => void;
  /** Photo count changed. */
  onChanged: () => void;
}

/**
 * Antoine's photos of a parcel: proof of reception, used for claims. Photos
 * are uploaded and matched at the point Antoine (Colis vers Orly › Point).
 */
export const ParcelPhotosModal: React.FC<Props> = ({ parcel, canEdit, onClose, onChanged }) => {
  const [photos, setPhotos] = useState<ParcelPhoto[] | null>(null);
  const [configured, setConfigured] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState<ParcelPhoto | null>(null);

  const load = useCallback(() => {
    fetchParcelPhotos(parcel.id)
      .then((d) => {
        setPhotos(d.photos);
        setConfigured(d.storage_configured);
      })
      .catch((err) => setError(err.message));
  }, [parcel.id]);

  useEffect(load, [load]);

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
            Le stockage des photos (Google Drive partagé) n'est pas encore configuré : variables GOOGLE_SERVICE_ACCOUNT_EMAIL,
            GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY et GOOGLE_DRIVE_PHOTOS_FOLDER_ID côté serveur.
          </div>
        )}
        {error && (
          <div className="mt-4 flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 font-semibold text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300">
            <AlertCircle className="h-4 w-4 shrink-0" /> {error}
          </div>
        )}

        <div className="mt-4">
          {photos === null ? (
            <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
          ) : photos.length === 0 ? (
            <p className="text-slate-500">
              Aucune photo pour ce colis (la photo est facultative). Les photos se déposent et se rattachent au point
              Antoine.
            </p>
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
            Photos conservées dans le Drive partagé (un dossier par point), visibles ici par les utilisateurs connectés.
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
