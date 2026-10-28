import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ADDRESSES } from '../../config';
import { useNames } from '../../hooks/names';
import { sameAddress } from '../../lib/chain';
import { toFloat } from '../../lib/format';
import { PoolInfo, tvlInQrl } from '../../lib/registry';
import { NATIVE, Token } from '../../lib/tokens';
import { useApp } from '../../state/app';
import { Icon } from '../ui';

export const isWqrlAddress = (a: string) => sameAddress(a, ADDRESSES.WQRL);

/// "93.0 QRL", "0.0443 QRL", "—" when unpriced.
export function qrlAmount(n: number | null | undefined, unit = 'QRL'): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  if (n === 0) return `0 ${unit}`;
  const digits = n >= 100 ? 1 : n >= 1 ? 2 : 4;
  return `${n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })} ${unit}`;
}

/// Pool token names with WQRL shown as QRL, and QRL listed first, as the
/// design names pairs ("QRL / TKA").
export function usePairNames() {
  const { tokenByAddress } = useApp();
  const { symOf } = useNames();
  const symbol = useCallback((a: string) => (isWqrlAddress(a) ? 'QRL' : symOf(a)), [symOf]);
  const tokenOf = useCallback((a: string): Token | undefined => (isWqrlAddress(a) ? NATIVE : tokenByAddress(a)), [tokenByAddress]);
  /// [base, quote]: QRL is the base when present, otherwise token0.
  const order = useCallback((t0: string, t1: string): [string, string] => (isWqrlAddress(t1) && !isWqrlAddress(t0) ? [t1, t0] : [t0, t1]), []);
  return { symbol, tokenOf, order };
}

/// TVL of a pool in QRL, from the app's QRL price map.
export function useTvl() {
  const { pools, priceInQrl, decimalsOf } = useApp();
  const prices = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of pools)
      for (const t of [p.token0, p.token1]) {
        const v = priceInQrl(t);
        if (v !== undefined) m.set(t.toLowerCase(), v);
      }
    return m;
  }, [pools, priceInQrl]);
  return useCallback((p: PoolInfo) => tvlInQrl(p, prices, decimalsOf), [prices, decimalsOf]);
}

/// QRL value of two token amounts; null when either token has no QRL price.
export function useValueInQrl() {
  const { priceInQrl, decimalsOf } = useApp();
  return useCallback(
    (t0: string, a0: bigint, t1: string, a1: bigint) => {
      const p0 = priceInQrl(t0);
      const p1 = priceInQrl(t1);
      if (p0 === undefined || p1 === undefined) return null;
      return toFloat(a0, decimalsOf(t0)) * p0 + toFloat(a1, decimalsOf(t1)) * p1;
    },
    [priceInQrl, decimalsOf],
  );
}

/// A trigger with a dropdown menu on the elevated layer.
export function MenuButton({
  trigger,
  className,
  items,
  align = 'right',
}: {
  trigger: ReactNode;
  className: string;
  items: { label: ReactNode; sub?: string; on?: boolean; onClick: () => void }[];
  align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button className={className} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {trigger}
      </button>
      {open && (
        <div className="popover menu" role="menu" style={align === 'left' ? { left: 0, right: 'auto' } : undefined}>
          {items.map((it, i) => (
            <button
              key={i}
              role="menuitem"
              className={it.on ? 'on' : ''}
              onClick={() => {
                setOpen(false);
                it.onClick();
              }}
            >
              <span className="grow">
                {it.label}
                {it.sub && <span className="t-caption c-3">{it.sub}</span>}
              </span>
              {it.on && <Icon name="check" size={16} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export type StepInfo = { title: string; sub?: string; onClick?: () => void };

/// Vertical stepper card (95:680).
export function Stepper({ steps, active }: { steps: StepInfo[]; active: number }) {
  return (
    <div className="card stepper">
      {steps.map((s, i) => {
        const state = i < active ? 'done' : i === active ? 'active' : 'todo';
        const Body = s.onClick && state === 'done' ? 'button' : 'div';
        return (
          <div key={s.title} className={`step ${state}`}>
            <div className="rail">
              <span className="dot">{state === 'done' ? <Icon name="check" size={16} /> : i + 1}</span>
              {i < steps.length - 1 && <span className="line" />}
            </div>
            <Body className="t" onClick={state === 'done' ? s.onClick : undefined}>
              <span className="t-caption c-3">Step {i + 1}</span>
              <span className={`t-body-strong ${state === 'active' ? 'c-1' : 'c-2'}`}>{s.title}</span>
              {state === 'active' && s.sub && <span className="t-caption c-3">{s.sub}</span>}
            </Body>
          </div>
        );
      })}
    </div>
  );
}
