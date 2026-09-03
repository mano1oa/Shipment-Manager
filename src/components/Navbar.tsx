import React from 'react';
import {
  Ship,
  Plane,
  Bot,
  Bell,
  Search,
  User,
  Sun,
  Moon,
  Zap,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Database,
  Layers,
} from 'lucide-react';
import { UserRole } from '../types';

interface NavbarProps {
  currentRole: UserRole;
  onRoleChange: (role: UserRole) => void;
  darkMode: boolean;
  onToggleDarkMode: () => void;
  globalSearch: string;
  onSearchChange: (search: string) => void;
  alertsCount: number;
  onOpenAssistant: () => void;
  onOpenAlerts: () => void;
  onSyncShipments?: () => void;
  isSyncing?: boolean;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentRole,
  onRoleChange,
  darkMode,
  onToggleDarkMode,
  globalSearch,
  onSearchChange,
  alertsCount,
  onOpenAssistant,
  onOpenAlerts,
  onSyncShipments,
  isSyncing = false,
}) => {
  return (
    <header
      id="main-navbar"
      className="sticky top-0 z-30 flex h-16 w-full items-center justify-between border-b border-slate-200 bg-white/95 px-4 backdrop-blur transition-colors dark:border-slate-800 dark:bg-slate-900/95 sm:px-6"
    >
      {/* Brand & NEXTHOPE Logo */}
      <div className="flex items-center gap-3">
        {/* Authentic NEXTHOPE Brand Logo */}
        <div className="flex items-center gap-3">
          <div className="flex items-center">
            <svg
              viewBox="0 0 240 55"
              className="h-8 sm:h-9 w-auto select-none"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              aria-label="NextHope Logo"
            >
              {/* "next" in purple */}
              <text
                x="0"
                y="41"
                fontFamily="ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
                fontWeight="900"
                fontSize="42"
                className="fill-[#602880] dark:fill-purple-300"
                letterSpacing="-1.5px"
              >
                next
              </text>

              {/* "h" in purple */}
              <text
                x="91"
                y="41"
                fontFamily="ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
                fontWeight="900"
                fontSize="42"
                className="fill-[#602880] dark:fill-purple-300"
                letterSpacing="-1.5px"
              >
                h
              </text>

              {/* Stylized Node "o" Icon in Magenta */}
              <g transform="translate(133, 26)">
                {/* Node Stems */}
                <line x1="0" y1="0" x2="-12" y2="-12" stroke="#A91869" strokeWidth="4.5" strokeLinecap="round" />
                <line x1="0" y1="0" x2="15" y2="-15" stroke="#A91869" strokeWidth="5.5" strokeLinecap="round" />
                <line x1="0" y1="0" x2="-15" y2="15" stroke="#A91869" strokeWidth="5.5" strokeLinecap="round" />
                <line x1="0" y1="0" x2="11" y2="11" stroke="#A91869" strokeWidth="4.5" strokeLinecap="round" />
                {/* Center Ring */}
                <circle cx="0" cy="0" r="9" stroke="#A91869" strokeWidth="5.5" className="fill-white dark:fill-slate-900" />
                {/* Outer Node Orbs */}
                <circle cx="-12" cy="-12" r="5" fill="#A91869" />
                <circle cx="15" cy="-15" r="6.5" fill="#A91869" />
                <circle cx="-15" cy="15" r="7" fill="#A91869" />
                <circle cx="11" cy="11" r="4.5" fill="#A91869" />
              </g>

              {/* "pe" in purple */}
              <text
                x="162"
                y="41"
                fontFamily="ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
                fontWeight="900"
                fontSize="42"
                className="fill-[#602880] dark:fill-purple-300"
                letterSpacing="-1.5px"
              >
                pe
              </text>
            </svg>
          </div>

          <div className="flex items-center gap-2.5 border-l border-slate-200 dark:border-slate-800 pl-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-base sm:text-lg font-bold tracking-tight text-slate-900 dark:text-white">
                  Shipment Manager
                </span>
                <span className="hidden sm:inline-flex items-center gap-1 rounded-full bg-[#643288]/10 px-2 py-0.5 text-[10px] font-extrabold text-[#643288] dark:bg-[#643288]/30 dark:text-pink-300">
                  <Zap className="h-3 w-3" /> Supply Chain
                </span>
              </div>
              <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                Pilotage & Suivi des Expéditions
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Global Search */}
      <div className="hidden max-w-sm flex-1 px-6 md:block">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            id="global-search-input"
            type="text"
            placeholder="Rechercher par N° Suivi, BL/AWB, Fournisseur..."
            value={globalSearch}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full rounded-xl border border-slate-200 bg-slate-50 py-1.5 pl-9 pr-4 text-xs text-slate-800 placeholder-slate-400 transition focus:border-[#643288] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#643288]/20 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder-slate-500 dark:focus:bg-slate-900"
          />
        </div>
      </div>

      {/* Actions, SYNC button & Role Switcher */}
      <div className="flex items-center gap-2.5">
        {/* SYNC. SHIPMENT Button */}
        {onSyncShipments && (
          <button
            id="nav-btn-sync-shipment"
            onClick={onSyncShipments}
            disabled={isSyncing}
            className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 px-3 py-1.5 text-xs font-black uppercase tracking-wider text-white shadow-md shadow-emerald-600/20 transition hover:from-emerald-500 hover:to-teal-500 active:scale-95 disabled:opacity-50"
            title="Synchroniser l'application avec la base de données Google Sheets (ID: 15L895NUzVJK49xcv9XRkX2YbfAK9GILQK73gc4s8k2E)"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
            <span>SYNC. SHIPMENT</span>
          </button>
        )}

        {/* Role Switcher */}
        <div className="hidden items-center rounded-xl border border-slate-200 bg-slate-100 p-1 dark:border-slate-700 dark:bg-slate-800 xl:flex">
          <button
            id="role-btn-supply-chain"
            onClick={() => onRoleChange('supply_chain')}
            className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
              currentRole === 'supply_chain'
                ? 'bg-[#643288] text-white shadow-sm'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
            }`}
            title="Accès complet édition pour l'équipe Supply Chain"
          >
            Supply Chain
          </button>
          <button
            id="role-btn-sourcing"
            onClick={() => onRoleChange('sourcing')}
            className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
              currentRole === 'sourcing'
                ? 'bg-[#643288] text-white shadow-sm'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
            }`}
            title="Accès consultation pour le Sourcing"
          >
            Sourcing
          </button>
          <button
            id="role-btn-direction"
            onClick={() => onRoleChange('direction')}
            className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
              currentRole === 'direction'
                ? 'bg-[#A91869] text-white shadow-sm'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
            }`}
            title="Tableau de bord synthétique pour la Direction"
          >
            Direction
          </button>
        </div>

        {/* AI Assistant Quick Trigger */}
        <button
          id="nav-btn-ai-assistant"
          onClick={onOpenAssistant}
          className="relative flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-[#643288] to-[#A91869] px-3 py-1.5 text-xs font-semibold text-white shadow-md transition hover:opacity-95 hover:shadow-lg active:scale-95"
        >
          <Bot className="h-4 w-4" />
          <span className="hidden sm:inline">Shipment AI</span>
        </button>

        {/* Alert Bell */}
        <button
          id="nav-btn-alerts"
          onClick={onOpenAlerts}
          className="relative rounded-xl border border-slate-200 bg-slate-50 p-2 text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-white"
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
          className="rounded-xl border border-slate-200 bg-slate-50 p-2 text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-white"
          title="Basculer le thème"
        >
          {darkMode ? <Sun className="h-4 w-4 text-amber-400" /> : <Moon className="h-4 w-4" />}
        </button>
      </div>
    </header>
  );
};
