import { Router } from "express";

import { createAuthMiddleware } from "../auth/current-user.js";
import {
  APPLICATION_STATUS_OPTIONS,
  JOB_STATUSES,
  TYPE_LABELS,
  WORKPLACE_LABELS,
} from "../lib/constants.js";
import { HttpError } from "../lib/http-error.js";
import { paginationMeta } from "../lib/serializers.js";
import {
  firstValue,
  parseApplicationStatusFilter,
  parseApplicationStatusInput,
  parseCompanyInput,
  parseJobPostInput,
  parseJobSort,
  parseJobStatusFilter,
  parsePagination,
} from "../lib/validation.js";
import {
  canRecruiterUpdate,
  serializeRecruiterApplication,
  serializeRecruiterApplications,
} from "../services/applications.js";
import { findOwnedCompany, userIdOf } from "../services/companies.js";
import {
  getRecruiterAnalytics,
  getRecruiterDashboard,
} from "../services/dashboard.js";
import {
  buildSearchText,
  formatSalary,
  jobStatusLabel,
  serializeJobDetail,
  serializeJobs,
  toCompanyDetail,
} from "../services/jobs.js";
import {
  createNotification,
  notifyApplicationStatus,
} from "../services/notifications.js";
import { serializeCandidate, serializeProfile } from "../services/profile.js";

const RECRUITER_JOB_TRANSITIONS = {
  submit: ["draft", "rejected", "closed"],
  pause: ["published"],
  resume: ["paused"],
  close: ["published", "paused", "draft", "pending_review"],
};

const RECRUITER_ACTION_LABELS = {
  submit: "submitted for review",
  pause: "paused",
  resume: "resumed",
  close: "closed",
};

function companyIdOf(company) {
  return String(company.id ?? company._id);
}

function jobIdOf(job) {
  return String(job.id ?? job._id);
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

function countApplicationsByJob(applications) {
  const counts = new Map();

  for (const application of applications) {
    counts.set(application.jobId, (counts.get(application.jobId) ?? 0) + 1);
  }

  return counts;
}

function buildJobDocument({ input, company, userId, existing = null }) {
  const type = input.type ?? existing?.type ?? "full-time";
  const workplace = input.workplace ?? existing?.workplace ?? "remote";
  const salaryMin = input.salaryMin ?? existing?.salaryMin ?? 0;
  const salaryMax = input.salaryMax ?? existing?.salaryMax ?? 0;
  const salaryCurrency = existing?.salaryCurrency ?? "USD";
  const salaryPeriod = input.salaryPeriod ?? existing?.salaryPeriod ?? "year";
  const description = input.description ?? existing?.description ?? "";
  const skills =
    input.skills ?? existing?.requirements?.skills ?? existing?.skills ?? [];
  const requirementItems =
    input.requirements ?? existing?.requirements?.items ?? [];
  const tags = input.tags ?? existing?.tags ?? [];
  const cardTags =
    tags.length > 0
      ? tags
      : existing?.cardTags ?? [
          TYPE_LABELS[type] ?? type,
          WORKPLACE_LABELS[workplace] ?? workplace,
        ];

  const document = {
    title: input.title ?? existing?.title ?? "",
    type,
    workplace,
    location: input.location ?? existing?.location ?? "",
    level: input.level ?? existing?.level ?? "",
    experience: input.experience ?? existing?.experience ?? "",
    salaryMin,
    salaryMax,
    salaryCurrency,
    salaryPeriod,
    salaryLabel: formatSalary({
      salaryMin,
      salaryMax,
      salaryCurrency,
      salaryPeriod,
    }),
    summary:
      input.summary ??
      existing?.summary ??
      String(description).slice(0, 160),
    description,
    responsibilities:
      input.responsibilities ?? existing?.responsibilities ?? [],
    requirements: {
      skills,
      items: requirementItems,
    },
    benefits: input.benefits ?? existing?.benefits ?? [],
    tags,
    cardTags,
    positions: input.positions ?? existing?.positions ?? 1,
    easyApply: input.easyApply ?? existing?.easyApply ?? false,
    hot: input.hot ?? existing?.hot ?? false,
    deadline:
      input.deadline !== undefined ? input.deadline : existing?.deadline ?? null,
    status: existing?.status ?? input.status ?? "pending_review",
    source: "recruiter",
    createdBy: userId,
    companyId: companyIdOf(company),
    companyName: company.name,
    remote: workplace === "remote",
    postedAt: existing?.postedAt ?? null,
    approvedAt: existing?.approvedAt ?? null,
    approvedBy: existing?.approvedBy ?? null,
    rejectionReason: existing?.rejectionReason ?? "",
  };

  document.searchText = buildSearchText(document, company);
  return document;
}

async function notifyAdminsAboutJob(store, job) {
  const { items: admins } = await store.listUsers({
    role: "admin",
    limit: undefined,
  });

  await Promise.all(
    admins.map((admin) =>
      createNotification(store, {
        userId: userIdOf(admin),
        type: "job_moderation",
        title: "Job post pending review",
        message: `${job.title} at ${job.companyName} is waiting for moderation.`,
        link: "/admin/jobs",
        meta: { jobId: jobIdOf(job) },
      })
    )
  );
}

async function serializeRecruiterJob(store, job, applicationsCount = 0) {
  const company = await store.findCompanyById(job.companyId);

  return serializeJobDetail(store, job, {
    status: job.status,
    statusLabel: jobStatusLabel(job.status),
    applicationsCount,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    rejectionReason: job.rejectionReason ?? "",
    company: toCompanyDetail(company),
  });
}

async function getOwnedJob(store, user, jobId) {
  const job = await store.findJobPostById(jobId);

  if (!job || job.createdBy !== userIdOf(user)) {
    throw new HttpError(404, "JOB_NOT_FOUND", "That job post could not be found.");
  }

  return job;
}

async function getOwnedApplication(store, user, applicationId) {
  const application = await store.findApplicationById(applicationId);

  if (!application) {
    throw new HttpError(
      404,
      "APPLICATION_NOT_FOUND",
      "That application could not be found."
    );
  }

  const job = await store.findJobPostById(application.jobId);

  if (!job || job.createdBy !== userIdOf(user)) {
    throw new HttpError(
      404,
      "APPLICATION_NOT_FOUND",
      "That application could not be found."
    );
  }

  return { application, job };
}

function parseRangeDays(value) {
  const parsed = Number.parseInt(firstValue(value), 10);

  if (!Number.isFinite(parsed)) {
    return 30;
  }

  return Math.min(Math.max(parsed, 7), 365);
}

export function createRecruiterRouter({ store, config }) {
  const router = Router();
  const { requireAuth, requireRole } = createAuthMiddleware({ store, config });

  router.use(requireAuth, requireRole("recruiter"));

  /* ---------------------------------------------------------------------- */
  /* Dashboard & analytics                                                  */
  /* ---------------------------------------------------------------------- */

  router.get("/dashboard", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(await getRecruiterDashboard(store, req.user));
  });

  router.get("/analytics", async (req, res) => {
    const days = parseRangeDays(req.query.days ?? req.query.range);
    res.json(await getRecruiterAnalytics(store, req.user, days));
  });

  /* ---------------------------------------------------------------------- */
  /* Company profile                                                        */
  /* ---------------------------------------------------------------------- */

  router.get("/company", async (req, res) => {
    const company = await findOwnedCompany(store, req.user);

    res.json({
      company: company ? toCompanyDetail(company) : null,
      complete: Boolean(company),
    });
  });

  router.post("/company", async (req, res) => {
    const existing = await findOwnedCompany(store, req.user);

    if (existing) {
      throw new HttpError(
        409,
        "COMPANY_EXISTS",
        "You already have a company profile."
      );
    }

    const input = parseCompanyInput(req.body);
    const duplicate = await store.findCompanyByName(input.name);

    if (duplicate) {
      throw new HttpError(
        409,
        "COMPANY_NAME_TAKEN",
        "A company with this name already exists.",
        { field: "name" }
      );
    }

    const company = await store.createCompany({
      ...input,
      ownerId: userIdOf(req.user),
      verified: false,
      rating: 0,
      reviewsCount: 0,
    });

    await store.updateUser(userIdOf(req.user), { companyId: companyIdOf(company) });

    res.status(201).json({ company: toCompanyDetail(company) });
  });

  router.patch("/company", async (req, res) => {
    const company = await findOwnedCompany(store, req.user);

    if (!company) {
      throw new HttpError(
        404,
        "COMPANY_NOT_FOUND",
        "Create your company profile first."
      );
    }

    const input = parseCompanyInput(req.body, { partial: true });

    if (input.name && input.name !== company.name) {
      const duplicate = await store.findCompanyByName(input.name);

      if (duplicate && companyIdOf(duplicate) !== companyIdOf(company)) {
        throw new HttpError(
          409,
          "COMPANY_NAME_TAKEN",
          "A company with this name already exists.",
          { field: "name" }
        );
      }
    }

    const updated = await store.updateCompany(companyIdOf(company), input);
    res.json({ company: toCompanyDetail(updated) });
  });

  /* ---------------------------------------------------------------------- */
  /* Job posts                                                              */
  /* ---------------------------------------------------------------------- */

  router.get("/jobs", async (req, res) => {
    const userId = userIdOf(req.user);
    const { page, limit, skip } = parsePagination(req.query, {
      defaultLimit: 20,
      maxLimit: 100,
    });
    const filters = {
      createdBy: userId,
      q: firstValue(req.query.q).trim().slice(0, 120) || undefined,
      status: parseJobStatusFilter(req.query.status),
      sort: parseJobSort(firstValue(req.query.sort) || "recent"),
    };
    const [result, ...statusCounts] = await Promise.all([
      store.listJobs({ ...filters, skip, limit }),
      store.countJobs({ createdBy: userId }),
      ...Object.values(JOB_STATUSES).map((status) =>
        store.countJobs({ createdBy: userId, status })
      ),
    ]);
    const applications = await applicationsForJobs(
      store,
      result.items.map(jobIdOf)
    );
    const applicationCounts = countApplicationsByJob(applications);
    const jobs = await Promise.all(
      result.items.map((job) =>
        serializeRecruiterJob(
          store,
          job,
          applicationCounts.get(jobIdOf(job)) ?? 0
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

  router.post("/jobs", async (req, res) => {
    const company = await findOwnedCompany(store, req.user);

    if (!company) {
      throw new HttpError(
        409,
        "COMPANY_REQUIRED",
        "Create your company profile before posting a job."
      );
    }

    const input = parseJobPostInput(req.body);
    const document = buildJobDocument({
      input,
      company,
      userId: userIdOf(req.user),
    });
    const job = await store.createJobPost(document);

    if (job.status === "pending_review") {
      await notifyAdminsAboutJob(store, job);
    }

    res.status(201).json({
      job: await serializeRecruiterJob(store, job, 0),
    });
  });

  router.get("/jobs/:id", async (req, res) => {
    const job = await getOwnedJob(store, req.user, req.params.id);
    const applications = await applicationsForJobs(store, [jobIdOf(job)]);

    res.json({
      job: await serializeRecruiterJob(store, job, applications.length),
      applicationsCount: applications.length,
    });
  });

  router.patch("/jobs/:id", async (req, res) => {
    const job = await getOwnedJob(store, req.user, req.params.id);
    const body = { ...(req.body ?? {}) };
    delete body.status;
    const input = parseJobPostInput(body, { partial: true });
    const company =
      (job.companyId && (await store.findCompanyById(job.companyId))) ??
      (await findOwnedCompany(store, req.user));

    if (!company) {
      throw new HttpError(
        409,
        "COMPANY_REQUIRED",
        "Create your company profile before editing a job."
      );
    }

    const document = buildJobDocument({
      input,
      company,
      userId: userIdOf(req.user),
      existing: job,
    });

    if (job.status === "rejected") {
      document.status = "pending_review";
      document.rejectionReason = "";
    }

    const updated = await store.updateJobPost(jobIdOf(job), document);

    if (job.status === "rejected" && updated.status === "pending_review") {
      await notifyAdminsAboutJob(store, updated);
    }

    const applications = await applicationsForJobs(store, [jobIdOf(updated)]);

    res.json({
      job: await serializeRecruiterJob(store, updated, applications.length),
    });
  });

  router.delete("/jobs/:id", async (req, res) => {
    const job = await getOwnedJob(store, req.user, req.params.id);

    await Promise.all([
      store.deleteApplicationsForJob(jobIdOf(job)),
      store.deleteSavedJobsForJob(jobIdOf(job)),
      store.deleteJobPost(jobIdOf(job)),
    ]);

    res.json({ ok: true, deletedJobId: jobIdOf(job) });
  });

  router.post("/jobs/:id/duplicate", async (req, res) => {
    const job = await getOwnedJob(store, req.user, req.params.id);
    const {
      id: _id,
      createdAt: _createdAt,
      updatedAt: _updatedAt,
      postedAt: _postedAt,
      approvedAt: _approvedAt,
      approvedBy: _approvedBy,
      ...rest
    } = job;
    const copy = await store.createJobPost({
      ...rest,
      title: `${job.title} (Copy)`,
      status: "draft",
      views: 0,
      source: "recruiter",
      createdBy: userIdOf(req.user),
      postedAt: null,
      approvedAt: null,
      approvedBy: null,
      rejectionReason: "",
    });

    res.status(201).json({
      job: await serializeRecruiterJob(store, copy, 0),
    });
  });

  for (const [action, allowedStatuses] of Object.entries(
    RECRUITER_JOB_TRANSITIONS
  )) {
    router.post(`/jobs/:id/${action}`, async (req, res) => {
      const job = await getOwnedJob(store, req.user, req.params.id);

      if (!allowedStatuses.includes(job.status)) {
        throw new HttpError(
          409,
          "INVALID_JOB_TRANSITION",
          `This job cannot be ${RECRUITER_ACTION_LABELS[action]} while it is ${jobStatusLabel(
            job.status
          ).toLowerCase()}.`
        );
      }

      const nextStatus =
        action === "submit"
          ? "pending_review"
          : action === "pause"
            ? "paused"
            : action === "resume"
              ? "published"
              : "closed";
      const patch = {
        status: nextStatus,
        ...(action === "submit"
          ? { submittedAt: new Date(), rejectionReason: "" }
          : {}),
        ...(action === "close" ? { closedAt: new Date() } : {}),
      };
      const updated = await store.updateJobPost(jobIdOf(job), patch);

      if (action === "submit") {
        await notifyAdminsAboutJob(store, updated);
      }

      const applications = await applicationsForJobs(store, [jobIdOf(updated)]);

      res.json({
        job: await serializeRecruiterJob(store, updated, applications.length),
      });
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Applications                                                           */
  /* ---------------------------------------------------------------------- */

  router.get("/applications", async (req, res) => {
    const userId = userIdOf(req.user);
    const { items: jobs } = await store.listJobs({
      createdBy: userId,
      limit: undefined,
    });
    const jobIds = jobs.map(jobIdOf);
    const jobIdFilter = firstValue(req.query.jobId).trim();

    if (jobIdFilter && !jobIds.includes(jobIdFilter)) {
      throw new HttpError(
        404,
        "JOB_NOT_FOUND",
        "That job post could not be found."
      );
    }

    const status = parseApplicationStatusFilter(req.query.status);
    const all = await applicationsForJobs(
      store,
      jobIdFilter ? [jobIdFilter] : jobIds
    );
    const statusFiltered = status
      ? all.filter((application) => application.status === status)
      : all;
    const allSerialized = await serializeRecruiterApplications(
      store,
      statusFiltered
    );
    const query = firstValue(req.query.q).trim().toLowerCase();
    const searched = query
      ? allSerialized.filter((application) =>
          [
            application.candidate?.name,
            application.candidate?.email,
            application.candidate?.headline,
            application.job?.title,
          ].some((value) => String(value ?? "").toLowerCase().includes(query))
        )
      : allSerialized;
    const { page, limit, skip } = parsePagination(req.query, {
      defaultLimit: 20,
      maxLimit: 100,
    });
    const total = searched.length;
    const applications = searched.slice(skip, skip + limit);

    res.json({
      applications,
      pagination: paginationMeta({ page, limit, total }),
      counts: Object.fromEntries([
        ["all", all.length],
        ...APPLICATION_STATUS_OPTIONS.map((option) => [
          option.value,
          all.filter((application) => application.status === option.value)
            .length,
        ]),
      ]),
      statusBreakdown: APPLICATION_STATUS_OPTIONS.map((option) => ({
        ...option,
        count: all.filter(
          (application) => application.status === option.value
        ).length,
      })),
      jobs: jobs.map((job) => ({
        id: jobIdOf(job),
        title: job.title,
        status: job.status,
      })),
    });
  });

  router.get("/applications/:id", async (req, res) => {
    const { application } = await getOwnedApplication(
      store,
      req.user,
      req.params.id
    );

    res.json({
      application: await serializeRecruiterApplication(store, application),
    });
  });

  router.patch("/applications/:id", async (req, res) => {
    const { application } = await getOwnedApplication(
      store,
      req.user,
      req.params.id
    );
    const { status, note } = parseApplicationStatusInput(req.body);

    if (!canRecruiterUpdate(application.status, status)) {
      throw new HttpError(
        409,
        "INVALID_APPLICATION_TRANSITION",
        "This application can no longer be updated."
      );
    }

    const rawNotes =
      typeof req.body?.recruiterNotes === "string"
        ? req.body.recruiterNotes.trim()
        : undefined;

    if (rawNotes !== undefined && rawNotes.length > 2000) {
      throw new HttpError(
        400,
        "VALIDATION_ERROR",
        "Recruiter notes must be 2000 characters or fewer.",
        { field: "recruiterNotes" }
      );
    }

    const updated = await store.updateApplication(application.id, {
      status,
      ...(rawNotes !== undefined ? { recruiterNotes: rawNotes } : {}),
      statusHistory: [
        ...(application.statusHistory ?? []),
        {
          status,
          note: note ?? "",
          at: new Date(),
          by: userIdOf(req.user),
        },
      ],
    });

    await notifyApplicationStatus(store, updated, status);

    res.json({
      application: await serializeRecruiterApplication(store, updated),
    });
  });

  router.get("/candidates/:id", async (req, res) => {
    const userId = userIdOf(req.user);
    const { items: jobs } = await store.listJobs({
      createdBy: userId,
      limit: undefined,
    });
    const applications = await applicationsForJobs(
      store,
      jobs.map(jobIdOf)
    );
    const applied = applications.some(
      (application) => application.userId === req.params.id
    );

    if (!applied) {
      throw new HttpError(
        404,
        "CANDIDATE_NOT_FOUND",
        "That candidate could not be found."
      );
    }

    const candidate = await store.findUserById(req.params.id);

    if (!candidate) {
      throw new HttpError(
        404,
        "CANDIDATE_NOT_FOUND",
        "That candidate could not be found."
      );
    }

    res.json({
      candidate: serializeCandidate(candidate),
      profile: serializeProfile(candidate),
    });
  });

  return router;
}
