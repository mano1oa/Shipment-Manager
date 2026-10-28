import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Loader2, Package, X } from 'lucide-react';
import { CARRIER_LABELS, detectTrackingNumber } from '../lib/carrierDetection';
import { ReferenceSelect } from './ReferenceSelect';
import type { ReferenceCreateResult, ReferenceTransportMode } from './ReferenceSelect';
import {
  DELIVERY_TYPES,
  PARCEL_DESTINATIONS,
  PARCEL_DESTINATION_LABELS,
  validateParcelInput,
} from '../lib/parcelTracking';
import type { DeliveryType, ParcelDestination } from '../lib/parcelTracking';
import { parseNumberValue } from '../lib/digiInvoices';
import { DigiInvoice, Parcel, apiJson, createParcel, inputClass, updateParcel } from './digiApi';

interface CarrierOption {
  id: string;
  name: string;
  tracking_carrier_code: string | null;
}

interface Props {
  /** Invoices covered by the new parcel (one supplier). Ignored when editing. */
  invoices: DigiInvoice[];
  parcel?: Parcel | null;
  /** Supply Chain: may add a carrier to the Settings list from the form. */
  canCreateCarrier: boolean;
  /** Destination proposed for a new parcel (Orly unless opened from the sea tracking). */
  defaultDestination?: ParcelDestination;
  onClose: () => void;
  /** existed: the tracking number already belonged to a parcel, now linked to these invoices. */
  onSaved: (parcel: Parcel, existed: boolean) => void;
}

export const ParcelFormModal: React.FC<Props> = ({
  invoices,
  parcel,
  canCreateCarrier,
  defaultDestination = 'ORLY',
  onClose,
  onSaved,
}) => {
  const [trackingNumber, setTrackingNumber] = useState(parcel?.tracking_number ?? '');
  // '' = from the tracking number format (carrier linked to the detected connector)
  const [carrierName, setCarrierName] = useState(parcel?.carrier_name ?? '');
  const [carriers, setCarriers] = useState<CarrierOption[]>([]);
  const [carriersLoading, setCarriersLoading] = useState(true);
  const [carriersError, setCarriersError] = useState<string | null>(null);
  const [expected, setExpected] = useState(parcel?.expected_delivery ?? '');
  const [notes, setNotes] = useState(parcel?.notes ?? '');
  const [destination, setDestination] = useState<ParcelDestination>(parcel?.destination ?? defaultDestination);
  const [deliveryType, setDeliveryType] = useState<DeliveryType | ''>(parcel?.delivery_type ?? '');
  const [packingInfo, setPackingInfo] = useState(parcel?.packing_info ?? '');
  const [volume, setVolume] = useState(parcel?.volume_m3 != null ? String(parcel.volume_m3).replace('.', ',') : '');
  const [description, setDescription] = useState(parcel?.description ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Carriers of Paramètres › Transporteurs (all transport modes: supplier → Orly couriers)
  useEffect(() => {
    apiJson<{ carriers: CarrierOption[] }>('/api/reference/carriers')
      .then((d) => setCarriers(d.carriers))
      .catch((err) => setCarriersError(err.message))
      .finally(() => setCarriersLoading(false));
  }, []);

  const handleCreateCarrier = async (name: string, mode?: ReferenceTransportMode): Promise<ReferenceCreateResult> => {
    try {
      const { carrier } = await apiJson<{ carrier: CarrierOption }>('/api/reference/carriers', {
        method: 'POST',
        body: JSON.stringify({ name, transport_mode: mode }),
      });
      setCarriers((prev) => [...prev, carrier].sort((a, b) => a.name.localeCompare(b.name, 'fr')));
      setCarrierName(carrier.name);
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  };

  const detected = useMemo(() => (trackingNumber.trim() ? detectTrackingNumber(trackingNumber) : null), [trackingNumber]);
  // Carrier of the list linked to the connector recognised from the number
  const autoCarrier = detected ? carriers.find((c) => c.tracking_carrier_code === detected.carrier)?.name ?? null : null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const parsedVolume = parseNumberValue(volume);
    if (parsedVolume === undefined) {
      setError('Volume illisible.');
      return;
    }
    const sea = destination === 'ROUEN';
    const { value, errors } = validateParcelInput({
      tracking_number: trackingNumber,
      carrier_name: carrierName || null,
      expected_delivery: expected || null,
      notes,
      destination,
      delivery_type: sea ? deliveryType || null : null,
      packing_info: sea ? packingInfo : null,
      volume_m3: sea ? parsedVolume : null,
      description: sea ? description : null,
    });
    if (!value) {
      setError(errors.join(' '));
      return;
    }
    setSaving(true);
    try {
      if (parcel) {
        onSaved(await updateParcel(parcel.id, value), false);
      } else {
        const r = await createParcel(
          value,
          invoices.map((i) => i.id)
        );
        onSaved(r.parcel, r.existed);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const label = 'font-semibold text-slate-700 dark:text-slate-300';
  const supplier = parcel?.supplier_name || invoices[0]?.supplier_display || '—';
  const refs = (parcel ? parcel.invoices : invoices).map((i) => i.ref || '—').join(', ');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-900/60 p-4 backdrop-blur-xs">
      <form
        onSubmit={handleSubmit}
        className="my-8 w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-6 text-xs shadow-2xl dark:border-slate-800 dark:bg-slate-900"
      >
        <div className="flex items-center justify-between border-b border-slate-100 pb-4 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#643288] text-white shadow-sm">
              <Package className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-extrabold text-slate-900 dark:text-white">
                {parcel ? 'Modifier le colis' : 'Ajouter un colis'}
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {supplier} · facture(s) {refs}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {error && (
          <div className="mt-4 flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 font-semibold text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <span className={label}>Livré par le fournisseur à</span>
            <div className="mt-1 flex gap-2">
              {PARCEL_DESTINATIONS.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDestination(d)}
                  className={`flex-1 rounded-xl border px-3 py-2 font-bold transition ${
                    destination === d
                      ? 'border-[#643288] bg-purple-50 text-[#643288] dark:bg-purple-950/40 dark:text-purple-200'
                      : 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800'
                  }`}
                >
                  {PARCEL_DESTINATION_LABELS[d]}
                </button>
              ))}
            </div>
          </div>
          <label className="sm:col-span-2">
            <span className={label}>N° de suivi</span>
            <input
              value={trackingNumber}
              onChange={(e) => setTrackingNumber(e.target.value)}
              placeholder="Laisser vide s'il n'est pas connu"
              className={`${inputClass} font-mono`}
              autoFocus
            />
            {detected && (
              <span className="mt-1 block text-[11px] text-slate-500">
                {detected.number ? (
                  <>
                    Lu : <span className="font-mono">{detected.number}</span> · format{' '}
                    {detected.carrier === 'UNKNOWN' ? 'non reconnu' : CARRIER_LABELS[detected.carrier]}
                  </>
                ) : (
                  'Ce texte ne ressemble pas à un n° de suivi.'
                )}
              </span>
            )}
          </label>
          <div>
            <ReferenceSelect
              label="Transporteur"
              entityLabel="transporteur"
              options={carriers}
              value={carrierName}
              onChange={setCarrierName}
              onCreate={canCreateCarrier ? handleCreateCarrier : undefined}
              withModeChoice
              loading={carriersLoading}
              loadError={carriersError}
              emptyOptionLabel="Selon le n° de suivi"
              emptyHint={
                canCreateCarrier
                  ? 'Aucun transporteur : ajoutez-le ici ou dans Paramètres › Transporteurs.'
                  : 'Aucun transporteur : demandez à la Supply Chain de l’ajouter dans Paramètres.'
              }
            />
            {!carrierName && autoCarrier && (
              <span className="mt-1 block text-[11px] text-slate-500">Reconnu : {autoCarrier}</span>
            )}
          </div>
          <label>
            <span className={label}>Livraison prévue à {destination === 'ROUEN' ? 'Rouen' : 'Orly'}</span>
            <input type="date" value={expected} onChange={(e) => setExpected(e.target.value)} className={inputClass} />
          </label>
          {destination === 'ROUEN' && (
            <>
              <label>
                <span className={label}>Type de livraison</span>
                <select
                  value={deliveryType}
                  onChange={(e) => setDeliveryType(e.target.value as DeliveryType | '')}
                  className={inputClass}
                >
                  <option value="">—</option>
                  {DELIVERY_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className={label}>Volume estimé (m³)</span>
                <input inputMode="decimal" value={volume} onChange={(e) => setVolume(e.target.value)} className={inputClass} />
              </label>
              <label className="sm:col-span-2">
                <span className={label}>Colisage (nb de colis, dimensions, poids)</span>
                <input value={packingInfo} onChange={(e) => setPackingInfo(e.target.value)} className={inputClass} />
              </label>
              <label className="sm:col-span-2">
                <span className={label}>Description</span>
                <input value={description} onChange={(e) => setDescription(e.target.value)} className={inputClass} />
              </label>
            </>
          )}
          <label className="sm:col-span-2">
            <span className={label}>Remarque</span>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={inputClass} />
          </label>
        </div>

        <p className="mt-3 text-[11px] text-slate-500 dark:text-slate-400">
          Sans date de livraison prévue, l'alerte de perte part de la date de facture. Un n° de suivi déjà connu rattache
          ces factures au colis existant (un colis peut couvrir plusieurs factures du même fournisseur).
        </p>

        <div className="mt-5 flex justify-end gap-2 border-t border-slate-100 pt-4 dark:border-slate-800">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-200 px-4 py-2 font-bold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Annuler
          </button>
          <button
            type="submit"
            disabled={saving}
            className="flex items-center gap-2 rounded-xl bg-[#643288] px-4 py-2 font-bold text-white hover:bg-[#522870] disabled:opacity-50"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} Enregistrer
          </button>
        </div>
      </form>
    </div>
  );
};
