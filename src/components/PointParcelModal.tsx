import React, { useEffect, useState } from 'react';
import { Link2, Loader2, Package, X } from 'lucide-react';
import { ReferenceSelect } from './ReferenceSelect';
import { Parcel, apiJson, formatDate, inputClass } from './digiApi';

interface CarrierOption {
  id: string;
  name: string;
  tracking_carrier_code: string | null;
}

export interface PointParcelFields {
  tracking_number: string | null;
  bl_number: string | null;
  carrier_name: string | null;
}

interface Props {
  /** Number read on the label ('' when unreadable). */
  readNumber: string;
  /** Parcel announced (to complete), or null for a new parcel of `invoiceRefs`. */
  parcel: Parcel | null;
  supplier: string;
  invoiceRefs: string[];
  pointDate: string;
  saving: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (fields: PointParcelFields) => void;
}

type ReadAs = 'tracking' | 'bl';

/**
 * Point, label not found: the number read is the tracking number or the BL
 * of the parcel. Both can be filled, with the carrier, before matching the
 * photo. A value already saved on the parcel is shown, not changed.
 */
export const PointParcelModal: React.FC<Props> = ({
  readNumber,
  parcel,
  supplier,
  invoiceRefs,
  pointDate,
  saving,
  error,
  onCancel,
  onSubmit,
}) => {
  const savedTracking = parcel?.tracking_number || null;
  const savedBl = parcel?.numbers.find((n) => n.kind === 'supplier')?.number ?? null;
  const savedCarrier = parcel?.carrier_name || null;
  // A parcel that already has its number: the label shows another one, its BL
  const [readAs, setReadAs] = useState<ReadAs>(savedTracking ? 'bl' : 'tracking');
  const [trackingNumber, setTrackingNumber] = useState(!savedTracking && readNumber ? readNumber : '');
  const [blNumber, setBlNumber] = useState(savedTracking && !savedBl ? readNumber : '');
  const [carrierName, setCarrierName] = useState('');
  const [carriers, setCarriers] = useState<CarrierOption[]>([]);
  const [carriersLoading, setCarriersLoading] = useState(true);
  const [carriersError, setCarriersError] = useState<string | null>(null);

  useEffect(() => {
    apiJson<{ carriers: CarrierOption[] }>('/api/reference/carriers')
      .then((d) => setCarriers(d.carriers))
      .catch((err) => setCarriersError(err.message))
      .finally(() => setCarriersLoading(false));
  }, []);

  /** The number read moves to the field chosen. */
  const chooseReadAs = (next: ReadAs) => {
    setReadAs(next);
    if (!readNumber) return;
    if (next === 'tracking') {
      setTrackingNumber(readNumber);
      if (blNumber === readNumber) setBlNumber('');
    } else {
      setBlNumber(readNumber);
      if (trackingNumber === readNumber) setTrackingNumber('');
    }
  };

  const same = Boolean(trackingNumber.trim()) && trackingNumber.trim().toUpperCase() === blNumber.trim().toUpperCase();
  const label = 'font-semibold text-slate-700 dark:text-slate-300';
  const readOnly = 'mt-1 rounded-xl bg-slate-50 px-3 py-2 font-mono font-semibold dark:bg-slate-800';
  const choice = (active: boolean) =>
    `flex-1 rounded-xl border px-3 py-2 font-bold transition disabled:opacity-40 ${
      active
        ? 'border-[#623387] bg-[#F8EEFF] text-[#623387] dark:bg-purple-950/40 dark:text-[#D7BCE8]'
        : 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800'
    }`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-900/60 p-4 backdrop-blur-xs">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (same) return;
          onSubmit({
            tracking_number: savedTracking ? null : trackingNumber.trim() || null,
            bl_number: savedBl ? null : blNumber.trim() || null,
            carrier_name: savedCarrier ? null : carrierName || null,
          });
        }}
        className="my-8 w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-6 text-xs shadow-2xl dark:border-slate-800 dark:bg-slate-900"
      >
        <div className="flex items-center justify-between border-b border-slate-100 pb-4 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#623387] text-white shadow-sm">
              <Package className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-extrabold text-slate-900 dark:text-white">
                {parcel ? 'Compléter le colis attendu' : 'Créer le colis'}
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {supplier} · facture(s) {invoiceRefs.join(', ') || '—'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-xl p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {error && (
          <p className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 font-semibold text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300">
            {error}
          </p>
        )}

        <div className="mt-4 space-y-3">
          {readNumber && (
            <div>
              <span className={label}>
                Le n° lu sur l'étiquette <span className="font-mono">{readNumber}</span> est :
              </span>
              <div className="mt-1 flex gap-2">
                <button
                  type="button"
                  onClick={() => chooseReadAs('tracking')}
                  disabled={Boolean(savedTracking)}
                  title={savedTracking ? `Ce colis a déjà le n° de suivi ${savedTracking}` : undefined}
                  className={choice(readAs === 'tracking')}
                >
                  Le n° de suivi
                </button>
                <button
                  type="button"
                  onClick={() => chooseReadAs('bl')}
                  disabled={Boolean(savedBl)}
                  title={savedBl ? `Ce colis a déjà le BL ${savedBl}` : undefined}
                  className={choice(readAs === 'bl')}
                >
                  Le BL
                </button>
              </div>
            </div>
          )}

          <label className="block">
            <span className={label}>N° de suivi</span>
            {savedTracking ? (
              <div className={readOnly}>{savedTracking}</div>
            ) : (
              <input
                value={trackingNumber}
                onChange={(e) => setTrackingNumber(e.target.value)}
                placeholder="Vide s'il n'est pas connu"
                className={`${inputClass} font-mono`}
              />
            )}
          </label>
          <label className="block">
            <span className={label}>BL (bon de livraison)</span>
            {savedBl ? (
              <div className={readOnly}>{savedBl}</div>
            ) : (
              <input
                value={blNumber}
                onChange={(e) => setBlNumber(e.target.value)}
                placeholder="Facultatif"
                className={`${inputClass} font-mono`}
              />
            )}
          </label>
          {same && <p className="text-[11px] font-semibold text-rose-600">Le BL est identique au n° de suivi : videz l'un des deux.</p>}
          {savedCarrier ? (
            <div>
              <span className={label}>Transporteur</span>
              <div className="mt-1 rounded-xl bg-slate-50 px-3 py-2 font-semibold dark:bg-slate-800">{savedCarrier}</div>
            </div>
          ) : (
            <ReferenceSelect
              label="Transporteur"
              entityLabel="transporteur"
              options={carriers}
              value={carrierName}
              onChange={setCarrierName}
              loading={carriersLoading}
              loadError={carriersError}
              emptyOptionLabel="Selon le n° de suivi"
              emptyHint="Aucun transporteur : ajoutez-le dans Paramètres › Transporteurs."
            />
          )}
        </div>

        <div className="mt-5 flex justify-end gap-2 border-t border-slate-100 pt-4 dark:border-slate-800">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-xl border border-slate-200 px-4 py-2 font-bold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Annuler
          </button>
          <button
            type="submit"
            disabled={saving || same}
            className="flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
            {parcel ? 'Rattacher' : 'Créer et rattacher'} — reçu le {formatDate(pointDate)}
          </button>
        </div>
      </form>
    </div>
  );
};
