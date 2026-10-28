import { useMemo, useState } from 'react';
import { AreaChart, ChartEmpty, ChartLoading, Point, stampLabel } from '../components/Chart';
import { PositionHeader, qrlText, RatioBar, shownToken, TokenLine } from '../components/position/parts';
import { useV2Value } from '../components/position/useV2Value';
import { RemoveV2Modal } from '../components/RemoveLiquidityModal';
import { Badge, Busy, Crumbs, DetailRow, Empty, Icon, Seg, Stat } from '../components/ui';
import { ADDRESSES } from '../config';
import { usePoolStats } from '../hooks/market';
import { useNames } from '../hooks/names';
import { usePair } from '../hooks/pools';
import { sameAddress, shortAddress } from '../lib/chain';
import { formatAmount, formatPercent, toFloat } from '../lib/format';
import { WINDOWS } from '../lib/history';
import { PoolInfo, tvlInQrl } from '../lib/registry';
import { go, href } from '../lib/router';
import { useApp } from '../state/app';
import { useWallet } from '../state/wallet';
import '../styles/position.css';

const FRAMES = { '1W': WINDOWS['7d'], '1M': WINDOWS['30d'], All: Infinity } as const;
type Frame = keyof typeof FRAMES;

/// Position · V2 (Figma 96:1316).
export function V2Position({ pair: pairAddress }: { pair: string }) {
  const { pools, priceInQrl, decimalsOf, block, blockTime, openModal } = useApp();
  const { account, wrongNetwork, switchChain } = useWallet();
  const { sym } = useNames();
  const { pair, error } = usePair(pairAddress, account);
  const [frame, setFrame] = useState<Frame>('1M');
  const [removing, setRemoving] = useState(false);
  const pool = useMemo(() => pools.find((x) => x.version === 'v2' && sameAddress(x.address, pairAddress)) ?? null, [pools, pairAddress]);
  const statPools = useMemo(() => (pool ? [pool] : []), [pool?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const stats = usePoolStats(statPools, '7d', (x: PoolInfo) => {
    const m = new Map<string, number>();
    for (const t of [x.token0, x.token1]) {
      const v = priceInQrl(t);
      if (v !== undefined) m.set(t.toLowerCase(), v);
    }
    return tvlInQrl(x, m, decimalsOf);
  });
  const series = useV2Value(pool, account);

  const crumbs = (label: string) => <Crumbs items={[{ label: 'Your positions', href: href({ page: 'positions' }) }, { label }]} />;
  if (error)
    return (
      <main className="page pos-page">
        {crumbs(shortAddress(pairAddress))}
        <Empty icon="alert-triangle" title="No PauliSwap V2 pair at this address" />
      </main>
    );
  if (!pair)
    return (
      <main className="page pos-page">
        {crumbs(shortAddress(pairAddress))}
        <Busy className="t-body c-3">Loading pair…</Busy>
      </main>
    );

  const wq0 = sameAddress(pair.token0, ADDRESSES.WQRL);
  const wq1 = sameAddress(pair.token1, ADDRESSES.WQRL);
  const t0 = shownToken(pair.token0Info, pair.token0);
  const t1 = shownToken(pair.token1Info, pair.token1);
  const s0 = wq0 ? 'QRL' : sym(pair.token0Info);
  const s1 = wq1 ? 'QRL' : sym(pair.token1Info);
  const d0 = pair.token0Info.decimals;
  const d1 = pair.token1Info.decimals;
  const share = pair.totalSupply > 0n ? Number((pair.balance * 1_000_000_000n) / pair.totalSupply) / 1e9 : 0;
  const a0 = pair.totalSupply > 0n ? (pair.reserve0 * pair.balance) / pair.totalSupply : 0n;
  const a1 = pair.totalSupply > 0n ? (pair.reserve1 * pair.balance) / pair.totalSupply : 0n;
  const q0 = priceInQrl(pair.token0);
  const q1 = priceInQrl(pair.token1);
  const v0 = q0 === undefined ? null : toFloat(a0, d0) * q0;
  const v1 = q1 === undefined ? null : toFloat(a1, d1) * q1;
  const value = v0 === null || v1 === null ? null : v0 + v1;
  const share0 = value && v0 !== null ? v0 / value : null;
  const feeApr = pool ? stats.get(pool.id)?.feeApr ?? null : null;

  // Window the value series; carry the last value before the window start.
  const now = blockTime(block);
  const span = FRAMES[frame];
  let points: Point[] = series ?? [];
  if (Number.isFinite(span) && points.length) {
    const start = now - span;
    const before = points.filter((x) => x.t < start).pop();
    points = [...(before ? [{ t: start, v: before.v }] : []), ...points.filter((x) => x.t >= start)];
  }
  const change = points.length >= 2 ? points[points.length - 1].v - points[0].v : null;

  const gate = (fn: () => void) => () => {
    if (!account) return openModal('connect');
    if (wrongNetwork) return void switchChain().catch(() => undefined);
    fn();
  };
  const noLp = !!account && pair.balance === 0n;
  const addLink = () =>
    go({ page: 'newPosition' }, { version: 'v2', tokenA: wq0 ? 'QRL' : pair.token0, tokenB: wq1 ? 'QRL' : pair.token1 });

  return (
    <main className="page pos-page">
      {crumbs(`${s0} / ${s1} V2`)}
      <PositionHeader
        a={t0}
        b={t1}
        title={`${s0} / ${s1}`}
        badges={
          <>
            <Badge>V2</Badge>
            <Badge>0.3%</Badge>
            <Badge>Full range</Badge>
          </>
        }
        actions={
          <>
            <button className="btn btn-md btn-tertiary" disabled={noLp} title={noLp ? 'This wallet holds no LP tokens of this pair' : undefined} onClick={gate(() => setRemoving(true))}>
              Remove liquidity
            </button>
            <button className="btn btn-md btn-primary" onClick={addLink}>
              Add liquidity
            </button>
          </>
        }
      />

      <div className="pos-cols">
        <div className="pos-main">
          <div className="stat-cards">
            <div className="card">
              <Stat label="Pool share" value={account ? formatPercent(share) : '—'} />
            </div>
            <div className="card">
              <Stat label="LP tokens" value={account ? formatAmount(pair.balance, 18, 2) : '—'} />
            </div>
            <div className="card">
              <Stat label="Fee APR (7d)" value={feeApr !== null ? formatPercent(feeApr, 1) : '—'} />
            </div>
          </div>

          <section className="card pos-card">
            <div className="row" style={{ alignItems: 'flex-start' }}>
              <div className="col" style={{ gap: 2 }}>
                <span className="t-label c-3">Position value</span>
                <span className="pos-big">{account ? qrlText(value) : '—'}</span>
                {change !== null && Math.abs(change) > 0 && (
                  <span className={`t-num ${change >= 0 ? 'c-success' : 'c-alert'}`}>
                    {change >= 0 ? '▲' : '▼'} {qrlText(Math.abs(change))} over {frame === 'All' ? 'the position’s life' : `the past ${frame === '1W' ? 'week' : 'month'}`}
                  </span>
                )}
              </div>
              <span className="grow" />
              <Seg boxed options={Object.keys(FRAMES) as Frame[]} value={frame} onChange={setFrame} />
            </div>
            {!account ? (
              <ChartEmpty height={226}>Connect a wallet to chart your position.</ChartEmpty>
            ) : series === null ? (
              <ChartLoading height={226}>Reading pair history…</ChartLoading>
            ) : (
              <AreaChart points={points} height={200} format={(v) => v.toFixed(2)} unit="QRL" sub={(pt) => `${stampLabel(pt.t)} · position value`} />
            )}
          </section>
        </div>

        <aside className="pos-side">
          <section className="card pos-card">
            <span className="t-label c-3">Pooled tokens</span>
            <RatioBar share={account ? share0 : null} left={t0} right={t1} />
            <TokenLine token={t0} symbol={s0} amount={account ? a0 : null} decimals={d0} pct={account ? share0 : null} />
            <TokenLine token={t1} symbol={s1} amount={account ? a1 : null} decimals={d1} pct={!account || share0 === null ? null : 1 - share0} />
          </section>

          <section className="card pos-card tight">
            <span className="row t-body-strong" style={{ gap: 8 }}>
              <Icon name="layers" size={18} className="c-2" />
              How V2 fees work
            </span>
            <span className="t-body c-2">
              Every trade pays 0.3% into the pool. Fees stay in the reserves, so your LP tokens are worth more over time; they are paid out when you remove liquidity.
            </span>
          </section>

          <section className="card pos-card tight">
            <DetailRow label="Pair" value={shortAddress(pair.address)} />
            <DetailRow label="LP token" value="V2 LP (pair contract)" />
            <DetailRow label="Router" value="PauliV2Router02" />
          </section>
        </aside>
      </div>

      {removing && account && <RemoveV2Modal pair={pair} account={account} onClose={() => setRemoving(false)} />}
    </main>
  );
}
