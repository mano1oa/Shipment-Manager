import React, { useState } from 'react';
import {
  Ship,
  Search,
  MapPin,
  Clock,
  Navigation,
  Globe,
  Anchor,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Layers,
  ArrowRight,
  RefreshCw,
} from 'lucide-react';
import { SeaTrackingResult } from '../types';

interface SeaTrackingSearchProps {
  onSelectShipmentByContainer?: (query: string) => void;
}

export const SeaTrackingSearch: React.FC<SeaTrackingSearchProps> = () => {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SeaTrackingResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSearch = async (searchQuery: string) => {
    const q = searchQuery.trim();
    if (!q) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/sea-tracking/${encodeURIComponent(q)}`);
      const data = await res.json();
      if (data.success) {
        setResult(data);
      } else {
        setError('Aucune information trouvée pour ce numéro de conteneur ou Sea Waybill (SWB).');
      }
    } catch (err) {
      setError('Erreur lors de l\'interrogation des services de tracking maritime.');
    } finally {
      setLoading(false);
    }
  };

  const quickSamples = [
    { label: 'MSCU8839201 (MSC)', value: 'MSCU8839201' },
    { label: 'MAEU9910293 (Maersk)', value: 'MAEU9910293' },
    { label: 'CMAU7718290 (CMA CGM)', value: 'CMAU7718290' },
    { label: 'SWB-MSC-99382104 (B/L)', value: 'SWB-MSC-99382104' },
  ];

  return (
    <div className="rounded-2xl border border-indigo-200 bg-white p-6 shadow-md dark:border-indigo-900/60 dark:bg-slate-800 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100 dark:border-slate-700">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-600 to-purple-800 text-white shadow-md">
            <Ship className="h-6 w-6" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
              Moteur de Recherche & Tracking Maritime International
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Recherche directe par numéro de Conteneur (ex: MSCU...) ou Sea Waybill (SWB / B/L)
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
            <Globe className="h-3.5 w-3.5 text-emerald-600" /> Connecteurs Officiels Prêts
          </span>
        </div>
      </div>

      {/* Search Input Bar */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSearch(query);
        }}
        className="flex flex-col sm:flex-row items-center gap-3"
      >
        <div className="relative flex-1 w-full">
          <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Entrez un N° de Conteneur (ex: MSCU8839201) ou N° Sea Waybill (SWB)..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full rounded-xl border border-slate-300 bg-slate-50 py-2.5 pl-10 pr-4 text-sm font-mono text-slate-800 placeholder-slate-400 focus:border-indigo-600 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-600/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder-slate-500"
          />
        </div>

        <button
          type="submit"
          disabled={loading || !query.trim()}
          className="w-full sm:w-auto flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-700 px-5 py-2.5 text-sm font-bold text-white shadow-md transition hover:from-indigo-500 hover:to-purple-600 active:scale-95 disabled:opacity-50"
        >
          {loading ? (
            <>
              <RefreshCw className="h-4 w-4 animate-spin" /> Recherche...
            </>
          ) : (
            <>
              <Search className="h-4 w-4" /> Tracker le Conteneur
            </>
          )}
        </button>
      </form>

      {/* Quick sample chips */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-semibold text-slate-500 dark:text-slate-400 flex items-center gap-1">
          Exemples rapides :
        </span>
        {quickSamples.map((sample) => (
          <button
            key={sample.value}
            type="button"
            onClick={() => {
              setQuery(sample.value);
              handleSearch(sample.value);
            }}
            className="rounded-lg border border-slate-200 bg-slate-100/80 px-2.5 py-1 font-mono text-[11px] font-semibold text-indigo-700 hover:bg-indigo-50 dark:border-slate-700 dark:bg-slate-900 dark:text-indigo-300"
          >
            {sample.label}
          </button>
        ))}
      </div>

      {/* Error state */}
      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs font-medium text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-300 flex items-center gap-2">
          <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
          <span>{error}</span>
        </div>
      )}

      {/* Tracking Result View */}
      {result && (
        <div className="rounded-2xl border border-slate-200 bg-slate-50/50 p-5 dark:border-slate-700 dark:bg-slate-900/50 space-y-6">
          {/* Result Header Badges */}
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-200 dark:border-slate-700">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-base font-extrabold text-slate-900 dark:text-white font-mono">
                  {result.container_no || result.search_query}
                </span>
                <span className="rounded-full bg-indigo-100 px-2.5 py-0.5 text-xs font-bold text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300">
                  {result.carrier}
                </span>
                <span className="rounded-full bg-slate-200 px-2.5 py-0.5 text-xs font-mono font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                  SWB: {result.swb_no || 'Inclus'}
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                Navire: <strong className="text-slate-700 dark:text-slate-200">{result.vessel_name}</strong> | Voyage: <strong className="text-slate-700 dark:text-slate-200">{result.voyage_no}</strong>
              </p>
            </div>

            <div className="text-right">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 text-xs font-extrabold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                <Navigation className="h-3.5 w-3.5" /> {result.status}
              </span>
              <div className="text-[10px] text-slate-400 font-mono mt-1">
                Dernière maj: {result.last_update}
              </div>
            </div>
          </div>

          {/* Quick Route Info */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs">
            <div className="bg-white dark:bg-slate-800 p-3 rounded-xl border border-slate-200 dark:border-slate-700">
              <span className="text-[10px] font-bold text-slate-400 uppercase">Port de Départ (ETD)</span>
              <div className="font-bold text-slate-800 dark:text-slate-100 mt-1">{result.port_of_loading}</div>
              <div className="font-mono text-indigo-600 dark:text-indigo-400 text-[11px]">{result.etd || '—'}</div>
            </div>

            <div className="bg-white dark:bg-slate-800 p-3 rounded-xl border border-slate-200 dark:border-slate-700">
              <span className="text-[10px] font-bold text-slate-400 uppercase">Port de Destination (ETA)</span>
              <div className="font-bold text-slate-800 dark:text-slate-100 mt-1">{result.port_of_discharge}</div>
              <div className="font-mono text-indigo-600 dark:text-indigo-400 text-[11px]">{result.eta || '—'}</div>
            </div>

            <div className="bg-white dark:bg-slate-800 p-3 rounded-xl border border-slate-200 dark:border-slate-700">
              <span className="text-[10px] font-bold text-slate-400 uppercase">Escales & Transbordements</span>
              <div className="font-medium text-slate-800 dark:text-slate-200 mt-1">
                {result.transshipment_ports?.join(' • ') || 'Ligne Directe'}
              </div>
            </div>

            <div className="bg-white dark:bg-slate-800 p-3 rounded-xl border border-indigo-200 dark:border-indigo-800">
              <span className="text-[10px] font-bold text-indigo-600 dark:text-indigo-300 uppercase">Lead Time Estimé</span>
              <div className="text-sm font-extrabold font-mono text-indigo-900 dark:text-indigo-100 mt-1">
                {result.estimated_lead_time_days ? `${result.estimated_lead_time_days} jours` : '—'}
              </div>
              <div className="text-[10px] text-slate-400">Durée totale de mer</div>
            </div>
          </div>

          {/* Milestone Events Timeline */}
          <div className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700">
            <h4 className="text-xs font-extrabold uppercase tracking-wider text-slate-800 dark:text-slate-200 mb-3 flex items-center gap-1.5">
              <Anchor className="h-4 w-4 text-indigo-600" /> Événements & Jalons Maritimes Majeurs
            </h4>

            <div className="space-y-3 relative pl-4 before:absolute before:left-1.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-indigo-100 dark:before:bg-slate-700">
              {result.events.map((evt, idx) => (
                <div key={idx} className="relative flex items-start gap-3 text-xs">
                  <div className="absolute -left-4 top-1 h-3 w-3 rounded-full bg-indigo-600 ring-4 ring-white dark:ring-slate-800" />
                  <div className="flex-1 rounded-lg bg-slate-50 dark:bg-slate-900 p-2.5 border border-slate-100 dark:border-slate-800">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-900 dark:text-slate-100">{evt.status}</span>
                      <span className="font-mono text-[10px] text-slate-400">{evt.date}</span>
                    </div>
                    <div className="text-[11px] text-indigo-600 dark:text-indigo-400 mt-0.5 flex items-center gap-1">
                      <MapPin className="h-3 w-3" /> {evt.location}
                    </div>
                    <div className="text-[11px] text-slate-500 mt-1">{evt.details}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Official Shipping Line Web Portal Links */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 text-xs border-t border-slate-200 dark:border-slate-700">
            <span className="text-slate-500 dark:text-slate-400 font-medium">
              Extensibilité API : Accès direct aux portails officiels de suivi d'armateurs
            </span>
            <div className="flex gap-2">
              <a
                href="https://www.msc.com/en/track-a-shipment"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-[11px] font-bold text-indigo-600 hover:underline dark:text-indigo-400"
              >
                MSC Tracking <ExternalLink className="h-3 w-3" />
              </a>
              <a
                href="https://www.maersk.com/tracking/"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-[11px] font-bold text-indigo-600 hover:underline dark:text-indigo-400"
              >
                Maersk Tracking <ExternalLink className="h-3 w-3" />
              </a>
              <a
                href="https://www.cma-cgm.com/ebusiness/tracking"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-[11px] font-bold text-indigo-600 hover:underline dark:text-indigo-400"
              >
                CMA CGM Tracking <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
