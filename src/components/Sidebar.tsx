import React from 'react';
import {
  LayoutDashboard,
  Plane,
  Ship,
  AlertTriangle,
  SlidersHorizontal,
  Plus,
  ReceiptText,
  ClipboardCheck,
  X,
} from 'lucide-react';
import { UserRole } from '../types';
import nexthopeLogotype from '../assets/nexthope-logotype.png';

// The AI assistant is a floating bubble (not a tab); analytics live in the dashboard tabs.
export type NavTab =
  | 'dashboard'
  | 'air'
  | 'sea'
  | 'digi'
  | 'received'
  | 'alerts'
  | 'settings';

interface SidebarProps {
  activeTab: NavTab;
  onTabChange: (tab: NavTab) => void;
  criticalAlertsCount: number;
  onNewShipment: () => void;
  canEdit: boolean;
  currentRole: UserRole;
  /** Number of air / sea shipments, shown next to their tab. */
  airCount?: number;
  seaCount?: number;
  /** Phone / tablet: the menu is open over the page. */
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onTabChange,
  criticalAlertsCount,
  onNewShipment,
  currentRole,
  airCount,
  seaCount,
  mobileOpen,
  onCloseMobile,
}) => {
  const navItems: {
    id: NavTab;
    label: string;
    icon: React.ElementType;
    count?: number;
    alert?: boolean;
    allowedRoles: UserRole[];
  }[] = [
    { id: 'dashboard', label: 'Tableau de bord', icon: LayoutDashboard, allowedRoles: ['supply_chain', 'sourcing', 'direction'] },
    { id: 'air', label: 'Suivi aérien', icon: Plane, count: airCount, allowedRoles: ['supply_chain', 'sourcing', 'direction'] },
    { id: 'sea', label: 'Suivi maritime', icon: Ship, count: seaCount, allowedRoles: ['supply_chain', 'sourcing', 'direction'] },
    { id: 'digi', label: 'Factures fournisseurs', icon: ReceiptText, allowedRoles: ['supply_chain', 'sourcing'] },
    { id: 'received', label: 'Réception Madagascar', icon: ClipboardCheck, allowedRoles: ['supply_chain', 'sourcing', 'direction'] },
    {
      id: 'alerts',
      label: 'Centre d’alertes',
      icon: AlertTriangle,
      count: criticalAlertsCount > 0 ? criticalAlertsCount : undefined,
      alert: true,
      allowedRoles: ['supply_chain', 'sourcing'],
    },
    { id: 'settings', label: 'Paramètres', icon: SlidersHorizontal, allowedRoles: ['supply_chain'] },
  ];

  const visibleNavItems = navItems.filter((item) => item.allowedRoles.includes(currentRole));

  return (
    <>
      {/* Phone / tablet: the menu slides over the page, behind a dimmed backdrop */}
      {mobileOpen && <div className="fixed inset-0 z-40 bg-[#17111F]/50 lg:hidden" onClick={onCloseMobile} aria-hidden="true" />}
      <aside
        id="main-sidebar"
        className={`fixed inset-y-0 left-0 z-50 flex w-64 shrink-0 flex-col gap-7 overflow-y-auto bg-[#1E1229] px-4 py-6 text-white transition-transform lg:static lg:z-auto lg:h-dvh lg:translate-x-0 ${
          mobileOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full'
        }`}
      >
        <div className="flex items-start justify-between gap-2 px-2">
          <div className="flex flex-col gap-1.5">
            {/* White monochrome logotype on the dark violet (charte 2026) */}
            <img src={nexthopeLogotype} alt="NextHope" className="h-8 w-auto self-start brightness-0 invert" draggable={false} />
            <span className="text-xs text-white/70">Shipment Manager</span>
          </div>
          <button
            type="button"
            onClick={onCloseMobile}
            aria-label="Fermer le menu"
            className="-mr-2 flex h-10 w-10 items-center justify-center rounded-lg text-white/70 hover:bg-white/10 hover:text-white lg:hidden"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {currentRole === 'supply_chain' && (
          <button
            id="sidebar-btn-new-shipment"
            onClick={() => {
              onNewShipment();
              onCloseMobile();
            }}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#623387] text-sm font-semibold text-white transition hover:bg-[#7340a0] active:scale-[0.98]"
          >
            <Plus className="h-4 w-4" strokeWidth={2.4} />
            Nouvelle expédition
          </button>
        )}

        <nav className="flex flex-col gap-0.5" aria-label="Navigation principale">
          {visibleNavItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                id={`sidebar-tab-${item.id}`}
                aria-current={isActive ? 'page' : undefined}
                onClick={() => {
                  onTabChange(item.id);
                  onCloseMobile();
                }}
                className={`flex h-11 w-full items-center gap-3 rounded-[10px] px-3 text-sm transition ${
                  isActive ? 'bg-white/10 font-semibold text-white' : 'text-white/75 hover:bg-white/5 hover:text-white'
                }`}
              >
                <Icon className="h-[18px] w-[18px] shrink-0" />
                <span className="truncate">{item.label}</span>
                {item.count !== undefined &&
                  (item.alert ? (
                    <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-[#E5484D] px-1.5 text-[11px] font-bold text-white">
                      {item.count}
                    </span>
                  ) : (
                    <span className={`ml-auto text-xs tabular-nums ${isActive ? 'text-white/85' : 'text-white/60'}`}>{item.count}</span>
                  ))}
                {isActive && item.count === undefined && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-[#62D18F]" />}
              </button>
            );
          })}
        </nav>
      </aside>
    </>
  );
};
