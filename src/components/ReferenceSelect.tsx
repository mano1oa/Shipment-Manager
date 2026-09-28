import React, { useState } from 'react';
import { Plus, Loader2, X } from 'lucide-react';

export type ReferenceTransportMode = 'Air' | 'Sea' | 'BOTH';

export interface ReferenceOption {
  id: string;
  name: string;
}

export interface ReferenceCreateResult {
  ok: boolean;
  error?: string;
}

interface ReferenceSelectProps {
  label: string;
  entityLabel: string; // e.g. "transporteur", "fournisseur"
  options: ReferenceOption[];
  value: string;
  onChange: (name: string) => void;
  onCreate: (name: string, mode?: ReferenceTransportMode) => Promise<ReferenceCreateResult>;
  withModeChoice?: boolean;
  required?: boolean;
  loading?: boolean;
  loadError?: string | null;
  emptyHint?: string;
}

const CREATE_VALUE = '__create__';

const inputClass =
  'mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 font-medium dark:border-slate-700 dark:bg-slate-800 dark:text-white';

/**
 * Dropdown backed by a Neon reference list, with inline creation.
 * Starts empty: no value is ever pre-selected.
 */
export const ReferenceSelect: React.FC<ReferenceSelectProps> = ({
  label,
  entityLabel,
  options,
  value,
  onChange,
  onCreate,
  withModeChoice = false,
  required = false,
  loading = false,
  loadError = null,
  emptyHint,
}) => {
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newMode, setNewMode] = useState<ReferenceTransportMode | ''>('');
  const [submitting, setSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const resetCreate = () => {
    setIsCreating(false);
    setNewName('');
    setNewMode('');
    setCreateError(null);
  };

  const handleCreate = async () => {
    const trimmed = newName.trim();
    if (!trimmed) {
      setCreateError(`Le nom du ${entityLabel} est obligatoire.`);
      return;
    }
    if (withModeChoice && !newMode) {
      setCreateError('Veuillez choisir le mode de transport.');
      return;
    }

    setSubmitting(true);
    setCreateError(null);
    try {
      const result = await onCreate(trimmed, withModeChoice ? (newMode as ReferenceTransportMode) : undefined);
      if (result.ok) {
        resetCreate();
      } else {
        setCreateError(result.error || `Impossible d'ajouter ce ${entityLabel}.`);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <label className="font-semibold text-slate-700 dark:text-slate-300">
        {label}
        {required ? ' *' : ''}
      </label>

      {!isCreating ? (
        <select
          value={value}
          required={required}
          disabled={loading}
          onChange={(e) => {
            if (e.target.value === CREATE_VALUE) {
              setIsCreating(true);
              return;
            }
            onChange(e.target.value);
          }}
          className={inputClass}
        >
          <option value="">{loading ? 'Chargement…' : '— Sélectionner —'}</option>
          {options.map((opt) => (
            <option key={opt.id} value={opt.name}>
              {opt.name}
            </option>
          ))}
          <option value={CREATE_VALUE}>+ Ajouter un {entityLabel}…</option>
        </select>
      ) : (
        <div className="mt-1 space-y-2 rounded-xl border border-[#643288]/30 bg-purple-50/40 p-2.5 dark:border-purple-900/60 dark:bg-slate-800">
          <input
            type="text"
            autoFocus
            value={newName}
            maxLength={withModeChoice ? 100 : 150}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              // Enter must not submit the parent shipment form
              if (e.key === 'Enter') {
                e.preventDefault();
                handleCreate();
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                resetCreate();
              }
            }}
            aria-label={`Nom du nouveau ${entityLabel}`}
            className="w-full rounded-lg border border-slate-200 bg-white p-2 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-white"
          />
          {withModeChoice && (
            <select
              value={newMode}
              onChange={(e) => setNewMode(e.target.value as ReferenceTransportMode | '')}
              aria-label="Mode de transport du transporteur"
              className="w-full rounded-lg border border-slate-200 bg-white p-2 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-white"
            >
              <option value="">— Mode de transport —</option>
              <option value="Air">Aérien uniquement</option>
              <option value="Sea">Maritime uniquement</option>
              <option value="BOTH">Aérien et maritime</option>
            </select>
          )}
          {createError && (
            <p className="text-[11px] font-semibold text-rose-600 dark:text-rose-400">{createError}</p>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={resetCreate}
              disabled={submitting}
              className="flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 disabled:opacity-50"
            >
              <X className="h-3 w-3" /> Annuler
            </button>
            <button
              type="button"
              onClick={handleCreate}
              disabled={submitting}
              className="flex items-center gap-1 rounded-lg bg-[#643288] px-2.5 py-1 text-[11px] font-bold text-white hover:bg-[#522870] disabled:opacity-50"
            >
              {submitting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
              Ajouter
            </button>
          </div>
        </div>
      )}

      {loadError && (
        <p className="mt-1 text-[11px] font-semibold text-rose-600 dark:text-rose-400">{loadError}</p>
      )}
      {!loading && !loadError && !isCreating && options.length === 0 && emptyHint && (
        <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">{emptyHint}</p>
      )}
    </div>
  );
};
