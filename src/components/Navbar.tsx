import React from 'react';
import {
  Bot,
  Bell,
  Search,
  Sun,
  Moon,
  Zap,
  RefreshCw,
  Database,
  Menu,
  X,
} from 'lucide-react';
import { UserRole } from '../types';
import { UserProfileMenu } from './UserProfileMenu';
import nexthopeLogotype from '../assets/nexthope-logotype.png';

interface NavbarProps {
  currentRole: UserRole;
  onRoleChange: (role: UserRole) => void;
  authUser: {
  id: string;
  email: string;
  display_name: string;
  role: string;
};
  onLogout: () => void;

  darkMode: boolean;
  onToggleDarkMode: () => void;
  globalSearch: string;
  onSearchChange: (search: string) => void;
  showSearch?: boolean;
  alertsCount: number;
  onOpenAssistant: () => void;
  onOpenAlerts: () => void;
  dbConnected?: boolean | null;
  isLoadingDb?: boolean;
  onRefreshDb?: () => void;
  /** Phone / tablet: opens or closes the side menu. */
  onToggleMobileNav: () => void;
  mobileNavOpen: boolean;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentRole,
  onRoleChange,
  authUser,
  onLogout,
  darkMode,
  onToggleDarkMode,
  globalSearch,
  onSearchChange,
  showSearch = true,
  alertsCount,
  onOpenAssistant,
  onOpenAlerts,
  dbConnected = null,
  isLoadingDb = false,
  onRefreshDb,
  onToggleMobileNav,
  mobileNavOpen,
}) => {
  const roleLabel =
    currentRole === 'supply_chain' ? 'Supply Chain' : currentRole === 'sourcing' ? 'Sourcing' : 'Direction';

  return (
    <header
      id="main-navbar"
      className="sticky top-0 z-30 flex h-16 w-full items-center justify-between border-b border-slate-200 bg-white/95 px-4 backdrop-blur transition-colors dark:border-slate-800 dark:bg-slate-900/95 sm:px-6"
    >
      {/* Brand & NEXTHOPE Logo */}
      <div className="flex min-w-0 items-center gap-4">
        <button
          onClick={onToggleMobileNav}
          className="rounded-xl p-2 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 lg:hidden"
          aria-label={mobileNavOpen ? 'Fermer le menu' : 'Ouvrir le menu'}
          aria-expanded={mobileNavOpen}
        >
          {mobileNavOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
        {/* NextHope logotype (charte 2026: at least 50 px high on screen; white monochrome
            version on the dark theme, since it may only sit on white, violet or magenta).
            Sideways clear space about the height of its "o" (~18 px at this size). */}
        <div className="flex items-center gap-5">
          <img
            src={nexthopeLogotype}
            alt="NextHope"
            className="h-[50px] w-auto shrink-0 select-none dark:brightness-0 dark:invert"
            draggable={false}
          />

          <div className="hidden items-center gap-2.5 border-l border-slate-200 pl-5 dark:border-slate-800 md:flex">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-base sm:text-lg font-bold tracking-tight text-slate-900 dark:text-white">
                  Shipment Manager
                </span>
                <span className="hidden sm:inline-flex items-center gap-1 rounded-full bg-[#623387]/10 px-2 py-0.5 text-[10px] font-extrabold text-[#623387] dark:bg-[#623387]/30 dark:text-[#ED5DB2]">
                  <Zap className="h-3 w-3" /> Supply Chain
                </span>
              </div>
              <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                Pilotage et suivi des expéditions
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Global Search (filters the Air / Sea lists) */}
      <div className={`hidden max-w-sm flex-1 px-6 ${showSearch ? 'md:block' : ''}`}>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            id="global-search-input"
            type="text"
            placeholder="Rechercher par n° de suivi, BL/AWB, fournisseur..."
            value={globalSearch}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full rounded-xl border border-slate-200 bg-slate-50 py-1.5 pl-9 pr-4 text-xs text-slate-800 placeholder-slate-400 transition focus:border-[#623387] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#623387]/20 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder-slate-500 dark:focus:bg-slate-900"
          />
        </div>
      </div>

      {/* Actions, SYNC button & Role Switcher */}
      <div className="flex shrink-0 items-center gap-1.5 sm:gap-2.5">
        {/* Database Neon / Local Indicator */}
        <div
          onClick={onRefreshDb}
          title={
            dbConnected
              ? 'Connecté en direct à Neon PostgreSQL via DATABASE_URL / POSTGRES_URL. Cliquez pour recharger.'
              : 'Base Neon non joignable : aucune donnée chargée. Cliquez pour réessayer.'
          }
          className={`hidden lg:flex items-center gap-1.5 rounded-xl border px-2.5 py-1 text-[11px] font-semibold cursor-pointer transition ${
            dbConnected
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
              : 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
          }`}
        >
          <Database className={`h-3 w-3 ${isLoadingDb ? 'animate-pulse' : ''}`} />
          <span className="flex items-center gap-1">
            <span
              className={`h-2 w-2 rounded-full ${
                dbConnected ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'
              }`}
            />
            {dbConnected ? 'Neon PostgreSQL' : dbConnected === null ? 'Connexion…' : 'Base non connectée'}
          </span>
          {isLoadingDb && <RefreshCw className="h-2.5 w-2.5 animate-spin" />}
        </div>

        {/* AI Assistant Quick Trigger */}
        <button
          id="nav-btn-ai-assistant"
          onClick={onOpenAssistant}
          className="relative hidden items-center gap-1.5 rounded-xl bg-gradient-to-r from-[#623387] to-[#9E1B65] px-3 py-1.5 text-xs font-semibold text-white shadow-md transition hover:opacity-95 hover:shadow-lg active:scale-95 sm:flex"
        >
          <Bot className="h-4 w-4" />
          <span className="hidden sm:inline">Shipment AI</span>
        </button>

        {/* Alert Bell */}
        <button
          id="nav-btn-alerts"
          onClick={onOpenAlerts}
          className="relative hidden rounded-xl border border-slate-200 bg-slate-50 p-2 sm:block text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-white"
          title="Centre d'alertes"
        >
          <Bell className="h-4 w-4" />
          {alertsCount > 0 && (
            <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-rose-500 text-[10px] font-bold text-white ring-2 ring-white dark:ring-slate-900">
              {alertsCount}
            </span>
          )}
        </button>

        {/* Dark Mode Toggle */}
        <button
          id="nav-btn-theme-toggle"
          onClick={onToggleDarkMode}
          className="hidden rounded-xl border border-slate-200 bg-slate-50 p-2 text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-white sm:block"
          title="Basculer le thème"
        >
          {darkMode ? <Sun className="h-4 w-4 text-amber-400" /> : <Moon className="h-4 w-4" />}
        </button>

        {/* User profile menu: password change, theme, sign-out */}
        <UserProfileMenu
          user={authUser}
          roleLabel={roleLabel}
          darkMode={darkMode}
          onToggleDarkMode={onToggleDarkMode}
          onLogout={onLogout}
        />
      </div>
    </header>
  );
};
