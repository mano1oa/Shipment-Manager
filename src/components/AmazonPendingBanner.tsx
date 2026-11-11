import React, { useEffect, useState } from 'react';
import { Loader2, Trash2 } from 'lucide-react';
import type { ParcelDestination } from '../lib/parcelTracking';
import { AmazonPendingParcel, deleteAmazonPending, fetchAmazonPending, formatDate } from './digiApi';

const daysSince = (date: string) => Math.max(0, Math.floor((Date.now() - new Date(`${date}T00:00:00`).getTime()) / 86_400_000));

/**
 * Tracking numbers of the Amazon report whose order has no invoice yet (read
 * again when `refreshKey` changes). Their parcel is made automatically when
 * the invoice arrives; a number can be removed by hand.
 */
export function useAmazonPending(destination: ParcelDestination, refreshKey: unknown) {
  const [pending, setPending] = useState<AmazonPendingParcel[]>([]);
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetchAmazonPending(destination)
      .then((list) => alive && setPending(list))
      .catch((err) => alive && setError(err.message));
    return () => {
      alive = false;
    };
  }, [destination, refreshKey]);

  const remove = async (p: AmazonPendingParcel) => {
    if (!window.confirm(`Retirer le n° ${p.tracking_number} de la liste d'attente ? Son colis ne sera pas créé automatiquement.`)) return;
    setRemoving(p.tracking_number);
    setError(null);
    try {
      await deleteAmazonPending(p.tracking_number);
      setPending((list) => list.filter((x) => x.tracking_number !== p.tracking_number));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setRemoving(null);
    }
  };

  return { pending, removing, error, remove };
}

/** Detail of the numbers waiting for their invoice (opened from the « À traiter » row). */
export const AmazonPendingTable: React.FC<{
  data: ReturnType<typeof useAmazonPending>;
  /** Supply Chain: can remove a number (order cancelled, returned…). */
  canEdit: boolean;
}> = ({ data, canEdit }) => {
  const { pending, removing, error, remove } = data;
  return (
    <>
      {error && <p className="mb-2 font-semibold text-rose-600">{error}</p>}
      <div className="max-h-72 overflow-auto rounded-xl border border-sky-200 bg-white dark:border-sky-900/60 dark:bg-slate-900">
        <table className="w-full text-left">
          <thead className="sticky top-0 bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500 dark:bg-slate-800">
            <tr>
              <th className="px-3 py-2">N° de suivi</th>
              <th className="px-3 py-2">Commande Amazon</th>
              <th className="px-3 py-2">Transporteur</th>
              <th className="px-3 py-2">Livraison prévue</th>
              <th className="px-3 py-2">Ajouté le</th>
              <th className="px-3 py-2">Attente</th>
              {canEdit && <th className="px-3 py-2" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-slate-700 dark:divide-slate-800 dark:text-slate-200">
            {pending.map((p) => {
              const days = daysSince(p.created_at);
              return (
                <tr key={p.tracking_number}>
                  <td className="px-3 py-1.5 font-mono font-semibold">{p.tracking_number}</td>
                  <td className="px-3 py-1.5 font-mono">
                    {Array.from(new Set(p.sources.map((s) => s.order_ref))).map((o) => (
                      <div key={o}>{o}</div>
                    ))}
                  </td>
                  <td className="px-3 py-1.5">{p.carrier_text || '—'}</td>
                  <td className="px-3 py-1.5">{formatDate(p.expected_delivery)}</td>
                  <td className="px-3 py-1.5">{formatDate(p.created_at)}</td>
                  <td className={`px-3 py-1.5 font-semibold ${days >= 14 ? 'text-amber-700 dark:text-amber-300' : ''}`}>{days} j</td>
                  {canEdit && (
                    <td className="px-3 py-1.5 text-right">
                      <button
                        onClick={() => remove(p)}
                        disabled={removing !== null}
                        title="Retirer de la liste d'attente (commande annulée, retournée…)"
                        className="rounded-lg p-1.5 text-slate-500 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40 dark:hover:bg-rose-950/40"
                      >
                        {removing === p.tracking_number ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
};
