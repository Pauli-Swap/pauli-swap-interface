import { ReactNode, useEffect, useId, useMemo, useRef, useState } from 'react';
import { formatPrice } from '../lib/format';
import { Icon } from './ui';

export type Point = { t: number; v: number };
export type Bar = { t: number; t1: number; v: number };

const AXIS_W = 56;
const GAP = 8;

export function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

export function smooth(xy: [number, number][]): string {
  if (!xy.length) return '';
  let d = `M${xy[0][0].toFixed(1)},${xy[0][1].toFixed(1)}`;
  for (let i = 1; i < xy.length; i++) {
    const [x0, y0] = xy[i - 1];
    const [x1, y1] = xy[i];
    const cx = ((x0 + x1) / 2).toFixed(1);
    d += ` C${cx},${y0.toFixed(1)} ${cx},${y1.toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)}`;
  }
  return d;
}

const pad2 = (n: number) => String(n).padStart(2, '0');
export const clockLabel = (t: number) => {
  const d = new Date(t * 1000);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};
export const dayLabel = (t: number) => new Date(t * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
/// "Oct 27 · 12:40" — the tooltip's second line.
export const stampLabel = (t: number) => `${dayLabel(t)} · ${clockLabel(t)}`;

function xLabels(t0: number, t1: number, count: number, now: boolean): string[] {
  const span = t1 - t0;
  const fmt = span > 2 * 86400 ? dayLabel : clockLabel;
  return Array.from({ length: count }, (_, i) => (now && i === count - 1 ? 'Now' : fmt(t0 + (span * i) / (count - 1))));
}

/// Round tick values (1, 2, 2.5, 5 × 10^n steps) inside [lo, hi], top first.
export function niceTicks(lo: number, hi: number, count = 4): number[] {
  if (!(hi > lo)) return [lo];
  const raw = (hi - lo) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 2.5, 5, 10].find((m) => m * mag >= raw) ?? 10) * mag;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(Number(v.toPrecision(12)));
  return out.reverse();
}

/// Dot grid (border/default) behind every plot.
function DotGrid({ id, w, h }: { id: string; w: number; h: number }) {
  return (
    <>
      <defs>
        <pattern id={`dots-${id}`} width="16" height="16" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r="1" fill="rgb(255 255 255 / 0.12)" />
        </pattern>
      </defs>
      <rect width={w} height={h} fill={`url(#dots-${id})`} />
    </>
  );
}

export function ChartEmpty({ height, children }: { height: number; children: ReactNode }) {
  return (
    <div className="chart-empty t-body" style={{ height }}>
      {children}
    </div>
  );
}

/// Placeholder while a chart's history is read: the dot grid with a faint
/// wave sweeping across, and a status line under it.
export function ChartLoading({ height, children = 'Reading on-chain history…' }: { height: number; children?: ReactNode }) {
  const gid = useId().replace(/:/g, '');
  const wave = 'M0,70 C60,70 60,40 120,40 S180,62 240,58 S300,22 360,26 S420,52 480,48 S540,18 600,14';
  return (
    <div className="chart-loading" style={{ height }} role="status">
      <svg width="100%" height="100%" aria-hidden="true">
        <DotGrid id={gid} w={4000} h={height} />
      </svg>
      <svg width="100%" height="100%" preserveAspectRatio="none" viewBox="0 0 600 100" aria-hidden="true">
        <path d={wave} className="wave" fill="none" stroke="var(--quantum)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>
      <span className="label t-body">
        <Icon name="loader" size={16} className="spin c-quantum" />
        {children}
      </span>
    </div>
  );
}

/// Chart/Price (105:197): smooth series with a quantum gradient area, dot grid,
/// dashed last-value line, crosshair + tooltip on hover, live pill on the Y axis.
/// `band` shades a price range (V3 position), with Min/Max labels and pills.
export function AreaChart({
  points,
  height = 300,
  format = formatPrice,
  unit,
  band,
  line = 'var(--quantum)',
  area = true,
  sub = (p: Point) => stampLabel(p.t),
  now = true,
  loading,
}: {
  points: Point[];
  height?: number;
  format?: (v: number) => string;
  unit?: string;
  band?: { min: number; max: number };
  line?: string;
  area?: boolean;
  sub?: (p: Point) => string;
  now?: boolean;
  /// History is still being read: show the loading placeholder, not "empty".
  loading?: boolean;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const gid = useId().replace(/:/g, '');
  const [hover, setHover] = useState<number | null>(null);
  const plotW = Math.max(0, width - AXIS_W - GAP);

  const geo = useMemo(() => {
    if (points.length < 2 || plotW <= 0) return null;
    const t0 = points[0].t;
    const t1 = points[points.length - 1].t;
    let lo = Math.min(...points.map((p) => p.v));
    let hi = Math.max(...points.map((p) => p.v));
    if (band) {
      lo = Math.min(lo, band.min);
      hi = Math.max(hi, band.max);
    }
    const padV = (hi - lo || Math.abs(hi) * 0.02 || 1) * 0.18;
    lo -= padV;
    hi += padV;
    const x = (t: number) => (t1 > t0 ? ((t - t0) / (t1 - t0)) * plotW : plotW);
    const y = (v: number) => height - ((v - lo) / (hi - lo)) * height;
    const xy = points.map((p) => [x(p.t), y(p.v)] as [number, number]);
    const d = smooth(xy);
    return { t0, t1, lo, hi, x, y, xy, d, fill: `${d} L${plotW},${height} L0,${height} Z` };
  }, [points, plotW, height, band]);

  if (loading && points.length < 2)
    return (
      <div ref={ref}>
        <ChartLoading height={height + 26} />
      </div>
    );
  if (points.length < 2)
    return (
      <div ref={ref}>
        <ChartEmpty height={height + 26}>Not enough on-chain history for this window yet.</ChartEmpty>
      </div>
    );

  const last = points[points.length - 1];
  const hp = hover !== null ? points[hover] : null;
  const ticks = geo ? niceTicks(geo.lo + (geo.hi - geo.lo) * 0.06, geo.hi - (geo.hi - geo.lo) * 0.06, 4) : [];
  const pillY = (v: number) => (geo ? Math.min(height - 22, Math.max(0, geo.y(v) - 11)) : 0);

  return (
    <div className="chart" ref={ref}>
      {geo && (
        <div className="row" style={{ gap: GAP, alignItems: 'flex-start' }}>
          <svg
            width={plotW}
            height={height}
            onMouseLeave={() => setHover(null)}
            onMouseMove={(e) => {
              const box = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
              const mx = e.clientX - box.left;
              let best = 0;
              geo.xy.forEach(([px], i) => Math.abs(px - mx) < Math.abs(geo.xy[best][0] - mx) && (best = i));
              setHover(best);
            }}
          >
            <defs>
              <linearGradient id={`fill-${gid}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#4cc2ff" stopOpacity="0.32" />
                <stop offset="1" stopColor="#4cc2ff" stopOpacity="0" />
              </linearGradient>
            </defs>
            <DotGrid id={gid} w={plotW} h={height} />
            {band && (
              <>
                <rect x={0} y={geo.y(band.max)} width={plotW} height={Math.max(0, geo.y(band.min) - geo.y(band.max))} fill="rgb(76 194 255 / 0.1)" />
                <line x1={0} x2={plotW} y1={geo.y(band.max)} y2={geo.y(band.max)} stroke="var(--quantum)" strokeOpacity="0.6" strokeDasharray="3 4" />
                <line x1={0} x2={plotW} y1={geo.y(band.min)} y2={geo.y(band.min)} stroke="var(--quantum)" strokeOpacity="0.6" strokeDasharray="3 4" />
                <text x={6} y={geo.y(band.max) + 16} className="axis-label" style={{ fill: 'var(--quantum)', fontSize: 12 }}>
                  Max
                </text>
                <text x={6} y={geo.y(band.min) - 6} className="axis-label" style={{ fill: 'var(--quantum)', fontSize: 12 }}>
                  Min
                </text>
              </>
            )}
            {area && <path className="chart-area" d={geo.fill} fill={`url(#fill-${gid})`} />}
            <path className="chart-line" pathLength={1} d={geo.d} fill="none" stroke={line} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <line x1={0} x2={plotW} y1={geo.y(last.v)} y2={geo.y(last.v)} stroke="var(--quantum)" strokeOpacity="0.5" strokeDasharray="2 4" />
            {hp && (
              <>
                <line x1={geo.x(hp.t)} x2={geo.x(hp.t)} y1={0} y2={height} stroke="rgb(255 255 255 / 0.35)" strokeDasharray="3 3" />
                <circle cx={geo.x(hp.t)} cy={geo.y(hp.v)} r={10} fill="var(--quantum)" fillOpacity="0.2" />
                <circle cx={geo.x(hp.t)} cy={geo.y(hp.v)} r={5} fill="var(--bg-deep)" stroke="var(--quantum)" strokeWidth="2" />
              </>
            )}
            <circle cx={plotW} cy={geo.y(last.v)} r={4} fill="var(--quantum)" />
          </svg>
          <div style={{ position: 'relative', width: AXIS_W, height, flex: 'none' }}>
            {ticks
              .filter((v) => [last.v, ...(band ? [band.min, band.max] : [])].every((m) => Math.abs(geo.y(v) - geo.y(m)) > 20))
              .map((v, i) => (
                <span key={i} className="t-num c-3" style={{ position: 'absolute', left: 4, top: geo.y(v) - 9 }}>
                  {format(v)}
                </span>
              ))}
            {band && (
              <>
                <span className="pill band" style={{ left: 0, top: pillY(band.max) }}>
                  {format(band.max)}
                </span>
                <span className="pill band" style={{ left: 0, top: pillY(band.min) }}>
                  {format(band.min)}
                </span>
              </>
            )}
            <span className="pill" style={{ left: 0, top: pillY(last.v) }}>
              {format(last.v)}
            </span>
          </div>
          {hp && (
            <div className="tip" style={{ left: Math.min(geo.x(hp.t) + 13, plotW - 150), top: 4 }}>
              <span>
                {format(hp.v)}
                {unit ? ` ${unit}` : ''}
              </span>
              <span>{sub(hp)}</span>
            </div>
          )}
        </div>
      )}
      {geo && (
        <div className="x-axis" style={{ width: plotW }}>
          {xLabels(geo.t0, geo.t1, plotW < 420 ? 4 : 7, now).map((l, i) => (
            <span key={i}>{l}</span>
          ))}
        </div>
      )}
    </div>
  );
}

/// Chart/Volume (105:231): bars in quantum/dim, the hovered bar in quantum
/// with a tooltip; same dot grid and axes as Chart/Price.
export function BarChart({
  bars,
  height = 260,
  format,
  unit = 'QRL',
  loading,
}: {
  bars: Bar[];
  height?: number;
  format?: (v: number) => string;
  unit?: string;
  loading?: boolean;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const gid = useId().replace(/:/g, '');
  const [hover, setHover] = useState<number | null>(null);
  const plotW = Math.max(0, width - AXIS_W - GAP);
  const fmt = format ?? ((v: number) => (v >= 1 ? v.toLocaleString('en-US', { maximumFractionDigits: v >= 10 ? 0 : 1 }) : formatPrice(v)));
  const max = Math.max(0, ...bars.map((b) => b.v));
  if (loading && (!bars.length || max <= 0))
    return (
      <div ref={ref}>
        <ChartLoading height={height + 26} />
      </div>
    );
  if (!bars.length || max <= 0)
    return (
      <div ref={ref}>
        <ChartEmpty height={height + 26}>No swaps in this window yet.</ChartEmpty>
      </div>
    );
  const top = max * 1.15;
  const slot = plotW / bars.length;
  const bw = Math.max(2, Math.min(18, slot * 0.62));
  const y = (v: number) => height - (v / top) * height;
  const ticks = niceTicks(0, max, 4).filter((v) => v > 0);
  const hb = hover !== null ? bars[hover] : null;
  const t0 = bars[0].t;
  const t1 = bars[bars.length - 1].t1;
  const sameDay = new Date(hb ? hb.t * 1000 : 0).toDateString() === new Date(hb ? hb.t1 * 1000 : 0).toDateString();

  return (
    <div className="chart" ref={ref}>
      <div className="row" style={{ gap: GAP, alignItems: 'flex-start' }}>
        <svg width={plotW} height={height} onMouseLeave={() => setHover(null)}>
          <DotGrid id={gid} w={plotW} h={height} />
          {bars.map((b, i) => {
            const h = Math.max(b.v > 0 ? 2 : 0, height - y(b.v));
            return (
              <g key={i} onMouseEnter={() => setHover(i)}>
                <rect x={i * slot} y={0} width={slot} height={height} fill="transparent" />
                <rect className="chart-bar" style={{ animationDelay: `${Math.min(i, 40) * 12}ms` }} x={i * slot + (slot - bw) / 2} y={height - h} width={bw} height={h} rx={Math.min(3, bw / 2)} fill={hover === i ? 'var(--quantum)' : 'var(--quantum-dim)'} />
              </g>
            );
          })}
        </svg>
        <div style={{ position: 'relative', width: AXIS_W, height, flex: 'none' }}>
          {ticks.map((v, i) => (
            <span key={i} className="t-num c-3" style={{ position: 'absolute', left: 4, top: y(v) - 9 }}>
              {fmt(v)}
            </span>
          ))}
        </div>
        {hb && hover !== null && (
          <div className="tip" style={{ left: Math.min(hover * slot + slot + 6, plotW - 160), top: Math.max(4, y(hb.v) - 60) }}>
            <span>
              {fmt(hb.v)} {unit}
            </span>
            <span>
              {dayLabel(hb.t)} · {clockLabel(hb.t)}–{sameDay ? clockLabel(hb.t1) : stampLabel(hb.t1)}
            </span>
          </div>
        )}
      </div>
      <div className="x-axis" style={{ width: plotW }}>
        {xLabels(t0, t1, plotW < 420 ? 4 : 6, false).map((l, i) => (
          <span key={i}>{l}</span>
        ))}
      </div>
    </div>
  );
}

/// 24h column sparkline in the Tokens table (120×32), green when up.
export function Sparkline({ values, up, width = 120, height = 32 }: { values: number[]; up: boolean; width?: number; height?: number }) {
  if (values.length < 2) return <span className="c-4">—</span>;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const xy = values.map((v, i) => [(i / (values.length - 1)) * width, hi > lo ? height - 2 - ((v - lo) / (hi - lo)) * (height - 4) : height / 2] as [number, number]);
  return (
    <svg width={width} height={height} aria-hidden="true">
      <path className="chart-line" pathLength={1} d={smooth(xy)} fill="none" stroke={up ? 'var(--success)' : 'var(--alert)'} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
