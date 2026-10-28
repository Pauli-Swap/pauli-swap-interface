import { useMemo, useState } from 'react';
import { AreaChart, BarChart, Point } from '../components/Chart';
import { fmtPct, fmtQrl, TransactionsTable } from '../components/tables';
import { CopyAddress, Crumbs, deltaOf, Empty, explorerHref, Icon, IconButton, PairIcon, PoolBadges, Seg, Stat, TokenIcon } from '../components/ui';
import { ADDRESSES, CHAIN } from '../config';
import devnet from '../contracts/devnet.json';
import { bucketSum, DAY, reservesAt, useBasePrice, useCovered, usePoolEvents, useValuation } from '../hooks/explore';
import { useNames } from '../hooks/names';
import { sameAddress, shortAddress } from '../lib/chain';
import { formatAmount, formatPrice } from '../lib/format';
import { href } from '../lib/router';
import { useApp } from '../state/app';
import { sharePage, Timeframe, TIMEFRAMES } from './TokenDetail';

type Tab = 'price' | 'volume' | 'liquidity';
const PAST: Record<Timeframe, string> = { '1H': 'past hour', '1D': 'past day', '1W': 'past week', '1M': 'past month', All: 'all time' };
const asCurrency = (address: string) => (sameAddress(address, ADDRESSES.WQRL) ? 'QRL' : address);

/// Pool detail (93:1285).
export function PoolDetail({ address }: { address: string }) {
  const { pools, poolsLoaded } = useApp();
  const pool = pools.find((p) => sameAddress(p.address, address));
  if (!pool)
    return (
      <main className="page" style={{ paddingTop: 24 }}>
        <Crumbs items={[{ label: 'Explore', href: href({ page: 'explore', tab: 'tokens' }) }, { label: 'Pools', href: href({ page: 'explore', tab: 'pools' }) }, { label: shortAddress(address) }]} />
        {poolsLoaded ? (
          <Empty icon="alert-triangle" title="Pool not found">
            No PauliSwap V2 pair or V3 pool at {shortAddress(address, 6)} on {CHAIN.name}.
          </Empty>
        ) : (
          <Empty icon="loader" title="Loading pool…" />
        )}
      </main>
    );
  return <PoolView address={pool.address} />;
}

function PoolView({ address }: { address: string }) {
  const { pools, tokenByAddress, decimalsOf, clock, blockTime } = useApp();
  const pool = pools.find((p) => sameAddress(p.address, address))!;
  const { symOf } = useNames();
  const { tvlOf, eventQrl, amountQrl } = useValuation();
  const basePrice = useBasePrice();
  const covered = useCovered();
  const list = useMemo(() => [pool], [pool]);
  const rows = usePoolEvents(list, Infinity);
  // QRL first, like the Figma header; the arrows swap the order.
  const [flip, setFlip] = useState(sameAddress(pool.token1, ADDRESSES.WQRL));
  const [tab, setTab] = useState<Tab>('volume');
  const [tf, setTf] = useState<Timeframe>('1D');
  const [a, b] = flip ? [pool.token1, pool.token0] : [pool.token0, pool.token1];
  const name = (x: string) => (sameAddress(x, ADDRESSES.WQRL) ? 'QRL' : symOf(x));

  const now = clock.latestTime;
  const since = now - TIMEFRAMES[tf];
  const swaps = (from: number, to = now + 1) => (rows ?? []).filter((r) => r.e.kind === 'swap' && r.t >= from && r.t < to);
  const volume = (list: ReturnType<typeof swaps>) => list.reduce((s, r) => s + (eventQrl(pool, r.e) ?? 0), 0);

  const price = useMemo(() => (rows ? basePrice(pool, a, rows, since) : []), [rows, pool, a, since, basePrice]);
  const tvlSeries = useMemo(() => {
    if (!rows) return [];
    const pts: Point[] = [{ t: now, v: tvlOf(pool) ?? 0 }];
    for (const r of rows) {
      if (r.t < since) break;
      pts.push({ t: r.t, v: tvlOf(pool, ...reservesAt(pool, rows, r.t - 0.001)) ?? 0 });
    }
    return pts.reverse();
  }, [rows, pool, tvlOf, now, since]);
  const bars = useMemo(() => {
    const items = swaps(since).map((r) => ({ t: r.t, v: eventQrl(pool, r.e) ?? 0 }));
    const t0 = Number.isFinite(since) ? since : items.length ? Math.min(...items.map((x) => x.t)) : now - DAY;
    return bucketSum(items, t0, now, 24);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, since, now]);

  const tvl = tvlOf(pool);
  const tvl24 = rows && covered(DAY) ? tvlOf(pool, ...reservesAt(pool, rows, now - DAY)) : null;
  const vol24 = rows ? volume(swaps(now - DAY)) : null;
  const volPrev = rows && covered(2 * DAY) ? volume(swaps(now - 2 * DAY, now - DAY)) : null;
  const fees24 = vol24 === null ? null : (vol24 * pool.fee) / 1_000_000;
  // Same rule as the Pools table: 24h of fees, or the chain's age if younger.
  const secs = Math.min(DAY, now - blockTime(devnet.startBlock));
  const apr = fees24 !== null && tvl && secs >= 3600 ? (fees24 / tvl) * ((365 * DAY) / secs) : null;

  const [ra, rb] = sameAddress(a, pool.token0) ? [pool.reserve0, pool.reserve1] : [pool.reserve1, pool.reserve0];
  const va = amountQrl(a, ra) ?? 0;
  const vb = amountQrl(b, rb) ?? 0;
  const share = va + vb > 0 ? va / (va + vb) : 0.5;
  const colorOf = (x: string, other: boolean) => (sameAddress(x, ADDRESSES.WQRL) ? 'var(--qrl)' : other ? 'var(--quantum)' : 'var(--quantum-dim)');

  const headline =
    tab === 'price'
      ? { value: price.length ? `${formatPrice(price[price.length - 1].v)} ${name(b)}` : '—', sub: `${name(b)} per ${name(a)} · now` }
      : tab === 'volume'
        ? { value: rows ? fmtQrl(volume(swaps(since))) : '—', sub: `Volume · ${PAST[tf]}` }
        : { value: fmtQrl(tvl), sub: 'Total value locked · now' };
  const explorer = explorerHref('address', pool.address);
  const add = href({ page: 'newPosition' }, { version: pool.version, tokenA: asCurrency(a), tokenB: asCurrency(b), fee: pool.fee });
  const swap = href({ page: 'swap' }, { inputCurrency: asCurrency(a), outputCurrency: asCurrency(b) });

  return (
    <main className="page" style={{ gap: 24, paddingTop: 24 }}>
      <Crumbs items={[{ label: 'Explore', href: href({ page: 'explore', tab: 'tokens' }) }, { label: 'Pools', href: href({ page: 'explore', tab: 'pools' }) }, { label: `${name(a)} / ${name(b)}` }]} />
      <div className="detail-head">
        <PairIcon a={tokenByAddress(a)} b={tokenByAddress(b)} size={48} />
        <div className="col" style={{ gap: 6 }}>
          <div className="row" style={{ gap: 8 }}>
            <h1 className="t-headline">
              {name(a)} / {name(b)}
            </h1>
            <button className="c-3 center" onClick={() => setFlip((f) => !f)} aria-label="Swap token order" title="Swap token order">
              <Icon name="arrow-up-down" size={18} />
            </button>
          </div>
          <div className="meta">
            <PoolBadges version={pool.version} fee={pool.fee} />
            <CopyAddress address={pool.address} />
          </div>
        </div>
        <div className="actions">
          <IconButton icon="share" label="Copy page link" onClick={sharePage} />
          {explorer && <IconButton icon="external-link" label="View on QRL explorer" href={explorer} />}
        </div>
      </div>
      <hr className="divider" />
      <div className="detail-cols pool">
        <div className="detail-main" style={{ gap: 20 }}>
          <div className="text-tabs sm">
            {(['price', 'volume', 'liquidity'] as const).map((t) => (
              <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
                {t === 'price' ? 'Price' : t === 'volume' ? 'Volume' : 'Liquidity'}
              </button>
            ))}
          </div>
          <div className="col price-head" style={{ gap: 2 }}>
            <span className="big">{headline.value}</span>
            <span className="t-body c-3">{headline.sub}</span>
          </div>
          <div style={{ maxWidth: 632 }}>
            {tab === 'price' && <AreaChart points={price} height={260} unit={name(b)} loading={!rows} />}
            {tab === 'volume' && <BarChart bars={bars} height={260} format={(v) => fmtQrl(v, '')} loading={!rows} />}
            {tab === 'liquidity' && <AreaChart points={tvlSeries} height={260} unit="QRL" format={(v) => fmtQrl(v, '')} />}
          </div>
          <div>
            <Seg boxed options={Object.keys(TIMEFRAMES) as Timeframe[]} value={tf} onChange={setTf} />
          </div>
        </div>
        <div className="detail-side">
          <div className="row" style={{ gap: 12 }}>
            <a className="btn btn-md btn-secondary grow" href={swap}>
              Swap
            </a>
            <a className="btn btn-md btn-primary grow" href={add}>
              Add liquidity
            </a>
          </div>
          <div className="card side-card">
            <span className="t-heading">Stats</span>
            <div className="col" style={{ gap: 8 }}>
              <span className="t-label c-3">Pool balances</span>
              <div className="row">
                <TokenIcon token={tokenByAddress(a)} size={20} />
                <span className="t-num-strong">
                  {formatAmount(ra, decimalsOf(a), 2)} {name(a)}
                </span>
                <span className="grow" />
                <span className="t-num-strong">
                  {formatAmount(rb, decimalsOf(b), 2)} {name(b)}
                </span>
                <TokenIcon token={tokenByAddress(b)} size={20} />
              </div>
              <div className="ratio-bar" title={`${(share * 100).toFixed(1)}% ${name(a)} by QRL value`}>
                <span style={{ flex: share, background: colorOf(a, false) }} />
                <span style={{ flex: 1 - share, background: colorOf(b, true) }} />
              </div>
            </div>
            <Stat label="TVL" value={fmtQrl(tvl)} {...deltaOf(tvl !== null && tvl24 ? tvl / tvl24 - 1 : null)} />
            <Stat label="24h volume" value={fmtQrl(vol24)} {...deltaOf(vol24 !== null && volPrev ? vol24 / volPrev - 1 : null)} />
            <Stat label="24h fees" value={fmtQrl(fees24)} />
            <Stat label="Fee APR" value={fmtPct(apr)} />
          </div>
          <div className="card side-card" style={{ gap: 12 }}>
            <span className="t-heading">Contracts</span>
            <ContractRow label={pool.version === 'v2' ? 'Pair' : 'Pool'} address={pool.address} />
            <ContractRow label={symOf(pool.token0)} address={pool.token0} />
            <ContractRow label={symOf(pool.token1)} address={pool.token1} />
          </div>
        </div>
      </div>
      <div className="col" style={{ gap: 16, marginTop: 24 }}>
        <h2 className="section-title">Transactions</h2>
        <TransactionsTable rows={rows} limit={8} more />
      </div>
    </main>
  );
}

function ContractRow({ label, address }: { label: string; address: string }) {
  const link = explorerHref('address', address);
  return (
    <div className="contract-row">
      <span className="label">{label}</span>
      <CopyAddress address={address} boxed />
      {link && (
        <a className="c-3 center" href={link} target="_blank" rel="noreferrer" aria-label="View on QRL explorer">
          <Icon name="external-link" size={16} />
        </a>
      )}
    </div>
  );
}
