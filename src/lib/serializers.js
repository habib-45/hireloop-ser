import { toIso } from "./dates.js";

export function entityId(entity) {
  if (!entity) {
    return null;
  }

  return String(entity.id ?? entity._id);
}

export function paginationMeta({ page, limit, total }) {
  const totalPages = Math.max(1, Math.ceil(total / limit));

  return {
    page,
    limit,
    total,
    totalPages,
    hasPrev: page > 1,
    hasNext: page < totalPages,
  };
}

export function publicUser(user, options = {}) {
  if (!user) {
    return null;
  }

  const {
    includeEmail = true,
    unreadNotifications,
    includePrivate = true,
  } = options;

  const profile = user.profile ?? {};

  const result = {
    id: entityId(user),
    name: user.name,
    role: user.role ?? "job_seeker",
    status: user.status ?? "active",
    avatarUrl: user.avatarUrl ?? profile.avatarUrl ?? null,
    headline: profile.headline ?? user.headline ?? null,
    location: profile.location ?? user.location ?? null,
    companyId: user.companyId ?? null,
    createdAt: toIso(user.createdAt),
    updatedAt: toIso(user.updatedAt),
  };

  if (includeEmail) {
    result.email = user.email;
  }

  if (includePrivate) {
    result.emailVerified = Boolean(user.emailVerified);
    result.phone = profile.phone ?? null;
    result.profileVisibility = profile.profileVisibility ?? "public";
    result.profileComplete = Number(profile.completeness ?? 0);
    result.lastLoginAt = toIso(user.lastLoginAt);
  }

  if (typeof unreadNotifications === "number") {
    result.unreadNotifications = unreadNotifications;
  }

  return result;
}
