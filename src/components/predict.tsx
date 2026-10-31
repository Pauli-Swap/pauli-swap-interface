import { ReactNode, useEffect, useState } from 'react';
import { CHAIN } from '../config';
import { fmtXp } from '../lib/predict';
import { href, PredictTab } from '../lib/router';
import { Token } from '../lib/tokens';
import { useApp } from '../state/app';
import { Empty, Icon } from './ui';
import '../styles/predict.css';

/// Stand-in token for the amount panel and token marks; XP is a ledger
/// balance in PauliPredictXP, not an SQRC-TF1 token.
export const XP_TOKEN: Token = { address: 'xp', symbol: 'XP', name: 'Predict XP', decimals: 18 };

export const PREDICT_RULE = 'Stake XP on real-world outcomes. A winning share pays 1 XP; a losing share pays 0.';

const TABS: { key: PredictTab; label: string }[] = [
  { key: 'markets', label: 'Markets' },
  { key: 'quests', label: 'Quests' },
  { key: 'leaderboard', label: 'Leaderboard' },
  { key: 'rewards', label: 'Rewards' },
];

/// Predict/Subnav (112:794): text tabs with a quantum underline, the open
/// quest count on Quests, and the XP chip (112:793) at the end.
export function Subnav({ tab, questsLeft, xp, connected }: { tab: PredictTab; questsLeft?: number; xp?: bigint; connected: boolean }) {
  return (
    <nav className="pm-subnav">
      {TABS.map((t) => (
        <a key={t.key} href={href({ page: 'predict', tab: t.key })} className={tab === t.key ? 'on' : ''} aria-current={tab === t.key ? 'page' : undefined}>
          {t.label}
          {t.key === 'quests' && !!questsLeft && <span className="badge badge-quantum">{questsLeft} left</span>}
        </a>
      ))}
      <span className="grow" />
      <span className={`xp-chip${connected ? '' : ' off'}`} title="Your XP this season">
        <Icon name="star" size={16} className={connected ? 'c-quantum' : undefined} />
        <span className="num">{connected ? fmtXp(xp) : '— XP'}</span>
      </span>
    </nav>
  );
}

export function PredictTitle() {
  return (
    <div className="page-title">
      <h1>Predict</h1>
      <p>{PREDICT_RULE}</p>
    </div>
  );
}

/// Guest banner (114:2449): QRL-orange title, white body, Connect wallet.
export function GuestBanner() {
  const { openModal } = useApp();
  return (
    <div className="pm-guest card">
      <div className="col grow" style={{ gap: 2 }}>
        <span className="t-body-strong c-qrl">You are browsing as a guest</span>
        <span className="t-body c-1">Anyone can view markets. Connect a wallet to stake XP, do daily quests and join the leaderboard.</span>
      </div>
      <button className="btn btn-md btn-primary" onClick={() => openModal('connect')}>
        Connect wallet
      </button>
    </div>
  );
}

/// PM/Outcome button (106:1454): Yes in success green, No in alert red.
export function OutcomeLink({ side, price, to, className = '' }: { side: 'yes' | 'no'; price: string; to: string; className?: string }) {
  return (
    <a className={`pm-outcome ${side} ${className}`} href={to}>
      {side === 'yes' ? 'Yes' : 'No'} {price}
    </a>
  );
}

export function NotDeployed() {
  return (
    <Empty icon="info" title={`Predict is not deployed on ${CHAIN.name} yet`}>
      PauliPredictXP and PredictMarket have no deployment on chain {CHAIN.id}. After they are deployed, run npm run sync:predict and rebuild.
    </Empty>
  );
}

/// Seconds until `target`, ticking once a second.
export function useCountdown(target: number | undefined) {
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => clearInterval(id);
  }, []);
  return target === undefined ? undefined : Math.max(0, Math.floor(target - now));
}

const pad = (n: number) => String(n).padStart(2, '0');
/// "06:12:40"
export const clock = (s: number) => `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
/// "12d 04h", "5h 12m", "48m"
export function span(s: number) {
  if (s >= 86400) return `${Math.floor(s / 86400)}d ${pad(Math.floor((s % 86400) / 3600))}h`;
  if (s >= 3600) return `${Math.floor(s / 3600)}h ${pad(Math.floor((s % 3600) / 60))}m`;
  return `${Math.max(0, Math.ceil(s / 60))}m`;
}
/// "34 days", "5 hours", "12 min"
export function longSpan(s: number) {
  if (s >= 2 * 86400) return `${Math.floor(s / 86400)} days`;
  if (s >= 2 * 3600) return `${Math.floor(s / 3600)} hours`;
  return `${Math.max(1, Math.ceil(s / 60))} min`;
}

export const dateLabel = (t: number) => new Date(t * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
export const shortDate = (t: number) => new Date(t * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
export const utcTime = (t: number) => new Date(t * 1000).toISOString().slice(11, 16) + ' UTC';

/// Two-character mark for a wallet, as on the leaderboard rows.
export const addressMark = (address: string) => address.slice(1, 3).toUpperCase();

export function StatCard({ children }: { children: ReactNode }) {
  return <div className="card pm-stat">{children}</div>;
}

/// Disc light → mid, dark only on the rim, numeral in a deep tone of the
/// same metal (Icon/rank-medal-1/2/3 on the Gamified page).
const METALS = {
  1: { hi: '#FFF0B8', mid: '#F7C94F', lo: '#A8740F', ink: '#7A4E00' },
  2: { hi: '#FAFBFD', mid: '#CDD2DC', lo: '#6E7584', ink: '#434A5A' },
  3: { hi: '#FCDDC2', mid: '#E2AA78', lo: '#7A421C', ink: '#6B3415' },
} as const;
const NUMERALS = {
  1: 'M10.6 10 12.6 8.6v7',
  2: 'M9.8 10.3a2.2 2.2 0 0 1 4.4.2c0 1.8-4.4 2.8-4.4 5h4.4',
  3: 'M9.9 8.7h4.1l-2.2 2.6a2.2 2.2 0 1 1-2 3.3',
} as const;

/// Gold, silver and bronze medal for ranks 1 to 3, with the brand ribbon.
export function RankMedal({ rank, size = 24 }: { rank: 1 | 2 | 3; size?: number }) {
  const c = METALS[rank];
  const id = `pm-medal-${rank}`;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ flex: 'none' }} role="img" aria-label={`Rank ${rank}`}>
      <defs>
        <linearGradient id={id} gradientUnits="userSpaceOnUse" x1="7" y1="8.5" x2="17" y2="22">
          <stop offset="0" stopColor={c.hi} />
          <stop offset="1" stopColor={c.mid} />
        </linearGradient>
      </defs>
      <path d="M6.4 1.4h4.4l2 6.2H8.6z" fill="#1F6FEB" />
      <path d="M17.6 1.4h-4.4l-2 6.2h4.2z" fill="#4CC2FF" />
      <circle cx="12" cy="15.3" r="7.6" fill={`url(#${id})`} stroke={c.lo} strokeWidth="1.1" />
      <path d={NUMERALS[rank]} transform="translate(0 3.3)" stroke={c.ink} strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export const isMedal = (rank: number): rank is 1 | 2 | 3 => rank >= 1 && rank <= 3;
