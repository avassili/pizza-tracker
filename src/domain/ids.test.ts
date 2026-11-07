import { describe, expect, it } from "vitest";
import { CROCKFORD, encodeTime, publicToken, ulid } from "./ids";

const ALPHABET = new RegExp(`^[${CROCKFORD}]+$`);
const ULID_RE = new RegExp(`^[${CROCKFORD}]{26}$`);

describe("ulid", () => {
  it("produces 26 Crockford base32 characters", () => {
    const id = ulid(1_700_000_000_000);
    expect(id).toHaveLength(26);
    expect(ULID_RE.test(id)).toBe(true);
    expect(ALPHABET.test(id)).toBe(true);
  });

  it("keeps the first character inside 0-7 for 48-bit timestamps", () => {
    for (let i = 0; i < 50; i += 1) {
      expect(ulid(1_700_000_000_000)[0] <= "7").toBe(true);
    }
  });

  it("is strictly increasing within a single millisecond", () => {
    const ids = Array.from({ length: 200 }, () => ulid(1_700_000_000_000));
    const sorted = [...ids].sort();
    expect(ids).toEqual(sorted);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("orders by timestamp across milliseconds", () => {
    const earlier = ulid(1_700_000_000_000);
    const later = ulid(1_700_000_001_000);
    expect(earlier < later).toBe(true);
  });

  it("encodes time deterministically", () => {
    expect(encodeTime(0)).toBe("0000000000");
    expect(encodeTime(1_700_000_000_000)).toBe(encodeTime(1_700_000_000_000));
  });
});

describe("publicToken", () => {
  it("is 26 characters of the Crockford alphabet", () => {
    const token = publicToken();
    expect(token).toHaveLength(26);
    expect(ULID_RE.test(token)).toBe(true);
  });

  it("does not repeat across 10k draws", () => {
    const tokens = new Set<string>();
    for (let i = 0; i < 10_000; i += 1) {
      tokens.add(publicToken());
    }
    expect(tokens.size).toBe(10_000);
  });

  it("is unrelated to the order id it protects", () => {
    const orderId = ulid(1_700_000_000_000);
    const token = publicToken();
    expect(token).not.toBe(orderId);
    expect(token.slice(0, 10)).not.toBe(encodeTime(1_700_000_000_000));
  });
});
