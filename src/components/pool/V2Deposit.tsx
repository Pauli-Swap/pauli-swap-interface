import { useEffect, useState } from 'react';
import { ADDRESSES, MAX_UINT256, MINIMUM_LIQUIDITY } from '../../config';
import { useAllowance, useBalances } from '../../hooks/chain';
import { useNames } from '../../hooks/names';
import { usePair } from '../../hooks/pools';
import { router, token as tokenContract } from '../../lib/chain';
import { applySlippage, formatAmount, formatPercent, formatPrice, parseUnits, sqrt, toFloat, toInputString } from '../../lib/format';
import { getPairAddress, orderedReserves } from '../../lib/pairs';
import { go } from '../../lib/router';
import { isNative, Token, wrappedAddress } from '../../lib/tokens';
import { useApp } from '../../state/app';
import { useTx } from '../../state/tx';
import { useWallet } from '../../state/wallet';
import { AmountPanel, Badge, Busy, DetailRow, Icon, PairIcon } from '../ui';
import { qrlAmount, useTvl } from './common';
import { findPool } from './PairStep';

/// Step 2 of a V2 position: deposit both tokens at the pool ratio (95:1065).
export function V2Deposit({ tokenA, tokenB, onEdit, onPick }: { tokenA: Token; tokenB: Token; onEdit: () => void; onPick: (side: 'A' | 'B') => void }) {
  const { pools, settings, openModal, block, refreshTokens } = useApp();
  const { account, wrongNetwork, switchChain } = useWallet();
  const { send } = useTx();
  const { sym } = useNames();
  const tvl = useTvl();
  const [field, setField] = useState<'A' | 'B'>('A');
  const [typed, setTyped] = useState('');
  const [typedOther, setTypedOther] = useState('');
  const [pairAddress, setPairAddress] = useState<string | null | undefined>(undefined);
  const [approved, setApproved] = useState<string[]>([]);

  useEffect(() => {
    let alive = true;
    getPairAddress(wrappedAddress(tokenA), wrappedAddress(tokenB)).then((a) => alive && setPairAddress(a));
    return () => {
      alive = false;
    };
  }, [tokenA, tokenB, block]);

  const { pair } = usePair(pairAddress, account);
  const [reserveA, reserveB] = pair ? orderedReserves(pair, wrappedAddress(tokenA)) : [0n, 0n];
  const isNewPair = pairAddress === null || (pair !== null && pair.totalSupply === 0n);
  const hasRatio = !isNewPair && reserveA > 0n && reserveB > 0n;
  const poolInfo = findPool(pools, 'v2', tokenA, tokenB);
  const poolTvl = poolInfo ? tvl(poolInfo) : null;

  const independent = field === 'A' ? tokenA : tokenB;
  const parsed = parseUnits(typed, independent.decimals);
  let amountA: bigint | null = field === 'A' ? parsed : null;
  let amountB: bigint | null = field === 'B' ? parsed : null;
  if (hasRatio && parsed) {
    if (field === 'A') amountB = (parsed * reserveB) / reserveA;
    else amountA = (parsed * reserveA) / reserveB;
  } else if (!hasRatio) {
    const otherParsed = parseUnits(typedOther, (field === 'A' ? tokenB : tokenA).decimals);
    if (field === 'A') amountB = otherParsed;
    else amountA = otherParsed;
  }

  const balanceOf = useBalances([tokenA, tokenB], account);
  const router02 = ADDRESSES.PauliV2Router02;
  const allowA = useAllowance(!isNative(tokenA) ? tokenA.address : null, account, router02);
  const allowB = useAllowance(!isNative(tokenB) ? tokenB.address : null, account, router02);
  const needA = !isNative(tokenA) && amountA !== null && allowA.allowance !== undefined && allowA.allowance < amountA;
  const needB = !isNative(tokenB) && amountB !== null && allowB.allowance !== undefined && allowB.allowance < amountB;

  const liquidity =
    amountA && amountB
      ? isNewPair
        ? (() => {
            const root = sqrt(amountA * amountB);
            return root > MINIMUM_LIQUIDITY ? root - MINIMUM_LIQUIDITY : 0n;
          })()
        : pair && reserveA > 0n
          ? [(amountA * pair.totalSupply) / reserveA, (amountB * pair.totalSupply) / reserveB].reduce((x, y) => (x < y ? x : y))
          : 0n
      : 0n;
  const shareBefore = pair && pair.totalSupply > 0n ? toFloat(pair.balance ?? 0n, 18) / toFloat(pair.totalSupply, 18) : 0;
  const shareAfter = isNewPair
    ? liquidity > 0n
      ? 1
      : 0
    : pair
      ? (toFloat(pair.balance ?? 0n, 18) + toFloat(liquidity, 18)) / (toFloat(pair.totalSupply, 18) + toFloat(liquidity, 18))
      : 0;
  const priceAB = hasRatio
    ? toFloat(reserveB, tokenB.decimals) / toFloat(reserveA, tokenA.decimals)
    : amountA && amountB
      ? toFloat(amountB, tokenB.decimals) / toFloat(amountA, tokenA.decimals)
      : 0;

  const approve = (t: Token, amount: bigint, refresh: () => void) =>
    send({
      title: `Approve ${sym(t)}`,
      verb: 'approval',
      activity: 'Approved',
      successTitle: 'Approval confirmed',
      summary: { from: { token: t, amount, label: `${sym(t)} for PauliV2Router02` } },
      build: () => ({ to: t.address, method: tokenContract(t.address).methods.approve(router02, MAX_UINT256) }),
    }).then((ok) => {
      if (ok) {
        setApproved((list) => [...list, `Approve ${sym(t)}`]);
        refresh();
      }
    });

  const supply = async () => {
    if (!amountA || !amountB || !account) return;
    const deadline = BigInt(Math.floor(Date.now() / 1000) + settings.deadlineMin * 60);
    const bps = isNewPair ? 0 : settings.slippageBps;
    const minA = applySlippage(amountA, bps, 'down');
    const minB = applySlippage(amountB, bps, 'down');
    const nativeA = isNative(tokenA);
    const nativeB = isNative(tokenB);
    const ok = await send({
      title: isNewPair ? 'Create pair and supply' : 'Supply liquidity',
      verb: 'supply',
      prior: approved,
      activity: 'Added liquidity',
      successTitle: 'Liquidity added',
      summary: { from: { token: tokenA, amount: amountA, label: sym(tokenA) }, to: { token: tokenB, amount: amountB, label: sym(tokenB) }, joiner: 'plus' },
      value: nativeA ? amountA : nativeB ? amountB : undefined,
      build: () => {
        const m = router().methods;
        const method = nativeA
          ? m.addLiquidityQRL(tokenB.address, amountB, minB, minA, account, deadline)
          : nativeB
            ? m.addLiquidityQRL(tokenA.address, amountA, minA, minB, account, deadline)
            : m.addLiquidity(tokenA.address, tokenB.address, amountA, amountB, minA, minB, account, deadline);
        return { to: router02, method };
      },
    });
    if (!ok) return;
    if (isNewPair) refreshTokens();
    const address = pairAddress ?? (await getPairAddress(wrappedAddress(tokenA), wrappedAddress(tokenB)));
    if (address) go({ page: 'v2pos', pair: address });
  };

  const shortA = amountA !== null && amountA > 0n && (balanceOf(tokenA) ?? 0n) < amountA;
  const shortB = amountB !== null && amountB > 0n && (balanceOf(tokenB) ?? 0n) < amountB;
  const blocked = !account
    ? { label: 'Connect wallet', kind: 'secondary', onClick: () => openModal('connect') }
    : wrongNetwork
      ? { label: 'Switch to QRL Devnet', kind: 'primary', onClick: () => switchChain().catch(() => undefined) }
      : !amountA || !amountB
        ? { label: 'Enter an amount' }
        : shortA
          ? { label: `Insufficient ${sym(tokenA)} balance` }
          : shortB
            ? { label: `Insufficient ${sym(tokenB)} balance` }
            : null;
  const approveStep = needA ? { token: tokenA, amount: amountA!, refresh: allowA.refresh } : needB ? { token: tokenB, amount: amountB!, refresh: allowB.refresh } : null;
  const approvable = [tokenA, tokenB].filter((t) => !isNative(t));

  const amountString = (side: 'A' | 'B', t: Token, value: bigint | null) => (field === side ? typed : hasRatio ? (value !== null ? toInputString(value, t.decimals) : '') : typedOther);
  const onType = (side: 'A' | 'B') => (v: string) => {
    if (field !== side) {
      if (!hasRatio) setTypedOther(typed);
      setField(side);
    }
    setTyped(v);
  };
  const max = (side: 'A' | 'B', t: Token) => {
    const bal = balanceOf(t);
    if (bal === undefined) return undefined;
    return () => onType(side)(toInputString(isNative(t) ? (bal > 10n ** 17n ? bal - 10n ** 17n : 0n) : bal, t.decimals, t.decimals));
  };
  const ratioText = hasRatio ? `Pool ratio 1 : ${formatPrice(priceAB)}` : 'You set the starting ratio';

  return (
    <>
      <div className="card pair-summary">
        <PairIcon a={tokenA} b={tokenB} size={32} />
        <span className="t-heading">
          {sym(tokenA)} / {sym(tokenB)}
        </span>
        <Badge>V2</Badge>
        <Badge>0.3%</Badge>
        {pairAddress === undefined ? (
          <Busy size={14} className="t-caption c-3">
            Looking up pair…
          </Busy>
        ) : (
          <span className="t-caption c-3">{isNewPair ? 'New pool' : `Existing pool${poolTvl !== null ? ` · ${qrlAmount(poolTvl)} TVL` : ''}`}</span>
        )}
        <span className="grow" />
        <button className="btn btn-sm btn-tertiary" onClick={onEdit}>
          Edit
        </button>
      </div>

      <div className="card np-card">
        <div className="head">
          <span className="t-heading">Deposit tokens</span>
          <span className="t-body c-3">
            {isNewPair ? 'Your deposit creates the pair; the ratio you enter sets its starting price. 1,000 wei of LP tokens are locked forever.' : 'Deposits must match the pool ratio. Enter one side and the other fills in.'}
          </span>
        </div>
        <div className="deposit-stack">
          <AmountPanel
            label={sym(tokenA)}
            token={tokenA}
            symbol={sym(tokenA)}
            amount={amountString('A', tokenA, amountA)}
            onAmount={onType('A')}
            onSelect={() => onPick('A')}
            focus={field === 'A'}
            error={shortA}
            sub={ratioText}
            balance={account ? formatAmount(balanceOf(tokenA), tokenA.decimals, 2) : undefined}
            onMax={account ? max('A', tokenA) : undefined}
          />
          <span className="joiner">
            <Icon name="plus" size={18} />
          </span>
          <AmountPanel
            label={sym(tokenB)}
            token={tokenB}
            symbol={sym(tokenB)}
            amount={amountString('B', tokenB, amountB)}
            onAmount={onType('B')}
            onSelect={() => onPick('B')}
            focus={field === 'B'}
            error={shortB}
            sub={hasRatio ? 'Filled from pool ratio' : 'Second side of the starting ratio'}
            balance={account ? formatAmount(balanceOf(tokenB), tokenB.decimals, 2) : undefined}
            onMax={account ? max('B', tokenB) : undefined}
          />
        </div>
        <div className="details-box">
          <DetailRow label="Rate" info="Price of one token in the other at the pool ratio." value={priceAB > 0 ? `1 ${sym(tokenA)} = ${formatPrice(priceAB)} ${sym(tokenB)}` : '—'} />
          <DetailRow
            label="Your pool share"
            info="Your LP tokens as a share of all LP tokens, before → after this deposit."
            value={liquidity > 0n ? `${formatPercent(shareBefore)} → ${formatPercent(shareAfter)}` : formatPercent(shareBefore)}
          />
          <DetailRow label="LP tokens received" info="PAULI-V2 pool tokens minted to your wallet." value={liquidity > 0n ? `≈ ${formatAmount(liquidity, 18, 4)} LP` : '—'} />
          <DetailRow label="Slippage tolerance" info="Both amounts may move by this much before the router reverts." value={isNewPair ? 'None (new pair)' : `${(settings.slippageBps / 100).toFixed(2)}%`} />
        </div>
        {blocked ? (
          <button className={`btn btn-lg btn-block ${blocked.kind ? `btn-${blocked.kind}` : ''}`} disabled={!blocked.onClick} onClick={blocked.onClick}>
            {blocked.label}
          </button>
        ) : (
          <div className="cta-row">
            {approveStep && (
              <button className="btn btn-lg btn-primary" onClick={() => approve(approveStep.token, approveStep.amount, approveStep.refresh)}>
                Approve {sym(approveStep.token)}
              </button>
            )}
            <button className="btn btn-lg btn-primary" disabled={!!approveStep} onClick={supply}>
              {isNewPair ? 'Create pair & supply' : 'Supply'}
            </button>
          </div>
        )}
        {approvable.length > 0 && (
          <span className="lock-note">
            <Icon name="lock" size={14} />
            One-time approval lets the V2 router move your {approvable.map(sym).join(' and ')}.{approvable.length === 1 ? ' QRL needs no approval.' : ''}
          </span>
        )}
      </div>
    </>
  );
}
