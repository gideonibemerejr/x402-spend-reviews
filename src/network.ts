/**
 * Network identity: which chain a review is talking about, and how to spell it.
 *
 * x402 clients in the wild name the same chain half a dozen ways —
 * `solana-mainnet-beta`, `solana:mainnet`, `base-mainnet`, a bare `bsc`. Each
 * is unambiguous about which chain is meant, so a payment is normalized to
 * CAIP-2 rather than refused over spelling. Refusing one would cost a real
 * buyer a real review over a naming convention this server does not own.
 */
import { decodeBase58, isPubkey } from "./verify/solana-address";
import { FAMILY, type NetworkFamily } from "./vocab";

/** The CAIP-2 ids this server names. Verifying one is a separate question from naming it. */
export const NETWORK = {
  baseMainnet: "eip155:8453",
  baseSepolia: "eip155:84532",
  /** The first 32 bytes of each cluster's genesis hash, per the x402 SVM constants. */
  solanaMainnet: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
  solanaDevnet: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
} as const;

/** A CAIP-2 id, already canonical: `eip155:<decimal>` or `solana:<genesis prefix>`. */
const CAIP2 = {
  [FAMILY.evm]: /^eip155:\d+$/,
  [FAMILY.svm]: /^solana:[1-9A-HJ-NP-Za-km-z]{32,44}$/,
} as const;

/**
 * Names seen in the wild, lowercased, mapped to CAIP-2.
 *
 * Chains without a verifier of their own are still normalized: a review naming
 * `arbitrum` is refused for want of an endpoint, which is a different and more
 * honest answer than being refused for how it spelled the chain.
 */
const ALIASES: Readonly<Record<string, string>> = {
  base: NETWORK.baseMainnet,
  "base-mainnet": NETWORK.baseMainnet,
  "base-sepolia": NETWORK.baseSepolia,
  "base-sepolia-testnet": NETWORK.baseSepolia,
  solana: NETWORK.solanaMainnet,
  "solana-mainnet": NETWORK.solanaMainnet,
  "solana-mainnet-beta": NETWORK.solanaMainnet,
  "solana:mainnet": NETWORK.solanaMainnet,
  "solana:mainnet-beta": NETWORK.solanaMainnet,
  "mainnet-beta": NETWORK.solanaMainnet,
  "solana-devnet": NETWORK.solanaDevnet,
  "solana:devnet": NETWORK.solanaDevnet,
  avalanche: "eip155:43114",
  "avalanche-fuji": "eip155:43113",
  arbitrum: "eip155:42161",
  "arbitrum-one": "eip155:42161",
  bsc: "eip155:56",
  bnb: "eip155:56",
  "binance-smart-chain": "eip155:56",
  polygon: "eip155:137",
  "polygon-amoy": "eip155:80002",
  ethereum: "eip155:1",
  mainnet: "eip155:1",
  sepolia: "eip155:11155111",
  iotex: "eip155:4689",
  sei: "eip155:1329",
  "sei-testnet": "eip155:1328",
};

/**
 * Rewrites a network name to CAIP-2.
 *
 * An id that is already CAIP-2 is returned untouched — deliberately including
 * its casing, since the Solana half of one is base58 and case-carrying. Only
 * the alias lookup is case-insensitive.
 *
 * @returns The canonical id, or the input unchanged when nothing recognizes it.
 */
export function canonicalNetwork(value: string): string {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (CAIP2[FAMILY.evm].test(trimmed) || CAIP2[FAMILY.svm].test(trimmed)) return trimmed;
  return ALIASES[trimmed.toLowerCase()] ?? trimmed;
}

/** The family a canonical network id belongs to, or `undefined` if it is neither. */
export function familyOf(network: string): NetworkFamily | undefined {
  if (CAIP2[FAMILY.evm].test(network)) return FAMILY.evm;
  if (CAIP2[FAMILY.svm].test(network)) return FAMILY.svm;
  return undefined;
}

/**
 * Puts an address, hash or signature into the one spelling this server stores.
 *
 * EVM hex is case-insensitive — EIP-55 checksums are only casing — so it is
 * folded down, which is what lets the unique index on `(transaction, payer)`
 * hold however a client cased them. Base58 is *not* case-insensitive: `A` and
 * `a` are different digits, so lowercasing a Solana signature would destroy it.
 */
export function foldCase(network: string, value: string): string {
  return familyOf(network) === FAMILY.evm ? value.toLowerCase() : value;
}

/** The part of a CAIP-2 id after the family: a chain id, or a genesis prefix. */
export const referenceOf = (network: string): string => network.slice(network.indexOf(":") + 1);

/** A 20-byte EVM address. */
export const isEvmAddress = (value: string): boolean => /^0x[0-9a-fA-F]{40}$/.test(value);

/** A 32-byte EVM transaction hash. */
export const isEvmTxHash = (value: string): boolean => /^0x[0-9a-fA-F]{64}$/.test(value);

/** A 32-byte base58 Solana account address. */
export const isSvmAddress = isPubkey;

/** A 64-byte base58 Solana transaction signature. */
export const isSvmSignature = (value: string): boolean =>
  typeof value === "string" && decodeBase58(value)?.length === 64;
