/**
 * Probing: reading a seller's price without paying it.
 *
 * Two things are being checked here. That a real 402 is read correctly — which
 * is what the demo shows — and that this endpoint cannot be turned into a way
 * of making the Worker fetch things on a stranger's behalf, which is what an
 * unauthenticated URL parameter always risks.
 */
import { expect, test } from "vitest";
import { checkProbeUrl, probeEndpoint, MAX_PROBE_BYTES, PROBE_USER_AGENT } from "../src/probe";

/** A fetch that answers every call with one canned response, recording the request. */
function fetchReturning(response: Response | (() => Response)) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return typeof response === "function" ? response() : response.clone();
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const PAYMENT_REQUIRED = {
  x402Version: 2,
  resource: { url: "https://api.test/paid", serviceName: "test-api", description: "a paid thing" },
  accepts: [{
    scheme: "exact",
    network: "base-sepolia",
    asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    amount: "10000",
    payTo: "0x976EA74026E726554dB657fA54763abd0C3a0aa9",
    maxTimeoutSeconds: 60,
  }],
};

const respond402 = (body: unknown = PAYMENT_REQUIRED) =>
  new Response(JSON.stringify(body), { status: 402, headers: { "content-type": "application/json" } });

test("a live 402 is reported offer by offer", async () => {
  const { impl } = fetchReturning(respond402());
  expect(await probeEndpoint("https://api.test/paid", impl)).toEqual({
    ok: true,
    url: "https://api.test/paid",
    status: 402,
    paid: true,
    x402Version: 2,
    resource: { url: "https://api.test/paid", serviceName: "test-api", description: "a paid thing" },
    offers: [{
      scheme: "exact",
      network: "base-sepolia",
      asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      amount: "10000",
      payTo: "0x976EA74026E726554dB657fA54763abd0C3a0aa9",
      maxTimeoutSeconds: 60,
    }],
  });
});

test("a probe sends no payment and no credentials", async () => {
  const { impl, calls } = fetchReturning(respond402());
  await probeEndpoint("https://api.test/paid", impl);
  const headers = calls[0]!.init!.headers as Record<string, string>;
  expect(Object.keys(headers).map((h) => h.toLowerCase())).toEqual(["accept", "user-agent"]);
  expect(headers["user-agent"]).toBe(PROBE_USER_AGENT);
  expect(calls[0]!.init!.method).toBe("GET");
});

test("x402 v1's field name for the price is read as well as v2's", async () => {
  // v1 called it maxAmountRequired. A demo that showed a blank price against a
  // v1 seller would look like the seller's bug rather than ours.
  const { impl } = fetchReturning(respond402({
    x402Version: 1,
    accepts: [{ scheme: "exact", network: "base", maxAmountRequired: "5000" }],
  }));
  expect(await probeEndpoint("https://api.test/paid", impl)).toMatchObject({
    x402Version: 1, offers: [{ amount: "5000" }],
  });
});

test("an endpoint that is not paid is reported as it answered", async () => {
  const { impl } = fetchReturning(new Response("hello", { status: 200 }));
  expect(await probeEndpoint("https://api.test/free", impl)).toMatchObject({
    ok: true, status: 200, paid: false, offers: [],
  });
});

test("a 402 whose body is not x402 is reported with the status and a note", async () => {
  const { impl } = fetchReturning(new Response("nope", { status: 402 }));
  expect(await probeEndpoint("https://api.test/paid", impl)).toMatchObject({
    ok: true, status: 402, paid: true, offers: [],
    note: "endpoint answered 402 with a body that is not JSON",
  });
});

test("a 402 that publishes no options says so", async () => {
  const { impl } = fetchReturning(respond402({ x402Version: 2, accepts: [] }));
  expect(await probeEndpoint("https://api.test/paid", impl)).toMatchObject({
    paid: true, offers: [], note: "endpoint answered 402 but published no payment options",
  });
});

test("an unreachable endpoint is a reason, never a thrown error", async () => {
  const impl = (async () => { throw new Error("connection refused"); }) as unknown as typeof fetch;
  expect(await probeEndpoint("https://api.test/paid", impl)).toEqual({
    ok: false, reason: "could not reach api.test: connection refused",
  });
});

test("private and loopback addresses are refused", async () => {
  for (const url of [
    "http://localhost:8080/x",
    "http://127.0.0.1/x",
    "http://10.0.0.5/x",
    "http://192.168.1.1/x",
    "http://172.16.0.1/x",
    "http://169.254.169.254/latest/meta-data/",
    "http://[::1]/x",
    "http://thing.internal/x",
  ]) {
    expect(checkProbeUrl(url), url).toEqual({
      reason: "refusing to probe a private or loopback address",
    });
  }
});

test("non-http schemes and embedded credentials are refused", async () => {
  expect(checkProbeUrl("file:///etc/passwd")).toEqual({
    reason: "only http and https URLs can be probed",
  });
  expect(checkProbeUrl("https://user:pw@api.test/x")).toEqual({
    reason: "refusing to probe a URL carrying credentials",
  });
});

test("one redirect is followed; a second is refused", async () => {
  const hops = [
    new Response(null, { status: 302, headers: { location: "https://api.test/second" } }),
    respond402(),
  ];
  let i = 0;
  const impl = (async () => hops[i++]!) as unknown as typeof fetch;
  expect(await probeEndpoint("https://api.test/first", impl)).toMatchObject({
    ok: true, url: "https://api.test/second", paid: true,
  });

  const loop = (async () =>
    new Response(null, { status: 302, headers: { location: "https://api.test/again" } })
  ) as unknown as typeof fetch;
  expect(await probeEndpoint("https://api.test/first", loop)).toEqual({
    ok: false, reason: "more than 1 redirect followed",
  });
});

test("a redirect onto a private address is refused, not followed", async () => {
  // The obvious way around the host check: answer the public URL with a 302
  // pointing at the metadata service. The destination is checked by the same
  // rule as the original, which is why the rule lives in its own function.
  const impl = (async () =>
    new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/" } })
  ) as unknown as typeof fetch;
  expect(await probeEndpoint("https://api.test/paid", impl)).toEqual({
    ok: false, reason: "redirect refusing to probe a private or loopback address",
  });
});

test("an oversized body is cut off rather than read into the isolate", async () => {
  const huge = "x".repeat(MAX_PROBE_BYTES + 1024);
  const { impl } = fetchReturning(() => new Response(huge, { status: 402 }));
  expect(await probeEndpoint("https://api.test/paid", impl)).toMatchObject({
    ok: true, status: 402, offers: [],
    note: `response exceeded ${MAX_PROBE_BYTES} bytes`,
  });
});
