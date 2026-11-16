import { Router } from "express";

import {
  getPlanById,
  plans,
  toPublicPlan,
  USD_TO_BDT,
} from "../data/plans.js";
import { HttpError } from "../lib/http-error.js";
import { firstValue } from "../lib/validation.js";

function parseCurrency(value) {
  return firstValue(value).trim().toUpperCase() === "BDT" ? "BDT" : "USD";
}

function parseInterval(value) {
  const raw = firstValue(value).trim().toLowerCase();
  return raw === "yearly" || raw === "year" ? "yearly" : "monthly";
}

export function createPlansRouter() {
  const router = Router();

  router.get("/", (req, res) => {
    const currency = parseCurrency(req.query.currency);
    const interval = parseInterval(req.query.interval ?? req.query.billingInterval);

    res.setHeader("Cache-Control", "public, max-age=300");
    res.json({
      plans: plans.map((plan) => toPublicPlan(plan, { currency, interval })),
      exchangeRate: USD_TO_BDT,
      currency,
      interval,
    });
  });

  router.get("/:id", (req, res) => {
    const plan = getPlanById(req.params.id);

    if (!plan) {
      throw new HttpError(404, "PLAN_NOT_FOUND", "That plan could not be found.");
    }

    const currency = parseCurrency(req.query.currency);
    const interval = parseInterval(req.query.interval ?? req.query.billingInterval);

    res.setHeader("Cache-Control", "public, max-age=300");
    res.json({
      plan: toPublicPlan(plan, { currency, interval }),
      exchangeRate: USD_TO_BDT,
      currency,
      interval,
    });
  });

  return router;
}
