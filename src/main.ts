#!/usr/bin/env node
/** Entry point: reads configuration from the environment and serves. */
import { createServer } from "./server.js";
import { createRpc } from "./rpc.js";
import { DEFAULT_DB_PATH, ReviewStore } from "./store.js";

const port = Number(process.env.PORT ?? 8402);
const store = new ReviewStore(process.env.DB_PATH ?? DEFAULT_DB_PATH);
const server = createServer({ store, rpc: (chainId) => createRpc(chainId) });

server.listen(port, () => {
  console.log(`x402-spend-reviews listening on :${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => {
      store.close();
      process.exit(0);
    });
  });
}
