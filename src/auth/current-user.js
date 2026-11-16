import { readCookie } from "../lib/cookies.js";
import { HttpError } from "../lib/http-error.js";
import { hashSessionToken } from "./sessions.js";

export async function findSessionUser(req, store, config) {
  const token = readCookie(req, config.sessionCookieName);

  if (!token) {
    return null;
  }

  const session = await store.findSession(hashSessionToken(token));

  if (!session) {
    return null;
  }

  return store.findUserById(session.userId);
}

export async function requireSessionUser(req, store, config) {
  const user = await findSessionUser(req, store, config);

  if (!user) {
    throw new HttpError(
      401,
      "NOT_AUTHENTICATED",
      "Please sign in to continue."
    );
  }

  assertUserActive(user);
  return user;
}

export function assertUserActive(user) {
  if (user?.status === "suspended") {
    throw new HttpError(
      403,
      "ACCOUNT_SUSPENDED",
      "Your account is suspended. Contact support for help."
    );
  }

  if (user?.status === "deactivated") {
    throw new HttpError(
      403,
      "ACCOUNT_DEACTIVATED",
      "This account has been deactivated."
    );
  }
}

/**
 * Creates the middleware used by the route modules. It keeps the session
 * lookup in one place so every protected endpoint behaves the same way.
 */
export function createAuthMiddleware({ store, config }) {
  async function optionalAuth(req, res, next) {
    try {
      const user = await findSessionUser(req, store, config);

      if (user) {
        assertUserActive(user);
        req.user = user;
      }

      next();
    } catch (error) {
      next(error);
    }
  }

  async function requireAuth(req, res, next) {
    try {
      const user = await findSessionUser(req, store, config);

      if (!user) {
        throw new HttpError(
          401,
          "NOT_AUTHENTICATED",
          "Please sign in to continue."
        );
      }

      assertUserActive(user);
      req.user = user;
      next();
    } catch (error) {
      next(error);
    }
  }

  function requireRole(...roles) {
    const allowed = new Set(roles.flat());

    return function roleGuard(req, res, next) {
      if (!req.user) {
        return next(
          new HttpError(401, "NOT_AUTHENTICATED", "Please sign in to continue.")
        );
      }

      if (!allowed.has(req.user.role)) {
        return next(
          new HttpError(
            403,
            "FORBIDDEN",
            "You do not have access to this resource."
          )
        );
      }

      next();
    };
  }

  return { optionalAuth, requireAuth, requireRole };
}
