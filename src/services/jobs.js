import {
  JOB_STATUS_LABELS,
  TYPE_LABELS,
  WORKPLACE_LABELS,
} from "../lib/constants.js";
import { toIso } from "../lib/dates.js";

export function formatSalary(job) {
  if (job.salaryLabel) {
    return job.salaryLabel;
  }

  const currency = job.salaryCurrency ?? "USD";
  const symbol = currency === "BDT" ? "৳" : "$";
  const period = job.salaryPeriod ?? "year";
  const suffix = period === "year" ? "k" : "";

  return `${symbol}${job.salaryMin}${suffix} – ${symbol}${job.salaryMax}${suffix}`;
}

export function toCompanySummary(company) {
  return {
    id: company?.id ?? null,
    name: company?.name ?? "Hireloop",
    logo: company?.logo ?? null,
    verified: Boolean(company?.verified),
  };
}

export function toCompanyDetail(company) {
  if (!company) {
    return null;
  }

  return {
    id: company.id,
    name: company.name,
    logo: company.logo ?? null,
    coverImage: company.coverImage ?? null,
    verified: Boolean(company.verified),
    size: company.size ?? "",
    industry: company.industry ?? "",
    location: company.location ?? "",
    website: company.website ?? "",
    about: company.about ?? "",
    founded: company.founded ?? null,
    email: company.email ?? "",
    phone: company.phone ?? "",
    rating: Number(company.rating ?? 0),
    reviewsCount: Number(company.reviewsCount ?? 0),
    socials: company.socials ?? {},
    benefits: company.benefits ?? [],
    gallery: company.gallery ?? [],
  };
}

export function toJobSummary(job, company, extras = {}) {
  return {
    id: String(job.id ?? job._id),
    title: job.title,
    company: toCompanySummary(company),
    companyId: job.companyId,
    location: job.location,
    workplace: job.workplace,
    workplaceLabel:
      WORKPLACE_LABELS[job.workplace] ?? job.workplace ?? "Remote",
    remote: Boolean(job.remote ?? job.workplace === "remote"),
    type: job.type,
    typeLabel: TYPE_LABELS[job.type] ?? job.type,
    level: job.level,
    experience: job.experience,
    salaryMin: Number(job.salaryMin ?? 0),
    salaryMax: Number(job.salaryMax ?? 0),
    salaryCurrency: job.salaryCurrency ?? "USD",
    salaryPeriod: job.salaryPeriod ?? "year",
    salaryLabel: formatSalary(job),
    postedAt: toIso(job.postedAt),
    easyApply: Boolean(job.easyApply),
    hot: Boolean(job.hot),
    cardTags: job.cardTags ?? job.tags ?? [],
    summary: job.summary || `${String(job.description ?? "").slice(0, 160)}...`,
    positions: Number(job.positions ?? 1),
    deadline: toIso(job.deadline),
    views: Number(job.views ?? 0),
    ...extras,
  };
}

export function toJobDetail(job, company, extras = {}) {
  const requirements =
    job.requirements && typeof job.requirements === "object"
      ? {
          skills: job.requirements.skills ?? job.skills ?? [],
          items: job.requirements.items ?? [],
        }
      : { skills: job.skills ?? [], items: [] };

  return {
    ...toJobSummary(job, company, extras),
    company: toCompanyDetail(company),
    description: job.description ?? "",
    responsibilities: job.responsibilities ?? [],
    requirements,
    benefits: job.benefits ?? [],
    companyId: job.companyId,
    source: job.source ?? "recruiter",
    createdAt: toIso(job.createdAt),
    updatedAt: toIso(job.updatedAt),
  };
}

export function jobStatusLabel(status) {
  return JOB_STATUS_LABELS[status] ?? status;
}

export function buildSearchText(job, company) {
  const requirements = job.requirements?.skills ?? job.skills ?? [];

  return [
    job.title,
    company?.name,
    company?.industry,
    job.location,
    job.workplace,
    job.type,
    job.level,
    job.experience,
    job.summary,
    job.description,
    taskList(job.cardTags ?? job.tags),
    taskList(requirements),
    taskList(job.responsibilities),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function taskList(value) {
  if (!value) {
    return "";
  }

  return Array.isArray(value) ? value.join(" ") : String(value);
}

export async function companyMapForJobs(store, jobList) {
  const ids = [...new Set(jobList.map((job) => job.companyId).filter(Boolean))];
  const companies = await Promise.all(
    ids.map(async (id) => [id, await store.findCompanyById(id)])
  );

  return new Map(companies);
}

export async function serializeJobs(store, jobList, extrasById = {}) {
  if (jobList.length === 0) {
    return [];
  }

  const companies = await companyMapForJobs(store, jobList);

  return jobList.map((job) =>
    toJobSummary(job, companies.get(job.companyId), extrasById[job.id] ?? {})
  );
}

export async function serializeJobDetail(store, job, extras = {}) {
  const company = await store.findCompanyById(job.companyId);
  return toJobDetail(job, company, extras);
}

export async function listPublicJobs(store, filters = {}) {
  return store.listJobs({
    ...filters,
    status: "published",
  });
}

export async function getRelatedJobs(store, job, limit = 3) {
  const { items } = await store.listJobs({
    status: "published",
    limit: 30,
    sort: "recent",
  });

  return items
    .filter((candidate) => candidate.id !== job.id)
    .sort((a, b) => {
      const score = (candidate) =>
        (candidate.companyId === job.companyId ? 3 : 0) +
        (candidate.title === job.title ? 2 : 0) +
        (candidate.type === job.type ? 1 : 0) +
        (candidate.level === job.level ? 1 : 0);

      return score(b) - score(a);
    })
    .slice(0, limit);
}

export function missingJobFields(job) {
  const missing = [];

  if (!job.title) missing.push("title");
  if (!job.companyId) missing.push("companyId");
  if (!job.location) missing.push("location");
  if (!job.type) missing.push("type");
  if (!job.workplace) missing.push("workplace");
  if (!job.description || job.description.length < 30) {
    missing.push("description");
  }
  if (job.salaryMax < job.salaryMin) missing.push("salaryMax");

  return missing;
}
