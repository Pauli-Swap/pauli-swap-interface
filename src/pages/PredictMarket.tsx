import { ReactNode, useMemo, useState } from 'react';
import { AreaChart, stampLabel } from '../components/Chart';
import { dateLabel, longSpan, NotDeployed, utcTime, XP_TOKEN } from '../components/predict';
import { AmountPanel, Badge, Crumbs, DetailRow, Empty, explorerHref, IconButton, Seg, Stat } from '../components/ui';
import { PREDICT } from '../config';
import { MarketAdmin, ResolvePanel, useSettle } from '../components/PredictAdmin';
import { MarketView, Position, useIsMarketOwner, useMarkets, usePosition, usePredictLogs, useXp } from '../hooks/predict';
import { predictMarket, shortAddress } from '../lib/chain';
import { DecodedEvent } from '../lib/logs';
import { applySlippage, parseUnits, toInputString } from '../lib/format';
import { load, save } from '../lib/storage';
import { CANCELLED, fmtChance, fmtPrice, fmtXp, holdings, MARKET_RULES, maxSellXp, NO, OPEN, Outcome, payees, quoteBuy, quoteSell, RESOLVED, XP_DECIMALS, xpFloat, YES } from '../lib/predict';
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

function MarketDetail({ m, log }: { m: MarketView; log: DecodedEvent[] | null }) {
  const { clock, blockTime } = useApp();
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
      <TradePanel m={m} log={log} />
    </div>
  );
}

function TradePanel({ m, log }: { m: MarketView; log: DecodedEvent[] | null }) {
  const { account } = useWallet();
  const { openModal, settings, clock } = useApp();
  const { send } = useTx();
  const { xp } = useXp(account);
  const position = usePosition(m.id, account);
  const [mode, setMode] = useState<'buy' | 'sell'>('buy');
  const [outcome, setOutcome] = useState<Outcome>(() => (query().get('outcome') === 'no' ? NO : YES));
  const [amount, setAmount] = useState('');
  const isOwner = useIsMarketOwner(account);
  const tradable = m.status === OPEN && m.closeTime > clock.latestTime;

  if (!tradable) return isOwner && m.status === OPEN ? <ResolvePanel m={m} log={log} /> : <SettledPanel m={m} log={log} position={position} account={account} />;

  const value = parseUnits(amount, XP_DECIMALS) ?? 0n;
  const held = position ? (outcome === YES ? position.yesShares : position.noShares) : 0n;
  const name = outcome === YES ? 'Yes' : 'No';
  const price = outcome === YES ? m.price : 1 - m.price;
  const shares = mode === 'buy' ? quoteBuy(m, outcome, value) : quoteSell(m, outcome, value);
  const maxSell = mode === 'sell' ? maxSellXp(m, outcome, held) : 0n;

  let error: string | null = null;
  if (mode === 'buy' && xp !== undefined && value > xp) error = 'Not enough XP';
  if (mode === 'sell' && shares === null) error = 'More than the pool can pay';
  else if (mode === 'sell' && shares !== null && shares > held) error = `Not enough ${name} shares`;

  const submit = () => {
    if (!shares) return;
    const isBuy = mode === 'buy';
    const bound = applySlippage(shares, settings.slippageBps, isBuy ? 'down' : 'up');
    send({
      title: isBuy ? `Buy ${name}` : `Sell ${name}`,
      verb: isBuy ? 'trade' : 'sale',
      activity: isBuy ? `Bought ${name} on #${m.id}` : `Sold ${name} on #${m.id}`,
      quest: isBuy ? 'predict' : undefined,
      successTitle: isBuy ? 'Prediction placed' : 'Shares sold',
      successText: isBuy ? `${fmtXp(value)} for ${fmtXp(shares, { unit: false })} ${name} shares.` : `${fmtXp(shares, { unit: false })} ${name} shares for ${fmtXp(value)}.`,
      build: () => ({ to: PREDICT.market, method: isBuy ? predictMarket().methods.buy(m.id, outcome, value, bound) : predictMarket().methods.sell(m.id, outcome, value, bound) }),
    }).then((ok) => ok && setAmount(''));
  };

  const sharesF = shares ? xpFloat(shares) : 0;
  const valueF = xpFloat(value);
  return (
    <div className="pm-trade">
      <div>
        <Seg boxed options={['buy', 'sell'] as const} labels={{ buy: 'Buy', sell: 'Sell' }} value={mode} onChange={(v) => (setMode(v), setAmount(''))} />
      </div>
      <div className="pm-sides">
        {([YES, NO] as Outcome[]).map((o) => (
          <button key={o} className={`pm-side ${o === YES ? 'yes' : 'no'}${outcome === o ? ' on' : ''}`} onClick={() => setOutcome(o)}>
            <span className="name">{o === YES ? 'Yes' : 'No'}</span>
            <span className="price">{fmtPrice(o === YES ? m.price : 1 - m.price)}</span>
          </button>
        ))}
      </div>
      <AmountPanel
        label={mode === 'buy' ? 'Stake' : 'Receive'}
        token={XP_TOKEN}
        amount={amount}
        onAmount={setAmount}
        error={!!error}
        sub={value > 0n && shares ? (mode === 'buy' ? `≈ ${fmtXp(shares, { unit: false })} ${name} shares` : `Sells ${fmtXp(shares, { unit: false })} ${name} shares`) : mode === 'sell' ? `You hold ${fmtXp(held, { unit: false })} ${name} shares` : ' '}
        balance={account ? (mode === 'buy' ? fmtXp(xp, { unit: false }) : fmtXp(held, { unit: false }) + ' sh') : '—'}
        onMax={account ? () => setAmount(toInputString(mode === 'buy' ? xp ?? 0n : maxSell, XP_DECIMALS, 4)) : undefined}
      />
      {!account ? (
        <button className="btn btn-lg btn-primary btn-block" onClick={() => openModal('connect')}>
          Connect wallet
        </button>
      ) : (
        <button className="btn btn-lg btn-primary btn-block" disabled={!value || !shares || !!error} onClick={submit}>
          {error ?? (!value ? 'Enter an amount' : `${mode === 'buy' ? 'Buy' : 'Sell'} ${name}`)}
        </button>
      )}
      {account ? (
        <div className="pm-box">
          <DetailRow label="Avg price" value={value && sharesF ? `${(valueF / sharesF).toFixed(2)} XP / share` : `${fmtPrice(price)} / share`} />
          <DetailRow label={mode === 'buy' ? 'Shares' : 'Shares sold'} value={shares ? fmtXp(shares, { unit: false }) : '—'} />
          {mode === 'buy' && (
            <DetailRow label={`Payout if ${name}`} value={shares ? `${fmtXp(shares)} (+${Math.max(0, (sharesF / valueF - 1) * 100).toFixed(0)}%)` : '—'} tone={shares ? 'success' : undefined} />
          )}
          <DetailRow label="XP after trade" value={xp === undefined ? '—' : fmtXp(mode === 'buy' ? xp - value : xp + value)} />
          {position && (position.yesShares > 0n || position.noShares > 0n) && (
            <DetailRow label="Your shares" value={`${fmtXp(position.yesShares, { unit: false })} Yes · ${fmtXp(position.noShares, { unit: false })} No`} />
          )}
        </div>
      ) : (
        <div className="pm-box" style={{ gap: 4 }}>
          <span className="t-body-strong">Viewing is open to everyone</span>
          <span className="t-body">To stake XP on this market you need a connected wallet. Earn XP from daily quests on PauliSwap.</span>
        </div>
      )}
      <p className="pm-foot">
        Each share pays 1 XP if {name} wins and 0 if it loses. You can sell any time before the market closes. Max slippage {settings.slippageBps / 100}%.
      </p>
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
