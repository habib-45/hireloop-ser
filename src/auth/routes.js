import { randomBytes } from "node:crypto";
import { Router } from "express";

import { ROLES } from "../lib/constants.js";
import { HttpError } from "../lib/http-error.js";
import {
  clearSessionCookie,
  readCookie,
  setSessionCookie,
} from "../lib/cookies.js";
import {
  parseChangePasswordInput,
  parseEmailChangeInput,
  parseForgotPasswordInput,
  parseNameInput,
  parseResetPasswordInput,
  parseSignInInput,
  parseSignUpInput,
} from "../lib/validation.js";
import { publicUser } from "../lib/serializers.js";
import {
  assertUserActive,
  createAuthMiddleware,
} from "./current-user.js";
import { hashPassword, verifyPassword } from "./password.js";
import {
  createSessionToken,
  hashSessionToken,
} from "./sessions.js";
import { notifyBilling } from "../services/notifications.js";

function sessionExpiry(config) {
  return new Date(Date.now() + config.sessionDays * 24 * 60 * 60 * 1000);
}

async function establishSession(store, config, res, userId) {
  const token = createSessionToken();
  const tokenHash = hashSessionToken(token);

  await store.createSession({
    tokenHash,
    userId,
    expiresAt: sessionExpiry(config),
  });

  setSessionCookie(res, config, token);
}

async function serializeAuthUser(store, user) {
  const userId = String(user.id ?? user._id);
  const unreadNotifications = await store.countNotificationsByUser(userId, {
    unreadOnly: true,
  });

  return {
    ...publicUser(user, { unreadNotifications }),
    profile: {
      headline: user.profile?.headline ?? "",
      location: user.profile?.location ?? "",
      avatarUrl: user.profile?.avatarUrl ?? "",
      completeness: Number(user.profile?.completeness ?? 0),
    },
  };
}

function resetBaseUrl(config) {
  return config.clientOrigins[0] ?? "http://localhost:3000";
}

export function createAuthRouter({ store, config }) {
  const router = Router();
  const { requireAuth } = createAuthMiddleware({ store, config });

  router.post("/sign-up", async (req, res) => {
    const { name, email, password, role } = parseSignUpInput(req.body);
    const passwordHash = await hashPassword(password);
    const user = await store.createUser({
      name,
      email,
      passwordHash,
      role: role ?? ROLES.JOB_SEEKER,
    });

    if (!user) {
      throw new HttpError(
        409,
        "EMAIL_IN_USE",
        "An account with this email already exists.",
        { field: "email" }
      );
    }

    await establishSession(store, config, res, String(user.id ?? user._id));
    res.status(201).json({ user: await serializeAuthUser(store, user) });
  });

  router.post("/sign-in", async (req, res) => {
    const { email, password } = parseSignInInput(req.body);
    const user = await store.findUserByEmail(email);

    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      throw new HttpError(
        401,
        "INVALID_CREDENTIALS",
        "Invalid email or password."
      );
    }

    assertUserActive(user);
    const userId = String(user.id ?? user._id);
    const updated =
      (await store.updateUser(userId, { lastLoginAt: new Date() })) ?? user;

    await establishSession(store, config, res, userId);
    res.json({ user: await serializeAuthUser(store, updated) });
  });

  router.post("/sign-out", async (req, res) => {
    const token = readCookie(req, config.sessionCookieName);

    if (token) {
      await store.deleteSession(hashSessionToken(token));
    }

    clearSessionCookie(res, config);
    res.json({ ok: true });
  });

  router.get("/me", requireAuth, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({ user: await serializeAuthUser(store, req.user) });
  });

  router.patch("/me", requireAuth, async (req, res) => {
    const { name } = parseNameInput(req.body);
    const userId = String(req.user.id ?? req.user._id);
    const updated = await store.updateUser(userId, { name });

    if (!updated) {
      throw new HttpError(404, "USER_NOT_FOUND", "Account not found.");
    }

    res.json({ user: await serializeAuthUser(store, updated) });
  });

  router.post("/change-password", requireAuth, async (req, res) => {
    const { currentPassword, newPassword } = parseChangePasswordInput(req.body);
    const userId = String(req.user.id ?? req.user._id);

    if (!(await verifyPassword(currentPassword, req.user.passwordHash))) {
      throw new HttpError(
        400,
        "INVALID_CURRENT_PASSWORD",
        "Your current password is incorrect.",
        { field: "currentPassword" }
      );
    }

    await store.updateUserPassword(userId, await hashPassword(newPassword));
    await store.deleteSessionsForUser(userId);
    await establishSession(store, config, res, userId);

    res.json({ ok: true, message: "Password updated." });
  });

  router.post("/change-email", requireAuth, async (req, res) => {
    const { email, currentPassword } = parseEmailChangeInput(req.body);

    if (!currentPassword) {
      throw new HttpError(
        400,
        "PASSWORD_REQUIRED",
        "Enter your current password to change your email.",
        { field: "currentPassword" }
      );
    }

    if (!(await verifyPassword(currentPassword, req.user.passwordHash))) {
      throw new HttpError(
        400,
        "INVALID_CURRENT_PASSWORD",
        "Your current password is incorrect.",
        { field: "currentPassword" }
      );
    }

    const existing = await store.findUserByEmail(email);

    if (existing && String(existing.id ?? existing._id) !== String(req.user.id ?? req.user._id)) {
      throw new HttpError(
        409,
        "EMAIL_IN_USE",
        "An account with this email already exists.",
        { field: "email" }
      );
    }

    const updated = await store.updateUser(String(req.user.id ?? req.user._id), {
      email,
    });

    if (!updated) {
      throw new HttpError(409, "EMAIL_IN_USE", "That email is not available.", {
        field: "email",
      });
    }

    res.json({ user: await serializeAuthUser(store, updated) });
  });

  router.post("/forgot-password", async (req, res) => {
    const { email } = parseForgotPasswordInput(req.body);
    const user = await store.findUserByEmail(email);
    const payload = {
      ok: true,
      message:
        "If an account exists for this email, a password reset link has been sent.",
    };

    if (!user) {
      return res.json(payload);
    }

    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(
      Date.now() + config.passwordResetMinutes * 60 * 1000
    );

    await store.createPasswordReset({
      tokenHash: hashSessionToken(token),
      userId: String(user.id ?? user._id),
      expiresAt,
    });

    if (config.exposeResetTokens) {
      payload.resetToken = token;
      payload.expiresAt = expiresAt.toISOString();
      payload.resetUrl = `${resetBaseUrl(config)}/reset-password?token=${encodeURIComponent(token)}`;
    }

    res.json(payload);
  });

  router.post("/reset-password", async (req, res) => {
    const { token, password } = parseResetPasswordInput(req.body);
    const reset = await store.findPasswordReset(hashSessionToken(token));

    if (!reset) {
      throw new HttpError(
        400,
        "RESET_TOKEN_INVALID",
        "This password reset link is invalid or has expired.",
        { field: "token" }
      );
    }

    const user = await store.findUserById(reset.userId);

    if (!user) {
      await store.deletePasswordReset(reset.tokenHash);
      throw new HttpError(
        400,
        "RESET_TOKEN_INVALID",
        "This password reset link is invalid or has expired.",
        { field: "token" }
      );
    }

    await store.updateUserPassword(reset.userId, await hashPassword(password));
    await store.deletePasswordReset(reset.tokenHash);
    await store.deleteSessionsForUser(reset.userId);
    clearSessionCookie(res, config);

    if (user.email) {
      await notifyBilling(store, reset.userId, {
        title: "Password changed",
        message: "Your HireLoop password was reset successfully.",
        link: "/dashboard/settings",
        meta: { source: "password_reset" },
      });
    }

    res.json({ ok: true, message: "Password updated. You can sign in now." });
  });

  router.delete("/me", requireAuth, async (req, res) => {
    const userId = String(req.user.id ?? req.user._id);

    await store.updateUser(userId, { status: "deactivated" });
    await store.deleteSessionsForUser(userId);
    clearSessionCookie(res, config);

    res.json({ ok: true, message: "Your account has been deactivated." });
  });

  return router;
}
