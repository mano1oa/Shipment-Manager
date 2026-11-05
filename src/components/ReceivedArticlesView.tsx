import React, { useEffect, useMemo, useState } from 'react';
import { ClipboardCheck, Loader2, Plane, RefreshCw, Search, Ship } from 'lucide-react';
import { formatDate, formatQuantity } from './digiApi';
import { ReceivedArticle, articleKey, fetchReceivedArticles, receivedGap } from './shipmentApi';
import { ReceivedQuantityInput } from './ReceivedQuantityInput';

type StateFilter = 'all' | 'to_check' | 'gaps' | 'ok';

interface Props {
  /** Sourcing and Supply Chain type the received quantities; Direction reads. */
  canEdit: boolean;
  onOpenShipment: (shipmentId: string) => void;
}

const STATE_FILTERS: { id: StateFilter; label: string }[] = [
  { id: 'all', label: 'Tous' },
  { id: 'to_check', label: 'À contrôler' },
  { id: 'gaps', label: 'Écarts' },
  { id: 'ok', label: 'Conformes' },
];

const matchesState = (a: ReceivedArticle, state: StateFilter) => {
  const gap = receivedGap(a);
  if (state === 'to_check') return gap === null;
  if (state === 'gaps') return gap !== null && gap !== 0;
  if (state === 'ok') return gap === 0;
  return true;
};

const shipmentName = (a: ReceivedArticle) => (a.ref_fa_digi_nxt ? `FA ${a.ref_fa_digi_nxt}` : a.shipment_id);

/**
 * Arrival check in Madagascar, every confirmed shipment: the articles of
 * their invoices, with the quantity received typed by Sourcing / Supply Chain.
 */
export const ReceivedArticlesView: React.FC<Props> = ({ canEdit, onOpenShipment }) => {
  const [articles, setArticles] = useState<ReceivedArticle[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [shipmentFilter, setShipmentFilter] = useState('all');
  const [state, setState] = useState<StateFilter>('all');

  const load = () => {
    setLoading(true);
    setError(null);
    fetchReceivedArticles()
      .then(setArticles)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const shipmentOptions = useMemo(() => {
    const seen = new Map<string, string>();
    (articles || []).forEach((a) => seen.set(a.shipment_id, shipmentName(a)));
    return Array.from(seen.entries());
  }, [articles]);

  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const byShipment = new Map<string, ReceivedArticle[]>();
    (articles || [])
      .filter(
        (a) =>
          (shipmentFilter === 'all' || a.shipment_id === shipmentFilter) &&
          matchesState(a, state) &&
          (!q ||
            [a.name, a.supplier, a.invoice_ref, a.ref_fa_digi_nxt].some((v) => v && v.toLowerCase().includes(q)))
      )
      .forEach((a) => byShipment.set(a.shipment_id, [...(byShipment.get(a.shipment_id) ?? []), a]));
    return Array.from(byShipment.values());
  }, [articles, search, shipmentFilter, state]);

  const counts = useMemo(() => {
    const all = articles || [];
    return {
      all: all.length,
      to_check: all.filter((a) => matchesState(a, 'to_check')).length,
      gaps: all.filter((a) => matchesState(a, 'gaps')).length,
      ok: all.filter((a) => matchesState(a, 'ok')).length,
    };
  }, [articles]);

  const update = (a: ReceivedArticle, quantity: number | null) =>
    setArticles((prev) =>
      (prev || []).map((x) => (articleKey(x) === articleKey(a) ? { ...x, quantity_received: quantity } : x))
    );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-extrabold text-slate-900 dark:text-white">
            <ClipboardCheck className="h-5 w-5 text-[#623387]" /> Articles reçus à Madagascar
          </h1>
          <p className="mt-1 text-xs text-slate-500">
            Articles des expéditions confirmées : saisissez la quantité reçue de chaque article à l'arrivée.
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Actualiser
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
        <div className="relative min-w-[14rem] flex-1">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Article, fournisseur, facture, Réf FA…"
            className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-2 text-xs focus:border-[#623387] focus:outline-none dark:border-slate-700 dark:bg-slate-950"
          />
        </div>
        <select
          value={shipmentFilter}
          onChange={(e) => setShipmentFilter(e.target.value)}
          className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-950"
        >
          <option value="all">Toutes les expéditions</option>
          {shipmentOptions.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
        <div className="flex rounded-lg border border-slate-200 p-0.5 dark:border-slate-700">
          {STATE_FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setState(f.id)}
              className={`rounded-md px-2.5 py-1 text-[11px] font-semibold ${
                state === f.id
                  ? 'bg-[#623387] text-white'
                  : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
              }`}
            >
              {f.label} ({counts[f.id]})
            </button>
          ))}
        </div>
      </div>

      {error && <p className="text-xs text-rose-600">{error}</p>}

      {articles === null ? (
        <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
      ) : groups.length === 0 ? (
        <p className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-xs text-slate-400 dark:border-slate-800 dark:bg-slate-900">
          {articles.length === 0
            ? 'Aucune expédition confirmée pour le moment.'
            : 'Aucun article ne correspond aux filtres.'}
        </p>
      ) : (
        groups.map((list) => {
          const first = list[0];
          const checked = list.filter((a) => a.quantity_received !== null).length;
          return (
            <div
              key={first.shipment_id}
              className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
            >
              <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2.5 text-xs dark:border-slate-800 dark:bg-slate-900/60">
                {first.shipment_mode === 'Sea' ? (
                  <Ship className="h-4 w-4 text-slate-400" />
                ) : (
                  <Plane className="h-4 w-4 text-slate-400" />
                )}
                <button
                  onClick={() => onOpenShipment(first.shipment_id)}
                  className="font-mono font-bold text-[#623387] hover:underline dark:text-[#B688FF]"
                >
                  {shipmentName(first)}
                </button>
                {first.orly_scan_date && (
                  <span className="text-slate-500">remise {first.shipment_mode === 'Sea' ? 'Rouen' : 'Orly'} le {formatDate(first.orly_scan_date)}</span>
                )}
                {first.shipment_global_status && <span className="text-slate-400">· {first.shipment_global_status}</span>}
                <span className="ml-auto font-semibold text-slate-500">
                  {checked}/{list.length} contrôlé(s)
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="text-[10px] uppercase tracking-wider text-slate-400">
                    <tr>
                      <th className="px-4 py-2">Article</th>
                      <th className="px-2 py-2">Fournisseur</th>
                      <th className="px-2 py-2">Facture</th>
                      <th className="w-16 px-2 py-2 text-right">Qté</th>
                      <th className="w-24 px-2 py-2 text-right">Qté reçue</th>
                      <th className="w-16 px-4 py-2 text-right">Écart</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {list.map((a) => {
                      const gap = receivedGap(a);
                      return (
                        <tr key={articleKey(a)} className="text-slate-700 dark:text-slate-200">
                          <td className="px-4 py-1.5">{a.name}</td>
                          <td className="px-2 py-1.5">{a.supplier || '—'}</td>
                          <td className="px-2 py-1.5 text-slate-500">{a.invoice_ref || '—'}</td>
                          <td className="px-2 py-1.5 text-right font-semibold">{formatQuantity(a.quantity)}</td>
                          <td className="px-2 py-1.5 text-right">
                            <ReceivedQuantityInput article={a} canEdit={canEdit} onSaved={(q) => update(a, q)} />
                          </td>
                          <td
                            className={`px-4 py-1.5 text-right font-semibold ${
                              gap === null ? 'text-slate-300' : gap === 0 ? 'text-emerald-600' : 'text-rose-600'
                            }`}
                          >
                            {gap === null ? '—' : gap > 0 ? `+${formatQuantity(gap)}` : formatQuantity(gap)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
};
