import { toIso } from "../lib/dates.js";

export const DEFAULT_SETTINGS = {
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

export function normalizeSettings(settings) {
  return {
    notifications: {
      ...DEFAULT_SETTINGS.notifications,
      ...(settings?.notifications ?? {}),
    },
    privacy: {
      ...DEFAULT_SETTINGS.privacy,
      ...(settings?.privacy ?? {}),
    },
    appearance: {
      ...DEFAULT_SETTINGS.appearance,
      ...(settings?.appearance ?? {}),
    },
  };
}

export function normalizeProfile(profile = {}) {
  return {
    headline: profile.headline ?? "",
    bio: profile.bio ?? "",
    location: profile.location ?? "",
    phone: profile.phone ?? "",
    website: profile.website ?? "",
    linkedin: profile.linkedin ?? "",
    github: profile.github ?? "",
    avatarUrl: profile.avatarUrl ?? "",
    skills: Array.isArray(profile.skills) ? profile.skills : [],
    jobTypes: Array.isArray(profile.jobTypes) ? profile.jobTypes : [],
    workplacePreference: profile.workplacePreference ?? "",
    expectedSalary: profile.expectedSalary ?? null,
    availability: profile.availability ?? "",
    profileVisibility: profile.profileVisibility ?? "public",
    experience: Array.isArray(profile.experience) ? profile.experience : [],
    education: Array.isArray(profile.education) ? profile.education : [],
    resume: profile.resume ?? null,
    completeness: Number(profile.completeness ?? 0),
  };
}

export function computeProfileCompleteness(user) {
  const profile = normalizeProfile(user?.profile);
  let score = 0;

  if (user?.name) score += 10;
  if (profile.headline) score += 10;
  if (profile.bio && profile.bio.length >= 40) score += 10;
  if (profile.location) score += 5;
  if (profile.phone) score += 5;

  if (profile.skills.length >= 3) {
    score += 10;
  } else if (profile.skills.length > 0) {
    score += 5;
  }

  if (profile.experience.length > 0) score += 15;
  if (profile.education.length > 0) score += 10;
  if (profile.resume) score += 10;

  if (profile.website || profile.linkedin || profile.github) {
    score += 5;
  }

  if (profile.avatarUrl) score += 5;

  if (profile.jobTypes.length > 0 && profile.workplacePreference) {
    score += 5;
  }

  if (profile.expectedSalary !== null && profile.expectedSalary !== undefined) {
    score += 5;
  }

  return Math.min(100, score);
}

export function missingProfileFields(user) {
  const profile = normalizeProfile(user?.profile);
  const missing = [];

  if (!user?.name) missing.push("name");
  if (!profile.headline) missing.push("headline");
  if (!profile.bio || profile.bio.length < 40) missing.push("bio");
  if (!profile.location) missing.push("location");
  if (!profile.phone) missing.push("phone");
  if (profile.skills.length < 3) missing.push("skills");
  if (profile.experience.length === 0) missing.push("experience");
  if (profile.education.length === 0) missing.push("education");
  if (!profile.resume) missing.push("resume");
  if (!profile.website && !profile.linkedin && !profile.github) {
    missing.push("links");
  }
  if (!profile.avatarUrl) missing.push("avatar");

  return missing;
}

export function serializeProfile(user) {
  const profile = normalizeProfile(user?.profile);
  const completeness = computeProfileCompleteness(user);

  return {
    id: String(user.id ?? user._id),
    name: user.name,
    email: user.email,
    role: user.role ?? "job_seeker",
    status: user.status ?? "active",
    avatarUrl: user.avatarUrl ?? profile.avatarUrl ?? null,
    headline: profile.headline,
    bio: profile.bio,
    location: profile.location,
    phone: profile.phone,
    website: profile.website,
    linkedin: profile.linkedin,
    github: profile.github,
    skills: profile.skills,
    jobTypes: profile.jobTypes,
    workplacePreference: profile.workplacePreference,
    expectedSalary: profile.expectedSalary,
    availability: profile.availability,
    profileVisibility: profile.profileVisibility,
    experience: profile.experience,
    education: profile.education,
    resume: profile.resume,
    completeness,
    missingFields: missingProfileFields(user),
    profileViews: Number(user.profileViews ?? 0),
    memberSince: toIso(user.createdAt),
    updatedAt: toIso(user.updatedAt),
    companyId: user.companyId ?? null,
  };
}

export function serializeCandidate(user) {
  const profile = normalizeProfile(user?.profile);

  return {
    id: String(user.id ?? user._id),
    name: user.name,
    email: user.email,
    avatarUrl: user.avatarUrl ?? profile.avatarUrl ?? null,
    headline: profile.headline,
    location: profile.location,
    phone: profile.phone,
    skills: profile.skills,
    availability: profile.availability,
    expectedSalary: profile.expectedSalary,
    experienceYears: profile.experience.length,
    profileComplete: computeProfileCompleteness(user),
    resume: profile.resume,
    links: {
      website: profile.website,
      linkedin: profile.linkedin,
      github: profile.github,
    },
  };
}

export function serializeSettings(settings) {
  return normalizeSettings(settings);
}
