import { randomUUID } from "node:crypto";

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

function normalize(document) {
  if (!document) {
    return null;
  }

  const { _id, ...rest } = document;
  return { ...rest, id: String(_id) };
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function dateValue(value, fallback = new Date()) {
  if (!value) {
    return fallback;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date;
}

function maybeDate(value) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toId(input) {
  return input.id ?? randomUUID();
}

function insertDocument(input, extra = {}) {
  const { id, ...rest } = input;
  return { _id: toId(input), ...rest, ...extra };
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

function userQuery({ role, status, q } = {}) {
  const query = {};

  if (role) {
    query.role = role;
  }

  if (status) {
    query.status = status;
  }

  const search = String(q ?? "").trim();

  if (search) {
    const regex = { $regex: escapeRegex(search), $options: "i" };
    query.$or = [{ name: regex }, { email: regex }];
  }

  return query;
}

function jobQuery(filters = {}) {
  const query = {};

  if (filters.status) {
    query.status = filters.status;
  }

  if (filters.statuses) {
    query.status = { $in: filters.statuses };
  }

  if (filters.source) {
    query.source = filters.source;
  }

  if (filters.createdBy) {
    query.createdBy = filters.createdBy;
  }

  if (filters.companyId) {
    query.companyId = filters.companyId;
  }

  const search = String(filters.q ?? "").trim();

  if (search) {
    query.searchText = { $regex: escapeRegex(search), $options: "i" };
  }

  if (filters.types?.length) {
    query.type = { $in: filters.types };
  }

  if (filters.workplace?.length) {
    query.workplace = { $in: filters.workplace };
  }

  if (filters.level) {
    query.level = {
      $regex: `^${escapeRegex(String(filters.level))}$`,
      $options: "i",
    };
  }

  if (typeof filters.remote === "boolean") {
    query.remote = filters.remote;
  }

  if (filters.minSalary !== undefined) {
    query.salaryMax = { $gte: filters.minSalary };
  }

  if (filters.maxSalary !== undefined) {
    query.salaryMin = { $lte: filters.maxSalary };
  }

  if (filters.postedWithinDays) {
    query.postedAt = {
      $gte: new Date(
        Date.now() - filters.postedWithinDays * 24 * 60 * 60 * 1000
      ),
    };
  }

  return query;
}

function jobSort(sort) {
  if (sort === "oldest") {
    return { postedAt: 1 };
  }

  if (sort === "salary-desc") {
    return { salaryMax: -1 };
  }

  if (sort === "salary-asc") {
    return { salaryMin: 1 };
  }

  if (sort === "title") {
    return { title: 1 };
  }

  if (sort === "views") {
    return { views: -1 };
  }

  return { postedAt: -1 };
}

function applicationQuery(filters = {}) {
  const query = {};

  if (filters.userId) {
    query.userId = filters.userId;
  }

  if (filters.jobId) {
    query.jobId = filters.jobId;
  }

  if (filters.jobIds) {
    query.jobId = { $in: filters.jobIds };
  }

  if (filters.status) {
    query.status = filters.status;
  }

  if (filters.statuses) {
    query.status = { $in: filters.statuses };
  }

  if (filters.since) {
    query.createdAt = { $gte: dateValue(filters.since, new Date(0)) };
  }

  return query;
}

function paymentQuery({ status, planId, userId, q } = {}) {
  const query = {};

  if (status) {
    query.status = status;
  }

  if (planId) {
    query.planId = planId;
  }

  if (userId) {
    query.userId = userId;
  }

  const search = String(q ?? "").trim();

  if (search) {
    const regex = { $regex: escapeRegex(search), $options: "i" };
    query.$or = [
      { email: regex },
      { name: regex },
      { sessionId: regex },
    ];
  }

  return query;
}

export async function createMongoStore(client, dbName) {
  const db = client.db(dbName);
  const users = db.collection("users");
  const sessions = db.collection("sessions");
  const savedJobs = db.collection("savedJobs");
  const applications = db.collection("applications");
  const jobs = db.collection("jobs");
  const companies = db.collection("companies");
  const subscriptions = db.collection("subscriptions");
  const payments = db.collection("payments");
  const invoices = db.collection("invoices");
  const notifications = db.collection("notifications");
  const passwordResets = db.collection("passwordResets");

  await Promise.all([
    users.createIndex({ email: 1 }, { unique: true }),
    users.createIndex({ role: 1, status: 1 }),
    users.createIndex({ createdAt: -1 }),
    sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    sessions.createIndex({ userId: 1 }),
    savedJobs.createIndex({ userId: 1, jobId: 1 }, { unique: true }),
    savedJobs.createIndex({ userId: 1, createdAt: -1 }),
    applications.createIndex({ userId: 1, jobId: 1 }, { unique: true }),
    applications.createIndex({ userId: 1, createdAt: -1 }),
    applications.createIndex({ jobId: 1, createdAt: -1 }),
    applications.createIndex({ status: 1 }),
    jobs.createIndex({ status: 1, postedAt: -1 }),
    jobs.createIndex({ createdBy: 1, createdAt: -1 }),
    jobs.createIndex({ companyId: 1 }),
    companies.createIndex({ ownerId: 1 }),
    companies.createIndex({ name: 1 }),
    subscriptions.createIndex({ userId: 1, createdAt: -1 }),
    subscriptions.createIndex({ status: 1 }),
    subscriptions.createIndex({ planId: 1 }),
    payments.createIndex({ sessionId: 1 }, { unique: true }),
    payments.createIndex({ userId: 1, createdAt: -1 }),
    payments.createIndex({ status: 1 }),
    payments.createIndex({ createdAt: -1 }),
    invoices.createIndex({ userId: 1, createdAt: -1 }),
    notifications.createIndex({ userId: 1, createdAt: -1 }),
    notifications.createIndex({ userId: 1, read: 1 }),
    passwordResets.createIndex({ tokenHash: 1 }, { unique: true }),
    passwordResets.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    passwordResets.createIndex({ userId: 1 }),
  ]);

  async function findOne(collection, id) {
    if (!id) {
      return null;
    }

    return normalize(await collection.findOne({ _id: id }));
  }

  async function insertUnique(collection, document) {
    try {
      await collection.insertOne(document);
      return normalize(document);
    } catch (error) {
      if (error?.code === 11000) {
        return null;
      }

      throw error;
    }
  }

  async function updateDocument(collection, id, patch) {
    const { id: _ignored, ...rest } = patch;
    const result = await collection.updateOne(
      { _id: id },
      { $set: { ...rest, updatedAt: new Date() } }
    );

    if (result.matchedCount === 0) {
      return null;
    }

    return findOne(collection, id);
  }

  async function listWithPagination(collection, query, {
    sort = { createdAt: -1 },
    skip = 0,
    limit,
    collation,
  } = {}) {
    let cursor = collection.find(query).sort(sort).skip(skip);

    if (limit !== undefined) {
      cursor = cursor.limit(limit);
    }

    if (collation) {
      cursor = cursor.collation(collation);
    }

    const [items, total] = await Promise.all([
      cursor.toArray(),
      collection.countDocuments(query),
    ]);

    return { items: items.map(normalize), total };
  }

  return {
    kind: "mongodb",

    /* ------------------------------------------------------------------ */
    /* Users                                                              */
    /* ------------------------------------------------------------------ */

    async findUserByEmail(email) {
      const normalized = String(email ?? "").trim().toLowerCase();
      return normalize(await users.findOne({ email: normalized }));
    },

    async findUserById(id) {
      return findOne(users, id);
    },

    async createUser(input) {
      const now = new Date();
      const email = String(input.email ?? "").trim().toLowerCase();
      const profile = {
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
      };
      const document = {
        _id: input.id ?? randomUUID(),
        name: input.name,
        email,
        passwordHash: input.passwordHash,
        role: input.role ?? "job_seeker",
        status: input.status ?? "active",
        emailVerified: Boolean(input.emailVerified),
        avatarUrl: input.avatarUrl ?? null,
        companyId: input.companyId ?? null,
        profile,
        profileViews: Number(input.profileViews ?? 0),
        settings: mergeSettings(null, input.settings),
        lastLoginAt: maybeDate(input.lastLoginAt),
        createdAt: dateValue(input.createdAt, now),
        updatedAt: dateValue(input.updatedAt, now),
      };

      return insertUnique(users, document);
    },

    async updateUser(id, patch) {
      const nextPatch = { ...patch };
      delete nextPatch.id;
      delete nextPatch.passwordHash;

      if (nextPatch.email) {
        nextPatch.email = String(nextPatch.email).trim().toLowerCase();
      }

      const user = await findOne(users, id);

      if (!user) {
        return null;
      }

      if (nextPatch.profile) {
        nextPatch.profile = { ...user.profile, ...nextPatch.profile };
      }

      if (nextPatch.settings) {
        nextPatch.settings = mergeSettings(user.settings, nextPatch.settings);
      }

      try {
        return await updateDocument(users, id, nextPatch);
      } catch (error) {
        if (error?.code === 11000) {
          return null;
        }

        throw error;
      }
    },

    async updateUserPassword(id, passwordHash) {
      const result = await users.updateOne(
        { _id: id },
        { $set: { passwordHash, updatedAt: new Date() } }
      );

      if (result.matchedCount === 0) {
        return null;
      }

      return findOne(users, id);
    },

    async listUsers({ role, status, q, skip = 0, limit = 20 } = {}) {
      return listWithPagination(users, userQuery({ role, status, q }), {
        sort: { createdAt: -1 },
        skip,
        limit,
      });
    },

    async countUsers({ role, status, q } = {}) {
      return users.countDocuments(userQuery({ role, status, q }));
    },

    async countUsersCreatedSince(since) {
      return users.countDocuments({
        createdAt: { $gte: dateValue(since, new Date(0)) },
      });
    },

    async deleteUserAndData(id) {
      const user = await users.findOne({ _id: id });

      if (!user) {
        return false;
      }

      const ownedJobs = await jobs
        .find({ createdBy: id }, { projection: { _id: 1 } })
        .toArray();
      const jobIds = ownedJobs.map((job) => job._id);

      await Promise.all([
        users.deleteOne({ _id: id }),
        sessions.deleteMany({ userId: id }),
        savedJobs.deleteMany({
          $or: [
            { userId: id },
            ...(jobIds.length ? [{ jobId: { $in: jobIds } }] : []),
          ],
        }),
        applications.deleteMany({
          $or: [
            { userId: id },
            ...(jobIds.length ? [{ jobId: { $in: jobIds } }] : []),
          ],
        }),
        notifications.deleteMany({ userId: id }),
        subscriptions.deleteMany({ userId: id }),
        passwordResets.deleteMany({ userId: id }),
        jobs.deleteMany({ createdBy: id }),
        companies.updateMany(
          { ownerId: id },
          { $set: { ownerId: null, updatedAt: new Date() } }
        ),
      ]);

      return true;
    },

    /* ------------------------------------------------------------------ */
    /* Sessions                                                           */
    /* ------------------------------------------------------------------ */

    async createSession({ tokenHash, userId, expiresAt }) {
      await sessions.updateOne(
        { _id: tokenHash },
        {
          $set: {
            userId,
            createdAt: new Date(),
            expiresAt: dateValue(expiresAt),
          },
        },
        { upsert: true }
      );
    },

    async findSession(tokenHash) {
      return normalize(
        await sessions.findOne({
          _id: tokenHash,
          expiresAt: { $gt: new Date() },
        })
      );
    },

    async deleteSession(tokenHash) {
      await sessions.deleteOne({ _id: tokenHash });
    },

    async deleteSessionsForUser(userId) {
      await sessions.deleteMany({ userId });
    },

    /* ------------------------------------------------------------------ */
    /* Saved jobs                                                         */
    /* ------------------------------------------------------------------ */

    async createSavedJob({ id, userId, jobId, createdAt }) {
      return insertUnique(savedJobs, {
        _id: id ?? randomUUID(),
        userId,
        jobId,
        createdAt: dateValue(createdAt),
      });
    },

    async findSavedJob(userId, jobId) {
      return normalize(await savedJobs.findOne({ userId, jobId }));
    },

    async listSavedJobsByUser(userId) {
      const documents = await savedJobs
        .find({ userId })
        .sort({ createdAt: -1 })
        .toArray();
      return documents.map(normalize);
    },

    async countSavedJobsByUser(userId) {
      return savedJobs.countDocuments({ userId });
    },

    async deleteSavedJob(userId, jobId) {
      const result = await savedJobs.deleteOne({ userId, jobId });
      return result.deletedCount > 0;
    },

    async deleteSavedJobsForJob(jobId) {
      const result = await savedJobs.deleteMany({ jobId });
      return result.deletedCount;
    },

    /* ------------------------------------------------------------------ */
    /* Applications                                                       */
    /* ------------------------------------------------------------------ */

    async createApplication(input) {
      const now = new Date();
      const document = {
        _id: input.id ?? randomUUID(),
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
            at: dateValue(input.createdAt, now),
            by: input.userId,
          },
        ],
        createdAt: dateValue(input.createdAt, now),
        updatedAt: dateValue(input.updatedAt, now),
      };

      return insertUnique(applications, document);
    },

    async findApplicationById(id) {
      return findOne(applications, id);
    },

    async findApplicationByUserAndJob(userId, jobId) {
      return normalize(await applications.findOne({ userId, jobId }));
    },

    async updateApplication(id, patch) {
      return updateDocument(applications, id, patch);
    },

    async listApplicationsByUser(
      userId,
      { status, statuses, skip = 0, limit = 20 } = {}
    ) {
      return listWithPagination(
        applications,
        applicationQuery({ userId, status, statuses }),
        { sort: { createdAt: -1 }, skip, limit }
      );
    },

    async listApplicationsByJobs(
      jobIds,
      { status, statuses, skip = 0, limit = 20, sort = "recent" } = {}
    ) {
      return listWithPagination(
        applications,
        applicationQuery({ jobIds, status, statuses }),
        {
          sort: { createdAt: sort === "oldest" ? 1 : -1 },
          skip,
          limit,
        }
      );
    },

    async listAllApplications({
      status,
      statuses,
      skip = 0,
      limit = 20,
      sort = "recent",
    } = {}) {
      return listWithPagination(
        applications,
        applicationQuery({ status, statuses }),
        {
          sort: { createdAt: sort === "oldest" ? 1 : -1 },
          skip,
          limit,
        }
      );
    },

    async countApplications({
      userId,
      jobId,
      jobIds,
      status,
      statuses,
      since,
    } = {}) {
      return applications.countDocuments(
        applicationQuery({ userId, jobId, jobIds, status, statuses, since })
      );
    },

    async countApplicationsByUser(userId, { status, statuses } = {}) {
      return applications.countDocuments(
        applicationQuery({ userId, status, statuses })
      );
    },

    async countApplicationsByJob(jobId) {
      return applications.countDocuments({ jobId });
    },

    async listRecentApplications(limit = 10) {
      const documents = await applications
        .find({})
        .sort({ createdAt: -1 })
        .limit(limit)
        .toArray();
      return documents.map(normalize);
    },

    async deleteApplicationsForUser(userId) {
      await applications.deleteMany({ userId });
    },

    async deleteApplicationsForJob(jobId) {
      await applications.deleteMany({ jobId });
    },

    /* ------------------------------------------------------------------ */
    /* Jobs                                                               */
    /* ------------------------------------------------------------------ */

    async createJobPost(input) {
      const now = new Date();

      const document = {
        ...insertDocument(input),
        views: Number(input.views ?? 0),
        postedAt: maybeDate(input.postedAt),
        deadline: maybeDate(input.deadline),
        approvedAt: maybeDate(input.approvedAt),
        createdAt: dateValue(input.createdAt, now),
        updatedAt: dateValue(input.updatedAt, now),
      };

      return insertUnique(jobs, document);
    },

    async findJobPostById(id) {
      return findOne(jobs, id);
    },

    async updateJobPost(id, patch) {
      const nextPatch = { ...patch };
      delete nextPatch.id;

      if ("deadline" in nextPatch) {
        nextPatch.deadline = maybeDate(nextPatch.deadline);
      }

      if ("approvedAt" in nextPatch) {
        nextPatch.approvedAt = maybeDate(nextPatch.approvedAt);
      }

      if ("postedAt" in nextPatch) {
        nextPatch.postedAt = maybeDate(nextPatch.postedAt);
      }

      return updateDocument(jobs, id, nextPatch);
    },

    async deleteJobPost(id) {
      const result = await jobs.deleteOne({ _id: id });
      return result.deletedCount > 0;
    },

    async incrementJobViews(id, amount = 1) {
      const result = await jobs.updateOne(
        { _id: id },
        { $inc: { views: amount } }
      );

      if (result.matchedCount === 0) {
        return null;
      }

      return findOne(jobs, id);
    },

    async listJobs(filters = {}) {
      return listWithPagination(jobs, jobQuery(filters), {
        sort: jobSort(filters.sort),
        skip: filters.skip ?? 0,
        limit: filters.limit,
        collation:
          filters.sort === "title"
            ? { locale: "en", strength: 2 }
            : undefined,
      });
    },

    async countJobs(filters = {}) {
      return jobs.countDocuments(jobQuery(filters));
    },

    /* ------------------------------------------------------------------ */
    /* Companies                                                          */
    /* ------------------------------------------------------------------ */

    async createCompany(input) {
      const now = new Date();
      const document = {
        ...insertDocument(input),
        ownerId: input.ownerId ?? null,
        verified: Boolean(input.verified),
        rating: Number(input.rating ?? 0),
        reviewsCount: Number(input.reviewsCount ?? 0),
        benefits: input.benefits ?? [],
        gallery: input.gallery ?? [],
        socials: input.socials ?? {},
        createdAt: dateValue(input.createdAt, now),
        updatedAt: dateValue(input.updatedAt, now),
      };

      return insertUnique(companies, document);
    },

    async findCompanyById(id) {
      return findOne(companies, id);
    },

    async findCompanyByName(name) {
      const normalized = String(name ?? "").trim();
      return normalize(
        await companies.findOne({
          name: { $regex: `^${escapeRegex(normalized)}$`, $options: "i" },
        })
      );
    },

    async findCompanyByOwner(userId) {
      return normalize(await companies.findOne({ ownerId: userId }));
    },

    async updateCompany(id, patch) {
      const nextPatch = { ...patch };
      delete nextPatch.id;

      if (nextPatch.socials) {
        const company = await findOne(companies, id);
        nextPatch.socials = {
          ...(company?.socials ?? {}),
          ...nextPatch.socials,
        };
      }

      return updateDocument(companies, id, nextPatch);
    },

    async listCompanies({ q, skip = 0, limit = 20 } = {}) {
      const query = {};
      const search = String(q ?? "").trim();

      if (search) {
        const regex = { $regex: escapeRegex(search), $options: "i" };
        query.$or = [
          { name: regex },
          { industry: regex },
          { location: regex },
        ];
      }

      return listWithPagination(companies, query, {
        sort: { name: 1 },
        skip,
        limit,
        collation: { locale: "en", strength: 2 },
      });
    },

    async countCompanies() {
      return companies.countDocuments({});
    },

    /* ------------------------------------------------------------------ */
    /* Subscriptions                                                      */
    /* ------------------------------------------------------------------ */

    async createSubscription(input) {
      const now = new Date();
      const document = {
        ...insertDocument(input),
        currentPeriodStart: maybeDate(input.currentPeriodStart),
        currentPeriodEnd: maybeDate(input.currentPeriodEnd),
        canceledAt: maybeDate(input.canceledAt),
        createdAt: dateValue(input.createdAt, now),
        updatedAt: dateValue(input.updatedAt, now),
      };

      return insertUnique(subscriptions, document);
    },

    async findSubscriptionById(id) {
      return findOne(subscriptions, id);
    },

    async findLatestSubscriptionByUser(userId) {
      return normalize(
        await subscriptions.findOne({ userId }, { sort: { createdAt: -1 } })
      );
    },

    async findActiveSubscriptionByUser(userId) {
      return normalize(
        await subscriptions.findOne(
          { userId, status: { $in: ["active", "past_due"] } },
          { sort: { createdAt: -1 } }
        )
      );
    },

    async updateSubscription(id, patch) {
      const nextPatch = { ...patch };
      delete nextPatch.id;

      for (const field of [
        "currentPeriodStart",
        "currentPeriodEnd",
        "canceledAt",
      ]) {
        if (field in nextPatch) {
          nextPatch[field] = maybeDate(nextPatch[field]);
        }
      }

      return updateDocument(subscriptions, id, nextPatch);
    },

    async listSubscriptions({ status, planId, skip = 0, limit = 20 } = {}) {
      const query = {};

      if (status) query.status = status;
      if (planId) query.planId = planId;

      return listWithPagination(subscriptions, query, {
        sort: { createdAt: -1 },
        skip,
        limit,
      });
    },

    async listSubscriptionsByUser(userId, { skip = 0, limit = 20 } = {}) {
      return listWithPagination(
        subscriptions,
        { userId },
        {
          sort: { createdAt: -1 },
          skip,
          limit,
        }
      );
    },

    async countSubscriptions({ status, planId } = {}) {
      const query = {};

      if (status) query.status = status;
      if (planId) query.planId = planId;

      return subscriptions.countDocuments(query);
    },

    /* ------------------------------------------------------------------ */
    /* Payments                                                           */
    /* ------------------------------------------------------------------ */

    async createPayment(input) {
      const now = new Date();
      const document = {
        ...insertDocument(input),
        amountUsd:
          input.amountUsd ??
          (input.currency === "BDT"
            ? Math.round((Number(input.amount) / 127.6665) * 100) / 100
            : Number(input.amount ?? 0)),
        createdAt: dateValue(input.createdAt, now),
        updatedAt: dateValue(input.updatedAt, now),
      };

      return insertUnique(payments, document);
    },

    async findPaymentBySessionId(sessionId) {
      return normalize(await payments.findOne({ sessionId }));
    },

    async findPaymentById(id) {
      return findOne(payments, id);
    },

    async updatePayment(id, patch) {
      return updateDocument(payments, id, patch);
    },

    async listPayments({ status, planId, userId, q, skip = 0, limit = 20 } = {}) {
      return listWithPagination(
        payments,
        paymentQuery({ status, planId, userId, q }),
        { sort: { createdAt: -1 }, skip, limit }
      );
    },

    async listPaymentsByUser(userId, { skip = 0, limit = 20 } = {}) {
      return this.listPayments({ userId, skip, limit });
    },

    async listRecentPayments(limit = 10) {
      const documents = await payments
        .find({})
        .sort({ createdAt: -1 })
        .limit(limit)
        .toArray();
      return documents.map(normalize);
    },

    async countPayments() {
      return payments.countDocuments({});
    },

    async sumPaymentAmountUsd({ status, since } = {}) {
      const match = {};

      if (status) {
        match.status = status;
      }

      if (since) {
        match.createdAt = { $gte: dateValue(since, new Date(0)) };
      }

      const [result] = await payments
        .aggregate([
          { $match: match },
          {
            $group: {
              _id: null,
              total: { $sum: { $ifNull: ["$amountUsd", 0] } },
            },
          },
        ])
        .toArray();

      return result?.total ?? 0;
    },

    /* ------------------------------------------------------------------ */
    /* Invoices                                                           */
    /* ------------------------------------------------------------------ */

    async createInvoice(input) {
      const now = new Date();
      const document = {
        ...insertDocument(input),
        issuedAt: dateValue(input.issuedAt, now),
        paidAt: maybeDate(input.paidAt),
        createdAt: dateValue(input.createdAt, now),
      };

      return insertUnique(invoices, document);
    },

    async findInvoiceById(id) {
      return findOne(invoices, id);
    },

    async updateInvoice(id, patch) {
      const nextPatch = { ...patch };
      delete nextPatch.id;

      if ("paidAt" in nextPatch) {
        nextPatch.paidAt = maybeDate(nextPatch.paidAt);
      }

      return updateDocument(invoices, id, nextPatch);
    },

    async listInvoicesByUser(userId, { skip = 0, limit = 20 } = {}) {
      return listWithPagination(invoices, { userId }, {
        sort: { createdAt: -1 },
        skip,
        limit,
      });
    },

    async listInvoices({ skip = 0, limit = 20 } = {}) {
      return listWithPagination(invoices, {}, {
        sort: { createdAt: -1 },
        skip,
        limit,
      });
    },

    async countInvoices() {
      return invoices.countDocuments({});
    },

    /* ------------------------------------------------------------------ */
    /* Notifications                                                      */
    /* ------------------------------------------------------------------ */

    async createNotification(input) {
      const document = {
        ...insertDocument(input),
        read: Boolean(input.read),
        createdAt: dateValue(input.createdAt),
      };

      return insertUnique(notifications, document);
    },

    async findNotificationById(id) {
      return findOne(notifications, id);
    },

    async listNotificationsByUser(
      userId,
      { unreadOnly = false, skip = 0, limit = 20 } = {}
    ) {
      const query = { userId };

      if (unreadOnly) {
        query.read = false;
      }

      return listWithPagination(notifications, query, {
        sort: { createdAt: -1 },
        skip,
        limit,
      });
    },

    async countNotificationsByUser(userId, { unreadOnly = false } = {}) {
      const query = { userId };

      if (unreadOnly) {
        query.read = false;
      }

      return notifications.countDocuments(query);
    },

    async updateNotification(id, patch) {
      const result = await notifications.updateOne(
        { _id: id },
        { $set: { ...patch, updatedAt: new Date() } }
      );

      if (result.matchedCount === 0) {
        return null;
      }

      return findOne(notifications, id);
    },

    async markAllNotificationsRead(userId) {
      const result = await notifications.updateMany(
        { userId, read: false },
        { $set: { read: true, updatedAt: new Date() } }
      );

      return result.modifiedCount;
    },

    async deleteNotification(userId, id) {
      const result = await notifications.deleteOne({ _id: id, userId });
      return result.deletedCount > 0;
    },

    /* ------------------------------------------------------------------ */
    /* Password resets                                                    */
    /* ------------------------------------------------------------------ */

    async createPasswordReset({ tokenHash, userId, expiresAt, createdAt }) {
      await passwordResets.deleteMany({ userId });

      return insertUnique(passwordResets, {
        _id: randomUUID(),
        tokenHash,
        userId,
        createdAt: dateValue(createdAt),
        expiresAt: dateValue(expiresAt),
      });
    },

    async findPasswordReset(tokenHash) {
      return normalize(
        await passwordResets.findOne({
          tokenHash,
          expiresAt: { $gt: new Date() },
        })
      );
    },

    async deletePasswordReset(tokenHash) {
      await passwordResets.deleteOne({ tokenHash });
    },

    async deletePasswordResetsForUser(userId) {
      await passwordResets.deleteMany({ userId });
    },

    async close() {
      await client.close();
    },
  };
}
