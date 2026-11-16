import {
  APPLICATION_STATUS_LABELS,
  TYPE_LABELS,
  WORKPLACE_LABELS,
} from "../lib/constants.js";
import { HttpError } from "../lib/http-error.js";
import { toIso } from "../lib/dates.js";
import { toCompanySummary } from "./jobs.js";
import { notifyApplicationSubmitted } from "./notifications.js";
import { serializeCandidate } from "./profile.js";

const STATUS_TONES = {
  submitted: "info",
  in_review: "warning",
  shortlisted: "accent",
  interview: "accent",
  offer: "success",
  hired: "success",
  rejected: "danger",
  withdrawn: "neutral",
};

export function applicationStatusLabel(status) {
  return APPLICATION_STATUS_LABELS[status] ?? status;
}

export function applicationStatusTone(status) {
  return STATUS_TONES[status] ?? "neutral";
}

export function canWithdraw(status) {
  return !["withdrawn", "hired", "rejected"].includes(status);
}

export function canRecruiterUpdate(currentStatus, nextStatus) {
  if (["withdrawn", "hired", "rejected"].includes(currentStatus)) {
    return false;
  }

  if (nextStatus === "withdrawn") {
    return false;
  }

  return true;
}

export function buildStatusEntry(status, note, by) {
  return {
    status,
    note: note ?? "",
    at: new Date(),
    by: by ?? null,
  };
}

export async function submitApplication(store, { user, job, input = {} }) {
  const userId = String(user.id ?? user._id);
  const existing = await store.findApplicationByUserAndJob(userId, job.id);

  if (existing) {
    throw new HttpError(
      409,
      "ALREADY_APPLIED",
      "You have already applied to this job."
    );
  }

  const company = await store.findCompanyById(job.companyId);
  const profile = user.profile ?? {};
  const application = await store.createApplication({
    userId,
    jobId: job.id,
    jobTitle: job.title,
    companyId: job.companyId ?? null,
    companyName: company?.name ?? job.companyName ?? "Hireloop",
    status: "submitted",
    coverLetter: input.coverLetter ?? "",
    resumeUrl: input.resumeUrl || profile.resume?.url || "",
    expectedSalary: input.expectedSalary ?? profile.expectedSalary ?? null,
    availability: input.availability || profile.availability || "",
    statusHistory: [
      {
        status: "submitted",
        note: "Application submitted.",
        at: new Date(),
        by: userId,
      },
    ],
  });

  if (!application) {
    throw new HttpError(
      409,
      "ALREADY_APPLIED",
      "You have already applied to this job."
    );
  }

  await notifyApplicationSubmitted(store, application, job);
  return application;
}

function fallbackJob(application) {
  return {
    id: application.jobId,
    title: application.jobTitle,
    companyId: application.companyId,
    location: "",
    workplace: null,
    type: null,
    salaryLabel: "",
  };
}

function jobPreview(job, company) {
  if (!job) {
    return null;
  }

  return {
    id: job.id,
    title: job.title,
    company: toCompanySummary(company),
    location: job.location,
    workplace: job.workplace,
    workplaceLabel: job.workplace
      ? WORKPLACE_LABELS[job.workplace] ?? job.workplace
      : "",
    type: job.type,
    typeLabel: job.type ? TYPE_LABELS[job.type] ?? job.type : "",
    level: job.level,
    salaryLabel: job.salaryLabel ?? "",
    postedAt: toIso(job.postedAt),
    status: job.status,
  };
}

function baseApplication(application, { includeNotes = false } = {}) {
  return {
    id: String(application.id ?? application._id),
    status: application.status,
    statusLabel: applicationStatusLabel(application.status),
    statusTone: applicationStatusTone(application.status),
    appliedAt: toIso(application.createdAt),
    createdAt: toIso(application.createdAt),
    updatedAt: toIso(application.updatedAt),
    coverLetter: application.coverLetter ?? "",
    resumeUrl: application.resumeUrl ?? "",
    expectedSalary: application.expectedSalary ?? null,
    availability: application.availability ?? "",
    statusHistory: (application.statusHistory ?? []).map((entry) => ({
      status: entry.status,
      statusLabel: applicationStatusLabel(entry.status),
      note: entry.note ?? "",
      at: toIso(entry.at),
      by: entry.by ?? null,
    })),
    ...(includeNotes
      ? { recruiterNotes: application.recruiterNotes ?? "" }
      : {}),
  };
}

export async function serializeSeekerApplications(store, applications) {
  if (applications.length === 0) {
    return [];
  }

  const jobIds = [...new Set(applications.map((application) => application.jobId))];
  const jobEntries = await Promise.all(
    jobIds.map(async (id) => [id, await store.findJobPostById(id)])
  );
  const jobMap = new Map(jobEntries);
  const companyIds = [
    ...new Set(
      [...jobMap.values()]
        .filter(Boolean)
        .map((job) => job.companyId)
        .filter(Boolean)
    ),
  ];
  const companyEntries = await Promise.all(
    companyIds.map(async (id) => [id, await store.findCompanyById(id)])
  );
  const companyMap = new Map(companyEntries);

  return applications.map((application) => {
    const job = jobMap.get(application.jobId) ?? fallbackJob(application);
    const company =
      companyMap.get(job.companyId) ??
      companyMap.get(application.companyId) ??
      null;

    return {
      ...baseApplication(application),
      job: jobPreview(job, company),
      company: toCompanySummary(company),
    };
  });
}

export async function serializeSeekerApplication(store, application) {
  const [result] = await serializeSeekerApplications(store, [application]);
  return result;
}

export async function serializeRecruiterApplications(store, applications) {
  if (applications.length === 0) {
    return [];
  }

  const jobIds = [...new Set(applications.map((application) => application.jobId))];
  const userIds = [...new Set(applications.map((application) => application.userId))];

  const [jobEntries, userEntries] = await Promise.all([
    Promise.all(
      jobIds.map(async (id) => [id, await store.findJobPostById(id)])
    ),
    Promise.all(userIds.map(async (id) => [id, await store.findUserById(id)])),
  ]);

  const jobMap = new Map(jobEntries);
  const userMap = new Map(userEntries);

  return applications.map((application) => {
    const job = jobMap.get(application.jobId);
    const candidate = userMap.get(application.userId);

    return {
      ...baseApplication(application, { includeNotes: true }),
      job: {
        id: application.jobId,
        title: job?.title ?? application.jobTitle,
        location: job?.location ?? "",
        status: job?.status ?? null,
      },
      candidate: candidate
        ? serializeCandidate(candidate)
        : {
            id: application.userId,
            name: "Deleted candidate",
            email: "",
            avatarUrl: null,
            headline: "",
            location: "",
            phone: "",
            skills: [],
            availability: application.availability ?? "",
            expectedSalary: application.expectedSalary ?? null,
            experienceYears: 0,
            profileComplete: 0,
            resume: null,
            links: {},
          },
    };
  });
}

export async function serializeRecruiterApplication(store, application) {
  const [result] = await serializeRecruiterApplications(store, [application]);
  return result;
}

export async function serializeAdminApplications(store, applications) {
  const serialized = await serializeRecruiterApplications(store, applications);
  return serialized;
}
