import { ReactNode, useMemo, useState } from 'react';
import {
  addressMark,
  clock,
  dateLabel,
  GuestBanner,
  NotDeployed,
  OutcomeLink,
  PredictTitle,
  shortDate,
  span,
  StatCard,
  Subnav,
  useCountdown,
  utcTime,
} from '../components/predict';
import { Badge, DetailRow, Icon, Seg, Skeleton, Stat } from '../components/ui';
import { PREDICT } from '../config';
import { FaucetButton } from '../components/QrlFaucet';
import { useBalances } from '../hooks/chain';
import { MarketView, Player, QuestProgress, questsOn, Season, useLeaderboard, useMarkets, usePredictLogs, useQuests, useSeason, useXp } from '../hooks/predict';
import { predictXP, shortAddress } from '../lib/chain';
import { DecodedEvent } from '../lib/logs';
import { NATIVE } from '../lib/tokens';
import { CANCELLED, fmtChance, fmtPrice, fmtXp, OPEN, PRIZES, QURRL_URL, RESOLVED, YES } from '../lib/predict';
import { href, PredictTab } from '../lib/router';
import { useApp } from '../state/app';
import { useTx } from '../state/tx';
import { useWallet } from '../state/wallet';

const DAY = 86400;

/// Predict · Markets / Quests / Leaderboard / Rewards (114:2097, 114:5361,
/// 114:5545, 114:5824) and their guest variants.
export function Predict({ tab }: { tab: PredictTab }) {
  const { account } = useWallet();
  const { clock: chainClock } = useApp();
  const logs = usePredictLogs();
  const season = useSeason();
  const { xp, checkedIn, today } = useXp(account);
  const markets = useMarkets(logs.market);
  const players = useLeaderboard(logs.xp, logs.market, season);
  const me = account && players ? players.find((p) => p.user.toLowerCase() === account.toLowerCase()) ?? null : null;
  const live = !!season && season.id > 0 && chainClock.latestTime < season.endsAt;
  const checkInOpen = !!account && live && !!season?.checkInXp && checkedIn === false;
  const { quests, unavailable: questsUnavailable } = useQuests(account, today);
  const ctx: Ctx = { account, season, xp, checkedIn, today, markets, players, me, logs: logs.xp, live, marketLog: logs.market, quests, questsUnavailable };
  const questsLeft = (checkInOpen ? 1 : 0) + (quests?.filter((q) => q.kind === 'daily' && q.id !== 0 && !q.credited).length ?? 0);

  return (
    <main className="page">
      <div className="pm-page">
        <PredictTitle />
        <Subnav tab={tab} questsLeft={live ? questsLeft : 0} xp={xp} connected={!!account && PREDICT.deployed} />
        {!PREDICT.deployed ? (
          <NotDeployed />
        ) : (
          <>
            {logs.error && <span className="t-body c-alert">Could not read Predict history: {logs.error}</span>}
            {tab === 'markets' && <Markets {...ctx} />}
            {tab === 'quests' && <Quests {...ctx} />}
            {tab === 'leaderboard' && <Leaderboard {...ctx} />}
            {tab === 'rewards' && <Rewards {...ctx} />}
          </>
        )}
      </div>
    </main>
  );
}

type Ctx = {
  account: string | null;
  season: Season | null;
  xp: bigint | undefined;
  checkedIn: boolean | undefined;
  today: number;
  markets: MarketView[] | null;
  players: Player[] | null;
  me: Player | null;
  logs: DecodedEvent[] | null;
  marketLog: DecodedEvent[] | null;
  live: boolean;
  quests: QuestProgress[] | null;
  questsUnavailable: boolean;
};

const wait = (ready: boolean, v: ReactNode, w = 96) => (ready ? v : <Skeleton w={w} h={26} />);
const rankLabel = (me: Player | null, players: Player[] | null) => (players ? (me ? `Rank #${me.rank}` : 'Not ranked yet') : undefined);

function YourXp({ account, xp, me, players }: Ctx) {
  return (
    <StatCard>
      <Stat label="Your XP" value={account ? wait(xp !== undefined, fmtXp(xp, { unit: false }), 60) : '—'} delta={account ? rankLabel(me, players) : 'Connect a wallet'} deltaTone="muted" />
    </StatCard>
  );
}

/// Countdown to the next 00:00 UTC.
function useReset() {
  const next = (Math.floor(Date.now() / 1000 / DAY) + 1) * DAY;
  return useCountdown(next) ?? 0;
}

const pts = (now: number, before: number | null) => {
  if (before === null) return null;
  const d = (now - before) * 100;
  return { text: `${d >= 0 ? '+' : '−'}${Math.abs(d).toFixed(1)}%`, up: d >= 0 };
};

type Filter = 'trending' | 'new' | 'ending' | 'resolved';

function Markets(ctx: Ctx) {
  const { account, markets, logs } = ctx;
  const { clock: chain } = useApp();
  const reset = useReset();
  const [filter, setFilter] = useState<Filter>('trending');
  const [q, setQ] = useState('');
  const [shown, setShown] = useState(8);
  const now = chain.latestTime;
  const doneToday = questsOn(logs, account, ctx.today);

  const list = useMemo(() => {
    if (!markets) return null;
    const term = q.trim().toLowerCase();
    const open = (m: MarketView) => m.status === OPEN;
    let rows = markets.filter((m) => (filter === 'resolved' ? !open(m) : open(m)));
    if (filter === 'ending') rows = rows.filter((m) => m.closeTime > now);
    if (term) rows = rows.filter((m) => m.question.toLowerCase().includes(term) || String(m.id) === term);
    const cmp: Record<Filter, (a: MarketView, b: MarketView) => number> = {
      trending: (a, b) => (b.volume24h > a.volume24h ? 1 : b.volume24h < a.volume24h ? -1 : b.volume > a.volume ? 1 : b.volume < a.volume ? -1 : b.id - a.id),
      new: (a, b) => b.id - a.id,
      ending: (a, b) => a.closeTime - b.closeTime,
      resolved: (a, b) => b.id - a.id,
    };
    return rows.sort(cmp[filter]);
  }, [markets, filter, q, now]);

  const openCount = markets?.filter((m) => m.status === OPEN && m.closeTime > now).length;
  const newToday = markets?.filter((m) => m.history[0].t > now - DAY).length ?? 0;
  const vol24 = markets?.reduce((s, m) => s + m.volume24h, 0n);
  const trades24 = ctx.marketLog?.filter((e) => (e.event === 'Bought' || e.event === 'Sold') && e.blockNumber >= chain.latest - DAY / chain.secondsPerBlock).length;

  return (
    <>
      {account ? (
        <div className="pm-stats">
          <StatCard>
            <Stat label="Open markets" value={wait(!!markets, openCount, 40)} delta={markets ? `+${newToday} today` : undefined} deltaTone={newToday ? 'up' : 'muted'} />
          </StatCard>
          <StatCard>
            <Stat label="24h volume" value={wait(!!markets, fmtXp(vol24, { compact: true }))} delta={trades24 !== undefined ? `${trades24} trades` : undefined} deltaTone="muted" />
          </StatCard>
          <StatCard>
            <Stat label="Daily quests" value={wait(!!doneToday, `${doneToday?.length ?? 0} done`, 70)} delta={`Resets in ${clock(reset)}`} deltaTone="muted" />
          </StatCard>
          <YourXp {...ctx} />
        </div>
      ) : (
        <GuestBanner />
      )}
      <div className="pm-bar">
        <Seg boxed options={['trending', 'new', 'ending', 'resolved'] as const} labels={{ trending: 'Trending', new: 'New', ending: 'Ending soon', resolved: 'Resolved' }} value={filter} onChange={setFilter} />
        <span className="grow" />
        <label className="search-field">
          <Icon name="search" size={16} />
          <input placeholder="Filter markets" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
      </div>
      <div>
        <div className="table">
          <div className="tr thead">
            <div className="td rank">#</div>
            <div className="td grow">Market</div>
            <div className="td r" style={{ width: 90, flex: 'none' }}>
              Chance
            </div>
            <div className="td r" style={{ width: 80, flex: 'none' }}>
              24h
            </div>
            <div className="td r sort" style={{ width: 120, flex: 'none' }}>
              {filter === 'trending' ? '↓ Volume' : 'Volume'}
            </div>
            <div className="td r" style={{ width: 90, flex: 'none' }}>
              Ends
            </div>
            <div className="td trade">Trade</div>
          </div>
          <div className="tbody">
            {!list && <div className="empty-row">Reading markets from the chain…</div>}
            {list && !list.length && <div className="empty-row">{filter === 'resolved' ? 'No market has been settled yet.' : q ? `No market matches "${q.trim()}".` : 'No open markets right now.'}</div>}
            {list?.slice(0, shown).map((m, i) => (
              <MarketRow key={m.id} m={m} rank={i + 1} now={now} />
            ))}
          </div>
        </div>
        {list && list.length > shown && (
          <div className="table-footer">
            <button className="btn btn-sm btn-secondary" onClick={() => setShown((n) => n + 8)}>
              Show more
            </button>
          </div>
        )}
      </div>
    </>
  );
}

function MarketRow({ m, rank, now }: { m: MarketView; rank: number; now: number }) {
  const change = pts(m.price, m.price24h);
  const to = (side?: 'yes' | 'no') => href({ page: 'predictMarket', id: String(m.id) }) + (side ? `?outcome=${side}` : '');
  const closed = m.status === OPEN && m.closeTime <= now;
  return (
    <div className="tr pm-row" onClick={(e) => !(e.target as HTMLElement).closest('a') && (window.location.hash = to().slice(1))}>
      <div className="td rank">{rank}</div>
      <div className="td grow">
        <div className="pm-market-cell">
          <a href={to()} className="ellipsis">
            {m.question}
          </a>
          <span className="sub">
            #{m.id} · {m.traders} {m.traders === 1 ? 'trader' : 'traders'}
          </span>
        </div>
      </div>
      <div className="td r" style={{ width: 90, flex: 'none' }}>
        {fmtChance(m.price)}
      </div>
      <div className={`td r t-num ${change ? (change.up ? 'c-success' : 'c-alert') : 'c-3'}`} style={{ width: 80, flex: 'none' }}>
        {change?.text ?? '—'}
      </div>
      <div className="td r" style={{ width: 120, flex: 'none' }}>
        {fmtXp(m.volume, { compact: true })}
      </div>
      <div className="td r cell-2" style={{ width: 90, flex: 'none' }}>
        {shortDate(m.closeTime)}
      </div>
      <div className="td trade">
        {m.status === RESOLVED ? (
          <Badge tone={m.outcome === YES ? 'success' : 'alert'}>{m.outcome === YES ? 'Yes won' : 'No won'}</Badge>
        ) : m.status === CANCELLED ? (
          <Badge>Cancelled</Badge>
        ) : closed ? (
          <Badge tone="warning">Awaiting result</Badge>
        ) : (
          <>
            <OutcomeLink side="yes" price={fmtPrice(m.price)} to={to('yes')} />
            <OutcomeLink side="no" price={fmtPrice(1 - m.price)} to={to('no')} />
          </>
        )}
      </div>
    </div>
  );
}

function Quests(ctx: Ctx) {
  const { account, season, checkedIn, live, logs, today, xp, quests, questsUnavailable, markets } = ctx;
  const { openModal, clock: chainClock } = useApp();
  const { send } = useTx();
  const reset = useReset();
  const done = questsOn(logs, account, today);
  const earned = done?.reduce((s, d) => s + d.amount, 0n);
  const attested = done?.filter((d) => d.questId !== 0) ?? [];
  const checkInXp = season?.checkInXp ?? 0n;
  const daily = quests?.filter((q) => q.kind === 'daily' && q.id !== 0) ?? [];
  const milestones = quests?.filter((q) => q.kind === 'season') ?? [];
  const hiddenCount = milestones.filter((q) => q.hidden).length;
  const openMarket = markets?.find((m) => m.status === OPEN && m.closeTime > chainClock.latestTime);

  const checkIn = () =>
    send({
      title: 'Daily check-in',
      verb: 'check-in',
      activity: 'Checked in on Predict',
      successTitle: 'Check-in confirmed',
      successText: `${fmtXp(checkInXp)} added to your balance.`,
      build: () => ({ to: PREDICT.xp, method: predictXP().methods.checkIn() }),
    });

  /// The button that takes the player to where the quest is done.
  const goTo = (q: QuestProgress) => {
    const link = (to: string, label: string) => (
      <a className="btn btn-sm btn-secondary" href={to}>
        {label}
      </a>
    );
    if (q.action === 'swap') return link(href({ page: 'swap' }), 'Swap');
    if (q.action === 'pool') return link(href({ page: 'newPosition' }), 'Add liquidity');
    if (q.action === 'predict') return openMarket ? link(href({ page: 'predictMarket', id: String(openMarket.id) }), 'Predict') : <Badge>No open market</Badge>;
    if (q.action === 'faucet') return <FaucetButton account={account} className="btn btn-sm btn-secondary" />;
    if (q.action === 'checkin') return checkedIn || !live ? null : (
      <button className="btn btn-sm btn-secondary" onClick={checkIn}>
        Check in
      </button>
    );
    return null;
  };
  const row = (q: QuestProgress) => {
    const masked = q.hidden && q.title === null;
    return (
      <QuestRow
        key={q.id}
        title={masked ? '???' : q.title!}
        detail={masked ? 'Hidden quest. Keep exploring PauliSwap to reveal it.' : q.detail!}
        progress={masked ? '?' : `${q.progress} / ${q.target}`}
        reward={masked ? '???' : `+${q.xp} XP`}
        state={q.credited ? 'done' : q.met ? 'claimable' : 'todo'}
        action={!account ? undefined : q.met ? <Badge tone="quantum">Crediting…</Badge> : masked ? <Badge>Hidden</Badge> : goTo(q)}
      />
    );
  };
  const doneToday = quests ? daily.filter((q) => q.credited).length + (checkedIn ? 1 : 0) : done?.length;
  const head = (
    <div className="tr thead">
      <div className="td grow">Quest</div>
      <div className="td r" style={{ width: 120, flex: 'none' }}>
        Progress
      </div>
      <div className="td r" style={{ width: 120, flex: 'none' }}>
        Reward
      </div>
      <div className="td r" style={{ width: 140, flex: 'none' }} />
    </div>
  );

  return (
    <>
      <div className="pm-stats">
        <StatCard>
          <Stat label="Today's XP" value={account ? wait(earned !== undefined, fmtXp(earned)) : '—'} delta={season ? `Bot quests capped at ${fmtXp(season.dailyCap)}` : undefined} deltaTone="muted" />
        </StatCard>
        <StatCard>
          <Stat label="Quests done" value={account ? wait(doneToday !== undefined, doneToday ?? 0, 40) : '—'} delta={quests ? `Today, of ${daily.length + 1}` : 'Today'} deltaTone="muted" />
        </StatCard>
        <StatCard>
          <Stat label="Resets in" value={clock(reset)} delta="Daily at 00:00 UTC" deltaTone="muted" />
        </StatCard>
        <YourXp {...ctx} />
      </div>
      {!account ? <GuestBanner /> : <GetStarted account={account} xp={xp} checkedIn={checkedIn} live={live} onCheckIn={checkIn} />}
      <div className="pm-section">
        <h2>Daily quests</h2>
        <p>About a minute a day: check in, make a swap, make a prediction. Every quest resets at 00:00 UTC.</p>
      </div>
      <div className="table quests-table">
        {head}
        <div className="tbody">
          <QuestRow
            title="Daily check-in"
            detail="Check in once a day with your wallet connected"
            progress={checkedIn ? '1 / 1' : '0 / 1'}
            reward={checkInXp ? `+${fmtXp(checkInXp)}` : '—'}
            state={checkedIn ? 'done' : account && live && checkInXp ? 'claimable' : 'todo'}
            action={
              !account ? (
                <button className="btn btn-sm btn-secondary" onClick={() => openModal('connect')}>
                  Connect
                </button>
              ) : !live ? (
                <Badge>No season</Badge>
              ) : !checkInXp ? (
                <Badge>Off</Badge>
              ) : checkedIn === undefined ? (
                <Skeleton w={60} h={32} />
              ) : (
                <button className="btn btn-sm btn-primary" onClick={checkIn}>
                  Claim
                </button>
              )
            }
          />
          {quests
            ? daily.map(row)
            : attested.map((d) => (
                <QuestRow key={`${d.questId}-${d.block}`} title={`Quest #${d.questId}`} detail="Credited by the PauliSwap quest bot" progress="1 / 1" reward={`+${fmtXp(d.amount)}`} state="done" />
              ))}
        </div>
      </div>
      {quests && (
        <>
          <div className="pm-section">
            <h2>Season milestones</h2>
            <p>
              Credited once per season as you keep coming back; the days need not be in a row.
              {hiddenCount ? (hiddenCount === 1 ? ' One of them is hidden.' : ` ${hiddenCount} of them are hidden.`) : ''}
            </p>
          </div>
          <div className="table quests-table">
            {head}
            <div className="tbody">{milestones.map(row)}</div>
          </div>
        </>
      )}
      <p className="pm-foot">
        {account && questsUnavailable ? 'Quest progress is unavailable because the PauliSwap indexer cannot be reached; credited quests still show up here. ' : ''}
        The quest bot credits a quest within a minute or two of it being met. Swaps count from 1 QRL in value on priced pools, predictions from 10 XP, liquidity when it is still held at the end of the UTC day. Bot
        quests are capped at {season ? fmtXp(season.dailyCap) : 'a daily limit'} a day; a milestone over the cap is credited the next day. Wallets that farm with several accounts are excluded from prizes. XP has no cash
        value and cannot be transferred.
      </p>
    </>
  );
}

/// First steps for a new player: wallet, test QRL, first XP. Hidden once the
/// wallet holds both QRL and XP.
function GetStarted({ account, xp, checkedIn, live, onCheckIn }: { account: string; xp: bigint | undefined; checkedIn: boolean | undefined; live: boolean; onCheckIn: () => void }) {
  const balanceOf = useBalances([NATIVE], account);
  const qrl = balanceOf(NATIVE);
  if (qrl === undefined || xp === undefined) return null;
  const hasQrl = qrl > 0n;
  const hasXp = xp > 0n;
  if (hasQrl && hasXp) return null;
  const step = (n: number, ok: boolean, title: string, body: string, action?: ReactNode) => (
    <div className="row" style={{ gap: 12 }}>
      <Icon name={ok ? 'circle-check' : 'chevron-right'} size={20} className={ok ? 'c-success' : 'c-3'} />
      <span className="col grow" style={{ gap: 2 }}>
        <span className={`t-body-strong ${ok ? 'c-3' : 'c-1'}`}>
          {n}. {title}
        </span>
        <span className="t-body c-3">{body}</span>
      </span>
      {!ok && action}
    </div>
  );
  return (
    <div className="card col pm-start">
      <span className="t-body-strong c-qrl">Get started</span>
      {step(1, true, 'Wallet connected', 'QRL Web3 Wallet on QRL Devnet.')}
      {step(2, hasQrl, 'Get test QRL', 'Free from the PauliSwap faucet once a day. Nothing to sign, no gas needed.', <FaucetButton account={account} />)}
      {step(
        3,
        hasXp,
        'Earn your first XP',
        'Check in for XP, then stake it on a market.',
        live && checkedIn === false ? (
          <button className="btn btn-sm btn-primary" onClick={onCheckIn}>
            Check in
          </button>
        ) : undefined,
      )}
    </div>
  );
}

function QuestRow({ title, detail, progress, reward, state, action }: { title: string; detail: string; progress: string; reward: string; state: 'todo' | 'claimable' | 'done'; action?: ReactNode }) {
  return (
    <div className={`tr ${state}`}>
      <div className="td grow">
        <div className="pm-market-cell">
          <span className="title">{title}</span>
          <span className="sub">{detail}</span>
        </div>
      </div>
      <div className={`td r t-num ${state === 'done' ? 'c-3' : 'c-2'}`} style={{ width: 120, flex: 'none' }}>
        {progress}
      </div>
      <div className={`td r ${state === 'claimable' ? 'c-quantum' : state === 'done' ? 'c-3' : ''}`} style={{ width: 120, flex: 'none', color: state === 'claimable' ? 'var(--quantum-bright)' : undefined }}>
        {reward}
      </div>
      <div className="td r" style={{ width: 140, flex: 'none' }}>
        {state === 'done' ? <Badge tone="success">Done</Badge> : action}
      </div>
    </div>
  );
}

function Leaderboard(ctx: Ctx) {
  const { season, players, me, account } = ctx;
  const left = useCountdown(season?.endsAt);
  const [q, setQ] = useState('');
  const [shown, setShown] = useState(10);
  const term = q.trim().toLowerCase();
  const list = players && term ? players.filter((p) => p.user.toLowerCase().includes(term)) : players;
  const newThisWeek = useMemo(() => {
    if (!ctx.logs || !season) return undefined;
    const first = new Map<string, number>();
    for (const e of ctx.logs) if (e.event === 'XPCredited' && Number(e.returnValues.season) === season.id && !first.has(String(e.returnValues.user).toLowerCase())) first.set(String(e.returnValues.user).toLowerCase(), e.blockNumber);
    return first;
  }, [ctx.logs, season]);
  const { clock: chain } = useApp();
  const weekBlock = chain.latest - (7 * DAY) / chain.secondsPerBlock;
  const joined = newThisWeek ? [...newThisWeek.values()].filter((b) => b >= weekBlock).length : undefined;

  return (
    <>
      <div className="pm-stats">
        <StatCard>
          <Stat label={season ? `Season ${season.id} ends in` : 'Season ends in'} value={wait(left !== undefined, left ? span(left) : 'Ended', 80)} delta={season ? dateLabel(season.endsAt) : undefined} deltaTone="muted" />
        </StatCard>
        <StatCard>
          <Stat label="Players" value={wait(!!players, players?.length, 40)} delta={joined !== undefined ? `+${joined} this week` : undefined} deltaTone={joined ? 'up' : 'muted'} />
        </StatCard>
        <StatCard>
          <Stat label="1st prize" value={PRIZES[0]} />
        </StatCard>
        <StatCard>
          <Stat label="Your rank" value={account ? wait(!!players, me ? `#${me.rank}` : '—', 50) : '—'} delta={account ? (me ? fmtXp(me.xp) : 'No XP this season') : 'Connect a wallet'} deltaTone="muted" />
        </StatCard>
      </div>
      <div className="pm-bar" style={{ minHeight: 40 }}>
        <span className="t-body c-3 grow">Ranked by XP held this season. Ties go to whoever reached the score first.</span>
        <label className="search-field">
          <Icon name="search" size={16} />
          <input placeholder="Find address" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
      </div>
      <div>
        <div className="table lb-table">
          <div className="tr thead">
            <div className="td rank">#</div>
            <div className="td grow">Trader</div>
            <div className="td r sort" style={{ width: 140, flex: 'none' }}>
              ↓ XP held
            </div>
            <div className="td r" style={{ width: 70, flex: 'none' }}>
              Win rate
            </div>
            <div className="td r" style={{ width: 110, flex: 'none' }}>
              Predictions
            </div>
            <div className="td r" style={{ width: 160, flex: 'none' }}>
              Prize
            </div>
          </div>
          <div className="tbody">
            {!list && <div className="empty-row">Reading XP history from the chain…</div>}
            {list && !list.length && <div className="empty-row">{term ? `No wallet matches "${q.trim()}".` : 'Nobody holds XP this season yet.'}</div>}
            {me && !term && (
              <>
                <PlayerRow p={me} you />
                <div className="gap" />
              </>
            )}
            {list?.slice(0, shown).map((p) => (
              <PlayerRow key={p.user} p={p} you={!!account && p.user.toLowerCase() === account.toLowerCase()} />
            ))}
          </div>
        </div>
        {list && list.length > shown && (
          <div className="table-footer">
            <button className="btn btn-sm btn-secondary" onClick={() => setShown((n) => n + 10)}>
              Show more
            </button>
          </div>
        )}
      </div>
    </>
  );
}

function PlayerRow({ p, you }: { p: Player; you?: boolean }) {
  return (
    <div className={`tr${you ? ' you' : ''}`}>
      <div className="td rank">{p.rank}</div>
      <div className="td grow">
        <span className="token-icon" style={{ width: 28, height: 28, fontSize: 12 }} title={p.user}>
          {addressMark(p.user)}
        </span>
        <span className="t-num c-1">{shortAddress(p.user)}</span>
        {you && <Badge tone="quantum">You</Badge>}
      </div>
      <div className="td r" style={{ width: 140, flex: 'none' }}>
        {fmtXp(p.xp)}
      </div>
      <div className="td r cell-2" style={{ width: 70, flex: 'none' }}>
        {p.winRate === null ? '—' : `${Math.round(p.winRate * 100)}%`}
      </div>
      <div className="td r cell-2" style={{ width: 110, flex: 'none' }}>
        {p.predictions}
      </div>
      <div className={`td r ${you ? 'c-3' : ''}`} style={{ width: 160, flex: 'none' }}>
        {PRIZES[p.rank - 1] ?? '—'}
      </div>
    </div>
  );
}

function Rewards(ctx: Ctx) {
  const { season, players, me, account } = ctx;
  const { openModal } = useApp();
  const third = players?.[2];
  const ends = season ? `${dateLabel(season.endsAt)} · ${utcTime(season.endsAt)}` : '—';
  return (
    <>
      <div className="pm-section">
        <h2>{season ? `Season ${season.id} prizes` : 'Season prizes'}</h2>
        <p>Three prizes for the top three wallets by XP when the season ends{season ? ` on ${dateLabel(season.endsAt)}` : ''}. Whitelist spots are for the Qurrl NFT collection.</p>
      </div>
      <div className="pm-prizes">
        {[
          ['1st place', PRIZES[0], 'Qurrl whitelist spot, plus 10 QRL'],
          ['2nd place', PRIZES[1], 'Qurrl whitelist spot'],
          ['3rd place', PRIZES[2], 'Qurrl whitelist spot'],
        ].map(([place, prize, detail], i) => (
          <div key={place} className={`card pm-prize${i === 0 ? ' first' : ''}`}>
            <span className="place">{place}</span>
            <span className="t-title">{prize}</span>
            <span className="t-body c-3">{detail}</span>
          </div>
        ))}
      </div>
      <div className="card pm-wl">
        <div className="col" style={{ gap: 12 }}>
          <div className="row" style={{ gap: 12 }}>
            <span className="token-icon" style={{ width: 40, height: 40, fontSize: 16, background: 'var(--bg-muted)', color: 'var(--text-secondary)' }}>
              QR
            </span>
            <div className="col" style={{ gap: 2 }}>
              <span style={{ font: '600 20px/28px var(--font)', letterSpacing: '-0.2px' }}>What is the whitelist?</span>
              <span className="t-label c-3">Qurrl NFT · by QUANTUMARK</span>
            </div>
          </div>
          <p className="t-body c-2">
            Qurrl is QUANTUMARK’s QRC-721 NFT collection on the Quantum Resistant Ledger. Winning a whitelist spot adds your wallet to the Qurrl mint list, so you can mint when Qurrl launches.
          </p>
          <div>
            <a className="btn btn-sm btn-tertiary" href={QURRL_URL} target="_blank" rel="noreferrer">
              Visit quantumark.fi/qurrl
              <Icon name="external-link" size={16} />
            </a>
          </div>
        </div>
        <div className="wl-rows">
          <DetailRow label="Collection" value="Qurrl · QRC-721 on QRL" />
          <DetailRow label="Max supply" value="10,500 NFTs" />
          <DetailRow label="Status" value="Design stage, not on mainnet" />
          <DetailRow label="Mint date & price" value="Not announced yet" />
        </div>
      </div>
      <div className="card pm-standing">
        <div className="col grow" style={{ gap: 4 }}>
          {account ? (
            <>
              <span style={{ font: '600 16px/22px var(--font)' }}>{me ? `You're #${me.rank} with ${fmtXp(me.xp)}` : players ? 'You have no XP this season yet' : 'Reading your standing…'}</span>
              <span className="t-body c-3">
                {third ? `#3 has ${fmtXp(third.xp)}. ` : ''}
                Daily quests add XP every day, and every winning share pays 1 XP.
              </span>
            </>
          ) : (
            <>
              <span style={{ font: '600 16px/22px var(--font)' }}>Join the ranking</span>
              <span className="t-body c-3">Connect a wallet to earn XP from daily quests and stake it on markets.</span>
            </>
          )}
        </div>
        {account ? (
          <a className="btn btn-md btn-primary" href={href({ page: 'predict', tab: 'quests' })}>
            Do daily quests
          </a>
        ) : (
          <button className="btn btn-md btn-primary" onClick={() => openModal('connect')}>
            Connect wallet
          </button>
        )}
      </div>
      <div className="pm-rules">
        <div className="card">
          <h3>How prizes work</h3>
          <DetailRow label="Ranking" value="XP held this season" />
          <DetailRow label="Season ends" value={ends} />
          <DetailRow label="Ties" value="First to reach the score wins" />
          <DetailRow label="Qurrl whitelist" value="Added by QUANTUMARK after review" />
          <DetailRow label="QRL prize" value="Sent to the winning wallet after review" />
        </div>
        <div className="card">
          <h3>How to earn XP</h3>
          <DetailRow label="Daily check-in" value={season?.checkInXp ? `${fmtXp(season.checkInXp)} a day` : '—'} />
          <DetailRow label="Daily quests" value={season ? `Up to ${fmtXp(season.dailyCap)} a day` : '—'} />
          <DetailRow label="Winning predictions" value="1 XP per winning share" />
          <DetailRow label="Losing predictions" value="Stake is lost" />
          <DetailRow label="Quest reset" value="Every day at 00:00 UTC" />
        </div>
      </div>
    </>
  );
}
