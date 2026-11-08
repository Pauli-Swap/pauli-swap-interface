import { Dispatch, ReactNode, SetStateAction, useMemo, useState } from 'react';
import { AreaChart, stampLabel } from '../components/Chart';
import { dateLabel, longSpan, NotDeployed, span, utcTime, XP_TOKEN } from '../components/predict';
import { AmountPanel, Badge, Crumbs, DetailRow, Empty, explorerHref, Icon, IconButton, InfoTip, Seg, Stat } from '../components/ui';
import { PREDICT } from '../config';
import { MarketAdmin, ResolvePanel, useSettle } from '../components/PredictAdmin';
import { MarketView, Position, useIsMarketOwner, useMarkets, usePosition, usePredictLogs, useXp } from '../hooks/predict';
import { predictMarket, shortAddress } from '../lib/chain';
import { DecodedEvent } from '../lib/logs';
import { applySlippage, parseUnits, toInputString } from '../lib/format';
import { load, save } from '../lib/storage';
import { CANCELLED, costBasis, DUST_SHARES, fmtChance, fmtPrice, fmtXp, holdings, MARKET_RULES, NO, ONE_XP, OPEN, Outcome, payees, quoteBuy, RESOLVED, sellQuote, XP_DECIMALS, xpFloat, YES } from '../lib/predict';
import { Token } from '../lib/tokens';
import { href, query } from '../lib/router';
import { useApp } from '../state/app';
import { useTx } from '../state/tx';
import { useWallet } from '../state/wallet';
import { sharePage } from './TokenDetail';

const RANGES = { '1D': 86400, '1W': 7 * 86400, '1M': 30 * 86400, All: Infinity } as const;
type Range = keyof typeof RANGES;
const WATCH_KEY = 'acorn.predict.watch';

/// Predict · Market (114:4903) and its guest variant (114:5151).
export function PredictMarket({ id }: { id: string }) {
  const logs = usePredictLogs();
  const markets = useMarkets(logs.market);
  const n = Number(id);
  const market = markets?.find((m) => m.id === n);
  const crumbs = (
    <Crumbs
      items={[
        { label: 'Predict', href: href({ page: 'predict', tab: 'markets' }) },
        { label: 'Markets', href: href({ page: 'predict', tab: 'markets' }) },
        { label: `#${id}` },
      ]}
    />
  );
  if (!PREDICT.deployed)
    return (
      <main className="page pm-page">
        {crumbs}
        <NotDeployed />
      </main>
    );
  if (!market)
    return (
      <main className="page pm-page">
        {crumbs}
        {markets ? (
          <Empty icon="alert-triangle" title="Market not found">
            PredictMarket has no market #{id}.
          </Empty>
        ) : (
          <Empty icon="loader" title="Loading market…" />
        )}
      </main>
    );
  return (
    <main className="page pm-page">
      {crumbs}
      <MarketDetail m={market} log={logs.market} />
    </main>
  );
}

/// The trade panel's inputs, held here so "Sell" on a position row can fill it.
/// `exact` is the precise amount behind a chip (Max, 50%…); typing clears it.
type TradeForm = { mode: 'buy' | 'sell'; outcome: Outcome; amount: string; exact: bigint | null };

function MarketDetail({ m, log }: { m: MarketView; log: DecodedEvent[] | null }) {
  const { clock, blockTime } = useApp();
  const { account } = useWallet();
  const position = usePosition(m.id, account);
  const [form, setForm] = useState<TradeForm>(() => ({ mode: 'buy', outcome: query().get('outcome') === 'no' ? NO : YES, amount: '', exact: null }));
  const [range, setRange] = useState<Range>('All');
  const [watched, setWatched] = useState(() => load<number[]>(WATCH_KEY, []).includes(m.id));
  const now = clock.latestTime;
  const points = useMemo(() => {
    const from = now - RANGES[range];
    const inside = m.history.filter((p) => p.t >= from);
    // Start the window at the price that held when it opened.
    const before = m.history.filter((p) => p.t < from).pop();
    return before && inside.length ? [{ t: from, v: before.v }, ...inside] : inside;
  }, [m.history, range, now]);
  const change = m.price24h === null ? null : (m.price - m.price24h) * 100;
  const toggleWatch = () => {
    const list = load<number[]>(WATCH_KEY, []).filter((x) => x !== m.id);
    if (!watched) list.push(m.id);
    save(WATCH_KEY, list);
    setWatched(!watched);
  };
  const rule = MARKET_RULES[m.question];
  const status =
    m.status === RESOLVED ? `Resolved ${m.outcome === YES ? 'Yes' : 'No'}` : m.status === CANCELLED ? 'Cancelled' : m.closeTime <= now ? 'Closed, awaiting result' : 'Open';

  return (
    <div className="pm-detail">
      <div className="pm-main">
        <div className="col" style={{ gap: 8 }}>
          <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
            <h1>{m.question}</h1>
            <div className="row" style={{ gap: 4 }}>
              <IconButton icon="star" label={watched ? 'Remove from watchlist' : 'Add to watchlist'} onClick={toggleWatch} filled={watched} size={18} />
              <IconButton icon="share" label="Copy link" onClick={sharePage} size={18} />
            </div>
          </div>
          <span className="t-body c-3" style={{ whiteSpace: 'pre' }}>
            {`#${m.id}  ·  ${m.status === OPEN && m.closeTime > now ? `Ends ${dateLabel(m.closeTime)}` : status}  ·  ${fmtXp(m.volume, { compact: true })} volume`}
          </span>
        </div>
        <div className="pm-chance">
          {m.status === OPEN ? (
            <div className="row" style={{ alignItems: 'baseline', gap: 8 }}>
              <span className="big">{fmtChance(m.price)}</span>
              <span className="t-body-strong c-2">chance of Yes</span>
            </div>
          ) : (
            <div className="row" style={{ alignItems: 'baseline', gap: 8 }}>
              <span className={`big ${m.status === RESOLVED ? (m.outcome === YES ? 'c-success' : 'c-alert') : ''}`}>{m.status === RESOLVED ? (m.outcome === YES ? 'Yes' : 'No') : 'Cancelled'}</span>
              <span className="t-body-strong c-2">{m.status === RESOLVED ? `won · last traded at ${fmtChance(m.price)} Yes` : 'each share claims 0.5 XP'}</span>
            </div>
          )}
          {m.status === OPEN && m.closeTime > now && change !== null && <span className={`t-num ${change >= 0 ? 'c-success' : 'c-alert'}`}>{`${change >= 0 ? '+' : '−'}${Math.abs(change).toFixed(1)}% today`}</span>}
        </div>
        <AreaChart points={points} height={300} format={(v) => `${Math.round(v * 100)}%`} unit="Yes" sub={(p) => stampLabel(p.t)} now={m.status === OPEN} />
        <div>
          <Seg boxed options={Object.keys(RANGES) as Range[]} value={range} onChange={setRange} />
        </div>
        {m.status === OPEN && m.closeTime > now && (
          <YourPosition
            m={m}
            log={log}
            position={position}
            account={account}
            onSell={(outcome, shares) => {
              setForm({ mode: 'sell', outcome, amount: toInputString(shares, XP_DECIMALS, 4), exact: shares });
              document.querySelector('.pm-trade')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }}
          />
        )}
        <h2>Stats</h2>
        <div className="pm-detail-stats">
          <Stat label="Volume" value={fmtXp(m.volume, { compact: true })} />
          <Stat label="Open interest" value={fmtXp(m.staked > 0n ? m.staked : 0n, { compact: true })} />
          <Stat label="Traders" value={m.traders.toLocaleString('en-US')} />
          <Stat label={m.status === OPEN && m.closeTime > now ? 'Ends in' : 'Ended'} value={m.status === OPEN && m.closeTime > now ? longSpan(m.closeTime - now) : dateLabel(m.closeTime)} />
        </div>
        <h2>Rules</h2>
        <p className="t-body c-2">
          The PauliSwap Predict admin resolves this market Yes or No after it closes. Each winning share then pays 1 XP and each losing share pays 0; the XP is sent to every holder automatically. If the market is cancelled, every share, Yes or No, pays 0.5 XP.
        </p>
        <div className="pm-rows">
          {rule && <DetailRow label="How to resolve" value={rule.how} />}
          {rule && <DetailRow label="Resolution source" value={rule.source} />}
          <DetailRow label="Market" value={`#${m.id} on PredictMarket`} />
          <DetailRow label="Opened" value={dateLabel(blockTime(m.createdBlock))} />
          <DetailRow label="Closes" value={`${dateLabel(m.closeTime)} · ${utcTime(m.closeTime)}`} />
          <DetailRow label="Seed liquidity" value={fmtXp(m.liquidity)} />
          <DetailRow label="Status" value={status} />
        </div>
      </div>
      <TradePanel m={m} log={log} position={position} form={form} setForm={setForm} />
    </div>
  );
}

/// Your position (Polymarket-style): every side you hold, what it cost at
/// average price, what selling it all returns now, and a Sell shortcut.
function YourPosition({ m, log, position, account, onSell }: { m: MarketView; log: DecodedEvent[] | null; position: Position | undefined; account: string | null; onSell: (outcome: Outcome, shares: bigint) => void }) {
  const basis = useMemo(() => (log && account ? costBasis(log, m.id, account) : null), [log, m.id, account]);
  if (!account || !position) return null;
  const rows = ([YES, NO] as Outcome[])
    .map((o) => ({ o, shares: o === YES ? position.yesShares : position.noShares }))
    .filter((r) => r.shares > DUST_SHARES);
  if (!rows.length) return null;

  return (
    <div className="col" style={{ gap: 12 }}>
      <h2>Your position</h2>
      <div className="pm-pos">
        <div className="pm-pos-row head">
          <span>Outcome</span>
          <span>Shares</span>
          <span className="row" style={{ gap: 4 }}>
            Avg → now
            <InfoTip info={{ title: 'Average price', text: 'XP you paid per share, at average cost. Selling part of a side keeps its average price; the second number is the price now.' }} />
          </span>
          <span className="row" style={{ gap: 4 }}>
            Value
            <InfoTip info={{ title: 'Value now', text: 'XP you would get by selling all of these shares now. It is a little below shares × price, because a sale moves the pool price.' }} />
          </span>
          <span className="row" style={{ gap: 4 }}>
            Return
            <InfoTip info={{ title: 'Return', text: 'Value now minus the XP still invested in these shares.', formula: 'Value − shares × avg price' }} />
          </span>
          <span />
        </div>
        {rows.map(({ o, shares }) => {
          const name = o === YES ? 'Yes' : 'No';
          const now = o === YES ? m.price : 1 - m.price;
          const value = sellQuote(m, o, shares).xpOut;
          const side = basis?.[o === YES ? 0 : 1];
          // The log can trail positionOf by a block; scale its cost to the shares held.
          const cost = side && side.shares > 0n ? (side.cost * shares) / side.shares : null;
          const avg = cost !== null ? xpFloat(cost) / xpFloat(shares) : null;
          const pnl = cost !== null ? value - cost : null;
          const pct = cost && pnl !== null ? (xpFloat(pnl) / xpFloat(cost)) * 100 : null;
          return (
            <div key={o} className="pm-pos-row">
              <span data-label="Outcome">
                <span className={`pm-pos-side ${o === YES ? 'yes' : 'no'}`}>{name}</span>
              </span>
              <span data-label="Shares" className="col" style={{ gap: 2 }}>
                <span className="num">{fmtXp(shares, { unit: false })}</span>
                <span className="t-caption c-3">Pays {fmtXp(shares)} if {name}</span>
              </span>
              <span data-label="Avg → now" className="num">
                {avg === null ? '—' : avg.toFixed(2)} → {now.toFixed(2)} XP
              </span>
              <span data-label="Value" className="num">
                {fmtXp(value)}
              </span>
              <span data-label="Return" className={`num ${pnl === null ? '' : pnl >= 0n ? 'c-success' : 'c-alert'}`}>
                {pnl === null ? '—' : `${pnl >= 0n ? '+' : '−'}${fmtXp(pnl < 0n ? -pnl : pnl)}${pct === null ? '' : ` (${pct >= 0 ? '+' : '−'}${Math.abs(pct).toFixed(1)}%)`}`}
              </span>
              <span className="pm-pos-act">
                <button className="btn btn-sm btn-tertiary" onClick={() => onSell(o, shares)}>
                  Sell
                </button>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/// Share "tokens" for the Sell input: the monogram disc shows Y or N.
const SHARE_TOKEN: Record<Outcome, Token> = {
  [YES]: { address: 'Yes shares', symbol: 'Y', name: 'Yes shares', decimals: XP_DECIMALS },
  [NO]: { address: 'No shares', symbol: 'N', name: 'No shares', decimals: XP_DECIMALS },
};
const BUY_STEPS = [1n, 10n, 100n];
const SELL_STEPS = [25n, 50n];

/// Trade panel: Buy spends XP for shares and shows what they win; Sell takes
/// a number of shares and shows the XP it returns. Trading runs until closeTime.
function TradePanel({ m, log, position, form, setForm }: { m: MarketView; log: DecodedEvent[] | null; position: Position | undefined; form: TradeForm; setForm: Dispatch<SetStateAction<TradeForm>> }) {
  const { account } = useWallet();
  const { openModal, settings, clock } = useApp();
  const { send } = useTx();
  const { xp } = useXp(account);
  const isOwner = useIsMarketOwner(account);
  const tradable = m.status === OPEN && m.closeTime > clock.latestTime;

  if (!tradable) return isOwner && m.status === OPEN ? <ResolvePanel m={m} log={log} /> : <SettledPanel m={m} log={log} position={position} account={account} />;

  const { mode, outcome, amount, exact } = form;
  const isBuy = mode === 'buy';
  const set = (patch: Partial<TradeForm>) => setForm((f) => ({ ...f, ...patch }));
  const heldOf = (o: Outcome) => (position ? (o === YES ? position.yesShares : position.noShares) : 0n);
  const held = heldOf(outcome);
  const name = outcome === YES ? 'Yes' : 'No';
  const price = outcome === YES ? m.price : 1 - m.price;
  const left = m.closeTime - clock.latestTime;

  // Buy: `typed` is XP in. Sell: `typed` is shares, and the sale is quoted
  // as the most XP those shares return (sell() takes an exact xpOut).
  const typed = exact ?? parseUnits(amount, XP_DECIMALS) ?? 0n;
  const bought = isBuy ? quoteBuy(m, outcome, typed) : 0n;
  const sale = isBuy ? { xpOut: 0n, shares: 0n } : sellQuote(m, outcome, typed);
  const shares = isBuy ? bought : sale.shares;
  const xpAmount = isBuy ? typed : sale.xpOut;
  const avg = shares > 0n && xpAmount > 0n ? xpFloat(xpAmount) / xpFloat(shares) : null;
  const impact = avg === null ? null : Math.max(0, isBuy ? avg / price - 1 : 1 - avg / price) * 100;

  let error: string | null = null;
  if (isBuy && xp !== undefined && typed > xp) error = 'Not enough XP';
  if (!isBuy && typed > held) error = held > DUST_SHARES ? `Not enough ${name} shares` : `No ${name} shares to sell`;
  else if (!isBuy && typed > 0n && sale.xpOut === 0n) error = 'Amount too small';

  const switchMode = (v: 'buy' | 'sell') => {
    const other: Outcome = outcome === YES ? NO : YES;
    // Selling preselects the side you hold when you hold only the other one.
    const side = v === 'sell' && heldOf(outcome) <= DUST_SHARES && heldOf(other) > DUST_SHARES ? other : outcome;
    set({ mode: v, outcome: side, amount: '', exact: null });
  };
  const pick = (v: bigint) => set({ amount: toInputString(v, XP_DECIMALS, 4), exact: v });

  const submit = () => {
    const bps = settings.slippageBps;
    let sent: Promise<boolean>;
    if (isBuy) {
      if (!bought) return;
      sent = send({
        title: `Buy ${name}`,
        verb: 'trade',
        activity: `Bought ${name} on #${m.id}`,
        quest: 'predict',
        successTitle: `Bought ${name}`,
        successText: `${fmtXp(bought, { unit: false })} ${name} shares for ${fmtXp(typed)}.`,
        build: () => ({ to: PREDICT.market, method: predictMarket().methods.buy(m.id, outcome, typed, applySlippage(bought, bps, 'down')) }),
      });
    } else {
      if (!sale.xpOut) return;
      // Slippage is room to give up more shares for the same XP, never more than you hold.
      const slack = applySlippage(sale.shares, bps, 'up');
      const maxShares = slack > held ? held : slack;
      sent = send({
        title: `Sell ${name}`,
        verb: 'sale',
        activity: `Sold ${name} on #${m.id}`,
        successTitle: `Sold ${name}`,
        successText: `${fmtXp(sale.shares, { unit: false })} ${name} shares for ${fmtXp(sale.xpOut)}.`,
        build: () => ({ to: PREDICT.market, method: predictMarket().methods.sell(m.id, outcome, sale.xpOut, maxShares) }),
      });
    }
    sent.then((ok) => ok && set({ amount: '', exact: null }));
  };

  const ready = typed > 0n && shares > 0n && !error;
  return (
    <div className="pm-trade">
      <div>
        <Seg boxed options={['buy', 'sell'] as const} labels={{ buy: 'Buy', sell: 'Sell' }} value={mode} onChange={switchMode} />
      </div>
      <div className="pm-sides">
        {([YES, NO] as Outcome[]).map((o) => (
          <button key={o} className={`pm-side ${o === YES ? 'yes' : 'no'}${outcome === o ? ' on' : ''}`} onClick={() => set({ outcome: o, ...(isBuy ? {} : { amount: '', exact: null }) })}>
            <span className="name">{o === YES ? 'Yes' : 'No'}</span>
            <span className="price">{fmtPrice(o === YES ? m.price : 1 - m.price)}</span>
          </button>
        ))}
      </div>
      {left < 86400 && (
        <div className="pm-closing">
          <Icon name="clock" size={14} />
          Trading closes in {span(left)}
        </div>
      )}
      <AmountPanel
        label={isBuy ? 'Amount' : 'Shares to sell'}
        token={isBuy ? XP_TOKEN : SHARE_TOKEN[outcome]}
        symbol={isBuy ? undefined : name}
        amount={amount}
        onAmount={(v) => set({ amount: v, exact: null })}
        error={!!error}
        sub={`1 ${name} share ≈ ${fmtPrice(price)}`}
        balance={account ? (isBuy ? fmtXp(xp, { unit: false }) : fmtXp(held, { unit: false })) : '—'}
      />
      {account && (
        <div className="pm-chips">
          {isBuy
            ? BUY_STEPS.map((n) => (
                <button key={String(n)} className="pm-chip" onClick={() => set({ amount: toInputString(typed + n * ONE_XP, XP_DECIMALS, 4), exact: null })}>
                  +{String(n)}
                </button>
              ))
            : SELL_STEPS.map((p) => (
                <button key={String(p)} className="pm-chip" disabled={held <= DUST_SHARES} onClick={() => pick((held * p) / 100n)}>
                  {String(p)}%
                </button>
              ))}
          <button className="pm-chip" disabled={isBuy ? !xp : held <= DUST_SHARES} onClick={() => pick(isBuy ? xp ?? 0n : held)}>
            Max
          </button>
        </div>
      )}
      {account && ready && (
        <div className="pm-win">
          <span className="row" style={{ gap: 4 }}>
            <span className="t-body c-2">{isBuy ? 'To win' : "You'll receive"}</span>
            <InfoTip
              info={
                isBuy
                  ? { title: 'To win', text: `What these shares pay if ${name} wins: 1 XP each. They pay 0 if ${name} loses. You can also sell them before the market closes.` }
                  : { title: "You'll receive", text: 'XP credited to your balance by this sale, at the pool price after the sale moves it.' }
              }
            />
          </span>
          <span className={`big num${isBuy ? ' c-success' : ''}`}>{fmtXp(isBuy ? bought : sale.xpOut)}</span>
          <span className="t-caption c-3">
            {isBuy ? `+${Math.max(0, (xpFloat(bought) / xpFloat(typed) - 1) * 100).toFixed(0)}% if ${name} wins` : `For ${fmtXp(sale.shares, { unit: false })} ${name} shares`}
          </span>
        </div>
      )}
      {!account ? (
        <button className="btn btn-lg btn-primary btn-block" onClick={() => openModal('connect')}>
          Connect wallet
        </button>
      ) : (
        <button className="btn btn-lg btn-primary btn-block" disabled={!ready} onClick={submit}>
          {error ?? (!typed ? (isBuy ? 'Enter an amount' : 'Enter shares to sell') : `${isBuy ? 'Buy' : 'Sell'} ${name}`)}
        </button>
      )}
      {account ? (
        <div className="pm-box">
          <DetailRow
            label="Avg price"
            info={{
              title: 'Average price',
              text: `XP per share for this trade. A trade moves the pool, so it fills at a worse price than the ${fmtPrice(price)} on the button.`,
              formula: avg !== null ? `${fmtXp(xpAmount)} ÷ ${fmtXp(shares, { unit: false })} shares` : undefined,
            }}
            value={avg !== null ? `${avg.toFixed(3)} XP / share` : `${fmtPrice(price)} / share`}
          />
          <DetailRow
            label="Price impact"
            info="How much worse the average price is than the current price, because this trade moves the pool."
            value={impact === null ? '—' : `${impact.toFixed(2)}%`}
            tone={impact !== null && impact >= 10 ? 'alert' : impact !== null && impact >= 2 ? 'warning' : undefined}
          />
          <DetailRow label={isBuy ? 'Shares' : 'Shares sold'} value={shares ? fmtXp(shares, { unit: false }) : '—'} />
          <DetailRow
            label="Max slippage"
            info={isBuy ? 'The buy reverts if the price moves so far that you would get fewer shares than this allows.' : 'The sale may give up this much more in shares for the same XP if the price moves; past that it reverts. Selling all your shares has no room and reverts on any move against you.'}
            value={`${settings.slippageBps / 100}%`}
          />
          <DetailRow label="XP after trade" value={xp === undefined ? '—' : fmtXp(isBuy ? xp - typed : xp + sale.xpOut)} />
          {position && (position.yesShares > DUST_SHARES || position.noShares > DUST_SHARES) && (
            <DetailRow label="Your shares" value={`${fmtXp(position.yesShares, { unit: false })} Yes · ${fmtXp(position.noShares, { unit: false })} No`} />
          )}
        </div>
      ) : (
        <div className="pm-box" style={{ gap: 4 }}>
          <span className="t-body-strong">Viewing is open to everyone</span>
          <span className="t-body">To trade on this market you need a connected wallet. Earn XP from daily quests on PauliSwap.</span>
        </div>
      )}
      <p className="pm-foot">Each share pays 1 XP if its side wins and 0 if it loses. Buy and sell any time until the market closes on {dateLabel(m.closeTime)} at {utcTime(m.closeTime)}.</p>
      {isOwner && <MarketAdmin m={m} log={log} />}
    </div>
  );
}

/// Result of a closed market: who won, and the payout timeline replayed from
/// MarketResolved / MarketCancelled and the Claimed events settle emits.
function SettledPanel({ m, log, position, account }: { m: MarketView; log: DecodedEvent[] | null; position: Position | undefined; account: string | null }) {
  const { send } = useTx();
  const settle = useSettle();
  const settled = m.status !== OPEN;
  const outcome: Outcome | null = m.status === RESOLVED ? (m.outcome === YES ? YES : NO) : null;
  const events = useMemo(() => (log ?? []).filter((e) => Number(e.returnValues.id) === m.id), [log, m.id]);
  const left = useMemo(() => (settled ? payees(holdings(events, m.id), outcome) : null), [events, m.id, settled, outcome]);
  const verdict = events.find((e) => e.event === 'MarketResolved' || e.event === 'MarketCancelled');
  const claims = events.filter((e) => e.event === 'Claimed');
  const paidXp = claims.reduce((s, e) => s + BigInt(e.returnValues.xp), 0n);
  const mine = account ? claims.filter((e) => String(e.returnValues.user).toLowerCase() === account.toLowerCase()).reduce((s, e) => s + BigInt(e.returnValues.xp), 0n) : 0n;
  const claimable = !position || !settled ? 0n : outcome === null ? (position.yesShares + position.noShares) / 2n : outcome === YES ? position.yesShares : position.noShares;
  const claim = () =>
    send({
      title: 'Claim XP',
      verb: 'claim',
      activity: `Claimed on #${m.id}`,
      successTitle: 'Claim confirmed',
      successText: `${fmtXp(claimable)} added to your balance.`,
      build: () => ({ to: PREDICT.market, method: predictMarket().methods.claim(m.id) }),
    });
  const tx = (hash: string) => {
    const url = explorerHref('tx', hash);
    const label = shortAddress(hash, 4);
    return url ? (
      <a href={url} target="_blank" rel="noreferrer">
        {label}
      </a>
    ) : (
      label
    );
  };
  const plural = (n: number) => `${n} wallet${n === 1 ? '' : 's'}`;
  const done = left !== null && left.users.length === 0;
  const title = m.status === RESOLVED ? `${m.outcome === YES ? 'Yes' : 'No'} won` : m.status === CANCELLED ? 'Market cancelled' : 'Trading closed';
  const body =
    m.status === RESOLVED
      ? 'Winning shares are paid to holders automatically. Nobody has to claim.'
      : m.status === CANCELLED
        ? 'Every share, Yes or No, is paid 0.5 XP to its holder automatically.'
        : 'The market is past its close time. Holders are paid automatically once the admin resolves it.';
  const lastClaim = claims[claims.length - 1];
  return (
    <div className="pm-trade">
      <div className="pm-box">
        <div className="row">
          <span className="t-heading">{title}</span>
          {settled ? <Badge tone={done ? 'success' : 'warning'}>{done ? 'Paid' : 'Paying'}</Badge> : <Badge tone="warning">Awaiting result</Badge>}
        </div>
        <span className="t-body">{body}</span>
        <div className="pm-steps">
          <Step state="done" title="Trading closed" sub={`${dateLabel(m.closeTime)} · ${utcTime(m.closeTime)}`} />
          {verdict ? (
            <Step
              state="done"
              title={m.status === RESOLVED ? `Resolved ${m.outcome === YES ? 'Yes' : 'No'} by the owner` : 'Cancelled by the owner'}
              sub={
                <>
                  Block {verdict.blockNumber.toLocaleString('en-US')} · tx {tx(verdict.transactionHash)}
                </>
              }
            />
          ) : (
            <Step state="now" title="Awaiting the result" sub="The owner resolves it against the rule" />
          )}
          {settled && left && (
            <Step
              state={done ? 'done' : 'now'}
              title={done ? 'Holders paid automatically' : 'Paying holders'}
              sub={
                !done
                  ? `${plural(left.users.length)} left · ${fmtXp(left.xp)}`
                  : lastClaim
                    ? `Block ${lastClaim.blockNumber.toLocaleString('en-US')} · ${plural(claims.length)} · ${fmtXp(paidXp)}`
                    : 'Nobody held a paying share'
              }
            />
          )}
        </div>
        {account && position && (mine > 0n || claimable > 0n || position.yesShares > 0n || position.noShares > 0n) && (
          <div className="pm-box">
            <DetailRow label="Your shares" value={`${fmtXp(position.yesShares, { unit: false })} Yes · ${fmtXp(position.noShares, { unit: false })} No`} />
            {mine > 0n && <DetailRow label="Received" value={`+${fmtXp(mine)}`} tone="success" />}
            {claimable > 0n && <DetailRow label="Still to pay you" value={fmtXp(claimable)} tone="warning" />}
          </div>
        )}
      </div>
      {account && claimable > 0n && (
        <button className="btn btn-lg btn-secondary btn-block" onClick={claim}>
          Claim {fmtXp(claimable)} now
        </button>
      )}
      {account && left && left.users.length > 0 && (
        <button className="btn btn-md btn-tertiary btn-block" onClick={() => settle(m.id, left.users)}>
          Pay all {plural(left.users.length)} now
        </button>
      )}
      <p className="pm-foot">Payment is sent with the resolve, or by the attester bot a few blocks later. Anyone can send settle(id, users); the XP always goes to the holder.</p>
    </div>
  );
}

function Step({ state, title, sub }: { state: 'done' | 'now'; title: string; sub: ReactNode }) {
  return (
    <div className={`pm-step ${state}`}>
      <span className="dot" />
      <span className="col" style={{ gap: 2 }}>
        <span className="t-body-strong">{title}</span>
        <span className="t-caption c-3">{sub}</span>
      </span>
    </div>
  );
}
