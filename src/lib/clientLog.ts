// Client-side diagnostics that land in the Worker logs (Cloudflare observability
// / `wrangler tail`), so a tester's failure is visible to us directly rather
// than relying on them to copy a console. Best-effort and non-sensitive: never
// pass tokens or personal data here.

// De-dupe so a repeating error can't flood the logs. Keyed by scope|kind|message
// and capped, since a runaway loop could otherwise produce unbounded keys.
const sent = new Set<string>();

export function reportClientIssue(
  scope: string,
  kind: string,
  message: string,
  extra?: Record<string, unknown>
) {
  const key = `${scope}|${kind}|${message}`;
  if (sent.has(key)) return;
  if (sent.size < 200) sent.add(key);

  // eslint-disable-next-line no-console
  console.warn("[Cue]", scope, kind, message || "", extra ?? "");
  try {
    void fetch("/api/client-log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify({
        scope,
        kind,
        message,
        ...extra,
        url: typeof location !== "undefined" ? location.href : "",
        userAgent: typeof navigator !== "undefined" ? navigator.userAgent : ""
      })
    });
  } catch {
    /* logging must never throw */
  }
}

// Catch anything we didn't anticipate — uncaught errors and rejected promises —
// once per page. This is the safety net behind the targeted player logging.
let installed = false;
export function installGlobalErrorLogging() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("error", (e) => {
    reportClientIssue("window", "error", e.message || "", { src: e.filename, line: e.lineno });
  });
  window.addEventListener("unhandledrejection", (e) => {
    const reason = e.reason as { message?: string } | string | undefined;
    const message = typeof reason === "string" ? reason : (reason?.message ?? "unknown");
    reportClientIssue("window", "unhandledrejection", message);
  });
}
