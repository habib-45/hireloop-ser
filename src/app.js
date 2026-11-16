import cors from "cors";
import express from "express";

import { createAdminRouter } from "./admin/routes.js";
import { createApplicationsRouter } from "./applications/routes.js";
import { createAuthRouter } from "./auth/routes.js";
import { createBillingRouter } from "./billing/routes.js";
import { createCheckoutRouter } from "./checkout/routes.js";
import { createCompaniesRouter } from "./companies/routes.js";
import { createDashboardRouter } from "./dashboard/routes.js";
import { createJobsRouter } from "./jobs/routes.js";
import { HttpError } from "./lib/http-error.js";
import { errorHandler, notFoundHandler } from "./middleware/error-handler.js";
import { createRateLimiter } from "./middleware/rate-limit.js";
import { requestLogger } from "./middleware/request-logger.js";
import { createNotificationsRouter } from "./notifications/routes.js";
import { createPlansRouter } from "./plans/routes.js";
import { createProfileRouter } from "./profile/routes.js";
import { createRecruiterRouter } from "./recruiter/routes.js";
import { createSavedJobsRouter } from "./saved-jobs/routes.js";
import { createSettingsRouter } from "./settings/routes.js";

const SENSITIVE_AUTH_PATHS = [
  "/sign-up",
  "/sign-in",
  "/forgot-password",
  "/reset-password",
  "/change-password",
  "/change-email",
];

export function createApp({ store, config }) {
  const app = express();
  const allowedOrigins = new Set(config.clientOrigins);

  app.disable("x-powered-by");

  if (config.trustProxy !== false) {
    app.set("trust proxy", config.trustProxy);
  }

  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    next();
  });

  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || allowedOrigins.has(origin)) {
          return callback(null, true);
        }

        callback(
          new HttpError(403, "ORIGIN_NOT_ALLOWED", "Origin not allowed.")
        );
      },
      credentials: true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Accept", "X-Requested-With"],
      exposedHeaders: [
        "RateLimit-Limit",
        "RateLimit-Remaining",
        "RateLimit-Reset",
        "Retry-After",
        "X-Request-Id",
      ],
      maxAge: 86400,
    })
  );

  app.use(express.json({ limit: "64kb" }));
  app.use(requestLogger({ enabled: config.requestLogging }));

  app.get("/", (req, res) => {
    res.json({
      name: "HireLoop API",
      version: config.apiVersion,
      status: "ok",
      docs: "/api",
    });
  });

  app.get("/health", (req, res) => {
    res.json({
      status: "ok",
      store: store.kind,
      version: config.apiVersion,
      uptime: Math.round(process.uptime()),
    });
  });

  app.get("/api", (req, res) => {
    res.json({
      name: "HireLoop API",
      version: config.apiVersion,
      endpoints: {
        auth: "/api/auth",
        jobs: "/api/jobs",
        companies: "/api/companies",
        plans: "/api/plans",
        checkout: "/api/checkout",
        savedJobs: "/api/saved-jobs",
        applications: "/api/applications",
        profile: "/api/profile",
        settings: "/api/settings",
        billing: "/api/billing",
        notifications: "/api/notifications",
        dashboard: "/api/dashboard",
        recruiter: "/api/recruiter",
        admin: "/api/admin",
      },
    });
  });

  app.use(
    "/api",
    createRateLimiter({
      name: "api",
      windowMs: 15 * 60 * 1000,
      max: 900,
      enabled: config.rateLimitEnabled,
    })
  );

  app.use(
    "/api/auth",
    createRateLimiter({
      name: "auth",
      windowMs: 15 * 60 * 1000,
      max: 120,
      enabled: config.rateLimitEnabled,
    })
  );

  const sensitiveAuthLimiter = createRateLimiter({
    name: "auth-sensitive",
    windowMs: 15 * 60 * 1000,
    max: 40,
    enabled: config.rateLimitEnabled,
  });

  for (const path of SENSITIVE_AUTH_PATHS) {
    app.use(`/api/auth${path}`, sensitiveAuthLimiter);
  }

  app.use("/api/auth", createAuthRouter({ store, config }));
  app.use("/api/jobs", createJobsRouter({ store, config }));
  app.use("/api/companies", createCompaniesRouter({ store, config }));
  app.use("/api/plans", createPlansRouter({ store, config }));
  app.use("/api/checkout", createCheckoutRouter({ store, config }));
  app.use("/api/saved-jobs", createSavedJobsRouter({ store, config }));
  app.use("/api/applications", createApplicationsRouter({ store, config }));
  app.use("/api/profile", createProfileRouter({ store, config }));
  app.use("/api/settings", createSettingsRouter({ store, config }));
  app.use("/api/billing", createBillingRouter({ store, config }));
  app.use("/api/notifications", createNotificationsRouter({ store, config }));
  app.use("/api/dashboard", createDashboardRouter({ store, config }));
  app.use("/api/recruiter", createRecruiterRouter({ store, config }));
  app.use("/api/admin", createAdminRouter({ store, config }));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
