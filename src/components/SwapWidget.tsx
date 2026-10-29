import { useEffect, useMemo, useRef, useState } from 'react';
import { ADDRESSES, INTERFACE_FEE, MAX_UINT256, SWAP_ROUTER_02 } from '../config';
import { useAllowance, useBalances } from '../hooks/chain';
import { useNames } from '../hooks/names';
import { isQAddress, reader, router, sameAddress, swapRouter, swapRouter02, token as tokenContract, wqrl, ZERO_ADDRESS } from '../lib/chain';
import { ADDRESS_THIS, feeOf, grossFor, netOf } from '../lib/fee';
import { applySlippage, formatAmount, formatPercent, formatPrice, parseUnits, toInputString } from '../lib/format';
import { tvlInQrl } from '../lib/registry';
import { query } from '../lib/router';
import { fetchTokenMetadata, isNative, isWqrl, NATIVE, sameToken, Token } from '../lib/tokens';
import { IMPACT_HIGH, IMPACT_WARNING, quote, Route, Trade, TradeType, wrapKind } from '../lib/trade';
import { encodePath, feeLabel } from '../lib/v3';
import { useApp } from '../state/app';
import { TxRequest, useTx } from '../state/tx';
import { useWallet } from '../state/wallet';
import '../styles/swap.css';
import { SettingsButton } from './SettingsPopover';
import { TokenSelectModal } from './TokenSelectModal';
import { AmountPanel, Busy, DetailRow, Icon, Modal, Seg, TokenIcon } from './ui';

const GAS_RESERVE = 5n * 10n ** 16n; // keep 0.05 QRL for fees when using MAX on native QRL
const fee = INTERFACE_FEE;

type Cta = { label: string; kind: 'primary' | 'secondary' | 'danger' | 'disabled'; onClick?: () => void; busy?: boolean };
type Mode = 'swap' | 'wrap';

/// "V3 0.05%" / "V2 0.3%" — the protocol and fee tiers of a route.
const routeTag = (r: Route) => (r.protocol === 'v2' ? 'V2 0.3%' : `V3 ${r.fees.map(feeLabel).join(' + ')}`);
const pct = (bps: number) => `${(bps / 100).toFixed(2).replace(/\.?0+$/, '')}%`;

async function resolveToken(value: string | null | undefined, tokens: Token[]): Promise<Token | null> {
  if (!value) return null;
  if (/^(qrl|native)$/i.test(value)) return NATIVE;
  if (!isQAddress(value)) return null;
  return tokens.find((t) => !t.native && sameAddress(t.address, value)) ?? (await fetchTokenMetadata(value).catch(() => null));
}

/// Swap widget (89:198): Swap / Wrap tabs, slippage pill, settings, Sell / Buy
/// amount panels with a flip button, the primary CTA and collapsible route details.
export function SwapWidget({ defaultInput, defaultOutput, syncUrl }: { defaultInput?: string; defaultOutput?: string; syncUrl?: boolean }) {
  const { tokens, tokensLoading, settings, openModal, block, pools, priceInQrl, decimalsOf, tokenByAddress } = useApp();
  const { account, wrongNetwork, switchChain } = useWallet();
  const { send } = useTx();
  const { sym, symOf } = useNames();

  const [mode, setMode] = useState<Mode>('swap');
  const [input, setInput] = useState<Token | null>(NATIVE);
  const [output, setOutput] = useState<Token | null>(null);
  const [field, setField] = useState<TradeType>('exactIn');
  const [typed, setTyped] = useState('');
  const [selecting, setSelecting] = useState<'in' | 'out' | null>(null);
  const [trade, setTrade] = useState<Trade | null>(null);
  const [quoting, setQuoting] = useState(false);
  /// `${field}:${typed}` of the last settled quote; block re-quotes of the same amount don't count as stale.
  const [quotedFor, setQuotedFor] = useState('');
  const [noRoute, setNoRoute] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(true);
  const [approved, setApproved] = useState<string[]>([]);

  // Initial pair: deep link (Swap page) or the props, once the token list is in.
  const initialized = useRef(false);
  useEffect(() => {
    if (initialized.current || tokensLoading) return;
    initialized.current = true;
    const params = syncUrl ? query() : new URLSearchParams();
    const inValue = params.get('inputCurrency') ?? defaultInput;
    const outValue = params.get('outputCurrency') ?? defaultOutput;
    Promise.all([resolveToken(inValue, tokens), resolveToken(outValue, tokens)]).then(([i, o]) => {
      if (i) setInput(i);
      if (o && !sameToken(o, i ?? NATIVE)) setOutput(o);
      else if (o && i && sameToken(o, i)) setOutput(null);
      const amount = params.get('exactAmount');
      if (amount && /^\d*\.?\d*$/.test(amount)) {
        setField(params.get('exactField') === 'output' ? 'exactOut' : 'exactIn');
        setTyped(amount);
      }
    });
  }, [tokens, tokensLoading, defaultInput, defaultOutput, syncUrl]);

  // First visit without a pair: the deepest pool that has QRL on one side.
  useEffect(() => {
    if (output || mode !== 'swap' || !initialized.current || defaultOutput || (syncUrl && query().get('outputCurrency'))) return;
    const prices = new Map<string, number>();
    for (const p of pools) for (const t of [p.token0, p.token1]) priceInQrl(t) !== undefined && prices.set(t.toLowerCase(), priceInQrl(t)!);
    const best = pools
      .filter((p) => sameAddress(p.token0, ADDRESSES.WQRL) || sameAddress(p.token1, ADDRESSES.WQRL))
      .map((p) => ({ p, tvl: tvlInQrl(p, prices, decimalsOf) ?? -1 }))
      .sort((a, b) => b.tvl - a.tvl)[0];
    if (!best) return;
    const t = tokenByAddress(sameAddress(best.p.token0, ADDRESSES.WQRL) ? best.p.token1 : best.p.token0);
    if (t && !sameToken(t, input)) setOutput(t);
  }, [pools, output, mode, input, tokenByAddress, priceInQrl, decimalsOf, defaultOutput, syncUrl, tokensLoading]);

  // Mirror the form into the URL without triggering a route change.
  useEffect(() => {
    if (!syncUrl || !initialized.current || mode !== 'swap') return;
    const q = new URLSearchParams();
    if (input) q.set('inputCurrency', input.native ? 'QRL' : input.address);
    if (output) q.set('outputCurrency', output.native ? 'QRL' : output.address);
    if (typed) {
      q.set('exactAmount', typed);
      if (field === 'exactOut') q.set('exactField', 'output');
    }
    const s = q.toString();
    const next = `#/swap${s ? `?${s}` : ''}`;
    if (window.location.hash !== next) window.history.replaceState(null, '', next);
  }, [syncUrl, input, output, typed, field, mode]);

  const wqrlToken = tokens.find(isWqrl) ?? null;
  const switchMode = (m: Mode) => {
    setMode(m);
    setTyped('');
    setField('exactIn');
    if (m === 'wrap') {
      const unwrap = input && isWqrl(input);
      setInput(unwrap ? wqrlToken : NATIVE);
      setOutput(unwrap ? NATIVE : wqrlToken);
    }
  };

  const balanceOf = useBalances([input, output], account);
  const wrap = input && output ? wrapKind(input, output) : null;
  const independent = field === 'exactIn' ? input : output;
  const parsed = independent ? parseUnits(typed, independent.decimals) : null;

  useEffect(() => {
    setNoRoute(false);
    if (!input || !output || wrap || !parsed) {
      setTrade(null);
      return;
    }
    let alive = true;
    setQuoting(true);
    // An exact output is quoted gross of the interface fee, so the wallet
    // still receives what was typed.
    const amount = field === 'exactOut' && fee ? grossFor(parsed, fee.bips) : parsed;
    const id = setTimeout(() => {
      quote(input, output, field, amount, decimalsOf, pools, { v2: settings.useV2, v3: settings.useV3 })
        .then((t) => {
          if (!alive) return;
          setTrade(t);
          setNoRoute(!t);
          setQuotedFor(`${field}:${typed}`);
        })
        .catch(() => alive && (setTrade(null), setNoRoute(true)))
        .finally(() => alive && setQuoting(false));
    }, 250);
    return () => {
      alive = false;
      clearTimeout(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input, output, field, parsed?.toString(), wrap, block, tokens, settings.useV2, settings.useV3]);

  const amountIn = wrap ? parsed ?? undefined : field === 'exactIn' ? parsed ?? undefined : trade?.amountIn;
  /// What the wallet receives: the trade's output less the interface fee.
  const outNet = trade ? (fee ? netOf(trade.amountOut, fee.bips) : trade.amountOut) : undefined;
  const feeAmount = trade && fee ? feeOf(trade.amountOut, fee.bips) : 0n;
  const amountOut = wrap ? parsed ?? undefined : field === 'exactOut' ? parsed ?? undefined : outNet;
  const shown = (side: TradeType, token: Token | null, value: bigint | undefined) =>
    field === side || wrap ? typed : value !== undefined && token ? toInputString(value, token.decimals, 4) : '';

  const slippage = settings.slippageBps;
  const maxIn = trade && trade.type === 'exactOut' ? applySlippage(trade.amountIn, slippage, 'up') : amountIn;
  /// The least the swap itself may return (gross, what the router checks)
  /// and what that leaves the wallet after the interface fee.
  const minOut = trade ? (trade.type === 'exactIn' ? applySlippage(trade.amountOut, slippage, 'down') : trade.amountOut) : amountOut;
  const minNet = minOut !== undefined && fee ? netOf(minOut, fee.bips) : minOut;
  const spender = SWAP_ROUTER_02 || (trade?.route.protocol === 'v3' ? ADDRESSES.SwapRouter : ADDRESSES.PauliV2Router02);

  const { allowance, refresh: refreshAllowance } = useAllowance(input && !isNative(input) && !wrap ? input.address : null, account, spender);
  const spendsToken = !!input && !isNative(input) && !wrap && maxIn !== undefined && !!trade;
  const needsApproval = spendsToken && allowance !== undefined && allowance < maxIn!;
  const checkingApproval = spendsToken && !!account && allowance === undefined;

  const inBalance = balanceOf(input);
  const outBalance = balanceOf(output);
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
    if (!wrap) setField(field === 'exactIn' ? 'exactOut' : 'exactIn');
  };
  const onMax = () => {
    if (!input || inBalance === undefined) return;
    const max = isNative(input) ? (inBalance > GAS_RESERVE ? inBalance - GAS_RESERVE : 0n) : inBalance;
    setField('exactIn');
    setTyped(toInputString(max, input.decimals, input.decimals));
  };
  const onMaxOut = () => {
    if (!output || outBalance === undefined || wrap) return;
    setField('exactOut');
    setTyped(toInputString(outBalance, output.decimals, output.decimals));
  };

  const approve = () =>
    input &&
    send({
      title: `Approve ${sym(input)}`,
      verb: 'approval',
      activity: 'Approved',
      successTitle: 'Approval confirmed',
      summary: { from: { token: input, amount: maxIn ?? 0n, label: sym(input) } },
      build: () => ({ to: input.address, method: tokenContract(input.address).methods.approve(spender, MAX_UINT256) }),
    }).then((ok) => {
      if (!ok) return;
      setApproved((a) => [...a, input.address.toLowerCase()]);
      refreshAllowance();
    });

  const executeWrap = () => {
    if (!wrap || !parsed || !input || !output) return;
    send({
      title: wrap === 'wrap' ? 'Confirm wrap' : 'Confirm unwrap',
      verb: wrap,
      activity: wrap === 'wrap' ? 'Wrapped' : 'Unwrapped',
      successTitle: wrap === 'wrap' ? 'Wrap confirmed' : 'Unwrap confirmed',
      summary: { from: { token: input, amount: parsed, label: sym(input) }, to: { token: output, amount: parsed, label: sym(output) } },
      build: () => ({ to: ADDRESSES.WQRL, method: wrap === 'wrap' ? wqrl().methods.deposit() : wqrl().methods.withdraw(parsed) }),
      value: wrap === 'wrap' ? parsed : undefined,
    }).then((ok) => ok && setTyped(''));
  };

  const swapRequest = (): TxRequest | null => {
    if (!trade || !input || !output || !account || minOut === undefined || maxIn === undefined) return null;
    const deadline = BigInt(Math.floor(Date.now() / 1000) + settings.deadlineMin * 60);
    const nativeIn = isNative(input);
    const nativeOut = isNative(output);
    return {
      title: 'Confirm swap',
      verb: 'swap',
      activity: 'Swapped',
      successTitle: 'Swap confirmed',
      prior: !nativeIn && approved.includes(input.address.toLowerCase()) ? [`Approve ${sym(input)}`] : undefined,
      summary: { from: { token: input, amount: trade.amountIn, label: sym(input) }, to: { token: output, amount: outNet ?? trade.amountOut, label: sym(output) } },
      value: nativeIn ? (trade.type === 'exactIn' ? trade.amountIn : maxIn) : undefined,
      build: () => {
        const r = trade.route;
        if (SWAP_ROUTER_02) {
          // One router for V2 and V3. The output stays in the router when it
          // is unwrapped or charged, and is paid out by the second call.
          const m = swapRouter02().methods;
          const to = nativeOut || fee ? ADDRESS_THIS : account;
          const single = r.protocol === 'v3' && r.fees.length === 1;
          const swap =
            r.protocol === 'v2'
              ? trade.type === 'exactIn'
                ? m.swapExactTokensForTokens(trade.amountIn, minOut, r.path, to)
                : m.swapTokensForExactTokens(trade.amountOut, maxIn, r.path, to)
              : trade.type === 'exactIn'
                ? single
                  ? m.exactInputSingle([r.path[0], r.path[1], r.fees[0], to, trade.amountIn, minOut, 0])
                  : m.exactInput([encodePath(r.path, r.fees), to, trade.amountIn, minOut])
                : single
                  ? m.exactOutputSingle([r.path[0], r.path[1], r.fees[0], to, trade.amountOut, maxIn, 0])
                  : m.exactOutput([encodePath([...r.path].reverse(), [...r.fees].reverse()), to, trade.amountOut, maxIn]);
          const calls: string[] = [(swap as any).encodeABI()];
          if (nativeOut) calls.push(((fee ? m.unwrapWQRL9WithFee(minOut, account, fee.bips, fee.recipient) : m.unwrapWQRL9(minOut, account)) as any).encodeABI());
          else if (fee) calls.push((m.sweepTokenWithFee(r.path[r.path.length - 1], minOut, account, fee.bips, fee.recipient) as any).encodeABI());
          if (nativeIn && trade.type === 'exactOut') calls.push((m.refundQRL() as any).encodeABI());
          return { to: SWAP_ROUTER_02, method: m.multicall(deadline, calls) };
        }
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
    };
  };

  const executeSwap = () => {
    const req = swapRequest();
    if (!req) return;
    setReviewing(false);
    send(req).then((ok) => ok && setTyped(''));
  };

  const routeText =
    trade && input && output
      ? `${trade.path.map((a, i, all) => (i === 0 && isNative(input) ? 'QRL' : i === all.length - 1 && isNative(output) ? 'QRL' : symOf(a))).join(' → ')} · ${routeTag(trade.route)}`
      : '';
  // The computed side breathes while a new amount is being quoted.
  const requoting = quoting && !!parsed && !wrap && quotedFor !== `${field}:${typed}`;
  const rateText = trade && input && output ? `1 ${sym(input)} = ${formatPrice(trade.executionPrice)} ${sym(output)}` : '';
  const impactTone = impact >= IMPACT_HIGH ? 'alert' : impact >= IMPACT_WARNING ? 'warning' : undefined;

  const cta = useMemo<Cta>(() => {
    if (!account) return { label: 'Connect wallet', kind: 'secondary', onClick: () => openModal('connect') };
    if (wrongNetwork) return { label: 'Switch to QRL Devnet', kind: 'primary', onClick: () => switchChain().catch(() => undefined) };
    if (!input || !output) return { label: 'Select a token', kind: 'disabled' };
    if (!parsed) return { label: 'Enter an amount', kind: 'disabled' };
    if (wrap) {
      if (insufficient) return { label: `Insufficient ${sym(input)} balance`, kind: 'disabled' };
      return { label: wrap === 'wrap' ? 'Wrap' : 'Unwrap', kind: 'primary', onClick: executeWrap };
    }
    if (mode === 'wrap') return { label: 'Select QRL or WQRL', kind: 'disabled' };
    if (quoting && !trade) return { label: 'Finding the best route…', kind: 'disabled', busy: true };
    if (noRoute || !trade) return { label: 'Insufficient liquidity', kind: 'disabled' };
    if (insufficient) return { label: `Insufficient ${sym(input)} balance`, kind: 'disabled' };
    if (checkingApproval) return { label: 'Checking approval…', kind: 'disabled', busy: true };
    if (needsApproval) return { label: `Approve ${sym(input)}`, kind: 'primary', onClick: approve };
    if (impact >= IMPACT_HIGH) return { label: 'Swap anyway', kind: 'danger', onClick: () => setReviewing(true) };
    return { label: 'Swap', kind: 'primary', onClick: () => setReviewing(true) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account, wrongNetwork, input, output, parsed, wrap, mode, quoting, trade, noRoute, insufficient, needsApproval, checkingApproval, impact, tokens]);

  const counter = (side: 'in' | 'out') => {
    if (wrap || !trade || !input || !output) return undefined;
    return side === 'in'
      ? `≈ ${formatAmount(outNet, output.decimals)} ${sym(output)}`
      : `Best route · ${routeTag(trade.route)}`;
  };
  const tabs = wqrlToken ? (['swap', 'wrap'] as const) : (['swap'] as const);

  return (
    <div className="swap-widget">
      <div className="swap-tabs">
        <Seg options={tabs} labels={{ swap: 'Swap', wrap: 'Wrap' }} value={mode} onChange={switchMode} />
        <span className="grow" />
        {mode === 'swap' && <span className="slip-pill">{pct(slippage)} slippage</span>}
        <SettingsButton routing={mode === 'swap'} />
      </div>
      <div className="swap-panels">
        <AmountPanel
          label="Sell"
          token={input}
          symbol={input ? sym(input) : undefined}
          amount={shown('exactIn', input, amountIn)}
          onAmount={(v) => {
            setField('exactIn');
            setTyped(v);
          }}
          onSelect={mode === 'swap' ? () => setSelecting('in') : undefined}
          sub={counter('in')}
          loading={requoting && field === 'exactOut'}
          balance={account && input && inBalance !== undefined ? formatAmount(inBalance, input.decimals, 2) : undefined}
          onMax={account && inBalance !== undefined && inBalance > 0n ? onMax : undefined}
          focus={field === 'exactIn' && !!typed}
          error={insufficient}
        />
        <button className="swap-flip" onClick={flip} aria-label="Switch tokens">
          <Icon name="arrow-down" size={20} />
        </button>
        <AmountPanel
          label="Buy"
          token={output}
          symbol={output ? sym(output) : undefined}
          amount={shown('exactOut', output, amountOut)}
          onAmount={(v) => {
            setField(wrap ? 'exactIn' : 'exactOut');
            setTyped(v);
          }}
          onSelect={mode === 'swap' ? () => setSelecting('out') : undefined}
          sub={quoting && !trade && parsed ? <Busy size={14}>Finding the best route…</Busy> : counter('out')}
          loading={requoting && field === 'exactIn'}
          balance={account && output && outBalance !== undefined ? formatAmount(outBalance, output.decimals, 2) : undefined}
          onMax={account && !wrap && outBalance !== undefined && outBalance > 0n ? onMaxOut : undefined}
          focus={field === 'exactOut' && !!typed && !wrap}
        />
      </div>
      <button className={`btn btn-lg btn-block btn-${cta.kind === 'disabled' ? 'tertiary' : cta.kind}`} disabled={cta.kind === 'disabled'} onClick={cta.onClick} aria-busy={cta.busy || undefined}>
        {cta.busy && <Icon name="loader" size={20} className="spin c-quantum" />}
        {cta.label}
      </button>
      {trade && input && output && !wrap && (
        <div className="swap-details">
          <button className="rate-row" onClick={() => setDetailsOpen((o) => !o)} aria-expanded={detailsOpen}>
            <span className="t-num-strong grow">{rateText}</span>
            <Icon name={detailsOpen ? 'chevron-up' : 'chevron-down'} size={18} className="c-3" />
          </button>
          {detailsOpen && (
            <>
              <DetailRow label="Price impact" info="How much this trade moves the pool price, excluding the LP fee." value={formatPercent(impact)} tone={impactTone} />
              {trade.type === 'exactIn' ? (
                <DetailRow label="Minimum received" info="The least you receive before the trade reverts." value={`${formatAmount(minNet, output.decimals)} ${sym(output)}`} />
              ) : (
                <DetailRow label="Maximum sent" info="The most you spend before the trade reverts." value={`${formatAmount(maxIn, input.decimals)} ${sym(input)}`} />
              )}
              <DetailRow label="LP fee" info="Paid to liquidity providers on every hop." value={`${formatAmount(trade.lpFee, input.decimals)} ${sym(input)}`} />
              {fee && <InterfaceFeeRow amount={feeAmount} token={output} symbol={sym(output)} />}
              <DetailRow label="Route" info="The pools this trade goes through." value={routeText} />
            </>
          )}
        </div>
      )}
      {selecting && (
        <TokenSelectModal selected={selecting === 'in' ? input : output} other={selecting === 'in' ? output : input} onSelect={selectToken} onClose={() => setSelecting(null)} />
      )}
      {reviewing && trade && input && output && (
        <ReviewModal
          trade={trade}
          input={input}
          output={output}
          inBalance={inBalance}
          minOut={minNet}
          outNet={outNet ?? trade.amountOut}
          feeAmount={feeAmount}
          maxIn={maxIn}
          rateText={rateText}
          routeText={routeText}
          impactTone={impactTone}
          request={swapRequest}
          onConfirm={executeSwap}
          onClose={() => setReviewing(false)}
        />
      )}
    </div>
  );
}

/// You're swapping (91:905).
function ReviewModal({
  trade,
  input,
  output,
  inBalance,
  minOut,
  outNet,
  feeAmount,
  maxIn,
  rateText,
  routeText,
  impactTone,
  request,
  onConfirm,
  onClose,
}: {
  trade: Trade;
  input: Token;
  output: Token;
  inBalance: bigint | undefined;
  minOut: bigint | undefined;
  outNet: bigint;
  feeAmount: bigint;
  maxIn: bigint | undefined;
  rateText: string;
  routeText: string;
  impactTone?: 'warning' | 'alert';
  request: () => TxRequest | null;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { settings } = useApp();
  const { account } = useWallet();
  const { sym } = useNames();
  const [gasCost, setGasCost] = useState<bigint | null | undefined>(undefined);

  // Network cost: the swap's gas estimate at the node's current gas price.
  useEffect(() => {
    const req = request();
    if (!req || !account) return setGasCost(null);
    let alive = true;
    const { method } = req.build();
    Promise.all([method.estimateGas({ from: account, value: req.value ?? 0n }), reader.qrl.getGasPrice()])
      .then(([gas, price]) => alive && setGasCost(BigInt(gas) * BigInt(price)))
      .catch(() => alive && setGasCost(null));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const spent = trade.type === 'exactIn' ? trade.amountIn : maxIn ?? trade.amountIn;
  const after = inBalance !== undefined ? (inBalance > spent ? inBalance - spent : 0n) : undefined;

  return (
    <Modal title="You're swapping" onClose={onClose} center>
      <div className="review">
        <div className="review-amount">
          <span className="col grow" style={{ gap: 2, minWidth: 0 }}>
            <span className="t-amount ellipsis">
              {formatAmount(trade.amountIn, input.decimals)} {sym(input)}
            </span>
            <span className="t-num c-3">
              {after !== undefined ? `Balance after: ${formatAmount(after, input.decimals, 2)} ${sym(input)}` : trade.type === 'exactOut' ? `Maximum ${formatAmount(maxIn, input.decimals)} ${sym(input)}` : ''}
            </span>
          </span>
          <TokenIcon token={input} size={40} />
        </div>
        <Icon name="arrow-down" size={20} className="c-3" />
        <div className="review-amount">
          <span className="col grow" style={{ gap: 2, minWidth: 0 }}>
            <span className="t-amount ellipsis">
              {formatAmount(outNet, output.decimals)} {sym(output)}
            </span>
            <span className="t-num c-3">{trade.type === 'exactIn' ? `Minimum ${formatAmount(minOut, output.decimals)} ${sym(output)}` : 'Exact amount'}</span>
          </span>
          <TokenIcon token={output} size={40} />
        </div>
        <hr className="divider" />
        <DetailRow label="Rate" info="Execution price of this trade." value={rateText} />
        <DetailRow label="Price impact" info="How much this trade moves the pool price, excluding the LP fee." value={formatPercent(trade.priceImpact)} tone={impactTone} />
        <DetailRow label="Max slippage" info="The trade reverts if the price moves against you by more than this." value={`${settings.slippageAuto ? 'Auto · ' : ''}${(settings.slippageBps / 100).toFixed(2)}%`} />
        <DetailRow label="LP fee" info="Paid to liquidity providers on every hop." value={`${formatAmount(trade.lpFee, input.decimals)} ${sym(input)}`} />
        {fee && <InterfaceFeeRow amount={feeAmount} token={output} symbol={sym(output)} />}
        <DetailRow label="Route" info="The pools this trade goes through." value={routeText} />
        <DetailRow
          label="Network cost"
          info="Gas estimate at the node's current gas price."
          value={gasCost === undefined ? <Busy size={14}>Estimating…</Busy> : gasCost === null ? '—' : `≈ ${formatAmount(gasCost, 18)} QRL`}
        />
        <button className={`btn btn-lg btn-block ${impactTone === 'alert' ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm}>
          {impactTone === 'alert' ? 'Swap anyway' : 'Confirm swap'}
        </button>
      </div>
    </Modal>
  );
}

/// The interface fee row of the details and the review.
function InterfaceFeeRow({ amount, token, symbol }: { amount: bigint; token: Token; symbol: string }) {
  return (
    <DetailRow
      label={`Interface fee (${((fee?.bips ?? 0) / 100).toFixed(2)}%)`}
      info="Charged by this interface on what you receive. Calling the PauliSwap contracts directly only costs the pool's LP fee."
      value={`${formatAmount(amount, token.decimals)} ${symbol}`}
    />
  );
}
