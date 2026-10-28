import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ExplorerLink, Icon, Modal, TokenIcon } from '../components/ui';
import { AnyContract, waitForReceipt } from '../lib/chain';
import { formatAmount } from '../lib/format';
import { load, save } from '../lib/storage';
import { Token } from '../lib/tokens';
import { useApp } from './app';
import { useWallet } from './wallet';

type Method = ReturnType<AnyContract['methods'][string]> & { encodeABI: () => string };
type Leg = { token: Token; amount: bigint; label: string };

export type TxRequest = {
  title: string;
  activity: string;
  successTitle: string;
  successText?: string;
  summary?: { from: Leg; to?: Leg; joiner?: 'arrow' | 'plus' };
  /// Short verb for the "Sign …" step, e.g. "swap".
  verb?: string;
  /// Earlier transactions of the same flow already confirmed (approvals).
  prior?: string[];
  /// Contract address and the call on it, built against the read-only client;
  /// only the encoded calldata goes to the wallet.
  build: () => { to: string; method: ReturnType<AnyContract['methods'][string]> };
  value?: bigint;
};

const summaryText = (s: NonNullable<TxRequest['summary']>) => (s.to ? `${legText(s.from)} ${s.joiner === 'plus' ? '+' : 'for'} ${legText(s.to)}` : legText(s.from));
const hex = (n: bigint) => `0x${n.toString(16)}`;

export type Activity = { hash: string; title: string; sub?: string; status: 'pending' | 'success' | 'failed'; time: number; account: string };
type Toast = { id: number; kind: 'success' | 'pending' | 'failed' | 'neutral'; title: string; sub?: string; hash?: string };
type ModalState = { req: TxRequest; status: 'confirm' | 'submitted' | 'success' | 'failed'; hash?: string; error?: TxError };
type TxError = { reason?: string; message: string; rejected?: boolean };

type TxState = {
  send: (req: TxRequest) => Promise<boolean>;
  /// A toast (and, with a hash, an activity row) for a transaction the wallet
  /// did not sign, such as a sponsored faucet claim.
  notify: (t: Omit<Toast, 'id'>) => void;
  activity: Activity[];
  pendingCount: number;
};

const TxContext = createContext<TxState | null>(null);
const ACTIVITY_KEY = 'acorn.activity';

const HINTS: Record<string, string> = {
  INSUFFICIENT_OUTPUT_AMOUNT: 'The price moved more than your max slippage before the swap confirmed.',
  EXCESSIVE_INPUT_AMOUNT: 'The price moved more than your max slippage before the swap confirmed.',
  EXPIRED: 'The transaction was still pending after its deadline.',
  INSUFFICIENT_A_AMOUNT: 'The pool ratio moved more than your max slippage.',
  INSUFFICIENT_B_AMOUNT: 'The pool ratio moved more than your max slippage.',
  INSUFFICIENT_LIQUIDITY: 'The pool does not hold enough liquidity for this trade.',
  TRANSFER_FROM_FAILED: 'A token transfer failed. Check the balance and the approval.',
  INSUFFICIENT_LIQUIDITY_BURNED: 'The amount of liquidity to remove is too small.',
  'Too little received': 'The price moved more than your max slippage before the swap confirmed.',
  'Too much requested': 'The price moved more than your max slippage before the swap confirmed.',
  'Transaction too old': 'The transaction was still pending after its deadline.',
  'Price slippage check': 'The pool price moved more than your max slippage before the deposit confirmed.',
  STF: 'A token transfer failed. Check the balance and the approval.',
  'Not approved': 'This wallet is not allowed to manage the position.',
  'Not cleared': 'Withdraw the liquidity and collect the fees before closing the position.',
  TLU: 'The lower price must be below the upper price.',
  SPL: 'The price limit was reached before the swap finished.',
  AS: 'The swap amount is zero.',
  'PM: slippage': 'The market price moved more than your max slippage before the trade confirmed.',
  'PM: closed': 'The market is closed for trading.',
  'PM: shares': 'You do not hold enough shares to sell that much.',
  'PM: too much': 'The pool cannot pay out that much XP.',
  'PM: nothing': 'There is nothing to claim on this market.',
  'PM: not settled': 'The market has not been resolved or cancelled yet.',
  'XP: balance': 'Your XP balance is too low for this stake.',
  'XP: done': 'This quest is already done today.',
  'XP: no season': 'No Predict season is running.',
};

function explain(e: any): TxError {
  const messages: string[] = [];
  const walk = (x: any, depth = 0) => {
    if (!x || depth > 4) return;
    if (typeof x === 'string') return messages.push(x);
    for (const k of ['message', 'reason', 'shortMessage']) if (typeof x[k] === 'string') messages.push(x[k]);
    walk(x.innerError, depth + 1);
    walk(x.cause, depth + 1);
    walk(x.data, depth + 1);
    walk(x.error, depth + 1);
  };
  walk(e);
  const text = messages.join(' | ');
  const code = e?.code ?? e?.innerError?.code;
  if (code === 4001 || /user (rejected|denied)|rejected the request|request rejected/i.test(text)) {
    return { rejected: true, message: 'Request rejected in the wallet' };
  }
  // The devnet deployment predates the rename and still reverts with "AcornV2…".
  const v2 = text.match(/(?:Pauli|Acorn)V2(?:Router|Library|Pair)?: [A-Z_]+|TransferHelper: [A-Z_]+|SQRCTF1: [A-Za-z_ ]+/)?.[0];
  // Predict reverts carry a short "PM: …" / "XP: …" prefix, which the V3
  // pattern below stops at.
  const predict = text.match(/(?:PM|XP): [a-z][a-z -]*[a-z]/)?.[0];
  if (predict) return { reason: predict, message: HINTS[predict] ?? predict };
  const v3 = text.match(/execution reverted: ([A-Za-z][A-Za-z ]{1,40}?)(?:$|[|"'.,])/)?.[1]?.trim();
  const reason = v2 ?? (v3 && v3 in HINTS ? v3 : v3 && v3.length > 2 ? v3 : undefined);
  const key = v2 ? v2.split(': ')[1] : reason;
  return { reason, message: (key && HINTS[key]) || messages[0] || 'The transaction failed.' };
}

export function TxProvider({ children }: { children: ReactNode }) {
  const { active, account } = useWallet();
  const [modal, setModal] = useState<ModalState | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [activity, setActivity] = useState<Activity[]>(() => load<Activity[]>(ACTIVITY_KEY, []));
  const toastId = useRef(0);

  useEffect(() => save(ACTIVITY_KEY, activity.slice(0, 40)), [activity]);

  const toast = useCallback((t: Omit<Toast, 'id'>, replaceHash?: string) => {
    const id = ++toastId.current;
    setToasts((list) => [{ ...t, id }, ...list.filter((x) => !replaceHash || x.hash !== replaceHash)].slice(0, 4));
    if (t.kind !== 'pending') setTimeout(() => setToasts((list) => list.filter((x) => x.id !== id)), 6000);
  }, []);

  const record = (a: Activity) => setActivity((list) => [a, ...list.filter((x) => x.hash !== a.hash)]);

  const send = useCallback(
    async (req: TxRequest): Promise<boolean> => {
      const provider = active?.provider;
      if (!provider || !account) return false;
      setModal({ req, status: 'confirm' });
      const sub = req.summary ? summaryText(req.summary) : undefined;
      let hash: string | undefined;
      try {
        const { to, method } = req.build();
        const value = req.value ?? 0n;
        // Estimating over HTTP surfaces revert reasons before the wallet prompt;
        // the 20% headroom covers state that moves before inclusion. The wallet
        // requires `gas` and fills nonce and fees itself.
        const gas = BigInt(await method.estimateGas({ from: account, value }));
        const data = (method as Method).encodeABI();
        hash = String(
          await provider.request({
            method: 'qrl_sendTransaction',
            // type 0x2 makes the wallet fill maxFeePerGas / maxPriorityFeePerGas;
            // without it the wallet takes its legacy gasPrice branch and the
            // devnet's EIP-1559 signer rejects the missing fee fields.
            params: [{ from: account, to, data, value: hex(value), gas: hex((gas * 12n) / 10n), type: '0x2' }],
          }),
        );
        const h = hash;
        setModal((m) => (m ? { ...m, status: 'submitted', hash: h } : m));
        record({ hash: h, title: req.activity, sub, status: 'pending', time: Date.now(), account });
        toast({ kind: 'pending', title: req.activity, sub: sub ?? 'Pending', hash: h });
        const receipt = await waitForReceipt(h);
        if (BigInt(receipt.status ?? 1) === 0n) throw new Error('The transaction reverted on chain.');
        setModal((m) => (m ? { ...m, status: 'success' } : m));
        if (hash) record({ hash, title: req.activity, sub, status: 'success', time: Date.now(), account });
        toast({ kind: 'success', title: req.successTitle, sub: sub ?? 'Confirmed', hash }, hash);
        return true;
      } catch (e) {
        const error = explain(e);
        if (error.rejected && !hash) {
          setModal(null);
          toast({ kind: 'neutral', title: error.message });
          return false;
        }
        setModal((m) => (m ? { ...m, status: 'failed', error } : m));
        if (hash) record({ hash, title: req.activity, sub: error.reason ?? sub, status: 'failed', time: Date.now(), account });
        toast({ kind: 'failed', title: 'Transaction failed', sub: error.reason ?? error.message, hash }, hash);
        return false;
      }
    },
    [active, account, toast],
  );

  const notify = useCallback(
    (t: Omit<Toast, 'id'>) => {
      if (t.hash && account && t.kind !== 'neutral') record({ hash: t.hash, title: t.title, sub: t.sub, status: t.kind, time: Date.now(), account });
      toast(t, t.hash);
    },
    [account, toast],
  );

  const mine = activity.filter((a) => a.account === account);

  return (
    <TxContext.Provider value={{ send, notify, activity: mine, pendingCount: mine.filter((a) => a.status === 'pending').length }}>
      {children}
      {modal && <TxModal state={modal} onClose={() => setModal(null)} onRetry={() => send(modal.req)} />}
      {createPortal(
        <div className="toasts" aria-live="polite">
          {toasts.map((t) => (
            <div className="toast" key={t.id}>
              <ToastIcon kind={t.kind} />
              <div className="text">
                <span>{t.title}</span>
                {t.sub && <span>{t.sub}</span>}
              </div>
              <button className="close" onClick={() => setToasts((l) => l.filter((x) => x.id !== t.id))} aria-label="Dismiss">
                <Icon name="close" size={16} />
              </button>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </TxContext.Provider>
  );
}

function ToastIcon({ kind }: { kind: Toast['kind'] }) {
  if (kind === 'success') return <Icon name="circle-check" size={24} className="c-success" />;
  if (kind === 'failed') return <Icon name="circle-x" size={24} className="c-alert" />;
  if (kind === 'pending') return <Icon name="loader" size={24} className="c-quantum spin" />;
  return <Icon name="info" size={24} className="c-2" />;
}

const legText = (l: Leg) => `${formatAmount(l.amount, l.token.decimals)} ${l.label}`;

function Summary({ summary }: { summary?: TxRequest['summary'] }) {
  if (!summary) return null;
  const leg = (l: Leg) => (
    <span className="row" style={{ gap: 8 }}>
      <TokenIcon token={l.token} size={20} />
      <span className="t-num-strong">{legText(l)}</span>
    </span>
  );
  return (
    <div className="row" style={{ gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
      {leg(summary.from)}
      {summary.to && (
        <>
          <Icon name={summary.joiner === 'plus' ? 'plus' : 'chevron-right'} size={16} className="c-3" />
          {leg(summary.to)}
        </>
      )}
    </div>
  );
}

type StepState = 'done' | 'active' | 'todo' | 'failed';
function Step({ state, title, sub }: { state: StepState; title: string; sub: string }) {
  const icon = { done: 'circle-check', active: 'loader', todo: 'clock', failed: 'circle-x' }[state] as 'loader';
  const tone = { done: 'c-success', active: 'c-quantum spin', todo: 'c-3', failed: 'c-alert' }[state];
  return (
    <div className="row" style={{ gap: 12 }}>
      <Icon name={icon} size={22} className={tone} />
      <span className={`col ${state === 'todo' ? 'c-3' : ''}`} style={{ gap: 2 }}>
        <span className="t-body-strong">{title}</span>
        <span className="t-caption c-3">{sub}</span>
      </span>
    </div>
  );
}

function TxModal({ state, onClose, onRetry }: { state: ModalState; onClose: () => void; onRetry: () => void }) {
  const { req, status, hash, error } = state;
  const { clock } = useApp();
  const { active } = useWallet();
  const walletName = active?.info.name === 'QRLWeb3Wallet' || !active ? 'QRL Web3 Wallet' : active.info.name;
  const blockSecs = Math.max(1, Math.round(clock.secondsPerBlock));

  if (status === 'success' || status === 'failed') {
    const ok = status === 'success';
    return (
      <Modal onClose={onClose} width={440} center>
        <div className="status-block">
          <Icon name={ok ? 'circle-check' : 'circle-x'} size={56} className={ok ? 'c-success' : 'c-alert'} />
          <span className="t-title">{ok ? req.successTitle : 'Transaction failed'}</span>
          {ok ? <Summary summary={req.summary} /> : <span className="t-body c-2">{error?.message}</span>}
          {!ok && error?.reason && <span className="badge badge-alert">{error.reason}</span>}
          {hash && <ExplorerLink hash={hash} />}
        </div>
        {ok ? (
          <button className="btn btn-lg btn-primary" onClick={onClose}>
            Done
          </button>
        ) : (
          <div className="row">
            <button className="btn btn-lg btn-tertiary grow" onClick={onClose}>
              Close
            </button>
            <button className="btn btn-lg btn-primary grow" onClick={onRetry}>
              Try again
            </button>
          </div>
        )}
      </Modal>
    );
  }

  const signing = status === 'confirm';
  return (
    <Modal title={req.title} onClose={onClose} width={440} center>
      <div className="status-block">
        <Icon name="loader" size={56} className="c-quantum spin" />
        <span className="t-heading">{signing ? `Confirm in ${walletName}` : 'Waiting for the block'}</span>
        <Summary summary={req.summary} />
      </div>
      <div className="steps">
        {req.prior?.map((p) => <Step key={p} state="done" title={p} sub="Done · one-time per token" />)}
        <Step state={signing ? 'active' : 'done'} title={req.verb ? `Sign ${req.verb}` : 'Sign transaction'} sub={signing ? 'Waiting for wallet signature' : 'Signed'} />
        <Step state={signing ? 'todo' : 'active'} title="Wait for block" sub={`About ${blockSecs} s per block on QRL Devnet`} />
      </div>
    </Modal>
  );
}

export function useTx() {
  const ctx = useContext(TxContext);
  if (!ctx) throw new Error('useTx outside TxProvider');
  return ctx;
}
