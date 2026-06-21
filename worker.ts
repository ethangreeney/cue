// Custom worker entrypoint. The OpenNext build (`npm run cf:build`) generates
// `.open-next/worker.js`, which only handles `fetch`. We wrap it to add a
// `scheduled` handler so Cloudflare's cron trigger can pre-generate everyone's
// daily picks at NZ midnight. The cron simply self-invokes the protected
// `/api/cron/run` route, so all the real logic stays in normal Next routes.

// @ts-expect-error resolved by wrangler at build time, after cf:build
import openNextWorker from "./.open-next/worker.js";
// Forward any Durable Object classes OpenNext may export.
// @ts-expect-error resolved by wrangler at build time, after cf:build
export * from "./.open-next/worker.js";

type Env = { APP_BASE_URL: string; CRON_SECRET?: string };

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return openNextWorker.fetch(request, env, ctx);
  },
  scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): void {
    const req = new Request(`${env.APP_BASE_URL}/api/cron/run`, {
      method: "POST",
      headers: { "x-cron-key": env.CRON_SECRET ?? "" }
    });
    ctx.waitUntil(
      openNextWorker
        .fetch(req, env, ctx)
        .then((r: Response) => r.text())
        .catch(() => {})
    );
  }
};
