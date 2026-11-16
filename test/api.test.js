import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createApp } from "../src/app.js";
import { hashPassword } from "../src/auth/password.js";
import { seedStore } from "../src/data/seed.js";
import { createJsonStore } from "../src/store/json-store.js";

const testConfig = {
  clientOrigins: ["http://localhost:3000"],
  sessionCookieName: "hireloop_test_session",
  sessionDays: 7,
  cookieSecure: false,
  isProduction: false,
  isTest: true,
  seedDemoData: false,
  exposeResetTokens: true,
  rateLimitEnabled: false,
  requestLogging: false,
  passwordResetMinutes: 30,
  apiVersion: "test",
  trustProxy: false,
};

function createClient(baseUrl) {
  let cookie = "";

  async function request(pathname, { method = "GET", body, includeCookie = true } = {}) {
    const headers = {};

    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    if (cookie && includeCookie) {
      headers.Cookie = cookie;
    }

    const response = await fetch(`${baseUrl}${pathname}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const setCookies =
      typeof response.headers.getSetCookie === "function"
        ? response.headers.getSetCookie()
        : [];

    if (setCookies.length > 0) {
      cookie = setCookies.map((value) => value.split(";")[0]).join("; ");
    }

    const contentType = response.headers.get("content-type") ?? "";
    const payload = contentType.includes("application/json")
      ? await response.json()
      : await response.text();

    return { status: response.status, headers: response.headers, body: payload };
  }

  return {
    request,
    getCookie: () => cookie,
    setCookie: (value) => {
      cookie = value;
    },
  };
}

async function startServer() {
  const directory = await mkdtemp(path.join(tmpdir(), "hireloop-api-"));
  const store = await createJsonStore(path.join(directory, "store.json"));
  const seeded = await seedStore(store, { seedDemoData: false });
  const app = createApp({ store, config: testConfig });
  const server = app.listen(0);
  await once(server, "listening");
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  return {
    store,
    seeded,
    baseUrl,
    client: () => createClient(baseUrl),
    async close() {
      await new Promise((resolve) => server.close(resolve));
      await store.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

test("HireLoop API end-to-end", async (t) => {
  const ctx = await startServer();
  t.after(() => ctx.close());

  const seeker = ctx.client();
  const recruiter = ctx.client();
  const admin = ctx.client();
  let seekerJobId;
  let seekerApplicationId;
  let seekerUserId;
  let recruiterJobId;
  let recruiterApplicationId;
  let paymentId;

  await t.test("serves public catalogue data", async () => {
    const health = await seeker.request("/health");
    assert.equal(health.status, 200);
    assert.equal(health.body.status, "ok");
    assert.equal(health.body.store, "json");

    const plans = await seeker.request("/api/plans");
    assert.equal(plans.status, 200);
    assert.equal(plans.body.plans.length, 4);
    assert.equal(
      plans.body.plans.find((plan) => plan.id === "growth").amount,
      17
    );

    const bdtPlans = await seeker.request(
      "/api/plans?currency=BDT&interval=yearly"
    );
    assert.equal(bdtPlans.status, 200);
    assert.ok(
      bdtPlans.body.plans.find((plan) => plan.id === "growth").amount > 1000
    );

    const jobs = await seeker.request("/api/jobs?limit=4");
    assert.equal(jobs.status, 200);
    assert.equal(jobs.body.jobs.length, 4);
    assert.ok(jobs.body.pagination.total > 4);
    assert.ok(jobs.body.filters.types.length >= 3);
    seekerJobId = jobs.body.jobs[0].id;

    const detail = await seeker.request(`/api/jobs/${seekerJobId}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.job.id, seekerJobId);
    assert.equal(detail.body.hasApplied, false);
    assert.ok(Array.isArray(detail.body.similarJobs));

    const companies = await seeker.request("/api/companies");
    assert.equal(companies.status, 200);
    assert.ok(companies.body.companies.length >= 5);

    const company = await seeker.request(
      `/api/companies/${companies.body.companies[0].id}`
    );
    assert.equal(company.status, 200);
    assert.ok(company.body.company.name);
    assert.ok(Array.isArray(company.body.reviews));
  });

  await t.test("registers, signs in and resets a password", async () => {
    const signUp = await seeker.request("/api/auth/sign-up", {
      method: "POST",
      body: {
        name: "Test Seeker",
        email: "seeker@test.dev",
        password: "Password123!",
        role: "job_seeker",
      },
    });
    assert.equal(signUp.status, 201);
    assert.equal(signUp.body.user.role, "job_seeker");
    assert.equal(signUp.body.user.email, "seeker@test.dev");
    seekerUserId = signUp.body.user.id;
    assert.ok(seeker.getCookie().includes("hireloop_test_session="));

    const duplicate = await seeker.request("/api/auth/sign-up", {
      method: "POST",
      body: {
        name: "Test Seeker",
        email: "seeker@test.dev",
        password: "Password123!",
      },
    });
    assert.equal(duplicate.status, 409);
    assert.equal(duplicate.body.error.code, "EMAIL_IN_USE");

    const me = await seeker.request("/api/auth/me");
    assert.equal(me.status, 200);
    assert.equal(me.body.user.name, "Test Seeker");

    const signOut = await seeker.request("/api/auth/sign-out", {
      method: "POST",
    });
    assert.equal(signOut.status, 200);

    const afterSignOut = await seeker.request("/api/auth/me");
    assert.equal(afterSignOut.status, 401);

    const badSignIn = await seeker.request("/api/auth/sign-in", {
      method: "POST",
      body: { email: "seeker@test.dev", password: "wrong-password" },
    });
    assert.equal(badSignIn.status, 401);
    assert.equal(badSignIn.body.error.code, "INVALID_CREDENTIALS");

    const forgot = await seeker.request("/api/auth/forgot-password", {
      method: "POST",
      body: { email: "seeker@test.dev" },
    });
    assert.equal(forgot.status, 200);
    assert.ok(forgot.body.resetToken);

    const reset = await seeker.request("/api/auth/reset-password", {
      method: "POST",
      body: {
        token: forgot.body.resetToken,
        password: "Password456!",
      },
    });
    assert.equal(reset.status, 200);

    const oldPassword = await seeker.request("/api/auth/sign-in", {
      method: "POST",
      body: { email: "seeker@test.dev", password: "Password123!" },
    });
    assert.equal(oldPassword.status, 401);

    const signIn = await seeker.request("/api/auth/sign-in", {
      method: "POST",
      body: { email: "seeker@test.dev", password: "Password456!" },
    });
    assert.equal(signIn.status, 200);
    assert.equal(signIn.body.user.email, "seeker@test.dev");
  });

  await t.test("supports the job seeker journey", async () => {
    const save = await seeker.request(`/api/jobs/${seekerJobId}/save`, {
      method: "POST",
    });
    assert.equal(save.status, 201);
    assert.equal(save.body.saved, true);

    const saved = await seeker.request("/api/saved-jobs");
    assert.equal(saved.status, 200);
    assert.ok(
      saved.body.savedJobs.some((item) => item.jobId === seekerJobId)
    );

    const apply = await seeker.request(`/api/jobs/${seekerJobId}/apply`, {
      method: "POST",
      body: {
        coverLetter: "I would love to join the team and bring my experience.",
        availability: "2 weeks",
      },
    });
    assert.equal(apply.status, 201);
    assert.equal(apply.body.application.status, "submitted");
    seekerApplicationId = apply.body.application.id;

    const duplicateApply = await seeker.request(
      `/api/jobs/${seekerJobId}/apply`,
      { method: "POST", body: {} }
    );
    assert.equal(duplicateApply.status, 409);
    assert.equal(duplicateApply.body.error.code, "ALREADY_APPLIED");

    const applications = await seeker.request("/api/applications");
    assert.equal(applications.status, 200);
    assert.equal(applications.body.applications.length, 1);
    assert.equal(applications.body.counts.submitted, 1);

    const dashboard = await seeker.request("/api/dashboard");
    assert.equal(dashboard.status, 200);
    assert.equal(dashboard.body.stats.totalApplications, 1);
    assert.equal(dashboard.body.stats.savedJobs, 1);
    assert.ok(Array.isArray(dashboard.body.recommendedJobs));

    const profile = await seeker.request("/api/profile", {
      method: "PATCH",
      body: {
        headline: "Product Designer",
        bio: "Product designer focused on accessible, scalable design systems for complex products.",
        location: "Austin, TX",
        skills: ["Figma", "Design Systems", "Prototyping"],
      },
    });
    assert.equal(profile.status, 200);
    assert.equal(profile.body.profile.headline, "Product Designer");
    assert.ok(profile.body.profile.completeness > 0);

    const settings = await seeker.request("/api/settings", {
      method: "PATCH",
      body: { notifications: { jobAlerts: false }, appearance: { theme: "light" } },
    });
    assert.equal(settings.status, 200);
    assert.equal(settings.body.settings.notifications.jobAlerts, false);
    assert.equal(settings.body.settings.appearance.theme, "light");

    const unread = await seeker.request("/api/notifications/unread-count");
    assert.equal(unread.status, 200);
    assert.equal(typeof unread.body.count, "number");
  });

  await t.test("handles sandbox checkout and billing", async () => {
    const checkout = await seeker.request("/api/checkout", {
      method: "POST",
      body: {
        planId: "growth",
        currency: "USD",
        interval: "monthly",
        email: "seeker@test.dev",
        name: "Test Seeker",
        country: "United States",
        paymentMethod: "pm_card_visa",
        saveInfo: true,
      },
    });
    assert.equal(checkout.status, 201);
    assert.equal(checkout.body.session.planId, "growth");
    assert.equal(checkout.body.session.amount, 17);
    assert.equal(checkout.body.session.status, "succeeded");

    const session = await seeker.request(
      `/api/checkout/${checkout.body.session.sessionId}`
    );
    assert.equal(session.status, 200);
    assert.equal(session.body.session.sessionId, checkout.body.session.sessionId);

    const billing = await seeker.request("/api/billing");
    assert.equal(billing.status, 200);
    assert.equal(billing.body.subscription.planId, "growth");
    assert.equal(billing.body.subscription.status, "active");
    assert.equal(billing.body.invoices.length, 1);
    assert.equal(billing.body.paymentMethods.length, 1);

    const invoice = await seeker.request(
      `/api/billing/invoices/${billing.body.invoices[0].id}`
    );
    assert.equal(invoice.status, 200);

    const download = await seeker.request(
      `/api/billing/invoices/${billing.body.invoices[0].id}/download`
    );
    assert.equal(download.status, 200);
    assert.ok(String(download.body).includes("HireLoop invoice"));

    const cancel = await seeker.request("/api/billing/cancel", {
      method: "POST",
    });
    assert.equal(cancel.status, 200);
    assert.equal(cancel.body.subscription.cancelAtPeriodEnd, true);

    const resume = await seeker.request("/api/billing/resume", {
      method: "POST",
    });
    assert.equal(resume.status, 200);
    assert.equal(resume.body.subscription.cancelAtPeriodEnd, false);

    const change = await seeker.request("/api/billing/change-plan", {
      method: "POST",
      body: { planId: "pro", interval: "yearly" },
    });
    assert.equal(change.status, 200);
    assert.equal(change.body.subscription.planId, "pro");
    assert.equal(change.body.subscription.priceUsd, 16);

    const paymentMethod = await seeker.request(
      "/api/billing/payment-method",
      {
        method: "POST",
        body: {
          brand: "mastercard",
          last4: "4444",
          expMonth: 5,
          expYear: new Date().getFullYear() + 3,
          name: "Test Seeker",
        },
      }
    );
    assert.equal(paymentMethod.status, 200);
    assert.equal(paymentMethod.body.paymentMethod.brand, "mastercard");
    assert.equal(paymentMethod.body.paymentMethod.last4, "4444");

    const removePaymentMethod = await seeker.request(
      "/api/billing/payment-method",
      { method: "DELETE" }
    );
    assert.equal(removePaymentMethod.status, 200);
    assert.equal(removePaymentMethod.body.paymentMethod, null);

    const withdraw = await seeker.request(
      `/api/applications/${seekerApplicationId}/withdraw`,
      { method: "POST", body: { note: "Accepted another role." } }
    );
    assert.equal(withdraw.status, 200);
    assert.equal(withdraw.body.application.status, "withdrawn");
  });

  await t.test("supports the recruiter journey", async () => {
    const signUp = await recruiter.request("/api/auth/sign-up", {
      method: "POST",
      body: {
        name: "Test Recruiter",
        email: "recruiter@test.dev",
        password: "Recruiter123!",
        role: "recruiter",
      },
    });
    assert.equal(signUp.status, 201);
    assert.equal(signUp.body.user.role, "recruiter");

    const emptyCompany = await recruiter.request("/api/recruiter/company");
    assert.equal(emptyCompany.status, 200);
    assert.equal(emptyCompany.body.company, null);

    const company = await recruiter.request("/api/recruiter/company", {
      method: "POST",
      body: {
        name: "Testworks Studio",
        industry: "Design / Software",
        size: "10 - 50 Employees",
        location: "Remote",
        website: "https://testworks.example",
        about:
          "Testworks Studio builds thoughtful tools for growing product teams.",
        email: "team@testworks.example",
        founded: 2021,
      },
    });
    assert.equal(company.status, 201);
    assert.equal(company.body.company.name, "Testworks Studio");

    const job = await recruiter.request("/api/recruiter/jobs", {
      method: "POST",
      body: {
        title: "Senior Product Designer",
        type: "full-time",
        workplace: "remote",
        location: "Remote (US)",
        level: "Senior",
        experience: "5+ Years",
        salaryMin: 140,
        salaryMax: 180,
        salaryPeriod: "year",
        description:
          "Lead the design of our core product experience and help the team ship thoughtful, accessible work.",
        responsibilities: [
          "Own design for a core product area.",
          "Partner closely with engineering.",
        ],
        skills: ["Figma", "Design Systems", "Prototyping"],
        requirements: ["5+ years of product design experience."],
        benefits: ["Remote-first team", "Learning budget"],
        tags: ["Full-time", "Remote"],
        positions: 1,
        easyApply: true,
        status: "pending_review",
      },
    });
    assert.equal(job.status, 201);
    assert.equal(job.body.job.status, "pending_review");
    recruiterJobId = job.body.job.id;

    const jobs = await recruiter.request("/api/recruiter/jobs");
    assert.equal(jobs.status, 200);
    assert.equal(jobs.body.jobs.length, 1);

    const update = await recruiter.request(
      `/api/recruiter/jobs/${recruiterJobId}`,
      {
        method: "PATCH",
        body: { title: "Senior Product Designer, Platform" },
      }
    );
    assert.equal(update.status, 200);
    assert.equal(
      update.body.job.title,
      "Senior Product Designer, Platform"
    );

    const dashboard = await recruiter.request("/api/recruiter/dashboard");
    assert.equal(dashboard.status, 200);
    assert.equal(dashboard.body.stats.totalJobs, 1);
    assert.equal(dashboard.body.company.name, "Testworks Studio");

    const preview = await recruiter.request(
      `/api/jobs/${recruiterJobId}/preview`
    );
    assert.equal(preview.status, 200);
    assert.equal(preview.body.job.id, recruiterJobId);

    const hiddenPreview = await seeker.request(
      `/api/jobs/${recruiterJobId}/preview`
    );
    assert.equal(hiddenPreview.status, 404);

    const duplicate = await recruiter.request(
      `/api/recruiter/jobs/${recruiterJobId}/duplicate`,
      { method: "POST" }
    );
    assert.equal(duplicate.status, 201);
    assert.equal(duplicate.body.job.status, "draft");
    assert.ok(duplicate.body.job.title.endsWith("(Copy)"));

    const closeCopy = await recruiter.request(
      `/api/recruiter/jobs/${duplicate.body.job.id}/close`,
      { method: "POST" }
    );
    assert.equal(closeCopy.status, 200);
    assert.equal(closeCopy.body.job.status, "closed");

    const deleteCopy = await recruiter.request(
      `/api/recruiter/jobs/${duplicate.body.job.id}`,
      { method: "DELETE" }
    );
    assert.equal(deleteCopy.status, 200);
    assert.equal(deleteCopy.body.deletedJobId, duplicate.body.job.id);
  });

  await t.test("supports admin moderation and platform management", async () => {
    const adminUser = await ctx.store.createUser({
      id: "test-admin",
      name: "Test Admin",
      email: "admin@test.dev",
      passwordHash: await hashPassword("Admin123!"),
      role: "admin",
    });
    assert.ok(adminUser);

    const signIn = await admin.request("/api/auth/sign-in", {
      method: "POST",
      body: { email: "admin@test.dev", password: "Admin123!" },
    });
    assert.equal(signIn.status, 200);
    assert.equal(signIn.body.user.role, "admin");

    const dashboard = await admin.request("/api/admin/dashboard");
    assert.equal(dashboard.status, 200);
    assert.ok(dashboard.body.stats.totalUsers >= 3);
    assert.ok(dashboard.body.stats.pendingJobs >= 1);
    assert.ok(Array.isArray(dashboard.body.revenueTrend));

    const users = await admin.request("/api/admin/users?role=job_seeker");
    assert.equal(users.status, 200);
    assert.ok(users.body.users.some((user) => user.email === "seeker@test.dev"));

    const userDetail = await admin.request(`/api/admin/users/${seekerUserId}`);
    assert.equal(userDetail.status, 200);
    assert.equal(userDetail.body.user.email, "seeker@test.dev");
    assert.equal(userDetail.body.stats.applications, 1);

    const searchedUsers = await admin.request(
      "/api/admin/users?q=seeker%40test.dev"
    );
    assert.equal(searchedUsers.status, 200);
    assert.ok(
      searchedUsers.body.users.some((user) => user.id === seekerUserId)
    );

    const pending = await admin.request(
      "/api/admin/jobs?status=pending_review"
    );
    assert.equal(pending.status, 200);
    assert.ok(pending.body.jobs.some((job) => job.id === recruiterJobId));

    const jobDetail = await admin.request(
      `/api/admin/jobs/${recruiterJobId}`
    );
    assert.equal(jobDetail.status, 200);
    assert.equal(jobDetail.body.job.id, recruiterJobId);
    assert.equal(jobDetail.body.recruiter.email, "recruiter@test.dev");

    const approve = await admin.request(
      `/api/admin/jobs/${recruiterJobId}/moderate`,
      { method: "POST", body: { action: "approve" } }
    );
    assert.equal(approve.status, 200);
    assert.equal(approve.body.job.status, "published");

    const pause = await admin.request(`/api/admin/jobs/${recruiterJobId}`, {
      method: "PATCH",
      body: { status: "paused" },
    });
    assert.equal(pause.status, 200);
    assert.equal(pause.body.job.status, "paused");

    const resume = await admin.request(`/api/admin/jobs/${recruiterJobId}`, {
      method: "PATCH",
      body: { status: "published" },
    });
    assert.equal(resume.status, 200);
    assert.equal(resume.body.job.status, "published");

    const published = await seeker.request(`/api/jobs/${recruiterJobId}`);
    assert.equal(published.status, 200);
    assert.equal(published.body.job.title, "Senior Product Designer, Platform");

    const apply = await seeker.request(`/api/jobs/${recruiterJobId}/apply`, {
      method: "POST",
      body: { coverLetter: "Excited about this role." },
    });
    assert.equal(apply.status, 201);

    const recruiterApps = await recruiter.request(
      "/api/recruiter/applications"
    );
    assert.equal(recruiterApps.status, 200);
    assert.equal(recruiterApps.body.applications.length, 1);
    recruiterApplicationId = recruiterApps.body.applications[0].id;
    assert.equal(
      recruiterApps.body.applications[0].candidate.email,
      "seeker@test.dev"
    );

    const move = await recruiter.request(
      `/api/recruiter/applications/${recruiterApplicationId}`,
      { method: "PATCH", body: { status: "shortlisted", note: "Great portfolio." } }
    );
    assert.equal(move.status, 200);
    assert.equal(move.body.application.status, "shortlisted");

    const seekerApp = await seeker.request(
      `/api/applications/${apply.body.application.id}`
    );
    assert.equal(seekerApp.status, 200);
    assert.equal(seekerApp.body.application.status, "shortlisted");

    const candidate = await recruiter.request(
      `/api/recruiter/candidates/${seekerUserId}`
    );
    assert.equal(candidate.status, 200);
    assert.equal(candidate.body.candidate.email, "seeker@test.dev");

    const adminApplications = await admin.request(
      "/api/admin/applications?status=shortlisted"
    );
    assert.equal(adminApplications.status, 200);
    assert.ok(
      adminApplications.body.applications.some(
        (application) => application.id === recruiterApplicationId
      )
    );

    const notifications = await seeker.request("/api/notifications");
    assert.equal(notifications.status, 200);
    assert.ok(
      notifications.body.notifications.some(
        (notification) => notification.type === "application_status"
      )
    );

    const firstNotification = notifications.body.notifications[0];
    const read = await seeker.request(
      `/api/notifications/${firstNotification.id}/read`,
      { method: "POST" }
    );
    assert.equal(read.status, 200);
    assert.equal(read.body.notification.read, true);

    const unread = await seeker.request(
      `/api/notifications/${firstNotification.id}/unread`,
      { method: "POST" }
    );
    assert.equal(unread.status, 200);
    assert.equal(unread.body.notification.read, false);

    const payments = await admin.request("/api/admin/payments");
    assert.equal(payments.status, 200);
    assert.ok(payments.body.payments.length >= 1);
    paymentId = payments.body.payments[0].id;

    const paymentDetail = await admin.request(
      `/api/admin/payments/${paymentId}`
    );
    assert.equal(paymentDetail.status, 200);
    assert.equal(paymentDetail.body.payment.id, paymentId);
    assert.ok(paymentDetail.body.invoice);

    const invoices = await admin.request("/api/admin/invoices");
    assert.equal(invoices.status, 200);
    assert.ok(invoices.body.invoices.length >= 1);

    const refund = await admin.request(
      `/api/admin/payments/${paymentId}/refund`,
      { method: "POST" }
    );
    assert.equal(refund.status, 200);
    assert.equal(refund.body.payment.status, "refunded");

    const subscriptions = await admin.request("/api/admin/subscriptions");
    assert.equal(subscriptions.status, 200);
    assert.ok(subscriptions.body.subscriptions.length >= 1);
    const subscriptionId = subscriptions.body.subscriptions[0].id;

    const setPastDue = await admin.request(
      `/api/admin/subscriptions/${subscriptionId}`,
      { method: "PATCH", body: { status: "past_due" } }
    );
    assert.equal(setPastDue.status, 200);
    assert.equal(setPastDue.body.subscription.status, "past_due");

    const setActive = await admin.request(
      `/api/admin/subscriptions/${subscriptionId}`,
      { method: "PATCH", body: { status: "active" } }
    );
    assert.equal(setActive.status, 200);
    assert.equal(setActive.body.subscription.status, "active");

    const cancelSubscription = await admin.request(
      `/api/admin/subscriptions/${subscriptionId}/cancel`,
      { method: "POST" }
    );
    assert.equal(cancelSubscription.status, 200);
    assert.equal(cancelSubscription.body.subscription.status, "canceled");

    const companies = await admin.request("/api/admin/companies");
    assert.equal(companies.status, 200);
    assert.ok(companies.body.companies.length >= 6);

    const companyId = companies.body.companies[0].id;
    const verifyCompany = await admin.request(
      `/api/admin/companies/${companyId}`,
      { method: "PATCH", body: { verified: true } }
    );
    assert.equal(verifyCompany.status, 200);
    assert.equal(verifyCompany.body.company.verified, true);

    const analytics = await admin.request("/api/admin/analytics?days=30");
    assert.equal(analytics.status, 200);
    assert.ok(analytics.body.usersByRole.jobSeekers >= 1);

    const meta = await admin.request("/api/admin/meta");
    assert.equal(meta.status, 200);
    assert.ok(meta.body.jobStatuses.includes("published"));

    const disposable = ctx.client();
    const extraSignUp = await disposable.request("/api/auth/sign-up", {
      method: "POST",
      body: {
        name: "Disposable User",
        email: "disposable@test.dev",
        password: "Password789!",
      },
    });
    assert.equal(extraSignUp.status, 201);
    const disposableId = extraSignUp.body.user.id;

    const suspend = await admin.request(`/api/admin/users/${disposableId}`, {
      method: "PATCH",
      body: { status: "suspended" },
    });
    assert.equal(suspend.status, 200);
    assert.equal(suspend.body.user.status, "suspended");

    const blockedSignIn = await disposable.request("/api/auth/sign-in", {
      method: "POST",
      body: { email: "disposable@test.dev", password: "Password789!" },
    });
    assert.equal(blockedSignIn.status, 403);
    assert.equal(blockedSignIn.body.error.code, "ACCOUNT_SUSPENDED");

    const reactivate = await admin.request(
      `/api/admin/users/${disposableId}`,
      { method: "PATCH", body: { status: "active" } }
    );
    assert.equal(reactivate.status, 200);
    assert.equal(reactivate.body.user.status, "active");

    const deleteUser = await admin.request(
      `/api/admin/users/${disposableId}`,
      { method: "DELETE" }
    );
    assert.equal(deleteUser.status, 200);
    assert.equal(deleteUser.body.deletedUserId, disposableId);

    const selfSuspend = await admin.request(
      `/api/admin/users/${signIn.body.user.id}`,
      { method: "PATCH", body: { status: "suspended" } }
    );
    assert.equal(selfSuspend.status, 400);
    assert.equal(selfSuspend.body.error.code, "CANNOT_MODIFY_SELF");

    const forbidden = await recruiter.request("/api/admin/dashboard");
    assert.equal(forbidden.status, 403);
  });

  await t.test("rejects unauthenticated and unknown requests", async () => {
    const anonymous = ctx.client();
    const apply = await anonymous.request(
      `/api/jobs/${seekerJobId}/apply`,
      { method: "POST", body: {} }
    );
    assert.equal(apply.status, 401);

    const missing = await anonymous.request("/api/does-not-exist");
    assert.equal(missing.status, 404);
    assert.equal(missing.body.error.code, "NOT_FOUND");
  });
});
