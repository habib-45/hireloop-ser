import { Router } from "express";

import { createAuthMiddleware } from "../auth/current-user.js";
import { getSeekerDashboard } from "../services/dashboard.js";
import { serializeJobs } from "../services/jobs.js";

export function createDashboardRouter({ store, config }) {
  const router = Router();
  const { requireAuth, requireRole } = createAuthMiddleware({ store, config });

  router.use(requireAuth, requireRole("job_seeker"));

  router.get("/", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(await getSeekerDashboard(store, req.user));
  });

  router.get("/stats", async (req, res) => {
    const dashboard = await getSeekerDashboard(store, req.user);
    res.json({ stats: dashboard.stats });
  });

  router.get("/recommended-jobs", async (req, res) => {
    const dashboard = await getSeekerDashboard(store, req.user);
    res.json({ jobs: dashboard.recommendedJobs });
  });

  router.get("/recommended", async (req, res) => {
    const dashboard = await getSeekerDashboard(store, req.user);
    res.json({ jobs: dashboard.recommendedJobs });
  });

  router.get("/saved-jobs", async (req, res) => {
    const userId = String(req.user.id ?? req.user._id);
    const saved = await store.listSavedJobsByUser(userId);
    const jobs = [];

    for (const item of saved.slice(0, 4)) {
      const job = await store.findJobPostById(item.jobId);

      if (job) {
        jobs.push(job);
      }
    }

    res.json({ jobs: await serializeJobs(store, jobs) });
  });

  return router;
}
