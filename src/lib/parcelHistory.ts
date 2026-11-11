import { formatDate } from './dateFormat.js';
import { PARCEL_NUMBER_KIND_LABELS, isParcelNumberKind } from './parcelBoxes.js';
import { parcelStatusLabel } from './parcelTracking.js';
import type { ParcelDestination, ParcelStatus } from './parcelTracking.js';

/**
 * History of a parcel (shown inside its details in the tracking lists), built
 * from what is recorded: the parcel row, its boxes received, its photos, the
 * shipments of its invoices and the audit trail (system_audit_logs).
 */

export type HistoryTone = 'neutral' | 'success' | 'warning' | 'danger';

export interface ParcelHistoryEvent {
  /** ISO timestamp of the action (sort key). */
  at: string;
  title: string;
  detail: string | null;
  /** Email of who did it ("automatique" for the system). */
  by: string | null;
  tone: HistoryTone;
  /** Photo to show as a thumbnail. */
  photo_id: string | null;
}

export interface ParcelHistoryInput {
  parcel: {
    status: ParcelStatus;
    destination: ParcelDestination;
    status_changed_at: string | Date | null;
    created_at: string | Date;
    created_by_email: string | null;
    /** Date of the point where it was created (label not found), YYYY-MM-DD. */
    created_point_date: string | null;
  };
  /** Boxes received (parcel_receptions); dates as YYYY-MM-DD. */
  receptions: {
    received_at: string;
    received_by_email: string | null;
    point_date: string | null;
    photo_id: string | null;
    piece_number: string | null;
    box_index: number | null;
    created_at: string | Date;
  }[];
  /** Photos of the parcel (parcel_photos). */
  photos: {
    id: string;
    uploaded_at: string | Date;
    uploaded_by_email: string | null;
    point_date: string | null;
    linked_at: string | Date | null;
    linked_by_email: string | null;
  }[];
  /** Shipments of its invoices; `at` = when the invoice joined a shipment (first time). */
  shipments: { label: string; invoice_refs: string[]; at: string | Date | null }[];
  invoices: { id: string; ref: string | null }[];
  audit: { action: string; details: Record<string, unknown> | null; created_at: string | Date }[];
  boxes_expected: number | null;
}

const SYSTEM_EMAIL = 'alerte-automatique';

const iso = (value: string | Date | null | undefined): string | null => {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return isNaN(d.getTime()) ? null : d.toISOString();
};

const actor = (email: unknown): string | null =>
  typeof email === 'string' && email ? (email === SYSTEM_EMAIL ? 'automatique' : email) : null;

const str = (value: unknown): string | null => (typeof value === 'string' && value ? value : null);

const isStatus = (value: unknown): value is ParcelStatus =>
  value === 'to_receive' || value === 'received' || value === 'lost' || value === 'search';

/** Audit actions already shown from the tables (or not about this parcel alone). */
const COVERED_ACTIONS = new Set(['CREATE_PARCEL', 'LINK_POINT_PHOTO']);

export function buildParcelHistory(input: ParcelHistoryInput): ParcelHistoryEvent[] {
  const { parcel } = input;
  const hub = parcel.destination === 'ROUEN' ? 'Rouen' : 'Orly';
  const statusText = (s: unknown) => (isStatus(s) ? parcelStatusLabel(s, parcel.destination) : '—');
  const events: ParcelHistoryEvent[] = [];
  const push = (e: Omit<ParcelHistoryEvent, 'at'> & { at: string | Date | null | undefined }) => {
    const at = iso(e.at);
    if (at) events.push({ ...e, at });
  };

  push({
    at: parcel.created_at,
    title: parcel.created_point_date ? `Colis créé au point du ${formatDate(parcel.created_point_date)}` : 'Colis créé',
    detail: parcel.created_point_date ? 'Étiquette non trouvée parmi les colis annoncés' : null,
    by: actor(parcel.created_by_email),
    tone: 'neutral',
    photo_id: null,
  });

  // Boxes received now (one per photo matched, or a reception confirmed without photo)
  const single = input.receptions.length === 1;
  const receptionPhotos = new Set(input.receptions.map((r) => r.photo_id).filter(Boolean) as string[]);
  input.receptions.forEach((r, i) => {
    const n = r.box_index ?? i + 1;
    const of = input.boxes_expected !== null ? `/${input.boxes_expected}` : '';
    push({
      at: r.created_at,
      title: single
        ? `Réception confirmée à ${hub} le ${formatDate(r.received_at)}`
        : `Boîte ${n}${of} reçue à ${hub} le ${formatDate(r.received_at)}`,
      detail:
        [
          r.point_date ? `Point du ${formatDate(r.point_date)}` : r.photo_id ? null : 'Sans photo',
          r.piece_number ? `n° de pièce ${r.piece_number}` : null,
        ]
          .filter(Boolean)
          .join(' · ') || null,
      by: actor(r.received_by_email),
      tone: 'success',
      photo_id: r.photo_id,
    });
  });

  // Photos not tied to a box received (kept after a status change, added on the parcel)
  for (const p of input.photos) {
    if (receptionPhotos.has(p.id)) continue;
    push({
      at: p.linked_at ?? p.uploaded_at,
      title: p.point_date ? `Photo du point du ${formatDate(p.point_date)} rattachée` : 'Photo ajoutée',
      detail: null,
      by: actor(p.linked_by_email ?? p.uploaded_by_email),
      tone: 'neutral',
      photo_id: p.id,
    });
  }

  for (const s of input.shipments) {
    push({
      at: s.at,
      title: `Rattaché à l'expédition ${s.label}`,
      detail: s.invoice_refs.length ? `Facture(s) ${s.invoice_refs.join(', ')}` : null,
      by: null,
      tone: 'neutral',
      photo_id: null,
    });
  }

  const invoiceRef = (id: unknown) => input.invoices.find((i) => i.id === id)?.ref || null;
  const receptionTimes = input.receptions.map((r) => new Date(iso(r.created_at) || 0).getTime());
  let autoLossLogged = false;

  for (const a of input.audit) {
    if (COVERED_ACTIONS.has(a.action)) continue;
    const d = a.details || {};
    const by = actor(d.actor_email);
    const at = a.created_at;
    const base = { at, by, photo_id: null as string | null };
    switch (a.action) {
      case 'SET_PARCEL_STATUS': {
        const from = d.from;
        const to = d.to;
        if (from === to) break;
        // Reception confirmed: already shown by its box (same moment)
        const t = new Date(iso(at) || 0).getTime();
        if (to === 'received' && from !== 'search' && receptionTimes.some((r) => Math.abs(r - t) < 60_000)) break;
        const title =
          to === 'search'
            ? 'Avis de recherche ouvert'
            : from === 'search' && to === 'received'
              ? 'Avis de recherche levé : colis retrouvé'
              : to === 'lost'
                ? `Déclaré perdu avant ${hub}`
                : to === 'received'
                  ? `Réception confirmée à ${hub}${str(d.received_at) ? ` le ${formatDate(str(d.received_at))}` : ''}`
                  : `Remis « ${statusText(to)} »`;
        push({
          ...base,
          title,
          detail: `${statusText(from)} → ${statusText(to)}`,
          tone: to === 'lost' ? 'danger' : to === 'search' ? 'warning' : to === 'received' ? 'success' : 'neutral',
        });
        break;
      }
      case 'AUTO_MARK_PARCEL_LOST':
        autoLossLogged = true;
        push({ ...base, title: `Déclaré perdu avant ${hub}`, detail: 'Délai de réception dépassé', tone: 'danger' });
        break;
      case 'RECEIVE_BOX': {
        // Box received then removed (status change): its photo is no longer on a box
        const photo = str(d.photo_id);
        if (photo && receptionPhotos.has(photo)) break;
        push({
          ...base,
          title: `Boîte reçue à ${hub}${str(d.received_at) ? ` le ${formatDate(str(d.received_at))}` : ''}`,
          detail: 'Réception annulée depuis',
          tone: 'neutral',
          photo_id: photo && input.photos.some((p) => p.id === photo) ? photo : null,
        });
        break;
      }
      case 'UNRECEIVE_BOX':
        push({
          ...base,
          title: 'Boîte retirée (photo détachée du point)',
          detail: d.back_to_receive ? 'Plus aucune boîte : colis de nouveau à recevoir' : null,
          tone: 'warning',
        });
        break;
      case 'MERGE_PARCEL':
        push({
          ...base,
          title: `Colis ${str(d.merged_tracking_number) || 'sans n°'} fusionné dans ce colis`,
          detail:
            typeof d.boxes_after === 'number'
              ? `${d.boxes_after} boîte(s)${typeof d.boxes_expected === 'number' ? ` sur ${d.boxes_expected}` : ''} après fusion`
              : null,
          tone: 'neutral',
        });
        break;
      case 'UPDATE_PARCEL':
        push({
          ...base,
          title: 'Colis modifié',
          detail: str(d.tracking_number) ? `N° de suivi ${d.tracking_number}` : null,
          tone: 'neutral',
        });
        break;
      case 'ADD_PARCEL_NUMBER':
      case 'REMOVE_PARCEL_NUMBER': {
        const kind = isParcelNumberKind(d.kind) ? PARCEL_NUMBER_KIND_LABELS[d.kind] : 'N°';
        push({
          ...base,
          title: `${kind} ${str(d.number) || ''} ${a.action === 'ADD_PARCEL_NUMBER' ? 'ajouté' : 'retiré'}`.replace(/\s+/g, ' '),
          detail: null,
          tone: 'neutral',
        });
        break;
      }
      case 'SET_BOXES_EXPECTED':
        push({
          ...base,
          title: `Boîtes annoncées : ${typeof d.to === 'number' ? d.to : 'inconnu'}`,
          detail: typeof d.from === 'number' ? `avant : ${d.from}` : null,
          tone: 'neutral',
        });
        break;
      case 'LINK_PARCEL_INVOICES': {
        const ids = Array.isArray(d.invoice_ids) ? d.invoice_ids : [];
        const refs = ids.map((id) => invoiceRef(id)).filter(Boolean);
        push({
          ...base,
          title: ids.length > 1 ? 'Factures ajoutées au colis' : 'Facture ajoutée au colis',
          detail: refs.length ? refs.join(', ') : null,
          tone: 'neutral',
        });
        break;
      }
      case 'UNLINK_PARCEL_INVOICE':
        push({ ...base, title: 'Facture retirée du colis', detail: invoiceRef(d.invoice_id), tone: 'neutral' });
        break;
      case 'DELETE_PARCEL_PHOTO':
        push({ ...base, title: 'Photo supprimée', detail: null, tone: 'neutral' });
        break;
      default:
        break;
    }
  }

  // Lost automatically before the per-parcel log: only its current state is known
  if (!autoLossLogged && parcel.status === 'lost') {
    const changed = iso(parcel.status_changed_at);
    const explained = events.some((e) => e.tone === 'danger' && changed && e.at >= changed);
    if (changed && !explained) {
      push({
        at: changed,
        title: `Déclaré perdu avant ${hub}`,
        detail: 'Délai de réception dépassé (automatique)',
        by: 'automatique',
        tone: 'danger',
        photo_id: null,
      });
    }
  }

  return events.sort((a, b) => a.at.localeCompare(b.at));
}
