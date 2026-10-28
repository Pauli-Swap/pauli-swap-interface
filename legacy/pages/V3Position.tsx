import { useEffect, useMemo, useState } from 'react';
import { NoteBar, SubBar } from '../components/Header';
import { Banner, DetailRow, Empty, Icon, Seg, Stat, Status, TokenField, TokenIcon, TokenPairIcon } from '../components/ui';
import { ADDRESSES, CHAIN, MAX_UINT256 } from '../config';
import { useAllowance, useBalances } from '../hooks/chain';
import { usePoolStats } from '../hooks/market';
import { useNames } from '../hooks/names';
import { useV3Position } from '../hooks/v3';
import { ABI, positionManager, sameAddress, shortAddress, token as tokenContract, ZERO_ADDRESS } from '../lib/chain';
import { applySlippage, formatAmount, formatPercent, formatPrice, parseUnits, timeAgo, toFloat, toInputString } from '../lib/format';
import devnet from '../contracts/devnet.json';
import { getEvents, uintTopic } from '../lib/logs';
import { tvlInQrl } from '../lib/registry';
import { go } from '../lib/router';
import { NATIVE, Token } from '../lib/tokens';
import { amountsForLiquidity, dependentAmount, feeLabel, MAX_UINT128, priceFromTick, sqrtRatioAtTick } from '../lib/v3';
import { useApp } from '../state/app';
import { useTx } from '../state/tx';
import { useWallet } from '../state/wallet';
import { PositionsRail } from './Markets';

type HistoryRow = { kind: 'Increased liquidity' | 'Removed liquidity' | 'Collected fees'; amount0: bigint; amount1: bigint; block: number; hash: string };

export function V3Position({ id }: { id: string }) {
  const { tokenByAddress, decimalsOf, priceInQrl, settings, block, blockTime, openModal } = useApp();
  const { account, wrongNetwork, switchChain } = useWallet();
  const { send } = useTx();
  const { symOf } = useNames();
  const { position: p, owner, error } = useV3Position(id, account);
  const [mode, setMode] = useState<'Increase' | 'Remove'>('Remove');
  const [pct, setPct] = useState(50);
  const [asNative, setAsNative] = useState(true);
  const [closeAfter, setCloseAfter] = useState(true);
  const [typed, setTyped] = useState<{ side: 0 | 1; value: string }>({ side: 0, value: '' });
  const [inverted, setInverted] = useState(false);
  const [history, setHistory] = useState<HistoryRow[]>([]);

  useEffect(() => {
    let alive = true;
    getEvents(ABI.npm, ADDRESSES.NonfungiblePositionManager, ['IncreaseLiquidity', 'DecreaseLiquidity', 'Collect'], devnet.startBlock, 'latest', uintTopic(id)).catch(() => []).then((all) => {
      const of = (name: string) => all.filter((e) => e.event === name);
      const [inc, dec, col] = [of('IncreaseLiquidity'), of('DecreaseLiquidity'), of('Collect')];
      if (!alive) return;
      const rows: HistoryRow[] = [
        ...inc.map((e: any) => ({ kind: 'Increased liquidity' as const, amount0: BigInt(e.returnValues.amount0), amount1: BigInt(e.returnValues.amount1), block: Number(e.blockNumber), hash: e.transactionHash })),
        ...dec.map((e: any) => ({ kind: 'Removed liquidity' as const, amount0: BigInt(e.returnValues.amount0), amount1: BigInt(e.returnValues.amount1), block: Number(e.blockNumber), hash: e.transactionHash })),
        ...col.map((e: any) => ({ kind: 'Collected fees' as const, amount0: BigInt(e.returnValues.amount0), amount1: BigInt(e.returnValues.amount1), block: Number(e.blockNumber), hash: e.transactionHash })),
      ].filter((r) => String(r.block) !== 'NaN');
      setHistory(rows.sort((a, b) => b.block - a.block));
    });
    return () => {
      alive = false;
    };
  }, [id, block]);

  const pool = p?.pool ?? null;
  const t0 = p ? tokenByAddress(p.token0) : undefined;
  const t1 = p ? tokenByAddress(p.token1) : undefined;
  const wq0 = !!p && sameAddress(p.token0, ADDRESSES.WQRL);
  const wq1 = !!p && sameAddress(p.token1, ADDRESSES.WQRL);
  const hasWqrl = wq0 || wq1;
  // The token objects the user deposits/receives: WQRL shows as native QRL.
  const in0: Token | undefined = wq0 ? NATIVE : t0;
  const in1: Token | undefined = wq1 ? NATIVE : t1;
  const d0 = p ? decimalsOf(p.token0) : 18;
  const d1 = p ? decimalsOf(p.token1) : 18;
  const s0 = wq0 ? 'QRL' : symOf(p?.token0);
  const s1 = wq1 ? 'QRL' : symOf(p?.token1);
  const isOwner = !!account && !!owner && sameAddress(account, owner);

  const lo = p ? priceFromTick(p.tickLower, d0, d1) : 0;
  const hi = p ? priceFromTick(p.tickUpper, d0, d1) : 0;
  const cur = pool ? priceFromTick(pool.tick, d0, d1) : 0;
  const view = (v: number) => (inverted ? (v > 0 ? 1 / v : 0) : v);
  const [vMin, vMax] = inverted ? [view(hi), view(lo)] : [lo, hi];
  const vCur = view(cur);
  const unit = inverted ? `${s0} per ${s1}` : `${s1} per ${s0}`;
  const full = !!p && p.tickLower <= -887000 && p.tickUpper >= 887000;
  const curPos = vMax > vMin ? Math.min(1, Math.max(0, (vCur - vMin) / (vMax - vMin))) : 0.5;

  const value = (a0: bigint, a1: bigint) => {
    const p0 = p ? priceInQrl(p.token0) : undefined;
    const p1 = p ? priceInQrl(p.token1) : undefined;
    return p0 === undefined || p1 === undefined ? null : toFloat(a0, d0) * p0 + toFloat(a1, d1) * p1;
  };
  const posValue = p ? value(p.amount0, p.amount1) : null;
  const feeValue = p ? value(p.fees0, p.fees1) : null;
  const statPools = useMemo(() => (pool ? [pool] : []), [pool?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const stats = usePoolStats(statPools, '24h', (x) => {
    const m = new Map<string, number>();
    for (const t of [x.token0, x.token1]) { const v = priceInQrl(t); if (v !== undefined) m.set(t.toLowerCase(), v); }
    return tvlInQrl(x, m, decimalsOf);
  });
  const poolApr = pool ? stats.get(pool.id)?.feeApr ?? null : null;
  const activeShare = p && pool && p.status === 'in' && pool.liquidity > 0n ? Number((p.liquidity * 10_000n) / pool.liquidity) / 10_000 : null;

  // Increase
  const typedToken = typed.side === 0 ? in0 : in1;
  const typedAmount = typedToken ? parseUnits(typed.value, typedToken.decimals) : null;
  const other = p && pool && typedAmount ? dependentAmount(typed.side, typedAmount, pool.sqrtPriceX96, p.tickLower, p.tickUpper) : 0n;
  const inc0 = typed.side === 0 ? typedAmount ?? 0n : other;
  const inc1 = typed.side === 1 ? typedAmount ?? 0n : other;
  const below = !!p && !!pool && pool.tick < p.tickLower;
  const above = !!p && !!pool && pool.tick >= p.tickUpper;
  const balanceOf = useBalances([in0, in1], account);
  const allow0 = useAllowance(p && !wq0 ? p.token0 : null, account, ADDRESSES.NonfungiblePositionManager);
  const allow1 = useAllowance(p && !wq1 ? p.token1 : null, account, ADDRESSES.NonfungiblePositionManager);
  const need0 = !wq0 && inc0 > 0n && allow0.allowance !== undefined && allow0.allowance < inc0;
  const need1 = !wq1 && inc1 > 0n && allow1.allowance !== undefined && allow1.allowance < inc1;

  // Remove
  const removeLiquidity = p ? (p.liquidity * BigInt(pct)) / 100n : 0n;
  const [out0, out1] = p && pool ? amountsForLiquidity(pool.sqrtPriceX96, sqrtRatioAtTick(p.tickLower), sqrtRatioAtTick(p.tickUpper), removeLiquidity) : [0n, 0n];

  const deadline = () => BigInt(Math.floor(Date.now() / 1000) + settings.deadlineMin * 60);
  const npm = positionManager();
  const collectCalls = (min0: bigint, min1: bigint) => {
    if (!account || !p) return [];
    const unwrap = hasWqrl && asNative;
    const calls = [(npm.methods.collect([id, unwrap ? ZERO_ADDRESS : account, MAX_UINT128, MAX_UINT128]) as any).encodeABI()];
    if (unwrap) {
      calls.push((npm.methods.unwrapWQRL9(wq0 ? min0 : min1, account) as any).encodeABI());
      calls.push((npm.methods.sweepToken(wq0 ? p.token1 : p.token0, wq0 ? min1 : min0, account) as any).encodeABI());
    }
    return calls;
  };

  const collect = () =>
    p &&
    send({
      title: 'Collect fees',
      activity: `Collected ${formatAmount(p.fees0, d0)} ${s0} + ${formatAmount(p.fees1, d1)} ${s1} fees`,
      successTitle: 'Fees collected',
      build: () => {
        const calls = collectCalls(0n, 0n);
        return { to: ADDRESSES.NonfungiblePositionManager, method: calls.length === 1 ? npm.methods.collect([id, account, MAX_UINT128, MAX_UINT128]) : npm.methods.multicall(calls) };
      },
    });

  const remove = () => {
    if (!p || !account) return;
    const slip = settings.slippageBps;
    const min0 = applySlippage(out0, slip, 'down');
    const min1 = applySlippage(out1, slip, 'down');
    const closing = pct === 100 && closeAfter;
    send({
      title: closing ? 'Remove and close position' : `Remove ${pct}% of liquidity`,
      activity: `Removed ${pct}% of ${s0} / ${s1} V3 #${id}`,
      successTitle: 'Liquidity removed',
      successText: `You received about ${formatAmount(out0 + p.fees0, d0)} ${s0} and ${formatAmount(out1 + p.fees1, d1)} ${s1}, fees included.`,
      build: () => {
        const calls = [(npm.methods.decreaseLiquidity([id, removeLiquidity, min0, min1, deadline()]) as any).encodeABI(), ...collectCalls(min0, min1)];
        if (closing) calls.push((npm.methods.burn(id) as any).encodeABI());
        return { to: ADDRESSES.NonfungiblePositionManager, method: npm.methods.multicall(calls) };
      },
    });
  };

  const increase = () => {
    if (!p) return;
    const slip = settings.slippageBps;
    const native = wq0 ? inc0 : wq1 ? inc1 : 0n;
    send({
      title: 'Increase liquidity',
      activity: `Added ${formatAmount(inc0, d0)} ${s0} + ${formatAmount(inc1, d1)} ${s1} to V3 #${id}`,
      successTitle: 'Liquidity added',
      value: native || undefined,
      build: () => {
        const params = [id, inc0, inc1, applySlippage(inc0, slip, 'down'), applySlippage(inc1, slip, 'down'), deadline()];
        if (!native) return { to: ADDRESSES.NonfungiblePositionManager, method: npm.methods.increaseLiquidity(params) };
        return { to: ADDRESSES.NonfungiblePositionManager, method: npm.methods.multicall([(npm.methods.increaseLiquidity(params) as any).encodeABI(), (npm.methods.refundQRL() as any).encodeABI()]) };
      },
    }).then((ok) => ok && setTyped({ side: 0, value: '' }));
  };
  const approve = (address: string, label: string, refresh: () => void) =>
    send({
      title: `Approve ${label}`,
      activity: `Approved ${label} for the position manager`,
      successTitle: 'Approval confirmed',
      build: () => ({ to: address, method: tokenContract(address).methods.approve(ADDRESSES.NonfungiblePositionManager, MAX_UINT256) }),
    }).then((ok) => ok && refresh());

  if (error) {
    return (
      <div className="body">
        <PositionsRail />
        <main className="canvas">
          <Empty icon="alert-triangle" title={`Position #${id} not found`}>
            It may have been closed, or the id belongs to another deployment.
          </Empty>
        </main>
      </div>
    );
  }
  if (!p) {
    return (
      <div className="body">
        <PositionsRail selected={`v3-${id}`} />
        <main className="canvas">
          <span className="c-3">Loading position #{id}…</span>
        </main>
      </div>
    );
  }

  const manageGate = !account ? { label: 'Connect wallet', onClick: () => openModal('connect') } : wrongNetwork ? { label: 'Switch to QRL Devnet', onClick: () => switchChain().catch(() => undefined) } : !isOwner ? { label: 'Only the owner can manage this position' } : null;

  return (
    <>
      <SubBar
        context={`${s0} / ${s1} · V3 position #${id}`}
        detail={`${feeLabel(p.fee)} · ticks ${p.tickLower.toLocaleString('en-US')} → ${p.tickUpper.toLocaleString('en-US')}`}
        meta={`Owner ${owner ? shortAddress(owner) : '…'}${pool ? ` · pool ${shortAddress(pool.address)}` : ''}`}
        action={CHAIN.explorerUrl && owner ? { label: 'View on explorer', icon: 'external-link', onClick: () => window.open(`${CHAIN.explorerUrl}/address/${owner}`, '_blank') } : { label: 'All pools', icon: 'arrow-left', onClick: () => go({ page: 'pool' }) }}
      />
      <div className="body">
        <PositionsRail selected={`v3-${id}`} />
        <main className="canvas">
          <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
            <TokenPairIcon a={in0} b={in1} size={32} />
            <span className="t-title">
              {s0} / {s1}
            </span>
            <span className="badge badge-quantum">V3</span>
            <span className="badge badge-neutral">{feeLabel(p.fee)} fee</span>
            <Status kind={p.status}>{p.status === 'in' ? 'In range' : p.status === 'out' ? 'Out of range' : 'Closed'}</Status>
            <span className="grow" />
            <button className="btn btn-md btn-secondary" onClick={() => setMode('Remove')} disabled={p.liquidity === 0n}>
              Remove
            </button>
            <button className="btn btn-md btn-primary" onClick={() => setMode('Increase')}>
              Increase liquidity
            </button>
          </div>
          <div className="stats">
            <Stat label="Position value" value={posValue != null ? `${formatPrice(posValue)} QRL` : '—'} note={`${formatAmount(p.amount0, d0)} ${s0} + ${formatAmount(p.amount1, d1)} ${s1}`} />
            <Stat label="Uncollected fees" value={feeValue != null ? `${formatPrice(feeValue)} QRL` : '—'} note={`${formatAmount(p.fees0, d0)} ${s0} + ${formatAmount(p.fees1, d1)} ${s1}`} />
            <Stat label="Pool fee APR (24h)" value={poolApr != null ? formatPercent(poolApr, 1) : '—'} note={poolApr == null ? 'needs an hour of history' : 'all positions in the pool'} noteTone="muted" />
            <Stat label="Share of active liquidity" value={activeShare != null ? formatPercent(activeShare) : '—'} note={p.status === 'in' ? 'earning fees now' : p.status === 'out' ? 'not earning: price outside range' : 'no liquidity'} noteTone={p.status === 'out' ? 'alert' : 'quantum'} />
          </div>

          <section className="panel">
            <div className="row" style={{ flexWrap: 'wrap' }}>
              <span className="t-heading">Price range</span>
              <button className="unit-chip" onClick={() => setInverted((v) => !v)}>
                {unit} <Icon name="arrow-up-down" size={14} />
              </button>
              <span className="grow" />
              <span className="t-label c-3">
                {full ? 'Full range position' : p.status === 'in' ? `Current price is ${Math.round(curPos * 100)}% into your range` : p.status === 'out' ? (vCur < vMin ? 'Price is below your range' : 'Price is above your range') : 'Position closed'}
              </span>
            </div>
            <div className="range-track">
              <svg width="100%" height="56" style={{ display: 'block' }}>
                <rect x="0" y="24" width="100%" height="8" rx="4" fill="#fff" fillOpacity="0.06" />
                <rect x="20%" y="24" width="60%" height="8" rx="4" fill="var(--quantum)" fillOpacity="0.35" />
                <rect x="calc(20% - 2px)" y="16" width="4" height="24" rx="2" fill="var(--quantum)" style={{ transform: 'translateX(-2px)' }} />
                <rect x="80%" y="16" width="4" height="24" rx="2" fill="var(--quantum)" style={{ transform: 'translateX(-2px)' }} />
                {pool && (
                  <>
                    <line x1={`${(0.2 + 0.6 * Math.min(1.33, Math.max(-0.33, vMax > vMin ? (vCur - vMin) / (vMax - vMin) : 0.5))) * 100}%`} x2={`${(0.2 + 0.6 * Math.min(1.33, Math.max(-0.33, vMax > vMin ? (vCur - vMin) / (vMax - vMin) : 0.5))) * 100}%`} y1="8" y2="48" stroke="var(--text-primary)" strokeWidth="2" />
                    <circle cx={`${(0.2 + 0.6 * Math.min(1.33, Math.max(-0.33, vMax > vMin ? (vCur - vMin) / (vMax - vMin) : 0.5))) * 100}%`} cy="28" r="6" fill="var(--bg-deep)" stroke="var(--text-primary)" strokeWidth="2" />
                  </>
                )}
              </svg>
            </div>
            <div className="between" style={{ alignItems: 'flex-start' }}>
              <span className="col" style={{ gap: 2 }}>
                <span className="t-caption c-3">Min price</span>
                <span className="t-mono-strong c-quantum-bright">{full ? '0' : formatPrice(vMin)}</span>
                <span className="t-caption c-4">{full ? '' : `${formatPercent(vMin / vCur - 1)} · all ${inverted ? s0 : s1} below`}</span>
              </span>
              <span className="col" style={{ gap: 2, alignItems: 'center' }}>
                <span className="t-caption c-3">Current price</span>
                <span className="t-mono-strong">{formatPrice(vCur)}</span>
                <span className="t-caption c-4">block {block.toLocaleString('en-US')}</span>
              </span>
              <span className="col" style={{ gap: 2, alignItems: 'flex-end' }}>
                <span className="t-caption c-3">Max price</span>
                <span className="t-mono-strong c-quantum-bright">{full ? '∞' : formatPrice(vMax)}</span>
                <span className="t-caption c-4">{full ? '' : `${formatPercent(vMax / vCur - 1)} · all ${inverted ? s1 : s0} above`}</span>
              </span>
            </div>
          </section>

          <section className="panel" style={{ gap: 0 }}>
            <div className="between" style={{ paddingBottom: 10 }}>
              <span className="t-heading">Position history</span>
              <span className="t-caption c-4">from the position manager events</span>
            </div>
            {history.length === 0 && <span className="t-body c-3" style={{ padding: '10px 0' }}>No events yet.</span>}
            {history.slice(0, 8).map((r) => (
              <div className="history-row" key={`${r.hash}-${r.kind}`}>
                <span className="dot" style={{ background: r.kind === 'Collected fees' ? 'var(--quantum)' : 'var(--text-secondary)' }} />
                <span className="t-body-strong grow">{r.kind}</span>
                <span className="t-mono c-2">
                  {r.kind === 'Removed liquidity' ? '−' : '+'}
                  {formatAmount(r.amount0, d0)} {s0} · {formatAmount(r.amount1, d1)} {s1}
                </span>
                <span className="t-mono c-4">{timeAgo(blockTime(r.block) * 1000)} ago</span>
              </div>
            ))}
          </section>
        </main>

        <aside className="inspector after">
          <section className="card" style={{ padding: 16, gap: 12 }}>
            <div className="between">
              <span className="t-heading">Uncollected fees</span>
              <span className="t-mono-strong c-quantum">{feeValue != null ? `${formatPrice(feeValue)} QRL` : '—'}</span>
            </div>
            {[
              [in0, p.fees0, d0, s0],
              [in1, p.fees1, d1, s1],
            ].map(([t, amt, d, s]) => (
              <div key={String(s)} className="field" style={{ flexDirection: 'row', alignItems: 'center', padding: '10px 12px' }}>
                <TokenIcon token={t as Token} size={24} />
                <span className="t-body-strong grow">{s as string}</span>
                <span className="t-mono-strong">{formatAmount(amt as bigint, d as number, 6)}</span>
              </div>
            ))}
            {hasWqrl && (
              <label className="row t-label c-2" style={{ cursor: 'pointer' }}>
                <button className={`switch ${asNative ? 'on' : ''}`} onClick={() => setAsNative((v) => !v)} aria-pressed={asNative} aria-label="Receive QRL instead of WQRL" />
                Receive QRL instead of WQRL
              </label>
            )}
            {manageGate ? (
              <button className="btn btn-lg btn-primary" disabled={!manageGate.onClick} onClick={manageGate.onClick}>
                {manageGate.label}
              </button>
            ) : (
              <button className="btn btn-lg btn-primary" disabled={p.fees0 === 0n && p.fees1 === 0n} onClick={collect}>
                Collect fees
              </button>
            )}
          </section>

          <section className="card" style={{ padding: 16, gap: 12 }}>
            <Seg options={['Remove', 'Increase'] as const} value={mode} onChange={setMode} fill />
            {mode === 'Remove' ? (
              <>
                <div className="between">
                  <span className="t-heading">Remove liquidity</span>
                  <span className="big-pct">{pct}%</span>
                </div>
                <input className="slider" type="range" min={1} max={100} value={pct} onChange={(e) => setPct(Number(e.target.value))} style={{ ['--pct' as string]: `${pct}%` }} aria-label="Percent to remove" />
                <Seg options={['25%', '50%', '75%', 'Max'] as const} value={pct === 100 ? 'Max' : (`${pct}%` as '25%')} onChange={(v) => setPct(v === 'Max' ? 100 : Number(v.replace('%', '')))} fill />
                <div className="details" style={{ padding: 0 }}>
                  <DetailRow label={`You receive ${s0}`} value={`${formatAmount(out0, d0)} + ${formatAmount(p.fees0, d0)} fees`} />
                  <DetailRow label={`You receive ${s1}`} value={`${formatAmount(out1, d1)} + ${formatAmount(p.fees1, d1)} fees`} />
                  {hasWqrl && <DetailRow label="Receive as" value={asNative ? 'QRL (unwrap WQRL)' : 'WQRL'} />}
                </div>
                {pct === 100 && (
                  <label className="row t-label c-2" style={{ cursor: 'pointer' }}>
                    <button className={`switch ${closeAfter ? 'on' : ''}`} onClick={() => setCloseAfter((v) => !v)} aria-pressed={closeAfter} aria-label="Close the position" />
                    Close the position and burn the NFT
                  </label>
                )}
                {manageGate ? (
                  <button className="btn btn-lg btn-secondary" disabled={!manageGate.onClick} onClick={manageGate.onClick}>
                    {manageGate.label}
                  </button>
                ) : (
                  <button className="btn btn-lg btn-secondary" disabled={p.liquidity === 0n} onClick={remove}>
                    Remove {pct}% and collect
                  </button>
                )}
              </>
            ) : (
              <>
                <span className="t-heading">Increase liquidity</span>
                {p.status === 'out' && <Banner tone="warning">The price is outside your range, so only {below ? s0 : s1} can be added and it will not earn fees until the price returns.</Banner>}
                <div className="stack">
                  <TokenField
                    label={s0}
                    token={in0 ?? null}
                    symbol={s0}
                    amount={above ? '0' : typed.side === 0 ? typed.value : inc0 ? toInputString(inc0, d0) : ''}
                    readOnly={above}
                    onAmount={(v) => setTyped({ side: 0, value: v })}
                    balance={account ? formatAmount(balanceOf(in0), d0) : undefined}
                    focus={typed.side === 0}
                  />
                  <span className="float-btn" style={{ top: 'calc(50% - 21px)' }}>
                    <Icon name="plus" size={18} />
                  </span>
                  <TokenField
                    label={s1}
                    token={in1 ?? null}
                    symbol={s1}
                    amount={below ? '0' : typed.side === 1 ? typed.value : inc1 ? toInputString(inc1, d1) : ''}
                    readOnly={below}
                    onAmount={(v) => setTyped({ side: 1, value: v })}
                    balance={account ? formatAmount(balanceOf(in1), d1) : undefined}
                    focus={typed.side === 1}
                  />
                </div>
                {manageGate ? (
                  <button className="btn btn-lg btn-primary" disabled={!manageGate.onClick} onClick={manageGate.onClick}>
                    {manageGate.label}
                  </button>
                ) : need0 ? (
                  <button className="btn btn-lg btn-primary" onClick={() => approve(p.token0, s0, allow0.refresh)}>
                    Approve {s0}
                  </button>
                ) : need1 ? (
                  <button className="btn btn-lg btn-primary" onClick={() => approve(p.token1, s1, allow1.refresh)}>
                    Approve {s1}
                  </button>
                ) : (
                  <button
                    className="btn btn-lg btn-primary"
                    disabled={(inc0 === 0n && inc1 === 0n) || (balanceOf(in0) ?? 0n) < inc0 || (balanceOf(in1) ?? 0n) < inc1}
                    onClick={increase}
                  >
                    {(balanceOf(in0) ?? 0n) < inc0 || (balanceOf(in1) ?? 0n) < inc1 ? 'Insufficient balance' : 'Add liquidity'}
                  </button>
                )}
              </>
            )}
          </section>
        </aside>
      </div>
      <NoteBar>Fees accrue inside the pool and are paid out when you collect or remove. Out of range positions stop earning until the price returns.</NoteBar>
    </>
  );
}
