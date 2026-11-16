import { Router } from "express";

import { createAuthMiddleware } from "../auth/current-user.js";
import {
  ALL_USER_STATUSES,
  APPLICATION_STATUS_OPTIONS,
  JOB_STATUSES,
  PAYMENT_STATUSES,
  ROLES,
  SUBSCRIPTION_STATUSES,
} from "../lib/constants.js";
import { HttpError } from "../lib/http-error.js";
import { paginationMeta, publicUser } from "../lib/serializers.js";
import {
  firstValue,
  parseAdminJobStatusInput,
  parseAdminUserUpdate,
  parseApplicationStatusFilter,
  parseJobSort,
  parseJobStatusFilter,
  parseModerationInput,
  parsePagination,
  parsePaymentStatusFilter,
  parseUserQuery,
} from "../lib/validation.js";
import { getPlanById, toPublicPlan } from "../data/plans.js";
import {
  serializeAdminApplications,
} from "../services/applications.js";
import {
  serializeInvoice,
  serializePayment,
  serializeSubscription,
} from "../services/billing.js";
import { userIdOf } from "../services/companies.js";
import {
  getAdminAnalytics,
  getAdminDashboard,
} from "../services/dashboard.js";
import {
  jobStatusLabel,
  serializeJobDetail,
  toCompanyDetail,
} from "../services/jobs.js";
import {
  createNotification,
  notifyBilling,
  notifyJobModeration,
} from "../services/notifications.js";
import { serializeProfile } from "../services/profile.js";

function parseRangeDays(value) {
  const parsed = Number.parseInt(firstValue(value), 10);

  if (!Number.isFinite(parsed)) {
    return 30;
  }

  return Math.min(Math.max(parsed, 7), 365);
}

async function applicationsForJobs(store, jobIds) {
  if (jobIds.length === 0) {
    return [];
  }

  const { items } = await store.listApplicationsByJobs(jobIds, {
    limit: undefined,
    sort: "recent",
  });

  return items;
}

async function countApplicationsForJobs(store, jobs) {
  const applications = await applicationsForJobs(
    store,
    jobs.map((job) => String(job.id ?? job._id))
  );
  const counts = new Map();

  for (const application of applications) {
    counts.set(application.jobId, (counts.get(application.jobId) ?? 0) + 1);
  }

  return counts;
}

async function serializeAdminJob(store, job, applicationsCount = 0) {
  const company = await store.findCompanyById(job.companyId);

  return serializeJobDetail(store, job, {
    status: job.status,
    statusLabel: jobStatusLabel(job.status),
    source: job.source ?? "recruiter",
    companyName: company?.name ?? job.companyName ?? "",
    applicationsCount,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    approvedAt: job.approvedAt ?? null,
    rejectionReason: job.rejectionReason ?? "",
  });
}

function userSummary(store, user) {
  if (!user) {
    return null;
  }

  return {
    ...publicUser(user, { includePrivate: true }),
    companyId: user.companyId ?? null,
  };
}

export function createAdminRouter({ store, config }) {
  const router = Router();
  const { requireAuth, requireRole } = createAuthMiddleware({ store, config });

  router.use(requireAuth, requireRole("admin"));

  /* ---------------------------------------------------------------------- */
  /* Dashboard & analytics                                                  */
  /* ---------------------------------------------------------------------- */

  router.get("/dashboard", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(await getAdminDashboard(store));
  });

  router.get("/analytics", async (req, res) => {
    const days = parseRangeDays(req.query.days ?? req.query.range);
    res.json(await getAdminAnalytics(store, days));
  });

  router.get("/meta", (req, res) => {
    res.json({
      roles: Object.values(ROLES),
      userStatuses: ALL_USER_STATUSES,
      jobStatuses: Object.values(JOB_STATUSES),
      applicationStatuses: APPLICATION_STATUS_OPTIONS,
      paymentStatuses: PAYMENT_STATUSES,
      subscriptionStatuses: SUBSCRIPTION_STATUSES,
    });
  });

  /* ---------------------------------------------------------------------- */
  /* Users                                                                  */
  /* ---------------------------------------------------------------------- */

  router.get("/users", async (req, res) => {
    const { page, limit, skip } = parsePagination(req.query, {
      defaultLimit: 20,
      maxLimit: 100,
    });
    const filters = parseUserQuery(req.query);
    const baseFilters = { q: filters.q };
    const [result, ...roleCounts] = await Promise.all([
      store.listUsers({ ...filters, skip, limit }),
      store.countUsers(filters),
      ...Object.values(ROLES).map((role) =>
        store.countUsers({ ...baseFilters, role })
      ),
      ...ALL_USER_STATUSES.map((status) =>
        store.countUsers({ ...baseFilters, status })
      ),
    ]);
    const roleCount = Object.values(ROLES).length;

    res.json({
      users: result.items.map((user) => ({
        ...publicUser(user, { includePrivate: true }),
        headline: user.profile?.headline ?? "",
        profileComplete: Number(user.profile?.completeness ?? 0),
      })),
      pagination: paginationMeta({ page, limit, total: result.total }),
      counts: {
        all: roleCounts[0],
        byRole: Object.fromEntries(
          Object.values(ROLES).map((role, index) => [
            role,
            roleCounts[index + 1],
          ])
        ),
        byStatus: Object.fromEntries(
          ALL_USER_STATUSES.map((status, index) => [
            status,
            roleCounts[roleCount + 1 + index],
          ])
        ),
      },
    });
  });

  router.get("/users/:id", async (req, res) => {
    const user = await store.findUserById(req.params.id);

    if (!user) {
      throw new HttpError(404, "USER_NOT_FOUND", "That user could not be found.");
    }

    const [
      applicationsCount,
      jobsCount,
      savedJobsCount,
      notificationsCount,
      subscription,
      company,
    ] = await Promise.all([
      store.countApplicationsByUser(req.params.id),
      store.countJobs({ createdBy: req.params.id }),
      store.countSavedJobsByUser(req.params.id),
      store.countNotificationsByUser(req.params.id),
      store.findLatestSubscriptionByUser(req.params.id),
      (user.companyId && store.findCompanyById(user.companyId)) ||
        store.findCompanyByOwner(req.params.id),
    ]);

    res.json({
      user: {
        ...publicUser(user, { includePrivate: true }),
        bio: user.profile?.bio ?? "",
        skills: user.profile?.skills ?? [],
        experience: user.profile?.experience ?? [],
        education: user.profile?.education ?? [],
        settings: user.settings ?? null,
      },
      profile: serializeProfile(user),
      company: company ? toCompanyDetail(company) : null,
      subscription: serializeSubscription(subscription),
      stats: {
        applications: applicationsCount,
        jobs: jobsCount,
        savedJobs: savedJobsCount,
        notifications: notificationsCount,
      },
    });
  });

  router.patch("/users/:id", async (req, res) => {
    const user = await store.findUserById(req.params.id);

    if (!user) {
      throw new HttpError(404, "USER_NOT_FOUND", "That user could not be found.");
    }

    const patch = parseAdminUserUpdate(req.body);
    const isSelf = userIdOf(user) === userIdOf(req.user);

    if (isSelf && (patch.role || (patch.status && patch.status !== "active"))) {
      throw new HttpError(
        400,
        "CANNOT_MODIFY_SELF",
        "You cannot change your own role or deactivate your own account."
      );
    }

    const updated = await store.updateUser(userIdOf(user), patch);

    if (!updated) {
      throw new HttpError(409, "USER_UPDATE_FAILED", "That change could not be saved.");
    }

    if (patch.status && patch.status !== "active") {
      await store.deleteSessionsForUser(userIdOf(user));
    }

    if (patch.status === "active") {
      await createNotification(store, {
        userId: userIdOf(user),
        type: "system",
        title: "Account access restored",
        message: "Your HireLoop account is active again.",
        link: "/dashboard",
      });
    }

    res.json({
      user: {
        ...publicUser(updated, { includePrivate: true }),
        headline: updated.profile?.headline ?? "",
      },
    });
  });

  router.delete("/users/:id", async (req, res) => {
    const user = await store.findUserById(req.params.id);

    if (!user) {
      throw new HttpError(404, "USER_NOT_FOUND", "That user could not be found.");
    }

    if (userIdOf(user) === userIdOf(req.user)) {
      throw new HttpError(
        400,
        "CANNOT_DELETE_SELF",
        "You cannot delete your own admin account."
      );
    }

    await store.deleteUserAndData(req.params.id);
    res.json({ ok: true, deletedUserId: req.params.id });
  });

  /* ---------------------------------------------------------------------- */
  /* Jobs & moderation                                                      */
  /* ---------------------------------------------------------------------- */

  router.get("/jobs", async (req, res) => {
    const { page, limit, skip } = parsePagination(req.query, {
      defaultLimit: 20,
      maxLimit: 100,
    });
    const filters = {
      q: firstValue(req.query.q).trim().slice(0, 120) || undefined,
      status: parseJobStatusFilter(req.query.status),
      source: firstValue(req.query.source).trim() || undefined,
      companyId: firstValue(req.query.companyId).trim() || undefined,
      sort: parseJobSort(firstValue(req.query.sort) || "recent"),
    };
    const baseFilters = {
      q: filters.q,
      source: filters.source,
      companyId: filters.companyId,
    };
    const [result, ...statusCounts] = await Promise.all([
      store.listJobs({ ...filters, skip, limit }),
      store.countJobs(filters),
      ...Object.values(JOB_STATUSES).map((status) =>
        store.countJobs({ ...baseFilters, status })
      ),
    ]);
    const applicationCounts = await countApplicationsForJobs(
      store,
      result.items
    );
    const jobs = await Promise.all(
      result.items.map((job) =>
        serializeAdminJob(
          store,
          job,
          applicationCounts.get(String(job.id ?? job._id)) ?? 0
        )
      )
    );

    res.json({
      jobs,
      pagination: paginationMeta({ page, limit, total: result.total }),
      counts: Object.fromEntries([
        ["all", statusCounts[0]],
        ...Object.values(JOB_STATUSES).map((status, index) => [
          status,
          statusCounts[index + 1],
        ]),
      ]),
    });
  });

  router.get("/jobs/:id", async (req, res) => {
    const job = await store.findJobPostById(req.params.id);

    if (!job) {
      throw new HttpError(404, "JOB_NOT_FOUND", "That job post could not be found.");
    }

    const [applications, recruiter] = await Promise.all([
      applicationsForJobs(store, [String(job.id ?? job._id)]),
      job.createdBy ? store.findUserById(job.createdBy) : null,
    ]);

    res.json({
      job: await serializeAdminJob(store, job, applications.length),
      recruiter: await userSummary(store, recruiter),
      applicationsCount: applications.length,
    });
  });

  router.post("/jobs/:id/moderate", async (req, res) => {
    const job = await store.findJobPostById(req.params.id);

    if (!job) {
      throw new HttpError(404, "JOB_NOT_FOUND", "That job post could not be found.");
    }

    const { action, reason } = parseModerationInput(req.body);
    const approved = action === "approve";
    const patch = approved
      ? {
          status: "published",
          postedAt: job.postedAt ?? new Date(),
          approvedAt: new Date(),
          approvedBy: userIdOf(req.user),
          rejectionReason: "",
        }
      : {
          status: "rejected",
          approvedAt: null,
          approvedBy: userIdOf(req.user),
          rejectionReason: reason,
        };
    const updated = await store.updateJobPost(String(job.id ?? job._id), patch);

    await notifyJobModeration(store, updated, action, reason);

    res.json({ job: await serializeAdminJob(store, updated) });
  });

  router.patch("/jobs/:id", async (req, res) => {
    const job = await store.findJobPostById(req.params.id);

    if (!job) {
      throw new HttpError(404, "JOB_NOT_FOUND", "That job post could not be found.");
    }

    const { status, reason } = parseAdminJobStatusInput(req.body);

    if (status === "rejected" && reason.length < 3) {
      throw new HttpError(
        400,
        "VALIDATION_ERROR",
        "Add a short reason for rejecting this job.",
        { field: "reason" }
      );
    }

    const patch = {
      status,
      ...(status === "published"
        ? {
            postedAt: job.postedAt ?? new Date(),
            approvedAt: new Date(),
            approvedBy: userIdOf(req.user),
            rejectionReason: "",
          }
        : {}),
      ...(status === "rejected" ? { rejectionReason: reason } : {}),
    };
    const updated = await store.updateJobPost(String(job.id ?? job._id), patch);

    if (status === "published" || status === "rejected") {
      await notifyJobModeration(
        store,
        updated,
        status === "published" ? "approve" : "reject",
        reason
      );
    }

    res.json({ job: await serializeAdminJob(store, updated) });
  });

  router.delete("/jobs/:id", async (req, res) => {
    const job = await store.findJobPostById(req.params.id);

    if (!job) {
      throw new HttpError(404, "JOB_NOT_FOUND", "That job post could not be found.");
    }

    await Promise.all([
      store.deleteApplicationsForJob(req.params.id),
      store.deleteSavedJobsForJob(req.params.id),
      store.deleteJobPost(req.params.id),
    ]);

    res.json({ ok: true, deletedJobId: req.params.id });
  });

  router.get("/applications", async (req, res) => {
    const { page, limit, skip } = parsePagination(req.query, {
      defaultLimit: 20,
      maxLimit: 100,
    });
    const status = parseApplicationStatusFilter(req.query.status);
    const jobId = firstValue(req.query.jobId).trim();
    const all = jobId
      ? (await store.listApplicationsByJobs([jobId], { limit: undefined })).items
      : (await store.listAllApplications({ limit: undefined })).items;
    const filtered = status
      ? all.filter((application) => application.status === status)
      : all;
    const serialized = await serializeAdminApplications(store, filtered);
    const query = firstValue(req.query.q).trim().toLowerCase();
    const searched = query
      ? serialized.filter((application) =>
          [
            application.candidate?.name,
            application.candidate?.email,
            application.job?.title,
          ].some((value) => String(value ?? "").toLowerCase().includes(query))
        )
      : serialized;

    res.json({
      applications: searched.slice(skip, skip + limit),
      pagination: paginationMeta({
        page,
        limit,
        total: searched.length,
      }),
      counts: Object.fromEntries([
        ["all", all.length],
        ...APPLICATION_STATUS_OPTIONS.map((option) => [
          option.value,
          all.filter((application) => application.status === option.value)
            .length,
        ]),
      ]),
    });
  });

  /* ---------------------------------------------------------------------- */
  /* Companies                                                              */
  /* ---------------------------------------------------------------------- */

  router.get("/companies", async (req, res) => {
    const { page, limit, skip } = parsePagination(req.query, {
      defaultLimit: 20,
      maxLimit: 100,
    });
    const q = firstValue(req.query.q).trim().slice(0, 120);
    const result = await store.listCompanies({ q, skip, limit });
    const companies = await Promise.all(
      result.items.map(async (company) => {
        const companyId = String(company.id ?? company._id);
        const [jobsCount, owner] = await Promise.all([
          store.countJobs({ companyId }),
          company.ownerId ? store.findUserById(company.ownerId) : null,
        ]);

        return {
          ...toCompanyDetail(company),
          jobsCount,
          owner: owner
            ? {
                id: userIdOf(owner),
                name: owner.name,
                email: owner.email,
              }
            : null,
        };
      })
    );

    res.json({
      companies,
      pagination: paginationMeta({ page, limit, total: result.total }),
    });
  });

  router.patch("/companies/:id", async (req, res) => {
    const company = await store.findCompanyById(req.params.id);

    if (!company) {
      throw new HttpError(
        404,
        "COMPANY_NOT_FOUND",
        "That company could not be found."
      );
    }

    if (typeof req.body?.verified !== "boolean") {
      throw new HttpError(
        400,
        "VALIDATION_ERROR",
        "Choose whether this company is verified.",
        { field: "verified" }
      );
    }

    const updated = await store.updateCompany(req.params.id, {
      verified: req.body.verified,
    });

    res.json({ company: toCompanyDetail(updated) });
  });

  /* ---------------------------------------------------------------------- */
  /* Payments, invoices & subscriptions                                     */
  /* ---------------------------------------------------------------------- */

  router.get("/payments", async (req, res) => {
    const { page, limit, skip } = parsePagination(req.query, {
      defaultLimit: 20,
      maxLimit: 100,
    });
    const filters = {
      status: parsePaymentStatusFilter(req.query.status),
      planId: firstValue(req.query.planId).trim() || undefined,
      q: firstValue(req.query.q).trim().slice(0, 120) || undefined,
    };
    const [
      result,
      revenueUsd,
      refundedUsd,
      totalPayments,
      ...statusResults
    ] = await Promise.all([
      store.listPayments({ ...filters, skip, limit }),
      store.sumPaymentAmountUsd({ status: "succeeded" }),
      store.sumPaymentAmountUsd({ status: "refunded" }),
      store.countPayments(),
      ...PAYMENT_STATUSES.map((status) =>
        store.listPayments({ status, limit: 1 })
      ),
    ]);

    res.json({
      payments: result.items.map(serializePayment),
      pagination: paginationMeta({ page, limit, total: result.total }),
      summary: {
        totalPayments,
        revenueUsd: Math.round(revenueUsd * 100) / 100,
        refundedUsd: Math.round(refundedUsd * 100) / 100,
        byStatus: Object.fromEntries(
          PAYMENT_STATUSES.map((status, index) => [
            status,
            statusResults[index].total,
          ])
        ),
      },
    });
  });

  router.get("/payments/:id", async (req, res) => {
    const payment = await store.findPaymentById(req.params.id);

    if (!payment) {
      throw new HttpError(
        404,
        "PAYMENT_NOT_FOUND",
        "That payment could not be found."
      );
    }

    const [invoice, user] = await Promise.all([
      payment.invoiceId ? store.findInvoiceById(payment.invoiceId) : null,
      payment.userId ? store.findUserById(payment.userId) : null,
    ]);

    res.json({
      payment: serializePayment(payment),
      invoice: invoice ? serializeInvoice(invoice) : null,
      user: await userSummary(store, user),
    });
  });

  router.post("/payments/:id/refund", async (req, res) => {
    const payment = await store.findPaymentById(req.params.id);

    if (!payment) {
      throw new HttpError(
        404,
        "PAYMENT_NOT_FOUND",
        "That payment could not be found."
      );
    }

    if (payment.status !== "succeeded") {
      throw new HttpError(
        409,
        "PAYMENT_NOT_REFUNDABLE",
        "Only successful payments can be refunded."
      );
    }

    const updated = await store.updatePayment(req.params.id, {
      status: "refunded",
      refundedAt: new Date(),
    });

    if (payment.invoiceId) {
      await store.updateInvoice(payment.invoiceId, { status: "refunded" });
    }

    if (payment.userId) {
      await notifyBilling(store, payment.userId, {
        title: "Payment refunded",
        message: `${payment.currency} ${Number(payment.amount).toFixed(
          2
        )} for ${payment.planName} was refunded.`,
        meta: { paymentId: payment.id },
      });
    }

    res.json({ payment: serializePayment(updated) });
  });

  router.get("/invoices", async (req, res) => {
    const { page, limit, skip } = parsePagination(req.query, {
      defaultLimit: 20,
      maxLimit: 100,
    });
    const result = await store.listInvoices({ skip, limit });
    const owners = await Promise.all(
      result.items.map((invoice) =>
        invoice.userId ? store.findUserById(invoice.userId) : null
      )
    );

    res.json({
      invoices: result.items.map((invoice, index) => ({
        ...serializeInvoice(invoice),
        user: userSummary(store, owners[index]),
      })),
      pagination: paginationMeta({ page, limit, total: result.total }),
    });
  });

  router.get("/subscriptions", async (req, res) => {
    const { page, limit, skip } = parsePagination(req.query, {
      defaultLimit: 20,
      maxLimit: 100,
    });
    const status = firstValue(req.query.status).trim() || undefined;
    const planId = firstValue(req.query.planId).trim() || undefined;
    const result = await store.listSubscriptions({ status, planId, skip, limit });
    const owners = await Promise.all(
      result.items.map((subscription) =>
        subscription.userId ? store.findUserById(subscription.userId) : null
      )
    );

    res.json({
      subscriptions: result.items.map((subscription, index) => ({
        ...serializeSubscription(subscription),
        user: userSummary(store, owners[index]),
        plan: getPlanById(subscription.planId)
          ? toPublicPlan(getPlanById(subscription.planId), {
              currency: subscription.currency ?? "USD",
              interval: subscription.interval ?? "monthly",
            })
          : null,
      })),
      pagination: paginationMeta({ page, limit, total: result.total }),
    });
  });

  router.patch("/subscriptions/:id", async (req, res) => {
    const subscription = await store.findSubscriptionById(req.params.id);

    if (!subscription) {
      throw new HttpError(
        404,
        "SUBSCRIPTION_NOT_FOUND",
        "That subscription could not be found."
      );
    }

    const status = firstValue(req.body?.status).trim().toLowerCase();

    if (!SUBSCRIPTION_STATUSES.includes(status)) {
      throw new HttpError(
        400,
        "VALIDATION_ERROR",
        "Choose a valid subscription status.",
        { field: "status" }
      );
    }

    const updated = await store.updateSubscription(req.params.id, {
      status,
      ...(status === "canceled" || status === "expired"
        ? { cancelAtPeriodEnd: false, canceledAt: new Date() }
        : {}),
    });

    res.json({ subscription: serializeSubscription(updated) });
  });

  router.post("/subscriptions/:id/cancel", async (req, res) => {
    const subscription = await store.findSubscriptionById(req.params.id);

    if (!subscription) {
      throw new HttpError(
        404,
        "SUBSCRIPTION_NOT_FOUND",
        "That subscription could not be found."
      );
    }

    const updated = await store.updateSubscription(req.params.id, {
      status: "canceled",
      cancelAtPeriodEnd: false,
      canceledAt: new Date(),
    });

    if (subscription.userId) {
      await notifyBilling(store, subscription.userId, {
        title: "Subscription canceled",
        message: `Your ${subscription.planName} subscription was canceled by support.`,
        meta: { subscriptionId: subscription.id },
      });
    }

    res.json({ subscription: serializeSubscription(updated) });
  });

  return router;
}
