/// JSON-RPC transport for the read-only client. Every call made within one
/// short window goes out as a single batch POST, and identical calls in that
/// window share one entry. A block refresh fires ~100 reads at once; one at a
/// time they queue behind the browser's six connections per origin at ~0.3 s
/// each, while one batch of them returns in about the time of a single call.

type Payload = { jsonrpc: '2.0'; id: string | number; method: string; params?: unknown };
type Response = { jsonrpc: '2.0'; id: string | number; result?: unknown; error?: unknown };
type Waiter = { payload: Payload; resolve: (r: Response) => void; reject: (e: unknown) => void };

const WINDOW_MS = 4;
const MAX_BATCH = 60;

export class BatchProvider {
  private queue: Waiter[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly url: string) {}

  // Must stay an async function: web3 treats providers whose `request` is an
  // AsyncFunction as EIP-1193 and passes the full payload through.
  async request(payload: Payload): Promise<Response> {
    if (Array.isArray(payload)) return this.post(payload as unknown as Payload[]) as unknown as Response;
    return new Promise<Response>((resolve, reject) => {
      this.queue.push({ payload, resolve, reject });
      if (this.queue.length >= MAX_BATCH) this.flush();
      else if (!this.timer) this.timer = setTimeout(() => this.flush(), WINDOW_MS);
    });
  }

  private flush() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const waiters = this.queue.splice(0, this.queue.length);
    for (let i = 0; i < waiters.length; i += MAX_BATCH) this.send(waiters.slice(i, i + MAX_BATCH));
  }

  private async send(waiters: Waiter[]) {
    // Identical method + params in one window are asked once.
    const groups = new Map<string, Waiter[]>();
    for (const w of waiters) {
      const key = `${w.payload.method}:${JSON.stringify(w.payload.params ?? [])}`;
      groups.set(key, [...(groups.get(key) ?? []), w]);
    }
    const unique = [...groups.values()];
    const batch = unique.map((g, i) => ({ ...g[0].payload, id: i }));
    try {
      const responses = await this.post(batch);
      const byId = new Map(responses.map((r) => [Number(r.id), r]));
      unique.forEach((g, i) => {
        const r = byId.get(i);
        for (const w of g) {
          if (r) w.resolve({ ...r, id: w.payload.id });
          else w.reject(new Error(`No response for ${w.payload.method}`));
        }
      });
    } catch (e) {
      for (const w of waiters) w.reject(e);
    }
  }

  private async post(body: unknown[]): Promise<Response[]> {
    const res = await fetch(this.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`RPC HTTP ${res.status}`);
    const json = await res.json();
    if (!Array.isArray(json)) throw new Error((json as Response)?.error ? JSON.stringify((json as Response).error) : 'RPC returned a non-batch response');
    return json;
  }
}
