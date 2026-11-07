/**
 * ULID and public-token generation with zero dependencies.
 * See docs/TACTICAL-DESIGN.md §4.2 and §5.2.
 *
 * ULID = 10 chars of Crockford base32 timestamp (48 bits) + 16 random chars
 * (80 bits), monotonically increasing inside a single millisecond.
 */

export const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

const TIME_CHARS = 10;
const RANDOM_BYTES = 10;
const RANDOM_CHARS = 16;
const TOKEN_BYTES = 16;
const TOKEN_CHARS = 26;

let lastTime = -1;
let lastRandom: Uint8Array | null = null;

function randomBytes(length: number): Uint8Array {
  const webcrypto = globalThis.crypto;
  if (!webcrypto || typeof webcrypto.getRandomValues !== "function") {
    throw new Error("crypto.getRandomValues is unavailable in this runtime");
  }
  const bytes = new Uint8Array(length);
  webcrypto.getRandomValues(bytes);
  return bytes;
}

/** Encode bytes as Crockford base32, padded/truncated to `length` chars. */
function base32(bytes: Uint8Array, length: number): string {
  const chars: string[] = [];
  let buffer = 0;
  let bits = 0;

  for (let i = 0; i < bytes.length; i += 1) {
    buffer = (buffer << 8) | bytes[i];
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      chars.push(CROCKFORD[(buffer >>> bits) & 31]);
    }
    // Drop the bits already emitted so the buffer never overflows 32 bits.
    buffer &= (1 << bits) - 1;
  }
  if (bits > 0) {
    chars.push(CROCKFORD[(buffer << (5 - bits)) & 31]);
  }

  const encoded = chars.join("");
  if (encoded.length === length) return encoded;
  return encoded.length > length
    ? encoded.slice(0, length)
    : encoded.padEnd(length, CROCKFORD[0]);
}

/** 48-bit millisecond timestamp -> 6 big-endian bytes. */
function timeBytes(ms: number): Uint8Array {
  const bytes = new Uint8Array(6);
  let remaining = Math.max(0, Math.floor(ms));
  for (let i = 5; i >= 0; i -= 1) {
    bytes[i] = remaining % 256;
    remaining = Math.floor(remaining / 256);
  }
  return bytes;
}

/** Increment a byte array in place; false on overflow. */
function increment(bytes: Uint8Array): boolean {
  for (let i = bytes.length - 1; i >= 0; i -= 1) {
    if (bytes[i] < 255) {
      bytes[i] += 1;
      return true;
    }
    bytes[i] = 0;
  }
  return false;
}

export function encodeTime(ms: number): string {
  return base32(timeBytes(ms), TIME_CHARS);
}

/**
 * Generate a ULID. `nowMs` is injected so the domain stays deterministic;
 * repeated calls within the same millisecond still produce strictly
 * increasing ids thanks to the monotonic random component.
 */
export function ulid(nowMs: number = Date.now()): string {
  const time = Math.max(Math.floor(nowMs), lastTime);

  let rand: Uint8Array;
  if (time === lastTime && lastRandom) {
    rand = lastRandom;
    if (!increment(rand)) {
      // Astronomically unlikely: fall through to the next millisecond.
      rand = randomBytes(RANDOM_BYTES);
      lastTime = time + 1;
      lastRandom = rand;
      return encodeTime(lastTime) + base32(rand, RANDOM_CHARS);
    }
  } else {
    rand = randomBytes(RANDOM_BYTES);
  }

  lastTime = time;
  lastRandom = rand;
  return encodeTime(time) + base32(rand, RANDOM_CHARS);
}

/**
 * Public capability token embedded in customer-facing URLs.
 * 128 bits of entropy, deliberately NOT derived from the order id so that
 * tokens cannot be enumerated or correlated with creation time.
 */
export function publicToken(): string {
  return base32(randomBytes(TOKEN_BYTES), TOKEN_CHARS);
}

/** @internal test seam — resets the monotonic ULID state. */
export function resetIdState(): void {
  lastTime = -1;
  lastRandom = null;
}
