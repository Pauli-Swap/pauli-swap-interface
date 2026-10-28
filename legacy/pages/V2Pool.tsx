import { useMemo, useState } from 'react';
import { NoteBar, SubBar } from '../components/Header';
import { SettingsButton } from '../components/SettingsPopover';
import { DetailRow, Icon, Seg, Stat, TokenPairIcon } from '../components/ui';
import { ADDRESSES } from '../config';
import { usePoolStats } from '../hooks/market';
import { useNames } from '../hooks/names';
import { usePair } from '../hooks/pools';
import { sameAddress, shortAddress } from '../lib/chain';
import { formatAmount, formatPercent, formatPrice } from '../lib/format';
import { PoolInfo, tvlInQrl } from '../lib/registry';
import { go } from '../lib/router';
import { useApp } from '../state/app';
import { useWallet } from '../state/wallet';
import { AddLiquidity } from './AddLiquidity';
import { PositionsRail } from './Markets';
import { RemoveLiquidity } from './RemoveLiquidity';

const COLS = '28px minmax(150px, 1fr) 140px 90px 76px 84px';

export function V2Pool({ pairAddress }: { pairAddress?: string }) {
  const { pools, priceInQrl, decimalsOf, tokenByAddress } = useApp();
  const { account } = useWallet();
  const { symOf } = useNames();
  const [mode, setMode] = useState<'Add' | 'Remove'>('Add');
  const [filter, setFilter] = useState<'All' | 'QRL pairs' | 'Mine'>('All');
  const [term, setTerm] = useState('');
  const { pair } = usePair(pairAddress, account);

  const v2 = useMemo(() => pools.filter((p) => p.version === 'v2'), [pools]);
  const tvlMap = useMemo(() => {
    const prices = new Map<string, number>();
    for (const p of v2) for (const t of [p.token0, p.token1]) { const v = priceInQrl(t); if (v !== undefined) prices.set(t.toLowerCase(), v); }
    return new Map(v2.map((p) => [p.id, tvlInQrl(p, prices, decimalsOf)]));
  }, [v2, priceInQrl, decimalsOf]);
  const tvl = (p: PoolInfo) => tvlMap.get(p.id) ?? null;
  const stats = usePoolStats(v2, '24h', tvl);
  const total = v2.reduce((s, p) => s + (tvl(p) ?? 0), 0);
  const volume = v2.reduce((s, p) => s + (stats.get(p.id)?.volume ?? 0), 0);
  const fees = v2.reduce((s, p) => s + (stats.get(p.id)?.fees ?? 0), 0);
  const name = (p: PoolInfo) => `${symOf(p.token0)} / ${symOf(p.token1)}`;
  const rows = v2
    .filter((p) => filter !== 'QRL pairs' || sameAddress(p.token0, ADDRESSES.WQRL) || sameAddress(p.token1, ADDRESSES.WQRL))
    .filter((p) => filter !== 'Mine' || (pair && sameAddress(pair.address, p.address)))
    .filter((p) => !term.trim() || name(p).toLowerCase().includes(term.toLowerCase()))
    .sort((a, b) => (tvl(b) ?? -1) - (tvl(a) ?? -1));
  const share = pair && pair.totalSupply > 0n ? Number((pair.balance * 1_000_000n) / pair.totalSupply) / 1_000_000 : 0;

  return (
    <>
      <SubBar
        icon="wallet"
        context={pair ? `${symOf(pair.token0)} / ${symOf(pair.token1)} · V2` : 'V2 liquidity'}
        detail={pair ? `0.3% fee · pair ${shortAddress(pair.address)}` : 'Full range pools, 0.3% fee'}
        meta={`V2 TVL ${formatPrice(total)} QRL · ${v2.length} pairs`}
        action={{ label: 'New V3 position', icon: 'plus', onClick: () => go({ page: 'v3new' }) }}
      />
      <div className="body">
        <PositionsRail selected={pairAddress ? `v2-${pairAddress}` : undefined} />
        <main className="canvas">
          <div className="stats">
            <Stat label="V2 value locked" value={`${formatPrice(total)} QRL`} note={`${v2.length} pairs`} />
            <Stat label="Volume 24h" value={`${formatPrice(volume)} QRL`} note={`${v2.reduce((s, p) => s + (stats.get(p.id)?.swaps ?? 0), 0)} swaps`} />
            <Stat label="Fees 24h" value={`${formatPrice(fees)} QRL`} note="paid to LPs" />
            <Stat label="Your share" value={pair ? formatPercent(share) : '—'} note={pair ? `of ${name(v2.find((p) => sameAddress(p.address, pair.address)) ?? v2[0])}` : 'select a pair'} noteTone="muted" />
          </div>
          <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
            <span className="t-heading">All V2 pools</span>
            <Seg options={['All', 'QRL pairs', 'Mine'] as const} value={filter} onChange={setFilter} />
            <span className="grow" />
            <div className="search-field" style={{ width: 220, padding: '7px 12px' }}>
              <Icon name="search" size={16} />
              <input placeholder="Filter pools" value={term} onChange={(e) => setTerm(e.target.value)} />
            </div>
            <button className="btn btn-md btn-secondary" onClick={() => go({ page: 'v2' })}>
              <Icon name="plus" size={16} /> New pair
            </button>
          </div>
          <div className="table" style={{ ['--table-min' as string]: '620px' }}>
            <div className="tr head" style={{ gridTemplateColumns: COLS }}>
              <span>#</span>
              <span>Pool</span>
              <span className="num">Reserves</span>
              <span className="num">TVL (QRL)</span>
              <span className="num">APR (fees)</span>
              <span className="num">Volume 24h</span>
            </div>
            {rows.length === 0 && <div className="table-empty">No V2 pairs match.</div>}
            {rows.map((p, i) => {
              const s = stats.get(p.id);
              const selected = !!pairAddress && sameAddress(p.address, pairAddress);
              return (
                <div key={p.id} className={`tr clickable ${selected ? 'selected' : ''}`} style={{ gridTemplateColumns: COLS }} onClick={() => go({ page: 'v2', pair: p.address })}>
                  <span className="t-mono c-4">{i + 1}</span>
                  <span className="row" style={{ gap: 10, minWidth: 0 }}>
                    <TokenPairIcon a={tokenByAddress(p.token0)} b={tokenByAddress(p.token1)} size={24} />
                    <span className="t-body-strong ellipsis">{name(p)}</span>
                  </span>
                  <span className="num t-mono c-2">
                    {formatAmount(p.reserve0, decimalsOf(p.token0), 2)} · {formatAmount(p.reserve1, decimalsOf(p.token1), 2)}
                  </span>
                  <span className="num t-mono-strong">{tvl(p) != null ? formatPrice(tvl(p)!) : '—'}</span>
                  <span className="num t-mono c-quantum">{s?.feeApr != null ? formatPercent(s.feeApr, 1) : '—'}</span>
                  <span className="num t-mono c-2">{s?.volume != null ? formatPrice(s.volume) : '—'}</span>
                </div>
              );
            })}
          </div>
        </main>
        <aside className="inspector">
          <section className="card" style={{ gap: 12 }}>
            <div className="card-head" style={{ paddingBottom: 0 }}>
              <Seg options={['Add', 'Remove'] as const} value={mode} onChange={setMode} />
              <div className="row" style={{ gap: 4 }}>
                <span className="badge badge-neutral">V2</span>
                <SettingsButton />
              </div>
            </div>
            {mode === 'Add' ? (
              <AddLiquidity pairAddress={pairAddress} key={pairAddress ?? 'new'} onPair={(a) => a && pairAddress && !sameAddress(a, pairAddress) && go({ page: 'v2', pair: a })} />
            ) : pairAddress ? (
              <RemoveLiquidity pairAddress={pairAddress} key={pairAddress} />
            ) : (
              <span className="t-body c-3">Select a pair you hold to remove liquidity.</span>
            )}
          </section>
          {pair && pair.balance > 0n && (
            <section className="col" style={{ gap: 10, padding: '0 4px' }}>
              <div className="between">
                <span className="t-body-strong">Your position</span>
                <span className="t-mono c-quantum">{shortAddress(pair.address)}</span>
              </div>
              <DetailRow label={`Pooled ${symOf(pair.token0)}`} value={formatAmount((pair.reserve0 * pair.balance) / pair.totalSupply, pair.token0Info.decimals)} />
              <DetailRow label={`Pooled ${symOf(pair.token1)}`} value={formatAmount((pair.reserve1 * pair.balance) / pair.totalSupply, pair.token1Info.decimals)} />
              <DetailRow label="LP tokens" value={formatAmount(pair.balance, 18, 6)} />
              <DetailRow label="Pool share" value={formatPercent(share)} />
            </section>
          )}
        </aside>
      </div>
      <NoteBar>Reserves are read live from each pair contract on QRL Devnet (chain 3151908). Test tokens have no value.</NoteBar>
    </>
  );
}
