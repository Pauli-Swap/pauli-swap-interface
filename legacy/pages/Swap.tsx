import { useEffect, useMemo, useRef, useState } from 'react';
import { PriceChart } from '../components/Chart';
import { NoteBar, SubBar } from '../components/Header';
import { SettingsButton } from '../components/SettingsPopover';
import { TokenSelectModal } from '../components/TokenSelectModal';
import { Banner, DetailRow, Icon, IconButton, Modal, Seg, TokenField, TokenIcon, TokenPairIcon } from '../components/ui';
import { Sparkline } from '../components/Chart';
import { ADDRESSES, MAX_UINT256 } from '../config';
import { useAllowance, useBalances } from '../hooks/chain';
import { usePoolHistory, usePoolStats } from '../hooks/market';
import { useNames } from '../hooks/names';
import { isQAddress, router, sameAddress, shortAddress, swapRouter, token as tokenContract, wqrl, ZERO_ADDRESS } from '../lib/chain';
import { applySlippage, formatAmount, formatPercent, formatPrice, parseUnits, timeAgo, toInputString } from '../lib/format';
import { PoolEvent, txSender, WindowKey, WINDOWS } from '../lib/history';
import { PoolInfo, tvlInQrl } from '../lib/registry';
import { go, query } from '../lib/router';
import { load, save } from '../lib/storage';
import { fetchTokenMetadata, isNative, NATIVE, sameToken, Token, wrappedAddress } from '../lib/tokens';
import { IMPACT_HIGH, IMPACT_WARNING, quote, routeLabel, Trade, TradeType, wrapKind } from '../lib/trade';
import { encodePath, feeLabel } from '../lib/v3';
import { useApp } from '../state/app';
import { useTx } from '../state/tx';
import { useWallet } from '../state/wallet';

const GAS_RESERVE = 5n * 10n ** 16n; // keep 0.05 QRL for fees when using Max on native QRL

type Cta = { label: string; kind: 'primary' | 'secondary' | 'critical' | 'disabled'; onClick?: () => void; approval?: boolean };

const touches = (p: PoolInfo, a: string, b: string) =>
  (sameAddress(p.token0, a) && sameAddress(p.token1, b)) || (sameAddress(p.token0, b) && sameAddress(p.token1, a));

export function Swap() {
  const { tokens, tokensLoading, settings, openModal, block, pools, priceInQrl, decimalsOf, tokenByAddress, clock } = useApp();
  const { account, wrongNetwork, switchChain } = useWallet();
  const { send } = useTx();
  const { sym, symOf } = useNames();

  const [input, setInput] = useState<Token | null>(NATIVE);
  const [output, setOutput] = useState<Token | null>(null);
  const [field, setField] = useState<TradeType>('exactIn');
  const [typed, setTyped] = useState('');
  const [selecting, setSelecting] = useState<'in' | 'out' | null>(null);
  const [trade, setTrade] = useState<Trade | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [noRoute, setNoRoute] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [railTab, setRailTab] = useState<'Pools' | 'Tokens'>('Pools');
  const [window, setWindow] = useState<WindowKey>('24h');
  // Leaders keep the swap card and the chart in two columns; the pool list is
  // an extra column, so it starts collapsed on narrower screens.
  const [railOpen, setRailOpen] = useState(() => load('acorn.swap.rail', globalThis.innerWidth >= 1440));
  const [chartOpen, setChartOpen] = useState(() => load('acorn.swap.chart', true));
  const [chartMode, setChartMode] = useState<'Line' | 'Candles'>(() => load('acorn.swap.mode', 'Line'));
  const [inverted, setInverted] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  useEffect(() => save('acorn.swap.rail', railOpen), [railOpen]);
  useEffect(() => save('acorn.swap.chart', chartOpen), [chartOpen]);
  useEffect(() => save('acorn.swap.mode', chartMode), [chartMode]);

  // Deep links: #/swap?inputCurrency=QRL&outputCurrency=Q…&exactAmount=1&exactField=output
  const deepLinked = useRef(false);
  useEffect(() => {
    if (deepLinked.current || tokensLoading) return;
    deepLinked.current = true;
    const params = query();
    const resolve = async (value: string | null): Promise<Token | null> => {
      if (!value) return null;
      if (/^(qrl|native)$/i.test(value)) return NATIVE;
      if (!isQAddress(value)) return null;
      return tokens.find((t) => !t.native && sameAddress(t.address, value)) ?? (await fetchTokenMetadata(value).catch(() => null));
    };
    Promise.all([resolve(params.get('inputCurrency')), resolve(params.get('outputCurrency'))]).then(([i, o]) => {
      if (i) setInput(i);
      if (o && !sameToken(o, i ?? NATIVE)) setOutput(o);
      const amount = params.get('exactAmount');
      if (amount && /^\d*\.?\d*$/.test(amount)) {
        setField(params.get('exactField') === 'output' ? 'exactOut' : 'exactIn');
        setTyped(amount);
      }
    });
  }, [tokens, tokensLoading]);

  // A pair to show on first visit: the deepest pool with QRL on one side.
  const ranked = useMemo(
    () =>
      pools
        .map((p) => ({ p, tvl: tvlInQrl(p, priceMap(pools, priceInQrl), decimalsOf) }))
        .sort((a, b) => (b.tvl ?? -1) - (a.tvl ?? -1)),
    [pools, priceInQrl, decimalsOf],
  );
  const totalTvl = ranked.reduce((s, r) => s + (r.tvl ?? 0), 0);
  useEffect(() => {
    if (output || !ranked.length || query().get('outputCurrency')) return;
    const withQrl = ranked.find((r) => sameAddress(r.p.token0, ADDRESSES.WQRL) || sameAddress(r.p.token1, ADDRESSES.WQRL));
    if (!withQrl) return;
    const other = sameAddress(withQrl.p.token0, ADDRESSES.WQRL) ? withQrl.p.token1 : withQrl.p.token0;
    const t = tokenByAddress(other);
    if (t) setOutput(t);
  }, [ranked, output, tokenByAddress]);

  const balanceOf = useBalances([input, output], account);
  const wrap = input && output ? wrapKind(input, output) : null;

  const independentToken = field === 'exactIn' ? input : output;
  const parsed = independentToken ? parseUnits(typed, independentToken.decimals) : null;

  useEffect(() => {
    setNoRoute(false);
    if (!input || !output || wrap || !parsed) {
      setTrade(null);
      return;
    }
    let alive = true;
    setQuoting(true);
    const id = setTimeout(() => {
      quote(input, output, field, parsed, decimalsOf, pools)
        .then((t) => {
          if (!alive) return;
          setTrade(t);
          setNoRoute(!t);
        })
        .catch(() => alive && (setTrade(null), setNoRoute(true)))
        .finally(() => alive && setQuoting(false));
    }, 250);
    return () => {
      alive = false;
      clearTimeout(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input, output, field, parsed?.toString(), wrap, block, tokens]);

  const amountIn = wrap ? parsed ?? undefined : field === 'exactIn' ? parsed ?? undefined : trade?.amountIn;
  const amountOut = wrap ? parsed ?? undefined : field === 'exactOut' ? parsed ?? undefined : trade?.amountOut;
  const shown = (side: TradeType, token: Token | null, value: bigint | undefined) =>
    field === side || wrap ? typed : value !== undefined && token ? toInputString(value, token.decimals) : '';

  const slippage = settings.slippageBps;
  const maxIn = trade && trade.type === 'exactOut' ? applySlippage(trade.amountIn, slippage, 'up') : amountIn;
  const minOut = trade && trade.type === 'exactIn' ? applySlippage(trade.amountOut, slippage, 'down') : amountOut;
  const spender = trade?.route.protocol === 'v3' ? ADDRESSES.SwapRouter : ADDRESSES.PauliV2Router02;

  const { allowance, refresh: refreshAllowance } = useAllowance(input && !isNative(input) && !wrap ? input.address : null, account, spender);
  const spendsToken = !!input && !isNative(input) && !wrap && maxIn !== undefined && !!trade;
  const needsApproval = spendsToken && allowance !== undefined && allowance < maxIn!;
  const checkingApproval = spendsToken && !!account && allowance === undefined;

  const inBalance = balanceOf(input);
  const insufficient = inBalance !== undefined && maxIn !== undefined && maxIn > inBalance;
  const impact = trade?.priceImpact ?? 0;

  const selectToken = (t: Token) => {
    if (selecting === 'in') {
      if (sameToken(t, output)) setOutput(input);
      setInput(t);
    } else {
      if (sameToken(t, input)) setInput(output);
      setOutput(t);
    }
    setSelecting(null);
  };
  const flip = () => {
    setInput(output);
    setOutput(input);
    setField(field === 'exactIn' ? 'exactOut' : 'exactIn');
  };
  const onPortion = (divisor: bigint) => {
    if (!input || inBalance === undefined) return;
    setField('exactIn');
    setTyped(toInputString(inBalance / divisor, input.decimals, input.decimals));
  };
  const onMax = () => {
    if (!input || inBalance === undefined) return;
    const max = isNative(input) ? (inBalance > GAS_RESERVE ? inBalance - GAS_RESERVE : 0n) : inBalance;
    setField('exactIn');
    setTyped(toInputString(max, input.decimals, input.decimals));
  };

  const approve = () =>
    input &&
    send({
      title: `Approve ${sym(input)}`,
      activity: `Approved ${sym(input)} for ${trade?.route.protocol === 'v3' ? 'SwapRouter' : 'PauliV2Router'}`,
      successTitle: 'Approval confirmed',
      successText: `PauliSwap can now spend your ${sym(input)}.`,
      build: () => ({ to: input.address, method: tokenContract(input.address).methods.approve(spender, MAX_UINT256) }),
    }).then((ok) => ok && refreshAllowance());

  const executeWrap = () => {
    if (!wrap || !parsed || !input || !output) return;
    send({
      title: wrap === 'wrap' ? 'Wrap QRL' : 'Unwrap WQRL',
      activity: `${wrap === 'wrap' ? 'Wrapped' : 'Unwrapped'} ${formatAmount(parsed, 18)} ${sym(input)}`,
      successTitle: wrap === 'wrap' ? 'Wrapped' : 'Unwrapped',
      successText: `You received ${formatAmount(parsed, 18)} ${sym(output)}.`,
      summary: { from: { token: input, amount: parsed, label: sym(input) }, to: { token: output, amount: parsed, label: sym(output) } },
      build: () => ({ to: ADDRESSES.WQRL, method: wrap === 'wrap' ? wqrl().methods.deposit() : wqrl().methods.withdraw(parsed) }),
      value: wrap === 'wrap' ? parsed : undefined,
    }).then((ok) => ok && setTyped(''));
  };

  const executeSwap = () => {
    if (!trade || !input || !output || !account || minOut === undefined || maxIn === undefined) return;
    const deadline = BigInt(Math.floor(Date.now() / 1000) + settings.deadlineMin * 60);
    const nativeIn = isNative(input);
    const nativeOut = isNative(output);
    setReviewing(false);
    send({
      title: 'Swap',
      activity: `Swapped ${formatAmount(trade.amountIn, input.decimals)} ${sym(input)} for ${formatAmount(trade.amountOut, output.decimals)} ${sym(output)}`,
      successTitle: 'Swap successful',
      successText: `You received ${trade.type === 'exactIn' ? 'at least ' + formatAmount(minOut, output.decimals) : formatAmount(trade.amountOut, output.decimals)} ${sym(output)}.`,
      summary: { from: { token: input, amount: trade.amountIn, label: sym(input) }, to: { token: output, amount: trade.amountOut, label: sym(output) } },
      value: nativeIn ? (trade.type === 'exactIn' ? trade.amountIn : maxIn) : undefined,
      build: () => {
        const r = trade.route;
        if (r.protocol === 'v2') {
          const m = router().methods;
          const { path } = r;
          const call = () => {
            if (trade.type === 'exactIn') {
              if (nativeIn) return m.swapExactQRLForTokens(minOut, path, account, deadline);
              if (nativeOut) return m.swapExactTokensForQRL(trade.amountIn, minOut, path, account, deadline);
              return m.swapExactTokensForTokens(trade.amountIn, minOut, path, account, deadline);
            }
            if (nativeIn) return m.swapQRLForExactTokens(trade.amountOut, path, account, deadline);
            if (nativeOut) return m.swapTokensForExactQRL(trade.amountOut, maxIn, path, account, deadline);
            return m.swapTokensForExactTokens(trade.amountOut, maxIn, path, account, deadline);
          };
          return { to: ADDRESSES.PauliV2Router02, method: call() };
        }
        // V3: native output lands in the router first and is unwrapped to the
        // wallet; native input over-sent for exact output is refunded.
        const m = swapRouter().methods;
        const recipient = nativeOut ? ZERO_ADDRESS : account;
        const single = r.fees.length === 1;
        const swap =
          trade.type === 'exactIn'
            ? single
              ? m.exactInputSingle([r.path[0], r.path[1], r.fees[0], recipient, deadline, trade.amountIn, minOut, 0])
              : m.exactInput([encodePath(r.path, r.fees), recipient, deadline, trade.amountIn, minOut])
            : single
              ? m.exactOutputSingle([r.path[0], r.path[1], r.fees[0], recipient, deadline, trade.amountOut, maxIn, 0])
              : m.exactOutput([encodePath([...r.path].reverse(), [...r.fees].reverse()), recipient, deadline, trade.amountOut, maxIn]);
        const calls: string[] = [(swap as any).encodeABI()];
        if (nativeOut) calls.push((m.unwrapWQRL9(trade.type === 'exactIn' ? minOut : trade.amountOut, account) as any).encodeABI());
        if (nativeIn && trade.type === 'exactOut') calls.push((m.refundQRL() as any).encodeABI());
        return { to: ADDRESSES.SwapRouter, method: calls.length === 1 ? swap : m.multicall(calls) };
      },
    }).then((ok) => ok && setTyped(''));
  };

  const routeText = trade
    ? trade.path
        .map((a, i, all) => (i === 0 && isNative(input) ? 'QRL' : i === all.length - 1 && isNative(output) ? 'QRL' : symOf(a)))
        .join(' → ')
    : '';
  const rate = trade ? trade.executionPrice : 0;
  const rateText = trade && input && output ? `1 ${sym(input)} = ${formatPrice(rate)} ${sym(output)}` : '';
  const impactTone = impact >= IMPACT_HIGH ? 'critical' : impact >= IMPACT_WARNING ? 'warning' : 'success';
  const feePct = trade ? `${(trade.feeFraction * 100).toFixed(trade.feeFraction < 0.001 ? 3 : 2)}%` : '';

  const details = trade && input && output && (
    <>
      <DetailRow label="Rate" value={rateText} />
      <DetailRow label="Price impact" value={formatPercent(impact)} tone={impactTone} info="How much this trade moves the pool price, excluding the LP fee." />
      {trade.type === 'exactIn' ? (
        <DetailRow label="Minimum received" value={`${formatAmount(minOut, output.decimals)} ${sym(output)}`} info="The least you receive before the trade reverts." />
      ) : (
        <DetailRow label="Maximum sold" value={`${formatAmount(maxIn, input.decimals)} ${sym(input)}`} info="The most you spend before the trade reverts." />
      )}
      <DetailRow label={`LP fee (${feePct})`} value={`${formatAmount(trade.lpFee, input.decimals)} ${sym(input)}`} info="Paid to liquidity providers on every hop." />
      <DetailRow label="Route" value={`${routeText} · ${routeLabel(trade.route)}`} />
    </>
  );

  const cta = useMemo<Cta>(() => {
    if (!account) return { label: 'Connect wallet', kind: 'primary', onClick: () => openModal('connect') };
    if (wrongNetwork) return { label: 'Switch to QRL Devnet', kind: 'primary', onClick: () => switchChain().catch(() => undefined) };
    if (!input || !output) return { label: 'Select a token', kind: 'disabled' };
    if (!parsed) return { label: 'Enter an amount', kind: 'disabled' };
    if (wrap) {
      if (insufficient) return { label: `Insufficient ${sym(input)} balance`, kind: 'disabled' };
      return { label: wrap === 'wrap' ? 'Wrap' : 'Unwrap', kind: 'primary', onClick: executeWrap };
    }
    if (quoting && !trade) return { label: 'Finding the best route…', kind: 'disabled' };
    if (noRoute || !trade) return { label: 'Insufficient liquidity', kind: 'disabled' };
    if (insufficient) return { label: `Insufficient ${sym(input)} balance`, kind: 'disabled' };
    if (checkingApproval) return { label: 'Checking approval…', kind: 'disabled' };
    if (needsApproval) return { label: `Approve ${sym(input)}`, kind: 'primary', onClick: approve, approval: true };
    if (impact >= IMPACT_HIGH) return { label: 'Swap anyway', kind: 'critical', onClick: () => setReviewing(true) };
    return { label: `Swap ${formatAmount(trade.amountIn, input.decimals)} ${sym(input)}`, kind: 'primary', onClick: () => setReviewing(true) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account, wrongNetwork, input, output, parsed, wrap, quoting, trade, noRoute, insufficient, needsApproval, checkingApproval, impact, tokens]);

  // Chart: the deepest pool between the two tokens, else the first hop of the route.
  const a = input ? wrappedAddress(input) : null;
  const b = output ? wrappedAddress(output) : null;
  const chartPool = useMemo(() => {
    if (!a || !b) return null;
    const direct = ranked.filter((r) => touches(r.p, a, b));
    if (trade?.route.protocol === 'v3' && trade.route.fees.length === 1) {
      const used = direct.find((r) => r.p.version === 'v3' && r.p.fee === (trade.route as { fees: number[] }).fees[0]);
      if (used) return used.p;
    }
    if (direct.length) return direct[0].p;
    if (trade) return ranked.find((r) => touches(r.p, trade.path[0], trade.path[1]))?.p ?? null;
    return null;
  }, [a, b, ranked, trade]);
  const sellSide = chartPool && a && (sameAddress(chartPool.token0, a) || sameAddress(chartPool.token1, a)) ? a : chartPool?.token0;
  const buySide = chartPool && sellSide ? (sameAddress(chartPool.token0, sellSide) ? chartPool.token1 : chartPool.token0) : null;
  const chartBase = inverted ? buySide : sellSide;
  const chartQuote = inverted ? sellSide : buySide;
  const history = usePoolHistory(chartPool, chartBase, window);
  const lastPrice = history.points.length ? history.points[history.points.length - 1].v : 0;
  const firstPrice = history.points.length ? history.points[0].v : 0;
  const change = firstPrice > 0 ? lastPrice / firstPrice - 1 : 0;
  const chartTvl = chartPool ? ranked.find((r) => r.p.id === chartPool.id)?.tvl : null;
  const label = (t: string | null | undefined) => (t && sameAddress(t, ADDRESSES.WQRL) && (isNative(input) || isNative(output)) ? 'QRL' : symOf(t));
  const baseLabel = label(chartBase);
  const quoteLabel = label(chartQuote);

  const addLiquidityHere = () =>
    chartPool && (chartPool.version === 'v2' ? go({ page: 'v2', pair: chartPool.address }) : go({ page: 'v3new' }, { tokenA: chartPool.token0, tokenB: chartPool.token1, fee: chartPool.fee }));
  const swapCount = history.events.filter((e) => e.kind === 'swap' && (e.amount0 !== 0n || e.amount1 !== 0n)).length;
  const windowLabel = window === 'All' ? 'since launch' : window;

  return (
    <>
      <SubBar
        context={input && output ? `${sym(input)} / ${sym(output)}` : 'Swap'}
        detail={trade ? `Routed via ${routeLabel(trade.route)}` : chartPool ? `${chartPool.version.toUpperCase()} pool · ${feeLabel(chartPool.fee)} fee` : 'Pick two tokens'}
        meta={chartPool ? `${swapCount} swaps ${windowLabel === 'since launch' ? windowLabel : 'in ' + windowLabel}` : undefined}
        action={chartPool ? { label: 'Add liquidity', icon: 'plus', onClick: addLiquidityHere } : undefined}
      />
      <div className="body">
        {chartOpen && railOpen && (
          <aside className="rail">
            <div className="between" style={{ padding: '0 6px 8px' }}>
              <Seg options={['Pools', 'Tokens'] as const} value={railTab} onChange={setRailTab} />
              <IconButton icon="arrow-left" label="Hide the pool list" onClick={() => setRailOpen(false)} />
            </div>
            {railTab === 'Pools' ? (
              <>
                <div className="rail-head">
                  <span className="t-body-strong">Top pools on devnet</span>
                  <span className="t-caption c-4">TVL in QRL</span>
                </div>
                {ranked.length === 0 && <div className="rail-empty t-body">No pools yet. Create the first one from Pool.</div>}
                {ranked.slice(0, 12).map(({ p, tvl }, i) => {
                  const t0 = tokenByAddress(p.token0);
                  const t1 = tokenByAddress(p.token1);
                  const selected = chartPool?.id === p.id;
                  return (
                    <button
                      key={p.id}
                      className={`rail-row ${selected ? 'selected' : ''}`}
                      onClick={() => {
                        const toToken = (t: Token | undefined) => (t && sameAddress(t.address, ADDRESSES.WQRL) ? NATIVE : t ?? null);
                        setInput(toToken(t0));
                        setOutput(toToken(t1));
                      }}
                    >
                      <span className="rank">{i + 1}</span>
                      <span className="col grow" style={{ gap: 0 }}>
                        <span className="t-body-strong ellipsis">
                          {sym(t0)} / {sym(t1)}
                        </span>
                        <span className="t-caption c-3">
                          {p.version.toUpperCase()} · {feeLabel(p.fee)}
                          {tvl != null && totalTvl > 0 ? ` · ${((tvl / totalTvl) * 100).toFixed(1)}% of TVL` : ''}
                        </span>
                      </span>
                      <span className={`t-mono-strong ${selected ? 'c-1' : 'c-2'}`}>{tvl != null ? formatPrice(tvl) : '—'}</span>
                    </button>
                  );
                })}
              </>
            ) : (
              <>
                <div className="rail-head">
                  <span className="t-body-strong">Tokens</span>
                  <span className="t-caption c-4">price in QRL</span>
                </div>
                {tokens.map((t, i) => (
                  <button key={t.native ? 'native' : t.address} className={`rail-row ${sameToken(t, output) ? 'selected' : ''}`} onClick={() => !sameToken(t, input) && setOutput(t)}>
                    <span className="rank">{i + 1}</span>
                    <TokenIcon token={t} size={24} />
                    <span className="col grow" style={{ gap: 0 }}>
                      <span className="t-body-strong">{sym(t)}</span>
                      <span className="t-caption c-3 ellipsis">{t.native ? 'Native coin' : t.name}</span>
                    </span>
                    <span className="t-mono-strong c-2">{t.native ? '1' : priceInQrl(t) !== undefined ? formatPrice(priceInQrl(t)!) : '—'}</span>
                  </button>
                ))}
              </>
            )}
          </aside>
        )}

        {chartOpen && (
          <main className="canvas">
            <div className="chart-head">
              <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
                {!railOpen && (
                  <button className="btn btn-sm btn-secondary" onClick={() => setRailOpen(true)}>
                    Pools
                  </button>
                )}
                {chartPool && <TokenPairIcon a={tokenByAddress(chartBase!) ?? (isNative(input) ? NATIVE : null)} b={tokenByAddress(chartQuote!)} size={28} />}
                <span className="t-heading">{chartPool ? `${baseLabel} / ${quoteLabel}` : 'Price'}</span>
                {chartPool && <IconButton icon="arrow-up-down" label="Invert the price" onClick={() => setInverted((v) => !v)} />}
                {chartPool && (
                  <>
                    <span className={`badge ${chartPool.version === 'v3' ? 'badge-quantum' : 'badge-neutral'}`}>{chartPool.version.toUpperCase()}</span>
                    <span className="badge badge-neutral">{feeLabel(chartPool.fee)}</span>
                  </>
                )}
                <span className="grow" />
                {chartPool &&
                  [chartBase!, chartQuote!].map((a) => (
                    <button key={a} className="addr-chip" onClick={() => navigator.clipboard?.writeText(a)} title={`Copy ${a}`}>
                      <span className="c-2">{sameAddress(a, ADDRESSES.WQRL) ? 'WQRL' : symOf(a)}</span>
                      <span className="mono c-3">{shortAddress(a)}</span>
                      <Icon name="copy" size={12} />
                    </button>
                  ))}
              </div>
              <div className="row" style={{ alignItems: 'flex-end', gap: 28, flexWrap: 'wrap' }}>
                <div className="col" style={{ gap: 2 }}>
                  <span className="row" style={{ alignItems: 'baseline', gap: 8 }}>
                    <span className="t-amount">{lastPrice ? formatPrice(lastPrice) : '—'}</span>
                    {chartPool && <span className="t-label c-3">{quoteLabel}</span>}
                  </span>
                  {history.points.length > 1 && (
                    <span className={`t-mono ${change >= 0 ? 'c-quantum' : 'c-alert'}`}>
                      {change >= 0 ? '+' : '−'}
                      {Math.abs(change * 100).toFixed(2)}% <span className="c-4">{windowLabel}</span>
                    </span>
                  )}
                </div>
                {chartPool && (
                  <div className="chart-stats">
                    <span>
                      <span className="t-caption c-3">High</span>
                      <span className="t-mono-strong">{history.high ? formatPrice(history.high) : '—'}</span>
                    </span>
                    <span>
                      <span className="t-caption c-3">Low</span>
                      <span className="t-mono-strong">{history.low ? formatPrice(history.low) : '—'}</span>
                    </span>
                    <span>
                      <span className="t-caption c-3">Volume</span>
                      <span className="t-mono-strong">{history.volume != null ? `${formatPrice(history.volume)} QRL` : '—'}</span>
                    </span>
                    <span>
                      <span className="t-caption c-3">TVL</span>
                      <span className="t-mono-strong">{chartTvl != null ? `${formatPrice(chartTvl)} QRL` : '—'}</span>
                    </span>
                  </div>
                )}
              </div>
            </div>
            <div className="between" style={{ flexWrap: 'wrap' }}>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <Seg options={Object.keys(WINDOWS) as WindowKey[]} value={window} onChange={setWindow} />
                <Seg options={['Line', 'Candles'] as const} value={chartMode} onChange={setChartMode} />
              </div>
              <div className="row" style={{ gap: 4 }}>
                {chartPool && <IconButton icon="plus" label="Add liquidity to this pool" onClick={addLiquidityHere} />}
                <button className="btn btn-sm btn-ghost" onClick={() => setChartOpen(false)}>
                  Hide chart
                </button>
              </div>
            </div>
            {chartPool ? (
              <PriceChart points={history.points} candles={history.candles} mode={chartMode === 'Candles' ? 'candles' : 'line'} unit={quoteLabel} height={380} />
            ) : (
              <div className="chart-empty" style={{ height: 380 }}>
                {input && output ? 'No pool connects these two tokens directly yet' : 'Pick two tokens to see their price'}
              </div>
            )}
            <span className="legend-pill">
              <Icon name="info" size={16} className="c-3" />
              Prices come from pool reserves after each block; times are approximate (≈ {Math.round(clock.secondsPerBlock)} s per block)
            </span>
          </main>
        )}

        <aside className={`inspector ${chartOpen ? '' : 'solo'}`}>
          <section className="card" aria-label="Swap">
            <div className="card-head">
              <Seg
                options={['Swap', 'Wrap'] as const}
                value={wrap ? 'Wrap' : 'Swap'}
                onChange={(v) => {
                  if (v === 'Wrap') {
                    setInput(NATIVE);
                    setOutput(tokens.find((t) => !t.native && sameAddress(t.address, ADDRESSES.WQRL)) ?? null);
                  } else if (wrap) setOutput(null);
                }}
              />
              <SettingsButton showSlippage />
            </div>
            <div className="stack">
              <TokenField
                label="Sell"
                token={input}
                symbol={sym(input)}
                amount={shown('exactIn', input, amountIn)}
                onAmount={(v) => (setField('exactIn'), setTyped(v))}
                onSelect={() => setSelecting('in')}
                balance={account && input ? formatAmount(inBalance, input.decimals) : undefined}
                onHalf={account ? () => onPortion(2n) : undefined}
                onMax={account ? onMax : undefined}
                subtext={input && amountIn !== undefined && priceInQrl(input) !== undefined ? `≈ ${formatPrice(Number(toInputString(amountIn, input.decimals)) * priceInQrl(input)!)} QRL` : ' '}
                focus={field === 'exactIn'}
              />
              <button className="float-btn spin-on-hover" style={{ top: 'calc(50% - 21px)' }} onClick={flip} aria-label="Switch tokens">
                <Icon name="arrow-down" size={18} />
              </button>
              <TokenField
                label="Buy"
                token={output}
                symbol={sym(output)}
                amount={shown('exactOut', output, amountOut)}
                onAmount={(v) => (setField('exactOut'), setTyped(v))}
                onSelect={() => setSelecting('out')}
                balance={account && output ? formatAmount(balanceOf(output), output.decimals) : undefined}
                subtext={wrap ? `${wrap === 'wrap' ? 'Wrapped' : 'Unwrapped'} 1:1` : output && amountOut !== undefined && priceInQrl(output) !== undefined ? `≈ ${formatPrice(Number(toInputString(amountOut, output.decimals)) * priceInQrl(output)!)} QRL` : quoting ? 'Finding the best route…' : ' '}
                focus={field === 'exactOut'}
              />
            </div>
            {wrap && parsed ? (
              <div className="details">
                <DetailRow label="Rate" value="1 QRL = 1 WQRL" />
                <DetailRow label="LP fee" value="None" />
                <DetailRow label="Contract" value={wrap === 'wrap' ? 'WQRL.deposit()' : 'WQRL.withdraw()'} />
              </div>
            ) : trade ? (
              <div className="details">
                <button className="summary-row" onClick={() => setDetailsOpen((v) => !v)} aria-expanded={detailsOpen}>
                  <span className="t-mono c-1 ellipsis">{rateText}</span>
                  <span className="grow" />
                  {impactTone !== 'success' && <span className={`t-mono ${impactTone === 'warning' ? 'c-warning' : 'c-alert'}`}>{formatPercent(impact)}</span>}
                  <span className="badge badge-quantum">{routeLabel(trade.route)}</span>
                  <Icon name="chevron-down" size={16} className="c-3" style={{ transform: detailsOpen ? 'rotate(180deg)' : undefined, transition: 'transform 120ms' }} />
                </button>
                {detailsOpen && (
                  <>
                    {details}
                    <div className="route">
                      {trade.path.map((a, i) => (
                        <span key={i} className="row" style={{ gap: 6 }}>
                          {i > 0 && (
                            <>
                              <span className="route-line" />
                              <span className="badge badge-neutral">{trade.route.protocol === 'v3' ? feeLabel(trade.route.fees[i - 1]) : 'V2 0.3%'}</span>
                              <span className="route-line" />
                            </>
                          )}
                          <span className="route-token">
                            <TokenIcon token={(i === 0 && isNative(input)) || (i === trade.path.length - 1 && isNative(output)) ? NATIVE : tokenByAddress(a)} size={18} />
                            {(i === 0 && isNative(input)) || (i === trade.path.length - 1 && isNative(output)) ? 'QRL' : symOf(a)}
                          </span>
                        </span>
                      ))}
                    </div>
                  </>
                )}
              </div>
            ) : (
              <div style={{ height: 14 }} />
            )}
            {trade && impact >= IMPACT_HIGH && (
              <div style={{ paddingBottom: 12 }}>
                <Banner tone="critical" title={`Price impact −${formatPercent(impact)}`}>
                  This trade moves the pool price a lot. You will receive far less than the current rate.
                </Banner>
              </div>
            )}
            {cta.approval ? (
              <div className="col">
                <button className="btn btn-lg btn-primary" onClick={cta.onClick}>
                  1 · {cta.label}
                </button>
                <button className="btn btn-lg" disabled>
                  2 · Swap
                </button>
                <span className="row t-caption c-3" style={{ padding: '4px 4px 0' }}>
                  <Icon name="lock" size={14} />
                  Zond has no permit signatures, so each token needs one approval for the {trade?.route.protocol === 'v3' ? 'SwapRouter' : 'V2 router'}.
                </span>
              </div>
            ) : (
              <button className={`btn btn-lg btn-${cta.kind}`} disabled={cta.kind === 'disabled'} onClick={cta.onClick}>
                {cta.label}
              </button>
            )}
          </section>
          {!chartOpen && (
            <div className="row">
              <button className="legend-pill" onClick={() => setChartOpen(true)}>
                <Icon name="arrow-up-down" size={14} /> Show chart
              </button>
            </div>
          )}
          <TokenCards tokens={[input, output]} />
          <Activity pool={chartPool} events={history.events} />
        </aside>
      </div>
      <NoteBar>Prices are read from pool reserves on QRL Devnet (chain 3151908). Test tokens have no value.</NoteBar>

      {selecting && (
        <TokenSelectModal selected={selecting === 'in' ? input : output} other={selecting === 'in' ? output : input} onSelect={selectToken} onClose={() => setSelecting(null)} />
      )}

      {reviewing && trade && input && output && (
        <Modal title="Review swap" onClose={() => setReviewing(false)}>
          <div className="field">
            <span className="t-label c-3">You pay</span>
            <div className="row" style={{ gap: 12 }}>
              <span className="t-amount grow">{formatAmount(trade.amountIn, input.decimals, 6)}</span>
              <span className="token-select">
                <TokenIcon token={input} size={24} /> {sym(input)}
              </span>
            </div>
          </div>
          <div className="field">
            <span className="t-label c-3">You receive</span>
            <div className="row" style={{ gap: 12 }}>
              <span className="t-amount grow">{formatAmount(trade.amountOut, output.decimals, 6)}</span>
              <span className="token-select">
                <TokenIcon token={output} size={24} /> {sym(output)}
              </span>
            </div>
          </div>
          <div className="details" style={{ padding: 0 }}>
            {details}
            <DetailRow label="Expires" value={`${settings.deadlineMin} minutes`} />
          </div>
          <span className="t-caption c-3">
            If the price moves more than {slippage / 100}% before the transaction is included, the {trade.route.protocol === 'v3' ? 'SwapRouter' : 'router'} reverts and only the network fee is spent.
          </span>
          <button className={`btn btn-lg ${impact >= IMPACT_HIGH ? 'btn-critical' : 'btn-primary'}`} onClick={executeSwap}>
            {impact >= IMPACT_HIGH ? 'Swap anyway' : 'Confirm swap'}
          </button>
        </Modal>
      )}
    </>
  );
}

function priceMap(pools: PoolInfo[], priceInQrl: (a: string) => number | undefined) {
  const m = new Map<string, number>();
  for (const p of pools)
    for (const t of [p.token0, p.token1]) {
      const v = priceInQrl(t);
      if (v !== undefined) m.set(t.toLowerCase(), v);
    }
  return m;
}

function Activity({ pool, events }: { pool: PoolInfo | null; events: PoolEvent[] }) {
  const { decimalsOf, blockTime } = useApp();
  const { symOf } = useNames();
  const rows = events.filter((e) => e.kind !== 'swap' || e.amount0 !== 0n || e.amount1 !== 0n).slice(-5).reverse();
  const [senders, setSenders] = useState<Record<string, string>>({});
  useEffect(() => {
    rows.forEach((e) => !senders[e.hash] && txSender(e.hash).then((s) => s && setSenders((m) => ({ ...m, [e.hash]: s }))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows.map((r) => r.hash).join()]);
  if (!pool) return null;
  const s0 = symOf(pool.token0);
  const s1 = symOf(pool.token1);
  const d0 = decimalsOf(pool.token0);
  const d1 = decimalsOf(pool.token1);
  return (
    <section className="col" style={{ gap: 0 }}>
      <div className="between" style={{ padding: '0 4px 6px' }}>
        <span className="t-body-strong">Recent activity</span>
        <a className="t-label link" href={`#/pool`}>
          View pools
        </a>
      </div>
      {rows.length === 0 && <span className="t-body c-3" style={{ padding: '8px 4px' }}>No activity in this window.</span>}
      {rows.map((e) => {
        const buy0 = e.amount0 < 0n;
        const out = (v: bigint, d: number) => formatAmount(v < 0n ? -v : v, d);
        const title =
          e.kind === 'swap'
            ? buy0
              ? `Buy ${out(e.amount0, d0)} ${s0}`
              : `Sell ${out(e.amount0, d0)} ${s0}`
            : `${e.kind === 'add' ? 'Add' : 'Remove'} ${out(e.amount0, d0)} ${s0} + ${out(e.amount1, d1)} ${s1}`;
        const value = e.kind === 'swap' ? `${out(e.amount1, d1)} ${s1}` : pool.version.toUpperCase();
        const who = senders[e.hash] ?? e.account;
        return (
          <div className="activity-row" key={`${e.hash}-${e.logIndex}`}>
            <span className="dot" style={{ background: e.kind !== 'swap' ? 'var(--text-secondary)' : buy0 ? 'var(--quantum)' : 'var(--alert)' }} />
            <span className="col grow" style={{ gap: 0 }}>
              <span className="t-body-strong ellipsis">{title}</span>
              <span className="t-mono c-4">
                {who ? shortAddress(who) : '…'} · {timeAgo(blockTime(e.block) * 1000)} ago
              </span>
            </span>
            <span className={`t-mono ${e.kind !== 'swap' ? 'c-2' : buy0 ? 'c-quantum' : 'c-alert'}`}>{value}</span>
          </div>
        );
      })}
    </section>
  );
}

/// Price in QRL and the 24h trend of each side of the trade, through the
/// deepest pool that pairs the token with WQRL (Jupiter's token cards).
function TokenCards({ tokens }: { tokens: (Token | null)[] }) {
  const { pools, priceInQrl } = useApp();
  const { sym } = useNames();
  const list = tokens.filter((t): t is Token => !!t && !t.native && !sameAddress(t.address, ADDRESSES.WQRL));
  const pairs = useMemo(
    () =>
      list.map((t) =>
        pools
          .filter((p) => (sameAddress(p.token0, t.address) && sameAddress(p.token1, ADDRESSES.WQRL)) || (sameAddress(p.token1, t.address) && sameAddress(p.token0, ADDRESSES.WQRL)))
          .sort((x, y) => (y.reserve0 + y.reserve1 > x.reserve0 + x.reserve1 ? 1 : -1))[0],
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pools, list.map((t) => t.address).join()],
  );
  const stats = usePoolStats(pairs.filter((p): p is PoolInfo => !!p), '24h');
  if (!list.length) return null;
  return (
    <div className="token-cards">
      {list.map((t, i) => {
        const pool = pairs[i];
        const s = pool ? stats.get(pool.id) : undefined;
        // The pool sparkline is token0 in token1; show it as the token's QRL price.
        const tokenIs0 = pool ? sameAddress(pool.token0, t.address) : true;
        const spark = (s?.spark ?? []).map((v) => (tokenIs0 ? v : v > 0 ? 1 / v : 0));
        const change = s?.change != null ? (tokenIs0 ? s.change : 1 / (1 + s.change) - 1) : null;
        const price = priceInQrl(t);
        return (
          <div key={t.address} className="token-card">
            <div className="row" style={{ gap: 8 }}>
              <TokenIcon token={t} size={24} />
              <span className="col grow" style={{ gap: 0, minWidth: 0 }}>
                <span className="t-body-strong">{sym(t)}</span>
                <button className="t-mono c-4 row" style={{ gap: 4, whiteSpace: 'nowrap' }} onClick={() => navigator.clipboard?.writeText(t.address)} title="Copy address">
                  {shortAddress(t.address)} <Icon name="copy" size={11} />
                </button>
              </span>
              <span className="col" style={{ gap: 0, alignItems: 'flex-end' }}>
                <span className="t-mono-strong">{price !== undefined ? formatPrice(price) : '—'}</span>
                <span className={`t-mono ${change == null ? 'c-4' : change >= 0 ? 'c-quantum' : 'c-alert'}`} style={{ fontSize: 12 }}>
                  {change == null ? 'QRL' : `${change >= 0 ? '+' : '−'}${Math.abs(change * 100).toFixed(2)}%`}
                </span>
              </span>
            </div>
            <Sparkline values={spark} up={(change ?? 0) >= 0} stretch />
            <a className="t-caption link" href="#/explore">
              Token details ↗
            </a>
          </div>
        );
      })}
    </div>
  );
}
