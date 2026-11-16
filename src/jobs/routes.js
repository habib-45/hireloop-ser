import { Router } from "express";

import {
  createAuthMiddleware,
  findSessionUser,
} from "../auth/current-user.js";
import {
  JOB_TYPE_OPTIONS,
  WORKPLACE_LABELS,
  WORKPLACES,
} from "../lib/constants.js";
import { isPast } from "../lib/dates.js";
import { HttpError } from "../lib/http-error.js";
import { paginationMeta } from "../lib/serializers.js";
import {
  firstValue,
  parseApplicationInput,
  parseJobSort,
  parseList,
  parsePagination,
} from "../lib/validation.js";
import {
  serializeJobDetail,
  serializeJobs,
  getRelatedJobs,
} from "../services/jobs.js";
import { submitApplication } from "../services/applications.js";

function parseBooleanQuery(value) {
  const raw = firstValue(value).trim().toLowerCase();

  if (raw === "true" || raw === "1") return true;
  if (raw === "false" || raw === "0") return false;
  return undefined;
}

function parseNumberQuery(value) {
  const raw = firstValue(value).trim();

  if (!raw) {
    return undefined;
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function parseJobListFilters(query) {
  const types = [
    ...new Set(
      [...parseList(query.types), ...parseList(query.type)].map((value) =>
        value.toLowerCase()
      )
    ),
  ].filter((value) => JOB_TYPE_OPTIONS.some((option) => option.value === value));

  const workplace = [
    ...new Set(
      [...parseList(query.workplace)].map((value) => value.toLowerCase())
    ),
  ].filter((value) => WORKPLACES.includes(value));

  return {
    q: firstValue(query.q).trim().slice(0, 120),
    types: types.length > 0 ? types : undefined,
    workplace: workplace.length > 0 ? workplace : undefined,
    level: firstValue(query.level).trim().slice(0, 40) || undefined,
    remote: parseBooleanQuery(query.remote),
    minSalary: parseNumberQuery(query.minSalary),
    maxSalary: parseNumberQuery(query.maxSalary),
    postedWithinDays: parseNumberQuery(query.postedWithinDays),
    sort: parseJobSort(firstValue(query.sort) || "recent"),
  };
}

function publicJobApplication(application) {
  return {
    id: String(application.id ?? application._id),
    jobId: application.jobId,
    status: application.status,
    statusLabel: "Applied",
    createdAt:
      application.createdAt instanceof Date
        ? application.createdAt.toISOString()
        : application.createdAt,
    updatedAt:
      application.updatedAt instanceof Date
        ? application.updatedAt.toISOString()
        : application.updatedAt,
  };
}

export function createJobsRouter({ store, config }) {
  const router = Router();
  const { requireAuth, requireRole } = createAuthMiddleware({ store, config });

  router.get("/", async (req, res) => {
    const filters = parseJobListFilters(req.query);
    const { page, limit, skip } = parsePagination(req.query, {
      defaultLimit: 4,
      maxLimit: 50,
    });

    const [result, totalPublished, ...typeCounts] = await Promise.all([
      store.listJobs({
        ...filters,
        status: "published",
        skip,
        limit,
      }),
      store.countJobs({ status: "published" }),
      ...JOB_TYPE_OPTIONS.map((option) =>
        store.countJobs({ status: "published", types: [option.value] })
      ),
    ]);

    const jobs = await serializeJobs(store, result.items);

    res.setHeader("Cache-Control", "no-store");
    res.json({
      jobs,
      pagination: paginationMeta({ page, limit, total: result.total }),
      filters: {
        types: JOB_TYPE_OPTIONS.map((option, index) => ({
          ...option,
          count: typeCounts[index],
        })),
        workplaces: WORKPLACES.map((value) => ({
          value,
          label: WORKPLACE_LABELS[value],
        })),
        total: totalPublished,
      },
    });
  });

  router.get("/saved", requireAuth, requireRole("job_seeker"), async (req, res) => {
    const { page, limit, skip } = parsePagination(req.query, {
      defaultLimit: 20,
      maxLimit: 100,
    });
    const saved = await store.listSavedJobsByUser(String(req.user.id ?? req.user._id));
    const pageItems = saved.slice(skip, skip + limit);
    const jobEntries = await Promise.all(
      pageItems.map(async (item) => [item, await store.findJobPostById(item.jobId)])
    );
    const jobs = jobEntries
      .filter(([, job]) => job)
      .map(([item, job]) => job);
    const serialized = await serializeJobs(store, jobs);
    const byId = new Map(serialized.map((job) => [job.id, job]));

    res.json({
      savedJobs: jobEntries
        .filter(([, job]) => job)
        .map(([item, job]) => ({
          id: String(item.id ?? item._id),
          savedAt:
            item.createdAt instanceof Date
              ? item.createdAt.toISOString()
              : item.createdAt,
          job: byId.get(String(job.id ?? job._id)),
        })),
      pagination: paginationMeta({ page, limit, total: saved.length }),
    });
  });

  router.get("/:id", async (req, res) => {
    const job = await store.findJobPostById(req.params.id);

    if (!job || job.status !== "published") {
      throw new HttpError(404, "JOB_NOT_FOUND", "That job could not be found.");
    }

    const user = await findSessionUser(req, store, config);
    const userId = user ? String(user.id ?? user._id) : null;
    const [application, saved, related, updated] = await Promise.all([
      userId ? store.findApplicationByUserAndJob(userId, job.id) : null,
      userId ? store.findSavedJob(userId, job.id) : null,
      getRelatedJobs(store, job),
      store.incrementJobViews(job.id),
    ]);

    const [serializedJob, similarJobs] = await Promise.all([
      serializeJobDetail(store, updated ?? job, {
        hasApplied: Boolean(application),
        hasSaved: Boolean(saved),
      }),
      serializeJobs(store, related),
    ]);

    res.setHeader("Cache-Control", "no-store");
    res.json({
      job: serializedJob,
      similarJobs,
      hasApplied: Boolean(application),
      hasSaved: Boolean(saved),
    });
  });

  router.post(
    "/:id/apply",
    requireAuth,
    requireRole("job_seeker"),
    async (req, res) => {
      const job = await store.findJobPostById(req.params.id);

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

      const input = parseApplicationInput(req.body);
      const application = await submitApplication(store, {
        user: req.user,
        job,
        input,
      });

      res.status(201).json({ application: publicJobApplication(application) });
    }
  );

  router.post(
    "/:id/save",
    requireAuth,
    requireRole("job_seeker"),
    async (req, res) => {
      const job = await store.findJobPostById(req.params.id);

      if (!job || job.status !== "published") {
        throw new HttpError(404, "JOB_NOT_FOUND", "That job could not be found.");
      }

      const userId = String(req.user.id ?? req.user._id);
      const saved = await store.createSavedJob({ userId, jobId: job.id });

      res.status(saved ? 201 : 200).json({
        saved: true,
        jobId: job.id,
        alreadySaved: !saved,
      });
    }
  );

  router.delete(
    "/:id/save",
    requireAuth,
    requireRole("job_seeker"),
    async (req, res) => {
      const removed = await store.deleteSavedJob(
        String(req.user.id ?? req.user._id),
        req.params.id
      );

      res.json({ saved: false, jobId: req.params.id, removed });
    }
  );

  router.get("/:id/similar", async (req, res) => {
    const job = await store.findJobPostById(req.params.id);

    if (!job || job.status !== "published") {
      throw new HttpError(404, "JOB_NOT_FOUND", "That job could not be found.");
    }

    const limitValue = Number.parseInt(firstValue(req.query.limit), 10);
    const limit = Number.isFinite(limitValue)
      ? Math.min(Math.max(limitValue, 1), 12)
      : 3;
    const related = await getRelatedJobs(store, job, limit);

    res.json({ jobs: await serializeJobs(store, related) });
  });

  router.get("/:id/preview", requireAuth, async (req, res) => {
    const job = await store.findJobPostById(req.params.id);
    const userId = String(req.user.id ?? req.user._id);

    if (
      !job ||
      (req.user.role !== "admin" && job.createdBy !== userId)
    ) {
      throw new HttpError(404, "JOB_NOT_FOUND", "That job could not be found.");
    }

    res.json({ job: await serializeJobDetail(store, job) });
  });

  return router;
}
