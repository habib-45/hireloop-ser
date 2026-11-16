import { Router } from "express";

import { createAuthMiddleware } from "../auth/current-user.js";
import {
  APPLICATION_STATUS_OPTIONS,
  ACTIVE_APPLICATION_STATUSES,
} from "../lib/constants.js";
import { isPast } from "../lib/dates.js";
import { HttpError } from "../lib/http-error.js";
import { paginationMeta } from "../lib/serializers.js";
import {
  parseApplicationCreateInput,
  parseApplicationStatusFilter,
  parseApplicationWithdrawInput,
  parsePagination,
} from "../lib/validation.js";
import {
  canWithdraw,
  serializeSeekerApplication,
  serializeSeekerApplications,
  submitApplication,
} from "../services/applications.js";
import { createNotification } from "../services/notifications.js";

async function applicationCounts(store, userId) {
  const [total, ...perStatus] = await Promise.all([
    store.countApplicationsByUser(userId),
    ...APPLICATION_STATUS_OPTIONS.map((option) =>
      store.countApplicationsByUser(userId, { status: option.value })
    ),
  ]);

  return {
    counts: Object.fromEntries([
      ["all", total],
      ...APPLICATION_STATUS_OPTIONS.map((option, index) => [
        option.value,
        perStatus[index],
      ]),
    ]),
    statusBreakdown: APPLICATION_STATUS_OPTIONS.map((option, index) => ({
      ...option,
      count: perStatus[index],
    })),
    activeCount: ACTIVE_APPLICATION_STATUSES.reduce(
      (sum, status) =>
        sum +
        perStatus[
          APPLICATION_STATUS_OPTIONS.findIndex(
            (option) => option.value === status
          )
        ],
      0
    ),
  };
}

export function createApplicationsRouter({ store, config }) {
  const router = Router();
  const { requireAuth, requireRole } = createAuthMiddleware({ store, config });

  router.use(requireAuth, requireRole("job_seeker"));

  router.get("/", async (req, res) => {
    const userId = String(req.user.id ?? req.user._id);
    const { page, limit, skip } = parsePagination(req.query, {
      defaultLimit: 20,
      maxLimit: 100,
    });
    const status = parseApplicationStatusFilter(req.query.status);
    const [result, summary] = await Promise.all([
      store.listApplicationsByUser(userId, { status, skip, limit }),
      applicationCounts(store, userId),
    ]);
    const applications = await serializeSeekerApplications(
      store,
      result.items
    );

    res.json({
      applications,
      pagination: paginationMeta({ page, limit, total: result.total }),
      ...summary,
    });
  });

  router.post("/", async (req, res) => {
    const { jobId, ...input } = parseApplicationCreateInput(req.body);
    const job = await store.findJobPostById(jobId);

    if (!job || job.status !== "published") {
      throw new HttpError(404, "JOB_NOT_FOUND", "That job could not be found.");
    }

    if (job.deadline && isPast(job.deadline)) {
      throw new HttpError(
        409,
        "JOB_CLOSED",
        "Applications for this job are closed."
      );
    }

    const application = await submitApplication(store, {
      user: req.user,
      job,
      input,
    });

    res.status(201).json({
      application: await serializeSeekerApplication(store, application),
    });
  });

  router.get("/:id", async (req, res) => {
    const application = await store.findApplicationById(req.params.id);
    const userId = String(req.user.id ?? req.user._id);

    if (!application || application.userId !== userId) {
      throw new HttpError(
        404,
        "APPLICATION_NOT_FOUND",
        "That application could not be found."
      );
    }

    res.json({
      application: await serializeSeekerApplication(store, application),
    });
  });

  router.post("/:id/withdraw", async (req, res) => {
    const application = await store.findApplicationById(req.params.id);
    const userId = String(req.user.id ?? req.user._id);

    if (!application || application.userId !== userId) {
      throw new HttpError(
        404,
        "APPLICATION_NOT_FOUND",
        "That application could not be found."
      );
    }

    if (!canWithdraw(application.status)) {
      throw new HttpError(
        409,
        "APPLICATION_NOT_WITHDRAWABLE",
        "This application can no longer be withdrawn."
      );
    }

    const { note } = parseApplicationWithdrawInput(req.body);
    const updated = await store.updateApplication(application.id, {
      status: "withdrawn",
      statusHistory: [
        ...(application.statusHistory ?? []),
        {
          status: "withdrawn",
          note: note || "Application withdrawn by the candidate.",
          at: new Date(),
          by: userId,
        },
      ],
    });

    const job = await store.findJobPostById(application.jobId);

    if (job?.createdBy) {
      await createNotification(store, {
        userId: job.createdBy,
        type: "application",
        title: "Application withdrawn",
        message: `A candidate withdrew their application for ${application.jobTitle}.`,
        link: "/recruiter/applications",
        meta: { applicationId: application.id, jobId: application.jobId },
      });
    }

    res.json({
      application: await serializeSeekerApplication(store, updated),
    });
  });

  return router;
}
