import React from 'react';
import {
  LayoutDashboard,
  Plane,
  Ship,
  AlertTriangle,
  Settings,
  PlusCircle,
  Database,
  ReceiptText,
} from 'lucide-react';
import { UserRole } from '../types';

// The AI assistant is a floating bubble (not a tab); analytics live in the dashboard tabs.
export type NavTab =
  | 'dashboard'
  | 'air'
  | 'sea'
  | 'digi'
  | 'alerts'
  | 'settings';

interface SidebarProps {
  activeTab: NavTab;
  onTabChange: (tab: NavTab) => void;
  criticalAlertsCount: number;
  onNewShipment: () => void;
  canEdit: boolean;
  currentRole: UserRole;
  /** Phone / tablet: the menu is open over the page. */
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onTabChange,
  criticalAlertsCount,
  onNewShipment,
  canEdit,
  currentRole,
  mobileOpen,
  onCloseMobile,
}) => {
  const navItems = [
    {
      id: 'dashboard' as NavTab,
      label: 'Tableau de bord et KPI',
      icon: LayoutDashboard,
      badge: null,
      allowedRoles: ['supply_chain', 'sourcing', 'direction'] as UserRole[],
    },
    {
      id: 'air' as NavTab,
      label: 'Suivi aérien',
      icon: Plane,
      badge: 'Air',
      allowedRoles: ['supply_chain', 'sourcing', 'direction'] as UserRole[],
    },
    {
      id: 'sea' as NavTab,
      label: 'Suivi maritime',
      icon: Ship,
      badge: 'Sea',
      allowedRoles: ['supply_chain', 'sourcing', 'direction'] as UserRole[],
    },
    {
      id: 'digi' as NavTab,
      label: 'Factures fournisseurs',
      icon: ReceiptText,
      badge: null,
      allowedRoles: ['supply_chain', 'sourcing'] as UserRole[],
    },
    {
      id: 'alerts' as NavTab,
      label: 'Centre d’alertes',
      icon: AlertTriangle,
      badge: criticalAlertsCount > 0 ? `${criticalAlertsCount}` : null,
      badgeColor: 'bg-rose-500 text-white',
      allowedRoles: ['supply_chain', 'sourcing'] as UserRole[],
    },
    {
      id: 'settings' as NavTab,
      label: 'Paramètres',
      icon: Settings,
      badge: null,
      allowedRoles: ['supply_chain'] as UserRole[],
    },
  ];

  const visibleNavItems = navItems.filter((item) =>
    item.allowedRoles.includes(currentRole)
  );

  return (
    <>
    {/* Phone / tablet: the menu slides over the page, behind a dimmed backdrop */}
    {mobileOpen && (
      <div className="fixed inset-0 top-16 z-30 bg-slate-900/40 lg:hidden" onClick={onCloseMobile} aria-hidden="true" />
    )}
    <aside
      id="main-sidebar"
      className={`fixed left-0 top-16 z-40 h-[calc(100dvh-4rem)] w-64 shrink-0 flex flex-col justify-between border-r border-slate-200 bg-slate-50 p-4 transition-transform dark:border-slate-800 dark:bg-slate-900 overflow-y-auto lg:sticky lg:z-20 lg:translate-x-0 lg:bg-slate-50/50 lg:dark:bg-slate-900/50 ${
        mobileOpen ? 'translate-x-0 shadow-xl' : '-translate-x-full'
      }`}
    >
      <div className="space-y-6">
        {/* New Shipment Button */}
        {currentRole === 'supply_chain' && (
          <button
            id="sidebar-btn-new-shipment"
            onClick={() => {
              onNewShipment();
              onCloseMobile();
            }}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#623387] py-2.5 text-sm font-semibold text-white shadow-md shadow-[#623387]/25 transition hover:bg-[#522870] active:scale-95"
          >
            <PlusCircle className="h-4 w-4" />
            Nouvelle expédition
          </button>
        )}

        {/* Navigation Menu */}
        <nav className="space-y-1">
          <p className="px-3 text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
            Navigation
          </p>
          {visibleNavItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                id={`sidebar-tab-${item.id}`}
                onClick={() => {
                  onTabChange(item.id);
                  onCloseMobile();
                }}
                className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                  isActive
                    ? 'bg-[#623387] text-white shadow-sm font-semibold'
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
          <Database className="h-4 w-4 text-[#623387]" />
          Base de données et API
        </div>
        <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
          Neon PostgreSQL • Odoo DIGI LOGISTIC
        </p>
      </div>
    </aside>
    </>
  );
};
