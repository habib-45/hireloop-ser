import { Router } from "express";

import { createAuthMiddleware } from "../auth/current-user.js";
import {
  getPlanById,
  priceForPlan,
  toPublicPlan,
} from "../data/plans.js";
import { HttpError } from "../lib/http-error.js";
import { paginationMeta } from "../lib/serializers.js";
import {
  parseBillingChangePlanInput,
  parsePagination,
  parsePaymentMethodInput,
} from "../lib/validation.js";
import {
  buildPaymentMethod,
  nextPaymentFor,
  periodForInterval,
  serializeInvoice,
  serializePayment,
  serializeSubscription,
} from "../services/billing.js";
import { notifyBilling } from "../services/notifications.js";

function invoiceWithDownload(invoice) {
  if (!invoice) {
    return null;
  }

  const serialized = serializeInvoice(invoice);

  return {
    ...serialized,
    downloadUrl: `/api/billing/invoices/${serialized.id}/download`,
  };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function invoiceHtml(invoice, user) {
  const amount = `${invoice.currency ?? "USD"} ${Number(
    invoice.amount ?? 0
  ).toFixed(2)}`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(invoice.number)} · HireLoop</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 40px; color: #111827; }
    .card { max-width: 720px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 16px; padding: 32px; }
    h1 { margin: 0 0 4px; font-size: 24px; }
    table { width: 100%; border-collapse: collapse; margin-top: 28px; }
    th, td { text-align: left; padding: 10px 0; border-bottom: 1px solid #e5e7eb; }
    .muted { color: #6b7280; font-size: 14px; }
    .total { font-size: 20px; font-weight: 700; }
  </style>
</head>
<body>
  <div class="card">
    <h1>HireLoop invoice</h1>
    <div class="muted">${escapeHtml(invoice.number)} · Issued ${escapeHtml(
      invoice.issuedAt ? new Date(invoice.issuedAt).toDateString() : ""
    )}</div>
    <table>
      <tr><th>Billed to</th><td>${escapeHtml(user?.name)}<br />${escapeHtml(
        user?.email
      )}</td></tr>
      <tr><th>Plan</th><td>${escapeHtml(invoice.planName)}</td></tr>
      <tr><th>Description</th><td>${escapeHtml(invoice.description)}</td></tr>
      <tr><th>Status</th><td>${escapeHtml(invoice.status)}</td></tr>
      <tr><th>Total</th><td class="total">${escapeHtml(amount)}</td></tr>
    </table>
    <p class="muted">This invoice was generated in HireLoop's sandbox billing environment.</p>
  </div>
</body>
</html>`;
}

async function ownInvoice(store, user, invoiceId) {
  const invoice = await store.findInvoiceById(invoiceId);

  if (!invoice) {
    throw new HttpError(404, "INVOICE_NOT_FOUND", "That invoice could not be found.");
  }

  const userId = String(user.id ?? user._id);

  if (user.role !== "admin" && invoice.userId !== userId) {
    throw new HttpError(404, "INVOICE_NOT_FOUND", "That invoice could not be found.");
  }

  return invoice;
}

export function createBillingRouter({ store, config }) {
  const router = Router();
  const { requireAuth } = createAuthMiddleware({ store, config });

  router.use(requireAuth);

  router.get("/", async (req, res) => {
    const userId = String(req.user.id ?? req.user._id);
    const [
      subscription,
      invoicesResult,
      paymentsResult,
      subscriptionsResult,
    ] = await Promise.all([
      store.findLatestSubscriptionByUser(userId),
      store.listInvoicesByUser(userId, { limit: 12 }),
      store.listPaymentsByUser(userId, { limit: 12 }),
      store.listSubscriptionsByUser(userId, { limit: 20 }),
    ]);
    const plan = subscription ? getPlanById(subscription.planId) : null;

    res.setHeader("Cache-Control", "no-store");
    res.json({
      subscription: serializeSubscription(subscription),
      plan: plan
        ? toPublicPlan(plan, {
            currency: subscription.currency ?? "USD",
            interval: subscription.interval ?? "monthly",
          })
        : null,
      nextPayment: nextPaymentFor(subscription, plan),
      paymentMethods: subscription?.paymentMethod
        ? [subscription.paymentMethod]
        : [],
      invoices: invoicesResult.items.map(invoiceWithDownload),
      payments: paymentsResult.items.map(serializePayment),
      subscriptions: subscriptionsResult.items.map(serializeSubscription),
    });
  });

  router.get("/invoices", async (req, res) => {
    const userId = String(req.user.id ?? req.user._id);
    const { page, limit, skip } = parsePagination(req.query, {
      defaultLimit: 20,
      maxLimit: 100,
    });
    const result = await store.listInvoicesByUser(userId, { skip, limit });

    res.json({
      invoices: result.items.map(invoiceWithDownload),
      pagination: paginationMeta({ page, limit, total: result.total }),
    });
  });

  router.get("/invoices/:id", async (req, res) => {
    const invoice = await ownInvoice(store, req.user, req.params.id);

    res.json({ invoice: invoiceWithDownload(invoice) });
  });

  router.get("/invoices/:id/download", async (req, res) => {
    const invoice = await ownInvoice(store, req.user, req.params.id);
    const owner = invoice.userId
      ? await store.findUserById(invoice.userId)
      : req.user;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${invoice.number ?? invoice.id}.html"`
    );
    res.send(invoiceHtml(invoice, owner ?? req.user));
  });

  router.get("/payments", async (req, res) => {
    const userId = String(req.user.id ?? req.user._id);
    const { page, limit, skip } = parsePagination(req.query, {
      defaultLimit: 20,
      maxLimit: 100,
    });
    const result = await store.listPaymentsByUser(userId, { skip, limit });

    res.json({
      payments: result.items.map(serializePayment),
      pagination: paginationMeta({ page, limit, total: result.total }),
    });
  });

  router.post("/change-plan", async (req, res) => {
    const { planId, interval } = parseBillingChangePlanInput(req.body);
    const plan = getPlanById(planId);

    if (!plan) {
      throw new HttpError(404, "PLAN_NOT_FOUND", "That plan could not be found.", {
        field: "planId",
      });
    }

    const userId = String(req.user.id ?? req.user._id);
    const current = await store.findActiveSubscriptionByUser(userId);

    if (plan.id === "starter") {
      if (current) {
        await store.updateSubscription(current.id, {
          status: "canceled",
          cancelAtPeriodEnd: false,
          canceledAt: new Date(),
        });
      }

      return res.json({
        subscription: null,
        plan: toPublicPlan(plan, { interval }),
        message: "You are now on the Starter plan.",
      });
    }

    if (!plan.checkoutEnabled) {
      throw new HttpError(
        400,
        "PLAN_NOT_AVAILABLE",
        "That plan is not available for self-serve billing.",
        { field: "planId" }
      );
    }

    const start = new Date();
    const period = periodForInterval(interval, start);
    const priceUsd = priceForPlan(plan, interval);
    const patch = {
      planId: plan.id,
      planName: plan.name,
      planDescription: plan.description,
      interval,
      status: "active",
      priceUsd,
      monthlyPriceUsd: plan.monthlyPriceUsd,
      currency: current?.currency ?? "USD",
      currentPeriodStart: period.start,
      currentPeriodEnd: period.end,
      cancelAtPeriodEnd: false,
      canceledAt: null,
    };
    const subscription = current
      ? await store.updateSubscription(current.id, patch)
      : await store.createSubscription({
          userId,
          ...patch,
          paymentMethod: buildPaymentMethod({ name: req.user.name }),
          createdAt: start,
          updatedAt: start,
        });

    await notifyBilling(store, userId, {
      title: "Plan updated",
      message: `Your subscription is now ${plan.name}, billed ${interval}.`,
      meta: { planId: plan.id, interval },
    });

    res.json({
      subscription: serializeSubscription(subscription),
      plan: toPublicPlan(plan, {
        currency: subscription?.currency ?? "USD",
        interval,
      }),
      message: "Plan updated.",
    });
  });

  router.post("/cancel", async (req, res) => {
    const userId = String(req.user.id ?? req.user._id);
    const subscription = await store.findActiveSubscriptionByUser(userId);

    if (!subscription) {
      throw new HttpError(
        404,
        "SUBSCRIPTION_NOT_FOUND",
        "You do not have an active subscription."
      );
    }

    const updated = await store.updateSubscription(subscription.id, {
      cancelAtPeriodEnd: true,
      canceledAt: new Date(),
    });

    await notifyBilling(store, userId, {
      title: "Subscription cancellation scheduled",
      message:
        "Your plan stays active until the end of the current billing period, then it will not renew.",
      meta: { subscriptionId: subscription.id },
    });

    res.json({ subscription: serializeSubscription(updated) });
  });

  router.post("/resume", async (req, res) => {
    const userId = String(req.user.id ?? req.user._id);
    const subscription = await store.findLatestSubscriptionByUser(userId);

    if (!subscription || subscription.status !== "active") {
      throw new HttpError(
        404,
        "SUBSCRIPTION_NOT_FOUND",
        "You do not have an active subscription."
      );
    }

    const updated = await store.updateSubscription(subscription.id, {
      cancelAtPeriodEnd: false,
      canceledAt: null,
    });

    res.json({ subscription: serializeSubscription(updated) });
  });

  router.post("/payment-method", async (req, res) => {
    const input = parsePaymentMethodInput(req.body);
    const userId = String(req.user.id ?? req.user._id);
    const subscription = await store.findLatestSubscriptionByUser(userId);

    if (!subscription) {
      throw new HttpError(
        404,
        "SUBSCRIPTION_NOT_FOUND",
        "Choose a plan before adding a payment method."
      );
    }

    const paymentMethod = buildPaymentMethod(input);
    const updated = await store.updateSubscription(subscription.id, {
      paymentMethod,
    });

    res.json({
      paymentMethod,
      subscription: serializeSubscription(updated),
    });
  });

  router.delete("/payment-method", async (req, res) => {
    const userId = String(req.user.id ?? req.user._id);
    const subscription = await store.findLatestSubscriptionByUser(userId);

    if (!subscription) {
      throw new HttpError(
        404,
        "SUBSCRIPTION_NOT_FOUND",
        "You do not have a subscription."
      );
    }

    const updated = await store.updateSubscription(subscription.id, {
      paymentMethod: null,
    });

    res.json({
      paymentMethod: null,
      subscription: serializeSubscription(updated),
    });
  });

  return router;
}
