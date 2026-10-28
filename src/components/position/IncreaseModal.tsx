import { useState } from 'react';
import { ADDRESSES, MAX_UINT256 } from '../../config';
import { useAllowance, useBalances } from '../../hooks/chain';
import { useNames } from '../../hooks/names';
import { V3Position } from '../../hooks/v3';
import { positionManager, sameAddress, token as tokenContract } from '../../lib/chain';
import { applySlippage, formatAmount, parseUnits, toInputString } from '../../lib/format';
import { NATIVE, Token } from '../../lib/tokens';
import { dependentAmount } from '../../lib/v3';
import { useApp } from '../../state/app';
import { useTx } from '../../state/tx';
import { AmountPanel, Banner, Badge, Icon, Modal, PairIcon, PoolBadges } from '../ui';
import { shownToken } from './parts';

/// Add liquidity to an existing V3 position: increaseLiquidity (+ refundQRL
/// in a multicall when one side is native QRL).
export function IncreaseModal({ position: p, account, onClose }: { position: V3Position; account: string; onClose: () => void }) {
  const { tokenByAddress, decimalsOf, settings } = useApp();
  const { symOf } = useNames();
  const { send } = useTx();
  const [typed, setTyped] = useState<{ side: 0 | 1; value: string }>({ side: 0, value: '' });
  const pool = p.pool;
  const wq0 = sameAddress(p.token0, ADDRESSES.WQRL);
  const wq1 = sameAddress(p.token1, ADDRESSES.WQRL);
  const in0: Token = shownToken(tokenByAddress(p.token0), p.token0) ?? NATIVE;
  const in1: Token = shownToken(tokenByAddress(p.token1), p.token1) ?? NATIVE;
  const s0 = wq0 ? 'QRL' : symOf(p.token0);
  const s1 = wq1 ? 'QRL' : symOf(p.token1);
  const d0 = decimalsOf(p.token0);
  const d1 = decimalsOf(p.token1);
  const below = !!pool && pool.tick < p.tickLower;
  const above = !!pool && pool.tick >= p.tickUpper;

  const typedAmount = parseUnits(typed.value, typed.side === 0 ? d0 : d1);
  const other = pool && typedAmount ? dependentAmount(typed.side, typedAmount, pool.sqrtPriceX96, p.tickLower, p.tickUpper) : 0n;
  const inc0 = typed.side === 0 ? typedAmount ?? 0n : other;
  const inc1 = typed.side === 1 ? typedAmount ?? 0n : other;
  const balanceOf = useBalances([in0, in1], account);
  const allow0 = useAllowance(!wq0 ? p.token0 : null, account, ADDRESSES.NonfungiblePositionManager);
  const allow1 = useAllowance(!wq1 ? p.token1 : null, account, ADDRESSES.NonfungiblePositionManager);
  const need0 = !wq0 && inc0 > 0n && allow0.allowance !== undefined && allow0.allowance < inc0;
  const need1 = !wq1 && inc1 > 0n && allow1.allowance !== undefined && allow1.allowance < inc1;
  const short = (balanceOf(in0) ?? 0n) < inc0 || (balanceOf(in1) ?? 0n) < inc1;

  const approve = (address: string, label: string, refresh: () => void) =>
    send({
      title: `Approve ${label}`,
      verb: 'approval',
      activity: `Approved ${label}`,
      successTitle: 'Approval confirmed',
      build: () => ({ to: address, method: tokenContract(address).methods.approve(ADDRESSES.NonfungiblePositionManager, MAX_UINT256) }),
    }).then((ok) => ok && refresh());

  const increase = () => {
    const npm = positionManager();
    const native = wq0 ? inc0 : wq1 ? inc1 : 0n;
    const deadline = BigInt(Math.floor(Date.now() / 1000) + settings.deadlineMin * 60);
    send({
      title: 'Add liquidity',
      verb: 'deposit',
      activity: 'Added liquidity',
      successTitle: 'Liquidity added',
      value: native || undefined,
      prior: [!wq0 && inc0 > 0n ? `Approve ${s0}` : '', !wq1 && inc1 > 0n ? `Approve ${s1}` : ''].filter(Boolean),
      summary: { from: { token: in0, amount: inc0, label: s0 }, to: { token: in1, amount: inc1, label: s1 }, joiner: 'plus' },
      build: () => {
        const params = [p.id, inc0, inc1, applySlippage(inc0, settings.slippageBps, 'down'), applySlippage(inc1, settings.slippageBps, 'down'), deadline];
        if (!native) return { to: ADDRESSES.NonfungiblePositionManager, method: npm.methods.increaseLiquidity(params) };
        return {
          to: ADDRESSES.NonfungiblePositionManager,
          method: npm.methods.multicall([(npm.methods.increaseLiquidity(params) as any).encodeABI(), (npm.methods.refundQRL() as any).encodeABI()]),
        };
      },
    }).then((ok) => ok && onClose());
  };

  const amountOf = (side: 0 | 1) => {
    if ((side === 0 && above) || (side === 1 && below)) return '0';
    if (typed.side === side) return typed.value;
    const v = side === 0 ? inc0 : inc1;
    return v ? toInputString(v, side === 0 ? d0 : d1) : '';
  };

  return (
    <Modal title="Add liquidity" onClose={onClose} width={460}>
      <div className="row" style={{ gap: 10 }}>
        <PairIcon a={in0} b={in1} size={32} />
        <span className="t-body-strong">
          {s0} / {s1}
        </span>
        <PoolBadges version="v3" fee={p.fee} />
        <span className="grow" />
        <Badge>#{p.id}</Badge>
      </div>
      {p.status === 'out' && (
        <Banner tone="warning">The price is outside this range, so only {below ? s0 : s1} can be added. It earns fees once the price returns.</Banner>
      )}
      <div className="col" style={{ gap: 4, position: 'relative' }}>
        <AmountPanel
          label={s0}
          token={in0}
          symbol={s0}
          amount={amountOf(0)}
          readOnly={above}
          onAmount={(v) => setTyped({ side: 0, value: v })}
          balance={formatAmount(balanceOf(in0), d0)}
          onMax={above ? undefined : () => balanceOf(in0) !== undefined && setTyped({ side: 0, value: toInputString(balanceOf(in0)!, d0) })}
          focus={typed.side === 0}
        />
        <span className="center" style={{ position: 'absolute', left: 'calc(50% - 17px)', top: 'calc(50% - 17px)', width: 34, height: 34, borderRadius: 12, background: 'var(--bg-elevated)', border: '1px solid var(--border-strong)' }}>
          <Icon name="plus" size={18} />
        </span>
        <AmountPanel
          label={s1}
          token={in1}
          symbol={s1}
          amount={amountOf(1)}
          readOnly={below}
          onAmount={(v) => setTyped({ side: 1, value: v })}
          balance={formatAmount(balanceOf(in1), d1)}
          onMax={below ? undefined : () => balanceOf(in1) !== undefined && setTyped({ side: 1, value: toInputString(balanceOf(in1)!, d1) })}
          focus={typed.side === 1}
        />
      </div>
      {need0 ? (
        <button className="btn btn-lg btn-primary" onClick={() => approve(p.token0, s0, allow0.refresh)}>
          Approve {s0}
        </button>
      ) : need1 ? (
        <button className="btn btn-lg btn-primary" onClick={() => approve(p.token1, s1, allow1.refresh)}>
          Approve {s1}
        </button>
      ) : (
        <button className="btn btn-lg btn-primary" disabled={(inc0 === 0n && inc1 === 0n) || short || !pool} onClick={increase}>
          {short ? 'Insufficient balance' : inc0 === 0n && inc1 === 0n ? 'Enter an amount' : 'Add liquidity'}
        </button>
      )}
    </Modal>
  );
}
