/**
 * Minimal synchronous SHA-256 implementation (FIPS 180-4) plus the
 * deterministic bucketing helper used for local experiment enrollment.
 *
 * Why vendored and synchronous?
 * - The SDK has zero runtime dependencies, so pulling in a hashing library is
 *   not an option.
 * - WebCrypto (`crypto.subtle.digest`) is asynchronous and is not available in
 *   every environment this SDK runs in: React Native's Hermes engine has no
 *   WebCrypto, and browsers only expose `crypto.subtle` in secure contexts.
 *   A small synchronous implementation works identically in browsers, Node.js,
 *   React Native and Capacitor webviews, and keeps `getVariant()` synchronous.
 *
 * The bucketing algorithm is shared across all MGM SDKs (Swift, Android,
 * Flutter, JS) and is locked down by golden-vector tests - do not change it.
 */

/* eslint-disable no-bitwise -- SHA-256 is inherently bitwise arithmetic */

/**
 * SHA-256 round constants (first 32 bits of the fractional parts of the cube
 * roots of the first 64 primes).
 */
// prettier-ignore
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

/**
 * Compute the SHA-256 digest of a byte array.
 * Returns the 32-byte digest.
 */
export function sha256(message: Uint8Array): Uint8Array {
  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);

  // Pad the message: append 0x80, zeros, then the 64-bit big-endian bit length
  const length = message.length;
  const paddedLength = (((length + 8) >> 6) + 1) << 6; // Multiple of 64 with room for 0x80 + length
  const padded = new Uint8Array(paddedLength);
  padded.set(message);
  padded[length] = 0x80;
  const view = new DataView(padded.buffer);
  // Message lengths in this SDK are far below 2^32 bits, but write both words
  view.setUint32(paddedLength - 8, Math.floor((length * 8) / 0x100000000));
  view.setUint32(paddedLength - 4, (length * 8) >>> 0);

  const w = new Uint32Array(64);

  for (let offset = 0; offset < paddedLength; offset += 64) {
    // Message schedule
    for (let i = 0; i < 16; i++) {
      w[i] = view.getUint32(offset + i * 4);
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    // Compression
    let a = h[0];
    let b = h[1];
    let c = h[2];
    let d = h[3];
    let e = h[4];
    let f = h[5];
    let g = h[6];
    let hh = h[7];

    for (let i = 0; i < 64; i++) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (hh + s1 + ch + K[i] + w[i]) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) >>> 0;

      hh = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h[0] = (h[0] + a) >>> 0;
    h[1] = (h[1] + b) >>> 0;
    h[2] = (h[2] + c) >>> 0;
    h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0;
    h[5] = (h[5] + f) >>> 0;
    h[6] = (h[6] + g) >>> 0;
    h[7] = (h[7] + hh) >>> 0;
  }

  const digest = new Uint8Array(32);
  const digestView = new DataView(digest.buffer);
  for (let i = 0; i < 8; i++) {
    digestView.setUint32(i * 4, h[i]);
  }
  return digest;
}

/**
 * Encode a string as UTF-8 bytes.
 *
 * Implemented by hand (instead of `TextEncoder`) because older React Native
 * Hermes runtimes do not ship `TextEncoder`. Matches WHATWG semantics: lone
 * surrogates are encoded as U+FFFD.
 */
export function utf8Encode(str: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < str.length; i++) {
    let codePoint = str.charCodeAt(i);

    if (codePoint >= 0xd800 && codePoint <= 0xdbff) {
      // High surrogate: combine with the following low surrogate if present
      const next = i + 1 < str.length ? str.charCodeAt(i + 1) : 0;
      if (next >= 0xdc00 && next <= 0xdfff) {
        codePoint = 0x10000 + ((codePoint - 0xd800) << 10) + (next - 0xdc00);
        i++;
      } else {
        codePoint = 0xfffd; // Unpaired surrogate
      }
    } else if (codePoint >= 0xdc00 && codePoint <= 0xdfff) {
      codePoint = 0xfffd; // Unpaired surrogate
    }

    if (codePoint < 0x80) {
      out.push(codePoint);
    } else if (codePoint < 0x800) {
      out.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint < 0x10000) {
      out.push(
        0xe0 | (codePoint >> 12),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f)
      );
    } else {
      out.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f)
      );
    }
  }
  return Uint8Array.from(out);
}

/**
 * Compute the deterministic experiment bucket for a (experiment, user) pair.
 *
 * bucket = first 8 bytes of SHA-256(utf8("<experiment_uuid>:<user_id>"))
 * interpreted as an unsigned big-endian 64-bit integer.
 *
 * The value exceeds Number.MAX_SAFE_INTEGER, so it is returned as a BigInt.
 * The variant is then `variants[bucket % variants.length]`.
 *
 * This algorithm is shared across all MGM SDKs - do not change it.
 */
export function computeExperimentBucket(experimentId: string, userId: string): bigint {
  const digest = sha256(utf8Encode(`${experimentId}:${userId}`));
  let bucket = 0n;
  for (let i = 0; i < 8; i++) {
    bucket = (bucket << 8n) | BigInt(digest[i]);
  }
  return bucket;
}
