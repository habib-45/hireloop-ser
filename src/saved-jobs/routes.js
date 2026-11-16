import { Router } from "express";

import { createAuthMiddleware } from "../auth/current-user.js";
import { HttpError } from "../lib/http-error.js";
import { paginationMeta } from "../lib/serializers.js";
import { parsePagination, parseSavedJobInput } from "../lib/validation.js";
import { serializeJobs } from "../services/jobs.js";

async function serializeSavedRows(store, savedRows) {
  if (savedRows.length === 0) {
    return [];
  }

  const jobEntries = await Promise.all(
    savedRows.map(async (saved) => [saved, await store.findJobPostById(saved.jobId)])
  );
  const jobs = jobEntries.filter(([, job]) => job).map(([, job]) => job);
  const serialized = await serializeJobs(store, jobs);
  const byId = new Map(serialized.map((job) => [job.id, job]));

  return jobEntries
    .filter(([, job]) => job)
    .map(([saved, job]) => ({
      id: String(saved.id ?? saved._id),
      savedAt:
        saved.createdAt instanceof Date
          ? saved.createdAt.toISOString()
          : saved.createdAt,
      jobId: saved.jobId,
      job: byId.get(String(job.id ?? job._id)) ?? null,
    }));
}

export function createSavedJobsRouter({ store, config }) {
  const router = Router();
  const { requireAuth, requireRole } = createAuthMiddleware({ store, config });

  router.use(requireAuth, requireRole("job_seeker"));

  router.get("/", async (req, res) => {
    const userId = String(req.user.id ?? req.user._id);
    const { page, limit, skip } = parsePagination(req.query, {
      defaultLimit: 20,
      maxLimit: 100,
    });
    const saved = await store.listSavedJobsByUser(userId);
    const rows = await serializeSavedRows(
      store,
      saved.slice(skip, skip + limit)
    );

    res.json({
      savedJobs: rows,
      pagination: paginationMeta({ page, limit, total: saved.length }),
    });
  });

  router.get("/ids", async (req, res) => {
    const saved = await store.listSavedJobsByUser(
      String(req.user.id ?? req.user._id)
    );

    res.json({ jobIds: saved.map((item) => item.jobId) });
  });

  router.post("/", async (req, res) => {
    const { jobId } = parseSavedJobInput(req.body);
    const job = await store.findJobPostById(jobId);

    if (!job || job.status !== "published") {
      throw new HttpError(404, "JOB_NOT_FOUND", "That job could not be found.");
    }

    const userId = String(req.user.id ?? req.user._id);
    const saved = await store.createSavedJob({ userId, jobId });
    const [row] = saved ? await serializeSavedRows(store, [saved]) : [];

    res.status(saved ? 201 : 200).json({
      saved: true,
      alreadySaved: !saved,
      savedJob: row ?? null,
    });
  });

  router.delete("/:jobId", async (req, res) => {
    const removed = await store.deleteSavedJob(
      String(req.user.id ?? req.user._id),
      req.params.jobId
    );

    res.json({ saved: false, jobId: req.params.jobId, removed });
  });

  return router;
}
