import { useEffect, useState } from 'react';
import { NoteBar, SubBar } from '../components/Header';
import { IconButton, Seg, TokenIcon } from '../components/ui';
import devnet from '../contracts/devnet.json';
import { ADDRESSES, CHAIN } from '../config';
import { useBalances } from '../hooks/chain';
import { useNames } from '../hooks/names';
import { contract, sameAddress, shortAddress } from '../lib/chain';
import { formatAmount, formatPrice } from '../lib/format';
import { go } from '../lib/router';
import { Token, tokenKey } from '../lib/tokens';
import { useApp } from '../state/app';
import { useTx } from '../state/tx';
import { useWallet } from '../state/wallet';

const FAUCET_ABI = [
  { inputs: [], name: 'faucet', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [], name: 'faucetAmount', outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
];
const COLS = 'minmax(200px, 1fr) 120px 80px 140px 150px';

export function Explore() {
  const { tokens, pools, priceInQrl, openModal } = useApp();
  const { account } = useWallet();
  const { send } = useTx();
  const { sym } = useNames();
  const [tab, setTab] = useState<'Tokens' | 'Contracts'>('Tokens');
  const balanceOf = useBalances(tokens, account);
  const [faucets, setFaucets] = useState<Record<string, bigint>>({});

  // Devnet test tokens expose faucet(); anything else simply has no button.
  useEffect(() => {
    tokens.forEach((t) => {
      if (t.native || sameAddress(t.address, ADDRESSES.WQRL) || faucets[tokenKey(t)] !== undefined) return;
      (contract(FAUCET_ABI as any, t.address) as any).methods
        .faucetAmount()
        .call()
        .then((v: bigint) => setFaucets((m) => ({ ...m, [tokenKey(t)]: BigInt(v) })))
        .catch(() => setFaucets((m) => ({ ...m, [tokenKey(t)]: 0n })));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokens]);

  const claim = (t: Token) =>
    send({
      title: `Get test ${sym(t)}`,
      activity: `Claimed ${formatAmount(faucets[tokenKey(t)], t.decimals)} ${sym(t)} from the faucet`,
      successTitle: 'Tokens received',
      build: () => ({ to: t.address, method: (contract(FAUCET_ABI as any, t.address) as any).methods.faucet() }),
    });

  const poolCount = (t: Token) => pools.filter((p) => !t.native && (sameAddress(p.token0, t.address) || sameAddress(p.token1, t.address))).length;
  const contracts = Object.entries(devnet.contracts).filter(([k]) => !k.startsWith('PoolCode'));

  return (
    <>
      <SubBar icon="search" context="Explore" detail={`${CHAIN.name} · chain ${CHAIN.id}`} meta={`${tokens.length} tokens · ${pools.length} pools · deployed ${new Date(devnet.deployedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })} from block ${devnet.startBlock}`} />
      <div className="body">
        <main className="canvas">
          <div className="row">
            <Seg options={['Tokens', 'Contracts'] as const} value={tab} onChange={setTab} />
          </div>
          {tab === 'Tokens' ? (
            <div className="table" style={{ ['--table-min' as string]: '620px' }}>
              <div className="tr head" style={{ gridTemplateColumns: COLS }}>
                <span>Token</span>
                <span className="num">Price (QRL)</span>
                <span className="num">Pools</span>
                <span className="num">Your balance</span>
                <span />
              </div>
              {tokens.map((t) => {
                const price = t.native ? 1 : priceInQrl(t);
                const faucet = faucets[tokenKey(t)];
                return (
                  <div key={tokenKey(t)} className="tr" style={{ gridTemplateColumns: COLS }}>
                    <span className="row" style={{ gap: 10, minWidth: 0 }}>
                      <TokenIcon token={t} size={28} />
                      <span className="col" style={{ gap: 0, minWidth: 0 }}>
                        <span className="t-body-strong">{sym(t)}</span>
                        <span className="t-mono c-4 ellipsis">{t.native ? 'Native coin' : `${t.name} · ${shortAddress(t.address, 6)}`}</span>
                      </span>
                    </span>
                    <span className="num t-mono-strong">{price !== undefined ? formatPrice(price) : '—'}</span>
                    <span className="num t-mono c-2">{t.native ? '—' : poolCount(t)}</span>
                    <span className="num t-mono c-2">{account ? formatAmount(balanceOf(t), t.decimals) : '—'}</span>
                    <span className="row" style={{ justifyContent: 'flex-end' }}>
                      {!t.native && <IconButton icon="copy" label="Copy address" onClick={() => navigator.clipboard?.writeText(t.address)} />}
                      {faucet !== undefined && faucet > 0n ? (
                        <button className="btn btn-sm btn-secondary" onClick={() => (account ? claim(t) : openModal('connect'))}>
                          Get {formatAmount(faucet, t.decimals)}
                        </button>
                      ) : (
                        <button className="btn btn-sm btn-ghost" onClick={() => go({ page: 'swap' }, { outputCurrency: t.native ? 'QRL' : t.address })}>
                          Trade
                        </button>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="table" style={{ ['--table-min' as string]: '520px' }}>
              {contracts.map(([k, v]) => (
                <div key={k} className="tr" style={{ gridTemplateColumns: '220px 1fr 40px' }}>
                  <span className="t-body-strong">{k}</span>
                  <span className="t-mono c-2 ellipsis">{v}</span>
                  <IconButton icon="copy" label={`Copy ${k} address`} onClick={() => navigator.clipboard?.writeText(v)} />
                </div>
              ))}
            </div>
          )}
        </main>
        <aside className="inspector after">
          <section className="card" style={{ padding: 16, gap: 10 }}>
            <span className="t-heading">How PauliSwap runs on QRL</span>
            <span className="t-body c-2">PauliSwap is Uniswap V2 and V3 ported to Hyperion for the QRL Zond chain, with 64 byte addresses and post-quantum ML-DSA-87 signatures.</span>
            <ul className="t-body c-2" style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <li>Swaps route through V2 pairs and V3 pools and take whichever pays more.</li>
              <li>Zond has no permit signatures, so every token needs one approval per router or position manager.</li>
              <li>V3 positions are NFTs held by your wallet; fees accrue until you collect them.</li>
              <li>Test tokens with a faucet can be claimed here for free on the devnet.</li>
            </ul>
          </section>
        </aside>
      </div>
      <NoteBar>Devnet only: tokens and pools here have no value and the chain can be reset.</NoteBar>
    </>
  );
}
