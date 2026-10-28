import { useMemo, useState } from 'react';
import { Sparkline } from '../components/Chart';
import { NoteBar, SubBar } from '../components/Header';
import { Icon, IconButton, Seg, TokenPairIcon } from '../components/ui';
import { ADDRESSES } from '../config';
import { usePoolStats } from '../hooks/market';
import { useNames } from '../hooks/names';
import { usePositions } from '../hooks/pools';
import { useV3Positions } from '../hooks/v3';
import { sameAddress, shortAddress } from '../lib/chain';
import { formatPercent, formatPrice, toFloat } from '../lib/format';
import { WindowKey } from '../lib/history';
import { midPrice, PoolInfo, tvlInQrl } from '../lib/registry';
import { go } from '../lib/router';
import { feeLabel, priceFromTick } from '../lib/v3';
import { useApp } from '../state/app';
import { useWallet } from '../state/wallet';

type VersionFilter = 'All' | 'V3' | 'V2';
type FeeFilter = 'All fees' | '0.05%' | '0.3%' | '1%';
const FEE_OF: Record<FeeFilter, number | null> = { 'All fees': null, '0.05%': 500, '0.3%': 3000, '1%': 10000 };
const COLS = 'minmax(220px, 1fr) 96px 110px 110px 110px 80px 172px';

export function addLiquidity(p: PoolInfo) {
  if (p.version === 'v2') go({ page: 'v2', pair: p.address });
  else go({ page: 'v3new' }, { tokenA: p.token0, tokenB: p.token1, fee: p.fee });
}
const swapPool = (p: PoolInfo) =>
  go({ page: 'swap' }, { inputCurrency: sameAddress(p.token0, ADDRESSES.WQRL) ? 'QRL' : p.token0, outputCurrency: sameAddress(p.token1, ADDRESSES.WQRL) ? 'QRL' : p.token1 });

export function Markets() {
  const { pools, priceInQrl, decimalsOf, tokenByAddress, poolsLoaded } = useApp();
  const { symOf } = useNames();
  const [version, setVersion] = useState<VersionFilter>('All');
  const [fee, setFee] = useState<FeeFilter>('All fees');
  const [window, setWindow] = useState<WindowKey>('24h');
  const [term, setTerm] = useState('');

  const tvlMap = useMemo(() => {
    const prices = new Map<string, number>();
    for (const p of pools) for (const t of [p.token0, p.token1]) { const v = priceInQrl(t); if (v !== undefined) prices.set(t.toLowerCase(), v); }
    return new Map(pools.map((p) => [p.id, tvlInQrl(p, prices, decimalsOf)]));
  }, [pools, priceInQrl, decimalsOf]);
  const tvl = (p: PoolInfo) => tvlMap.get(p.id) ?? null;
  const stats = usePoolStats(pools, window, tvl);
  const totals = useMemo(() => {
    let t = 0, v = 0, f = 0;
    for (const p of pools) {
      t += tvl(p) ?? 0;
      const s = stats.get(p.id);
      v += s?.volume ?? 0;
      f += s?.fees ?? 0;
    }
    return { tvl: t, volume: v, fees: f };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pools, stats, tvlMap]);

  const name = (p: PoolInfo) => `${symOf(p.token0)} / ${symOf(p.token1)}`;
  const price = (p: PoolInfo) => midPrice(p, decimalsOf(p.token0), decimalsOf(p.token1));
  const filtered = pools
    .filter((p) => version === 'All' || p.version === version.toLowerCase())
    .filter((p) => FEE_OF[fee] === null || p.fee === FEE_OF[fee])
    .filter((p) => !term.trim() || name(p).toLowerCase().includes(term.trim().toLowerCase()) || sameAddress(p.address, term.trim()) || sameAddress(p.token0, term.trim()) || sameAddress(p.token1, term.trim()))
    .sort((a, b) => (tvl(b) ?? -1) - (tvl(a) ?? -1));

  const byFeeTvl = [...pools].filter((p) => (tvl(p) ?? 0) > 0).sort((a, b) => (stats.get(b.id)?.fees ?? 0) / (tvl(b) || 1) - (stats.get(a.id)?.fees ?? 0) / (tvl(a) || 1));
  const newest = [...pools].reverse();
  const gainers = [...pools].filter((p) => stats.get(p.id)?.change != null).sort((a, b) => (stats.get(b.id)!.change ?? 0) - (stats.get(a.id)!.change ?? 0));
  const liquid = [...pools].sort((a, b) => (tvl(b) ?? -1) - (tvl(a) ?? -1));
  const v3Count = pools.filter((p) => p.version === 'v3').length;

  return (
    <>
      <SubBar
        icon="plus"
        context="Markets"
        detail="Earn swap fees by providing liquidity"
        meta={`TVL ${formatPrice(totals.tvl)} QRL · Volume ${window} ${formatPrice(totals.volume)} QRL · Fees ${window} ${formatPrice(totals.fees)} QRL · ${pools.length} pools (V3 ${v3Count} · V2 ${pools.length - v3Count})`}
        action={{ label: 'New position', icon: 'plus', onClick: () => go({ page: 'v3new' }) }}
      />
      <div className="body">
        <PositionsRail />
        <main className="canvas">
          <div className="highlights">
            <Highlight title="Top fee / TVL" icon="arrow-up-down" pools={byFeeTvl} metric={(p) => { const s = stats.get(p.id); const t = tvl(p); return s?.fees != null && t ? formatPercent(s.fees / t) : '—'; }} value={(p) => formatPrice(tvl(p) ?? 0)} />
            <Highlight title="New pools" icon="plus" pools={newest} metric={(p) => p.version.toUpperCase()} value={(p) => formatPrice(tvl(p) ?? 0)} />
            <Highlight title="Top movers" icon="arrow-down" pools={gainers} metric={(p) => { const c = stats.get(p.id)?.change ?? 0; return `${c >= 0 ? '+' : '−'}${Math.abs(c * 100).toFixed(2)}%`; }} value={(p) => formatPrice(price(p))} tone={(p) => ((stats.get(p.id)?.change ?? 0) >= 0 ? 'c-quantum' : 'c-alert')} />
            <Highlight title="Most liquid" icon="wallet" pools={liquid} metric={(p) => (totals.tvl > 0 ? `${(((tvl(p) ?? 0) / totals.tvl) * 100).toFixed(0)}%` : '—')} value={(p) => formatPrice(tvl(p) ?? 0)} />
          </div>
          <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
            <Seg options={['All', 'V3', 'V2'] as const} value={version} onChange={setVersion} />
            <Seg options={['All fees', '0.05%', '0.3%', '1%'] as const} value={fee} onChange={setFee} />
            <div className="search-field grow" style={{ minWidth: 200, padding: '7px 12px' }}>
              <Icon name="search" size={18} />
              <input placeholder="Search by token or address" value={term} onChange={(e) => setTerm(e.target.value)} />
            </div>
            <Seg options={['1h', '24h', '7d'] as const} value={window as '1h' | '24h' | '7d'} onChange={setWindow} />
          </div>
          <div className="table" style={{ ['--table-min' as string]: '880px' }}>
            <div className="tr head" style={{ gridTemplateColumns: COLS }}>
              <span>Pool</span>
              <span>Trend</span>
              <span className="num">Price / {window}</span>
              <span className="num c-2">TVL ↓</span>
              <span className="num">Volume {window}</span>
              <span className="num">Fee APR</span>
              <span />
            </div>
            {!poolsLoaded && <div className="table-empty">Loading pools…</div>}
            {poolsLoaded && filtered.length === 0 && <div className="table-empty">No pools match. Create one with New position.</div>}
            {filtered.map((p) => {
              const s = stats.get(p.id);
              const change = s?.change ?? null;
              return (
                <div key={p.id} className="tr clickable" style={{ gridTemplateColumns: COLS }} onClick={() => addLiquidity(p)}>
                  <span className="row" style={{ gap: 10, minWidth: 0 }}>
                    <TokenPairIcon a={tokenByAddress(p.token0)} b={tokenByAddress(p.token1)} size={28} />
                    <span className="col" style={{ gap: 2, minWidth: 0 }}>
                      <span className="row" style={{ gap: 6 }}>
                        <span className="t-body-strong ellipsis">{name(p)}</span>
                        <span className={`badge ${p.version === 'v3' ? 'badge-quantum' : 'badge-neutral'}`}>{p.version.toUpperCase()}</span>
                        <span className="badge badge-neutral">{feeLabel(p.fee)}</span>
                      </span>
                      <span className="t-mono c-4">{shortAddress(p.address)}</span>
                    </span>
                  </span>
                  <span>
                    <Sparkline values={s?.spark ?? []} up={(change ?? 0) >= 0} />
                  </span>
                  <span className="num col" style={{ gap: 0, alignItems: 'flex-end' }}>
                    <span className="t-mono-strong">{formatPrice(price(p))}</span>
                    <span className={`t-mono ${change === null ? 'c-4' : change >= 0 ? 'c-quantum' : 'c-alert'}`}>
                      {change === null ? '—' : `${change >= 0 ? '+' : '−'}${Math.abs(change * 100).toFixed(2)}%`}
                    </span>
                  </span>
                  <span className="num t-mono">{tvl(p) != null ? `${formatPrice(tvl(p)!)} QRL` : '—'}</span>
                  <span className="num t-mono c-2">{s?.volume != null ? `${formatPrice(s.volume)} QRL` : '—'}</span>
                  <span className="num t-mono-strong c-quantum">{s?.feeApr != null ? formatPercent(s.feeApr, 1) : '—'}</span>
                  <span className="row" style={{ justifyContent: 'flex-end' }} onClick={(e) => e.stopPropagation()}>
                    <IconButton icon="arrow-up-down" label="Swap" boxed onClick={() => swapPool(p)} />
                    <button className="btn btn-md btn-primary" onClick={() => addLiquidity(p)}>
                      Add liquidity
                    </button>
                  </span>
                </div>
              );
            })}
          </div>
        </main>
      </div>
      <NoteBar>Fee APR extrapolates the selected window's fees over a year; volume is valued in QRL at current prices. Test tokens have no value.</NoteBar>
    </>
  );
}

function Highlight({
  title,
  icon,
  pools,
  metric,
  value,
  tone,
}: {
  title: string;
  icon: 'arrow-up-down' | 'plus' | 'arrow-down' | 'wallet';
  pools: PoolInfo[];
  metric: (p: PoolInfo) => string;
  value: (p: PoolInfo) => string;
  tone?: (p: PoolInfo) => string;
}) {
  const { tokenByAddress } = useApp();
  const { symOf } = useNames();
  return (
    <section className="hl-card">
      <div className="row" style={{ paddingBottom: 10 }}>
        <Icon name={icon} size={16} className="c-quantum" />
        <span className="t-body-strong">{title}</span>
      </div>
      {pools.length === 0 && <span className="t-caption c-4" style={{ padding: '12px 0' }}>Nothing yet</span>}
      {pools.slice(0, 3).map((p) => (
        <button key={p.id} className="hl-item" onClick={() => addLiquidity(p)}>
          <TokenPairIcon a={tokenByAddress(p.token0)} b={tokenByAddress(p.token1)} size={22} />
          <span className="col grow" style={{ gap: 0 }}>
            <span className="t-label ellipsis">
              {symOf(p.token0)} / {symOf(p.token1)}
            </span>
            <span className="t-caption c-4">
              {p.version.toUpperCase()} · {feeLabel(p.fee)}
            </span>
          </span>
          <span className="col" style={{ gap: 0, alignItems: 'flex-end' }}>
            <span className="t-mono">{value(p)}</span>
            <span className={`t-mono ${tone ? tone(p) : 'c-quantum'}`}>{metric(p)}</span>
          </span>
        </button>
      ))}
    </section>
  );
}

/// The account's V2 and V3 positions, valued in QRL.
export function PositionsRail({ selected }: { selected?: string }) {
  const { account } = useWallet();
  const { openModal, priceInQrl, decimalsOf } = useApp();
  const { symOf } = useNames();
  const v2 = usePositions(account);
  const v3 = useV3Positions(account);
  const [tab, setTab] = useState<'Open' | 'Closed'>('Open');
  const value = (t0: string, a0: bigint, t1: string, a1: bigint) => {
    const p0 = priceInQrl(t0);
    const p1 = priceInQrl(t1);
    return p0 === undefined || p1 === undefined ? null : toFloat(a0, decimalsOf(t0)) * p0 + toFloat(a1, decimalsOf(t1)) * p1;
  };
  const rows = [
    ...(v3 ?? [])
      .filter((p) => (tab === 'Open' ? p.status !== 'closed' : p.status === 'closed'))
      .map((p) => {
        const d0 = decimalsOf(p.token0);
        const d1 = decimalsOf(p.token1);
        const lo = priceFromTick(p.tickLower, d0, d1);
        const hi = priceFromTick(p.tickUpper, d0, d1);
        return {
          key: `v3-${p.id}`,
          title: `${symOf(p.token0)} / ${symOf(p.token1)} · V3`,
          sub: p.status === 'closed' ? `Closed · #${p.id}` : `${p.status === 'in' ? 'In range' : 'Out of range'} · ${formatPrice(lo)} – ${formatPrice(hi)}`,
          value: value(p.token0, p.amount0, p.token1, p.amount1),
          tone: p.status,
          onClick: () => go({ page: 'v3pos', id: p.id }),
        };
      }),
    ...(tab === 'Open' ? v2 ?? [] : []).map((p) => ({
      key: `v2-${p.address}`,
      title: `${symOf(p.token0)} / ${symOf(p.token1)} · V2`,
      sub: `${p.totalSupply > 0n ? formatPercent(Number((p.balance * 1_000_000n) / p.totalSupply) / 1_000_000) : '0%'} of pool`,
      value: p.totalSupply > 0n ? value(p.token0, (p.reserve0 * p.balance) / p.totalSupply, p.token1, (p.reserve1 * p.balance) / p.totalSupply) : null,
      tone: 'in' as const,
      onClick: () => go({ page: 'v2', pair: p.address }),
    })),
  ];
  return (
    <aside className="rail">
      <div style={{ padding: '0 6px 8px' }}>
        <Seg options={['Open', 'Closed'] as const} value={tab} onChange={setTab} />
      </div>
      <div className="rail-head">
        <span className="t-body-strong">Your positions</span>
        <span className="t-caption c-4">value in QRL</span>
      </div>
      {!account && (
        <button className="rail-empty t-body" onClick={() => openModal('connect')}>
          Connect a wallet to see your positions
        </button>
      )}
      {account && (v2 === null || v3 === null) && <div className="rail-empty t-body">Loading positions…</div>}
      {account && v2 && v3 && rows.length === 0 && <div className="rail-empty t-body">{tab === 'Open' ? 'No open positions yet.' : 'No closed positions.'}</div>}
      {rows.map((r, i) => (
        <button key={r.key} className={`rail-row ${selected === r.key ? 'selected' : ''}`} onClick={r.onClick}>
          <span className="rank">{i + 1}</span>
          <span className="col grow" style={{ gap: 0 }}>
            <span className="t-body-strong ellipsis">{r.title}</span>
            <span className={`t-caption ellipsis ${r.tone === 'out' ? 'c-warning' : 'c-3'}`}>{r.sub}</span>
          </span>
          <span className={`t-mono-strong ${selected === r.key ? 'c-1' : 'c-2'}`}>{r.value != null ? formatPrice(r.value) : '—'}</span>
        </button>
      ))}
      <button className="rail-cta" onClick={() => go({ page: 'v3new' })}>
        <Icon name="plus" size={16} /> New position
      </button>
      <div className="tip" style={{ marginTop: 8 }}>
        <span className="t-label c-quantum-bright">How liquidity works</span>
        <span className="t-caption c-2">
          V2 spreads your deposit over every price. V3 lets you pick a range: more fees per QRL while the price stays inside it, nothing while it is outside.
        </span>
      </div>
    </aside>
  );
}
