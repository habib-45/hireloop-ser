import { USD_TO_BDT } from "../data/plans.js";
import { addMonths, toIso } from "../lib/dates.js";
import { notifyBilling } from "./notifications.js";

export function buildPaymentMethod({
  brand = "visa",
  last4 = "4242",
  expMonth = 12,
  expYear = new Date().getFullYear() + 8,
  name = "Hireloop Member",
} = {}) {
  return { brand, last4, expMonth, expYear, name };
}

export function serializeSubscription(subscription) {
  if (!subscription) {
    return null;
  }

  return {
    id: String(subscription.id ?? subscription._id),
    planId: subscription.planId,
    planName: subscription.planName,
    interval: subscription.interval ?? "monthly",
    status: subscription.status,
    priceUsd: Number(subscription.priceUsd ?? 0),
    monthlyPriceUsd: Number(
      subscription.monthlyPriceUsd ?? subscription.priceUsd ?? 0
    ),
    currency: subscription.currency ?? "USD",
    currentPeriodStart: toIso(subscription.currentPeriodStart),
    currentPeriodEnd: toIso(subscription.currentPeriodEnd),
    cancelAtPeriodEnd: Boolean(subscription.cancelAtPeriodEnd),
    canceledAt: toIso(subscription.canceledAt),
    paymentMethod: subscription.paymentMethod ?? null,
    createdAt: toIso(subscription.createdAt),
    updatedAt: toIso(subscription.updatedAt),
  };
}

export function serializeInvoice(invoice) {
  if (!invoice) {
    return null;
  }

  return {
    id: String(invoice.id ?? invoice._id),
    number: invoice.number,
    userId: invoice.userId ?? null,
    paymentId: invoice.paymentId ?? null,
    subscriptionId: invoice.subscriptionId ?? null,
    planId: invoice.planId ?? null,
    planName: invoice.planName ?? null,
    description: invoice.description ?? "",
    amount: Number(invoice.amount ?? 0),
    currency: invoice.currency ?? "USD",
    status: invoice.status ?? "paid",
    issuedAt: toIso(invoice.issuedAt ?? invoice.createdAt),
    paidAt: toIso(invoice.paidAt),
    downloadUrl: invoice.downloadUrl ?? null,
  };
}

export function serializePayment(payment) {
  if (!payment) {
    return null;
  }

  return {
    id: String(payment.id ?? payment._id),
    sessionId: payment.sessionId,
    planId: payment.planId,
    planName: payment.planName,
    planDescription: payment.planDescription ?? "",
    billingInterval: payment.billingInterval ?? "monthly",
    amount: Number(payment.amount ?? 0),
    amountUsd: Number(payment.amountUsd ?? 0),
    currency: payment.currency ?? "USD",
    exchangeRate: payment.exchangeRate ?? USD_TO_BDT,
    status: payment.status,
    mode: "test",
    paymentMethod: payment.paymentMethod === "pm_card_visa" ? "visa" : payment.paymentMethod,
    last4: payment.last4 ?? "4242",
    saveInfo: Boolean(payment.saveInfo),
    email: payment.email ?? "",
    name: payment.name ?? "",
    country: payment.country ?? "",
    invoiceId: payment.invoiceId ?? null,
    subscriptionId: payment.subscriptionId ?? null,
    userId: payment.userId ?? null,
    createdAt: toIso(payment.createdAt),
  };
}

export async function nextInvoiceNumber(store) {
  const count = await store.countInvoices();
  return `INV-${new Date().getFullYear()}-${String(count + 1).padStart(4, "0")}`;
}

export function periodForInterval(interval, start = new Date()) {
  const months = interval === "yearly" ? 12 : 1;

  return {
    start,
    end: addMonths(start, months),
  };
}

export function amountUsdFor(amount, currency) {
  return currency === "BDT"
    ? Math.round((Number(amount) / USD_TO_BDT) * 100) / 100
    : Number(amount);
}

/**
 * Creates the subscription, payment and invoice for a successful sandbox
 * checkout. Guests receive a payment record only.
 */
export async function recordSuccessfulCheckout(
  store,
  { user, plan, interval, currency, amount, priceUsd, input, sessionId }
) {
  const start = new Date();
  const period = periodForInterval(interval, start);
  const paymentMethod = buildPaymentMethod({ name: input.name });
  const userId = user ? String(user.id ?? user._id) : null;
  let subscription = null;
  let payment = null;
  let invoice = null;

  if (user) {
    const existing = await store.findActiveSubscriptionByUser(userId);

    if (existing) {
      await store.updateSubscription(existing.id, {
        status: "canceled",
        cancelAtPeriodEnd: false,
        canceledAt: start,
      });
    }

    subscription = await store.createSubscription({
      userId,
      planId: plan.id,
      planName: plan.name,
      planDescription: plan.description,
      interval,
      status: "active",
      priceUsd,
      monthlyPriceUsd: plan.monthlyPriceUsd,
      currency,
      currentPeriodStart: period.start,
      currentPeriodEnd: period.end,
      cancelAtPeriodEnd: false,
      canceledAt: null,
      paymentMethod,
      createdAt: start,
      updatedAt: start,
    });
  }

  payment = await store.createPayment({
    sessionId,
    planId: plan.id,
    planName: plan.name,
    planDescription: plan.description,
    billingInterval: interval,
    amount,
    amountUsd: amountUsdFor(amount, currency),
    currency,
    exchangeRate: USD_TO_BDT,
    status: "succeeded",
    mode: "test",
    email: input.email,
    name: input.name,
    country: input.country,
    paymentMethod: input.paymentMethod,
    last4: "4242",
    saveInfo: input.saveInfo,
    userId,
    subscriptionId: subscription?.id ?? null,
    createdAt: start,
    updatedAt: start,
  });

  invoice = await store.createInvoice({
    number: await nextInvoiceNumber(store),
    userId,
    paymentId: payment?.id ?? null,
    subscriptionId: subscription?.id ?? null,
    planId: plan.id,
    planName: plan.name,
    description: `${plan.name} · ${interval}`,
    amount,
    currency,
    status: "paid",
    issuedAt: start,
    paidAt: start,
    createdAt: start,
  });

  if (payment && invoice) {
    payment = (await store.updatePayment(payment.id, { invoiceId: invoice.id })) ?? payment;
  }

  if (user) {
    await notifyBilling(store, userId, {
      title: "Subscription confirmed",
      message: `Your ${plan.name} is active. ${
        currency === "BDT"
          ? `BDT ${Number(amount).toFixed(2)}`
          : `$${Number(amount).toFixed(2)}`
      } was charged for ${interval} billing.`,
      meta: {
        paymentId: payment?.id ?? null,
        invoiceId: invoice?.id ?? null,
        planId: plan.id,
      },
    });
  }

  return { subscription, payment, invoice };
}

export function nextPaymentFor(subscription, plan) {
  if (!subscription || !plan) {
    return null;
  }

  return {
    amount: Number(subscription.priceUsd ?? 0),
    currency: subscription.currency ?? "USD",
    date: toIso(subscription.currentPeriodEnd),
    interval: subscription.interval ?? "monthly",
    planName: subscription.planName ?? plan.name,
  };
}

export function computeMonthlyRecurringRevenue(subscriptions) {
  return subscriptions
    .filter((subscription) => subscription.status === "active")
    .reduce(
      (total, subscription) =>
        total + Number(subscription.monthlyPriceUsd ?? subscription.priceUsd ?? 0),
      0
    );
}
