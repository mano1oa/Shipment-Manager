import React, { useState } from 'react';
import { Settings, Users, Truck, Workflow, Server } from 'lucide-react';
import { SettingsUsersView } from './SettingsUsersView';
import { SettingsCarriersPanel } from './SettingsCarriersPanel';
import { IntegrationsPanel, NeonDatabasePanel } from './SettingsSystemPanels';
import { TrackingSettingsPanel } from './TrackingSettingsPanel';

type SettingsSection = 'users' | 'carriers' | 'integrations' | 'database';

const SECTIONS: { id: SettingsSection; label: string; hint: string; icon: React.ElementType }[] = [
  { id: 'users', label: 'Utilisateurs & accès', hint: 'Comptes, rôles, activation', icon: Users },
  { id: 'carriers', label: 'Transporteurs', hint: 'Liste et suivi automatique', icon: Truck },
  { id: 'integrations', label: 'Intégrations', hint: 'N8N, Google Chat, Sheets, seuils', icon: Workflow },
  { id: 'database', label: 'Base de données', hint: 'Neon PostgreSQL', icon: Server },
];

/** All configuration screens (SUPPLY_CHAIN only), grouped by topic. */
export const SettingsView: React.FC<{ currentUserId: string }> = ({ currentUserId }) => {
  const [section, setSection] = useState<SettingsSection>('users');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-extrabold text-slate-900 dark:text-white">
          <Settings className="h-6 w-6 text-[#643288]" /> Paramètres
        </h1>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Configuration de Shipment Manager : accès, transporteurs, intégrations et base de données.
        </p>
      </div>

      <div className="flex flex-col gap-6 lg:flex-row">
        <nav className="flex shrink-0 gap-2 overflow-x-auto lg:w-60 lg:flex-col lg:overflow-visible">
          {SECTIONS.map((s) => {
            const Icon = s.icon;
            const active = section === s.id;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setSection(s.id)}
                className={`flex shrink-0 items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition lg:w-full ${
                  active
                    ? 'border-[#643288] bg-[#643288] text-white shadow-sm'
                    : 'border-slate-200 bg-white text-slate-700 hover:border-[#643288]/50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200'
                }`}
              >
                <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${active ? 'text-white' : 'text-[#643288] dark:text-purple-300'}`} />
                <span>
                  <span className="block text-xs font-bold">{s.label}</span>
                  <span className={`hidden text-[10px] lg:block ${active ? 'text-purple-100' : 'text-slate-500 dark:text-slate-400'}`}>
                    {s.hint}
                  </span>
                </span>
              </button>
            );
          })}
        </nav>

        <div className="min-w-0 flex-1 space-y-6">
          {section === 'users' && <SettingsUsersView currentUserId={currentUserId} />}
          {section === 'carriers' && <SettingsCarriersPanel />}
          {section === 'integrations' && (
            <>
              <TrackingSettingsPanel />
              <IntegrationsPanel />
            </>
          )}
          {section === 'database' && <NeonDatabasePanel />}
        </div>
      </div>
    </div>
  );
};
