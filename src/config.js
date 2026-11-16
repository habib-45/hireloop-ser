import "dotenv/config";

function parseOrigins(value) {
  return value
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseBoolean(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  return value === "true" || value === "1";
}

function parseTrustProxy(value) {
  if (!value) {
    return false;
  }

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  const hops = Number.parseInt(value, 10);
  return Number.isFinite(hops) ? hops : value;
}

const isProduction = process.env.NODE_ENV === "production";
const isTest = process.env.NODE_ENV === "test";
const cookieSecure = parseBoolean(process.env.COOKIE_SECURE, isProduction);

export const config = {
  port: parsePositiveInt(process.env.PORT, 5000),
  clientOrigins: parseOrigins(
    process.env.CLIENT_ORIGIN ||
      "http://localhost:3000,http://127.0.0.1:3000"
  ),
  mongoUri: process.env.MONGODB_URI?.trim() || "",
  mongoDbName: process.env.MONGODB_DB?.trim() || "hireloop",
  devStorePath: process.env.DEV_STORE_PATH?.trim() || "data/store.json",
  sessionCookieName:
    process.env.SESSION_COOKIE_NAME?.trim() || "hireloop_session",
  sessionDays: parsePositiveInt(process.env.SESSION_DAYS, 7),
  cookieSecure,
  isProduction,
  isTest,
  trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
  seedDemoData: parseBoolean(
    process.env.SEED_DEMO_DATA,
    !isProduction && !isTest
  ),
  exposeResetTokens: parseBoolean(
    process.env.EXPOSE_RESET_TOKENS,
    !isProduction
  ),
  rateLimitEnabled: parseBoolean(
    process.env.RATE_LIMIT_ENABLED,
    !isTest
  ),
  requestLogging: parseBoolean(process.env.REQUEST_LOGGING, !isTest),
  passwordResetMinutes: parsePositiveInt(process.env.PASSWORD_RESET_MINUTES, 30),
  apiVersion: process.env.API_VERSION?.trim() || "1.0.0",
};
