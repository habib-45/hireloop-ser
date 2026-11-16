import {
  ACTIVE_APPLICATION_STATUSES,
  APPLICATION_STATUS_OPTIONS,
} from "../lib/constants.js";
import {
  daysAgo,
  lastNDays,
  monthKey,
  monthLabel,
  startOfDay,
} from "../lib/dates.js";
import {
  applicationStatusLabel,
  serializeAdminApplications,
  serializeRecruiterApplications,
  serializeSeekerApplications,
} from "./applications.js";
import {
  computeMonthlyRecurringRevenue,
  serializeInvoice,
  serializePayment,
  serializeSubscription,
} from "./billing.js";
import { jobStatusLabel, toCompanyDetail, toJobSummary } from "./jobs.js";
import { serializeNotification } from "./notifications.js";
import {
  computeProfileCompleteness,
  normalizeProfile,
  serializeProfile,
} from "./profile.js";

function statusBreakdown(applications) {
  return APPLICATION_STATUS_OPTIONS.map((option) => ({
    status: option.value,
    label: option.label,
    count: applications.filter(
      (application) => application.status === option.value
    ).length,
  }));
}

function monthStart() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function statusStamp(status) {
  return { status, statusLabel: applicationStatusLabel(status) };
}

export async function getSeekerDashboard(store, user) {
  const userId = String(user.id ?? user._id);
  const [
    applicationsResult,
    savedJobs,
    unreadNotifications,
    notificationsResult,
    latestSubscription,
  ] = await Promise.all([
    store.listApplicationsByUser(userId, { limit: 200 }),
    store.listSavedJobsByUser(userId),
    store.countNotificationsByUser(userId, { unreadOnly: true }),
    store.listNotificationsByUser(userId, { limit: 5 }),
    store.findLatestSubscriptionByUser(userId),
  ]);

  const applications = applicationsResult.items;
  const savedJobIds = new Set(savedJobs.map((saved) => saved.jobId));

  const recentApplications = await serializeSeekerApplications(
    store,
    applications.slice(0, 5)
  );

  const appliedJobIds = new Set(applications.map((application) => application.jobId));
  const { items: publishedJobs } = await store.listJobs({
    status: "published",
    limit: 40,
    sort: "recent",
  });

  const profile = normalizeProfile(user.profile);
  const skills = new Set(
    profile.skills.map((skill) => skill.toLowerCase())
  );

  const recommended = publishedJobs
    .filter((job) => !appliedJobIds.has(job.id))
    .map((job) => {
      const jobSkills = (job.requirements?.skills ?? job.skills ?? []).map(
        (skill) => String(skill).toLowerCase()
      );
      let score = 0;

      for (const skill of jobSkills) {
        if (skills.has(skill)) {
          score += 4;
        }
      }

      if (profile.jobTypes.includes(job.type)) {
        score += 2;
      }

      if (
        profile.workplacePreference &&
        job.workplace === profile.workplacePreference
      ) {
        score += 2;
      }

      if (job.companyId) {
        score += 0.1;
      }

      return { job, score };
    })
    .sort((a, b) => b.score - a.score || 0)
    .slice(0, 4);

  const companyEntries = await Promise.all(
    [...new Set(recommended.map(({ job }) => job.companyId).filter(Boolean))].map(
      async (id) => [id, await store.findCompanyById(id)]
    )
  );
  const companyMap = new Map(companyEntries);

  const recommendedJobs = recommended.map(({ job }) =>
    toJobSummary(job, companyMap.get(job.companyId), {
      hasSaved: savedJobIds.has(job.id),
    })
  );

  const savedPreviewJobs = [];
  const savedPreviewCompanyIds = [];

  for (const saved of savedJobs.slice(0, 3)) {
    const job = await store.findJobPostById(saved.jobId);

    if (job) {
      savedPreviewJobs.push({ job, savedAt: saved.createdAt });
      savedPreviewCompanyIds.push(job.companyId);
    }
  }

  const savedCompanies = await Promise.all(
    [...new Set(savedPreviewCompanyIds.filter(Boolean))].map(async (id) => [
      id,
      await store.findCompanyById(id),
    ])
  );
  const savedCompanyMap = new Map(savedCompanies);

  const interviews = applications.filter(
    (application) => application.status === "interview"
  ).length;
  const offers = applications.filter((application) =>
    ["offer", "hired"].includes(application.status)
  ).length;

  return {
    greeting: {
      firstName: String(user.name ?? "").split(/\s+/)[0] || "there",
      name: user.name,
    },
    stats: {
      totalApplications: applications.length,
      activeApplications: applications.filter((application) =>
        ACTIVE_APPLICATION_STATUSES.includes(application.status)
      ).length,
      interviews,
      offers,
      savedJobs: savedJobs.length,
      profileStrength: computeProfileCompleteness(user),
      profileViews: Number(user.profileViews ?? 0),
      unreadNotifications,
    },
    profile: serializeProfile(user),
    applicationStatusBreakdown: statusBreakdown(applications),
    recentApplications,
    recommendedJobs,
    savedJobsPreview: savedPreviewJobs.map(({ job, savedAt }) => ({
      savedAt: savedAt instanceof Date ? savedAt.toISOString() : savedAt,
      job: toJobSummary(job, savedCompanyMap.get(job.companyId), {
        hasSaved: true,
      }),
    })),
    recentActivity: notificationsResult.items.map(serializeNotification),
    subscription: serializeSubscription(latestSubscription),
  };
}

export async function getRecruiterDashboard(store, user) {
  const userId = String(user.id ?? user._id);
  const company =
    (user.companyId && (await store.findCompanyById(user.companyId))) ||
    (await store.findCompanyByOwner(userId));

  const [{ items: jobs }, unreadNotifications] = await Promise.all([
    store.listJobs({ createdBy: userId, limit: undefined, sort: "recent" }),
    store.countNotificationsByUser(userId, { unreadOnly: true }),
  ]);

  const jobIds = jobs.map((job) => job.id);
  const { items: applications } = jobIds.length
    ? await store.listApplicationsByJobs(jobIds, {
        limit: undefined,
        sort: "recent",
      })
    : { items: [] };

  const applicationCounts = new Map();

  for (const application of applications) {
    applicationCounts.set(
      application.jobId,
      (applicationCounts.get(application.jobId) ?? 0) + 1
    );
  }

  const jobViews = jobs.reduce((total, job) => total + Number(job.views ?? 0), 0);
  const activeJobs = jobs.filter((job) => job.status === "published").length;
  const weekStart = daysAgo(7);
  const newApplications = applications.filter(
    (application) => new Date(application.createdAt) >= weekStart
  ).length;
  const interviews = applications.filter(
    (application) => application.status === "interview"
  ).length;
  const hires = applications.filter(
    (application) => application.status === "hired"
  ).length;

  const recentApplications = await serializeRecruiterApplications(
    store,
    applications.slice(0, 5)
  );

  const topJobs = [...jobs]
    .sort(
      (a, b) =>
        (applicationCounts.get(b.id) ?? 0) -
          (applicationCounts.get(a.id) ?? 0) ||
        Number(b.views ?? 0) - Number(a.views ?? 0)
    )
    .slice(0, 5);

  const companyEntries = await Promise.all(
    [...new Set(topJobs.map((job) => job.companyId).filter(Boolean))].map(
      async (id) => [id, await store.findCompanyById(id)]
    )
  );
  const companyMap = new Map(companyEntries);

  const days = lastNDays(7);

  return {
    greeting: {
      firstName: String(user.name ?? "").split(/\s+/)[0] || "there",
      name: user.name,
    },
    company: toCompanyDetail(company),
    stats: {
      activeJobs,
      totalJobs: jobs.length,
      totalApplications: applications.length,
      newApplications,
      interviews,
      hires,
      jobViews,
      conversionRate:
        jobViews > 0
          ? Math.round((applications.length / jobViews) * 1000) / 10
          : 0,
      unreadNotifications,
    },
    applicationStatusBreakdown: statusBreakdown(applications),
    applicationsByDay: days.map((day) => ({
      date: day.key,
      label: day.label,
      count: applications.filter(
        (application) =>
          startOfDay(new Date(application.createdAt)).getTime() ===
          day.date.getTime()
      ).length,
    })),
    recentApplications,
    topJobs: topJobs.map((job) =>
      toJobSummary(job, companyMap.get(job.companyId), {
        status: job.status,
        statusLabel: jobStatusLabel(job.status),
        applicationsCount: applicationCounts.get(job.id) ?? 0,
      })
    ),
  };
}

export async function getAdminDashboard(store) {
  const [
    totalUsers,
    jobSeekers,
    recruiters,
    suspendedUsers,
    activeJobs,
    pendingJobs,
    totalJobs,
    totalApplications,
    applicationsThisWeek,
    revenueUsd,
    revenueThisMonth,
    paymentsCount,
    activeSubscriptions,
    recentUsersResult,
    recentApplications,
    recentPayments,
    { items: allApplications },
    { items: activeSubscriptionItems },
    { items: allJobs },
    { items: allPayments },
    { items: allUsers },
  ] = await Promise.all([
    store.countUsers({}),
    store.countUsers({ role: "job_seeker" }),
    store.countUsers({ role: "recruiter" }),
    store.countUsers({ status: "suspended" }),
    store.countJobs({ status: "published" }),
    store.countJobs({ status: "pending_review" }),
    store.countJobs({}),
    store.countApplications({}),
    store.countApplications({ since: daysAgo(7) }),
    store.sumPaymentAmountUsd({ status: "succeeded" }),
    store.sumPaymentAmountUsd({ status: "succeeded", since: monthStart() }),
    store.countPayments(),
    store.countSubscriptions({ status: "active" }),
    store.listUsers({ limit: 5 }),
    store.listRecentApplications(5),
    store.listRecentPayments(5),
    store.listAllApplications({ limit: 5000 }),
    store.listSubscriptions({ status: "active", limit: 1000 }),
    store.listJobs({ limit: 1000 }),
    store.listPayments({ limit: 5000 }),
    store.listUsers({ limit: 5000 }),
  ]);

  const adminApplications = await serializeAdminApplications(
    store,
    recentApplications
  );

  const months = [];

  for (let index = 5; index >= 0; index -= 1) {
    const date = new Date();
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() - index);
    months.push({
      key: monthKey(date),
      label: monthLabel(date),
    });
  }

  const revenueTrend = months.map((month) => ({
    month: month.key,
    label: month.label,
    revenue: allPayments
      .filter(
        (payment) =>
          payment.status === "succeeded" &&
          monthKey(payment.createdAt) === month.key
      )
      .reduce((total, payment) => total + Number(payment.amountUsd ?? 0), 0),
  }));

  const userGrowth = months.map((month) => ({
    month: month.key,
    label: month.label,
    users: allUsers.filter(
      (user) => monthKey(user.createdAt) === month.key
    ).length,
  }));

  const jobsByStatus = {};

  for (const job of allJobs) {
    jobsByStatus[job.status] = (jobsByStatus[job.status] ?? 0) + 1;
  }

  const applicationsByStatus = statusBreakdown(allApplications);

  const companyCounts = new Map();

  for (const job of allJobs) {
    if (!job.companyId) continue;
    const entry = companyCounts.get(job.companyId) ?? {
      jobs: 0,
      applications: 0,
    };
    entry.jobs += 1;
    companyCounts.set(job.companyId, entry);
  }

  for (const application of allApplications) {
    if (!application.companyId) continue;
    const entry = companyCounts.get(application.companyId) ?? {
      jobs: 0,
      applications: 0,
    };
    entry.applications += 1;
    companyCounts.set(application.companyId, entry);
  }

  const topCompanies = await Promise.all(
    [...companyCounts.entries()]
      .sort((a, b) => b[1].jobs - a[1].jobs)
      .slice(0, 5)
      .map(async ([companyId, counts]) => {
        const company = await store.findCompanyById(companyId);
        return {
          id: companyId,
          name: company?.name ?? "Unknown company",
          logo: company?.logo ?? null,
          jobs: counts.jobs,
          applications: counts.applications,
        };
      })
  );

  return {
    stats: {
      totalUsers,
      jobSeekers,
      recruiters,
      suspendedUsers,
      activeJobs,
      pendingJobs,
      totalJobs,
      totalApplications,
      applicationsThisWeek,
      revenueUsd: Math.round(revenueUsd * 100) / 100,
      revenueThisMonth: Math.round(revenueThisMonth * 100) / 100,
      paymentsCount,
      activeSubscriptions,
      mrrUsd: Math.round(computeMonthlyRecurringRevenue(activeSubscriptionItems) * 100) / 100,
    },
    jobsByStatus,
    applicationsByStatus,
    revenueTrend,
    userGrowth,
    topCompanies,
    recentUsers: recentUsersResult.items.map((user) => ({
      id: String(user.id ?? user._id),
      name: user.name,
      email: user.email,
      role: user.role,
      status: user.status,
      createdAt: user.createdAt,
      headline: user.profile?.headline ?? "",
    })),
    recentApplications: adminApplications,
    recentPayments: recentPayments.map(serializePayment),
    pendingJobsPreview: allJobs
      .filter((job) => job.status === "pending_review")
      .slice(0, 5)
      .map((job) => ({
        ...statusStamp(job.status),
        id: job.id,
        title: job.title,
        companyName: job.companyName,
        postedAt: job.postedAt,
      })),
  };
}

export async function getAdminAnalytics(store, rangeDays = 30) {
  const cutoff = daysAgo(rangeDays);
  const [{ items: applications }, { items: jobs }, { items: users }, paymentsResult] =
    await Promise.all([
      store.listAllApplications({ limit: 5000 }),
      store.listJobs({ limit: 5000 }),
      store.listUsers({ limit: 5000 }),
      store.listPayments({ limit: 5000 }),
    ]);

  const recentApplications = applications.filter(
    (application) => new Date(application.createdAt) >= cutoff
  );
  const recentPayments = paymentsResult.items.filter(
    (payment) => new Date(payment.createdAt) >= cutoff
  );
  const days = lastNDays(14);

  return {
    rangeDays,
    usersByRole: {
      jobSeekers: users.filter((user) => user.role === "job_seeker").length,
      recruiters: users.filter((user) => user.role === "recruiter").length,
      admins: users.filter((user) => user.role === "admin").length,
    },
    jobsByStatus: jobs.reduce((accumulator, job) => {
      accumulator[job.status] = (accumulator[job.status] ?? 0) + 1;
      return accumulator;
    }, {}),
    applicationsByStatus: statusBreakdown(recentApplications),
    applicationsByDay: days.map((day) => ({
      date: day.key,
      label: day.label,
      count: recentApplications.filter(
        (application) =>
          startOfDay(new Date(application.createdAt)).getTime() ===
          day.date.getTime()
      ).length,
    })),
    revenueInRangeUsd: Math.round(
      recentPayments
        .filter((payment) => payment.status === "succeeded")
        .reduce((total, payment) => total + Number(payment.amountUsd ?? 0), 0) *
        100
    ) / 100,
    topPlans: Object.entries(
      recentPayments
        .filter((payment) => payment.status === "succeeded")
        .reduce((accumulator, payment) => {
          accumulator[payment.planId] =
            (accumulator[payment.planId] ?? 0) + 1;
          return accumulator;
        }, {})
    )
      .map(([planId, count]) => ({ planId, count }))
      .sort((a, b) => b.count - a.count),
  };
}

export async function getRecruiterAnalytics(store, user, rangeDays = 30) {
  const userId = String(user.id ?? user._id);
  const cutoff = daysAgo(rangeDays);
  const { items: jobs } = await store.listJobs({
    createdBy: userId,
    limit: undefined,
  });
  const jobIds = jobs.map((job) => job.id);
  const { items: applications } = jobIds.length
    ? await store.listApplicationsByJobs(jobIds, {
        limit: undefined,
        sort: "recent",
      })
    : { items: [] };

  const recentApplications = applications.filter(
    (application) => new Date(application.createdAt) >= cutoff
  );
  const applicationCounts = new Map();

  for (const application of applications) {
    applicationCounts.set(
      application.jobId,
      (applicationCounts.get(application.jobId) ?? 0) + 1
    );
  }

  const days = lastNDays(14);
  const totalViews = jobs.reduce((total, job) => total + Number(job.views ?? 0), 0);

  return {
    rangeDays,
    totals: {
      jobs: jobs.length,
      activeJobs: jobs.filter((job) => job.status === "published").length,
      views: totalViews,
      applications: applications.length,
      interviews: applications.filter(
        (application) => application.status === "interview"
      ).length,
      hires: applications.filter(
        (application) => application.status === "hired"
      ).length,
      conversionRate:
        totalViews > 0
          ? Math.round((applications.length / totalViews) * 1000) / 10
          : 0,
    },
    applicationsByStatus: statusBreakdown(recentApplications),
    applicationsByDay: days.map((day) => ({
      date: day.key,
      label: day.label,
      count: recentApplications.filter(
        (application) =>
          startOfDay(new Date(application.createdAt)).getTime() ===
          day.date.getTime()
      ).length,
    })),
    topJobs: [...jobs]
      .sort(
        (a, b) =>
          (applicationCounts.get(b.id) ?? 0) -
            (applicationCounts.get(a.id) ?? 0) ||
          Number(b.views ?? 0) - Number(a.views ?? 0)
      )
      .slice(0, 5)
      .map((job) => ({
        id: job.id,
        title: job.title,
        status: job.status,
        statusLabel: jobStatusLabel(job.status),
        views: Number(job.views ?? 0),
        applications: applicationCounts.get(job.id) ?? 0,
      })),
  };
}
