/// Client for pauli-swap-indexer's GraphQL API. Optional: with
/// VITE_INDEXER_URL unset, or when the indexer is unreachable, reports errors,
/// or trails the RPC head by more than VITE_INDEXER_MAX_LAG blocks, every
/// caller falls back to reading the chain directly.

const URL = (import.meta.env.VITE_INDEXER_URL as string | undefined) || '';
const MAX_LAG = Number(import.meta.env.VITE_INDEXER_MAX_LAG ?? 20);
const CHECK_MS = 4000;

export const indexerConfigured = !!URL;

export async function gql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query, variables }) });
  if (!res.ok) throw new Error(`indexer HTTP ${res.status}`);
  const body = await res.json();
  if (body.errors) throw new Error(body.errors[0]?.message ?? 'indexer error');
  return body.data as T;
}

let checked: { at: number; head: number; block: number | null } | null = null;
let pending: Promise<number | null> | null = null;

/// The last block the indexer has fully indexed, or null when it should not
/// be used for a chain whose head is `head`.
export function indexerBlock(head: number): Promise<number | null> {
  if (!URL) return Promise.resolve(null);
  if (checked && Date.now() - checked.at < CHECK_MS && checked.head >= head - 1) return Promise.resolve(checked.block);
  if (!pending) {
    pending = gql<{ _meta: { block: number; hasIndexingErrors: boolean } }>('{ _meta { block hasIndexingErrors } }')
      .then(({ _meta }) => (!_meta.hasIndexingErrors && head - _meta.block <= MAX_LAG ? _meta.block : null))
      .catch(() => null)
      .then((block) => {
        checked = { at: Date.now(), head, block };
        pending = null;
        return block;
      });
  }
  return pending;
}

/// The indexer renders addresses checksummed, like the node's transaction
/// fields; values decoded from logs on the RPC path are lowercase. Fields that
/// stand in for decoded values go through this so both paths look the same.
export const asDecoded = (address: string) => 'Q' + address.slice(1).toLowerCase();

/// Pages through a list field (`first` is capped at 1000 by the API).
export async function gqlAll<T>(field: string, query: string, variables: Record<string, unknown>): Promise<T[]> {
  const out: T[] = [];
  for (let skip = 0; ; skip += 1000) {
    const page = (await gql<Record<string, T[]>>(query, { ...variables, skip }))[field];
    out.push(...page);
    if (page.length < 1000) return out;
  }
}
