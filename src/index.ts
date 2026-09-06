/** Worker entry point. */
import { createApp } from "./app";
import { retryPending } from "./retry";

const app = createApp();

export default {
  fetch: app.fetch,

  /**
   * Drains the backlog of reviews parked while a chain was unreachable.
   *
   * One pass per tick, no queue and no backoff schedule: if a single tick ever
   * stops keeping up, that is the signal to reach for Queues, not a reason to
   * build one now.
   */
  async scheduled(_controller, env, _ctx) {
    const report = await retryPending(env, 50);
    console.log(JSON.stringify({ message: "retryPending", ...report }));
  },
} satisfies ExportedHandler<Env>;
