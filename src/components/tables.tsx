import { ReactNode, useMemo, useState } from 'react';
import { DAY, isFlow, PoolRowStats, TxRow, useBasePrice, usePoolEvents, usePoolTable, useQrlPool, useSender, useValuation } from '../hooks/explore';
import { useNames } from '../hooks/names';
import { sameAddress, shortAddress } from '../lib/chain';
import { formatAmount, formatPrice, timeAgo } from '../lib/format';
import { PoolInfo } from '../lib/registry';
import { href } from '../lib/router';
import { isWqrl, Token, tokenKey, wrappedAddress } from '../lib/tokens';
import { useApp } from '../state/app';
import { Sparkline } from './Chart';
import { explorerHref, PairIcon, PoolBadges, Skeleton, TokenIcon } from './ui';
import '../styles/explore.css';

/// "2,472.9 QRL", "7.8 QRL", "0.06 QRL" — the Figma number style for QRL values.
export function fmtQrl(n: number | null | undefined, unit = 'QRL') {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  const s = n === 0 ? '0' : n < 0.01 ? '<0.01' : n.toLocaleString('en-US', { minimumFractionDigits: n >= 1 ? 1 : 2, maximumFractionDigits: n >= 1 ? 1 : 2 });
  return unit ? `${s} ${unit}` : s;
}
export const fmtPct = (f: number | null | undefined) => (f === null || f === undefined || !Number.isFinite(f) ? '—' : `${(f * 100).toFixed(1)}%`);
export const fmtChange = (f: number | null | undefined) =>
  f === null || f === undefined || !Number.isFinite(f) ? '—' : `${f >= 0 ? '+' : '−'}${Math.abs(f * 100).toFixed(2)}%`;

function Pager({ shown, total, onMore }: { shown: number; total: number; onMore: () => void }) {
  if (shown >= total) return null;
  return (
    <div className="table-footer">
      <button className="btn btn-sm btn-tertiary" onClick={onMore}>
        Show more
      </button>
    </div>
  );
}

function Th({ children, w, sort, active, onSort }: { children: ReactNode; w: number; sort?: boolean; active?: boolean; onSort?: () => void }) {
  return (
    <div className={`td r${active ? ' sort' : ''}`} style={{ width: w, flex: 'none' }}>
      {sort ? (
        <button onClick={onSort}>
          {active && '↓ '}
          {children}
        </button>
      ) : (
        children
      )}
    </div>
  );
}

/// Shimmering placeholder rows shaped like the real ones: `cols` are the
/// fixed right-hand column widths, `lead` a fixed first column in place of the
/// rank, `icon` the mark(s) in the name cell.
function Loading({ cols, icon = 'single', lead, count = 5 }: { cols: number[]; icon?: 'single' | 'pair' | 'none'; lead?: number; count?: number }) {
  return (
    <div role="status" aria-label="Loading on-chain data">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="tr skeleton-row" style={{ ['--i' as string]: i }}>
          {lead === undefined ? (
            <div className="td rank">
              <Skeleton w={14} h={12} />
            </div>
          ) : (
            <div className="td" style={{ width: lead, flex: 'none' }}>
              <Skeleton w={lead * 0.6} h={12} />
            </div>
          )}
          <div className="td grow">
            {icon !== 'none' && (
              <span className="pair-icon" style={{ ['--overlap' as string]: '-10px' }}>
                <Skeleton w={32} h={32} round />
                {icon === 'pair' && <Skeleton w={32} h={32} round />}
              </span>
            )}
            <Skeleton w={`${[46, 34, 40, 28, 38][i % 5]}%`} h={14} />
          </div>
          {cols.map((w, c) => (
            <div key={c} className="td r" style={{ width: w, flex: 'none' }}>
              <Skeleton w={Math.round(w * [0.55, 0.45, 0.6][(i + c) % 3])} h={14} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

type PoolSort = 'tvl' | 'apr' | 'vol1d' | 'vol7d' | 'fees1d';
const POOL_COLS: { key: PoolSort; label: string; w: number }[] = [
  { key: 'tvl', label: 'TVL', w: 150 },
  { key: 'apr', label: 'APR', w: 110 },
  { key: 'vol1d', label: '1D vol', w: 150 },
  { key: 'vol7d', label: '7D vol', w: 150 },
  { key: 'fees1d', label: '1D fees', w: 130 },
];

/// Pools table (89:306 / 89:321), ranked by TVL; headers re-sort.
export function PoolsTable({ pools, limit = 10, more, rows: given }: { pools: PoolInfo[]; limit?: number; more?: boolean; rows?: TxRow[] | null }) {
  const { tokenByAddress, poolsLoaded } = useApp();
  const { symOf } = useNames();
  const fetched = usePoolEvents(given === undefined ? pools : []);
  const rows = given === undefined ? fetched : given;
  const stats = usePoolTable(pools, rows);
  const [sort, setSort] = useState<PoolSort>('tvl');
  const [shown, setShown] = useState(limit);
  const sorted = useMemo(
    () => [...pools].sort((a, b) => (stats.get(b.id)?.[sort] ?? -1) - (stats.get(a.id)?.[sort] ?? -1)),
    [pools, stats, sort],
  );
  const cell = (s: PoolRowStats | undefined, k: PoolSort) => (k === 'apr' ? fmtPct(s?.apr) : fmtQrl(s?.[k]));
  const list = sorted.slice(0, more ? shown : limit);

  return (
    <div>
      <div className="table pools-table">
        <div className="tr thead">
          <div className="td rank">#</div>
          <div className="td grow">Pool</div>
          {POOL_COLS.map((c) => (
            <Th key={c.key} w={c.w} sort active={sort === c.key} onSort={() => setSort(c.key)}>
              {c.label}
            </Th>
          ))}
        </div>
        <div className="tbody">
          {!poolsLoaded && <Loading icon="pair" cols={POOL_COLS.map((c) => c.w)} />}
          {poolsLoaded && !pools.length && <div className="empty-row">No pools yet.</div>}
          {list.map((p, i) => {
            const s = stats.get(p.id);
            return (
              <a key={p.id} className="tr" href={href({ page: 'poolDetail', address: p.address })}>
                <div className="td rank">{i + 1}</div>
                <div className="td grow">
                  <PairIcon a={tokenByAddress(p.token0)} b={tokenByAddress(p.token1)} size={32} />
                  <span className="ellipsis" style={{ letterSpacing: '-0.14px' }}>
                    {symOf(p.token0)} / {symOf(p.token1)}
                  </span>
                  <PoolBadges version={p.version} fee={p.fee} />
                </div>
                {POOL_COLS.map((c) => (
                  <div key={c.key} className="td r" style={{ width: c.w, flex: 'none' }}>
                    {cell(s, c.key)}
                  </div>
                ))}
              </a>
            );
          })}
        </div>
      </div>
      {more && <Pager shown={list.length} total={pools.length} onMore={() => setShown((n) => n + 10)} />}
    </div>
  );
}

export type TokenRowStats = { token: Token; price: number | undefined; change: number | null; tvl: number | null; vol1d: number | null; spark: number[] };

/// Price, 1D change, TVL, 1D volume and a 24h sparkline per token.
export function useTokenRows(tokens: Token[], pools: PoolInfo[], rows: TxRow[] | null): TokenRowStats[] {
  const { priceInQrl, clock } = useApp();
  const { amountQrl, eventQrl } = useValuation();
  return useMemo(() => {
    const now = clock.latestTime;
    return tokens.map((token) => {
      const addr = wrappedAddress(token);
      const mine = pools.filter((p) => sameAddress(p.token0, addr) || sameAddress(p.token1, addr));
      let tvl: number | null = 0;
      for (const p of mine) {
        const v = amountQrl(addr, sameAddress(p.token0, addr) ? p.reserve0 : p.reserve1);
        tvl = tvl === null || v === null ? null : tvl + v;
      }
      let vol1d: number | null = rows ? 0 : null;
      for (const r of rows ?? []) {
        if (r.t < now - DAY || r.e.kind !== 'swap' || !isFlow(r) || !mine.includes(r.pool)) continue;
        const v = eventQrl(r.pool, r.e);
        vol1d = vol1d === null || v === null ? null : vol1d + v;
      }
      return { token, price: priceInQrl(token), change: null, tvl: mine.length ? tvl : null, vol1d: mine.length ? vol1d : null, spark: [] };
    });
  }, [tokens, pools, rows, clock.latestTime, priceInQrl, amountQrl, eventQrl]);
}

function TokenRow({ s, rank, pools, rows }: { s: TokenRowStats; rank: number; pools: PoolInfo[]; rows: TxRow[] | null }) {
  const { sym } = useNames();
  const { clock } = useApp();
  const pool = useQrlPool(s.token, pools);
  const basePrice = useBasePrice();
  const series = useMemo(() => {
    if (!pool || !rows || s.token.native || isWqrl(s.token)) return [];
    return basePrice(pool, s.token.address, rows, clock.latestTime - DAY);
  }, [pool, rows, s.token, basePrice, clock.latestTime]);
  const change = series.length >= 2 && series[0].v > 0 ? series[series.length - 1].v / series[0].v - 1 : null;
  const isQrl = s.token.native || isWqrl(s.token);
  return (
    <a className="tr" href={href({ page: 'token', address: s.token.native ? 'QRL' : s.token.address })}>
      <div className="td rank">{rank}</div>
      <div className="td grow">
        <TokenIcon token={s.token} size={32} />
        <span className="ellipsis" style={{ letterSpacing: '-0.14px' }}>
          {s.token.native ? 'QRL' : s.token.name}
        </span>
        <span className="t-num c-3">{s.token.native ? 'Native' : sym(s.token)}</span>
      </div>
      <div className="td r" style={{ width: 150, flex: 'none' }}>
        {s.price === undefined ? '—' : `${formatPrice(s.price)} QRL`}
      </div>
      <div className={`td r t-num ${change === null ? 'c-3' : change >= 0 ? 'c-success' : 'c-alert'}`} style={{ width: 100, flex: 'none' }}>
        {isQrl ? '—' : fmtChange(change)}
      </div>
      <div className="td r" style={{ width: 150, flex: 'none' }}>
        {fmtQrl(s.tvl)}
      </div>
      <div className="td r" style={{ width: 150, flex: 'none' }}>
        {fmtQrl(s.vol1d)}
      </div>
      <div className="td r" style={{ width: 140, flex: 'none' }}>
        {isQrl || series.length < 2 ? <span className="c-4">—</span> : <Sparkline values={series.map((p) => p.v)} up={(change ?? 0) >= 0} />}
      </div>
    </a>
  );
}

type TokenSort = 'tvl' | 'vol1d';

/// Tokens table (89:346 / 89:361).
export function TokensTable({ tokens, pools, rows, limit = 10, more }: { tokens: Token[]; pools: PoolInfo[]; rows: TxRow[] | null; limit?: number; more?: boolean }) {
  const { tokensLoading } = useApp();
  const stats = useTokenRows(tokens, pools, rows);
  const [sort, setSort] = useState<TokenSort>('vol1d');
  const [shown, setShown] = useState(limit);
  const sorted = [...stats].sort((a, b) => (b[sort] ?? -1) - (a[sort] ?? -1));
  const list = sorted.slice(0, more ? shown : limit);
  return (
    <div>
      <div className="table tokens-table">
        <div className="tr thead">
          <div className="td rank">#</div>
          <div className="td grow">Token</div>
          <Th w={150}>Price</Th>
          <Th w={100}>1D</Th>
          <Th w={150} sort active={sort === 'tvl'} onSort={() => setSort('tvl')}>
            TVL
          </Th>
          <Th w={150} sort active={sort === 'vol1d'} onSort={() => setSort('vol1d')}>
            1D vol
          </Th>
          <Th w={140}>24h</Th>
        </div>
        <div className="tbody">
          {list.map((s, i) => (
            <TokenRow key={tokenKey(s.token)} s={s} rank={i + 1} pools={pools} rows={rows} />
          ))}
          {tokensLoading && tokens.length <= 1 && <Loading count={4} cols={[150, 100, 150, 150, 140]} />}
        </div>
      </div>
      {more && <Pager shown={list.length} total={sorted.length} onMore={() => setShown((n) => n + 10)} />}
    </div>
  );
}

function Wallet({ hash }: { hash: string }) {
  const from = useSender(hash);
  if (!from) return <Skeleton w={96} h={12} />;
  const link = explorerHref('address', from);
  return link ? (
    <a className="c-quantum" href={link} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
      {shortAddress(from)}
    </a>
  ) : (
    <span className="c-quantum" title={from}>
      {shortAddress(from)}
    </span>
  );
}

const ACTION = { swap: ['Swap', 'c-quantum'], add: ['Add', 'c-success'], remove: ['Remove', 'c-warning'] } as const;

function TxLine({ r }: { r: TxRow }) {
  const { decimalsOf, clock } = useApp();
  const { symOf } = useNames();
  const { eventQrl } = useValuation();
  const { pool: p, e } = r;
  const amt = (address: string, v: bigint) => `${formatAmount(v < 0n ? -v : v, decimalsOf(address), 4)} ${symOf(address)}`;
  let detail: string;
  let tin: string;
  let tout: string;
  if (e.kind === 'swap') {
    const inIs0 = e.amount0 > 0n;
    const [inTok, outTok] = inIs0 ? [p.token0, p.token1] : [p.token1, p.token0];
    detail = `${symOf(inTok)} for ${symOf(outTok)}`;
    tin = amt(inTok, inIs0 ? e.amount0 : e.amount1);
    tout = amt(outTok, inIs0 ? e.amount1 : e.amount0);
  } else {
    detail = `${symOf(p.token0)} and ${symOf(p.token1)}`;
    tin = amt(p.token0, e.amount0);
    tout = amt(p.token1, e.amount1);
  }
  const ago = clock.latestTime - r.t < 60 ? 'just now' : `${timeAgo(r.t * 1000)} ago`;
  const link = explorerHref('tx', e.hash);
  const body = (
    <>
      <div className="td dim" style={{ width: 100, flex: 'none' }} title={`Block ${e.block}`}>
        {ago}
      </div>
      <div className="td grow">
        <span className={ACTION[e.kind][1]}>{ACTION[e.kind][0]}</span>
        <span className="ellipsis">{detail}</span>
      </div>
      <div className="td r" style={{ width: 160, flex: 'none' }}>
        {fmtQrl(eventQrl(p, e))}
      </div>
      <div className="td r" style={{ width: 170, flex: 'none' }}>
        {tin}
      </div>
      <div className="td r" style={{ width: 170, flex: 'none' }}>
        {tout}
      </div>
      <div className="td r t-num" style={{ width: 160, flex: 'none' }}>
        <Wallet hash={e.hash} />
      </div>
    </>
  );
  return link ? (
    <a className="tr" href={link} target="_blank" rel="noreferrer">
      {body}
    </a>
  ) : (
    <div className="tr" title={e.hash}>
      {body}
    </div>
  );
}

/// Transactions table (89:381 / 89:394), newest first.
export function TransactionsTable({ rows, limit = 10, more }: { rows: TxRow[] | null; limit?: number; more?: boolean }) {
  const [shown, setShown] = useState(limit);
  const flows = useMemo(() => rows?.filter(isFlow) ?? null, [rows]);
  const list = (flows ?? []).slice(0, more ? shown : limit);
  return (
    <div>
      <div className="table tx-table">
        <div className="tr thead">
          <div className="td" style={{ width: 100, flex: 'none' }}>
            Time
          </div>
          <div className="td grow">Type</div>
          <Th w={160}>Total</Th>
          <Th w={170}>Token in</Th>
          <Th w={170}>Token out</Th>
          <Th w={160}>Wallet</Th>
        </div>
        <div className="tbody">
          {flows === null && <Loading lead={100} icon="none" cols={[160, 170, 170, 160]} />}
          {flows && !flows.length && <div className="empty-row">No transactions yet.</div>}
          {list.map((r) => (
            <TxLine key={`${r.e.hash}:${r.e.logIndex}`} r={r} />
          ))}
        </div>
      </div>
      {more && <Pager shown={list.length} total={flows?.length ?? 0} onMore={() => setShown((n) => n + 10)} />}
    </div>
  );
}

