import { useMemo, useState } from 'react';
import { PositionCard, V2Card } from '../components/pool/PositionCard';
import { MenuButton, qrlAmount, useTvl, useValueInQrl } from '../components/pool/common';
import { PoolsTable } from '../components/tables';
import { Icon, Skeleton, Stat } from '../components/ui';
import { usePoolStats } from '../hooks/market';
import { usePositions } from '../hooks/pools';
import { useV3Positions } from '../hooks/v3';
import { formatAmount } from '../lib/format';
import { go, href } from '../lib/router';
import { useApp } from '../state/app';
import { useWallet } from '../state/wallet';
import '../styles/pool.css';

type Status = 'open' | 'closed' | 'all';
type Protocol = 'all' | 'v3' | 'v2';
const STATUS_LABEL: Record<Status, string> = { open: 'Open', closed: 'Closed', all: 'All' };
const PROTOCOL_LABEL: Record<Protocol, string> = { all: 'All', v3: 'V3', v2: 'V2' };

/// Label, value and delta lines of a Stat, shimmering.
const StatSkeleton = () => (
  <div className="stat" aria-hidden="true">
    <Skeleton w={96} h={14} />
    <Skeleton w={132} h={24} />
    <Skeleton w={80} h={14} />
  </div>
);

function NewPositionButton() {
  return (
    <div className="split-btn">
      <a className="btn btn-md btn-primary" href={href({ page: 'newPosition' })}>
        New position
      </a>
      <MenuButton
        className="btn btn-md btn-primary"
        trigger={<Icon name="chevron-down" size={18} />}
        items={[
          { label: 'V3 position', sub: 'Concentrated liquidity, pick a range', onClick: () => go({ page: 'newPosition' }, { version: 'v3' }) },
          { label: 'V2 position', sub: 'Full range, 0.3% fee', onClick: () => go({ page: 'newPosition' }, { version: 'v2' }) },
        ]}
      />
    </div>
  );
}

function TopPools() {
  const { pools } = useApp();
  return (
    <section className="pool-section">
      <div className="section-head">
        <h2 className="section-title">Top pools by TVL</h2>
        <a className="link" href={href({ page: 'explore', tab: 'pools' })}>
          Explore pools <Icon name="chevron-right" size={16} />
        </a>
      </div>
      <PoolsTable pools={pools} limit={5} />
    </section>
  );
}

/// Pool · Your positions (94:87); Pool · Connect wallet (94:482) without a wallet.
export function Positions() {
  const { account } = useWallet();
  return account ? <Connected account={account} /> : <Disconnected />;
}

function Disconnected() {
  const { openModal } = useApp();
  return (
    <main className="page pool-page">
      <div className="page-title">
        <h1>Provide liquidity, earn swap fees</h1>
        <p>Deposit a token pair into a V2 or V3 pool. Fees accrue to your position on every trade.</p>
      </div>
      <div className="row" style={{ gap: 8 }}>
        <a className="btn btn-md btn-primary" href={href({ page: 'newPosition' })}>
          New position
        </a>
        <a className="btn btn-md btn-tertiary" href={href({ page: 'explore', tab: 'pools' })}>
          Explore pools
        </a>
      </div>
      <div className="card connect-card">
        <span className="halo">
          <Icon name="wallet" size={24} />
        </span>
        <span className="t-heading">Connect a wallet to see your positions</span>
        <span className="t-body c-3">PauliSwap reads V2 LP balances and V3 position NFTs from your Q-address.</span>
        <button className="btn btn-md btn-secondary" onClick={() => openModal('connect')}>
          Connect wallet
        </button>
      </div>
      <div className="explain-cards">
        <div className="card">
          <span className="row t-heading" style={{ gap: 8 }}>
            <Icon name="trend" size={18} className="c-quantum" /> V3 · Concentrated liquidity
          </span>
          <span className="t-body c-2">
            Pick a price range. Capital works only inside it, so fees per QRL are higher, but the position stops earning when price leaves the range. Fee tiers 0.05%, 0.3%, 1%.
          </span>
        </div>
        <div className="card">
          <span className="row t-heading" style={{ gap: 8 }}>
            <Icon name="layers" size={18} className="c-2" /> V2 · Full range
          </span>
          <span className="t-body c-2">Liquidity covers every price. Simple to manage, earns 0.3% of every trade in the pool, fees compound into the LP tokens.</span>
        </div>
      </div>
      <TopPools />
    </main>
  );
}

function Connected({ account }: { account: string }) {
  const { pools } = useApp();
  const v2 = usePositions(account);
  const v3 = useV3Positions(account);
  const value = useValueInQrl();
  const tvl = useTvl();
  const [status, setStatus] = useState<Status>('open');
  const [protocol, setProtocol] = useState<Protocol>('all');

  // APR comes from each pool's 24h fees over its TVL.
  const statPools = useMemo(() => {
    const ids = new Set<string>([...(v3 ?? []).map((p) => p.pool?.id), ...(v2 ?? []).map((p) => `v2:${p.address.toLowerCase()}`)].filter(Boolean) as string[]);
    return pools.filter((p) => ids.has(p.id));
  }, [pools, v2, v3]);
  const stats = usePoolStats(statPools, '24h', tvl);

  const loading = !v2 || !v3;
  const v3List = v3 ?? [];
  const v2List = v2 ?? [];
  const openV3 = v3List.filter((p) => p.status !== 'closed');
  const v3Value = (p: (typeof v3List)[number]) => value(p.token0, p.amount0, p.token1, p.amount1);
  const v2Amounts = (p: (typeof v2List)[number]) => [p.totalSupply > 0n ? (p.reserve0 * p.balance) / p.totalSupply : 0n, p.totalSupply > 0n ? (p.reserve1 * p.balance) / p.totalSupply : 0n] as const;
  const v2Value = (p: (typeof v2List)[number]) => {
    const [a0, a1] = v2Amounts(p);
    return value(p.token0, a0, p.token1, a1);
  };
  const feesOf = (p: (typeof v3List)[number]) => value(p.token0, p.fees0, p.token1, p.fees1);

  const totalLiquidity = [...openV3.map(v3Value), ...v2List.map(v2Value)].reduce<number>((s, v) => s + (v ?? 0), 0);
  const unclaimed = v3List.reduce<number>((s, p) => s + (feesOf(p) ?? 0), 0);
  const withFees = v3List.filter((p) => p.fees0 > 0n || p.fees1 > 0n).length;
  const inRange = openV3.filter((p) => p.status === 'in').length;
  const lpTotal = v2List.reduce((s, p) => s + p.balance, 0n);

  const showV3 = protocol !== 'v2';
  const showV2 = protocol !== 'v3' && status !== 'closed';
  const v3Shown = showV3 ? v3List.filter((p) => (status === 'all' ? true : status === 'open' ? p.status !== 'closed' : p.status === 'closed')) : [];
  const v2Shown = showV2 ? v2List : [];
  const count = v3Shown.length + v2Shown.length;

  return (
    <main className="page pool-page">
      <div className="title-row">
        <div className="page-title">
          <h1>Your positions</h1>
          <p>Liquidity you provide on PauliSwap V2 and V3.</p>
        </div>
        <NewPositionButton />
      </div>

      <div className="pos-stats">
        <div className="card">
          {loading ? <StatSkeleton /> : <Stat label="Total liquidity" value={qrlAmount(totalLiquidity)} delta={`${openV3.length + v2List.length} open position${openV3.length + v2List.length === 1 ? '' : 's'}`} deltaTone="muted" />}
        </div>
        <div className="card">
          {loading ? <StatSkeleton /> : <Stat label="Unclaimed fees" value={qrlAmount(unclaimed)} delta={`Across ${withFees} position${withFees === 1 ? '' : 's'}`} deltaTone="muted" />}
        </div>
        <div className="card">
          {loading ? <StatSkeleton /> : <Stat label="In range" value={`${inRange} of ${openV3.length}`} delta="V3 positions" deltaTone="muted" />}
        </div>
        <div className="card">
          {loading ? <StatSkeleton /> : <Stat label="V2 LP tokens" value={formatAmount(lpTotal, 18, 2)} delta={`${v2List.length} pool${v2List.length === 1 ? '' : 's'}`} deltaTone="muted" />}
        </div>
      </div>

      <div className="filters">
        <MenuButton
          className="filter-chip"
          align="left"
          trigger={
            <>
              Status: {STATUS_LABEL[status]} <Icon name="chevron-down" size={16} />
            </>
          }
          items={(['open', 'closed', 'all'] as const).map((s) => ({ label: STATUS_LABEL[s], on: s === status, onClick: () => setStatus(s) }))}
        />
        <MenuButton
          className="filter-chip"
          align="left"
          trigger={
            <>
              Protocol: {PROTOCOL_LABEL[protocol]} <Icon name="chevron-down" size={16} />
            </>
          }
          items={(['all', 'v3', 'v2'] as const).map((s) => ({ label: PROTOCOL_LABEL[s], on: s === protocol, onClick: () => setProtocol(s) }))}
        />
        <span className="grow" />
        {!loading && (
          <span className="t-label c-3">
            {count} position{count === 1 ? '' : 's'}
          </span>
        )}
      </div>

      <div className="positions">
        {loading &&
          [0, 1].map((i) => (
            <div key={i} className="position-card" aria-hidden="true">
              <div className="left">
                <div className="title">
                  <span className="pair-icon" style={{ ['--overlap' as string]: '-10px' }}>
                    <Skeleton w={32} h={32} round />
                    <Skeleton w={32} h={32} round />
                  </span>
                  <Skeleton w={110} h={18} />
                  <Skeleton w={28} h={18} />
                  <Skeleton w={42} h={18} />
                </div>
                <Skeleton w="55%" h={14} />
              </div>
              {[0, 1, 2].map((m) => (
                <div key={m} className="metric">
                  <Skeleton w={64} h={12} />
                  <Skeleton w={96} h={16} />
                </div>
              ))}
            </div>
          ))}
        {!loading &&
          v3Shown.map((p) => (
            <PositionCard key={p.id} position={p} liquidity={v3Value(p)} fees={feesOf(p)} apr={p.status === 'in' && p.pool ? stats.get(p.pool.id)?.feeApr ?? null : null} />
          ))}
        {!loading &&
          v2Shown.map((p) => <V2Card key={p.address} position={p} liquidity={v2Value(p)} apr={stats.get(`v2:${p.address.toLowerCase()}`)?.feeApr ?? null} />)}
        {!loading && count === 0 && (
          <div className="card connect-card">
            <span className="halo">
              <Icon name="plus" size={24} />
            </span>
            <span className="t-heading">{status === 'closed' ? 'No closed positions' : 'No positions yet'}</span>
            <span className="t-body c-3">Deposit a pair into a pool to start earning a share of every trade.</span>
            <a className="btn btn-md btn-secondary" href={href({ page: 'newPosition' })}>
              New position
            </a>
          </div>
        )}
      </div>

      <TopPools />
    </main>
  );
}

