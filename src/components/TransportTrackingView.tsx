import React, { useMemo, useState } from 'react';
import { Package, Plane, Ship } from 'lucide-react';
import type { TrackingSettings } from '../lib/parcelTracking';
import { ParcelsOverview } from './digiApi';
import { ParcelsBoardView, parcelMatches } from './ParcelsBoardView';
import { ShipmentsView, matchesSearch } from './ShipmentsView';

type Tab = 'shipments' | 'parcels';

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
 * Suivi Aérien / Maritime: two tabs, the parcels on their way from the
 * suppliers (to Orly or Rouen) and the shipments to Madagascar. The top bar
 * search applies to both; each tab shows how many results it holds.
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
  const [tab, setTab] = useState<Tab>('parcels');
  const parcels = parcelsOverview?.parcels ?? null;

  const search = shipmentsProps.globalSearch || '';
  const shipmentCount = useMemo(
    () => shipmentsProps.shipments.filter((s) => s.mode === mode && matchesSearch(s, search)).length,
    [shipmentsProps.shipments, mode, search]
  );
  const parcelCount = useMemo(
    () => (parcels || []).filter((p) => p.destination === destination && p.status === 'to_receive' && parcelMatches(p, search)).length,
    [parcels, destination, search]
  );

  // In the order of the journey: supplier → hub, then hub → Madagascar
  const tabs: { key: Tab; label: string; icon: React.ElementType; count: number; hint: string }[] = [
    {
      key: 'parcels',
      label: `Colis vers ${hub}`,
      icon: Package,
      count: parcelCount,
      hint: search ? 'à recevoir trouvé(s)' : 'à recevoir',
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
      <div className="flex w-fit gap-1 rounded-xl bg-slate-200/60 p-1 text-xs font-semibold dark:bg-slate-800">
        {tabs.map(({ key, label, icon: Icon, count, hint }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 transition ${
              tab === key
                ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white'
                : 'text-slate-500 hover:text-slate-800 dark:text-slate-400'
            }`}
          >
            <Icon className="h-3.5 w-3.5" /> {label}
            <span className={`ml-1 ${search && count > 0 && tab !== key ? 'font-bold text-[#643288]' : 'text-slate-400'}`}>
              {key === 'parcels' && parcels === null ? '…' : count}
              {hint && <span className="ml-1 font-normal">{hint}</span>}
            </span>
          </button>
        ))}
      </div>

      {tab === 'shipments' ? (
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
