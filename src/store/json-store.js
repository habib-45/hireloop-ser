import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const EMPTY_STORE = {
  users: [],
  sessions: [],
  savedJobs: [],
  applications: [],
  jobs: [],
  companies: [],
  subscriptions: [],
  payments: [],
  invoices: [],
  notifications: [],
  passwordResets: [],
};

const DEFAULT_SETTINGS = {
  notifications: {
    jobAlerts: true,
    applicationUpdates: true,
    weeklyDigest: true,
    productNews: false,
    email: true,
    push: false,
  },
  privacy: {
    profileVisibility: "public",
    showSalary: true,
    allowRecruiterMessages: true,
  },
  appearance: {
    theme: "dark",
  },
};

function toTime(value) {
  if (!value) {
    return 0;
  }

  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function newestFirst(a, b) {
  return toTime(b.createdAt) - toTime(a.createdAt);
}

function oldestFirst(a, b) {
  return toTime(a.createdAt) - toTime(b.createdAt);
}

function paginate(list, { skip = 0, limit } = {}) {
  if (limit === undefined) {
    return list;
  }

  return list.slice(skip, skip + limit);
}

function textIncludes(value, query) {
  return String(value ?? "")
    .toLowerCase()
    .includes(query);
}

function matchesJob(job, filters = {}) {
  if (filters.status && job.status !== filters.status) {
    return false;
  }

  if (filters.statuses && !filters.statuses.includes(job.status)) {
    return false;
  }

  if (filters.source && job.source !== filters.source) {
    return false;
  }

  if (filters.createdBy && job.createdBy !== filters.createdBy) {
    return false;
  }

  if (filters.companyId && job.companyId !== filters.companyId) {
    return false;
  }

  if (filters.q && !textIncludes(job.searchText, String(filters.q).toLowerCase())) {
    return false;
  }

  if (filters.types?.length && !filters.types.includes(job.type)) {
    return false;
  }

  if (filters.workplace?.length && !filters.workplace.includes(job.workplace)) {
    return false;
  }

  if (filters.level && String(job.level).toLowerCase() !== String(filters.level).toLowerCase()) {
    return false;
  }

  if (filters.remote !== undefined && job.remote !== filters.remote) {
    return false;
  }

  if (filters.minSalary !== undefined && Number(job.salaryMax) < filters.minSalary) {
    return false;
  }

  if (filters.maxSalary !== undefined && Number(job.salaryMin) > filters.maxSalary) {
    return false;
  }

  if (filters.postedWithinDays) {
    const cutoff = Date.now() - filters.postedWithinDays * 24 * 60 * 60 * 1000;

    if (toTime(job.postedAt) < cutoff) {
      return false;
    }
  }

  return true;
}

function sortJobs(list, sort) {
  const jobs = [...list];

  if (sort === "oldest") {
    return jobs.sort((a, b) => toTime(a.postedAt) - toTime(b.postedAt));
  }

  if (sort === "salary-desc") {
    return jobs.sort((a, b) => Number(b.salaryMax) - Number(a.salaryMax));
  }

  if (sort === "salary-asc") {
    return jobs.sort((a, b) => Number(a.salaryMin) - Number(b.salaryMin));
  }

  if (sort === "title") {
    return jobs.sort((a, b) => String(a.title).localeCompare(String(b.title)));
  }

  if (sort === "views") {
    return jobs.sort((a, b) => Number(b.views ?? 0) - Number(a.views ?? 0));
  }

  return jobs.sort((a, b) => toTime(b.postedAt) - toTime(a.postedAt));
}

function matchesApplication(application, filters = {}) {
  if (filters.userId && application.userId !== filters.userId) {
    return false;
  }

  if (filters.jobId && application.jobId !== filters.jobId) {
    return false;
  }

  if (filters.jobIds && !filters.jobIds.includes(application.jobId)) {
    return false;
  }

  if (filters.status && application.status !== filters.status) {
    return false;
  }

  if (filters.statuses && !filters.statuses.includes(application.status)) {
    return false;
  }

  if (filters.since && toTime(application.createdAt) < toTime(filters.since)) {
    return false;
  }

  return true;
}

function mergeSettings(existing, patch) {
  return {
    notifications: {
      ...DEFAULT_SETTINGS.notifications,
      ...(existing?.notifications ?? {}),
      ...(patch?.notifications ?? {}),
    },
    privacy: {
      ...DEFAULT_SETTINGS.privacy,
      ...(existing?.privacy ?? {}),
      ...(patch?.privacy ?? {}),
    },
    appearance: {
      ...DEFAULT_SETTINGS.appearance,
      ...(existing?.appearance ?? {}),
      ...(patch?.appearance ?? {}),
    },
  };
}

export async function createJsonStore(filePath) {
  const absolutePath = path.resolve(filePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });

  let state = Object.fromEntries(
    Object.keys(EMPTY_STORE).map((key) => [key, []])
  );
  let writeChain = Promise.resolve();

  function pruneSessions() {
    const now = Date.now();
    state.sessions = state.sessions.filter(
      (session) => toTime(session.expiresAt) > now
    );
    state.passwordResets = state.passwordResets.filter(
      (reset) => toTime(reset.expiresAt) > now
    );
  }

  function persist() {
    pruneSessions();
    const snapshot = JSON.stringify(state, null, 2);

    writeChain = writeChain.then(() =>
      writeFile(absolutePath, snapshot, "utf8")
    );

    return writeChain;
  }

  try {
    const raw = await readFile(absolutePath, "utf8");
    const parsed = JSON.parse(raw);

    state = Object.fromEntries(
      Object.keys(EMPTY_STORE).map((key) => [
        key,
        Array.isArray(parsed[key]) ? parsed[key] : [],
      ])
    );
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }

  function findUserById(id) {
    return state.users.find((user) => user.id === id) ?? null;
  }

  function findApplicationById(id) {
    return state.applications.find((application) => application.id === id) ?? null;
  }

  function findJobById(id) {
    return state.jobs.find((job) => job.id === id) ?? null;
  }

  function filterApplications(filters = {}) {
    return state.applications.filter((application) =>
      matchesApplication(application, filters)
    );
  }

  await persist();

  return {
    kind: "json",

    /* ------------------------------------------------------------------ */
    /* Users                                                              */
    /* ------------------------------------------------------------------ */

    async findUserByEmail(email) {
      const normalized = String(email ?? "").trim().toLowerCase();
      return (
        state.users.find((user) => user.email === normalized) ?? null
      );
    },

    async findUserById(id) {
      return findUserById(id);
    },

    async createUser(input) {
      const email = String(input.email ?? "").trim().toLowerCase();

      if (state.users.some((user) => user.email === email)) {
        return null;
      }

      const user = {
        id: input.id ?? randomUUID(),
        name: input.name,
        email,
        passwordHash: input.passwordHash,
        role: input.role ?? "job_seeker",
        status: input.status ?? "active",
        emailVerified: Boolean(input.emailVerified),
        avatarUrl: input.avatarUrl ?? null,
        companyId: input.companyId ?? null,
        profile: {
          headline: "",
          bio: "",
          location: "",
          phone: "",
          website: "",
          linkedin: "",
          github: "",
          avatarUrl: input.avatarUrl ?? "",
          skills: [],
          jobTypes: [],
          workplacePreference: "",
          expectedSalary: null,
          availability: "",
          profileVisibility: "public",
          experience: [],
          education: [],
          resume: null,
          completeness: 0,
          ...(input.profile ?? {}),
        },
        profileViews: Number(input.profileViews ?? 0),
        settings: mergeSettings(null, input.settings),
        lastLoginAt: input.lastLoginAt ?? null,
        createdAt: input.createdAt ?? new Date().toISOString(),
        updatedAt: input.updatedAt ?? new Date().toISOString(),
      };

      state.users.push(user);
      await persist();
      return user;
    },

    async updateUser(id, patch) {
      const user = findUserById(id);

      if (!user) {
        return null;
      }

      const nextPatch = { ...patch };
      delete nextPatch.id;
      delete nextPatch.passwordHash;

      if (nextPatch.email) {
        const email = String(nextPatch.email).trim().toLowerCase();

        if (
          state.users.some(
            (candidate) => candidate.email === email && candidate.id !== id
          )
        ) {
          return null;
        }

        nextPatch.email = email;
      }

      if (nextPatch.profile) {
        nextPatch.profile = {
          ...user.profile,
          ...nextPatch.profile,
        };
      }

      if (nextPatch.settings) {
        nextPatch.settings = mergeSettings(user.settings, nextPatch.settings);
      }

      Object.assign(user, nextPatch, { updatedAt: new Date().toISOString() });
      await persist();
      return user;
    },

    async updateUserPassword(id, passwordHash) {
      const user = findUserById(id);

      if (!user) {
        return null;
      }

      user.passwordHash = passwordHash;
      user.updatedAt = new Date().toISOString();
      await persist();
      return user;
    },

    async listUsers({ role, status, q, skip = 0, limit = 20 } = {}) {
      const query = String(q ?? "").trim().toLowerCase();
      const filtered = state.users
        .filter((user) => {
          if (role && user.role !== role) return false;
          if (status && user.status !== status) return false;
          if (
            query &&
            !textIncludes(user.name, query) &&
            !textIncludes(user.email, query)
          ) {
            return false;
          }
          return true;
        })
        .sort(newestFirst);

      return {
        items: paginate(filtered, { skip, limit }),
        total: filtered.length,
      };
    },

    async countUsers({ role, status, q } = {}) {
      const { total } = await this.listUsers({
        role,
        status,
        q,
        limit: undefined,
      });
      return total;
    },

    async countUsersCreatedSince(since) {
      return state.users.filter(
        (user) => toTime(user.createdAt) >= toTime(since)
      ).length;
    },

    async deleteUserAndData(id) {
      const user = findUserById(id);

      if (!user) {
        return false;
      }

      const ownedJobs = state.jobs
        .filter((job) => job.createdBy === id)
        .map((job) => job.id);
      const ownedJobSet = new Set(ownedJobs);

      state.users = state.users.filter((candidate) => candidate.id !== id);
      state.sessions = state.sessions.filter(
        (session) => session.userId !== id
      );
      state.savedJobs = state.savedJobs.filter(
        (saved) => saved.userId !== id
      );
      state.applications = state.applications.filter(
        (application) =>
          application.userId !== id &&
          !ownedJobSet.has(application.jobId)
      );
      state.notifications = state.notifications.filter(
        (notification) => notification.userId !== id
      );
      state.subscriptions = state.subscriptions.filter(
        (subscription) => subscription.userId !== id
      );
      state.passwordResets = state.passwordResets.filter(
        (reset) => reset.userId !== id
      );
      state.jobs = state.jobs.filter((job) => job.createdBy !== id);

      for (const company of state.companies) {
        if (company.ownerId === id) {
          company.ownerId = null;
        }
      }

      await persist();
      return true;
    },

    /* ------------------------------------------------------------------ */
    /* Sessions                                                           */
    /* ------------------------------------------------------------------ */

    async createSession({ tokenHash, userId, expiresAt }) {
      state.sessions = state.sessions.filter(
        (session) => session.tokenHash !== tokenHash
      );
      state.sessions.push({
        tokenHash,
        userId,
        createdAt: new Date().toISOString(),
        expiresAt,
      });

      await persist();
    },

    async findSession(tokenHash) {
      const session = state.sessions.find(
        (candidate) => candidate.tokenHash === tokenHash
      );

      if (!session) {
        return null;
      }

      if (toTime(session.expiresAt) <= Date.now()) {
        state.sessions = state.sessions.filter(
          (candidate) => candidate.tokenHash !== tokenHash
        );
        await persist();
        return null;
      }

      return session;
    },

    async deleteSession(tokenHash) {
      const previousLength = state.sessions.length;
      state.sessions = state.sessions.filter(
        (session) => session.tokenHash !== tokenHash
      );

      if (state.sessions.length !== previousLength) {
        await persist();
      }
    },

    async deleteSessionsForUser(userId) {
      const previousLength = state.sessions.length;
      state.sessions = state.sessions.filter(
        (session) => session.userId !== userId
      );

      if (state.sessions.length !== previousLength) {
        await persist();
      }
    },

    /* ------------------------------------------------------------------ */
    /* Saved jobs                                                         */
    /* ------------------------------------------------------------------ */

    async createSavedJob({ id, userId, jobId, createdAt }) {
      if (
        state.savedJobs.some(
          (saved) => saved.userId === userId && saved.jobId === jobId
        )
      ) {
        return null;
      }

      const savedJob = {
        id: id ?? randomUUID(),
        userId,
        jobId,
        createdAt: createdAt ?? new Date().toISOString(),
      };

      state.savedJobs.push(savedJob);
      await persist();
      return savedJob;
    },

    async findSavedJob(userId, jobId) {
      return (
        state.savedJobs.find(
          (saved) => saved.userId === userId && saved.jobId === jobId
        ) ?? null
      );
    },

    async listSavedJobsByUser(userId) {
      return state.savedJobs
        .filter((saved) => saved.userId === userId)
        .sort(newestFirst);
    },

    async countSavedJobsByUser(userId) {
      return state.savedJobs.filter((saved) => saved.userId === userId).length;
    },

    async deleteSavedJob(userId, jobId) {
      const previousLength = state.savedJobs.length;
      state.savedJobs = state.savedJobs.filter(
        (saved) => !(saved.userId === userId && saved.jobId === jobId)
      );

      if (state.savedJobs.length !== previousLength) {
        await persist();
        return true;
      }

      return false;
    },

    async deleteSavedJobsForJob(jobId) {
      const previousLength = state.savedJobs.length;
      state.savedJobs = state.savedJobs.filter(
        (saved) => saved.jobId !== jobId
      );

      if (state.savedJobs.length !== previousLength) {
        await persist();
      }

      return previousLength - state.savedJobs.length;
    },

    /* ------------------------------------------------------------------ */
    /* Applications                                                       */
    /* ------------------------------------------------------------------ */

    async createApplication(input) {
      if (
        state.applications.some(
          (application) =>
            application.userId === input.userId &&
            application.jobId === input.jobId
        )
      ) {
        return null;
      }

      const application = {
        id: input.id ?? randomUUID(),
        userId: input.userId,
        jobId: input.jobId,
        jobTitle: input.jobTitle,
        companyId: input.companyId ?? null,
        companyName: input.companyName,
        status: input.status ?? "submitted",
        coverLetter: input.coverLetter ?? "",
        resumeUrl: input.resumeUrl ?? "",
        expectedSalary: input.expectedSalary ?? null,
        availability: input.availability ?? "",
        recruiterNotes: input.recruiterNotes ?? "",
        statusHistory: input.statusHistory ?? [
          {
            status: input.status ?? "submitted",
            note: input.statusNote ?? "Application submitted.",
            at: input.createdAt ?? new Date().toISOString(),
            by: input.userId,
          },
        ],
        createdAt: input.createdAt ?? new Date().toISOString(),
        updatedAt: input.updatedAt ?? new Date().toISOString(),
      };

      state.applications.push(application);
      await persist();
      return application;
    },

    async findApplicationById(id) {
      return findApplicationById(id);
    },

    async findApplicationByUserAndJob(userId, jobId) {
      return (
        state.applications.find(
          (application) =>
            application.userId === userId && application.jobId === jobId
        ) ?? null
      );
    },

    async updateApplication(id, patch) {
      const application = findApplicationById(id);

      if (!application) {
        return null;
      }

      const nextPatch = { ...patch };
      delete nextPatch.id;

      Object.assign(application, nextPatch, {
        updatedAt: new Date().toISOString(),
      });
      await persist();
      return application;
    },

    async listApplicationsByUser(
      userId,
      { status, statuses, skip = 0, limit = 20 } = {}
    ) {
      const filtered = filterApplications({ userId, status, statuses }).sort(
        newestFirst
      );

      return {
        items: paginate(filtered, { skip, limit }),
        total: filtered.length,
      };
    },

    async listApplicationsByJobs(
      jobIds,
      { status, statuses, skip = 0, limit = 20, sort = "recent" } = {}
    ) {
      const filtered = filterApplications({ jobIds, status, statuses }).sort(
        sort === "oldest" ? oldestFirst : newestFirst
      );

      return {
        items: paginate(filtered, { skip, limit }),
        total: filtered.length,
      };
    },

    async listAllApplications({
      status,
      statuses,
      skip = 0,
      limit = 20,
      sort = "recent",
    } = {}) {
      const filtered = filterApplications({ status, statuses }).sort(
        sort === "oldest" ? oldestFirst : newestFirst
      );

      return {
        items: paginate(filtered, { skip, limit }),
        total: filtered.length,
      };
    },

    async countApplications({ userId, jobId, jobIds, status, statuses, since } = {}) {
      return filterApplications({
        userId,
        jobId,
        jobIds,
        status,
        statuses,
        since,
      }).length;
    },

    async countApplicationsByUser(userId, { status, statuses } = {}) {
      return filterApplications({ userId, status, statuses }).length;
    },

    async countApplicationsByJob(jobId) {
      return filterApplications({ jobId }).length;
    },

    async listRecentApplications(limit = 10) {
      return [...state.applications].sort(newestFirst).slice(0, limit);
    },

    async deleteApplicationsForUser(userId) {
      state.applications = state.applications.filter(
        (application) => application.userId !== userId
      );
      await persist();
    },

    async deleteApplicationsForJob(jobId) {
      state.applications = state.applications.filter(
        (application) => application.jobId !== jobId
      );
      await persist();
    },

    /* ------------------------------------------------------------------ */
    /* Jobs                                                               */
    /* ------------------------------------------------------------------ */

    async createJobPost(input) {
      const id = input.id ?? randomUUID();

      if (state.jobs.some((job) => job.id === id)) {
        return null;
      }

      const job = {
        ...input,
        id,
        views: Number(input.views ?? 0),
        createdAt: input.createdAt ?? new Date().toISOString(),
        updatedAt: input.updatedAt ?? new Date().toISOString(),
      };

      state.jobs.push(job);
      await persist();
      return job;
    },

    async findJobPostById(id) {
      return findJobById(id);
    },

    async updateJobPost(id, patch) {
      const job = findJobById(id);

      if (!job) {
        return null;
      }

      const nextPatch = { ...patch };
      delete nextPatch.id;

      Object.assign(job, nextPatch, { updatedAt: new Date().toISOString() });
      await persist();
      return job;
    },

    async deleteJobPost(id) {
      const previousLength = state.jobs.length;
      state.jobs = state.jobs.filter((job) => job.id !== id);

      if (state.jobs.length !== previousLength) {
        await persist();
        return true;
      }

      return false;
    },

    async incrementJobViews(id, amount = 1) {
      const job = findJobById(id);

      if (!job) {
        return null;
      }

      job.views = Number(job.views ?? 0) + amount;
      await persist();
      return job;
    },

    async listJobs({
      status,
      statuses,
      source,
      createdBy,
      companyId,
      q,
      types,
      workplace,
      level,
      remote,
      minSalary,
      maxSalary,
      postedWithinDays,
      sort = "recent",
      skip = 0,
      limit,
    } = {}) {
      const filtered = state.jobs
        .filter((job) =>
          matchesJob(job, {
            status,
            statuses,
            source,
            createdBy,
            companyId,
            q,
            types,
            workplace,
            level,
            remote,
            minSalary,
            maxSalary,
            postedWithinDays,
          })
        );

      const sorted = sortJobs(filtered, sort);

      return {
        items: paginate(sorted, { skip, limit }),
        total: sorted.length,
      };
    },

    async countJobs(filters = {}) {
      return state.jobs.filter((job) => matchesJob(job, filters)).length;
    },

    /* ------------------------------------------------------------------ */
    /* Companies                                                          */
    /* ------------------------------------------------------------------ */

    async createCompany(input) {
      const id = input.id ?? randomUUID();

      if (state.companies.some((company) => company.id === id)) {
        return null;
      }

      const company = {
        ...input,
        id,
        ownerId: input.ownerId ?? null,
        verified: Boolean(input.verified),
        rating: Number(input.rating ?? 0),
        reviewsCount: Number(input.reviewsCount ?? 0),
        benefits: input.benefits ?? [],
        gallery: input.gallery ?? [],
        socials: input.socials ?? {},
        createdAt: input.createdAt ?? new Date().toISOString(),
        updatedAt: input.updatedAt ?? new Date().toISOString(),
      };

      state.companies.push(company);
      await persist();
      return company;
    },

    async findCompanyById(id) {
      return state.companies.find((company) => company.id === id) ?? null;
    },

    async findCompanyByName(name) {
      const normalized = String(name ?? "").trim().toLowerCase();
      return (
        state.companies.find(
          (company) => company.name.toLowerCase() === normalized
        ) ?? null
      );
    },

    async findCompanyByOwner(userId) {
      return (
        state.companies.find((company) => company.ownerId === userId) ?? null
      );
    },

    async updateCompany(id, patch) {
      const company = state.companies.find((candidate) => candidate.id === id);

      if (!company) {
        return null;
      }

      const nextPatch = { ...patch };
      delete nextPatch.id;

      if (nextPatch.socials) {
        nextPatch.socials = { ...company.socials, ...nextPatch.socials };
      }

      Object.assign(company, nextPatch, {
        updatedAt: new Date().toISOString(),
      });
      await persist();
      return company;
    },

    async listCompanies({ q, skip = 0, limit = 20 } = {}) {
      const query = String(q ?? "").trim().toLowerCase();
      const filtered = state.companies
        .filter((company) => {
          if (!query) return true;
          return (
            textIncludes(company.name, query) ||
            textIncludes(company.industry, query) ||
            textIncludes(company.location, query)
          );
        })
        .sort((a, b) => String(a.name).localeCompare(String(b.name)));

      return {
        items: paginate(filtered, { skip, limit }),
        total: filtered.length,
      };
    },

    async countCompanies() {
      return state.companies.length;
    },

    /* ------------------------------------------------------------------ */
    /* Subscriptions                                                      */
    /* ------------------------------------------------------------------ */

    async createSubscription(input) {
      const subscription = {
        ...input,
        id: input.id ?? randomUUID(),
        createdAt: input.createdAt ?? new Date().toISOString(),
        updatedAt: input.updatedAt ?? new Date().toISOString(),
      };

      state.subscriptions.push(subscription);
      await persist();
      return subscription;
    },

    async findSubscriptionById(id) {
      return (
        state.subscriptions.find(
          (subscription) => subscription.id === id
        ) ?? null
      );
    },

    async findLatestSubscriptionByUser(userId) {
      return (
        [...state.subscriptions]
          .filter((subscription) => subscription.userId === userId)
          .sort(newestFirst)[0] ?? null
      );
    },

    async findActiveSubscriptionByUser(userId) {
      return (
        [...state.subscriptions]
          .filter(
            (subscription) =>
              subscription.userId === userId &&
              ["active", "past_due"].includes(subscription.status)
          )
          .sort(newestFirst)[0] ?? null
      );
    },

    async updateSubscription(id, patch) {
      const subscription = state.subscriptions.find(
        (candidate) => candidate.id === id
      );

      if (!subscription) {
        return null;
      }

      const nextPatch = { ...patch };
      delete nextPatch.id;

      Object.assign(subscription, nextPatch, {
        updatedAt: new Date().toISOString(),
      });
      await persist();
      return subscription;
    },

    async listSubscriptions({ status, planId, skip = 0, limit = 20 } = {}) {
      const filtered = state.subscriptions
        .filter((subscription) => {
          if (status && subscription.status !== status) return false;
          if (planId && subscription.planId !== planId) return false;
          return true;
        })
        .sort(newestFirst);

      return {
        items: paginate(filtered, { skip, limit }),
        total: filtered.length,
      };
    },

    async listSubscriptionsByUser(userId, { skip = 0, limit = 20 } = {}) {
      const filtered = state.subscriptions
        .filter((subscription) => subscription.userId === userId)
        .sort(newestFirst);

      return {
        items: paginate(filtered, { skip, limit }),
        total: filtered.length,
      };
    },

    async countSubscriptions({ status, planId } = {}) {
      return state.subscriptions.filter((subscription) => {
        if (status && subscription.status !== status) return false;
        if (planId && subscription.planId !== planId) return false;
        return true;
      }).length;
    },

    /* ------------------------------------------------------------------ */
    /* Payments                                                           */
    /* ------------------------------------------------------------------ */

    async createPayment(input) {
      if (
        input.sessionId &&
        state.payments.some(
          (payment) => payment.sessionId === input.sessionId
        )
      ) {
        return null;
      }

      const payment = {
        ...input,
        id: input.id ?? randomUUID(),
        amountUsd:
          input.amountUsd ??
          (input.currency === "BDT"
            ? Math.round((Number(input.amount) / 127.6665) * 100) / 100
            : Number(input.amount ?? 0)),
        createdAt: input.createdAt ?? new Date().toISOString(),
        updatedAt: input.updatedAt ?? new Date().toISOString(),
      };

      state.payments.push(payment);
      await persist();
      return payment;
    },

    async findPaymentBySessionId(sessionId) {
      return (
        state.payments.find((payment) => payment.sessionId === sessionId) ??
        null
      );
    },

    async findPaymentById(id) {
      return state.payments.find((payment) => payment.id === id) ?? null;
    },

    async updatePayment(id, patch) {
      const payment = state.payments.find((candidate) => candidate.id === id);

      if (!payment) {
        return null;
      }

      const nextPatch = { ...patch };
      delete nextPatch.id;

      Object.assign(payment, nextPatch, {
        updatedAt: new Date().toISOString(),
      });
      await persist();
      return payment;
    },

    async listPayments({
      status,
      planId,
      userId,
      q,
      skip = 0,
      limit = 20,
    } = {}) {
      const query = String(q ?? "").trim().toLowerCase();
      const filtered = state.payments
        .filter((payment) => {
          if (status && payment.status !== status) return false;
          if (planId && payment.planId !== planId) return false;
          if (userId && payment.userId !== userId) return false;
          if (
            query &&
            !textIncludes(payment.email, query) &&
            !textIncludes(payment.name, query) &&
            !textIncludes(payment.sessionId, query)
          ) {
            return false;
          }
          return true;
        })
        .sort(newestFirst);

      return {
        items: paginate(filtered, { skip, limit }),
        total: filtered.length,
      };
    },

    async listPaymentsByUser(userId, { skip = 0, limit = 20 } = {}) {
      return this.listPayments({ userId, skip, limit });
    },

    async listRecentPayments(limit = 10) {
      return [...state.payments].sort(newestFirst).slice(0, limit);
    },

    async countPayments() {
      return state.payments.length;
    },

    async sumPaymentAmountUsd({ status, since } = {}) {
      return state.payments
        .filter((payment) => {
          if (status && payment.status !== status) return false;
          if (since && toTime(payment.createdAt) < toTime(since)) return false;
          return true;
        })
        .reduce((total, payment) => total + Number(payment.amountUsd ?? 0), 0);
    },

    /* ------------------------------------------------------------------ */
    /* Invoices                                                           */
    /* ------------------------------------------------------------------ */

    async createInvoice(input) {
      const invoice = {
        ...input,
        id: input.id ?? randomUUID(),
        createdAt: input.createdAt ?? new Date().toISOString(),
      };

      state.invoices.push(invoice);
      await persist();
      return invoice;
    },

    async findInvoiceById(id) {
      return state.invoices.find((invoice) => invoice.id === id) ?? null;
    },

    async updateInvoice(id, patch) {
      const invoice = state.invoices.find((candidate) => candidate.id === id);

      if (!invoice) {
        return null;
      }

      const nextPatch = { ...patch };
      delete nextPatch.id;

      Object.assign(invoice, nextPatch);
      await persist();
      return invoice;
    },

    async listInvoicesByUser(userId, { skip = 0, limit = 20 } = {}) {
      const filtered = state.invoices
        .filter((invoice) => invoice.userId === userId)
        .sort(newestFirst);

      return {
        items: paginate(filtered, { skip, limit }),
        total: filtered.length,
      };
    },

    async listInvoices({ skip = 0, limit = 20 } = {}) {
      const filtered = [...state.invoices].sort(newestFirst);

      return {
        items: paginate(filtered, { skip, limit }),
        total: filtered.length,
      };
    },

    async countInvoices() {
      return state.invoices.length;
    },

    /* ------------------------------------------------------------------ */
    /* Notifications                                                      */
    /* ------------------------------------------------------------------ */

    async createNotification(input) {
      const notification = {
        ...input,
        id: input.id ?? randomUUID(),
        read: Boolean(input.read),
        createdAt: input.createdAt ?? new Date().toISOString(),
      };

      state.notifications.push(notification);
      await persist();
      return notification;
    },

    async findNotificationById(id) {
      return (
        state.notifications.find(
          (notification) => notification.id === id
        ) ?? null
      );
    },

    async listNotificationsByUser(
      userId,
      { unreadOnly = false, skip = 0, limit = 20 } = {}
    ) {
      const filtered = state.notifications
        .filter((notification) => {
          if (notification.userId !== userId) return false;
          if (unreadOnly && notification.read) return false;
          return true;
        })
        .sort(newestFirst);

      return {
        items: paginate(filtered, { skip, limit }),
        total: filtered.length,
      };
    },

    async countNotificationsByUser(userId, { unreadOnly = false } = {}) {
      return state.notifications.filter((notification) => {
        if (notification.userId !== userId) return false;
        if (unreadOnly && notification.read) return false;
        return true;
      }).length;
    },

    async updateNotification(id, patch) {
      const notification = state.notifications.find(
        (candidate) => candidate.id === id
      );

      if (!notification) {
        return null;
      }

      Object.assign(notification, patch);
      await persist();
      return notification;
    },

    async markAllNotificationsRead(userId) {
      let changed = 0;

      for (const notification of state.notifications) {
        if (notification.userId === userId && !notification.read) {
          notification.read = true;
          changed += 1;
        }
      }

      if (changed > 0) {
        await persist();
      }

      return changed;
    },

    async deleteNotification(userId, id) {
      const previousLength = state.notifications.length;
      state.notifications = state.notifications.filter(
        (notification) =>
          !(notification.id === id && notification.userId === userId)
      );

      if (state.notifications.length !== previousLength) {
        await persist();
        return true;
      }

      return false;
    },

    /* ------------------------------------------------------------------ */
    /* Password resets                                                    */
    /* ------------------------------------------------------------------ */

    async createPasswordReset({ tokenHash, userId, expiresAt, createdAt }) {
      state.passwordResets = state.passwordResets.filter(
        (reset) => reset.userId !== userId
      );
      const reset = {
        id: randomUUID(),
        tokenHash,
        userId,
        createdAt: createdAt ?? new Date().toISOString(),
        expiresAt,
      };
      state.passwordResets.push(reset);
      await persist();
      return reset;
    },

    async findPasswordReset(tokenHash) {
      const reset = state.passwordResets.find(
        (candidate) => candidate.tokenHash === tokenHash
      );

      if (!reset) {
        return null;
      }

      if (toTime(reset.expiresAt) <= Date.now()) {
        state.passwordResets = state.passwordResets.filter(
          (candidate) => candidate.tokenHash !== tokenHash
        );
        await persist();
        return null;
      }

      return reset;
    },

    async deletePasswordReset(tokenHash) {
      state.passwordResets = state.passwordResets.filter(
        (reset) => reset.tokenHash !== tokenHash
      );
      await persist();
    },

    async deletePasswordResetsForUser(userId) {
      state.passwordResets = state.passwordResets.filter(
        (reset) => reset.userId !== userId
      );
      await persist();
    },

    async close() {},
  };
}
