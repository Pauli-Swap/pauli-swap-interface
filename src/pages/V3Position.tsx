import { useState } from 'react';
import { AreaChart, Point, stampLabel } from '../components/Chart';
import { IncreaseModal } from '../components/position/IncreaseModal';
import { PositionHeader, qrlText, RatioBar, shownToken, TokenLine } from '../components/position/parts';
import { RemoveV3Modal } from '../components/RemoveLiquidityModal';
import { Badge, Busy, Crumbs, DetailRow, Empty, PoolBadges, Seg } from '../components/ui';
import { ADDRESSES } from '../config';
import devnet from '../contracts/devnet.json';
import { usePoolHistory } from '../hooks/market';
import { useNames } from '../hooks/names';
import { useV3Position } from '../hooks/v3';
import { positionManager, sameAddress, shortAddress, ZERO_ADDRESS } from '../lib/chain';
import { formatPrice, toFloat } from '../lib/format';
import { WINDOWS, WindowKey } from '../lib/history';
import { href } from '../lib/router';
import { NATIVE } from '../lib/tokens';
import { MAX_UINT128, priceFromSqrt, priceFromTick } from '../lib/v3';
import { useApp } from '../state/app';
import { useTx } from '../state/tx';
import { useWallet } from '../state/wallet';
import '../styles/position.css';

const FRAMES = { '1D': '24h', '1W': '7d', '1M': '30d', All: 'All' } as const satisfies Record<string, WindowKey>;
type Frame = keyof typeof FRAMES;
const FULL_LO = -887000;
const FULL_HI = 887000;

/// Position · V3 (Figma 96:953).
export function V3Position({ id }: { id: string }) {
  const { tokenByAddress, decimalsOf, priceInQrl, block, blockTime, openModal } = useApp();
  const { account, wrongNetwork, switchChain } = useWallet();
  const { send } = useTx();
  const { symOf } = useNames();
  const { position: p, owner, error } = useV3Position(id, account);
  const [inverted, setInverted] = useState(false);
  const [frame, setFrame] = useState<Frame>('1W');
  const [modal, setModal] = useState<'remove' | 'add' | null>(null);
  const pool = p?.pool ?? null;
  const history = usePoolHistory(pool, inverted ? p?.token1 : p?.token0, FRAMES[frame]);

  if (error)
    return (
      <main className="page pos-page">
        <Crumbs items={[{ label: 'Your positions', href: href({ page: 'positions' }) }, { label: `#${id}` }]} />
        <Empty icon="alert-triangle" title={`Position #${id} not found`}>
          It may have been burned, or the id belongs to another deployment.
        </Empty>
      </main>
    );
  if (!p)
    return (
      <main className="page pos-page">
        <Crumbs items={[{ label: 'Your positions', href: href({ page: 'positions' }) }, { label: `#${id}` }]} />
        <Busy className="t-body c-3">Loading position #{id} from the position manager…</Busy>
      </main>
    );

  const wq0 = sameAddress(p.token0, ADDRESSES.WQRL);
  const wq1 = sameAddress(p.token1, ADDRESSES.WQRL);
  const t0 = shownToken(tokenByAddress(p.token0), p.token0);
  const t1 = shownToken(tokenByAddress(p.token1), p.token1);
  const s0 = wq0 ? 'QRL' : symOf(p.token0);
  const s1 = wq1 ? 'QRL' : symOf(p.token1);
  const d0 = decimalsOf(p.token0);
  const d1 = decimalsOf(p.token1);
  const isOwner = !!account && !!owner && sameAddress(account, owner);
  const full = p.tickLower <= FULL_LO && p.tickUpper >= FULL_HI;

  // Prices are token1 per token0 unless inverted.
  const lo = priceFromTick(p.tickLower, d0, d1);
  const hi = priceFromTick(p.tickUpper, d0, d1);
  const cur = pool?.sqrtPriceX96 ? priceFromSqrt(pool.sqrtPriceX96, d0, d1) : 0;
  const view = (v: number) => (inverted ? (v > 0 ? 1 / v : 0) : v);
  const [vMin, vMax] = inverted ? [view(hi), view(lo)] : [lo, hi];
  const vCur = view(cur);
  const [baseSym, quoteSym] = inverted ? [s1, s0] : [s0, s1];
  const unit = `${quoteSym} per ${baseSym}`;

  // Value in QRL (each side at its QRL price), and each side's share of it.
  const q0 = priceInQrl(p.token0);
  const q1 = priceInQrl(p.token1);
  const v0 = q0 === undefined ? null : toFloat(p.amount0, d0) * q0;
  const v1 = q1 === undefined ? null : toFloat(p.amount1, d1) * q1;
  const value = v0 === null || v1 === null ? null : v0 + v1;
  const share0 = value && v0 !== null ? v0 / value : null;
  const f0 = q0 === undefined ? null : toFloat(p.fees0, d0) * q0;
  const f1 = q1 === undefined ? null : toFloat(p.fees1, d1) * q1;
  const fees = f0 === null || f1 === null ? null : f0 + f1;
  const hasFees = p.fees0 > 0n || p.fees1 > 0n;

  // The chart: on-chain pool prices over the window; a flat line at the
  // current price when the pool had no trades in it.
  let points: Point[] = history.points;
  if (points.length < 2 && pool && vCur > 0 && !history.loading) {
    const now = blockTime(block);
    const span = WINDOWS[FRAMES[frame]];
    const start = Math.max(blockTime(devnet.startBlock), Number.isFinite(span) ? now - span : 0);
    points = [
      { t: start, v: vCur },
      { t: now, v: vCur },
    ];
  }
  const inRange = (v: number) => v >= vMin && v < vMax;

  const gate = (fn: () => void) => () => {
    if (!account) return openModal('connect');
    if (wrongNetwork) return void switchChain().catch(() => undefined);
    fn();
  };
  const ownerOnly = account && !isOwner ? 'Only the owner can manage this position' : undefined;

  const collect = () => {
    if (!account) return;
    const npm = positionManager();
    const unwrap = wq0 || wq1;
    send({
      title: 'Collect fees',
      verb: 'collect',
      activity: 'Collected fees',
      successTitle: 'Fees collected',
      summary: { from: { token: t0 ?? NATIVE, amount: p.fees0, label: s0 }, to: { token: t1 ?? NATIVE, amount: p.fees1, label: s1 }, joiner: 'plus' },
      build: () => {
        if (!unwrap) return { to: ADDRESSES.NonfungiblePositionManager, method: npm.methods.collect([p.id, account, MAX_UINT128, MAX_UINT128]) };
        return {
          to: ADDRESSES.NonfungiblePositionManager,
          method: npm.methods.multicall([
            (npm.methods.collect([p.id, ZERO_ADDRESS, MAX_UINT128, MAX_UINT128]) as any).encodeABI(),
            (npm.methods.unwrapWQRL9(0n, account) as any).encodeABI(),
            (npm.methods.sweepToken(wq0 ? p.token1 : p.token0, 0n, account) as any).encodeABI(),
          ]),
        };
      },
    });
  };

  const status = p.status === 'in' ? 'In range' : p.status === 'out' ? 'Out of range' : 'Closed';
  const statusTone = p.status === 'in' ? 'success' : p.status === 'out' ? 'warning' : 'alert';

  return (
    <main className="page pos-page">
      <Crumbs items={[{ label: 'Your positions', href: href({ page: 'positions' }) }, { label: `${s0} / ${s1} #${p.id}` }]} />
      <PositionHeader
        a={t0}
        b={t1}
        title={`${s0} / ${s1}`}
        badges={
          <>
            <PoolBadges version="v3" fee={p.fee} />
            <Badge tone={statusTone}>{status}</Badge>
          </>
        }
        actions={
          <>
            <button className="btn btn-md btn-tertiary" disabled={!!ownerOnly || !pool} title={ownerOnly} onClick={gate(() => setModal('add'))}>
              Add liquidity
            </button>
            <button className="btn btn-md btn-tertiary" disabled={!!ownerOnly || p.liquidity === 0n} title={ownerOnly} onClick={gate(() => setModal('remove'))}>
              Remove liquidity
            </button>
            <button className="btn btn-md btn-primary" disabled={!!ownerOnly || !hasFees} title={ownerOnly ?? (!hasFees ? 'No fees to collect yet' : undefined)} onClick={gate(collect)}>
              Collect fees
            </button>
          </>
        }
      />

      <div className="pos-cols">
        <div className="pos-main">
          <section className="card pos-card">
            <div className="row">
              <span className="t-heading">Price range</span>
              <span className="grow" />
              <Seg
                boxed
                options={['fwd', 'inv'] as const}
                labels={{ fwd: `${s1} per ${s0}`, inv: `${s0} per ${s1}` }}
                value={inverted ? 'inv' : 'fwd'}
                onChange={(v) => setInverted(v === 'inv')}
              />
            </div>
            <AreaChart
              points={points}
              height={240}
              line="var(--text-primary)"
              area={false}
              unit={unit}
              band={full ? undefined : { min: vMin, max: vMax }}
              sub={(pt) => `${stampLabel(pt.t)} · ${full || inRange(pt.v) ? 'in range' : 'out of range'}`}
              loading={history.loading}
            />
            <div>
              <Seg boxed options={Object.keys(FRAMES) as Frame[]} value={frame} onChange={setFrame} />
            </div>
            <div className="price-boxes">
              <div className="price-box">
                <span className="t-label c-3">Min price</span>
                <span className="v">{full ? '0' : formatPrice(vMin)}</span>
                <span className="t-caption c-3">{full ? 'Full range' : `100% ${baseSym} below this`}</span>
              </div>
              <div className="price-box current">
                <span className="t-label c-3">Current price</span>
                <span className="v">{pool ? formatPrice(vCur) : '—'}</span>
                <span className="t-caption c-3">{unit}</span>
              </div>
              <div className="price-box">
                <span className="t-label c-3">Max price</span>
                <span className="v">{full ? '∞' : formatPrice(vMax)}</span>
                <span className="t-caption c-3">{full ? 'Full range' : `100% ${quoteSym} above this`}</span>
              </div>
            </div>
          </section>
        </div>

        <aside className="pos-side">
          <section className="card pos-card">
            <span className="t-label c-3">Liquidity</span>
            <span className="pos-big">{qrlText(value)}</span>
            <RatioBar share={share0} left={t0} right={t1} />
            <TokenLine token={t0} symbol={s0} amount={p.amount0} decimals={d0} pct={share0} />
            <TokenLine token={t1} symbol={s1} amount={p.amount1} decimals={d1} pct={share0 === null ? null : 1 - share0} />
          </section>

          <section className="card pos-card">
            <div className="row">
              <span className="t-label c-3">Unclaimed fees</span>
              <span className="grow" />
              <button className="btn btn-md btn-secondary" disabled={!!ownerOnly || !hasFees} title={ownerOnly} onClick={gate(collect)}>
                Collect
              </button>
            </div>
            <span className="pos-big">{qrlText(fees)}</span>
            <TokenLine token={t0} symbol={s0} amount={p.fees0} decimals={d0} />
            <TokenLine token={t1} symbol={s1} amount={p.fees1} decimals={d1} />
          </section>

          <section className="card pos-card tight">
            <span className="t-label c-3">Position NFT</span>
            <DetailRow label="Token ID" value={`#${p.id}`} />
            <DetailRow label="Owner" value={owner ? (isOwner ? `${shortAddress(owner)} (you)` : shortAddress(owner)) : '—'} />
            <DetailRow label="Manager" value="NonfungiblePositionManager" />
          </section>
        </aside>
      </div>

      {modal === 'remove' && account && <RemoveV3Modal position={p} account={account} onClose={() => setModal(null)} />}
      {modal === 'add' && account && <IncreaseModal position={p} account={account} onClose={() => setModal(null)} />}
    </main>
  );
}
