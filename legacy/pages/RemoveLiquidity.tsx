import { useState } from 'react';
import { DetailRow, Seg, Skeleton, TokenIcon, TokenPairIcon } from '../components/ui';
import { ADDRESSES, MAX_UINT256 } from '../config';
import { useAllowance } from '../hooks/chain';
import { usePair } from '../hooks/pools';
import { pair as pairContract, router } from '../lib/chain';
import { applySlippage, formatAmount, formatPrice, toFloat } from '../lib/format';
import { displaySymbol, isWqrl, NATIVE, Token } from '../lib/tokens';
import { useApp } from '../state/app';
import { useTx } from '../state/tx';
import { useWallet } from '../state/wallet';

export function RemoveLiquidity({ pairAddress }: { pairAddress: string }) {
  const { tokens, settings, openModal } = useApp();
  const { account, wrongNetwork, switchChain } = useWallet();
  const { send } = useTx();
  const { pair, error } = usePair(pairAddress, account);
  const [percent, setPercent] = useState(50);
  const [receiveNative, setReceiveNative] = useState(true);
  const { allowance, refresh } = useAllowance(pairAddress, account, ADDRESSES.PauliV2Router02);
  const sym = (t: Token | null | undefined) => displaySymbol(t, tokens);

  if (error) {
    return (
      <span className="t-body c-critical">No PauliSwap V2 pair at this address.</span>
    );
  }

  const liquidity = pair ? (pair.balance * BigInt(percent)) / 100n : 0n;
  const out0 = pair && pair.totalSupply ? (pair.reserve0 * liquidity) / pair.totalSupply : 0n;
  const out1 = pair && pair.totalSupply ? (pair.reserve1 * liquidity) / pair.totalSupply : 0n;
  const wqrlSide = pair ? (isWqrl(pair.token0Info) ? 0 : isWqrl(pair.token1Info) ? 1 : -1) : -1;
  const unwrap = wqrlSide >= 0 && receiveNative;
  const shownToken = (side: 0 | 1): Token | null => (pair ? (unwrap && wqrlSide === side ? NATIVE : side === 0 ? pair.token0Info : pair.token1Info) : null);
  const needsApproval = allowance !== undefined && liquidity > 0n && allowance < liquidity;
  const rate = pair && pair.reserve0 > 0n ? toFloat(pair.reserve1, pair.token1Info.decimals) / toFloat(pair.reserve0, pair.token0Info.decimals) : 0;

  const approve = () =>
    send({
      title: 'Approve PAULI-V2',
      activity: `Approved ${sym(pair?.token0Info)}/${sym(pair?.token1Info)} LP for PauliV2Router`,
      successTitle: 'Approval confirmed',
      build: () => ({ to: pairAddress, method: pairContract(pairAddress).methods.approve(ADDRESSES.PauliV2Router02, MAX_UINT256) }),
    }).then((ok) => ok && refresh());

  const remove = () => {
    if (!pair || !account || liquidity === 0n) return;
    const deadline = BigInt(Math.floor(Date.now() / 1000) + settings.deadlineMin * 60);
    const min0 = applySlippage(out0, settings.slippageBps, 'down');
    const min1 = applySlippage(out1, settings.slippageBps, 'down');
    const t0 = shownToken(0)!;
    const t1 = shownToken(1)!;
    send({
      title: 'Remove liquidity',
      activity: `Removed ${sym(pair.token0Info)} / ${sym(pair.token1Info)} liquidity`,
      successTitle: 'Liquidity removed',
      successText: `You received ${formatAmount(out0, t0.decimals)} ${sym(t0)} and ${formatAmount(out1, t1.decimals)} ${sym(t1)}.`,
      summary: { from: { token: t0, amount: out0, label: sym(t0) }, to: { token: t1, amount: out1, label: sym(t1) } },
      build: () => {
        const m = router().methods;
        if (unwrap) {
          const tokenSide = wqrlSide === 0 ? 1 : 0;
          const tokenAddress = tokenSide === 0 ? pair.token0 : pair.token1;
          const [minToken, minQrl] = tokenSide === 0 ? [min0, min1] : [min1, min0];
          return { to: ADDRESSES.PauliV2Router02, method: m.removeLiquidityQRL(tokenAddress, liquidity, minToken, minQrl, account, deadline) };
        }
        return { to: ADDRESSES.PauliV2Router02, method: m.removeLiquidity(pair.token0, pair.token1, liquidity, min0, min1, account, deadline) };
      },
    }).then((ok) => ok && percent === 100 && setPercent(50));
  };

  let primary: { label: string; kind: string; onClick?: () => void };
  if (!account) primary = { label: 'Connect wallet', kind: 'secondary', onClick: () => openModal('connect') };
  else if (wrongNetwork) primary = { label: 'Switch to QRL Devnet', kind: 'primary', onClick: () => switchChain().catch(() => undefined) };
  else if (!pair || pair.balance === 0n) primary = { label: 'No liquidity to remove', kind: 'disabled' };
  else if (liquidity === 0n) primary = { label: 'Enter a percent', kind: 'disabled' };
  else if (allowance === undefined) primary = { label: 'Checking approval…', kind: 'disabled' };
  else primary = { label: 'Remove', kind: needsApproval ? 'disabled' : 'primary', onClick: remove };

  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="row">
        {pair ? <TokenPairIcon a={pair.token0Info} b={pair.token1Info} size={22} /> : <Skeleton w={40} h={22} />}
        <span className="t-body-strong grow">{pair ? `${sym(pair.token0Info)} / ${sym(pair.token1Info)}` : <Skeleton w={120} />}</span>
        <span className="t-mono c-3">{pair ? `${formatAmount(pair.balance, 18, 6)} LP` : ''}</span>
      </div>
      <div className="between">
        <span className="t-heading">Remove liquidity</span>
        <span className="big-pct">{percent}%</span>
      </div>
      <input
        className="slider"
        type="range"
        min={0}
        max={100}
        step={1}
        value={percent}
        onChange={(e) => setPercent(Number(e.target.value))}
        style={{ ['--pct' as string]: `${percent}%` }}
        aria-label="Percent of liquidity to remove"
      />
      <Seg options={['25%', '50%', '75%', 'Max'] as const} value={percent === 100 ? 'Max' : (`${percent}%` as '25%')} onChange={(v) => setPercent(v === 'Max' ? 100 : Number(v.replace('%', '')))} fill />
      <div className="field" style={{ gap: 10 }}>
        <div className="between">
          <span className="t-label c-3">You will receive</span>
          {wqrlSide >= 0 && <Seg options={['WQRL', 'QRL'] as const} value={receiveNative ? 'QRL' : 'WQRL'} onChange={(v) => setReceiveNative(v === 'QRL')} />}
        </div>
        {([0, 1] as const).map((side) => {
          const t = shownToken(side);
          return (
            <div className="row" key={side}>
              <span className="t-mono-strong grow">{t ? formatAmount(side === 0 ? out0 : out1, t.decimals, 6) : '—'}</span>
              <TokenIcon token={t} size={22} />
              <span className="t-body-strong">{sym(t)}</span>
            </div>
          );
        })}
      </div>
      {pair && (
        <div className="details" style={{ padding: '2px 4px' }}>
          <DetailRow label="Rate" value={`1 ${sym(pair.token0Info)} = ${formatPrice(rate)} ${sym(pair.token1Info)}`} />
          <DetailRow label="Max slippage" value={`${settings.slippageBps / 100}%`} info="Applied to both received amounts." />
        </div>
      )}
      {needsApproval && account && !wrongNetwork ? (
        <div className="col">
          <button className="btn btn-lg btn-primary" onClick={approve}>
            1 · Approve LP token
          </button>
          <button className="btn btn-lg" disabled>
            2 · Remove
          </button>
        </div>
      ) : (
        <button className={`btn btn-lg ${primary.kind === 'disabled' ? '' : 'btn-primary'}`} disabled={primary.kind === 'disabled'} onClick={primary.onClick}>
          {primary.label === 'Remove' ? `Remove ${percent}%` : primary.label}
        </button>
      )}
      {unwrap && <span className="t-caption c-3" style={{ padding: '0 4px' }}>Receiving QRL calls removeLiquidityQRL and unwraps WQRL in the same transaction.</span>}
    </div>
  );
}
