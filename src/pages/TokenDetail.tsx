import { ReactNode, useEffect, useMemo, useState } from 'react';
import { AreaChart, BarChart, Point } from '../components/Chart';
import { SwapWidget } from '../components/SwapWidget';
import { fmtQrl, PoolsTable } from '../components/tables';
import { Busy, CopyAddress, Crumbs, Empty, explorerHref, IconButton, Seg, Skeleton, Stat, TokenIcon } from '../components/ui';
import { ADDRESSES, CHAIN } from '../config';
import { useBalances } from '../hooks/chain';
import { bucketSum, DAY, poolsOf, useBasePrice, usePoolEvents, useQrlPool, useTokenFacts, useValuation } from '../hooks/explore';
import { useFaucets } from '../hooks/faucet';
import { useNames } from '../hooks/names';
import { sameAddress, shortAddress } from '../lib/chain';
import { formatAmount, formatPrice, toFloat } from '../lib/format';
import { PoolInfo } from '../lib/registry';
import { href } from '../lib/router';
import { fetchTokenMetadata, isWqrl, NATIVE, Token, wrappedAddress } from '../lib/tokens';
import { useApp } from '../state/app';
import { useWallet } from '../state/wallet';

export const TIMEFRAMES = { '1H': 3600, '1D': DAY, '1W': 7 * DAY, '1M': 30 * DAY, All: Infinity } as const;
export type Timeframe = keyof typeof TIMEFRAMES;
type Metric = 'price' | 'volume' | 'tvl';

export function sharePage() {
  navigator.clipboard?.writeText(window.location.href);
}

/// Token detail (93:798).
export function TokenDetail({ address }: { address: string }) {
  const { tokenByAddress } = useApp();
  const native = address.toUpperCase() === 'QRL';
  const known = native ? NATIVE : tokenByAddress(address);
  const [fetched, setFetched] = useState<Token | null | 'missing'>(null);
  useEffect(() => {
    if (native || known) return;
    fetchTokenMetadata(address)
      .then(setFetched)
      .catch(() => setFetched('missing'));
  }, [address, native, known]);
  const token = known ?? (fetched && fetched !== 'missing' ? fetched : null);

  if (!token)
    return (
      <main className="page">
        <Crumbs items={[{ label: 'Explore', href: href({ page: 'explore', tab: 'tokens' }) }, { label: 'Tokens', href: href({ page: 'explore', tab: 'tokens' }) }, { label: shortAddress(address) }]} />
        {fetched === 'missing' ? (
          <Empty icon="alert-triangle" title="Token not found">
            No SQRC-TF1 token answers at {shortAddress(address, 6)} on {CHAIN.name}.
          </Empty>
        ) : (
          <Empty icon="loader" title="Loading token…" />
        )}
      </main>
    );
  return <TokenView token={token} />;
}

function TokenView({ token }: { token: Token }) {
  const { pools, priceInQrl, clock, poolsLoaded } = useApp();
  const wait = (v: ReactNode, w = 96) => (poolsLoaded ? v : <Skeleton w={w} h={24} />);
  const { account } = useWallet();
  const { sym, symOf } = useNames();
  const { amountQrl, eventQrl } = useValuation();
  const basePrice = useBasePrice();
  const facts = useTokenFacts(token);
  const { amountOf, claim, formatFaucet } = useFaucets();
  const balanceOf = useBalances([token], account);
  const [tf, setTf] = useState<Timeframe>('1D');
  const [metric, setMetric] = useState<Metric>('price');

  const addr = wrappedAddress(token);
  const mine = useMemo(() => poolsOf(pools, token), [pools, token]);
  const rows = usePoolEvents(mine, Infinity);
  const qrlPool = useQrlPool(token, pools);
  const deepest = useMemo(() => [...mine].sort((a, b) => (amountQrl(addr, side(b, addr)) ?? 0) - (amountQrl(addr, side(a, addr)) ?? 0))[0] ?? null, [mine, amountQrl, addr]);
  const chartPool = qrlPool ?? deepest;
  const counter = chartPool ? (sameAddress(chartPool.token0, addr) ? chartPool.token1 : chartPool.token0) : null;
  const unit = counter ? (sameAddress(counter, ADDRESSES.WQRL) ? 'QRL' : symOf(counter)) : 'QRL';
  const qrlUnit = unit === 'QRL' && !token.native && !isWqrl(token);

  const now = clock.latestTime;
  const since = now - TIMEFRAMES[tf];
  const price = useMemo(() => (chartPool && rows ? basePrice(chartPool, addr, rows, since) : []), [chartPool, rows, addr, since, basePrice]);
  const day = useMemo(() => (chartPool && rows ? basePrice(chartPool, addr, rows, now - DAY) : []), [chartPool, rows, addr, now, basePrice]);
  const current = day.length ? day[day.length - 1].v : qrlUnit ? priceInQrl(token) : undefined;
  const dayChange = day.length >= 2 && day[0].v > 0 ? { abs: day[day.length - 1].v - day[0].v, rel: day[day.length - 1].v / day[0].v - 1 } : null;

  const swapsIn = (from: number) =>
    (rows ?? []).filter((r) => r.e.kind === 'swap' && r.t >= from).map((r) => ({ t: r.t, v: eventQrl(r.pool, r.e) ?? 0 }));
  const vol24 = rows ? swapsIn(now - DAY).reduce((s, x) => s + x.v, 0) : null;
  const tvlNow = mine.reduce((s, p) => s + (amountQrl(addr, side(p, addr)) ?? 0), 0);

  const tvlSeries = useMemo(() => {
    if (!rows) return [];
    const res = new Map(mine.map((p) => [p.id, side(p, addr)]));
    const value = () => [...res].reduce((s, [, r]) => s + (amountQrl(addr, r) ?? 0), 0);
    const pts: Point[] = [{ t: now, v: value() }];
    for (const r of rows) {
      if (r.t < since) break;
      const flow = sameAddress(r.pool.token0, addr) ? r.e.amount0 : r.e.amount1;
      res.set(r.pool.id, (res.get(r.pool.id) ?? 0n) - flow);
      pts.push({ t: r.t, v: value() });
    }
    const out = pts.reverse();
    if (out.length && Number.isFinite(since) && out[0].t > since) out.unshift({ t: Math.max(since, out[0].t - 1), v: out[0].v });
    return out;
  }, [rows, mine, addr, amountQrl, now, since]);

  const volumeBars = useMemo(() => {
    const items = swapsIn(since);
    const t0 = Number.isFinite(since) ? since : items.length ? Math.min(...items.map((x) => x.t)) : now - DAY;
    return bucketSum(items, t0, now, 24);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, since, now]);

  const priceQrl = priceInQrl(token);
  const faucet = amountOf(token);
  const bal = balanceOf(token);
  const explorer = token.native ? undefined : explorerHref('address', token.address);
  const fmt = (v: number) => formatPrice(v);

  return (
    <main className="page" style={{ gap: 24, paddingTop: 24 }}>
      <Crumbs items={[{ label: 'Explore', href: href({ page: 'explore', tab: 'tokens' }) }, { label: 'Tokens', href: href({ page: 'explore', tab: 'tokens' }) }, { label: sym(token) }]} />
      <div className="detail-head">
        <TokenIcon token={token} size={48} />
        <div className="col" style={{ gap: 4 }}>
          <div className="name">
            <h1>{token.native ? 'QRL' : token.name}</h1>
            <span className="t-heading c-3">{token.native ? 'Native coin' : sym(token)}</span>
          </div>
          <div className="meta">
            {!token.native && <CopyAddress address={token.address} />}
            <span className="t-caption">
              {token.native ? `Native coin of ${CHAIN.name} · 18 decimals` : `· ${token.decimals} decimals${faucet && faucet > 0n ? ' · faucet()' : ''}`}
            </span>
          </div>
        </div>
        <div className="actions">
          <IconButton icon="share" label="Copy page link" onClick={sharePage} />
          {explorer && <IconButton icon="external-link" label="View on QRL explorer" href={explorer} />}
        </div>
      </div>
      <hr className="divider" />
      <div className="detail-cols">
        <div className="detail-main">
          <div className="price-head col" style={{ gap: 4 }}>
            <div className="row" style={{ alignItems: 'baseline' }}>
              <span className="big">{wait(current !== undefined ? fmt(current) : '—', 140)}</span>
              <span className="unit">{unit}</span>
            </div>
            {dayChange ? (
              <span className={`t-num ${dayChange.rel >= 0 ? 'c-success' : 'c-alert'}`}>
                {dayChange.rel >= 0 ? '▲' : '▼'} {fmt(Math.abs(dayChange.abs))} ({Math.abs(dayChange.rel * 100).toFixed(2)}%) · past day
              </span>
            ) : !poolsLoaded || (chartPool && !rows) ? (
              <Busy size={14} className="t-num c-3">
                {!poolsLoaded ? 'Loading pools…' : 'Reading trades…'}
              </Busy>
            ) : (
              <span className="t-num c-3">{chartPool ? 'No trades in the past day' : 'Not in any pool yet'}</span>
            )}
          </div>
          <div style={{ marginTop: 16 }}>
            {metric === 'price' && <AreaChart points={price} height={300} unit={unit} loading={!poolsLoaded || (!!chartPool && !rows)} />}
            {metric === 'volume' && <BarChart bars={volumeBars} height={300} format={(v) => fmtQrl(v, '')} loading={!poolsLoaded || (mine.length > 0 && !rows)} />}
            {metric === 'tvl' && <AreaChart points={tvlSeries} height={300} unit="QRL" format={(v) => fmtQrl(v, '')} loading={!poolsLoaded || (mine.length > 0 && !rows)} />}
          </div>
          <div className="chart-controls" style={{ marginTop: 16 }}>
            <Seg boxed options={Object.keys(TIMEFRAMES) as Timeframe[]} value={tf} onChange={setTf} />
            <Seg boxed options={['price', 'volume', 'tvl'] as const} labels={{ price: 'Price', volume: 'Volume', tvl: 'TVL' }} value={metric} onChange={setMetric} />
          </div>
          <h2 className="section-title" style={{ marginTop: 16 }}>
            Stats
          </h2>
          <div className="stats-grid" style={{ marginTop: 16 }}>
            <Stat label="TVL" value={wait(fmtQrl(tvlNow))} />
            <Stat label="24h volume" value={wait(fmtQrl(vol24))} />
            {!token.native && <Stat label="FDV" value={wait(facts.totalSupply !== null && priceQrl !== undefined ? fmtQrl(toFloat(facts.totalSupply, token.decimals) * priceQrl) : '—')} />}
            {!token.native && <Stat label="Total supply" value={facts.totalSupply !== null ? `${formatAmount(facts.totalSupply, token.decimals, 2)} ${sym(token)}` : '—'} />}
            <Stat label="Pools" value={wait(mine.length, 32)} />
            {!token.native && facts.holders !== null && <Stat label="Holders" value={facts.holders} />}
          </div>
          <h2 className="section-title" style={{ marginTop: 16 }}>
            About
          </h2>
          <p className="t-body c-2" style={{ marginTop: 16 }}>
            {poolsLoaded ? about(token, mine.length, facts.totalSupply, faucet, sym(token), formatFaucet(token)) : <Skeleton w="80%" h={18} />}
          </p>
        </div>
        <div className="detail-side">
          <SwapWidget defaultInput={token.native ? undefined : 'QRL'} defaultOutput={token.native ? undefined : token.address} />
          {account && (
            <div className="card side-card" style={{ gap: 12, padding: 20 }}>
              <span className="t-label c-3">Your balance</span>
              <div className="row" style={{ gap: 12 }}>
                <TokenIcon token={token} size={32} />
                <span className="col grow" style={{ gap: 2 }}>
                  <span className="t-num-strong">
                    {formatAmount(bal, token.decimals, 2)} {sym(token)}
                  </span>
                  {!token.native && priceQrl !== undefined && bal !== undefined && <span className="t-num c-3">≈ {fmtQrl(toFloat(bal, token.decimals) * priceQrl)}</span>}
                </span>
                {faucet !== undefined && faucet > 0n && (
                  <button className="btn btn-sm btn-tertiary" onClick={() => claim(token)}>
                    Faucet
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="col" style={{ gap: 16, marginTop: 24 }}>
        <h2 className="section-title">Pools with {sym(token)}</h2>
        <PoolsTable pools={mine} rows={rows} limit={5} more />
      </div>
    </main>
  );
}

const side = (p: PoolInfo, addr: string) => (sameAddress(p.token0, addr) ? p.reserve0 : p.reserve1);

/// Plain facts read from the chain; nothing editorial.
function about(t: Token, pools: number, supply: bigint | null, faucet: bigint | undefined, symbol: string, faucetAmount: string) {
  if (t.native) return `QRL is the native coin of ${CHAIN.name}. PauliSwap pools hold it as Wrapped QRL (WQRL), which the app wraps and unwraps for you.`;
  if (isWqrl(t)) return `Wrapped QRL is the SQRC-TF1 form of native QRL, redeemable 1:1. Every QRL pool on PauliSwap holds WQRL; swaps from or to QRL wrap and unwrap automatically.`;
  const parts = [`${t.name} (${symbol}) is an SQRC-TF1 token on ${CHAIN.name} with ${t.decimals} decimals`];
  if (supply !== null) parts[0] += ` and a total supply of ${formatAmount(supply, t.decimals, 2)}`;
  parts[0] += '.';
  parts.push(`It trades in ${pools} PauliSwap pool${pools === 1 ? '' : 's'}.`);
  if (faucet && faucet > 0n) parts.push(`Its public faucet() sends ${faucetAmount} ${symbol} per call, so it has no market value outside the devnet.`);
  return parts.join(' ');
}
