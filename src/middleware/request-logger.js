import { randomUUID } from "node:crypto";

export function requestLogger({ enabled = true } = {}) {
  return function logRequest(req, res, next) {
    const requestId = randomUUID();
    const startedAt = process.hrtime.bigint();

    req.id = requestId;
    res.setHeader("X-Request-Id", requestId);

    if (!enabled) {
      return next();
    }

    res.on("finish", () => {
      const durationMs =
        Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      const safeUrl = req.originalUrl?.split("?")[0] ?? req.path;

      if (process.env.NODE_ENV === "production") {
        console.log(
          JSON.stringify({
            level: "info",
            requestId,
            method: req.method,
            path: safeUrl,
            status: res.statusCode,
            durationMs: Math.round(durationMs * 100) / 100,
            ip: req.ip,
          })
        );
        return;
      }

      console.log(
        `[hireloop] ${req.method} ${safeUrl} ${res.statusCode} ${Math.round(
          durationMs
        )}ms ${requestId.slice(0, 8)}`
      );
    });

    next();
  };
}
