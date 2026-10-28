import { ReactNode, useState } from 'react';
import { ADDRESSES, MAX_UINT256 } from '../config';
import { useAllowance } from '../hooks/chain';
import { useNames } from '../hooks/names';
import { Position } from '../hooks/pools';
import { V3Position } from '../hooks/v3';
import { pair as pairContract, positionManager, router, sameAddress, ZERO_ADDRESS } from '../lib/chain';
import { applySlippage } from '../lib/format';
import { isWqrl, NATIVE, Token } from '../lib/tokens';
import { amountsForLiquidity, MAX_UINT128, sqrtRatioAtTick } from '../lib/v3';
import { useApp } from '../state/app';
import { useTx } from '../state/tx';
import { PairIcon, Modal, Badge, Icon, PoolBadges, Toggle } from './ui';
import { shownToken, TokenLine } from './position/parts';

const QUICK = [25, 50, 75, 100] as const;

function PercentPicker({ pct, onChange }: { pct: number; onChange: (n: number) => void }) {
  return (
    <div className="rm-amount">
      <div className="row">
        <span className="pos-big">{pct}%</span>
        <span className="grow" />
        <span className="t-body c-3">of position</span>
      </div>
      <input
        className="pct-slider"
        type="range"
        min={1}
        max={100}
        value={pct}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ ['--pct' as string]: `${pct}%` }}
        aria-label="Percent of the position to remove"
      />
      <div className="rm-quick">
        {QUICK.map((q) => (
          <button key={q} className={pct === q ? 'on' : ''} onClick={() => onChange(q)}>
            {q === 100 ? 'Max' : `${q}%`}
          </button>
        ))}
      </div>
    </div>
  );
}

function Shell({ title, a, b, badges, children, onClose }: { title: string; a?: Token; b?: Token; badges: ReactNode; children: ReactNode; onClose: () => void }) {
  return (
    <Modal title="Remove liquidity" onClose={onClose} width={460}>
      <div className="row" style={{ gap: 10 }}>
        <PairIcon a={a} b={b} size={32} />
        <span className="t-body-strong">{title}</span>
        {badges}
      </div>
      {children}
    </Modal>
  );
}

/// Remove liquidity from a V3 position (96:1242): decreaseLiquidity + collect
/// (+ unwrapWQRL9 / sweepToken for QRL, + burn when the whole position goes).
export function RemoveV3Modal({ position: p, account, onClose }: { position: V3Position; account: string; onClose: () => void }) {
  const { tokenByAddress, decimalsOf, settings } = useApp();
  const { symOf } = useNames();
  const { send } = useTx();
  const [pct, setPct] = useState(50);
  const [withFees, setWithFees] = useState(true);
  const pool = p.pool;
  const wq0 = sameAddress(p.token0, ADDRESSES.WQRL);
  const wq1 = sameAddress(p.token1, ADDRESSES.WQRL);
  const t0 = shownToken(tokenByAddress(p.token0), p.token0);
  const t1 = shownToken(tokenByAddress(p.token1), p.token1);
  const s0 = wq0 ? 'QRL' : symOf(p.token0);
  const s1 = wq1 ? 'QRL' : symOf(p.token1);
  const d0 = decimalsOf(p.token0);
  const d1 = decimalsOf(p.token1);
  const liquidity = (p.liquidity * BigInt(pct)) / 100n;
  const [out0, out1] = pool ? amountsForLiquidity(pool.sqrtPriceX96, sqrtRatioAtTick(p.tickLower), sqrtRatioAtTick(p.tickUpper), liquidity) : [0n, 0n];
  const closing = pct === 100 && withFees;

  const remove = () => {
    const npm = positionManager();
    const min0 = applySlippage(out0, settings.slippageBps, 'down');
    const min1 = applySlippage(out1, settings.slippageBps, 'down');
    const deadline = BigInt(Math.floor(Date.now() / 1000) + settings.deadlineMin * 60);
    send({
      title: closing ? 'Remove and close position' : `Remove ${pct}% of liquidity`,
      verb: 'removal',
      activity: 'Removed liquidity',
      successTitle: 'Liquidity removed',
      summary: { from: { token: t0 ?? NATIVE, amount: out0 + (withFees ? p.fees0 : 0n), label: s0 }, to: { token: t1 ?? NATIVE, amount: out1 + (withFees ? p.fees1 : 0n), label: s1 }, joiner: 'plus' },
      build: () => {
        const unwrap = wq0 || wq1;
        // Without fees, collect caps at the principal so the fees stay owed.
        const max0 = withFees ? MAX_UINT128 : out0;
        const max1 = withFees ? MAX_UINT128 : out1;
        const calls = [
          (npm.methods.decreaseLiquidity([p.id, liquidity, min0, min1, deadline]) as any).encodeABI(),
          (npm.methods.collect([p.id, unwrap ? ZERO_ADDRESS : account, max0, max1]) as any).encodeABI(),
        ];
        if (unwrap) {
          calls.push((npm.methods.unwrapWQRL9(wq0 ? min0 : min1, account) as any).encodeABI());
          calls.push((npm.methods.sweepToken(wq0 ? p.token1 : p.token0, wq0 ? min1 : min0, account) as any).encodeABI());
        }
        if (closing) calls.push((npm.methods.burn(p.id) as any).encodeABI());
        return { to: ADDRESSES.NonfungiblePositionManager, method: npm.methods.multicall(calls) };
      },
    }).then((ok) => ok && onClose());
  };

  return (
    <Shell
      title={`${s0} / ${s1}`}
      a={t0}
      b={t1}
      onClose={onClose}
      badges={
        <>
          <PoolBadges version="v3" fee={p.fee} />
          <span className="grow" />
          <Badge tone={p.status === 'in' ? 'success' : p.status === 'out' ? 'warning' : 'alert'}>{p.status === 'in' ? 'In range' : p.status === 'out' ? 'Out of range' : 'Closed'}</Badge>
        </>
      }
    >
      <PercentPicker pct={pct} onChange={setPct} />
      <div className="rm-receive">
        <span className="t-label c-3">You will receive</span>
        <TokenLine token={t0} symbol={s0} amount={out0} decimals={d0} />
        <TokenLine token={t1} symbol={s1} amount={out1} decimals={d1} />
        {withFees && (p.fees0 > 0n || p.fees1 > 0n) && (
          <>
            <hr className="divider" />
            <TokenLine token={t0} symbol={s0} amount={p.fees0} decimals={d0} prefix="+ " suffix=" fees" />
            <TokenLine token={t1} symbol={s1} amount={p.fees1} decimals={d1} prefix="+ " suffix=" fees" />
          </>
        )}
      </div>
      <div className="row" style={{ gap: 12 }}>
        <div className="col grow" style={{ gap: 2 }}>
          <span className="t-body-strong">Collect fees as well</span>
          <span className="t-caption c-3">{pct === 100 && withFees ? 'Fees are sent too and the position NFT is burned.' : 'Fees are sent to your wallet in the same transaction.'}</span>
        </div>
        <Toggle on={withFees} onChange={setWithFees} label="Collect fees as well" />
      </div>
      <button className="btn btn-lg btn-danger" disabled={liquidity === 0n || !pool} onClick={remove}>
        Remove {pct}%
      </button>
    </Shell>
  );
}

/// Remove V2 liquidity: approve the LP token once, then removeLiquidity(QRL).
export function RemoveV2Modal({ pair, account, onClose }: { pair: Position; account: string; onClose: () => void }) {
  const { settings } = useApp();
  const { sym } = useNames();
  const { send } = useTx();
  const [pct, setPct] = useState(50);
  const [native, setNative] = useState(true);
  const { allowance, refresh } = useAllowance(pair.address, account, ADDRESSES.PauliV2Router02);
  const liquidity = (pair.balance * BigInt(pct)) / 100n;
  const out0 = pair.totalSupply ? (pair.reserve0 * liquidity) / pair.totalSupply : 0n;
  const out1 = pair.totalSupply ? (pair.reserve1 * liquidity) / pair.totalSupply : 0n;
  const wqrlSide = isWqrl(pair.token0Info) ? 0 : isWqrl(pair.token1Info) ? 1 : -1;
  const unwrap = wqrlSide >= 0 && native;
  const tok = (side: 0 | 1) => (unwrap && wqrlSide === side ? NATIVE : side === 0 ? pair.token0Info : pair.token1Info);
  const label = (side: 0 | 1) => (wqrlSide === side && unwrap ? 'QRL' : sym(side === 0 ? pair.token0Info : pair.token1Info));
  const needsApproval = allowance !== undefined && liquidity > 0n && allowance < liquidity;

  const approve = () =>
    send({
      title: 'Approve LP token',
      verb: 'approval',
      activity: 'Approved LP token',
      successTitle: 'Approval confirmed',
      build: () => ({ to: pair.address, method: pairContract(pair.address).methods.approve(ADDRESSES.PauliV2Router02, MAX_UINT256) }),
    }).then((ok) => ok && refresh());

  const remove = () => {
    const deadline = BigInt(Math.floor(Date.now() / 1000) + settings.deadlineMin * 60);
    const min0 = applySlippage(out0, settings.slippageBps, 'down');
    const min1 = applySlippage(out1, settings.slippageBps, 'down');
    send({
      title: `Remove ${pct}% of liquidity`,
      verb: 'removal',
      activity: 'Removed liquidity',
      successTitle: 'Liquidity removed',
      prior: allowance !== undefined && !needsApproval ? ['Approve LP token'] : undefined,
      summary: { from: { token: tok(0), amount: out0, label: label(0) }, to: { token: tok(1), amount: out1, label: label(1) }, joiner: 'plus' },
      build: () => {
        const m = router().methods;
        if (unwrap) {
          const tokenSide = wqrlSide === 0 ? 1 : 0;
          const [minToken, minQrl] = tokenSide === 0 ? [min0, min1] : [min1, min0];
          return { to: ADDRESSES.PauliV2Router02, method: m.removeLiquidityQRL(tokenSide === 0 ? pair.token0 : pair.token1, liquidity, minToken, minQrl, account, deadline) };
        }
        return { to: ADDRESSES.PauliV2Router02, method: m.removeLiquidity(pair.token0, pair.token1, liquidity, min0, min1, account, deadline) };
      },
    }).then((ok) => ok && onClose());
  };

  return (
    <Shell title={`${label(0)} / ${label(1)}`} a={tok(0)} b={tok(1)} onClose={onClose} badges={<PoolBadges version="v2" fee={3000} />}>
      <PercentPicker pct={pct} onChange={setPct} />
      <div className="rm-receive">
        <span className="t-label c-3">You will receive</span>
        <TokenLine token={tok(0)} symbol={label(0)} amount={out0} decimals={pair.token0Info.decimals} />
        <TokenLine token={tok(1)} symbol={label(1)} amount={out1} decimals={pair.token1Info.decimals} />
      </div>
      {wqrlSide >= 0 && (
        <div className="row" style={{ gap: 12 }}>
          <div className="col grow" style={{ gap: 2 }}>
            <span className="t-body-strong">Receive QRL</span>
            <span className="t-caption c-3">Unwraps WQRL in the same transaction (removeLiquidityQRL).</span>
          </div>
          <Toggle on={native} onChange={setNative} label="Receive QRL instead of WQRL" />
        </div>
      )}
      {needsApproval ? (
        <button className="btn btn-lg btn-primary" onClick={approve}>
          Approve LP token
        </button>
      ) : (
        <button className="btn btn-lg btn-danger" disabled={liquidity === 0n || allowance === undefined} onClick={remove}>
          {allowance === undefined && <Icon name="loader" size={20} className="spin" />}
          {allowance === undefined ? 'Checking approval…' : `Remove ${pct}%`}
        </button>
      )}
    </Shell>
  );
}
