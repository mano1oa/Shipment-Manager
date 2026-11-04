import React, { useMemo, useState } from 'react';
import { Package, Plane, Route, Ship } from 'lucide-react';
import type { TrackingSettings } from '../lib/parcelTracking';
import { ParcelsOverview } from './digiApi';
import { ParcelsBoardView, parcelMatches } from './ParcelsBoardView';
import { InTransitParcelsList, inTransitRows } from './InTransitParcelsList';
import { ShipmentsView, matchesSearch } from './ShipmentsView';

type Tab = 'in_transit' | 'shipments' | 'parcels';

interface Props extends Omit<React.ComponentProps<typeof ShipmentsView>, 'modeFilter'> {
  mode: 'Air' | 'Sea';
  onOpenShipment: (shipmentId: string) => void;
  /** Loaded once by the app (also feeds the parcel alerts). */
  parcelsOverview: ParcelsOverview | null;
  parcelsLoading: boolean;
  parcelsError: string | null;
  onReloadParcels: () => void;
  settings: TrackingSettings | undefined;
  isSupplyChain: boolean;
}

/**
 * Suivi Aérien / Maritime: first every parcel not yet in Madagascar, then the
 * parcels on their way from the suppliers (to Orly or Rouen) and the shipments
 * to Madagascar. The top bar search applies to all; each tab shows how many
 * results it holds.
 */
export const TransportTrackingView: React.FC<Props> = ({
  mode,
  onOpenShipment,
  parcelsOverview,
  parcelsLoading,
  parcelsError,
  onReloadParcels,
  settings,
  isSupplyChain,
  ...shipmentsProps
}) => {
  const destination = mode === 'Air' ? 'ORLY' : 'ROUEN';
  const hub = mode === 'Air' ? 'Orly' : 'Rouen';
  const [tab, setTab] = useState<Tab>('in_transit');
  const parcels = parcelsOverview?.parcels ?? null;

  const search = shipmentsProps.globalSearch || '';
  const shipmentCount = useMemo(
    () => shipmentsProps.shipments.filter((s) => s.mode === mode && matchesSearch(s, search)).length,
    [shipmentsProps.shipments, mode, search]
  );
  const parcelCount = useMemo(
    () => (parcels || []).filter((p) => p.destination === destination && parcelMatches(p, search)).length,
    [parcels, destination, search]
  );

  const inTransitCount = useMemo(
    () =>
      inTransitRows(parcels || [], destination, shipmentsProps.shipments).filter((r) => parcelMatches(r.parcel, search))
        .length,
    [parcels, destination, shipmentsProps.shipments, search]
  );

  // The whole journey first, then in its order: supplier → hub, then hub → Madagascar
  const tabs: { key: Tab; label: string; icon: React.ElementType; count: number; hint: string }[] = [
    {
      key: 'in_transit',
      label: "En cours d'acheminement",
      icon: Route,
      count: inTransitCount,
      hint: search ? 'trouvé(s)' : 'colis',
    },
    {
      key: 'parcels',
      label: `Colis vers ${hub}`,
      icon: Package,
      count: parcelCount,
      hint: search ? 'trouvé(s)' : 'colis',
    },
    {
      key: 'shipments',
      label: mode === 'Air' ? 'Expéditions Orly → Mada' : 'Expéditions Rouen → Mada',
      icon: mode === 'Air' ? Plane : Ship,
      count: shipmentCount,
      hint: search ? 'résultat(s)' : '',
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex w-fit max-w-full gap-1 overflow-x-auto rounded-xl bg-slate-200/60 p-1 text-xs font-semibold dark:bg-slate-800">
        {tabs.map(({ key, label, icon: Icon, count, hint }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 transition ${
              tab === key
                ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white'
                : 'text-slate-500 hover:text-slate-800 dark:text-slate-400'
            }`}
          >
            <Icon className="h-3.5 w-3.5" /> {label}
            <span className={`ml-1 ${search && count > 0 && tab !== key ? 'font-bold text-[#623387]' : 'text-slate-400'}`}>
              {key !== 'shipments' && parcels === null ? '…' : count}
              {hint && <span className="ml-1 font-normal">{hint}</span>}
            </span>
          </button>
        ))}
      </div>

      {tab === 'in_transit' ? (
        <InTransitParcelsList
          destination={destination}
          parcels={parcels}
          shipments={shipmentsProps.shipments}
          loading={parcelsLoading}
          error={parcelsError}
          onReload={onReloadParcels}
          globalSearch={search}
          onOpenShipment={onOpenShipment}
          canEdit={Boolean(shipmentsProps.canEdit)}
          isSupplyChain={isSupplyChain}
        />
      ) : tab === 'shipments' ? (
        <ShipmentsView {...(shipmentsProps as any)} modeFilter={mode} />
      ) : (
        <ParcelsBoardView
          destination={destination}
          parcels={parcels}
          invoicesWithoutParcel={parcelsOverview?.invoices_without_parcel ?? []}
          settings={settings}
          loading={parcelsLoading}
          error={parcelsError}
          onReload={onReloadParcels}
          globalSearch={search}
          onOpenShipment={onOpenShipment}
          isSupplyChain={isSupplyChain}
        />
      )}
    </div>
  );
};
