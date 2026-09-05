import React from 'react';
import {
  LayoutDashboard,
  Plane,
  Ship,
  AlertTriangle,
  BarChart3,
  Bot,
  Settings,
  FileText,
  PlusCircle,
  Database,
  ShieldAlert,
} from 'lucide-react';
import { UserRole } from '../types';

export type NavTab =
  | 'dashboard'
  | 'air'
  | 'sea'
  | 'alerts'
  | 'analytics'
  | 'assistant'
  | 'admin'
  | 'deliverables'
  | 'settings';

interface SidebarProps {
  activeTab: NavTab;
  onTabChange: (tab: NavTab) => void;
  criticalAlertsCount: number;
  onNewShipment: () => void;
  canEdit: boolean;
  currentRole: UserRole;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onTabChange,
  criticalAlertsCount,
  onNewShipment,
  canEdit,
  currentRole,
}) => {
  const navItems = [
    {
      id: 'dashboard' as NavTab,
      label: 'Tableau de bord',
      icon: LayoutDashboard,
      badge: null,
      allowedRoles: ['supply_chain', 'sourcing', 'direction'] as UserRole[],
    },
    {
      id: 'air' as NavTab,
      label: 'Suivi Aérien',
      icon: Plane,
      badge: 'Air',
      allowedRoles: ['supply_chain', 'sourcing'] as UserRole[],
    },
    {
      id: 'sea' as NavTab,
      label: 'Suivi Maritime',
      icon: Ship,
      badge: 'Sea',
      allowedRoles: ['supply_chain', 'sourcing'] as UserRole[],
    },
    {
      id: 'settings' as NavTab,
      label: 'Paramètres',
      icon: Settings,
      badge: null,
      allowedRoles: ['supply_chain'] as UserRole[],
},
    {
      id: 'alerts' as NavTab,
      label: 'Centre d’Alertes',
      icon: AlertTriangle,
      badge: criticalAlertsCount > 0 ? `${criticalAlertsCount}` : null,
      badgeColor: 'bg-rose-500 text-white',
      allowedRoles: ['supply_chain'] as UserRole[],
    },
    {
      id: 'analytics' as NavTab,
      label: 'Analyses & SLAs',
      icon: BarChart3,
      badge: null,
      allowedRoles: ['supply_chain'] as UserRole[],
    },
    {
      id: 'assistant' as NavTab,
      label: 'Assistant IA',
      icon: Bot,
      badge: 'Gemini',
      badgeColor: 'bg-[#A91869] text-white',
      allowedRoles: ['supply_chain', 'sourcing', 'direction'] as UserRole[],
    },
    {
      id: 'admin' as NavTab,
      label: 'Administration & N8N',
      icon: Settings,
      badge: null,
      allowedRoles: ['supply_chain'] as UserRole[],
    },
    {
      id: 'deliverables' as NavTab,
      label: 'Script Démo & Livrables',
      icon: FileText,
      badge: 'Projet',
      badgeColor: 'bg-[#643288] text-white',
      allowedRoles: ['supply_chain'] as UserRole[],
    },
  ];

  const visibleNavItems = navItems.filter((item) =>
    item.allowedRoles.includes(currentRole)
  );

  return (
    <aside
      id="main-sidebar"
      className="sticky top-16 h-[calc(100vh-4rem)] w-64 shrink-0 flex flex-col justify-between border-r border-slate-200 bg-slate-50/50 p-4 transition-colors dark:border-slate-800 dark:bg-slate-900/50 overflow-y-auto z-20"
    >
      <div className="space-y-6">
        {/* New Shipment Button */}
        {canEdit && (
          <button
            id="sidebar-btn-new-shipment"
            onClick={onNewShipment}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#643288] py-2.5 text-sm font-semibold text-white shadow-md shadow-[#643288]/25 transition hover:bg-[#522870] active:scale-95"
          >
            <PlusCircle className="h-4 w-4" />
            Nouvelle Expédition
          </button>
        )}

        {/* Role Badge Indicator */}
        <div className="rounded-xl border border-slate-200 bg-white/80 p-2.5 dark:border-slate-800 dark:bg-slate-800/50">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-slate-500 dark:text-slate-400">Profil Actif:</span>
            <span
              className={`font-bold px-2 py-0.5 rounded-full text-[10px] ${
                currentRole === 'supply_chain'
                  ? 'bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300'
                  : currentRole === 'sourcing'
                  ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                  : 'bg-pink-100 text-pink-700 dark:bg-pink-950 dark:text-pink-300'
              }`}
            >
              {currentRole === 'supply_chain'
                ? 'Supply Chain'
                : currentRole === 'sourcing'
                ? 'Sourcing (Lecture seule)'
                : 'Direction'}
            </span>
          </div>
        </div>

        {/* Navigation Menu */}
        <nav className="space-y-1">
          <p className="px-3 text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
            Navigation Principale
          </p>
          {visibleNavItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                id={`sidebar-tab-${item.id}`}
                onClick={() => onTabChange(item.id)}
                className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                  isActive
                    ? 'bg-[#643288] text-white shadow-sm font-semibold'
                    : 'text-slate-600 hover:bg-slate-200/60 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800/60 dark:hover:text-white'
                }`}
              >
                <div className="flex items-center gap-3">
                  <Icon
                    className={`h-4 w-4 ${
                      isActive
                        ? 'text-white'
                        : 'text-slate-500 group-hover:text-slate-700 dark:text-slate-400'
                    }`}
                  />
                  <span>{item.label}</span>
                </div>
                {item.badge && (
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                      item.badgeColor ||
                      (isActive
                        ? 'bg-white/20 text-white'
                        : 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300')
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* System Status / Architecture Info */}
      <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-xs dark:border-slate-800 dark:bg-slate-800/80">
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-800 dark:text-slate-200">
          <Database className="h-4 w-4 text-[#643288]" />
          Base Données & API
        </div>
        <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
          Google Sheets Sync Active • Connecteurs Express v4.21
        </p>
      </div>
    </aside>
  );
};
