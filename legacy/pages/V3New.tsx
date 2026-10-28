import { useEffect, useMemo, useRef, useState } from 'react';
import { RangeChart } from '../components/Chart';
import { NoteBar, SubBar } from '../components/Header';
import { TokenSelectModal } from '../components/TokenSelectModal';
import { Banner, DetailRow, Icon, IconButton, Seg, TokenField, TokenIcon, TokenPairIcon } from '../components/ui';
import { ADDRESSES, MAX_UINT256 } from '../config';
import { useAllowance, useBalances } from '../hooks/chain';
import { usePoolHistory, usePoolStats } from '../hooks/market';
import { useNames } from '../hooks/names';
import { useLiquidityBars } from '../hooks/v3';
import { isQAddress, positionManager, sameAddress, shortAddress, token as tokenContract } from '../lib/chain';
import { applySlippage, formatAmount, formatPercent, formatPrice, parseUnits, toFloat, toInputString } from '../lib/format';
import { tvlInQrl } from '../lib/registry';
import { go, query } from '../lib/router';
import { fetchTokenMetadata, isNative, NATIVE, sameToken, Token, wrappedAddress } from '../lib/tokens';
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
} from '../lib/v3';
import { useApp } from '../state/app';
import { useTx } from '../state/tx';
import { useWallet } from '../state/wallet';

type Preset = 'Full range' | '±10%' | '±5%' | '±1%';
const PRESET_PCT: Record<Preset, number | null> = { 'Full range': null, '±10%': 0.1, '±5%': 0.05, '±1%': 0.01 };

export function V3New() {
  const { tokens, tokensLoading, pools, settings, openModal, priceInQrl, decimalsOf, block } = useApp();
  const { account, wrongNetwork, switchChain } = useWallet();
  const { send } = useTx();
  const { sym } = useNames();

  const [tokenA, setTokenA] = useState<Token | null>(NATIVE);
  const [tokenB, setTokenB] = useState<Token | null>(null);
  const [fee, setFee] = useState<number>(3000);
  const [selecting, setSelecting] = useState<'A' | 'B' | null>(null);
  const [preset, setPreset] = useState<Preset | null>('±10%');
  const [range, setRange] = useState<{ min: number; max: number } | null>(null);
  const [minText, setMinText] = useState('');
  const [maxText, setMaxText] = useState('');
  const [initialPrice, setInitialPrice] = useState('');
  const [typed, setTyped] = useState<{ side: 'A' | 'B'; value: string }>({ side: 'A', value: '' });

  const linked = useRef(false);
  useEffect(() => {
    if (linked.current || tokensLoading) return;
    linked.current = true;
    const q = query();
    const resolve = async (v: string | null) => {
      if (!v) return null;
      if (/^(qrl|native)$/i.test(v)) return NATIVE;
      if (!isQAddress(v)) return null;
      if (sameAddress(v, ADDRESSES.WQRL)) return NATIVE;
      return tokens.find((t) => !t.native && sameAddress(t.address, v)) ?? (await fetchTokenMetadata(v).catch(() => null));
    };
    Promise.all([resolve(q.get('tokenA')), resolve(q.get('tokenB'))]).then(([a, b]) => {
      if (a) setTokenA(a);
      if (b && !sameToken(a ?? NATIVE, b)) setTokenB(b);
      const f = Number(q.get('fee'));
      if (FEE_TIERS.some((t) => t.fee === f)) setFee(f);
    });
  }, [tokens, tokensLoading]);
  // Default partner for QRL: the token of the deepest V3 pool against WQRL.
  useEffect(() => {
    if (tokenB || tokensLoading || query().get('tokenB')) return;
    const best = pools
      .filter((p) => p.version === 'v3' && (sameAddress(p.token0, ADDRESSES.WQRL) || sameAddress(p.token1, ADDRESSES.WQRL)))
      .sort((x, y) => (y.liquidity > x.liquidity ? 1 : -1))[0];
    const address = best ? (sameAddress(best.token0, ADDRESSES.WQRL) ? best.token1 : best.token0) : null;
    const other = (address && tokens.find((t) => !t.native && sameAddress(t.address, address))) || tokens.find((t) => !t.native && !sameAddress(t.address, ADDRESSES.WQRL));
    if (other) {
      setTokenB(other);
      if (best) setFee(best.fee);
    }
  }, [tokens, tokensLoading, tokenB, pools]);

  const addrA = tokenA ? wrappedAddress(tokenA) : null;
  const addrB = tokenB ? wrappedAddress(tokenB) : null;
  const valid = !!addrA && !!addrB && !sameAddress(addrA, addrB);
  const [token0, token1] = valid ? sortTokens(addrA!, addrB!) : [null, null];
  const aIs0 = valid && sameAddress(token0!, addrA!);
  const dA = tokenA?.decimals ?? 18;
  const dB = tokenB?.decimals ?? 18;
  const d0 = aIs0 ? dA : dB;
  const d1 = aIs0 ? dB : dA;
  const spacing = FEE_TIERS.find((t) => t.fee === fee)!.tickSpacing;

  const poolFor = (f: number) => (valid ? pools.find((p) => p.version === 'v3' && p.fee === f && sameAddress(p.token0, token0!) && sameAddress(p.token1, token1!)) : undefined);
  const pool = poolFor(fee);
  const initialized = !!pool && pool.sqrtPriceX96 > 0n;

  // Prices on screen are always "B per A".
  const toHuman = (tick: number) => {
    const p = priceFromTick(tick, d0, d1);
    return aIs0 ? p : 1 / p;
  };
  const toTick = (price: number) => (aIs0 ? tickFromPrice(price, d0, d1) : tickFromPrice(1 / price, d0, d1));
  const initial = Number(initialPrice);
  const currentPrice = initialized ? toHuman(pool!.tick) : initial > 0 ? initial : 0;
  const sqrtP = initialized
    ? pool!.sqrtPriceX96
    : initial > 0
      ? sqrtRatioAtTick(nearestUsableTick(toTick(initial), 1))
      : 0n;

  // Range presets follow the current price until the user edits the range.
  useEffect(() => {
    if (!preset || !(currentPrice > 0)) return;
    const pct = PRESET_PCT[preset];
    setRange(pct === null ? { min: 0, max: Infinity } : { min: currentPrice * (1 - pct), max: currentPrice * (1 + pct) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset, currentPrice, fee, addrA, addrB]);

  const ticks = useMemo(() => {
    if (!range || !(currentPrice > 0)) return null;
    if (range.min <= 0 && !Number.isFinite(range.max)) return { lower: minUsableTick(spacing), upper: maxUsableTick(spacing) };
    const ta = toTick(Math.max(range.min, 1e-30));
    const tb = Number.isFinite(range.max) ? toTick(range.max) : aIs0 ? maxUsableTick(spacing) : minUsableTick(spacing);
    let lower = nearestUsableTick(Math.min(ta, tb), spacing);
    let upper = nearestUsableTick(Math.max(ta, tb), spacing);
    if (lower === upper) upper = lower + spacing;
    lower = Math.max(lower, minUsableTick(spacing));
    upper = Math.min(upper, maxUsableTick(spacing));
    return { lower, upper };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, spacing, aIs0, d0, d1, currentPrice]);
  const fullRange = !!ticks && ticks.lower === minUsableTick(spacing) && ticks.upper === maxUsableTick(spacing);
  const shownMin = ticks ? (fullRange ? 0 : aIs0 ? toHuman(ticks.lower) : toHuman(ticks.upper)) : 0;
  const shownMax = ticks ? (fullRange ? Infinity : aIs0 ? toHuman(ticks.upper) : toHuman(ticks.lower)) : Infinity;
  useEffect(() => {
    setMinText(shownMin ? formatPrice(shownMin).replace(/,/g, '') : '0');
    setMaxText(Number.isFinite(shownMax) ? formatPrice(shownMax).replace(/,/g, '') : '∞');
  }, [shownMin, shownMax]);

  // "B per A" rises with the tick when A is token0 and falls when it is token1,
  // so the min price sits on the lower tick in the first case and the upper in
  // the second.
  const step = (which: 'min' | 'max', dir: 1 | -1) => {
    if (!ticks) return;
    let { lower, upper } = ticks;
    if (aIs0) which === 'min' ? (lower += dir * spacing) : (upper += dir * spacing);
    else which === 'min' ? (upper -= dir * spacing) : (lower -= dir * spacing);
    if (lower >= upper || lower < minUsableTick(spacing) || upper > maxUsableTick(spacing)) return;
    setPreset(null);
    setRange(aIs0 ? { min: toHuman(lower), max: toHuman(upper) } : { min: toHuman(upper), max: toHuman(lower) });
  };

  // Amounts: the typed side drives the other through the range liquidity.
  const below = !!ticks && sqrtP > 0n && sqrtP <= sqrtRatioAtTick(ticks.lower);
  const above = !!ticks && sqrtP > 0n && sqrtP >= sqrtRatioAtTick(ticks.upper);
  const only0 = below;
  const only1 = above;
  const aDisabled = (aIs0 && only1) || (!aIs0 && only0);
  const bDisabled = (aIs0 && only0) || (!aIs0 && only1);
  const typedToken = typed.side === 'A' ? tokenA : tokenB;
  const typedAmount = typedToken ? parseUnits(typed.value, typedToken.decimals) : null;
  const other = useMemo(() => {
    if (!typedAmount || !ticks || sqrtP === 0n) return 0n;
    const typedIs0 = (typed.side === 'A') === aIs0;
    if (below || above) return 0n;
    return dependentAmount(typedIs0 ? 0 : 1, typedAmount, sqrtP, ticks.lower, ticks.upper);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typedAmount?.toString(), typed.side, ticks, sqrtP, aIs0]);
  const amountA = typed.side === 'A' ? typedAmount ?? 0n : other;
  const amountB = typed.side === 'B' ? typedAmount ?? 0n : other;
  const amount0 = aIs0 ? amountA : amountB;
  const amount1 = aIs0 ? amountB : amountA;

  const balanceOf = useBalances([tokenA, tokenB], account);
  const allowA = useAllowance(tokenA && !isNative(tokenA) ? tokenA.address : null, account, ADDRESSES.NonfungiblePositionManager);
  const allowB = useAllowance(tokenB && !isNative(tokenB) ? tokenB.address : null, account, ADDRESSES.NonfungiblePositionManager);
  const needA = !!tokenA && !isNative(tokenA) && amountA > 0n && allowA.allowance !== undefined && allowA.allowance < amountA;
  const needB = !!tokenB && !isNative(tokenB) && amountB > 0n && allowB.allowance !== undefined && allowB.allowance < amountB;
  const shortA = amountA > 0n && (balanceOf(tokenA) ?? 0n) < amountA;
  const shortB = amountB > 0n && (balanceOf(tokenB) ?? 0n) < amountB;

  const history = usePoolHistory(pool, addrA, '7d');
  const bars = useLiquidityBars(pool, d0, d1, !aIs0);
  const statPools = useMemo(() => FEE_TIERS.map((t) => poolFor(t.fee)).filter((p): p is NonNullable<typeof p> => !!p), [pools, token0, token1]); // eslint-disable-line react-hooks/exhaustive-deps
  const prices = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of statPools) for (const t of [p.token0, p.token1]) { const v = priceInQrl(t); if (v !== undefined) m.set(t.toLowerCase(), v); }
    return m;
  }, [statPools, priceInQrl]);
  const stats = usePoolStats(statPools, '24h', (p) => tvlInQrl(p, prices, decimalsOf));
  const poolApr = pool ? stats.get(pool.id)?.feeApr ?? null : null;
  const efficiency = ticks && !fullRange && shownMin > 0 && Number.isFinite(shownMax) ? 1 / (1 - Math.pow(shownMin / shownMax, 0.25)) : 1;
  const valueA = tokenA && priceInQrl(tokenA) !== undefined ? toFloat(amountA, dA) * priceInQrl(tokenA)! : 0;
  const valueB = tokenB && priceInQrl(tokenB) !== undefined ? toFloat(amountB, dB) * priceInQrl(tokenB)! : 0;
  const shareA = valueA + valueB > 0 ? valueA / (valueA + valueB) : 0.5;

  const approve = (t: Token, refresh: () => void) =>
    send({
      title: `Approve ${sym(t)}`,
      activity: `Approved ${sym(t)} for the position manager`,
      successTitle: 'Approval confirmed',
      build: () => ({ to: t.address, method: tokenContract(t.address).methods.approve(ADDRESSES.NonfungiblePositionManager, MAX_UINT256) }),
    }).then((ok) => ok && refresh());

  const create = async () => {
    if (!valid || !ticks || !account || !tokenA || !tokenB) return;
    const deadline = BigInt(Math.floor(Date.now() / 1000) + settings.deadlineMin * 60);
    const slip = settings.slippageBps;
    const npm = positionManager();
    const params = [token0!, token1!, fee, ticks.lower, ticks.upper, amount0, amount1, applySlippage(amount0, slip, 'down'), applySlippage(amount1, slip, 'down'), account, deadline];
    const nativeValue = isNative(tokenA) ? amountA : isNative(tokenB) ? amountB : 0n;
    const calls: string[] = [];
    if (!initialized) calls.push((npm.methods.createAndInitializePoolIfNecessary(token0!, token1!, fee, sqrtP || encodeSqrtRatioX96(amount1 || 1n, amount0 || 1n)) as any).encodeABI());
    calls.push((npm.methods.mint(params) as any).encodeABI());
    if (nativeValue > 0n) calls.push((npm.methods.refundQRL() as any).encodeABI());
    const before = Number(await npm.methods.balanceOf(account).call());
    const ok = await send({
      title: initialized ? 'Create position' : 'Create pool and position',
      activity: `Opened ${sym(tokenA)} / ${sym(tokenB)} V3 ${feeLabel(fee)} position`,
      successTitle: 'Position created',
      successText: `Your ${sym(tokenA)} / ${sym(tokenB)} liquidity earns fees between ${formatPrice(shownMin)} and ${Number.isFinite(shownMax) ? formatPrice(shownMax) : '∞'} ${sym(tokenB)} per ${sym(tokenA)}.`,
      summary: { from: { token: tokenA, amount: amountA, label: sym(tokenA) }, to: { token: tokenB, amount: amountB, label: sym(tokenB) } },
      value: nativeValue || undefined,
      build: () => ({ to: ADDRESSES.NonfungiblePositionManager, method: calls.length === 1 ? npm.methods.mint(params) : npm.methods.multicall(calls) }),
    });
    if (ok) {
      const id = await npm.methods.tokenOfOwnerByIndex(account, before).call().catch(() => null);
      if (id !== null) go({ page: 'v3pos', id: String(id) });
    }
  };

  const cta = (() => {
    if (!account) return { label: 'Connect wallet', onClick: () => openModal('connect') };
    if (wrongNetwork) return { label: 'Switch to QRL Devnet', onClick: () => switchChain().catch(() => undefined) };
    if (!valid) return { label: 'Select two different tokens' };
    if (!(currentPrice > 0)) return { label: 'Set an initial price' };
    if (!ticks) return { label: 'Set a price range' };
    if (amountA === 0n && amountB === 0n) return { label: 'Enter an amount' };
    if (shortA) return { label: `Insufficient ${sym(tokenA)} balance` };
    if (shortB) return { label: `Insufficient ${sym(tokenB)} balance` };
    return null;
  })();
  const steps = [needA && tokenA ? { label: `Approve ${sym(tokenA)}`, run: () => approve(tokenA, allowA.refresh) } : null, needB && tokenB ? { label: `Approve ${sym(tokenB)}`, run: () => approve(tokenB, allowB.refresh) } : null].filter(Boolean) as { label: string; run: () => void }[];

  const unit = `${sym(tokenB)} per ${sym(tokenA)}`;
  return (
    <>
      <SubBar
        icon="plus"
        context="New position"
        detail="V3 · concentrated liquidity"
        meta={pool ? `Pool ${shortAddress(pool.address)} · tick spacing ${pool.tickSpacing} · current tick ${pool.tick.toLocaleString('en-US')}` : valid ? `No ${feeLabel(fee)} pool yet; it is created with your position` : undefined}
        action={{ label: 'Reset', icon: 'arrow-left', onClick: () => { setPreset('±10%'); setTyped({ side: 'A', value: '' }); } }}
      />
      <div className="body">
        <main className="canvas">
          <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
            <IconButton icon="arrow-left" label="Back to pools" boxed onClick={() => go({ page: 'pool' })} />
            <button className="token-select" onClick={() => setSelecting('A')}>
              <TokenIcon token={tokenA} size={24} /> {tokenA ? sym(tokenA) : 'Token A'} <Icon name="chevron-down" size={16} />
            </button>
            <button className="token-select" onClick={() => setSelecting('B')}>
              <TokenIcon token={tokenB} size={24} /> {tokenB ? sym(tokenB) : 'Token B'} <Icon name="chevron-down" size={16} />
            </button>
            <span className="badge badge-quantum">V3</span>
            <span className="badge badge-neutral">{feeLabel(fee)} fee</span>
            <span className="grow" />
            <span className="row" style={{ alignItems: 'baseline' }}>
              <span className="t-label c-3">Pool fee APR</span>
              <span className="mono c-quantum" style={{ font: '500 26px/32px var(--font)' }}>{poolApr != null ? formatPercent(poolApr, 1) : '—'}</span>
            </span>
          </div>

          <div className="col">
            <span className="t-label c-3">Fee tier</span>
            <div className="tiers">
              {FEE_TIERS.map((t) => {
                const p = poolFor(t.fee);
                const tvl = p ? tvlInQrl(p, prices, decimalsOf) : null;
                return (
                  <button key={t.fee} className={`tier ${fee === t.fee ? 'selected' : ''}`} onClick={() => setFee(t.fee)}>
                    <span className="between" style={{ width: '100%' }}>
                      <span className={`t-mono-strong ${fee === t.fee ? 'c-quantum-bright' : ''}`}>{t.label}</span>
                      {fee === t.fee ? <Icon name="circle-check" size={16} className="c-quantum" /> : <span className="check" />}
                    </span>
                    <span className="t-caption c-3">{t.hint}</span>
                    <span className="grow" />
                    <span className="t-caption c-4">{p ? `${tvl != null ? formatPrice(tvl) + ' QRL TVL' : 'TVL —'} · tick spacing ${t.tickSpacing}` : 'Not created yet'}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {valid && !initialized && (
            <div className="panel">
              <Banner tone="accent" title="This pool does not exist yet">
                Your position creates the {sym(tokenA)} / {sym(tokenB)} {feeLabel(fee)} pool. Set the starting price carefully: anyone can trade against it right away.
              </Banner>
              <div className="stepper-box" style={{ maxWidth: 360 }}>
                <span className="t-label c-3" style={{ paddingLeft: 6, whiteSpace: 'nowrap' }}>1 {sym(tokenA)} =</span>
                <input value={initialPrice} onChange={(e) => setInitialPrice(e.target.value.replace(',', '.'))} placeholder="0.0" inputMode="decimal" aria-label="Initial price" />
                <span className="t-label c-3" style={{ paddingRight: 6, whiteSpace: 'nowrap' }}>{sym(tokenB)}</span>
              </div>
            </div>
          )}

          <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
            <span className="t-heading">Set price range</span>
            <button
              className="unit-chip"
              onClick={() => {
                setTokenA(tokenB);
                setTokenB(tokenA);
                setPreset((p) => p ?? '±10%');
              }}
            >
              {unit} <Icon name="arrow-up-down" size={14} />
            </button>
            <span className="grow" />
            <Seg options={['Full range', '±10%', '±5%', '±1%'] as const} value={preset ?? ('' as Preset)} onChange={(p) => setPreset(p)} />
          </div>
          {currentPrice > 0 ? (
            <RangeChart
              points={history.points}
              current={currentPrice}
              min={shownMin}
              max={shownMax}
              bars={bars}
              unit={unit}
              onChange={(min, max) => {
                setPreset(null);
                setRange({ min, max });
              }}
            />
          ) : (
            <div className="chart-empty" style={{ height: 290 }}>
              {valid ? 'Set an initial price to choose a range' : 'Pick two tokens'}
            </div>
          )}
          <div className="steppers">
            {(['min', 'max'] as const).map((which) => (
              <div className="col" key={which}>
                <span className="t-label c-3">{which === 'min' ? 'Min price' : 'Max price'}</span>
                <div className="stepper-box">
                  <button onClick={() => step(which, -1)} aria-label={`Lower ${which} price`}>
                    <Icon name="minus" size={16} />
                  </button>
                  <span className="col grow" style={{ gap: 0, alignItems: 'center' }}>
                    <input
                      value={which === 'min' ? minText : maxText}
                      onChange={(e) => (which === 'min' ? setMinText(e.target.value) : setMaxText(e.target.value))}
                      onBlur={() => {
                        const v = Number((which === 'min' ? minText : maxText).replace(/[^\d.]/g, ''));
                        if (!(v > 0) || !range) return;
                        setPreset(null);
                        setRange(which === 'min' ? { min: v, max: range.max } : { min: range.min, max: v });
                      }}
                      aria-label={which === 'min' ? 'Min price' : 'Max price'}
                    />
                    <span className="t-caption c-4">
                      {unit}
                      {currentPrice > 0 && (which === 'min' ? shownMin > 0 : Number.isFinite(shownMax)) ? ` · ${formatPercent((which === 'min' ? shownMin : shownMax) / currentPrice - 1)}` : ''}
                    </span>
                  </span>
                  <button onClick={() => step(which, 1)} aria-label={`Raise ${which} price`}>
                    <Icon name="plus" size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </main>

        <aside className="inspector">
          <section className="card">
            <div className="card-head" style={{ paddingLeft: 4 }}>
              <span className="t-heading">Deposit amounts</span>
              {valid && <TokenPairIcon a={tokenA} b={tokenB} size={22} />}
            </div>
            <div className="stack">
              <TokenField
                label={sym(tokenA) || 'Token A'}
                token={tokenA}
                symbol={sym(tokenA)}
                amount={aDisabled ? '0' : typed.side === 'A' ? typed.value : amountA ? toInputString(amountA, dA) : ''}
                onAmount={(v) => setTyped({ side: 'A', value: v })}
                readOnly={aDisabled}
                balance={account && tokenA ? formatAmount(balanceOf(tokenA), dA) : undefined}
                onMax={account && !aDisabled ? () => setTyped({ side: 'A', value: toInputString(balanceOf(tokenA) ?? 0n, dA, dA) }) : undefined}
                subtext={aDisabled ? 'Not needed: the range is entirely on the other side' : `${Math.round(shareA * 100)}% of position`}
                focus={typed.side === 'A'}
              />
              <span className="float-btn" style={{ top: 'calc(50% - 21px)' }}>
                <Icon name="plus" size={18} />
              </span>
              <TokenField
                label={sym(tokenB) || 'Token B'}
                token={tokenB}
                symbol={sym(tokenB)}
                amount={bDisabled ? '0' : typed.side === 'B' ? typed.value : amountB ? toInputString(amountB, dB) : ''}
                onAmount={(v) => setTyped({ side: 'B', value: v })}
                readOnly={bDisabled}
                balance={account && tokenB ? formatAmount(balanceOf(tokenB), dB) : undefined}
                onMax={account && !bDisabled ? () => setTyped({ side: 'B', value: toInputString(balanceOf(tokenB) ?? 0n, dB, dB) }) : undefined}
                subtext={bDisabled ? 'Not needed: the range is entirely on the other side' : `${Math.round((1 - shareA) * 100)}% of position`}
                focus={typed.side === 'B'}
              />
            </div>
            <div className="col" style={{ gap: 6, padding: '14px 4px 0' }}>
              <div className="between">
                <span className="t-label c-3">Deposit ratio</span>
                <span className="t-mono">
                  {Math.round(shareA * 100)}% {sym(tokenA)} · {Math.round((1 - shareA) * 100)}% {sym(tokenB)}
                </span>
              </div>
              <div className="ratio-bar">
                <span style={{ flex: shareA || 0.001, background: 'var(--quantum)' }} />
                <span style={{ flex: 1 - shareA || 0.001, background: 'var(--quantum-dim)' }} />
              </div>
            </div>
            <div className="details">
              <DetailRow label="Price range" value={ticks ? `${formatPrice(shownMin)} – ${Number.isFinite(shownMax) ? formatPrice(shownMax) : '∞'}` : '—'} />
              <DetailRow label="Current price" value={currentPrice > 0 ? `${formatPrice(currentPrice)} ${sym(tokenB)}` : '—'} />
              <DetailRow label="Ticks" value={ticks ? `${ticks.lower.toLocaleString('en-US')} → ${ticks.upper.toLocaleString('en-US')}` : '—'} />
              <DetailRow label="Capital efficiency" value={fullRange ? '1× (full range)' : `${efficiency.toFixed(1)}× vs full range`} info="How much more liquidity the same deposit provides inside this range than over every price." />
              <DetailRow label="Slippage tolerance" value={`${settings.slippageBps / 100}%`} />
            </div>
            {cta ? (
              <button className="btn btn-lg btn-primary" disabled={!cta.onClick} onClick={cta.onClick}>
                {cta.label}
              </button>
            ) : (
              <div className="col">
                {steps.map((s, i) => (
                  <button key={s.label} className={`btn btn-lg ${i === 0 ? 'btn-primary' : 'btn-secondary'}`} onClick={s.run} disabled={i > 0}>
                    {i + 1} · {s.label}
                  </button>
                ))}
                <button className="btn btn-lg btn-primary" disabled={steps.length > 0} onClick={create}>
                  {steps.length ? `${steps.length + 1} · ` : ''}
                  {initialized ? 'Create position' : 'Create pool and position'}
                </button>
              </div>
            )}
          </section>
          <div className="banner banner-accent">
            <Icon name="info" size={16} />
            <span className="t-caption c-2">
              Your liquidity only earns fees while the price stays between Min and Max. Outside the range it sits entirely in one token. The position is an NFT held by your wallet.
            </span>
          </div>
        </aside>
      </div>
      <NoteBar>
        Ticks snap to the pool tick spacing (10 for 0.05%, 60 for 0.3%, 200 for 1%); prices shown are rounded to the nearest usable tick. Block {block.toLocaleString('en-US')}.
      </NoteBar>
      {selecting && (
        <TokenSelectModal
          selected={selecting === 'A' ? tokenA : tokenB}
          other={selecting === 'A' ? tokenB : tokenA}
          onSelect={(t) => {
            if (selecting === 'A') {
              if (sameToken(t, tokenB)) setTokenB(tokenA);
              setTokenA(t);
            } else {
              if (sameToken(t, tokenA)) setTokenA(tokenB);
              setTokenB(t);
            }
            setSelecting(null);
            setPreset('±10%');
          }}
          onClose={() => setSelecting(null)}
        />
      )}
    </>
  );
}
