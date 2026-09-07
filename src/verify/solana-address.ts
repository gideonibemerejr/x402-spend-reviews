/**
 * Solana addresses: base58 codec and associated-token-account derivation.
 *
 * Hand-rolled rather than pulled from `@solana/kit`, for the same reason
 * `rpc.ts` speaks JSON-RPC over `fetch`: the server needs three primitives —
 * base58, SHA-256, and an ed25519 on-curve test — and a web3 client library
 * would bring a wallet, a transaction builder and a connection pool along for
 * the ride. What is here is the whole of what a PDA needs.
 */

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const DIGIT = new Map([...ALPHABET].map((character, index) => [character, index] as const));

/** Length of an ed25519 public key, and so of every Solana address. */
export const PUBKEY_BYTES = 32;

/** Decodes base58 text. Returns `undefined` for any character outside the alphabet. */
export function decodeBase58(value: string): Uint8Array | undefined {
  if (value.length === 0) return undefined;
  const bytes: number[] = [];
  for (const character of value) {
    let carry = DIGIT.get(character);
    if (carry === undefined) return undefined;
    for (let i = 0; i < bytes.length; i += 1) {
      carry += bytes[i]! * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  // A leading '1' is a leading zero byte, which the arithmetic above cannot carry.
  for (let i = 0; i < value.length && value[i] === "1"; i += 1) bytes.push(0);
  return Uint8Array.from(bytes.reverse());
}

/** Encodes bytes as base58. */
export function encodeBase58(bytes: Uint8Array): string {
  const digits: number[] = [];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i += 1) {
      carry += digits[i]! << 8;
      digits[i] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let out = "";
  for (const byte of bytes) {
    if (byte !== 0) break;
    out += "1";
  }
  for (let i = digits.length - 1; i >= 0; i -= 1) out += ALPHABET[digits[i]!];
  return out;
}

/** Decodes an address, insisting it is exactly one 32-byte public key. */
export function decodePubkey(value: string): Uint8Array | undefined {
  const bytes = decodeBase58(value);
  return bytes && bytes.length === PUBKEY_BYTES ? bytes : undefined;
}

/** Whether a string is a well-formed 32-byte base58 address. */
export const isPubkey = (value: string): boolean =>
  typeof value === "string" && decodePubkey(value) !== undefined;

// --- ed25519, only far enough to answer "is this 32-byte value a curve point?" ---

const P = (1n << 255n) - 19n;
/** `-121665/121666 mod p`, the Edwards curve constant. */
const D = 37095705934669439343138083508754565189542113879843219016388785533085940283555n;

const mod = (value: bigint) => ((value % P) + P) % P;

function powMod(base: bigint, exponent: bigint): bigint {
  let result = 1n;
  let factor = mod(base);
  let remaining = exponent;
  while (remaining > 0n) {
    if (remaining & 1n) result = (result * factor) % P;
    factor = (factor * factor) % P;
    remaining >>= 1n;
  }
  return result;
}

/**
 * Whether 32 bytes decompress to a point on ed25519 — that is, whether they
 * could be somebody's public key.
 *
 * A program-derived address is defined as a hash that is *not* a curve point,
 * precisely so no private key can exist for it. This mirrors what
 * `curve25519-dalek`'s `CompressedEdwardsY::decompress` accepts, which is what
 * the runtime itself uses: recover `y` from the low 255 bits, then ask whether
 * `u/v = (y²-1)/(dy²+1)` is a square in the field.
 */
export function isOnCurve(bytes: Uint8Array): boolean {
  if (bytes.length !== PUBKEY_BYTES) return false;
  let y = 0n;
  for (let i = PUBKEY_BYTES - 1; i >= 0; i -= 1) {
    const byte = i === PUBKEY_BYTES - 1 ? bytes[i]! & 0x7f : bytes[i]!;
    y = (y << 8n) | BigInt(byte);
  }
  y = mod(y);
  const yy = mod(y * y);
  const u = mod(yy - 1n);
  const v = mod(D * yy + 1n);
  const v3 = mod(mod(v * v) * v);
  const v7 = mod(mod(v3 * v3) * v);
  // The candidate root: x = u·v³·(u·v⁷)^((p-5)/8).
  const x = mod(mod(u * v3) * powMod(mod(u * v7), (P - 5n) / 8n));
  const check = mod(mod(v * x) * x);
  return check === u || check === mod(-u);
}

// --- program-derived addresses ---

const PDA_MARKER = new TextEncoder().encode("ProgramDerivedAddress");

/**
 * The associated token account program, from its own published documentation
 * rather than recalled: https://www.solana-program.com/docs/associated-token-account
 *
 * Load-bearing beyond the usual: it is a seed of every ATA this server derives,
 * so a wrong constant would not fail loudly — it would quietly derive addresses
 * that match nothing and refuse every honest Solana payment.
 */
export const ASSOCIATED_TOKEN_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/**
 * Finds the address for a set of seeds under a program: the first hash, walking
 * the bump seed down from 255, that is off the curve.
 *
 * @returns The derived address, or `undefined` in the case no bump works — which
 *   has never been observed and would take a 1-in-2^256 accident to produce.
 */
export async function findProgramAddress(
  seeds: Uint8Array[],
  programId: Uint8Array
): Promise<string | undefined> {
  for (let bump = 255; bump >= 0; bump -= 1) {
    const preimage = concatBytes([...seeds, Uint8Array.of(bump), programId, PDA_MARKER]);
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", preimage));
    if (!isOnCurve(digest)) return encodeBase58(digest);
  }
  return undefined;
}

/**
 * Derives the associated token account that holds `mint` for `owner` under a
 * given token program.
 *
 * The address commits to all three at once, which is what makes it the check
 * the exact-SVM scheme asks for: an instruction that credits this account
 * cannot have credited a different owner, mint or token program.
 *
 * @returns The ATA, or `undefined` if any of the three is not a valid address.
 */
export async function associatedTokenAddress(
  owner: string,
  mint: string,
  tokenProgram: string
): Promise<string | undefined> {
  const parts = [owner, tokenProgram, mint, ASSOCIATED_TOKEN_PROGRAM].map(decodePubkey);
  if (parts.some((part) => part === undefined)) return undefined;
  const [ownerBytes, programBytes, mintBytes, ataProgram] = parts as Uint8Array[];
  return findProgramAddress([ownerBytes!, programBytes!, mintBytes!], ataProgram!);
}
