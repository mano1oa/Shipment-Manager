import { useState } from 'react';
import { parcelPlace } from '../lib/parcelTracking';
import type { ParcelStatus } from '../lib/parcelTracking';
import { Parcel, formatDate, setParcelStatus } from './digiApi';

/**
 * State changes of parcels (reception, loss, avis de recherche), shared by
 * Colis vers Orly / Rouen and En cours d'acheminement. onDone runs after each
 * batch, before the reload.
 */
export function useParcelStatusActions(hub: string, onReload: () => void, onDone?: () => void) {
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  /** Changes the state of parcels one by one and reports the failures. */
  const changeStatus = async (list: Parcel[], status: ParcelStatus, label: string, receivedAt?: string) => {
    setActionError(null);
    setActionMessage(null);
    const failures: string[] = [];
    for (let i = 0; i < list.length; i++) {
      setBusy(`${label} : ${i + 1} / ${list.length}…`);
      try {
        await setParcelStatus(list[i].id, status, status === 'received' ? receivedAt : null);
      } catch (err: any) {
        failures.push(`${list[i].tracking_number || list[i].supplier_name || list[i].id} (${err.message})`);
      }
    }
    setBusy(null);
    onDone?.();
    if (failures.length > 0) setActionError(`${failures.length} colis non traité(s) : ${failures.join(' ; ')}`);
    if (list.length > failures.length) setActionMessage(`${list.length - failures.length} colis : ${label.toLowerCase()}.`);
    onReload();
  };

  const confirmReception = (list: Parcel[], receivedAt: string) => {
    const place = hub === 'Rouen' ? 'au lieu de positionnement' : `à ${hub}`;
    if (!window.confirm(`Confirmer la réception ${place} de ${list.length} colis, le ${formatDate(receivedAt)} ?`)) return;
    changeStatus(list, 'received', 'Réception confirmée', receivedAt);
  };

  const openSearch = (p: Parcel) => {
    if (!window.confirm(`Ouvrir un avis de recherche : le colis ${p.tracking_number || ''} a été reçu à ${parcelPlace(p)} mais n'est pas arrivé à Madagascar ?`)) return;
    changeStatus([p], 'search', 'Avis de recherche ouvert');
  };

  const declareLost = (p: Parcel) => {
    if (!window.confirm(`Déclarer le colis ${p.tracking_number || ''} perdu avant ${hub} (réclamation fournisseur) ?`)) return;
    changeStatus([p], 'lost', `Déclaré perdu avant ${hub}`);
  };

  /**
   * Back to the previous state: an avis de recherche concerns a parcel already
   * received, so it goes back to "received" (reception kept); a received or
   * lost parcel goes back to "to receive".
   */
  const backToReceive = (p: Parcel) => {
    if (p.status === 'search') {
      if (!window.confirm(`Annuler l'avis de recherche du colis ${p.tracking_number || ''} ? Il redevient « reçu » à ${hub}.`)) return;
      changeStatus([p], 'received', 'Avis de recherche annulé');
      return;
    }
    if (!window.confirm(`Remettre le colis ${p.tracking_number || ''} « à recevoir » ? La date de réception est effacée.`)) return;
    changeStatus([p], 'to_receive', 'Remis à recevoir');
  };

  return { busy, actionError, actionMessage, setActionMessage, confirmReception, openSearch, declareLost, backToReceive };
}
