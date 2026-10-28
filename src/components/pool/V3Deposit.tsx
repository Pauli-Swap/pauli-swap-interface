import { useEffect, useMemo, useState } from 'react';
import { ADDRESSES, MAX_UINT256 } from '../../config';
import { useAllowance, useBalances } from '../../hooks/chain';
import { usePoolStats } from '../../hooks/market';
import { useNames } from '../../hooks/names';
import { useLiquidityBars } from '../../hooks/v3';
import { positionManager, sameAddress, token as tokenContract } from '../../lib/chain';
import { applySlippage, formatAmount, formatPercent, formatPrice, parseUnits, toFloat, toInputString } from '../../lib/format';
import { go } from '../../lib/router';
import { isNative, Token, wrappedAddress } from '../../lib/tokens';
import {
  dependentAmount,
  encodeSqrtRatioX96,
  FEE_TIERS,
  feeLabel,
  maxUsableTick,
  minUsableTick,
  nearestUsableTick,
  priceFromTick,
  sortTokens,
  sqrtRatioAtTick,
  tickFromPrice,
} from '../../lib/v3';
import { useApp } from '../../state/app';
import { useTx } from '../../state/tx';
import { useWallet } from '../../state/wallet';
import { RangeChart } from '../RangeChart';
import { AmountPanel, Badge, Banner, DetailRow, Icon, Modal, PairIcon, SegThumb } from '../ui';
import { useTvl } from './common';
import { findPool } from './PairStep';

const DEFAULT_PCT = 0.1;
const pct = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v * 100).toFixed(1)}%`;

/// Step 2 of a V3 position: price range and deposit amounts (95:857).
export function V3Deposit({
  tokenA: pairA,
  tokenB: pairB,
  fee,
  onEdit,
  onPick,
}: {
  tokenA: Token;
  tokenB: Token;
  fee: number;
  onEdit: () => void;
  onPick: (side: 'A' | 'B') => void;
}) {
  const { pools, poolsLoaded, settings, openModal, priceInQrl } = useApp();
  const { account, wrongNetwork, switchChain } = useWallet();
  const { send } = useTx();
  const { sym } = useNames();
  const tvl = useTvl();

  // Prices are "B per A"; the unit toggle swaps which token is the base.
  const [invert, setInvert] = useState(false);
  const tokenA = invert ? pairB : pairA;
  const tokenB = invert ? pairA : pairB;
  const [mode, setMode] = useState<'full' | 'custom'>('custom');
  const [range, setRange] = useState<{ min: number; max: number } | null>(null);
  const [minText, setMinText] = useState('');
  const [maxText, setMaxText] = useState('');
  const [initialPrice, setInitialPrice] = useState('');
  const [zoom, setZoom] = useState(1);
  const [typed, setTyped] = useState<{ side: 'A' | 'B'; value: string }>({ side: 'A', value: '' });
  const [reviewing, setReviewing] = useState(false);
  const [approved, setApproved] = useState<string[]>([]);

  const addrA = wrappedAddress(tokenA);
  const addrB = wrappedAddress(tokenB);
  const [token0, token1] = sortTokens(addrA, addrB);
  const aIs0 = sameAddress(token0, addrA);
  const dA = tokenA.decimals;
  const dB = tokenB.decimals;
  const d0 = aIs0 ? dA : dB;
  const d1 = aIs0 ? dB : dA;
  const spacing = FEE_TIERS.find((t) => t.fee === fee)?.tickSpacing ?? 60;
  const pool = findPool(pools, 'v3', pairA, pairB, fee);
  const initialized = !!pool && pool.sqrtPriceX96 > 0n;

  const toHuman = (tick: number) => {
    const p = priceFromTick(tick, d0, d1);
    return aIs0 ? p : 1 / p;
  };
  const toTick = (price: number) => (aIs0 ? tickFromPrice(price, d0, d1) : tickFromPrice(1 / price, d0, d1));
  const initial = Number(initialPrice);
  const currentPrice = initialized ? toHuman(pool!.tick) : initial > 0 ? initial : 0;
  const sqrtP = initialized ? pool!.sqrtPriceX96 : initial > 0 ? sqrtRatioAtTick(nearestUsableTick(toTick(initial), 1)) : 0n;

  // The custom range starts at ±10% and follows the price until it is edited.
  const [edited, setEdited] = useState(false);
  const userRange = (r: { min: number; max: number }) => {
    setEdited(true);
    setMode('custom');
    setRange(r);
  };
  useEffect(() => {
    if (currentPrice > 0 && !edited) setRange({ min: currentPrice * (1 - DEFAULT_PCT), max: currentPrice * (1 + DEFAULT_PCT) });
  }, [currentPrice, edited]);
  useEffect(() => setEdited(false), [invert]);

  const ticks = useMemo(() => {
    if (!(currentPrice > 0)) return null;
    if (mode === 'full' || !range) return { lower: minUsableTick(spacing), upper: maxUsableTick(spacing) };
    const ta = toTick(Math.max(range.min, 1e-30));
    const tb = Number.isFinite(range.max) ? toTick(range.max) : aIs0 ? maxUsableTick(spacing) : minUsableTick(spacing);
    let lower = nearestUsableTick(Math.min(ta, tb), spacing);
    let upper = nearestUsableTick(Math.max(ta, tb), spacing);
    if (lower === upper) upper = lower + spacing;
    lower = Math.max(lower, minUsableTick(spacing));
    upper = Math.min(upper, maxUsableTick(spacing));
    return { lower, upper };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, mode, spacing, aIs0, d0, d1, currentPrice]);
  const fullRange = !!ticks && ticks.lower === minUsableTick(spacing) && ticks.upper === maxUsableTick(spacing);
  const shownMin = ticks ? (fullRange ? 0 : aIs0 ? toHuman(ticks.lower) : toHuman(ticks.upper)) : 0;
  const shownMax = ticks ? (fullRange ? Infinity : aIs0 ? toHuman(ticks.upper) : toHuman(ticks.lower)) : Infinity;
  useEffect(() => {
    setMinText(shownMin ? formatPrice(shownMin).replace(/,/g, '') : '0');
    setMaxText(Number.isFinite(shownMax) ? formatPrice(shownMax).replace(/,/g, '') : '∞');
  }, [shownMin, shownMax]);

  // "B per A" rises with the tick when A is token0, so the min price sits on
  // the lower tick in that case and on the upper tick otherwise.
  const step = (which: 'min' | 'max', dir: 1 | -1) => {
    if (!ticks || fullRange) return;
    let { lower, upper } = ticks;
    if (aIs0) which === 'min' ? (lower += dir * spacing) : (upper += dir * spacing);
    else which === 'min' ? (upper -= dir * spacing) : (lower -= dir * spacing);
    if (lower >= upper || lower < minUsableTick(spacing) || upper > maxUsableTick(spacing)) return;
    userRange(aIs0 ? { min: toHuman(lower), max: toHuman(upper) } : { min: toHuman(upper), max: toHuman(lower) });
  };

  // The typed side drives the other through the range's liquidity.
  const below = !!ticks && sqrtP > 0n && sqrtP <= sqrtRatioAtTick(ticks.lower);
  const above = !!ticks && sqrtP > 0n && sqrtP >= sqrtRatioAtTick(ticks.upper);
  const aDisabled = (aIs0 && above) || (!aIs0 && below);
  const bDisabled = (aIs0 && below) || (!aIs0 && above);
  const typedToken = typed.side === 'A' ? tokenA : tokenB;
  const typedAmount = parseUnits(typed.value, typedToken.decimals);
  const other = useMemo(() => {
    if (!typedAmount || !ticks || sqrtP === 0n || below || above) return 0n;
    const typedIs0 = (typed.side === 'A') === aIs0;
    return dependentAmount(typedIs0 ? 0 : 1, typedAmount, sqrtP, ticks.lower, ticks.upper);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typedAmount?.toString(), typed.side, ticks, sqrtP, aIs0]);
  const amountA = aDisabled ? 0n : typed.side === 'A' ? typedAmount ?? 0n : other;
  const amountB = bDisabled ? 0n : typed.side === 'B' ? typedAmount ?? 0n : other;
  const amount0 = aIs0 ? amountA : amountB;
  const amount1 = aIs0 ? amountB : amountA;

  const balanceOf = useBalances([tokenA, tokenB], account);
  const npmAddress = ADDRESSES.NonfungiblePositionManager;
  const allowA = useAllowance(!isNative(tokenA) ? tokenA.address : null, account, npmAddress);
  const allowB = useAllowance(!isNative(tokenB) ? tokenB.address : null, account, npmAddress);
  const needA = !isNative(tokenA) && amountA > 0n && allowA.allowance !== undefined && allowA.allowance < amountA;
  const needB = !isNative(tokenB) && amountB > 0n && allowB.allowance !== undefined && allowB.allowance < amountB;
  const shortA = amountA > 0n && (balanceOf(tokenA) ?? 0n) < amountA;
  const shortB = amountB > 0n && (balanceOf(tokenB) ?? 0n) < amountB;

  const bars = useLiquidityBars(pool, d0, d1, !aIs0);
  const statPools = useMemo(() => (pool ? [pool] : []), [pool]);
  const stats = usePoolStats(statPools, '24h', tvl);
  const poolApr = pool ? stats.get(pool.id)?.feeApr ?? null : null;
  const valueA = priceInQrl(tokenA) !== undefined ? toFloat(amountA, dA) * priceInQrl(tokenA)! : 0;
  const valueB = priceInQrl(tokenB) !== undefined ? toFloat(amountB, dB) * priceInQrl(tokenB)! : 0;
  const shareA = valueA + valueB > 0 ? valueA / (valueA + valueB) : null;
  const width = fullRange || !(currentPrice > 0) ? null : (Math.abs(shownMin / currentPrice - 1) + Math.abs(shownMax / currentPrice - 1)) / 2;

  const approve = (t: Token, refresh: () => void) =>
    send({
      title: `Approve ${sym(t)}`,
      verb: 'approval',
      activity: 'Approved',
      successTitle: 'Approval confirmed',
      summary: { from: { token: t, amount: t === tokenA ? amountA : amountB, label: `${sym(t)} for NonfungiblePositionManager` } },
      build: () => ({ to: t.address, method: tokenContract(t.address).methods.approve(npmAddress, MAX_UINT256) }),
    }).then((ok) => {
      if (ok) {
        setApproved((list) => [...list, `Approve ${sym(t)}`]);
        refresh();
      }
    });

  const create = async () => {
    if (!ticks || !account) return;
    setReviewing(false);
    const deadline = BigInt(Math.floor(Date.now() / 1000) + settings.deadlineMin * 60);
    const slip = settings.slippageBps;
    const npm = positionManager();
    const params = [token0, token1, fee, ticks.lower, ticks.upper, amount0, amount1, applySlippage(amount0, slip, 'down'), applySlippage(amount1, slip, 'down'), account, deadline];
    const nativeValue = isNative(tokenA) ? amountA : isNative(tokenB) ? amountB : 0n;
    const calls: string[] = [];
    if (!initialized) calls.push((npm.methods.createAndInitializePoolIfNecessary(token0, token1, fee, sqrtP || encodeSqrtRatioX96(amount1 || 1n, amount0 || 1n)) as any).encodeABI());
    calls.push((npm.methods.mint(params) as any).encodeABI());
    if (nativeValue > 0n) calls.push((npm.methods.refundQRL() as any).encodeABI());
    const before = Number(await npm.methods.balanceOf(account).call());
    const ok = await send({
      title: initialized ? 'Create position' : 'Create pool and position',
      verb: 'deposit',
      prior: approved,
      activity: 'Added liquidity',
      successTitle: 'Position created',
      summary: { from: { token: tokenA, amount: amountA, label: sym(tokenA) }, to: { token: tokenB, amount: amountB, label: sym(tokenB) }, joiner: 'plus' },
      value: nativeValue || undefined,
      build: () => ({ to: npmAddress, method: calls.length === 1 ? npm.methods.mint(params) : npm.methods.multicall(calls) }),
    });
    if (ok) {
      const id = await npm.methods.tokenOfOwnerByIndex(account, before).call().catch(() => null);
      if (id !== null) go({ page: 'v3pos', id: String(id) });
    }
  };

  const cta = (() => {
    if (!account) return { label: 'Connect wallet', kind: 'secondary', onClick: () => openModal('connect') };
    if (wrongNetwork) return { label: 'Switch to QRL Devnet', kind: 'primary', onClick: () => switchChain().catch(() => undefined) };
    if (!(currentPrice > 0)) return { label: 'Set a starting price' };
    if (amountA === 0n && amountB === 0n) return { label: 'Enter an amount' };
    if (shortA) return { label: `Insufficient ${sym(tokenA)} balance` };
    if (shortB) return { label: `Insufficient ${sym(tokenB)} balance` };
    if (needA) return { label: `Approve ${sym(tokenA)}`, kind: 'primary', onClick: () => approve(tokenA, allowA.refresh) };
    if (needB) return { label: `Approve ${sym(tokenB)}`, kind: 'primary', onClick: () => approve(tokenB, allowB.refresh) };
    return { label: 'Review', kind: 'primary', onClick: () => setReviewing(true) };
  })();

  const unit = `${sym(tokenB)} per ${sym(tokenA)}`;
  const amountText = (side: 'A' | 'B') => {
    const disabled = side === 'A' ? aDisabled : bDisabled;
    if (disabled) return '0';
    if (typed.side === side) return typed.value;
    const v = side === 'A' ? amountA : amountB;
    return v ? toInputString(v, side === 'A' ? dA : dB) : '';
  };
  const share = (side: 'A' | 'B', disabled: boolean) =>
    disabled ? 'Not needed: the range is on the other side' : shareA === null ? 'Share of deposit appears with an amount' : `${((side === 'A' ? shareA : 1 - shareA) * 100).toFixed(1)}% of deposit`;
  const pickSide = (side: 'A' | 'B') => onPick(invert ? (side === 'A' ? 'B' : 'A') : side);

  return (
    <>
      <div className="card pair-summary">
        <PairIcon a={pairA} b={pairB} size={32} />
        <span className="t-heading">
          {sym(pairA)} / {sym(pairB)}
        </span>
        <Badge tone="quantum">V3</Badge>
        <Badge>{feeLabel(fee)}</Badge>
        {poolsLoaded && !initialized && <Badge tone="warning">New pool</Badge>}
        <span className="grow" />
        <button className="btn btn-sm btn-tertiary" onClick={onEdit}>
          Edit
        </button>
      </div>

      <div className="card np-card">
        <div className="row">
          <span className="t-heading grow">Set price range</span>
          <div className="seg boxed" role="tablist">
            <SegThumb />
            <button className={!invert ? 'on' : ''} onClick={() => setInvert(false)}>
              {sym(pairB)}
            </button>
            <button className={invert ? 'on' : ''} onClick={() => setInvert(true)}>
              {sym(pairA)}
            </button>
          </div>
        </div>
        <div className="mode-seg" role="tablist">
          <SegThumb />
          <button className={mode === 'full' ? 'on' : ''} onClick={() => setMode('full')}>
            Full range
          </button>
          <button
            className={mode === 'custom' ? 'on' : ''}
            onClick={() => {
              setMode('custom');
              if (currentPrice > 0 && (!range || !Number.isFinite(range.max))) setRange({ min: currentPrice * (1 - DEFAULT_PCT), max: currentPrice * (1 + DEFAULT_PCT) });
            }}
          >
            Custom range
          </button>
        </div>

        {poolsLoaded && !initialized && (
          <>
            <Banner tone="quantum" title="This pool does not exist yet">
              Your position creates the {sym(pairA)} / {sym(pairB)} {feeLabel(fee)} pool. Set the starting price carefully: anyone can trade against it right away.
            </Banner>
            <label className="init-price">
              <span className="t-label c-3 nowrap">Starting price · 1 {sym(tokenA)} =</span>
              <input value={initialPrice} onChange={(e) => /^\d*\.?\d*$/.test(e.target.value.replace(',', '.')) && setInitialPrice(e.target.value.replace(',', '.'))} placeholder="0.0" inputMode="decimal" aria-label="Starting price" />
              <span className="t-body c-3 nowrap">{sym(tokenB)}</span>
            </label>
          </>
        )}

        <div className="row">
          <span className="t-body c-3">Current price</span>
          <span className="t-num-strong">{currentPrice > 0 ? `${formatPrice(currentPrice)} ${unit}` : '—'}</span>
          <span className="grow" />
          <button className="mini-btn" aria-label="Zoom in" disabled={zoom >= 8} onClick={() => setZoom((z) => Math.min(8, z * 1.5))}>
            <Icon name="zoom-in" size={16} />
          </button>
          <button className="mini-btn" aria-label="Zoom out" disabled={zoom <= 0.25} onClick={() => setZoom((z) => Math.max(0.25, z / 1.5))}>
            <Icon name="zoom-out" size={16} />
          </button>
        </div>

        {currentPrice > 0 ? (
          <RangeChart
            bars={bars}
            current={currentPrice}
            min={shownMin}
            max={shownMax}
            zoom={zoom}
            onChange={(min, max) => userRange({ min, max })}
          />
        ) : (
          <div className="chart-empty t-body" style={{ height: 210 }}>
            Set a starting price to choose a range
          </div>
        )}

        <div className="minmax">
          {(['min', 'max'] as const).map((which) => {
            const v = which === 'min' ? shownMin : shownMax;
            const text = which === 'min' ? minText : maxText;
            const finite = which === 'min' ? v > 0 : Number.isFinite(v);
            return (
              <div className="np-price" key={which}>
                <div className="t">
                  <span className="t-label c-3">{which === 'min' ? 'Min price' : 'Max price'}</span>
                  <input
                    value={text}
                    inputMode="decimal"
                    aria-label={which === 'min' ? 'Min price' : 'Max price'}
                    onChange={(e) => (which === 'min' ? setMinText(e.target.value) : setMaxText(e.target.value))}
                    onBlur={() => {
                      const n = Number(text.replace(/[^\d.]/g, ''));
                      if (!(n > 0)) return;
                      const base = range ?? { min: shownMin, max: shownMax };
                      userRange(which === 'min' ? { min: n, max: Number.isFinite(base.max) ? base.max : currentPrice * 2 } : { min: base.min > 0 ? base.min : currentPrice / 2, max: n });
                    }}
                  />
                  <span className="t-num c-3">
                    {unit}
                    {finite && currentPrice > 0 ? ` · ${pct(v / currentPrice - 1)}` : ''}
                  </span>
                </div>
                <div className="steps-v">
                  <button className="mini-btn" aria-label={`Raise ${which} price`} onClick={() => step(which, 1)}>
                    <Icon name="plus" size={16} />
                  </button>
                  <button className="mini-btn" aria-label={`Lower ${which} price`} onClick={() => step(which, -1)}>
                    <Icon name="minus" size={16} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="card np-card">
        <div className="head">
          <span className="t-heading">Deposit tokens</span>
          <span className="t-body c-3">Amounts follow the range: the closer the price is to an edge, the more of one token you deposit.</span>
        </div>
        <div className="col" style={{ gap: 12 }}>
          {(['A', 'B'] as const).map((side) => {
            const t = side === 'A' ? tokenA : tokenB;
            const disabled = side === 'A' ? aDisabled : bDisabled;
            const bal = balanceOf(t);
            return (
              <AmountPanel
                key={side}
                label={sym(t)}
                token={t}
                symbol={sym(t)}
                amount={amountText(side)}
                onAmount={(v) => setTyped({ side, value: v })}
                onSelect={() => pickSide(side)}
                readOnly={disabled}
                focus={typed.side === side && !disabled}
                error={side === 'A' ? shortA : shortB}
                sub={share(side, disabled)}
                balance={account ? formatAmount(bal, t.decimals, 2) : undefined}
                onMax={account && !disabled && bal !== undefined ? () => setTyped({ side, value: toInputString(isNative(t) ? (bal > 10n ** 17n ? bal - 10n ** 17n : 0n) : bal, t.decimals, t.decimals) }) : undefined}
              />
            );
          })}
        </div>
        <DetailRow label="Estimated fee APR" info="The pool's fee APR over the last 24 hours. A position earns it only while the price is inside its range." value={poolApr !== null ? formatPercent(poolApr, 1) : '—'} />
        <DetailRow label="Range width" info="How far the range reaches from the current price, on average." value={fullRange ? 'Full range' : width !== null ? `±${(width * 100).toFixed(1)}% around current price` : '—'} />
        <button className={`btn btn-lg btn-block ${cta.kind ? `btn-${cta.kind}` : ''}`} disabled={!cta.onClick} onClick={cta.onClick}>
          {cta.label}
        </button>
      </div>

      {reviewing && ticks && (
        <Modal title="Review position" onClose={() => setReviewing(false)} center>
          <div className="row" style={{ gap: 10 }}>
            <PairIcon a={pairA} b={pairB} size={32} />
            <span className="t-heading">
              {sym(pairA)} / {sym(pairB)}
            </span>
            <Badge tone="quantum">V3</Badge>
            <Badge>{feeLabel(fee)}</Badge>
            <span className="grow" />
            <Badge tone={below || above ? 'warning' : 'success'}>{below || above ? 'Out of range' : 'In range'}</Badge>
          </div>
          <div className="details-box" style={{ gap: 10, padding: 16 }}>
            <DetailRow label={`${sym(tokenA)} deposit`} value={formatAmount(amountA, dA, 6)} />
            <DetailRow label={`${sym(tokenB)} deposit`} value={formatAmount(amountB, dB, 6)} />
          </div>
          <div className="col" style={{ gap: 10 }}>
            <DetailRow label="Min price" value={`${fullRange ? '0' : formatPrice(shownMin)} ${unit}`} />
            <DetailRow label="Max price" value={`${fullRange ? '∞' : formatPrice(shownMax)} ${unit}`} />
            <DetailRow label="Current price" value={`${formatPrice(currentPrice)} ${unit}`} />
            <DetailRow label="Max slippage" value={`${settings.slippageBps / 100}%`} />
          </div>
          <span className="t-caption c-3">
            {initialized ? 'The position is an NFT held by your wallet. It earns fees only while the price stays inside the range.' : 'This also creates the pool at the starting price you set.'}
          </span>
          <button className="btn btn-lg btn-primary" onClick={create}>
            {initialized ? 'Create position' : 'Create pool and position'}
          </button>
        </Modal>
      )}
    </>
  );
}
