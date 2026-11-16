import { randomUUID } from "node:crypto";
import { Router } from "express";

import { findSessionUser, assertUserActive } from "../auth/current-user.js";
import {
  amountForPlan,
  getPlanById,
  priceForPlan,
} from "../data/plans.js";
import { HttpError } from "../lib/http-error.js";
import { parseCheckoutInput } from "../lib/validation.js";
import {
  recordSuccessfulCheckout,
  serializePayment,
} from "../services/billing.js";

function newSessionId() {
  return `cs_test_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
}

export function createCheckoutRouter({ store, config }) {
  const router = Router();

  router.get("/:sessionId", async (req, res) => {
    const payment = await store.findPaymentBySessionId(req.params.sessionId);

    if (!payment) {
      throw new HttpError(
        404,
        "CHECKOUT_SESSION_NOT_FOUND",
        "That checkout session could not be found."
      );
    }

    res.setHeader("Cache-Control", "no-store");
    res.json({ session: serializePayment(payment) });
  });

  router.post("/", async (req, res) => {
    const input = parseCheckoutInput(req.body);
    const plan = getPlanById(input.planId);

    if (!plan || !plan.checkoutEnabled) {
      throw new HttpError(
        400,
        "PLAN_NOT_AVAILABLE",
        "That plan is not available for checkout.",
        { field: "planId" }
      );
    }

    const user = await findSessionUser(req, store, config);

    if (user) {
      assertUserActive(user);
    }

    const amount = amountForPlan(plan, input.currency, input.interval);
    const priceUsd = priceForPlan(plan, input.interval);
    const { payment } = await recordSuccessfulCheckout(store, {
      user,
      plan,
      interval: input.interval,
      currency: input.currency,
      amount,
      priceUsd,
      input,
      sessionId: newSessionId(),
    });

    res.status(201).json({ session: serializePayment(payment) });
  });

  return router;
}
