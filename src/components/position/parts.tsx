import { ReactNode } from 'react';
import { ADDRESSES } from '../../config';
import { sameAddress } from '../../lib/chain';
import { formatAmount } from '../../lib/format';
import { isWqrl, NATIVE, Token } from '../../lib/tokens';
import { PairIcon, TokenIcon } from '../ui';

/// QRL value with the precision the position screens use ("42.18 QRL").
export function qrlText(n: number | null | undefined, unit = 'QRL'): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  const s =
    n === 0
      ? '0'
      : n >= 1000
        ? n.toLocaleString('en-US', { maximumFractionDigits: 1, minimumFractionDigits: 1 })
        : n >= 1
          ? n.toFixed(2)
          : n.toPrecision(3);
  return unit ? `${s} ${unit}` : s;
}

/// WQRL is shown as QRL everywhere a position pays out or takes deposits.
export const shownToken = (t: Token | undefined, address: string): Token | undefined =>
  sameAddress(address, ADDRESSES.WQRL) || (t && isWqrl(t)) ? NATIVE : t;

/// Pair header (96:1000): 44.8px pair icon, 28px title, badges, actions.
export function PositionHeader({ a, b, title, badges, actions }: { a?: Token; b?: Token; title: string; badges: ReactNode; actions: ReactNode }) {
  return (
    <div className="pos-header">
      <PairIcon a={a} b={b} size={45} />
      <div className="col" style={{ gap: 6 }}>
        <h1 className="t-headline">{title}</h1>
        <div className="row" style={{ gap: 6 }}>
          {badges}
        </div>
      </div>
      <span className="grow" />
      <div className="pos-actions">{actions}</div>
    </div>
  );
}

/// Two-tone ratio bar (96:1071): the QRL side in QRL orange, the other side in
/// quantum blue.
export function RatioBar({ share, left, right }: { share: number | null; left?: Token; right?: Token }) {
  if (share === null || !Number.isFinite(share)) return null;
  const tone = (t?: Token) => (t?.native || isWqrl(t) ? 'var(--qrl)' : 'var(--quantum)');
  const l = tone(left);
  const r = tone(right);
  return (
    <div className="ratio-bar thin">
      <span style={{ width: `${Math.max(2, Math.min(98, share * 100))}%`, background: l === r ? 'var(--quantum-dim)' : l }} />
      <span style={{ flex: 1, background: r }} />
    </div>
  );
}

/// Token line inside a card: icon, symbol, amount, optional % chip.
export function TokenLine({ token, symbol, amount, decimals, pct, prefix = '', suffix = '' }: { token?: Token; symbol: string; amount: bigint | null; decimals: number; pct?: number | null; prefix?: string; suffix?: string }) {
  return (
    <div className="token-line">
      <TokenIcon token={token} size={24} />
      <span className="t-body-strong">{symbol}</span>
      <span className="grow" />
      <span className="t-num-strong">
        {amount === null ? '—' : `${prefix}${formatAmount(amount, decimals, 4)}${suffix}`}
      </span>
      {pct !== undefined && pct !== null && Number.isFinite(pct) && <span className="pct-chip">{Math.round(pct * 100)}%</span>}
    </div>
  );
}
