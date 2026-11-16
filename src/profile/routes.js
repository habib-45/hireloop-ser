import { Router } from "express";

import { createAuthMiddleware } from "../auth/current-user.js";
import { HttpError } from "../lib/http-error.js";
import { parseProfileUpdate } from "../lib/validation.js";
import {
  computeProfileCompleteness,
  serializeProfile,
} from "../services/profile.js";

async function applyProfilePatch(store, user, patch) {
  const userId = String(user.id ?? user._id);
  const { name, ...profilePatch } = patch;
  const nextUserShape = {
    ...user,
    name: name ?? user.name,
    profile: { ...(user.profile ?? {}), ...profilePatch },
  };
  const update = {
    profile: {
      ...profilePatch,
      completeness: computeProfileCompleteness(nextUserShape),
    },
  };

  if (name !== undefined) {
    update.name = name;
  }

  if (profilePatch.avatarUrl !== undefined) {
    update.avatarUrl = profilePatch.avatarUrl || null;
  }

  const updated = await store.updateUser(userId, update);

  if (!updated) {
    throw new HttpError(404, "USER_NOT_FOUND", "Account not found.");
  }

  return updated;
}

export function createProfileRouter({ store, config }) {
  const router = Router();
  const { requireAuth } = createAuthMiddleware({ store, config });

  router.use(requireAuth);

  router.get("/", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({ profile: serializeProfile(req.user) });
  });

  router.patch("/", async (req, res) => {
    const patch = parseProfileUpdate(req.body);
    const updated = await applyProfilePatch(store, req.user, patch);

    res.json({
      profile: serializeProfile(updated),
      message: "Profile updated.",
    });
  });

  router.put("/resume", async (req, res) => {
    const patch = parseProfileUpdate({ resume: req.body });
    const updated = await applyProfilePatch(store, req.user, patch);

    res.json({
      profile: serializeProfile(updated),
      message: "Resume updated.",
    });
  });

  router.delete("/resume", async (req, res) => {
    const updated = await applyProfilePatch(store, req.user, { resume: null });

    res.json({
      profile: serializeProfile(updated),
      message: "Resume removed.",
    });
  });

  router.get("/:userId", async (req, res) => {
    if (
      req.user.role !== "admin" &&
      req.user.role !== "recruiter" &&
      String(req.user.id ?? req.user._id) !== req.params.userId
    ) {
      throw new HttpError(
        403,
        "FORBIDDEN",
        "You do not have access to this profile."
      );
    }

    const user = await store.findUserById(req.params.userId);

    if (!user) {
      throw new HttpError(404, "USER_NOT_FOUND", "That profile could not be found.");
    }

    const profile = serializeProfile(user);

    if (user.profile?.profileVisibility === "private" && req.user.role !== "admin") {
      throw new HttpError(
        403,
        "PROFILE_PRIVATE",
        "This profile is not visible."
      );
    }

    res.json({ profile });
  });

  return router;
}
