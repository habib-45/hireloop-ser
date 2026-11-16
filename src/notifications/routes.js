import { Router } from "express";

import { createAuthMiddleware } from "../auth/current-user.js";
import { HttpError } from "../lib/http-error.js";
import { paginationMeta } from "../lib/serializers.js";
import { firstValue, parsePagination } from "../lib/validation.js";
import { serializeNotification } from "../services/notifications.js";

function ownedNotification(notification, userId) {
  return notification && notification.userId === userId;
}

export function createNotificationsRouter({ store, config }) {
  const router = Router();
  const { requireAuth } = createAuthMiddleware({ store, config });

  router.use(requireAuth);

  router.get("/", async (req, res) => {
    const userId = String(req.user.id ?? req.user._id);
    const { page, limit, skip } = parsePagination(req.query, {
      defaultLimit: 20,
      maxLimit: 100,
    });
    const unreadOnly =
      firstValue(req.query.unread).toLowerCase() === "true" ||
      firstValue(req.query.unreadOnly).toLowerCase() === "true";
    const [result, unreadCount] = await Promise.all([
      store.listNotificationsByUser(userId, { unreadOnly, skip, limit }),
      store.countNotificationsByUser(userId, { unreadOnly: true }),
    ]);

    res.setHeader("Cache-Control", "no-store");
    res.json({
      notifications: result.items.map(serializeNotification),
      pagination: paginationMeta({ page, limit, total: result.total }),
      unreadCount,
    });
  });

  router.get("/unread-count", async (req, res) => {
    const count = await store.countNotificationsByUser(
      String(req.user.id ?? req.user._id),
      { unreadOnly: true }
    );

    res.json({ count });
  });

  router.post("/read-all", async (req, res) => {
    const updated = await store.markAllNotificationsRead(
      String(req.user.id ?? req.user._id)
    );

    res.json({ ok: true, updated });
  });

  router.post("/:id/read", async (req, res) => {
    const userId = String(req.user.id ?? req.user._id);
    const notification = await store.findNotificationById(req.params.id);

    if (!ownedNotification(notification, userId)) {
      throw new HttpError(
        404,
        "NOTIFICATION_NOT_FOUND",
        "That notification could not be found."
      );
    }

    const updated =
      notification.read
        ? notification
        : await store.updateNotification(notification.id, { read: true });

    res.json({ notification: serializeNotification(updated) });
  });

  router.post("/:id/unread", async (req, res) => {
    const userId = String(req.user.id ?? req.user._id);
    const notification = await store.findNotificationById(req.params.id);

    if (!ownedNotification(notification, userId)) {
      throw new HttpError(
        404,
        "NOTIFICATION_NOT_FOUND",
        "That notification could not be found."
      );
    }

    const updated = await store.updateNotification(notification.id, {
      read: false,
    });

    res.json({ notification: serializeNotification(updated) });
  });

  router.delete("/:id", async (req, res) => {
    const removed = await store.deleteNotification(
      String(req.user.id ?? req.user._id),
      req.params.id
    );

    if (!removed) {
      throw new HttpError(
        404,
        "NOTIFICATION_NOT_FOUND",
        "That notification could not be found."
      );
    }

    res.json({ ok: true });
  });

  return router;
}
