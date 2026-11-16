import {
  ALL_JOB_STATUSES,
  ALL_USER_STATUSES,
  APPLICATION_STATUSES,
  BILLING_INTERVALS,
  JOB_TYPES,
  PROFILE_VISIBILITY,
  RECRUITER_APPLICATION_STATUSES,
  ROLES,
  SALARY_PERIODS,
  SIGN_UP_ROLES,
  WORKPLACES,
} from "./constants.js";
import { HttpError } from "./http-error.js";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_PATTERN = /^(https?:\/\/|\/)[^\s]+$/;

export function asString(value) {
  return typeof value === "string" ? value : "";
}

export function firstValue(value) {
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }

  return typeof value === "string" ? value : "";
}

export function parseList(value) {
  if (Array.isArray(value)) {
    return value.flatMap((item) => parseList(item));
  }

  if (typeof value !== "string") {
    return [];
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function hasOwn(object, key) {
  return Boolean(
    object && Object.prototype.hasOwnProperty.call(object, key)
  );
}

function fail(field, message, code = "VALIDATION_ERROR", status = 400) {
  throw new HttpError(status, code, message, { field });
}

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function stringValue(
  value,
  { field, min = 0, max = 1000, required = false, message }
) {
  const raw = cleanString(value);

  if (!raw) {
    if (required) {
      fail(field, message ?? `${labelFor(field)} is required.`);
    }

    if (min > 0 && value !== undefined && value !== null) {
      fail(field, message ?? `${labelFor(field)} is too short.`);
    }

    return "";
  }

  if (raw.length < min) {
    fail(field, message ?? `${labelFor(field)} must be at least ${min} characters.`);
  }

  if (raw.length > max) {
    fail(field, message ?? `${labelFor(field)} must be ${max} characters or fewer.`);
  }

  return raw;
}

function optionalString(value, options) {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return "";
  }

  return stringValue(value, options);
}

function labelFor(field) {
  return field
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (character) => character.toUpperCase());
}

function emailValue(value, { field = "email", required = true } = {}) {
  const email = cleanString(value).toLowerCase();

  if (!email) {
    if (required) {
      fail(field, "Enter a valid email address.");
    }

    return "";
  }

  if (!EMAIL_PATTERN.test(email) || email.length > 254) {
    fail(field, "Enter a valid email address.");
  }

  return email;
}

function urlValue(value, { field, required = false, max = 500 } = {}) {
  const url = cleanString(value);

  if (!url) {
    if (required) {
      fail(field, `${labelFor(field)} is required.`);
    }

    return "";
  }

  if (url.length > max || !URL_PATTERN.test(url)) {
    fail(field, "Enter a valid URL.");
  }

  return url;
}

function enumValue(value, allowed, { field, fallback, message } = {}) {
  const raw = cleanString(value);
  const normalized = raw.toLowerCase();

  if (!normalized) {
    if (fallback !== undefined) {
      return fallback;
    }

    fail(field, message ?? `Choose a valid ${labelFor(field).toLowerCase()}.`);
  }

  const match = allowed.find((item) => item.toLowerCase() === normalized);

  if (match === undefined) {
    fail(field, message ?? `Choose a valid ${labelFor(field).toLowerCase()}.`);
  }

  return match;
}

function numberValue(
  value,
  { field, min = 0, max = Number.MAX_SAFE_INTEGER, integer = false, fallback }
) {
  if (value === undefined || value === null || value === "") {
    if (fallback !== undefined) {
      return fallback;
    }

    fail(field, `${labelFor(field)} is required.`);
  }

  const parsed = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    fail(field, `${labelFor(field)} is invalid.`);
  }

  if (integer && !Number.isInteger(parsed)) {
    fail(field, `${labelFor(field)} must be a whole number.`);
  }

  return parsed;
}

function booleanValue(value, fallback = false) {
  if (value === undefined || value === null) {
    return fallback;
  }

  return value === true || value === "true" || value === 1 || value === "1";
}

function stringArray(
  value,
  { field, maxItems = 30, itemMax = 80, required = false }
) {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    fail(field, `${labelFor(field)} must be a list.`);
  }

  if (required && value.length === 0) {
    fail(field, `Add at least one ${labelFor(field).toLowerCase().slice(0, -1)}.`);
  }

  if (value.length > maxItems) {
    fail(field, `Add no more than ${maxItems} items.`);
  }

  return value.map((item) => {
    const text = cleanString(item);

    if (!text) {
      fail(field, "List items cannot be empty.");
    }

    if (text.length > itemMax) {
      fail(field, `List items must be ${itemMax} characters or fewer.`);
    }

    return text;
  });
}

function objectArray(value, { field, maxItems, itemParser }) {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    fail(field, `${labelFor(field)} must be a list.`);
  }

  if (value.length > maxItems) {
    fail(field, `Add no more than ${maxItems} items.`);
  }

  return value
    .filter((item) => item && typeof item === "object")
    .map((item, index) => itemParser(item, `${field}.${index}`));
}

function looseDate(value, field, { required = false } = {}) {
  const raw = cleanString(value);

  if (!raw) {
    if (required) {
      fail(field, `${labelFor(field)} is required.`);
    }

    return "";
  }

  if (raw.length > 40) {
    fail(field, `${labelFor(field)} is invalid.`);
  }

  return raw;
}

function strictDate(value, field, { required = true, future = false } = {}) {
  const raw = cleanString(value);

  if (!raw) {
    if (required) {
      fail(field, `${labelFor(field)} is required.`);
    }

    return null;
  }

  const parsed = new Date(raw);

  if (Number.isNaN(parsed.getTime())) {
    fail(field, `${labelFor(field)} is invalid.`);
  }

  if (future && parsed.getTime() <= Date.now()) {
    fail(field, `${labelFor(field)} must be in the future.`);
  }

  return parsed.toISOString();
}

function experienceItem(item, prefix) {
  return {
    id: typeof item.id === "string" ? item.id.slice(0, 80) : undefined,
    title: stringValue(item.title, {
      field: `${prefix}.title`,
      min: 1,
      max: 120,
      required: true,
      message: "Add a job title.",
    }),
    company: stringValue(item.company, {
      field: `${prefix}.company`,
      min: 1,
      max: 120,
      required: true,
      message: "Add a company name.",
    }),
    location: optionalString(item.location, {
      field: `${prefix}.location`,
      max: 120,
    }),
    startDate: looseDate(item.startDate, `${prefix}.startDate`),
    endDate: looseDate(item.endDate, `${prefix}.endDate`),
    current: booleanValue(item.current, false),
    description: optionalString(item.description, {
      field: `${prefix}.description`,
      max: 1200,
    }),
  };
}

function educationItem(item, prefix) {
  return {
    id: typeof item.id === "string" ? item.id.slice(0, 80) : undefined,
    school: stringValue(item.school, {
      field: `${prefix}.school`,
      min: 1,
      max: 160,
      required: true,
      message: "Add a school name.",
    }),
    degree: optionalString(item.degree, {
      field: `${prefix}.degree`,
      max: 120,
    }),
    field: optionalString(item.field, {
      field: `${prefix}.field`,
      max: 120,
    }),
    startDate: looseDate(item.startDate, `${prefix}.startDate`),
    endDate: looseDate(item.endDate, `${prefix}.endDate`),
  };
}

export function parseSignUpInput(body) {
  const name = stringValue(body?.name, {
    field: "name",
    min: 2,
    max: 80,
    required: true,
    message: "Enter your full name (2-80 characters).",
  }).replace(/\s+/g, " ");
  const email = emailValue(body?.email);
  const password = asString(body?.password);
  const role = enumValue(body?.role ?? ROLES.JOB_SEEKER, SIGN_UP_ROLES, {
    field: "role",
    fallback: ROLES.JOB_SEEKER,
    message: "Choose either a job seeker or recruiter account.",
  });

  if (password.length < 8 || password.length > 128) {
    fail("password", "Password must be 8-128 characters.");
  }

  return { name, email, password, role };
}

export function parseSignInInput(body) {
  const email = emailValue(body?.email);
  const password = asString(body?.password);

  if (password.length === 0) {
    fail("password", "Enter your email and password.");
  }

  if (password.length > 128) {
    throw new HttpError(
      401,
      "INVALID_CREDENTIALS",
      "Invalid email or password."
    );
  }

  return { email, password };
}

export function parseChangePasswordInput(body) {
  const currentPassword = asString(body?.currentPassword);
  const newPassword = asString(body?.newPassword);

  if (!currentPassword) {
    fail("currentPassword", "Enter your current password.");
  }

  if (newPassword.length < 8 || newPassword.length > 128) {
    fail("newPassword", "New password must be 8-128 characters.");
  }

  if (currentPassword === newPassword) {
    fail("newPassword", "Choose a password you have not used before.");
  }

  return { currentPassword, newPassword };
}

export function parseForgotPasswordInput(body) {
  return { email: emailValue(body?.email) };
}

export function parseResetPasswordInput(body) {
  const token = stringValue(body?.token, {
    field: "token",
    min: 10,
    max: 200,
    required: true,
    message: "This password reset link is invalid.",
  });
  const password = asString(body?.password);

  if (password.length < 8 || password.length > 128) {
    fail("password", "Password must be 8-128 characters.");
  }

  return { token, password };
}

export function parseEmailChangeInput(body) {
  return {
    email: emailValue(body?.email),
    currentPassword: asString(body?.currentPassword),
  };
}

export function parseNameInput(body) {
  return {
    name: stringValue(body?.name, {
      field: "name",
      min: 2,
      max: 80,
      required: true,
      message: "Enter your full name (2-80 characters).",
    }).replace(/\s+/g, " "),
  };
}

export function parseProfileUpdate(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    fail("body", "Send the profile fields to update.");
  }

  const patch = {};

  if (hasOwn(body, "name")) {
    patch.name = stringValue(body.name, {
      field: "name",
      min: 2,
      max: 80,
      required: true,
      message: "Enter your full name (2-80 characters).",
    }).replace(/\s+/g, " ");
  }

  if (hasOwn(body, "headline")) {
    patch.headline = optionalString(body.headline, {
      field: "headline",
      max: 120,
    });
  }

  if (hasOwn(body, "bio")) {
    patch.bio = optionalString(body.bio, { field: "bio", max: 2000 });
  }

  if (hasOwn(body, "location")) {
    patch.location = optionalString(body.location, {
      field: "location",
      max: 120,
    });
  }

  if (hasOwn(body, "phone")) {
    patch.phone = optionalString(body.phone, { field: "phone", max: 40 });
  }

  if (hasOwn(body, "website")) {
    patch.website = urlValue(body.website, { field: "website" });
  }

  if (hasOwn(body, "linkedin")) {
    patch.linkedin = urlValue(body.linkedin, { field: "linkedin" });
  }

  if (hasOwn(body, "github")) {
    patch.github = urlValue(body.github, { field: "github" });
  }

  if (hasOwn(body, "avatarUrl")) {
    patch.avatarUrl = urlValue(body.avatarUrl, { field: "avatarUrl" });
  }

  if (hasOwn(body, "skills")) {
    patch.skills = stringArray(body.skills, {
      field: "skills",
      maxItems: 30,
      itemMax: 50,
    });
  }

  if (hasOwn(body, "jobTypes")) {
    if (!Array.isArray(body.jobTypes)) {
      fail("jobTypes", "Job types must be a list.");
    }

    patch.jobTypes = body.jobTypes.map((value) =>
      enumValue(value, JOB_TYPES, { field: "jobTypes" })
    );
  }

  if (hasOwn(body, "workplacePreference")) {
    patch.workplacePreference =
      body.workplacePreference === null || body.workplacePreference === ""
        ? ""
        : enumValue(body.workplacePreference, WORKPLACES, {
            field: "workplacePreference",
          });
  }

  if (hasOwn(body, "expectedSalary")) {
    patch.expectedSalary =
      body.expectedSalary === null || body.expectedSalary === ""
        ? null
        : numberValue(body.expectedSalary, {
            field: "expectedSalary",
            min: 0,
            max: 100_000_000,
          });
  }

  if (hasOwn(body, "availability")) {
    patch.availability = optionalString(body.availability, {
      field: "availability",
      max: 80,
    });
  }

  if (hasOwn(body, "profileVisibility")) {
    patch.profileVisibility = enumValue(
      body.profileVisibility,
      PROFILE_VISIBILITY,
      { field: "profileVisibility" }
    );
  }

  if (hasOwn(body, "experience")) {
    patch.experience = objectArray(body.experience, {
      field: "experience",
      maxItems: 20,
      itemParser: experienceItem,
    });
  }

  if (hasOwn(body, "education")) {
    patch.education = objectArray(body.education, {
      field: "education",
      maxItems: 10,
      itemParser: educationItem,
    });
  }

  if (hasOwn(body, "resume")) {
    if (body.resume === null) {
      patch.resume = null;
    } else if (!body.resume || typeof body.resume !== "object") {
      fail("resume", "Resume must include a file name and URL.");
    } else {
      patch.resume = {
        fileName: stringValue(body.resume.fileName, {
          field: "resume.fileName",
          min: 1,
          max: 200,
          required: true,
          message: "Add the resume file name.",
        }),
        url: urlValue(body.resume.url, {
          field: "resume.url",
          required: true,
        }),
        uploadedAt: new Date().toISOString(),
      };
    }
  }

  if (Object.keys(patch).length === 0) {
    fail("body", "No profile fields were provided.");
  }

  return patch;
}

const SETTINGS_BOOLEAN_KEYS = {
  notifications: [
    "jobAlerts",
    "applicationUpdates",
    "weeklyDigest",
    "productNews",
    "email",
    "push",
  ],
  privacy: ["showSalary", "allowRecruiterMessages"],
  appearance: [],
};

export function parseSettingsUpdate(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    fail("body", "Send the settings to update.");
  }

  const patch = {};

  for (const section of ["notifications", "privacy"]) {
    if (!hasOwn(body, section)) {
      continue;
    }

    if (!body[section] || typeof body[section] !== "object") {
      fail(section, `${labelFor(section)} must be an object.`);
    }

    const sectionPatch = {};

    for (const key of SETTINGS_BOOLEAN_KEYS[section]) {
      if (hasOwn(body[section], key)) {
        sectionPatch[key] = booleanValue(body[section][key]);
      }
    }

    if (hasOwn(body[section], "profileVisibility")) {
      sectionPatch.profileVisibility = enumValue(
        body[section].profileVisibility,
        PROFILE_VISIBILITY,
        { field: `${section}.profileVisibility` }
      );
    }

    if (Object.keys(sectionPatch).length > 0) {
      patch[section] = sectionPatch;
    }
  }

  if (hasOwn(body, "appearance")) {
    if (!body.appearance || typeof body.appearance !== "object") {
      fail("appearance", "Appearance must be an object.");
    }

    if (hasOwn(body.appearance, "theme")) {
      patch.appearance = {
        theme: enumValue(body.appearance.theme, ["light", "dark", "system"], {
          field: "appearance.theme",
        }),
      };
    }
  }

  if (Object.keys(patch).length === 0) {
    fail("body", "No settings were provided.");
  }

  return patch;
}

export function parseCheckoutInput(body) {
  const planId = stringValue(body?.planId, {
    field: "planId",
    min: 1,
    max: 60,
    required: true,
    message: "Choose a plan to continue.",
  });
  const currency = enumValue(body?.currency, ["USD", "BDT"], {
    field: "currency",
    message: "Choose USD or BDT for this payment.",
  });
  const rawInterval = cleanString(body?.interval ?? body?.billingInterval).toLowerCase();
  const interval =
    rawInterval === "year" || rawInterval === "yearly"
      ? "yearly"
      : rawInterval === "" || rawInterval === "month" || rawInterval === "monthly"
        ? "monthly"
        : null;

  if (!interval) {
    fail("interval", "Choose monthly or yearly billing.");
  }

  const email = emailValue(body?.email);
  const name = stringValue(body?.name, {
    field: "name",
    min: 2,
    max: 80,
    required: true,
    message: "Enter the name shown on your card.",
  }).replace(/\s+/g, " ");
  const country = stringValue(body?.country, {
    field: "country",
    min: 2,
    max: 80,
    required: true,
    message: "Choose a country or region.",
  }).replace(/\s+/g, " ");
  const rawPaymentMethod = cleanString(body?.paymentMethod);
  const paymentMethod =
    rawPaymentMethod === "visa" ? "pm_card_visa" : rawPaymentMethod;
  const saveInfo = booleanValue(body?.saveInfo, false);

  if (paymentMethod !== "pm_card_visa") {
    throw new HttpError(
      400,
      "TEST_PAYMENT_METHOD_REQUIRED",
      "This sandbox checkout only accepts the demo Visa test card.",
      { field: "paymentMethod" }
    );
  }

  return {
    planId,
    currency,
    interval,
    email,
    name,
    country,
    paymentMethod,
    saveInfo,
  };
}

export function parseBillingChangePlanInput(body) {
  const planId = stringValue(body?.planId, {
    field: "planId",
    min: 1,
    max: 60,
    required: true,
    message: "Choose a plan.",
  });
  const interval = enumValue(body?.interval ?? "monthly", BILLING_INTERVALS, {
    field: "interval",
    fallback: "monthly",
    message: "Choose monthly or yearly billing.",
  });

  return { planId, interval };
}

export function parsePaymentMethodInput(body) {
  const brand = enumValue(
    body?.brand ?? "visa",
    ["visa", "mastercard", "amex", "discover"],
    { field: "brand", fallback: "visa" }
  );
  const rawLast4 = cleanString(body?.last4 ?? "4242");
  const expMonth = numberValue(body?.expMonth ?? 12, {
    field: "expMonth",
    min: 1,
    max: 12,
    integer: true,
  });
  const currentYear = new Date().getFullYear();
  const expYear = numberValue(body?.expYear ?? currentYear + 8, {
    field: "expYear",
    min: currentYear,
    max: currentYear + 30,
    integer: true,
  });
  const name = stringValue(body?.name ?? "Hireloop Member", {
    field: "name",
    min: 2,
    max: 80,
    required: true,
    message: "Enter the name shown on your card.",
  });

  if (!/^\d{4}$/.test(rawLast4)) {
    fail("last4", "Enter the last four digits of the card.");
  }

  return { brand, last4: rawLast4, expMonth, expYear, name };
}

function parseStatusFilter(value, allowed, field = "status") {
  const raw = cleanString(value).toLowerCase();

  if (!raw || raw === "all") {
    return null;
  }

  if (!allowed.includes(raw)) {
    fail(field, `Choose a valid ${field}.`);
  }

  return raw;
}

export function parseUserQuery(query = {}) {
  return {
    role: parseStatusFilter(firstValue(query.role), Object.values(ROLES), "role"),
    status: parseStatusFilter(
      firstValue(query.status),
      ALL_USER_STATUSES,
      "status"
    ),
    q: cleanString(firstValue(query.q)).slice(0, 120),
  };
}

export function parseJobStatusFilter(value) {
  return parseStatusFilter(value, ALL_JOB_STATUSES, "status");
}

export function parseApplicationStatusFilter(value) {
  return parseStatusFilter(value, APPLICATION_STATUSES, "status");
}

export function parsePaymentStatusFilter(value) {
  return parseStatusFilter(
    value,
    ["succeeded", "refunded", "failed", "pending"],
    "status"
  );
}

export function parseJobPostInput(body, { partial = false } = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    fail("body", "Send the job post fields.");
  }

  const job = {};

  function set(key, value) {
    if (!partial || value !== undefined) {
      job[key] = value;
    }
  }

  if (!partial || hasOwn(body, "title")) {
    set(
      "title",
      stringValue(body.title, {
        field: "title",
        min: 3,
        max: 140,
        required: true,
        message: "Enter a job title (3-140 characters).",
      })
    );
  }

  if (!partial || hasOwn(body, "type")) {
    set(
      "type",
      enumValue(body.type, JOB_TYPES, {
        field: "type",
        fallback: partial ? undefined : "full-time",
        message: "Choose a valid job type.",
      })
    );
  }

  if (!partial || hasOwn(body, "workplace")) {
    set(
      "workplace",
      enumValue(body.workplace, WORKPLACES, {
        field: "workplace",
        fallback: partial ? undefined : "remote",
        message: "Choose a valid workplace.",
      })
    );
  }

  if (!partial || hasOwn(body, "location")) {
    set(
      "location",
      stringValue(body.location, {
        field: "location",
        min: 2,
        max: 120,
        required: true,
        message: "Enter a job location.",
      })
    );
  }

  if (!partial || hasOwn(body, "level")) {
    set(
      "level",
      stringValue(body.level, {
        field: "level",
        min: 1,
        max: 40,
        required: true,
        message: "Choose an experience level.",
      })
    );
  }

  if (!partial || hasOwn(body, "experience")) {
    set(
      "experience",
      stringValue(body.experience, {
        field: "experience",
        min: 1,
        max: 40,
        required: true,
        message: "Add the required experience.",
      })
    );
  }

  if (!partial || hasOwn(body, "salaryMin")) {
    set(
      "salaryMin",
      numberValue(body.salaryMin, {
        field: "salaryMin",
        min: 0,
        max: 10_000_000,
        fallback: partial ? undefined : 0,
      })
    );
  }

  if (!partial || hasOwn(body, "salaryMax")) {
    set(
      "salaryMax",
      numberValue(body.salaryMax, {
        field: "salaryMax",
        min: 0,
        max: 10_000_000,
        fallback: partial ? undefined : 0,
      })
    );
  }

  if (
    job.salaryMin !== undefined &&
    job.salaryMax !== undefined &&
    job.salaryMax < job.salaryMin
  ) {
    fail("salaryMax", "Maximum salary must be greater than the minimum.");
  }

  if (!partial || hasOwn(body, "salaryPeriod")) {
    set(
      "salaryPeriod",
      enumValue(body.salaryPeriod, SALARY_PERIODS, {
        field: "salaryPeriod",
        fallback: partial ? undefined : "year",
        message: "Choose a valid salary period.",
      })
    );
  }

  if (!partial || hasOwn(body, "description")) {
    set(
      "description",
      stringValue(body.description, {
        field: "description",
        min: 30,
        max: 8000,
        required: true,
        message: "Write a job description (at least 30 characters).",
      })
    );
  }

  if (!partial || hasOwn(body, "summary")) {
    set(
      "summary",
      optionalString(body.summary, { field: "summary", max: 300 })
    );
  }

  if (!partial || hasOwn(body, "responsibilities")) {
    set(
      "responsibilities",
      stringArray(body.responsibilities, {
        field: "responsibilities",
        maxItems: 20,
        itemMax: 400,
      })
    );
  }

  if (!partial || hasOwn(body, "skills")) {
    set(
      "skills",
      stringArray(body.skills, {
        field: "skills",
        maxItems: 25,
        itemMax: 60,
      })
    );
  }

  if (!partial || hasOwn(body, "requirements")) {
    set(
      "requirements",
      stringArray(body.requirements, {
        field: "requirements",
        maxItems: 20,
        itemMax: 500,
      })
    );
  }

  if (!partial || hasOwn(body, "benefits")) {
    set(
      "benefits",
      stringArray(body.benefits, {
        field: "benefits",
        maxItems: 20,
        itemMax: 200,
      })
    );
  }

  if (!partial || hasOwn(body, "tags")) {
    set(
      "tags",
      stringArray(body.tags, {
        field: "tags",
        maxItems: 12,
        itemMax: 40,
      })
    );
  }

  if (!partial || hasOwn(body, "positions")) {
    set(
      "positions",
      numberValue(body.positions, {
        field: "positions",
        min: 1,
        max: 100,
        integer: true,
        fallback: partial ? undefined : 1,
      })
    );
  }

  if (!partial || hasOwn(body, "easyApply")) {
    set("easyApply", booleanValue(body.easyApply, false));
  }

  if (!partial || hasOwn(body, "hot")) {
    set("hot", booleanValue(body.hot, false));
  }

  if (!partial || hasOwn(body, "deadline")) {
    set(
      "deadline",
      strictDate(body.deadline, "deadline", {
        required: false,
        future: true,
      })
    );
  }

  if (!partial || hasOwn(body, "status")) {
    set(
      "status",
      enumValue(body.status ?? "pending_review", ["draft", "pending_review"], {
        field: "status",
        fallback: partial ? undefined : "pending_review",
        message: "Jobs can be saved as a draft or submitted for review.",
      })
    );
  }

  if (hasOwn(body, "companyId")) {
    job.companyId = optionalString(body.companyId, {
      field: "companyId",
      max: 80,
    });
  }

  if (partial && Object.keys(job).length === 0) {
    fail("body", "No job fields were provided.");
  }

  return job;
}

export function parseSavedJobInput(body) {
  return {
    jobId: stringValue(body?.jobId, {
      field: "jobId",
      min: 1,
      max: 120,
      required: true,
      message: "Choose a job to save.",
    }),
  };
}

export function parseApplicationCreateInput(body) {
  return {
    jobId: stringValue(body?.jobId, {
      field: "jobId",
      min: 1,
      max: 120,
      required: true,
      message: "Choose a job to apply to.",
    }),
    ...parseApplicationInput(body),
  };
}

export function parseApplicationInput(body) {
  const coverLetter = optionalString(body?.coverLetter, {
    field: "coverLetter",
    max: 4000,
  });
  const resumeUrl = optionalString(body?.resumeUrl, {
    field: "resumeUrl",
    max: 500,
  });
  const availability = optionalString(body?.availability, {
    field: "availability",
    max: 80,
  });
  let expectedSalary = null;

  if (body?.expectedSalary !== undefined && body?.expectedSalary !== null && body?.expectedSalary !== "") {
    expectedSalary = numberValue(body.expectedSalary, {
      field: "expectedSalary",
      min: 0,
      max: 100_000_000,
    });
  }

  if (resumeUrl && !URL_PATTERN.test(resumeUrl)) {
    fail("resumeUrl", "Enter a valid resume URL.");
  }

  return { coverLetter, resumeUrl, availability, expectedSalary };
}

export function parseApplicationStatusInput(body) {
  const status = enumValue(body?.status, RECRUITER_APPLICATION_STATUSES, {
    field: "status",
    message: "Choose a valid application status.",
  });
  const note = optionalString(body?.note, { field: "note", max: 1000 });

  return { status, note };
}

export function parseApplicationWithdrawInput(body) {
  return {
    note: optionalString(body?.note, { field: "note", max: 500 }) ?? "",
  };
}

export function parseAdminUserUpdate(body) {
  const patch = {};

  if (hasOwn(body ?? {}, "status")) {
    patch.status = enumValue(body.status, ALL_USER_STATUSES, {
      field: "status",
    });
  }

  if (hasOwn(body ?? {}, "role")) {
    patch.role = enumValue(body.role, [ROLES.JOB_SEEKER, ROLES.RECRUITER], {
      field: "role",
      message: "Choose either a job seeker or recruiter role.",
    });
  }

  if (Object.keys(patch).length === 0) {
    fail("body", "Choose a status or role to update.");
  }

  return patch;
}

export function parseModerationInput(body) {
  const action = enumValue(body?.action, ["approve", "reject"], {
    field: "action",
    message: "Choose approve or reject.",
  });
  const reason = optionalString(body?.reason, {
    field: "reason",
    max: 500,
  });

  if (action === "reject" && (!reason || reason.length < 3)) {
    fail("reason", "Add a short reason for rejecting this job.");
  }

  return { action, reason: reason ?? "" };
}

export function parseAdminJobStatusInput(body) {
  return {
    status: enumValue(body?.status, ALL_JOB_STATUSES, {
      field: "status",
      message: "Choose a valid job status.",
    }),
    reason: optionalString(body?.reason, { field: "reason", max: 500 }) ?? "",
  };
}

export function parseCompanyInput(body, { partial = false } = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    fail("body", "Send the company profile fields.");
  }

  const company = {};

  const fields = [
    ["name", 2, 120, true],
    ["industry", 2, 120, true],
    ["size", 1, 80, true],
    ["location", 1, 120, true],
    ["phone", 0, 40, false],
    ["logo", 0, 500, false],
    ["coverImage", 0, 500, false],
    ["about", 10, 4000, true],
  ];

  for (const [field, min, max, required] of fields) {
    if (partial && !hasOwn(body, field)) {
      continue;
    }

    company[field] = stringValue(body[field], {
      field,
      min: required ? Math.max(1, min) : 0,
      max,
      required,
    });
  }

  if (!partial || hasOwn(body, "website")) {
    company.website = urlValue(body.website, { field: "website" });
  }

  if (!partial || hasOwn(body, "email")) {
    company.email = hasOwn(body, "email") || !partial
      ? emailValue(body.email, { required: false })
      : undefined;
  }

  if (!partial || hasOwn(body, "founded")) {
    company.founded = numberValue(body.founded, {
      field: "founded",
      min: 1800,
      max: new Date().getFullYear(),
      integer: true,
      fallback: partial ? undefined : new Date().getFullYear(),
    });
  }

  if (!partial || hasOwn(body, "benefits")) {
    company.benefits = stringArray(body.benefits, {
      field: "benefits",
      maxItems: 20,
      itemMax: 160,
    });
  }

  if (!partial || hasOwn(body, "gallery")) {
    const gallery = stringArray(body.gallery, {
      field: "gallery",
      maxItems: 10,
      itemMax: 500,
    });

    if (gallery) {
      for (const url of gallery) {
        if (!URL_PATTERN.test(url)) {
          fail("gallery", "Gallery items must be valid URLs.");
        }
      }
    }

    company.gallery = gallery;
  }

  if (hasOwn(body, "socials")) {
    if (!body.socials || typeof body.socials !== "object") {
      fail("socials", "Social links must be an object.");
    }

    const socials = {};

    for (const key of ["linkedin", "twitter", "facebook", "website"]) {
      if (hasOwn(body.socials, key)) {
        socials[key] = urlValue(body.socials[key], {
          field: `socials.${key}`,
        });
      }
    }

    company.socials = socials;
  }

  if (partial && Object.keys(company).length === 0) {
    fail("body", "No company fields were provided.");
  }

  return company;
}

export function parsePagination(query = {}, { defaultLimit = 20, maxLimit = 100 } = {}) {
  const rawLimit = Number.parseInt(firstValue(query.limit), 10);
  const rawPage = Number.parseInt(firstValue(query.page), 10);
  const limit =
    Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(rawLimit, maxLimit)
      : defaultLimit;
  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;

  return { page, limit, skip: (page - 1) * limit };
}

export function parseJobSort(value) {
  return enumValue(value ?? "recent", [
    "recent",
    "oldest",
    "salary-desc",
    "salary-asc",
    "title",
    "views",
  ], {
    field: "sort",
    fallback: "recent",
    message: "Choose a valid sort order.",
  });
}
