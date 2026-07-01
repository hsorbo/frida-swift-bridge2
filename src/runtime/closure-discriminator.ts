// Reproduces SILFunctionType::getPointerAuthDiscriminator: SipHash-2-4 of the lowered SIL function-type string, reduced to 16 bits.
const SIPHASH_KEY = [
  0xb5, 0xd4, 0xc9, 0xeb, 0x79, 0x10, 0x4a, 0x79, 0x6f, 0xec, 0x8b, 0x1b, 0x42, 0x87, 0x81, 0xd4,
];

const MASK = (1n << 64n) - 1n;

function le64(bytes: number[], offset: number): bigint {
  let x = 0n;
  for (let j = 0; j < 8; j++) {
    x |= BigInt(bytes[offset + j]) << (8n * BigInt(j));
  }
  return x;
}

const K0 = le64(SIPHASH_KEY, 0);
const K1 = le64(SIPHASH_KEY, 8);

function rotl(x: bigint, b: bigint): bigint {
  return ((x << b) | (x >> (64n - b))) & MASK;
}

function sipHash24(bytes: number[]): bigint {
  let v0 = (0x736f6d6570736575n ^ K0) & MASK;
  let v1 = (0x646f72616e646f6dn ^ K1) & MASK;
  let v2 = (0x6c7967656e657261n ^ K0) & MASK;
  let v3 = (0x7465646279746573n ^ K1) & MASK;
  const round = (): void => {
    v0 = (v0 + v1) & MASK; v1 = rotl(v1, 13n); v1 ^= v0; v0 = rotl(v0, 32n);
    v2 = (v2 + v3) & MASK; v3 = rotl(v3, 16n); v3 ^= v2;
    v0 = (v0 + v3) & MASK; v3 = rotl(v3, 21n); v3 ^= v0;
    v2 = (v2 + v1) & MASK; v1 = rotl(v1, 17n); v1 ^= v2; v2 = rotl(v2, 32n);
  };
  const n = bytes.length;
  const end = n - (n % 8);
  for (let i = 0; i < end; i += 8) {
    let m = 0n;
    for (let j = 0; j < 8; j++) {
      m |= BigInt(bytes[i + j]) << (8n * BigInt(j));
    }
    v3 ^= m; round(); round(); v0 ^= m;
  }
  let last = BigInt(n & 0xff) << 56n;
  for (let j = 0; j < n % 8; j++) {
    last |= BigInt(bytes[end + j]) << (8n * BigInt(j));
  }
  v3 ^= last; round(); round(); v0 ^= last;
  v2 ^= 0xffn; round(); round(); round(); round();
  return (v0 ^ v1 ^ v2 ^ v3) & MASK;
}

export const INDIRECT = "-indirect";

export function closureHashString(params: string[], results: string[]): string {
  let s = `function:${params.length}:`;
  for (const p of params) s += `${p}:`;
  s += `${results.length}:`;
  for (const r of results) s += `${r}:`;
  return s;
}

export function closureDiscriminator(hashString: string): number {
  const bytes: number[] = [];
  for (let i = 0; i < hashString.length; i++) {
    bytes.push(hashString.charCodeAt(i) & 0xff);
  }
  return Number((sipHash24(bytes) % 0xffffn) + 1n);
}
