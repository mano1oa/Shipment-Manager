/**
 * Where a parcel stands between the supplier and Madagascar. Shared by the
 * "En cours d'acheminement" lists and the weekly Google Chat summary.
 */
export type ParcelStage = 'to_hub' | 'at_hub' | 'to_mada' | 'customs' | 'search' | 'lost';

/**
 * Stage of a parcel, or null once its shipment is delivered to the Madagascar
 * warehouse. Lost parcels and "avis de recherche" stay listed: they never
 * reached Madagascar.
 */
export function parcelStage(p: { status: string }, shipments: { global_status: string }[]): ParcelStage | null {
  if (p.status === 'lost') return 'lost';
  if (p.status === 'search') return 'search';
  if (p.status === 'to_receive') return 'to_hub';
  if (shipments.some((s) => s.global_status === 'Livrée entrepôt')) return null;
  if (shipments.some((s) => s.global_status === 'Bloquée douane')) return 'customs';
  if (shipments.some((s) => s.global_status === 'Expédiée vers Mada')) return 'to_mada';
  return 'at_hub';
}
