import type { NavTab } from '../components/Sidebar';

/** One address per section, so the browser bar, back / forward and shared links follow the navigation. */
export type DashboardTab = 'overview' | 'analytics';

export interface AppRoute {
  tab: NavTab;
  dashboardTab: DashboardTab;
}

const TAB_PATHS: Record<NavTab, string> = {
  dashboard: '/tableau-de-bord',
  air: '/suivi-aerien',
  sea: '/suivi-maritime',
  digi: '/factures',
  received: '/reception',
  alerts: '/alertes',
  settings: '/parametres',
};

const TAB_TITLES: Record<NavTab, string> = {
  dashboard: 'Tableau de bord',
  air: 'Suivi aérien',
  sea: 'Suivi maritime',
  digi: 'Factures fournisseurs',
  received: 'Réception Madagascar',
  alerts: "Centre d'alertes",
  settings: 'Paramètres',
};

export const LOGIN_PATH = '/connexion';
const ANALYTICS_PATH = `${TAB_PATHS.dashboard}/analyses`;

export function pathForRoute({ tab, dashboardTab }: AppRoute): string {
  if (tab === 'dashboard' && dashboardTab === 'analytics') return ANALYTICS_PATH;
  return TAB_PATHS[tab];
}

/** Unknown addresses (and "/") open the dashboard. */
export function routeFromPath(pathname: string): AppRoute {
  const path = pathname.replace(/\/+$/, '').toLowerCase() || '/';
  if (path === ANALYTICS_PATH) return { tab: 'dashboard', dashboardTab: 'analytics' };
  const tab = (Object.keys(TAB_PATHS) as NavTab[]).find((t) => TAB_PATHS[t] === path);
  return { tab: tab ?? 'dashboard', dashboardTab: 'overview' };
}

export function titleForRoute({ tab, dashboardTab }: AppRoute): string {
  const label = tab === 'dashboard' && dashboardTab === 'analytics' ? 'Analyses et SLAs' : TAB_TITLES[tab];
  return `${label} · Shipment Manager`;
}
