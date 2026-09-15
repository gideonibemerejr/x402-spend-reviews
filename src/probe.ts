/**
 * Reading a paid endpoint's price without paying it.
 *
 * An x402 seller answers an unpaid request with `402 Payment Required` and a
 * body describing what it would cost. That body is public by construction — it
 * is an offer, addressed to anyone — so reading it needs no key, no account and
 * no wallet.
 *
 * This module sends one unauthenticated GET and reports what came back. It
 * never constructs a payment payload, never signs anything, and has no signer
 * to do it with. There is no code path here that can spend money.
 */

/** One payment option from an `accepts` array, as much of one as was supplied. */
export interface ProbedOffer {
  scheme?: string;
  network?: string;
  asset?: string;
  /** Atomic units. `amount` in x402 v2, `maxAmountRequired` in v1; both are read. */
  amount?: string;
  payTo?: string;
  maxTimeoutSeconds?: number;
  extra?: unknown;
}

/** Discovery metadata a seller may publish alongside its price. */
export interface ProbedResource {
  url?: string;
  serviceName?: string;
  description?: string;
  mimeType?: string;
}

/** What an endpoint said when asked for its price. */
export type ProbeResult =
  | {
      ok: true;
      url: string;
      status: number;
      /** True when the endpoint answered 402, which is the case the demo is for. */
      paid: boolean;
      x402Version?: number;
      /** Discovery metadata the seller published alongside its price. */
      resource?: ProbedResource;
      offers: ProbedOffer[];
      /** Set when a 402 body could not be read as x402, with the status still reported. */
      note?: string;
    }
  | { ok: false; reason: string };

/** Largest 402 body read. An offer is a few hundred bytes; the rest is not an offer. */
export const MAX_PROBE_BYTES = 64 * 1024;

/** How long an endpoint gets to state its price before it is treated as down. */
export const PROBE_TIMEOUT_MS = 8_000;

/** At most one redirect is followed, so a probe cannot be walked around the internet. */
export const MAX_REDIRECTS = 1;

/**
 * Hosts a probe refuses to fetch.
 *
 * This endpoint takes a URL from an unauthenticated caller and fetches it, so
 * it is a request forwarder and has to be treated as one. Loopback, link-local
 * and the RFC 1918 ranges are refused by name — together with the cloud
 * metadata address, which is the one that actually matters — rather than being
 * left to whatever the runtime happens not to route.
 */
const BLOCKED_HOSTS = /^(localhost|.*\.localhost|.*\.internal|.*\.local)$/i;
const BLOCKED_IPV4 =
  /^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/;

/**
 * Checks a URL is one this server is willing to fetch on a stranger's behalf.
 *
 * @returns The parsed URL, or the reason it was refused.
 */
export function checkProbeUrl(raw: string): { url: URL } | { reason: string } {
  if (!URL.canParse(raw)) return { reason: "not a URL" };
  const url = new URL(raw);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { reason: "only http and https URLs can be probed" };
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (BLOCKED_HOSTS.test(host) || BLOCKED_IPV4.test(host)) {
    return { reason: "refusing to probe a private or loopback address" };
  }
  // Every IPv6 form of loopback and link-local, plus the unique-local range.
  if (host === "::1" || host === "::" || /^(fe80|fc|fd)/i.test(host)) {
    return { reason: "refusing to probe a private or loopback address" };
  }
  if (url.username || url.password) {
    return { reason: "refusing to probe a URL carrying credentials" };
  }
  return { url };
}

/** Copies across only the discovery fields this server reports, and only if they are strings. */
function readResource(value: unknown): ProbedResource | undefined {
  if (!value || typeof value !== "object") return undefined;
  const source = value as Record<string, unknown>;
  const resource: ProbedResource = {};
  for (const field of ["url", "serviceName", "description", "mimeType"] as const) {
    if (typeof source[field] === "string") resource[field] = source[field];
  }
  return Object.keys(resource).length > 0 ? resource : undefined;
}

/** Reads the offers out of an x402 body, tolerating both versions' field names. */
function readOffers(body: Record<string, unknown>): ProbedOffer[] {
  const accepts = body.accepts;
  if (!Array.isArray(accepts)) return [];
  return accepts.slice(0, 20).map((entry: Record<string, unknown>) => {
    const offer: ProbedOffer = {};
    if (typeof entry?.scheme === "string") offer.scheme = entry.scheme;
    if (typeof entry?.network === "string") offer.network = entry.network;
    if (typeof entry?.asset === "string") offer.asset = entry.asset;
    const amount = entry?.amount ?? entry?.maxAmountRequired;
    if (typeof amount === "string" || typeof amount === "number") offer.amount = String(amount);
    if (typeof entry?.payTo === "string") offer.payTo = entry.payTo;
    if (typeof entry?.maxTimeoutSeconds === "number") offer.maxTimeoutSeconds = entry.maxTimeoutSeconds;
    if (entry?.extra !== undefined) offer.extra = entry.extra;
    return offer;
  });
}

/**
 * Asks an endpoint what it costs.
 *
 * @param raw - The URL to probe, unvalidated.
 * @param fetchImpl - Injected in tests so nothing leaves the machine.
 */
export async function probeEndpoint(
  raw: string,
  fetchImpl: typeof fetch = fetch
): Promise<ProbeResult> {
  const checked = checkProbeUrl(raw);
  if ("reason" in checked) return { ok: false, reason: checked.reason };

  let target = checked.url;
  let response: Response;
  for (let hop = 0; ; hop++) {
    try {
      response = await fetchImpl(target.toString(), {
        method: "GET",
        // No Authorization, no cookies, no payment header. An offer is public.
        headers: { accept: "application/json", "user-agent": PROBE_USER_AGENT },
        redirect: "manual",
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
    } catch (cause: unknown) {
      const message = cause instanceof Error ? cause.message : String(cause);
      return { ok: false, reason: `could not reach ${target.host}: ${message}` };
    }

    const location = response.status >= 300 && response.status < 400
      ? response.headers.get("location")
      : null;
    if (!location) break;
    if (hop >= MAX_REDIRECTS) {
      return { ok: false, reason: `more than ${MAX_REDIRECTS} redirect followed` };
    }
    // Workers types the base as a string, so the current target is spelled out
    // rather than handed over as a URL.
    const base = target.toString();
    if (!URL.canParse(location, base)) {
      return { ok: false, reason: "redirected to a URL that could not be parsed" };
    }
    // Re-checked rather than trusted: a redirect is the obvious way to walk a
    // probe from a public host onto a private one.
    const next = checkProbeUrl(new URL(location, base).toString());
    if ("reason" in next) return { ok: false, reason: `redirect ${next.reason}` };
    target = next.url;
  }

  const paid = response.status === 402;
  const base = { ok: true as const, url: target.toString(), status: response.status, paid };

  let text: string;
  try {
    text = await readCapped(response);
  } catch (cause: unknown) {
    return { ...base, offers: [], note: cause instanceof Error ? cause.message : String(cause) };
  }

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return {
      ...base, offers: [],
      note: paid ? "endpoint answered 402 with a body that is not JSON" : undefined,
    };
  }
  if (!body || typeof body !== "object") {
    return { ...base, offers: [], note: "body is not an x402 payment-required object" };
  }

  const record = body as Record<string, unknown>;
  const resource = readResource(record.resource);
  const offers = readOffers(record);
  return {
    ...base,
    ...(typeof record.x402Version === "number" ? { x402Version: record.x402Version } : {}),
    ...(resource ? { resource } : {}),
    offers,
    ...(paid && offers.length === 0
      ? { note: "endpoint answered 402 but published no payment options" }
      : {}),
  };
}

/** Sent on every probe, so a seller can see who is asking and why. */
export const PROBE_USER_AGENT =
  "x402-spend-reviews probe (+https://x402spend.dev/try/probe); reads 402 offers, never pays";

/** Reads at most {@link MAX_PROBE_BYTES}, so a large body cannot exhaust the isolate. */
async function readCapped(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > MAX_PROBE_BYTES) {
        await reader.cancel();
        throw new Error(`response exceeded ${MAX_PROBE_BYTES} bytes`);
      }
      chunks.push(value);
    }
  }
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(joined);
}
