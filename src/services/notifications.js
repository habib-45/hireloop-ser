import { toIso } from "../lib/dates.js";

export function serializeNotification(notification) {
  return {
    id: String(notification.id ?? notification._id),
    type: notification.type,
    title: notification.title,
    message: notification.message,
    link: notification.link ?? null,
    read: Boolean(notification.read),
    meta: notification.meta ?? null,
    createdAt: toIso(notification.createdAt),
  };
}

export async function createNotification(store, payload) {
  return store.createNotification({
    userId: payload.userId,
    type: payload.type ?? "system",
    title: payload.title,
    message: payload.message,
    link: payload.link ?? null,
    meta: payload.meta ?? null,
    read: Boolean(payload.read),
    createdAt: payload.createdAt ?? new Date(),
  });
}

export async function notifyApplicationSubmitted(store, application, job) {
  if (!job?.createdBy) {
    return null;
  }

  return createNotification(store, {
    userId: job.createdBy,
    type: "application",
    title: "New application received",
    message: `A new application was submitted for ${job.title}.`,
    link: "/recruiter/applications",
    meta: { applicationId: application.id, jobId: job.id },
  });
}

export async function notifyApplicationStatus(store, application, status) {
  const labels = {
    in_review: "In Review",
    shortlisted: "Shortlisted",
    interview: "Interviewing",
    offer: "Offer",
    hired: "Hired",
    rejected: "Rejected",
    withdrawn: "Withdrawn",
  };

  return createNotification(store, {
    userId: application.userId,
    type: "application_status",
    title: `Application moved to ${labels[status] ?? status}`,
    message: `Your application for ${application.jobTitle} at ${application.companyName} is now ${
      labels[status] ?? status
    }.`,
    link: "/dashboard/applications",
    meta: { applicationId: application.id, status },
  });
}

export async function notifyJobModeration(store, job, action, reason) {
  if (!job.createdBy) {
    return null;
  }

  const approved = action === "approve";

  return createNotification(store, {
    userId: job.createdBy,
    type: "job_moderation",
    title: approved ? "Job post approved" : "Job post needs changes",
    message: approved
      ? `${job.title} is now published.`
      : `${job.title} was not approved${reason ? `: ${reason}` : "."}`,
    link: "/recruiter/jobs",
    meta: { jobId: job.id, action, reason: reason ?? "" },
  });
}

export async function notifyBilling(store, userId, { title, message, link, meta }) {
  return createNotification(store, {
    userId,
    type: "billing",
    title,
    message,
    link: link ?? "/dashboard/billing",
    meta,
  });
}
