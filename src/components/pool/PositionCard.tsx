import { V3Position } from '../../hooks/v3';
import { Position } from '../../hooks/pools';
import { formatAmount, formatPercent, formatPrice } from '../../lib/format';
import { href } from '../../lib/router';
import { feeLabel, priceFromTick } from '../../lib/v3';
import { useApp } from '../../state/app';
import { Badge, PairIcon } from '../ui';
import { qrlAmount, usePairNames } from './common';

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

const apr = (v: number | null) => (v === null ? '—' : formatPercent(v, 1));

/// Position card (89:409) for a V3 position NFT.
export function PositionCard({ position: p, liquidity, fees, apr: feeApr }: { position: V3Position; liquidity: number | null; fees: number | null; apr: number | null }) {
  const { decimalsOf } = useApp();
  const { symbol, tokenOf, order } = usePairNames();
  const [base, quote] = order(p.token0, p.token1);
  const flipped = base !== p.token0;
  const d0 = decimalsOf(p.token0);
  const d1 = decimalsOf(p.token1);
  // Prices are quote per base; with token1 as base the tick prices invert.
  const lo = priceFromTick(p.tickLower, d0, d1);
  const hi = priceFromTick(p.tickUpper, d0, d1);
  const [min, max] = flipped ? [1 / hi, 1 / lo] : [lo, hi];
  const current = p.pool ? (flipped ? 1 / priceFromTick(p.pool.tick, d0, d1) : priceFromTick(p.pool.tick, d0, d1)) : null;
  const unit = `${symbol(quote)} per ${symbol(base)}`;
  const status = { in: ['success', 'In range'], out: ['warning', 'Out of range'], closed: ['alert', 'Closed'] }[p.status] as ['success', string];
  return (
    <a className={`position-card${p.status === 'closed' ? ' closed' : ''}`} href={href({ page: 'v3pos', id: p.id })}>
      <div className="left">
        <div className="title">
          <PairIcon a={tokenOf(base)} b={tokenOf(quote)} size={32} />
          <span className="t-heading">
            {symbol(base)} / {symbol(quote)}
          </span>
          <Badge tone="quantum">V3</Badge>
          <Badge>{feeLabel(p.fee)}</Badge>
          <Badge tone={status[0]}>{status[1]}</Badge>
        </div>
        <span className="t-num c-3">
          Min {formatPrice(min)} · Max {formatPrice(max)} {unit}
          {p.status === 'out' && current !== null ? ` · current ${formatPrice(current)}` : ''}
          {` · #${p.id}`}
        </span>
      </div>
      <Metric label="Liquidity" value={p.status === 'closed' ? '0 QRL' : qrlAmount(liquidity)} />
      <Metric label="Fees earned" value={qrlAmount(fees)} />
      <Metric label="APR" value={p.status === 'in' ? apr(feeApr) : '—'} />
    </a>
  );
}

/// Position card for V2 LP tokens: full range, fees compound into the reserves.
export function V2Card({ position: p, liquidity, apr: feeApr }: { position: Position; liquidity: number | null; apr: number | null }) {
  const { symbol, tokenOf, order } = usePairNames();
  const [base, quote] = order(p.token0, p.token1);
  const share = p.totalSupply > 0n ? Number((p.balance * 1_000_000n) / p.totalSupply) / 1_000_000 : 0;
  return (
    <a className="position-card" href={href({ page: 'v2pos', pair: p.address })}>
      <div className="left">
        <div className="title">
          <PairIcon a={tokenOf(base)} b={tokenOf(quote)} size={32} />
          <span className="t-heading">
            {symbol(base)} / {symbol(quote)}
          </span>
          <Badge>V2</Badge>
          <Badge>0.3%</Badge>
          <Badge>Full range</Badge>
        </div>
        <span className="t-num c-3">
          Pool share {formatPercent(share)} · {formatAmount(p.balance, 18, 2)} LP tokens
        </span>
      </div>
      <Metric label="Liquidity" value={qrlAmount(liquidity)} />
      <Metric label="Fees earned" value="Auto-compounded" />
      <Metric label="APR" value={apr(feeApr)} />
    </a>
  );
}

