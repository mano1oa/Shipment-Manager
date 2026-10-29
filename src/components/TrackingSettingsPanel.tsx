import React, { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2, Package } from 'lucide-react';
import { parseNumberValue } from '../lib/digiInvoices';
import { SETTING_LIMITS } from '../lib/parcelTracking';
import type { TrackingSettings } from '../lib/parcelTracking';
import { SettingsCard } from './SettingsSystemPanels';
import { fetchTrackingSettings, inputClass, saveTrackingSettings } from './digiApi';

type DelayKey = keyof typeof SETTING_LIMITS;

const DELAYS: { key: DelayKey; label: string; hint: string }[] = [
  {
    key: 'triage_alert_days',
    label: 'Facture DIGI non triée',
    hint: 'Jours après son arrivée avant le badge « Tri en retard ».',
  },
  {
    key: 'parcel_loss_days_after_eta',
    label: 'Colis non confirmé à Orly',
    hint: 'Jours après la livraison prévue par le transporteur avant l’alerte de perte.',
  },
  {
    key: 'parcel_loss_days_without_eta',
    label: 'Colis sans livraison prévue',
    hint: 'Jours après la date de facture avant l’alerte de perte.',
  },
];

/** Paramètres › Intégrations: USD rate and alert delays of the parcel tracking (Supply Chain). */
export const TrackingSettingsPanel: React.FC = () => {
  const [settings, setSettings] = useState<TrackingSettings | null>(null);
  const [rate, setRate] = useState('');
  const [delays, setDelays] = useState<Record<DelayKey, string>>({
    triage_alert_days: '',
    parcel_loss_days_after_eta: '',
    parcel_loss_days_without_eta: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const fill = (s: TrackingSettings) => {
    setSettings(s);
    setRate(s.usd_eur_rate === null ? '' : String(s.usd_eur_rate).replace('.', ','));
    setDelays({
      triage_alert_days: String(s.triage_alert_days),
      parcel_loss_days_after_eta: String(s.parcel_loss_days_after_eta),
      parcel_loss_days_without_eta: String(s.parcel_loss_days_without_eta),
    });
  };

  useEffect(() => {
    fetchTrackingSettings()
      .then(fill)
      .catch((err) => setError(err.message));
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaved(false);
    const parsedRate = parseNumberValue(rate);
    if (parsedRate === undefined) {
      setError('Taux USD → EUR illisible.');
      return;
    }
    const update: Partial<TrackingSettings> = { usd_eur_rate: parsedRate };
    for (const { key } of DELAYS) update[key] = Number(delays[key]);
    setSaving(true);
    try {
      fill(await saveTrackingSettings(update));
      setSaved(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const label = 'text-xs font-semibold text-slate-700 dark:text-slate-300';

  return (
    <SettingsCard
      icon={Package}
      title="Suivi des colis"
      description="Conversion des factures hors DIGI en USD et délais des alertes du suivi fournisseur → Orly."
    >
      {settings === null && !error ? (
        <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
      ) : (
        <form onSubmit={handleSave} className="space-y-4 text-xs">
          {error && (
            <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 font-semibold text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300">
              <AlertCircle className="h-4 w-4 shrink-0" /> {error}
            </div>
          )}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <label>
              <span className={label}>Taux USD → EUR (1 USD = … EUR)</span>
              <input
                inputMode="decimal"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                placeholder="Non défini"
                className={inputClass}
              />
              <span className="mt-1 block text-[11px] text-slate-500">
                Tant qu'il n'est pas défini, les montants en USD ne comptent pas dans la valeur des expéditions.
              </span>
            </label>
            {DELAYS.map(({ key, label: text, hint }) => (
              <label key={key}>
                <span className={label}>{text} (jours)</span>
                <input
                  type="number"
                  min={SETTING_LIMITS[key][0]}
                  max={SETTING_LIMITS[key][1]}
                  value={delays[key]}
                  onChange={(e) => setDelays((prev) => ({ ...prev, [key]: e.target.value }))}
                  className={inputClass}
                  required
                />
                <span className="mt-1 block text-[11px] text-slate-500">{hint}</span>
              </label>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-2 rounded-xl bg-[#623387] px-4 py-2 text-xs font-bold text-white hover:bg-[#522870] disabled:opacity-50"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />} Enregistrer
            </button>
            {saved && (
              <span className="flex items-center gap-1 font-semibold text-emerald-600">
                <CheckCircle2 className="h-4 w-4" /> Enregistré
              </span>
            )}
          </div>
        </form>
      )}
    </SettingsCard>
  );
};
