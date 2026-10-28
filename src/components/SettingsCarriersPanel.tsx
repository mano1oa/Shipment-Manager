import React, { FormEvent, useEffect, useMemo, useState } from 'react';
import { Truck, Plus, Pencil, Check, X, Loader2, RefreshCw } from 'lucide-react';
import { SettingsCard, TrackingAutomationPanel, TRACKING_CONNECTOR_CODES } from './SettingsSystemPanels';
import { CARRIER_LABELS, CarrierCode } from '../lib/carrierDetection';

type CarrierTransportMode = 'Air' | 'Sea' | 'BOTH';

type CarrierItem = {
  id: string;
  name: string;
  transport_mode: CarrierTransportMode;
  tracking_carrier_code: string | null;
  is_active: boolean;
};

const MODE_LABELS: Record<CarrierTransportMode, string> = {
  Air: 'Aérien',
  Sea: 'Maritime',
  BOTH: 'Aérien & Maritime',
};

const fieldClass =
  'rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-[#643288] focus:outline-none focus:ring-2 focus:ring-[#643288]/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white';

const connectorLabel = (code: string | null) => (code ? CARRIER_LABELS[code as CarrierCode] || code : null);

/**
 * Carriers offered in the shipment form (create, rename, change mode,
 * (de)activate, link to a tracking connector) and the connectors' state.
 */
export const SettingsCarriersPanel: React.FC = () => {
  const [carriers, setCarriers] = useState<CarrierItem[]>([]);
  const [automatedCarriers, setAutomatedCarriers] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [newName, setNewName] = useState('');
  const [newMode, setNewMode] = useState<CarrierTransportMode>('Air');
  const [creating, setCreating] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editMode, setEditMode] = useState<CarrierTransportMode>('Air');
  const [editConnector, setEditConnector] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);

  async function loadCarriers() {
    try {
      setLoading(true);
      setError('');
      const res = await fetch('/api/reference/carriers/all', { credentials: 'include' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || 'Impossible de charger les transporteurs');
      setCarriers(data.carriers || []);
    } catch (err: any) {
      setError(err?.message || 'Erreur de chargement');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadCarriers();
    fetch('/api/tracking/config', { credentials: 'include' })
      .then((res) => res.json())
      .then((data) => setAutomatedCarriers(Array.isArray(data?.automated_carriers) ? data.automated_carriers : []))
      .catch(() => setAutomatedCarriers(null));
  }, []);

  // Active carriers grouped by linked connector, for the connectors card
  const linkedCarriers = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const c of carriers) {
      if (!c.is_active || !c.tracking_carrier_code) continue;
      (map[c.tracking_carrier_code] ||= []).push(c.name);
    }
    return map;
  }, [carriers]);

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    try {
      setCreating(true);
      setError('');
      const res = await fetch('/api/reference/carriers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name: newName, transport_mode: newMode }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || 'Impossible de créer le transporteur');
      setNewName('');
      await loadCarriers();
    } catch (err: any) {
      setError(err?.message || 'Erreur lors de la création');
    } finally {
      setCreating(false);
    }
  }

  async function saveCarrier(carrier: CarrierItem, changes: Partial<CarrierItem>) {
    try {
      setSavingId(carrier.id);
      setError('');
      const res = await fetch(`/api/reference/carriers/${carrier.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: changes.name ?? carrier.name,
          transport_mode: changes.transport_mode ?? carrier.transport_mode,
          tracking_carrier_code:
            changes.tracking_carrier_code !== undefined ? changes.tracking_carrier_code : carrier.tracking_carrier_code,
          is_active: changes.is_active ?? carrier.is_active,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || 'Impossible de modifier le transporteur');
      setCarriers((prev) => prev.map((c) => (c.id === carrier.id ? data.carrier : c)));
      setEditingId(null);
    } catch (err: any) {
      setError(err?.message || 'Erreur lors de la modification');
    } finally {
      setSavingId(null);
    }
  }

  const startEdit = (carrier: CarrierItem) => {
    setEditingId(carrier.id);
    setEditName(carrier.name);
    setEditMode(carrier.transport_mode);
    setEditConnector(carrier.tracking_carrier_code || '');
  };

  return (
    <>
      <SettingsCard
        icon={Truck}
        title="Transporteurs"
        description="Liste proposée dans le formulaire d'expédition (création réservée à Supply Chain). Un transporteur désactivé n'est plus proposé ; les expéditions existantes gardent leur nom."
        actions={
          <button
            onClick={loadCarriers}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Actualiser
          </button>
        }
      >
        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </div>
        )}

        <form onSubmit={handleCreate} className="mb-5 grid gap-3 rounded-xl bg-slate-50 p-3 dark:bg-slate-800/60 sm:grid-cols-[1fr_200px_auto]">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            required
            maxLength={100}
            placeholder="Nom du nouveau transporteur"
            className={fieldClass}
          />
          <select value={newMode} onChange={(e) => setNewMode(e.target.value as CarrierTransportMode)} className={fieldClass}>
            {(Object.keys(MODE_LABELS) as CarrierTransportMode[]).map((m) => (
              <option key={m} value={m}>
                {MODE_LABELS[m]}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={creating || !newName.trim()}
            className="flex items-center justify-center gap-1.5 rounded-lg bg-[#643288] px-4 py-2 text-xs font-bold text-white hover:bg-[#522870] disabled:opacity-50"
          >
            {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            Ajouter
          </button>
        </form>

        {loading && carriers.length === 0 ? (
          <p className="text-xs text-slate-500">Chargement...</p>
        ) : carriers.length === 0 ? (
          <p className="text-xs text-slate-500">Aucun transporteur enregistré.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-[10px] uppercase text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                <tr>
                  <th className="px-3 py-2 font-semibold">Transporteur</th>
                  <th className="px-3 py-2 font-semibold">Mode</th>
                  <th className="px-3 py-2 font-semibold">Connecteur de suivi</th>
                  <th className="px-3 py-2 font-semibold">Statut</th>
                  <th className="px-3 py-2 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {carriers.map((c) => {
                  const isEditing = editingId === c.id;
                  const isSaving = savingId === c.id;
                  const connector = connectorLabel(c.tracking_carrier_code);
                  const automated = !!c.tracking_carrier_code && (automatedCarriers?.includes(c.tracking_carrier_code) ?? false);
                  return (
                    <tr key={c.id} className={c.is_active ? '' : 'opacity-60'}>
                      <td className="px-3 py-2.5 font-bold text-slate-900 dark:text-slate-100">
                        {isEditing ? (
                          <input
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            maxLength={100}
                            className={`${fieldClass} w-full`}
                            autoFocus
                          />
                        ) : (
                          c.name
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-slate-700 dark:text-slate-300">
                        {isEditing ? (
                          <select value={editMode} onChange={(e) => setEditMode(e.target.value as CarrierTransportMode)} className={fieldClass}>
                            {(Object.keys(MODE_LABELS) as CarrierTransportMode[]).map((m) => (
                              <option key={m} value={m}>
                                {MODE_LABELS[m]}
                              </option>
                            ))}
                          </select>
                        ) : (
                          MODE_LABELS[c.transport_mode]
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-slate-700 dark:text-slate-300">
                        {isEditing ? (
                          <select value={editConnector} onChange={(e) => setEditConnector(e.target.value)} className={fieldClass}>
                            <option value="">— Non relié —</option>
                            {TRACKING_CONNECTOR_CODES.map((code) => (
                              <option key={code} value={code}>
                                {CARRIER_LABELS[code]}
                              </option>
                            ))}
                          </select>
                        ) : connector ? (
                          <span className="inline-flex items-center gap-1.5">
                            {connector}
                            <span
                              className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                                automated
                                  ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                                  : 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                              }`}
                            >
                              {automated ? 'Automatique' : 'Manuel'}
                            </span>
                          </span>
                        ) : (
                          <span className="text-slate-400">Non relié</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <button
                          type="button"
                          disabled={isSaving || isEditing}
                          onClick={() => saveCarrier(c, { is_active: !c.is_active })}
                          title={c.is_active ? 'Cliquer pour désactiver' : 'Cliquer pour réactiver'}
                          className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold transition disabled:cursor-not-allowed ${
                            c.is_active
                              ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200 dark:bg-emerald-950 dark:text-emerald-300'
                              : 'bg-slate-200 text-slate-600 hover:bg-slate-300 dark:bg-slate-800 dark:text-slate-400'
                          }`}
                        >
                          {c.is_active ? 'Actif' : 'Désactivé'}
                        </button>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        {isEditing ? (
                          <div className="inline-flex gap-1">
                            <button
                              type="button"
                              disabled={isSaving || !editName.trim()}
                              onClick={() =>
                                saveCarrier(c, {
                                  name: editName.trim(),
                                  transport_mode: editMode,
                                  tracking_carrier_code: editConnector || null,
                                })
                              }
                              className="rounded-lg bg-[#643288] p-1.5 text-white hover:bg-[#522870] disabled:opacity-50"
                              title="Enregistrer"
                            >
                              {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingId(null)}
                              className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
                              title="Annuler"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => startEdit(c)}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                          >
                            <Pencil className="h-3 w-3" /> Modifier
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SettingsCard>

      <TrackingAutomationPanel automatedCarriers={automatedCarriers} linkedCarriers={linkedCarriers} />
    </>
  );
};
