import { useEffect, useState } from 'react';
import { TokenSelectModal } from '../components/TokenSelectModal';
import { Banner, DetailRow, Icon, Modal, TokenField, TokenPairIcon } from '../components/ui';
import { ADDRESSES, MAX_UINT256, MINIMUM_LIQUIDITY } from '../config';
import { useAllowance, useBalances } from '../hooks/chain';
import { usePair } from '../hooks/pools';
import { router, token as tokenContract } from '../lib/chain';
import { applySlippage, formatAmount, formatPercent, formatPrice, parseUnits, sqrt, toFloat, toInputString } from '../lib/format';
import { getPairAddress, orderedReserves } from '../lib/pairs';
import { displaySymbol, isNative, isWqrl, NATIVE, sameToken, Token, wrappedAddress } from '../lib/tokens';
import { useApp } from '../state/app';
import { useTx } from '../state/tx';
import { useWallet } from '../state/wallet';

type Cta = { label: string; kind: 'primary' | 'secondary' | 'disabled'; onClick?: () => void };

export function AddLiquidity({ pairAddress, onPair }: { pairAddress?: string; onPair?: (address: string | null | undefined) => void }) {
  const { tokens, settings, openModal, block, refreshTokens } = useApp();
  const { account, wrongNetwork, switchChain } = useWallet();
  const { send } = useTx();

  const [tokenA, setTokenA] = useState<Token | null>(NATIVE);
  const [tokenB, setTokenB] = useState<Token | null>(null);
  const [field, setField] = useState<'A' | 'B'>('A');
  const [typed, setTyped] = useState('');
  const [selecting, setSelecting] = useState<'A' | 'B' | null>(null);
  const [resolvedPair, setResolvedPair] = useState<string | null | undefined>(pairAddress);
  const [reviewing, setReviewing] = useState(false);
  const sym = (t: Token | null | undefined) => displaySymbol(t, tokens);

  // Opening from a position preselects its tokens, showing WQRL as native QRL.
  const { pair: preset } = usePair(pairAddress, null);
  useEffect(() => {
    if (!preset) return;
    const show = (t: Token) => (isWqrl(t) ? NATIVE : t);
    setTokenA(show(preset.token0Info));
    setTokenB(show(preset.token1Info));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset?.address]);

  useEffect(() => {
    if (!tokenA || !tokenB) return setResolvedPair(undefined);
    let alive = true;
    getPairAddress(wrappedAddress(tokenA), wrappedAddress(tokenB)).then((a) => {
      if (!alive) return;
      setResolvedPair(a);
      onPair?.(a);
    });
    return () => {
      alive = false;
    };
  }, [tokenA, tokenB, block]);

  const { pair } = usePair(resolvedPair, account);
  const [reserveA, reserveB] = pair && tokenA ? orderedReserves(pair, wrappedAddress(tokenA)) : [0n, 0n];
  const isNewPair = resolvedPair === null || (pair !== null && pair.totalSupply === 0n);
  const hasRatio = !isNewPair && reserveA > 0n && reserveB > 0n;

  const independent = field === 'A' ? tokenA : tokenB;
  const parsed = independent ? parseUnits(typed, independent.decimals) : null;
  let amountA: bigint | null = field === 'A' ? parsed : null;
  let amountB: bigint | null = field === 'B' ? parsed : null;
  const [typedOther, setTypedOther] = useState('');
  if (hasRatio && parsed) {
    if (field === 'A') amountB = (parsed * reserveB) / reserveA;
    else amountA = (parsed * reserveA) / reserveB;
  } else if (!hasRatio) {
    const other = field === 'A' ? tokenB : tokenA;
    const otherParsed = other ? parseUnits(typedOther, other.decimals) : null;
    if (field === 'A') amountB = otherParsed;
    else amountA = otherParsed;
  }

  const balanceOf = useBalances([tokenA, tokenB], account);
  const router02 = ADDRESSES.PauliV2Router02;
  const allowA = useAllowance(tokenA && !isNative(tokenA) ? tokenA.address : null, account, router02);
  const allowB = useAllowance(tokenB && !isNative(tokenB) ? tokenB.address : null, account, router02);
  const needA = !!tokenA && !isNative(tokenA) && amountA !== null && allowA.allowance !== undefined && allowA.allowance < amountA;
  const needB = !!tokenB && !isNative(tokenB) && amountB !== null && allowB.allowance !== undefined && allowB.allowance < amountB;
  const checkingApproval =
    !!account &&
    ((!!tokenA && !isNative(tokenA) && amountA !== null && allowA.allowance === undefined) ||
      (!!tokenB && !isNative(tokenB) && amountB !== null && allowB.allowance === undefined));

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
  const share = isNewPair ? 1 : pair && liquidity ? toFloat(liquidity, 18) / (toFloat(pair.totalSupply, 18) + toFloat(liquidity, 18)) : 0;
  const priceAB =
    tokenA && tokenB
      ? hasRatio
        ? toFloat(reserveB, tokenB.decimals) / toFloat(reserveA, tokenA.decimals)
        : amountA && amountB
          ? toFloat(amountB, tokenB.decimals) / toFloat(amountA, tokenA.decimals)
          : 0
      : 0;

  const selectToken = (t: Token) => {
    if (selecting === 'A') {
      if (sameToken(t, tokenB)) setTokenB(tokenA);
      setTokenA(t);
    } else {
      if (sameToken(t, tokenA)) setTokenA(tokenB);
      setTokenB(t);
    }
    setSelecting(null);
  };

  const approve = (t: Token, refresh: () => void) =>
    send({
      title: `Approve ${sym(t)}`,
      activity: `Approved ${sym(t)} for PauliV2Router`,
      successTitle: 'Approval confirmed',
      build: () => ({ to: t.address, method: tokenContract(t.address).methods.approve(router02, MAX_UINT256) }),
    }).then((ok) => ok && refresh());

  const supply = () => {
    if (!tokenA || !tokenB || !amountA || !amountB || !account) return;
    const deadline = BigInt(Math.floor(Date.now() / 1000) + settings.deadlineMin * 60);
    const bps = isNewPair ? 0 : settings.slippageBps;
    const minA = applySlippage(amountA, bps, 'down');
    const minB = applySlippage(amountB, bps, 'down');
    const nativeA = isNative(tokenA);
    const nativeB = isNative(tokenB);
    setReviewing(false);
    send({
      title: isNewPair ? 'Create pair & supply' : 'Add liquidity',
      activity: `Added ${sym(tokenA)} / ${sym(tokenB)} liquidity`,
      successTitle: 'Liquidity added',
      successText: `You received about ${formatAmount(liquidity, 18, 6)} PAULI-V2 pool tokens.`,
      summary: { from: { token: tokenA, amount: amountA, label: sym(tokenA) }, to: { token: tokenB, amount: amountB, label: sym(tokenB) } },
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
    }).then((ok) => {
      if (ok) {
        setTyped('');
        setTypedOther('');
        // A new pair may introduce tokens the selector has not discovered yet.
        if (isNewPair) refreshTokens();
      }
    });
  };

  const insufficientA = amountA !== null && (balanceOf(tokenA) ?? 0n) < amountA;
  const insufficientB = amountB !== null && (balanceOf(tokenB) ?? 0n) < amountB;

  let cta: Cta;
  if (!account) cta = { label: 'Connect wallet', kind: 'secondary', onClick: () => openModal('connect') };
  else if (wrongNetwork) cta = { label: 'Switch to QRL Devnet', kind: 'primary', onClick: () => switchChain().catch(() => undefined) };
  else if (!tokenA || !tokenB) cta = { label: 'Select a token', kind: 'disabled' };
  else if (!amountA || !amountB) cta = { label: 'Enter an amount', kind: 'disabled' };
  else if (insufficientA) cta = { label: `Insufficient ${sym(tokenA)} balance`, kind: 'disabled' };
  else if (insufficientB) cta = { label: `Insufficient ${sym(tokenB)} balance`, kind: 'disabled' };
  else if (checkingApproval) cta = { label: 'Checking approval…', kind: 'disabled' };
  else if (needA || needB) cta ={ label: isNewPair ? 'Create pair & supply' : 'Supply', kind: 'disabled' };
  else cta = { label: isNewPair ? 'Create pair & supply' : 'Supply', kind: 'primary', onClick: () => setReviewing(true) };

  const amountString = (side: 'A' | 'B', t: Token | null, value: bigint | null) =>
    field === side ? typed : hasRatio ? (value !== null && t ? toInputString(value, t.decimals) : '') : typedOther;
  const onType = (side: 'A' | 'B') => (v: string) => {
    if (field !== side) {
      if (!hasRatio) setTypedOther(typed);
      setField(side);
    }
    setTyped(v);
  };

  return (
    <>
      <div className="col" style={{ gap: 12 }}>
        {isNewPair && tokenA && tokenB && (
          <Banner tone="accent" title="You are the first liquidity provider">
            The ratio you deposit sets the starting price. 1,000 wei of LP tokens (MINIMUM_LIQUIDITY) is locked forever when the pair is created.
          </Banner>
        )}
        <div className="stack">
          <TokenField
            label="Deposit"
            token={tokenA}
            symbol={sym(tokenA)}
            amount={amountString('A', tokenA, amountA)}
            onAmount={onType('A')}
            onSelect={() => setSelecting('A')}
            balance={account && tokenA ? formatAmount(balanceOf(tokenA), tokenA.decimals) : undefined}
            onMax={account ? () => tokenA && balanceOf(tokenA) !== undefined && onType('A')(toInputString(balanceOf(tokenA)!, tokenA.decimals, tokenA.decimals)) : undefined}
            focus={field === 'A'}
          />
          <span className="float-btn" style={{ top: 'calc(50% - 21px)' }}>
            <Icon name="plus" size={18} />
          </span>
          <TokenField
            label="Deposit"
            token={tokenB}
            symbol={sym(tokenB)}
            amount={amountString('B', tokenB, amountB)}
            onAmount={onType('B')}
            onSelect={() => setSelecting('B')}
            balance={account && tokenB ? formatAmount(balanceOf(tokenB), tokenB.decimals) : undefined}
            onMax={account ? () => tokenB && balanceOf(tokenB) !== undefined && onType('B')(toInputString(balanceOf(tokenB)!, tokenB.decimals, tokenB.decimals)) : undefined}
            subtext={hasRatio ? 'Set by the pool ratio' : isNewPair ? 'You set the starting ratio' : undefined}
            focus={field === 'B'}
          />
        </div>
        {tokenA && tokenB && priceAB > 0 && (
          <div className="details" style={{ padding: '2px 4px' }}>
            <DetailRow label={isNewPair ? 'Initial price' : 'Pool ratio'} value={`1 ${sym(tokenA)} = ${formatPrice(priceAB)} ${sym(tokenB)}`} />
            <DetailRow label="LP tokens received" value={`${formatAmount(liquidity, 18, 6)} PAULI-V2`} />
            <DetailRow label="Your pool share" value={formatPercent(share)} />
            <DetailRow label="Slippage tolerance" value={isNewPair ? 'None (new pair)' : `${settings.slippageBps / 100}%`} />
          </div>
        )}
        {(needA || needB) && account && !wrongNetwork ? (
          <div className="col">
            {needA && tokenA && (
              <button className="btn btn-lg btn-primary" onClick={() => approve(tokenA, allowA.refresh)}>
                1 · Approve {sym(tokenA)}
              </button>
            )}
            {needB && tokenB && (
              <button className={`btn btn-lg ${needA ? 'btn-secondary' : 'btn-primary'}`} disabled={needA} onClick={() => approve(tokenB, allowB.refresh)}>
                {needA ? 2 : 1} · Approve {sym(tokenB)}
              </button>
            )}
            <button className="btn btn-lg" disabled>
              {(needA ? 1 : 0) + (needB ? 1 : 0) + 1} · {isNewPair ? 'Create pair & supply' : 'Add liquidity'}
            </button>
          </div>
        ) : (
          <button className={`btn btn-lg btn-${cta.kind === 'secondary' ? 'primary' : cta.kind}`} disabled={cta.kind === 'disabled'} onClick={cta.onClick}>
            {cta.label === 'Supply' ? 'Add liquidity' : cta.label}
          </button>
        )}
        {isNewPair && tokenA && tokenB && (
          <span className="t-caption c-3" style={{ padding: '0 4px' }}>
            Calls PauliV2Router02.{isNative(tokenA) || isNative(tokenB) ? 'addLiquidityQRL' : 'addLiquidity'}, which creates the pair through PauliV2Factory in the same transaction.
          </span>
        )}
      </div>

      {selecting && (
        <TokenSelectModal
          selected={selecting === 'A' ? tokenA : tokenB}
          other={selecting === 'A' ? tokenB : tokenA}
          onSelect={selectToken}
          onClose={() => setSelecting(null)}
        />
      )}

      {reviewing && tokenA && tokenB && amountA && amountB && (
        <Modal title="You will receive" onClose={() => setReviewing(false)}>
          <div className="row" style={{ gap: 12 }}>
            <span className="t-amount grow">{formatAmount(liquidity, 18, 6)}</span>
            <TokenPairIcon a={tokenA} b={tokenB} size={36} />
          </div>
          <span className="t-body c-2">
            {sym(tokenA)}/{sym(tokenB)} pool tokens · PAULI-V2
          </span>
          <div className="divider" />
          <div className="col" style={{ gap: 10 }}>
            <DetailRow label={`${sym(tokenA)} deposited`} value={formatAmount(amountA, tokenA.decimals, 6)} />
            <DetailRow label={`${sym(tokenB)} deposited`} value={formatAmount(amountB, tokenB.decimals, 6)} />
            <DetailRow label="Rate" value={`1 ${sym(tokenA)} = ${formatPrice(priceAB)} ${sym(tokenB)}`} />
            <DetailRow label="Share of pool" value={formatPercent(share)} />
            {!isNewPair && <DetailRow label="Max slippage" value={`${settings.slippageBps / 100}%`} info="Applied to both deposit amounts." />}
          </div>
          <span className="t-caption c-3">
            {isNewPair
              ? 'This creates the pair. Its first deposit sets the price, so arbitrage will correct a ratio that is off the market.'
              : `Amounts are estimated. If the pool ratio moves more than ${settings.slippageBps / 100}%, the router reverts with INSUFFICIENT_A_AMOUNT or INSUFFICIENT_B_AMOUNT.`}
          </span>
          <button className="btn btn-lg btn-primary" onClick={supply}>
            {isNewPair ? 'Create pair & supply' : 'Confirm supply'}
          </button>
        </Modal>
      )}
    </>
  );
}
