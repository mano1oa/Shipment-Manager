import React from 'react';
import { Bell, Search, Sun, Moon, RefreshCw, Menu, X, FileSpreadsheet } from 'lucide-react';
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
  /** Single entry point of the Excel imports; hidden when undefined (role not allowed). */
  onOpenImport?: () => void;
  dbConnected?: boolean | null;
  isLoadingDb?: boolean;
  onRefreshDb?: () => void;
  /** Phone / tablet: opens or closes the side menu. */
  onToggleMobileNav: () => void;
  mobileNavOpen: boolean;
}

const iconButton =
  'relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[#E1DDE7] bg-white text-[#17111F] transition hover:bg-[#F5F4F7] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800';
const textButton =
  'flex h-11 shrink-0 items-center gap-2 rounded-xl border border-[#E1DDE7] bg-white px-3.5 text-sm font-semibold text-[#17111F] transition hover:bg-[#F5F4F7] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800';

export const Navbar: React.FC<NavbarProps> = ({
  currentRole,
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
  onOpenImport,
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
      className="sticky top-0 z-30 flex w-full flex-wrap items-center gap-2.5 border-b border-[#E7E4EC] bg-white/95 px-4 py-3 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95 sm:px-6 lg:px-8"
    >
      {/* Phone / tablet: menu button + logo (the side menu holds them on large screens) */}
      <button
        onClick={onToggleMobileNav}
        className={`${iconButton} lg:hidden`}
        aria-label={mobileNavOpen ? 'Fermer le menu' : 'Ouvrir le menu'}
        aria-expanded={mobileNavOpen}
      >
        {mobileNavOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>
      <img
        src={nexthopeLogotype}
        alt="NextHope"
        className="h-7 w-auto shrink-0 select-none dark:brightness-0 dark:invert lg:hidden"
        draggable={false}
      />

      {/* Global Search (filters the Air / Sea lists) */}
      {showSearch && (
        <label className="relative order-last w-full sm:order-none sm:w-auto sm:max-w-[520px] sm:flex-1">
          <span className="sr-only">Rechercher</span>
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#6f6979]" />
          <input
            id="global-search-input"
            type="search"
            placeholder="Rechercher par n° de suivi, BL/AWB, fournisseur…"
            value={globalSearch}
            onChange={(e) => onSearchChange(e.target.value)}
            className="h-11 w-full rounded-xl border border-[#E1DDE7] bg-[#F8F7FA] pl-10 pr-4 text-sm text-[#17111F] placeholder-[#6f6979] transition focus:border-[#623387] focus:bg-white focus:outline-none focus:ring-4 focus:ring-[#623387]/10 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder-slate-400 dark:focus:bg-slate-900"
          />
        </label>
      )}

      <div className="ml-auto flex items-center gap-2">
        {/* Data status: click to reload */}
        <button
          type="button"
          onClick={onRefreshDb}
          title={
            dbConnected
              ? 'Données chargées. Cliquez pour recharger.'
              : 'Base de données non joignable : aucune donnée chargée. Cliquez pour réessayer.'
          }
          className="hidden h-11 items-center gap-2 rounded-xl px-2.5 text-xs font-medium text-[#5E5869] transition hover:bg-[#F5F4F7] dark:text-slate-400 dark:hover:bg-slate-800 xl:flex"
        >
          {isLoadingDb ? (
            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <span className={`h-2 w-2 rounded-full ${dbConnected ? 'bg-[#2E9E5B]' : dbConnected === null ? 'bg-slate-400' : 'bg-[#E8A33D]'}`} />
          )}
          {dbConnected ? 'Données à jour' : dbConnected === null ? 'Connexion…' : 'Base non connectée'}
        </button>

        {onOpenImport && (
          <button id="nav-btn-import-excel" type="button" onClick={onOpenImport} className={`${textButton} hidden md:flex`}>
            <FileSpreadsheet className="h-4 w-4 text-[#1C7A45] dark:text-emerald-400" />
            Importer Excel
          </button>
        )}

        <button id="nav-btn-alerts" type="button" onClick={onOpenAlerts} className={iconButton} aria-label={`Centre d’alertes (${alertsCount})`}>
          <Bell className="h-[18px] w-[18px]" />
          {alertsCount > 0 && (
            <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-[#E5484D] px-1 text-[10px] font-bold text-white ring-2 ring-white dark:ring-slate-900">
              {alertsCount}
            </span>
          )}
        </button>

        <button
          id="nav-btn-theme-toggle"
          type="button"
          onClick={onToggleDarkMode}
          className={`${iconButton} hidden sm:flex`}
          aria-label={darkMode ? 'Passer en mode clair' : 'Passer en mode sombre'}
        >
          {darkMode ? <Sun className="h-[18px] w-[18px] text-amber-400" /> : <Moon className="h-[18px] w-[18px]" />}
        </button>

        {/* User profile menu: password change, theme, Excel import on phones, sign-out */}
        <UserProfileMenu
          user={authUser}
          roleLabel={roleLabel}
          darkMode={darkMode}
          onToggleDarkMode={onToggleDarkMode}
          onLogout={onLogout}
          onOpenImport={onOpenImport}
        />
      </div>
    </header>
  );
};
