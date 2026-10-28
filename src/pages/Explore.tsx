import { ReactNode, useMemo, useState } from 'react';
import { fmtQrl, PoolsTable, TokensTable, TransactionsTable } from '../components/tables';
import { Icon, Seg, Skeleton, Stat } from '../components/ui';
import { CHAIN } from '../config';
import { DAY, isFlow, reservesAt, useCovered, usePoolEvents, useValuation } from '../hooks/explore';
import { useNames } from '../hooks/names';
import { sameAddress } from '../lib/chain';
import { PoolInfo } from '../lib/registry';
import { ExploreTab, href } from '../lib/router';
import { wrappedAddress } from '../lib/tokens';
import { useApp } from '../state/app';

type Protocol = 'all' | 'v3' | 'v2';
const change = (now: number, before: number) => (before > 0 ? now / before - 1 : null);
const delta = (c: number | null): { delta?: string; deltaTone?: 'up' | 'down' } =>
  c === null || !Number.isFinite(c) ? {} : { delta: `${c >= 0 ? '+' : '−'}${Math.abs(c * 100).toFixed(1)}%`, deltaTone: c >= 0 ? 'up' : 'down' };

/// Explore · Tokens / Pools / Transactions (92:87, 92:383, 92:718).
export function Explore({ tab }: { tab: ExploreTab }) {
  const { pools, tokens, clock, poolsLoaded } = useApp();
  const wait = (v: ReactNode, w = 110) => (poolsLoaded ? v : <Skeleton w={w} h={26} />);
  const { symOf } = useNames();
  const { tvlOf, eventQrl } = useValuation();
  const covered = useCovered();
  const [protocol, setProtocol] = useState<Protocol>('all');
  const [q, setQ] = useState('');

  const scoped = useMemo(() => (protocol === 'all' ? pools : pools.filter((p) => p.version === protocol)), [pools, protocol]);
  const rows = usePoolEvents(scoped);
  const allRows = usePoolEvents(pools);

  // Network stats always cover every pool.
  const stats = useMemo(() => {
    const now = clock.latestTime;
    // Pools without a QRL price for both sides count as zero.
    const sum = (f: (p: PoolInfo) => number | null) => pools.reduce((s, p) => s + (f(p) ?? 0), 0);
    const tvl = sum((p) => tvlOf(p));
    const tvl24 = allRows && covered(DAY) ? sum((p) => tvlOf(p, ...reservesAt(p, allRows, now - DAY))) : null;
    const inWindow = (from: number, to: number) => (allRows ?? []).filter((r) => isFlow(r) && r.t >= from && r.t < to);
    const vol = (list: ReturnType<typeof inWindow>) => list.filter((r) => r.e.kind === 'swap').reduce((s, r) => s + (eventQrl(r.pool, r.e) ?? 0), 0);
    const day = inWindow(now - DAY, now + 1);
    const prev = inWindow(now - 2 * DAY, now - DAY);
    const two = covered(2 * DAY);
    return {
      tvl,
      tvlChange: tvl !== null && tvl24 !== null ? change(tvl, tvl24) : null,
      vol: allRows ? vol(day) : null,
      volChange: two ? change(vol(day), vol(prev)) : null,
      txs: allRows ? day.length : null,
      txChange: two ? change(day.length, prev.length) : null,
    };
  }, [pools, allRows, clock.latestTime, tvlOf, eventQrl, covered]);

  const term = q.trim().toLowerCase();
  const tokenList = useMemo(() => {
    const scopedTokens = tokens.filter((t) => t.native || scoped.some((p) => sameAddress(p.token0, wrappedAddress(t)) || sameAddress(p.token1, wrappedAddress(t))) || protocol === 'all');
    return term ? scopedTokens.filter((t) => t.symbol.toLowerCase().includes(term) || t.name.toLowerCase().includes(term) || (!t.native && t.address.toLowerCase() === term)) : scopedTokens;
  }, [tokens, scoped, protocol, term]);
  const poolList = useMemo(
    () =>
      term
        ? scoped.filter((p) => `${symOf(p.token0)}/${symOf(p.token1)}`.toLowerCase().includes(term.replace(/\s/g, '')) || sameAddress(p.address, term) || [p.token0, p.token1].some((a) => symOf(a).toLowerCase().includes(term)))
        : scoped,
    [scoped, term, symOf],
  );
  const txList = useMemo(
    () =>
      rows && term
        ? rows.filter((r) => r.e.hash.toLowerCase() === term || sameAddress(r.pool.address, term) || [r.pool.token0, r.pool.token1].some((a) => sameAddress(a, term) || symOf(a).toLowerCase().includes(term)))
        : rows,
    [rows, term, symOf],
  );

  const v2 = pools.filter((p) => p.version === 'v2').length;
  const placeholder = { tokens: 'Filter tokens', pools: 'Filter pools', transactions: 'Filter by address' }[tab];

  return (
    <main className="page">
      <div className="explore-head">
        <div className="page-title">
          <h1>Explore</h1>
          <p>
            Every token, pool and trade on {CHAIN.name} (chain {CHAIN.id}).
          </p>
        </div>
        <div className="net-stats">
          <div className="card">
            <Stat label="Total value locked" value={wait(fmtQrl(stats.tvl))} {...delta(stats.tvlChange)} />
          </div>
          <div className="card">
            <Stat label="24h volume" value={wait(fmtQrl(stats.vol))} {...delta(stats.volChange)} />
          </div>
          <div className="card">
            <Stat label="Pools" value={wait(pools.length, 40)} delta={poolsLoaded ? `${v2} V2 · ${pools.length - v2} V3` : undefined} deltaTone="muted" />
          </div>
          <div className="card">
            <Stat label="24h transactions" value={wait(stats.txs ?? '—', 60)} {...delta(stats.txChange)} />
          </div>
        </div>
        <div className="explore-bar">
          <nav className="text-tabs">
            <a className={tab === 'tokens' ? 'on' : ''} href={href({ page: 'explore', tab: 'tokens' })}>
              Tokens
            </a>
            <a className={tab === 'pools' ? 'on' : ''} href={href({ page: 'explore', tab: 'pools' })}>
              Pools
            </a>
            <a className={tab === 'transactions' ? 'on' : ''} href={href({ page: 'explore', tab: 'transactions' })}>
              Transactions
            </a>
          </nav>
          <span className="grow" />
          <Seg boxed options={['all', 'v3', 'v2'] as const} labels={{ all: 'All', v3: 'V3', v2: 'V2' }} value={protocol} onChange={setProtocol} />
          <label className="search-field">
            <Icon name="search" size={16} />
            <input placeholder={placeholder} value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          {tab === 'pools' && (
            <a className="btn btn-md btn-primary" href={href({ page: 'newPosition' })}>
              New position
            </a>
          )}
        </div>
        {tab === 'tokens' && <TokensTable tokens={tokenList} pools={scoped} rows={rows} limit={8} more />}
        {tab === 'pools' && <PoolsTable pools={poolList} rows={rows} limit={9} more key={protocol} />}
        {tab === 'transactions' && <TransactionsTable rows={txList} limit={8} more />}
      </div>
    </main>
  );
}
