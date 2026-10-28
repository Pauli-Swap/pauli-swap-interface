import { useEffect, useRef, useState } from 'react';
import { MenuButton, Stepper } from '../components/pool/common';
import { PairStep } from '../components/pool/PairStep';
import { V2Deposit } from '../components/pool/V2Deposit';
import { V3Deposit } from '../components/pool/V3Deposit';
import { SettingsButton } from '../components/SettingsPopover';
import { TokenSelectModal } from '../components/TokenSelectModal';
import { Crumbs, Icon } from '../components/ui';
import { ADDRESSES } from '../config';
import { isQAddress, sameAddress } from '../lib/chain';
import { href, query } from '../lib/router';
import { fetchTokenMetadata, NATIVE, sameToken, Token, wrappedAddress } from '../lib/tokens';
import { FEE_TIERS } from '../lib/v3';
import { useApp } from '../state/app';
import '../styles/pool.css';

type Version = 'v2' | 'v3';

/// Writes the form state back into the hash so links and reloads keep it.
function syncQuery(version: Version, a: Token | null, b: Token | null, fee: number) {
  const q = new URLSearchParams();
  q.set('version', version);
  if (a) q.set('tokenA', a.native ? 'QRL' : a.address);
  if (b) q.set('tokenB', b.native ? 'QRL' : b.address);
  if (version === 'v3') q.set('fee', String(fee));
  const next = `${href({ page: 'newPosition' })}?${q}`;
  if (window.location.hash !== next) window.history.replaceState(null, '', next);
}

/// New position: V3 pair & fee (95:604) → range & deposit (95:768); V2 pair → deposit (95:1065).
export function NewPosition() {
  const { tokens, tokensLoading, pools } = useApp();
  const [version, setVersion] = useState<Version>(() => (query().get('version') === 'v2' ? 'v2' : 'v3'));
  const [tokenA, setTokenA] = useState<Token | null>(NATIVE);
  const [tokenB, setTokenB] = useState<Token | null>(null);
  const [fee, setFee] = useState<number>(3000);
  const [step, setStep] = useState(0);
  const [selecting, setSelecting] = useState<'A' | 'B' | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const linked = useRef(false);

  // Query params preselect the pair; with both tokens the form opens on step 2.
  useEffect(() => {
    if (linked.current || tokensLoading) return;
    linked.current = true;
    const q = query();
    const resolve = async (v: string | null) => {
      if (!v) return null;
      if (/^(qrl|native)$/i.test(v) || (isQAddress(v) && sameAddress(v, ADDRESSES.WQRL))) return NATIVE;
      if (!isQAddress(v)) return null;
      return tokens.find((t) => !t.native && sameAddress(t.address, v)) ?? (await fetchTokenMetadata(v).catch(() => null));
    };
    Promise.all([resolve(q.get('tokenA')), resolve(q.get('tokenB'))]).then(([a, b]) => {
      if (a) setTokenA(a);
      if (b && !sameToken(a ?? NATIVE, b)) {
        setTokenB(b);
        setStep(1);
      }
      const f = Number(q.get('fee'));
      if (FEE_TIERS.some((t) => t.fee === f)) setFee(f);
    });
  }, [tokens, tokensLoading]);

  // Default partner for QRL: the token of the deepest pool against WQRL.
  useEffect(() => {
    if (tokenB || tokensLoading || query().get('tokenB') || !linked.current) return;
    const best = pools
      .filter((p) => p.version === version && (sameAddress(p.token0, ADDRESSES.WQRL) || sameAddress(p.token1, ADDRESSES.WQRL)))
      .sort((x, y) => (y.reserve0 + y.reserve1 > x.reserve0 + x.reserve1 ? 1 : -1))[0];
    const address = best ? (sameAddress(best.token0, ADDRESSES.WQRL) ? best.token1 : best.token0) : null;
    const other = (address && tokens.find((t) => !t.native && sameAddress(t.address, address))) || tokens.find((t) => !t.native && !sameAddress(t.address, ADDRESSES.WQRL));
    if (other) {
      setTokenB(other);
      if (best && version === 'v3') setFee(best.fee);
    }
  }, [tokens, tokensLoading, tokenB, pools, version]);

  useEffect(() => {
    if (linked.current) syncQuery(version, tokenA, tokenB, fee);
  }, [version, tokenA, tokenB, fee]);

  const valid = !!tokenA && !!tokenB && !sameAddress(wrappedAddress(tokenA), wrappedAddress(tokenB));
  const select = (t: Token) => {
    if (selecting === 'A') {
      if (sameToken(t, tokenB)) setTokenB(tokenA);
      setTokenA(t);
    } else {
      if (sameToken(t, tokenA)) setTokenA(tokenB);
      setTokenB(t);
    }
    setSelecting(null);
    setResetKey((k) => k + 1);
  };

  const steps =
    version === 'v3'
      ? [
          { title: 'Select pair and fee tier', sub: 'Choose two tokens and a fee tier.', onClick: () => setStep(0) },
          { title: 'Set range and deposit', sub: 'Choose where your liquidity is active.' },
        ]
      : [
          { title: 'Select pair', sub: 'Choose the two tokens of the pool.', onClick: () => setStep(0) },
          { title: 'Deposit tokens', sub: 'V2 liquidity covers the full price range.' },
        ];

  return (
    <main className="page np-page">
      <Crumbs items={[{ label: 'Your positions', href: href({ page: 'positions' }) }, { label: 'New position' }]} />
      <div className="title-row">
        <h1 className="t-headline grow">New position</h1>
        <button className="pill-btn c-2" onClick={() => setResetKey((k) => k + 1)}>
          <Icon name="refresh" size={16} /> Reset
        </button>
        <MenuButton
          className="pill-btn"
          trigger={
            <>
              {version === 'v3' ? 'V3 position' : 'V2 position'} <Icon name="chevron-down" size={16} className="c-3" />
            </>
          }
          items={[
            { label: 'V3 position', sub: 'Concentrated liquidity', on: version === 'v3', onClick: () => setVersion('v3') },
            { label: 'V2 position', sub: 'Full range · 0.3% fee', on: version === 'v2', onClick: () => setVersion('v2') },
          ]}
        />
        <SettingsButton title="Transaction settings" routing={false} />
      </div>
      <div className="np-columns">
        <Stepper steps={steps} active={step} />
        <div className="np-form">
          {step === 0 || !valid ? (
            <PairStep version={version} tokenA={tokenA} tokenB={tokenB} fee={fee} onFee={setFee} onPick={setSelecting} onContinue={() => setStep(1)} />
          ) : version === 'v3' ? (
            <V3Deposit key={`${resetKey}-${fee}`} tokenA={tokenA!} tokenB={tokenB!} fee={fee} onEdit={() => setStep(0)} onPick={setSelecting} />
          ) : (
            <V2Deposit key={resetKey} tokenA={tokenA!} tokenB={tokenB!} onEdit={() => setStep(0)} onPick={setSelecting} />
          )}
        </div>
      </div>
      {selecting && (
        <TokenSelectModal
          selected={selecting === 'A' ? tokenA : tokenB}
          other={selecting === 'A' ? tokenB : tokenA}
          onSelect={select}
          onClose={() => setSelecting(null)}
        />
      )}
    </main>
  );
}
