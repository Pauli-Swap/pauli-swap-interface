import { useMemo, useRef, useState } from 'react';
import { formatPrice } from '../lib/format';
import { useWidth } from './Chart';

export type DistBar = { price: number; liquidity: number };

const BUCKETS = 44;

/// Liquidity histogram (95:900): active liquidity around the current price,
/// the selected range shaded between two draggable handles, and a dashed line
/// at the current price. `zoom` narrows or widens the visible price window.
export function RangeChart({
  bars,
  current,
  min,
  max,
  onChange,
  zoom = 1,
  height = 180,
}: {
  bars: DistBar[];
  current: number;
  min: number;
  max: number;
  onChange: (min: number, max: number) => void;
  zoom?: number;
  height?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const svg = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<'min' | 'max' | null>(null);

  const domain = useMemo(() => {
    const half = 0.2 / zoom;
    let lo = current * (1 - half);
    let hi = current * (1 + half);
    // Keep a finite range in view, but never zoom out past 4× the price.
    if (min > 0 && min < lo) lo = Math.max(current / 4, min - (current - min) * 0.15);
    if (Number.isFinite(max) && max > hi) hi = Math.min(current * 4, max + (max - current) * 0.15);
    return { lo: Math.max(lo, 0), hi };
    // The window only re-centres when the price or zoom changes, not while dragging.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, zoom, drag === null ? min : 0, drag === null ? max : 0]);

  const x = (p: number) => ((p - domain.lo) / (domain.hi - domain.lo)) * width;
  const priceAt = (px: number) => domain.lo + (Math.min(Math.max(px, 0), width) / width) * (domain.hi - domain.lo);

  const heights = useMemo(() => {
    if (!bars.length) return [];
    const sorted = [...bars].sort((a, b) => a.price - b.price);
    const nearest = (p: number) => {
      let best = sorted[0];
      for (const b of sorted) if (Math.abs(b.price - p) < Math.abs(best.price - p)) best = b;
      // Outside the sampled window there is no data, not zero liquidity.
      return p < sorted[0].price || p > sorted[sorted.length - 1].price ? 0 : best.liquidity;
    };
    const values = Array.from({ length: BUCKETS }, (_, i) => nearest(domain.lo + ((i + 0.5) / BUCKETS) * (domain.hi - domain.lo)));
    const top = Math.max(...values);
    return values.map((v) => (top > 0 ? v / top : 0));
  }, [bars, domain]);

  const full = !(min > 0) && !Number.isFinite(max);
  const xMin = full ? 0 : Math.max(0, Math.min(width, x(min)));
  const xMax = full ? width : Math.max(0, Math.min(width, x(max)));
  const slot = width / BUCKETS;
  const ticks = Array.from({ length: 5 }, (_, i) => domain.lo + ((domain.hi - domain.lo) * i) / 4);

  const onMove = (e: React.PointerEvent) => {
    if (!drag || !svg.current) return;
    const p = priceAt(e.clientX - svg.current.getBoundingClientRect().left);
    if (drag === 'min') onChange(Math.min(p, (Number.isFinite(max) ? max : domain.hi) * 0.999), max);
    else onChange(min > 0 ? min : domain.lo, Math.max(p, (min > 0 ? min : domain.lo) * 1.001));
  };

  const handle = (which: 'min' | 'max', hx: number) => (
    <g className="handle" onPointerDown={(e) => {
      (e.target as Element).setPointerCapture?.(e.pointerId);
      if (full) onChange(which === 'min' ? priceAt(hx) : domain.lo, which === 'max' ? priceAt(hx) : domain.hi);
      setDrag(which);
    }}>
      <rect x={hx - 8} y={0} width={16} height={height} fill="transparent" />
      <line x1={hx} x2={hx} y1={0} y2={height} stroke="var(--quantum)" strokeWidth="2" />
      <rect x={hx - 4} y={height / 2 - 11} width={8} height={22} rx={3} fill="var(--quantum)" />
    </g>
  );

  return (
    <div className="range-chart" ref={ref}>
      {width > 0 && (
        <svg ref={svg} width={width} height={height} onPointerMove={onMove} onPointerUp={() => setDrag(null)} onPointerLeave={() => setDrag(null)}>
          <rect x={xMin} y={0} width={Math.max(0, xMax - xMin)} height={height} fill="rgb(76 194 255 / 0.1)" />
          {heights.map((h, i) => {
            const bh = Math.max(h > 0 ? 3 : 0, h * (height - 12));
            const cx = i * slot + slot / 2;
            const inside = cx >= xMin && cx <= xMax;
            return <rect key={i} x={i * slot + 1} y={height - bh} width={Math.max(1, slot - 2)} height={bh} rx={1.5} fill="var(--quantum-dim)" opacity={inside ? 1 : 0.7} />;
          })}
          <line x1={x(current)} x2={x(current)} y1={0} y2={height} stroke="rgb(255 255 255 / 0.55)" strokeDasharray="3 3" />
          {handle('min', xMin)}
          {handle('max', xMax)}
        </svg>
      )}
      <div className="x-axis t-num c-3 between" style={{ marginTop: 12 }}>
        {ticks.map((t, i) => (
          <span key={i}>{formatPrice(t)}</span>
        ))}
      </div>
    </div>
  );
}
