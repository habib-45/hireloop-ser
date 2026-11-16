import { Router } from "express";

import { createAuthMiddleware } from "../auth/current-user.js";
import { clearSessionCookie } from "../lib/cookies.js";
import { HttpError } from "../lib/http-error.js";
import { parseSettingsUpdate } from "../lib/validation.js";
import { serializeSettings } from "../services/profile.js";

export function createSettingsRouter({ store, config }) {
  const router = Router();
  const { requireAuth } = createAuthMiddleware({ store, config });

  router.use(requireAuth);

  router.get("/", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({ settings: serializeSettings(req.user.settings) });
  });

  router.patch("/", async (req, res) => {
    const patch = parseSettingsUpdate(req.body);
    const userId = String(req.user.id ?? req.user._id);
    const update = { settings: patch };

    if (patch.privacy?.profileVisibility) {
      update.profile = {
        profileVisibility: patch.privacy.profileVisibility,
      };
    }

    const updated = await store.updateUser(userId, update);

    if (!updated) {
      throw new HttpError(404, "USER_NOT_FOUND", "Account not found.");
    }

    res.json({
      settings: serializeSettings(updated.settings),
      profileVisibility: updated.profile?.profileVisibility ?? "public",
      message: "Settings saved.",
    });
  });

  router.delete("/account", async (req, res) => {
    const userId = String(req.user.id ?? req.user._id);

    await store.updateUser(userId, { status: "deactivated" });
    await store.deleteSessionsForUser(userId);
    clearSessionCookie(res, config);

    res.json({ ok: true, message: "Your account has been deactivated." });
  });

  return router;
}
