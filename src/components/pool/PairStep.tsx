import { useState } from 'react';
import { useNames } from '../../hooks/names';
import { sameAddress } from '../../lib/chain';
import { PoolInfo } from '../../lib/registry';
import { Token, wrappedAddress } from '../../lib/tokens';
import { FEE_TIERS, feeLabel, sortTokens } from '../../lib/v3';
import { useApp } from '../../state/app';
import { Badge, Icon, TokenIcon } from '../ui';
import { qrlAmount, useTvl } from './common';

const TIER_HINT: Record<number, string> = { 500: 'Stable pairs', 3000: 'Most pairs', 10000: 'Exotic pairs' };

/// The pool for a pair, V2 or V3 at `fee`, if it exists on chain.
export function findPool(pools: PoolInfo[], version: 'v2' | 'v3', a: Token | null, b: Token | null, fee?: number): PoolInfo | undefined {
  if (!a || !b) return undefined;
  const [t0, t1] = sortTokens(wrappedAddress(a), wrappedAddress(b));
  return pools.find((p) => p.version === version && (version === 'v2' || p.fee === fee) && sameAddress(p.token0, t0) && sameAddress(p.token1, t1));
}

function TokenField({ token, onClick }: { token: Token | null; onClick: () => void }) {
  const { sym } = useNames();
  return (
    <button className="token-field" onClick={onClick}>
      {token ? (
        <>
          <TokenIcon token={token} size={32} />
          <span className="t-heading">{sym(token)}</span>
          <span className="name">{token.native ? 'Quantum Resistant Ledger' : token.name}</span>
        </>
      ) : (
        <span className="t-heading c-3">Select token</span>
      )}
      <span className="grow" />
      <Icon name="chevron-down" size={20} className="c-2" />
    </button>
  );
}

/// Step 1: pick the pair and, for V3, the fee tier (95:698).
export function PairStep({
  version,
  tokenA,
  tokenB,
  fee,
  onFee,
  onPick,
  onContinue,
}: {
  version: 'v2' | 'v3';
  tokenA: Token | null;
  tokenB: Token | null;
  fee: number;
  onFee: (f: number) => void;
  onPick: (side: 'A' | 'B') => void;
  onContinue: () => void;
}) {
  const { pools, poolsLoaded } = useApp();
  const tvl = useTvl();
  const [showTiers, setShowTiers] = useState(true);
  const valid = !!tokenA && !!tokenB && !sameAddress(wrappedAddress(tokenA), wrappedAddress(tokenB));
  const tiers = FEE_TIERS.map((t) => {
    const p = findPool(pools, 'v3', tokenA, tokenB, t.fee);
    return { ...t, pool: p, tvl: p ? tvl(p) : null };
  });
  const deepest = tiers.reduce<(typeof tiers)[number] | null>((best, t) => ((t.tvl ?? -1) > (best?.tvl ?? -1) ? t : best), null);
  const selected = tiers.find((t) => t.fee === fee);
  const v2Pool = findPool(pools, 'v2', tokenA, tokenB);
  const v2Tvl = v2Pool ? tvl(v2Pool) : null;

  return (
    <div className="card np-card">
      <div className="head">
        <span className="t-heading">Select pair</span>
        <span className="t-body c-3">Pick the two tokens you want to provide. QRL is wrapped to WQRL automatically.</span>
      </div>
      <div className="pair-fields">
        <TokenField token={tokenA} onClick={() => onPick('A')} />
        <TokenField token={tokenB} onClick={() => onPick('B')} />
      </div>

      {version === 'v3' ? (
        <>
          <div className="head">
            <span className="t-heading">Fee tier</span>
            <span className="t-body c-3">Higher tiers pay more per trade and suit volatile pairs.</span>
          </div>
          <div className="selected-tier">
            <div className="col" style={{ gap: 2 }}>
              <span className="row" style={{ gap: 8 }}>
                <span className="t-body-strong">{feeLabel(fee)} fee tier</span>
                {selected?.pool && deepest?.fee === fee && (deepest.tvl ?? 0) > 0 && <Badge tone="quantum">Highest TVL</Badge>}
                {valid && poolsLoaded && !selected?.pool && <Badge tone="warning">New pool</Badge>}
              </span>
              <span className="t-caption c-3">The share of each trade you earn</span>
            </div>
            <span className="grow" />
            <button className="btn btn-sm btn-tertiary" onClick={() => setShowTiers((s) => !s)}>
              {showTiers ? 'Less' : 'More'}
            </button>
          </div>
          {showTiers && (
            <div className="tiers">
              {tiers.map((t) => (
                <button key={t.fee} className={`tier${t.fee === fee ? ' on' : ''}`} onClick={() => onFee(t.fee)}>
                  <span className="h">
                    {t.label}
                    <span className="grow" />
                    {t.fee === fee && <Icon name="circle-check" size={18} />}
                  </span>
                  <span className="t-caption c-2">{TIER_HINT[t.fee]}</span>
                  {t.pool ? (
                    <span className="t-num c-3">{t.tvl !== null ? `${qrlAmount(t.tvl)} TVL` : 'TVL not priced'}</span>
                  ) : (
                    <>
                      <span className="t-num c-4">{valid && poolsLoaded ? 'Not created' : '—'}</span>
                      {valid && poolsLoaded && <span className="t-caption c-warning">Creates a new pool</span>}
                    </>
                  )}
                </button>
              ))}
            </div>
          )}
        </>
      ) : (
        valid && (
          <div className="selected-tier">
            <div className="col" style={{ gap: 2 }}>
              <span className="row" style={{ gap: 8 }}>
                <span className="t-body-strong">0.3% fee · full range</span>
                {v2Pool ? <Badge tone="quantum">Existing pool</Badge> : <Badge tone="warning">New pool</Badge>}
              </span>
              <span className="t-caption c-3">
                {v2Pool ? `${v2Tvl !== null ? `${qrlAmount(v2Tvl)} TVL` : 'TVL not priced'} · fees compound into the LP tokens` : 'Your deposit creates the pair and sets its starting price'}
              </span>
            </div>
          </div>
        )
      )}

      <button className="btn btn-lg btn-primary btn-block" disabled={!valid} onClick={onContinue}>
        {valid ? 'Continue' : 'Select two different tokens'}
      </button>
    </div>
  );
}
