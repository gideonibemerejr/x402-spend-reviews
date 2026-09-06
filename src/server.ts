/** HTTP surface: node:http, JSON only, no framework. */
import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { parseSubmission, ReviewValidationError } from "./review.js";
import { verifySettlement, type RpcCall } from "./verify.js";
import type { ReviewStore } from "./store.js";

/** Resolves a JSON-RPC caller for a chain, or `undefined` if the chain is not configured. */
export type RpcResolver = (chainId: string) => RpcCall | undefined;

/** Wiring for {@link createServer}. Tests inject fixture RPC through `rpc`. */
export interface ServerOptions {
  store: ReviewStore;
  rpc: RpcResolver;
  /** Largest accepted request body; guards the parser, not a rate limit. */
  maxBodyBytes?: number;
}

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
} as const;

function send(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    ...CORS_HEADERS,
  });
  response.end(payload);
}

/** Collects a JSON body, refusing anything past the size guard. */
async function readJson(request: IncomingMessage, maxBodyBytes: number): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > maxBodyBytes) throw new ReviewValidationError("request body too large");
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(text);
  } catch {
    throw new ReviewValidationError("body must be valid JSON");
  }
}

/**
 * Handles `POST /v1/reviews`: validate the shape, prove the settlement, then store.
 *
 * Verification happens before any write, so an unverifiable claim never reaches
 * the database.
 */
async function postReview(
  request: IncomingMessage,
  response: ServerResponse,
  { store, rpc, maxBodyBytes = 16_384 }: ServerOptions
): Promise<void> {
  let submission;
  try {
    submission = parseSubmission(await readJson(request, maxBodyBytes));
  } catch (error) {
    const reason = error instanceof ReviewValidationError ? error.message : "unreadable request body";
    return send(response, 422, { error: reason });
  }

  if (!submission.network.startsWith("eip155:")) {
    return send(response, 422, { error: "network not supported in 0.3" });
  }
  const chainId = submission.network.slice("eip155:".length);
  const call = rpc(chainId);
  if (!call) {
    return send(response, 422, { error: `no RPC endpoint configured for chain ${chainId}` });
  }

  let result;
  try {
    result = await verifySettlement(submission, call);
  } catch (error) {
    // The claim may well be true; this server simply could not check it.
    return send(response, 503, {
      error: "could not reach the chain to verify this settlement",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
  if (!result.verified) return send(response, 422, { error: result.reason });

  const write = store.put(submission);
  if (write.status === "duplicate") {
    return send(response, 409, { id: write.review.id, error: "this settlement already has this outcome" });
  }
  send(response, write.status === "created" ? 201 : 200, {
    id: write.review.id,
    verified: true,
    updated: write.status === "updated",
  });
}

/**
 * Builds the review server.
 *
 * @param options - Store and RPC wiring; no globals are read here so tests stay chain-free.
 * @returns An unstarted `http.Server`.
 */
export function createServer(options: ServerOptions): Server {
  return createHttpServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
      const { method } = request;

      if (method === "OPTIONS") {
        response.writeHead(204, CORS_HEADERS);
        return response.end();
      }
      if (method === "GET" && url.pathname === "/health") {
        return send(response, 200, { ok: true });
      }
      if (method === "POST" && url.pathname === "/v1/reviews") {
        return await postReview(request, response, options);
      }
      if (method === "GET" && url.pathname === "/v1/reviews/recent") {
        return send(response, 200, { reviews: options.store.recent(100) });
      }
      if (method === "GET" && url.pathname === "/v1/reviews") {
        const resource = url.searchParams.get("resource");
        if (!resource) return send(response, 422, { error: "resource query parameter is required" });
        return send(response, 200, options.store.byResource(resource));
      }
      send(response, 404, { error: `no route for ${method} ${url.pathname}` });
    })().catch((error: unknown) => {
      if (response.headersSent) return response.destroy();
      send(response, 500, { error: error instanceof Error ? error.message : String(error) });
    });
  });
}
