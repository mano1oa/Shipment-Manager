import { useId } from 'react';

/**
 * Login page map: parcels from Orly · Rouen, China and South Africa to Madagascar,
 * by air (dashed arcs) and by sea (dotted lines along the shipping lanes).
 * Equirectangular projection: lon -15..125, lat 58..-38, 3 px per degree.
 */
type LonLat = [number, number];

const P = (lon: number, lat: number): [number, number] => [+((lon + 15) * 3).toFixed(1), +((58 - lat) * 3).toFixed(1)];

const toPath = (pts: LonLat[], close: boolean) =>
  'M' + pts.map(([lon, lat]) => P(lon, lat).join(' ')).join(' L') + (close ? ' Z' : '');

const arc = (a: LonLat, b: LonLat, bend: number) => {
  const [x1, y1] = P(a[0], a[1]);
  const [x2, y2] = P(b[0], b[1]);
  const dx = x2 - x1;
  const dy = y2 - y1;
  const cx = (x1 + x2) / 2 - dy * bend;
  const cy = (y1 + y2) / 2 + dx * bend;
  return `M${x1} ${y1} Q${cx.toFixed(1)} ${cy.toFixed(1)} ${x2} ${y2}`;
};

const LAND: LonLat[][] = [
  // Eurasia (Europe, Middle East, India, South-East Asia, China)
  [[-9.5,37],[-9,43],[-1.5,43.5],[-4.7,48],[-1.5,49.6],[1.8,51],[4.5,53],[8.5,54],[8,57.5],[12,58],[60,58],[90,58],[125,58],[125,40],[121,40.5],[122,37],[119,35],[121,31],[121.5,28],[119.5,25.5],[114,22.3],[109,21.5],[108,18],[109,12],[106,10.5],[104.8,8.6],[100.5,13.5],[99,10],[100.4,3.5],[103.5,1.3],[101,6.5],[98.5,8],[98,16],[94.5,16],[92,22],[88.5,21.5],[86,19.5],[80.3,15.5],[80,10],[77.5,8],[76,10],[73,17],[72.6,21],[68.7,23.5],[66.5,25.4],[61.5,25.2],[57,25.8],[56.4,27],[51.5,27.8],[48.5,30],[50,26],[51.5,24.2],[56,26.2],[59.8,22.5],[57,18.9],[52.2,15.6],[45,12.8],[42.7,15],[39,21.5],[35,28],[34.5,31.5],[36,34.5],[36,36.7],[30,36.5],[27,37.5],[26.5,40.2],[23.5,40],[22.5,37],[21,38.5],[19.5,41.5],[13.5,45.5],[12.3,44.2],[16,41.5],[18.5,40.1],[15.6,38],[12.5,41.8],[10,44],[6.5,43.1],[3.2,43.3],[3.2,42],[0,39.3],[-0.5,37.6],[-5.6,36]],
  // Africa
  [[-17,21],[-16,28],[-10,30],[-6,35.8],[10,37],[11,33],[20,31],[32,31],[33.5,28],[39,18],[43,12],[51,12],[51,10],[44,0],[40,-10],[40,-16],[35,-24],[32,-29],[26,-34],[20,-35],[18,-32],[14,-23],[12,-17],[13,-6],[9,-1],[9,4],[5,6],[-4,5],[-8,4],[-13,8],[-17,14]],
  // Madagascar
  [[49.3,-12],[50.5,-15.5],[49.5,-17],[47.1,-24.9],[45.2,-25.5],[43.5,-22],[44.4,-16.2],[46.5,-15.8]],
  // Sumatra, Borneo, Java, Philippines, Australia (west), Sri Lanka
  [[95.3,5.6],[98,4],[104,-1.5],[106,-6],[101,-3],[96,2]],
  [[109,1.5],[117,7],[119,5],[117,1],[116,-4],[110.5,-3]],
  [[105.2,-6.8],[114.5,-7.8],[114.4,-8.7],[106,-7.6]],
  [[120,18.5],[122,18.5],[124,13],[125,6.5],[122,7],[121.5,14],[120,15.5]],
  [[113.5,-22],[114,-26.5],[115,-34],[118,-35],[125,-33],[125,-15],[123,-16.5],[121,-19.5],[117,-20.7]],
  [[79.8,9.8],[81.8,7.5],[81,6],[80,6.2]],
];

const FRANCE: LonLat = [1.8, 49.2];
const CHINA: LonLat = [114, 22.5];
const SOUTH_AFRICA: LonLat = [31, -29.9];
const TANA: LonLat = [47.5, -18.9];

const SEA_ROUTES: LonLat[][] = [
  // Rouen → Gibraltar → Suez → Red Sea → Toamasina
  [[0.5,49.6],[-2,50],[-5.5,48.6],[-10,44],[-10,38],[-5.6,35.9],[5,37.6],[20,34.2],[32.3,31.5],[32.6,29.6],[34.5,27],[39,19],[43.4,12.5],[50,11.8],[53.5,4],[52.5,-8],[50.8,-15],[49.4,-18.1]],
  // China → Malacca → Indian Ocean
  [[114,21.8],[109.5,12],[105.5,4.5],[103.6,1.1],[100.2,3.8],[97,6.2],[88,4],[75,-2],[62,-11],[52.5,-16],[49.4,-18.1]],
  // Durban → around the south of Madagascar
  [[31,-29.9],[35,-29.5],[43,-28.6],[48,-26.5],[50.2,-21.5],[49.4,-18.1]],
];

const AIR_ROUTES = [arc(FRANCE, TANA, 0.13), arc(CHINA, TANA, 0.16), arc(SOUTH_AFRICA, TANA, -0.32)];

const ORIGINS: { at: LonLat; label: string; dx: number; dy: number; anchor: 'start' | 'middle' | 'end' }[] = [
  { at: FRANCE, label: 'Orly · Rouen', dx: 12, dy: -8, anchor: 'start' },
  { at: CHINA, label: 'Chine', dx: 0, dy: -14, anchor: 'middle' },
  { at: SOUTH_AFRICA, label: 'Afrique du Sud', dx: -12, dy: 14, anchor: 'end' },
];

const LAND_PATHS = LAND.map((pts) => toPath(pts, true));
const SEA_PATHS = SEA_ROUTES.map((pts) => toPath(pts, false));

export const AIR_STROKE = { stroke: '#ffffff', dash: '6 5' };
export const SEA_STROKE = { stroke: '#D7BCE8', dash: '0.5 5.5' };

export function LoginRouteMap({ className = '', compact = false }: { className?: string; compact?: boolean }) {
  const patternId = `land-dots-${useId().replace(/:/g, '')}`;
  const [mx, my] = P(TANA[0], TANA[1]);
  const font = compact ? 14 : 11;

  return (
    <svg
      viewBox="0 0 420 288"
      className={`block w-full ${className}`}
      role="img"
      aria-label="Carte des flux : colis d’Orly · Rouen, de Chine et d’Afrique du Sud vers Madagascar, en avion et en bateau"
    >
      <defs>
        <pattern id={patternId} patternUnits="userSpaceOnUse" width="5" height="5">
          <circle cx="2.5" cy="2.5" r="1.15" fill="#ffffff" fillOpacity="0.38" />
        </pattern>
      </defs>
      {LAND_PATHS.map((d, i) => (
        <path key={i} d={d} fill={`url(#${patternId})`} stroke="#ffffff" strokeOpacity="0.08" strokeWidth="1" />
      ))}
      {SEA_PATHS.map((d, i) => (
        <path
          key={i}
          d={d}
          fill="none"
          stroke={SEA_STROKE.stroke}
          strokeWidth={compact ? 2.8 : 2.4}
          strokeDasharray={SEA_STROKE.dash}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
      {AIR_ROUTES.map((d, i) => (
        <path
          key={i}
          d={d}
          fill="none"
          stroke={AIR_STROKE.stroke}
          strokeOpacity="0.9"
          strokeWidth={compact ? 2 : 1.6}
          strokeDasharray={AIR_STROKE.dash}
          strokeLinecap="round"
        />
      ))}
      {ORIGINS.map(({ at, label, dx, dy, anchor }) => {
        const [x, y] = P(at[0], at[1]);
        return (
          <g key={label}>
            <circle cx={x} cy={y} r="9" fill="#ffffff" fillOpacity="0.16" />
            <circle cx={x} cy={y} r="4" fill="#ffffff" />
            <text x={x + dx} y={y + dy} textAnchor={anchor} fill="#ffffff" fontSize={font} fontWeight="600">
              {label}
            </text>
          </g>
        );
      })}
      <circle cx={mx} cy={my} r="13" fill="#62D18F" fillOpacity="0.22" />
      <circle cx={mx} cy={my} r="5.5" fill="#62D18F" />
      <text x={mx + 20} y={my + 4} fill="#ffffff" fontSize={font + 1} fontWeight="700">
        Madagascar
      </text>
    </svg>
  );
}

/** "Avion / Bateau" legend under the map. */
export function LoginRouteLegend() {
  return (
    <div className="flex gap-5 text-xs font-semibold text-white/85">
      <span className="flex items-center gap-2">
        <svg width="22" height="6" viewBox="0 0 22 6" aria-hidden="true">
          <line x1="1" y1="3" x2="21" y2="3" stroke={AIR_STROKE.stroke} strokeWidth="1.6" strokeDasharray={AIR_STROKE.dash} strokeLinecap="round" />
        </svg>
        Avion
      </span>
      <span className="flex items-center gap-2">
        <svg width="22" height="6" viewBox="0 0 22 6" aria-hidden="true">
          <line x1="1" y1="3" x2="21" y2="3" stroke={SEA_STROKE.stroke} strokeWidth="2.4" strokeDasharray={SEA_STROKE.dash} strokeLinecap="round" />
        </svg>
        Bateau
      </span>
    </div>
  );
}
