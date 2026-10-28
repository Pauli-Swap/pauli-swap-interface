import { reader } from './chain';

export type DecodedEvent = {
  event: string;
  returnValues: Record<string, any>;
  blockNumber: number;
  logIndex: number;
  transactionHash: string;
};

type AbiEvent = { type: string; name: string; inputs: { name: string; type: string; indexed: boolean }[] };

/// QRVM topics are 64 byte words: the keccak256 event signature is right
/// padded with zeros, and indexed values are left padded. web3 1.0.3 still
/// builds 32 byte topic filters, which the node rejects, so filters are
/// built here and only decoding is left to web3.
const word = (hex: string, side: 'left' | 'right') => {
  const body = hex.replace(/^0x/i, '');
  return '0x' + (side === 'right' ? body.padEnd(128, '0') : body.padStart(128, '0'));
};
export const uintTopic = (value: bigint | number | string) => word(BigInt(value).toString(16), 'left');

export async function getEvents(
  abi: readonly unknown[],
  address: string,
  names: string[],
  fromBlock: number,
  toBlock: number | 'latest',
  topic1?: string,
): Promise<DecodedEvent[]> {
  const events = (abi as AbiEvent[]).filter((x) => x.type === 'event' && names.includes(x.name));
  const bySig = new Map<string, AbiEvent>();
  for (const e of events) {
    const sig = reader.qrl.abi.encodeEventSignature(e as any);
    bySig.set(word(sig, 'right').toLowerCase(), e);
  }
  const topics: (string | string[] | null)[] = [[...bySig.keys()]];
  if (topic1) topics.push(topic1);
  // Straight to the request manager: web3's filter validator also insists on
  // 32 byte topics.
  const hex = (n: number | 'latest') => (n === 'latest' ? n : '0x' + n.toString(16));
  const logs: any[] = await (reader as any).requestManager.send({
    method: 'qrl_getLogs',
    params: [{ address, fromBlock: hex(fromBlock), toBlock: hex(toBlock), topics }],
  });
  return logs.flatMap((l) => {
    const e = bySig.get(String(l.topics?.[0] ?? '').toLowerCase());
    if (!e) return [];
    const returnValues = reader.qrl.abi.decodeLog(e.inputs as any, l.data, l.topics.slice(1));
    return [{ event: e.name, returnValues, blockNumber: Number(l.blockNumber), logIndex: Number(l.logIndex), transactionHash: String(l.transactionHash) }];
  });
}
