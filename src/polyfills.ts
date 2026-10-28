import { Buffer } from 'buffer';

// Must load before @theqrl/web3, which reads the Node globals at import time.
const g = globalThis as unknown as { Buffer?: typeof Buffer };
g.Buffer ??= Buffer;
