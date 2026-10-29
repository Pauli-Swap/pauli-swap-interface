import { useEffect, useMemo, useState } from 'react';
import { Point } from '../components/Chart';
import { PREDICT } from '../config';
import { predictMarket, predictXP, sameAddress } from '../lib/chain';
import { DecodedEvent } from '../lib/logs';
import { applyTrade, CANCELLED, contractLog, OPEN, Pools, priceYes, RESOLVED, YES } from '../lib/predict';
import { useApp } from '../state/app';
import { gql, indexerConfigured } from '../lib/indexer';
import { DAY } from './explore';

/// Both Predict event logs, extended on every new block.
export function usePredictLogs() {
  const { block } = useApp();
  const [market, setMarket] = useState<DecodedEvent[] | null>(null);
  const [xp, setXp] = useState<DecodedEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!PREDICT.deployed || !block) return;
    let alive = true;
    Promise.all([contractLog('market', block), contractLog('xp', block)])
      .then(([m, x]) => {
        if (!alive) return;
        setMarket(m);
        setXp(x);
        setError(null);
      })
      .catch((e) => alive && setError((e as Error).message || 'Could not read Predict logs'));
    return () => {
      alive = false;
    };
  }, [block]);
  return { market, xp, error };
}

export type Season = { id: number; endsAt: number; checkInXp: bigint; dailyCap: bigint };

export function useSeason() {
  const { block } = useApp();
  const [season, setSeason] = useState<Season | null>(null);
  useEffect(() => {
    if (!PREDICT.deployed || !block) return;
    let alive = true;
    const c = predictXP().methods;
    Promise.all([c.currentSeason().call(), c.seasonEndsAt().call(), c.checkInXp().call(), c.dailyQuestCap().call()])
      .then(([id, endsAt, checkIn, cap]) => alive && setSeason({ id: Number(id), endsAt: Number(endsAt), checkInXp: BigInt(checkIn), dailyCap: BigInt(cap) }))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [block]);
  return season;
}

/// Current-season XP of `account` and whether today's check-in is done.
export function useXp(account: string | null) {
  const { block, clock } = useApp();
  const [xp, setXp] = useState<bigint | undefined>(undefined);
  const [checkedIn, setCheckedIn] = useState<boolean | undefined>(undefined);
  const today = Math.floor(clock.latestTime / 86400);
  useEffect(() => {
    if (!PREDICT.deployed || !account) {
      setXp(undefined);
      setCheckedIn(undefined);
      return;
    }
    let alive = true;
    const c = predictXP().methods;
    Promise.all([c.xpOf(account).call(), c.questDone(account, 0, today).call()])
      .then(([v, done]) => {
        if (!alive) return;
        setXp(BigInt(v));
        setCheckedIn(Boolean(done));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [account, block, today]);
  return { xp, checkedIn, today };
}

/// Whether `account` is PredictMarket.owner(), the only wallet the contract
/// lets create, resolve and cancel markets. Read on every block, so a
/// setOwner shows up without a reload.
export function useIsMarketOwner(account: string | null) {
  const { block } = useApp();
  const [owner, setOwner] = useState<string | null>(null);
  useEffect(() => {
    if (!PREDICT.deployed || !account || !block) return;
    let alive = true;
    predictMarket()
      .methods.owner()
      .call()
      .then((o: unknown) => alive && setOwner(String(o)))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [account, block]);
  return !!account && sameAddress(owner ?? undefined, account);
}

export type MarketView = Pools & {
  id: number;
  question: string;
  closeTime: number;
  status: number;
  outcome: number;
  liquidity: bigint;
  createdBlock: number;
  price: number;
  /// Yes price a day ago; null when the market is younger than that.
  price24h: number | null;
  volume: bigint;
  volume24h: bigint;
  /// XP traders put in minus what they took back out by selling.
  staked: bigint;
  traders: number;
  history: Point[];
};

/// Every market: live reserves and status from the uint-indexed `markets`
/// getter, the question and the trade history from the logs.
export function useMarkets(log: DecodedEvent[] | null) {
  const { block, blockTime, clock } = useApp();
  const [state, setState] = useState<Map<number, { closeTime: number; poolYes: bigint; poolNo: bigint; status: number; outcome: number }> | null>(null);
  useEffect(() => {
    if (!PREDICT.deployed || !block) return;
    let alive = true;
    const c = predictMarket().methods;
    (async () => {
      const count = Number(await c.marketCount().call());
      const rows = await Promise.all(Array.from({ length: count }, (_, i) => c.markets(i).call()));
      if (!alive) return;
      setState(
        new Map(
          rows.map((m: any, i) => [
            i,
            { closeTime: Number(m.closeTime), poolYes: BigInt(m.poolYes), poolNo: BigInt(m.poolNo), status: Number(m.status), outcome: Number(m.outcome) },
          ]),
        ),
      );
    })().catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [block]);

  return useMemo(() => {
    if (!state || !log) return null;
    const dayAgo = clock.latestTime - DAY;
    const out: MarketView[] = [];
    for (const created of log.filter((e) => e.event === 'MarketCreated')) {
      const id = Number(created.returnValues.id);
      const live = state.get(id);
      if (!live) continue;
      const liquidity = BigInt(created.returnValues.liquidity);
      let pools: Pools = { poolYes: liquidity, poolNo: liquidity };
      const createdAt = blockTime(created.blockNumber);
      const history: Point[] = [{ t: createdAt, v: priceYes(pools) }];
      let price24h: number | null = createdAt <= dayAgo ? priceYes(pools) : null;
      let volume = 0n;
      let volume24h = 0n;
      let staked = 0n;
      const traders = new Set<string>();
      for (const e of log) {
        if ((e.event !== 'Bought' && e.event !== 'Sold') || Number(e.returnValues.id) !== id) continue;
        const t = blockTime(e.blockNumber);
        const xp = BigInt(e.event === 'Bought' ? e.returnValues.xpIn : e.returnValues.xpOut);
        pools = applyTrade(pools, e);
        history.push({ t, v: priceYes(pools) });
        if (t <= dayAgo) price24h = priceYes(pools);
        else volume24h += xp;
        volume += xp;
        staked += e.event === 'Bought' ? xp : -xp;
        traders.add(String(e.returnValues.user).toLowerCase());
      }
      const price = priceYes(live);
      if (live.status === OPEN) history.push({ t: Math.min(clock.latestTime, live.closeTime), v: price });
      out.push({ id, question: String(created.returnValues.question), liquidity, createdBlock: created.blockNumber, ...live, price, price24h, volume, volume24h, staked, traders: traders.size, history });
    }
    return out;
  }, [state, log, blockTime, clock.latestTime]);
}

export type Position = { yesShares: bigint; noShares: bigint; spent: bigint; received: bigint };

export function usePosition(id: number, account: string | null) {
  const { block } = useApp();
  const [position, setPosition] = useState<Position | undefined>(undefined);
  useEffect(() => {
    if (!PREDICT.deployed || !account) {
      setPosition(undefined);
      return;
    }
    let alive = true;
    predictMarket()
      .methods.positionOf(id, account)
      .call()
      .then((p: any) => alive && setPosition({ yesShares: BigInt(p.yesShares), noShares: BigInt(p.noShares), spent: BigInt(p.spent), received: BigInt(p.received) }))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [id, account, block]);
  return position;
}

export type Player = { user: string; xp: bigint; reachedAt: number; predictions: number; winRate: number | null; rank: number };

/// Season ranking by XP held, rebuilt from XPCredited / XPDebited. Ties go to
/// the wallet that reached its balance first.
export function leaderboard(xpLog: DecodedEvent[], marketLog: DecodedEvent[], season: number): Player[] {
  const balances = new Map<string, { user: string; xp: bigint; reachedAt: number }>();
  for (const e of xpLog) {
    if ((e.event !== 'XPCredited' && e.event !== 'XPDebited') || Number(e.returnValues.season) !== season) continue;
    const user = String(e.returnValues.user);
    const key = user.toLowerCase();
    const row = balances.get(key) ?? { user, xp: 0n, reachedAt: 0 };
    row.xp += e.event === 'XPCredited' ? BigInt(e.returnValues.amount) : -BigInt(e.returnValues.amount);
    row.reachedAt = e.blockNumber;
    balances.set(key, row);
  }

  const predictions = new Map<string, number>();
  // Net shares per market and wallet, frozen when the market resolves.
  const shares = new Map<string, [bigint, bigint]>();
  const wins = new Map<string, { won: number; settled: number }>();
  for (const e of marketLog) {
    const v = e.returnValues;
    if (e.event === 'Bought' || e.event === 'Sold') {
      const user = String(v.user).toLowerCase();
      if (e.event === 'Bought') predictions.set(user, (predictions.get(user) ?? 0) + 1);
      const key = `${v.id}:${user}`;
      const s = shares.get(key) ?? [0n, 0n];
      const delta = e.event === 'Bought' ? BigInt(v.shares) : -BigInt(v.shares);
      s[Number(v.outcome) === YES ? 0 : 1] += delta;
      shares.set(key, s);
    } else if (e.event === 'MarketResolved') {
      const winner = Number(v.outcome) === YES ? 0 : 1;
      for (const [key, s] of shares) {
        const [id, user] = key.split(':');
        if (id !== String(v.id)) continue;
        const w = wins.get(user) ?? { won: 0, settled: 0 };
        w.settled += 1;
        if (s[winner] > 0n) w.won += 1;
        wins.set(user, w);
      }
    }
  }

  return [...balances.values()]
    .filter((p) => p.xp > 0n)
    .sort((a, b) => (b.xp > a.xp ? 1 : b.xp < a.xp ? -1 : a.reachedAt - b.reachedAt))
    .map((p, i) => {
      const key = p.user.toLowerCase();
      const w = wins.get(key);
      return { ...p, predictions: predictions.get(key) ?? 0, winRate: w && w.settled ? w.won / w.settled : null, rank: i + 1 };
    });
}

export function useLeaderboard(xpLog: DecodedEvent[] | null, marketLog: DecodedEvent[] | null, season: Season | null) {
  return useMemo(() => (xpLog && marketLog && season ? leaderboard(xpLog, marketLog, season.id) : null), [xpLog, marketLog, season]);
}

export type QuestDone = { questId: number; amount: bigint; block: number };

/// Quests `account` completed on `day`, from QuestCompleted.
export function questsOn(xpLog: DecodedEvent[] | null, account: string | null, day: number): QuestDone[] | null {
  if (!xpLog) return null;
  if (!account) return [];
  return xpLog
    .filter((e) => e.event === 'QuestCompleted' && Number(e.returnValues.day) === day && sameAddress(String(e.returnValues.user), account))
    .map((e) => ({ questId: Number(e.returnValues.questId), amount: BigInt(e.returnValues.amount), block: e.blockNumber }));
}

export const isSettled = (m: { status: number }) => m.status === RESOLVED || m.status === CANCELLED;

export type QuestProgress = {
  id: number;
  kind: 'daily' | 'season';
  hidden: boolean;
  /// Null on a hidden quest the wallet has not been credited for.
  title: string | null;
  detail: string | null;
  xp: number | null;
  action: 'checkin' | 'swap' | 'predict' | 'pool' | 'faucet' | null;
  target: number | null;
  progress: number | null;
  met: boolean;
  credited: boolean;
};

/// Quest catalogue and progress of `account` for `day`, from
/// pauli-swap-indexer (src/quests.ts). Null while loading, or for good when
/// the indexer is not configured or unreachable: the Quests tab then falls
/// back to the check-in and the credits it reads from the logs.
export function useQuests(account: string | null, day: number) {
  const { block } = useApp();
  const [quests, setQuests] = useState<QuestProgress[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!PREDICT.deployed || !account || !indexerConfigured) {
      setQuests(null);
      return;
    }
    let alive = true;
    gql<{ questProgress: { quests: QuestProgress[] } }>(
      'query($user: ID!, $day: Int) { questProgress(user: $user, day: $day) { quests { id kind hidden title detail xp action target progress met credited } } }',
      { user: account, day },
    )
      .then((d) => {
        if (!alive) return;
        setQuests(d.questProgress.quests);
        setFailed(false);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [account, day, block]);
  return { quests, unavailable: !indexerConfigured || failed };
}
