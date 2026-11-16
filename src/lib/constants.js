export const ROLES = {
  JOB_SEEKER: "job_seeker",
  RECRUITER: "recruiter",
  ADMIN: "admin",
};

export const SIGN_UP_ROLES = [ROLES.JOB_SEEKER, ROLES.RECRUITER];
export const ALL_ROLES = Object.values(ROLES);

export const USER_STATUSES = {
  ACTIVE: "active",
  SUSPENDED: "suspended",
  DEACTIVATED: "deactivated",
};

export const ALL_USER_STATUSES = Object.values(USER_STATUSES);

export const JOB_TYPE_OPTIONS = [
  { value: "full-time", label: "Full-time" },
  { value: "contract", label: "Contract" },
  { value: "freelance", label: "Freelance" },
];

export const JOB_TYPES = JOB_TYPE_OPTIONS.map((option) => option.value);

export const TYPE_LABELS = Object.fromEntries(
  JOB_TYPE_OPTIONS.map((option) => [option.value, option.label])
);

export const WORKPLACE_LABELS = {
  remote: "Remote",
  hybrid: "Hybrid",
  "on-site": "On-site",
};

export const WORKPLACES = Object.keys(WORKPLACE_LABELS);

export const SALARY_PERIODS = ["year", "month", "hour"];

export const JOB_STATUSES = {
  DRAFT: "draft",
  PENDING_REVIEW: "pending_review",
  PUBLISHED: "published",
  PAUSED: "paused",
  CLOSED: "closed",
  REJECTED: "rejected",
};

export const ALL_JOB_STATUSES = Object.values(JOB_STATUSES);

export const JOB_STATUS_LABELS = {
  draft: "Draft",
  pending_review: "Pending review",
  published: "Published",
  paused: "Paused",
  closed: "Closed",
  rejected: "Rejected",
};

export const APPLICATION_STATUS_OPTIONS = [
  { value: "submitted", label: "Applied" },
  { value: "in_review", label: "In Review" },
  { value: "shortlisted", label: "Shortlisted" },
  { value: "interview", label: "Interviewing" },
  { value: "offer", label: "Offer" },
  { value: "hired", label: "Hired" },
  { value: "rejected", label: "Rejected" },
  { value: "withdrawn", label: "Withdrawn" },
];

export const APPLICATION_STATUSES = APPLICATION_STATUS_OPTIONS.map(
  (option) => option.value
);

export const APPLICATION_STATUS_LABELS = Object.fromEntries(
  APPLICATION_STATUS_OPTIONS.map((option) => [option.value, option.label])
);

export const ACTIVE_APPLICATION_STATUSES = [
  "submitted",
  "in_review",
  "shortlisted",
  "interview",
  "offer",
];

export const RECRUITER_APPLICATION_STATUSES = [
  "in_review",
  "shortlisted",
  "interview",
  "offer",
  "hired",
  "rejected",
];

export const PROFILE_VISIBILITY = ["public", "recruiters", "private"];

export const NOTIFICATION_TYPES = {
  APPLICATION: "application",
  APPLICATION_STATUS: "application_status",
  JOB: "job",
  JOB_MODERATION: "job_moderation",
  BILLING: "billing",
  SYSTEM: "system",
};

export const BILLING_INTERVALS = ["monthly", "yearly"];

export const PAYMENT_STATUSES = ["succeeded", "refunded", "failed", "pending"];

export const SUBSCRIPTION_STATUSES = [
  "active",
  "canceled",
  "past_due",
  "expired",
];

export const PLAN_INTERVALS = {
  monthly: { label: "Monthly", months: 1 },
  yearly: { label: "Yearly", months: 12 },
};
