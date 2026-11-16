# HireLoop API Reference

Base URL: `http://localhost:5000`

All request and response bodies are JSON unless noted. Authentication uses the
session cookie set by `/api/auth/sign-up` or `/api/auth/sign-in`; browser clients
must send `credentials: "include"`.

## Roles

| Role | Value | Access |
| --- | --- | --- |
| Job seeker | `job_seeker` | Default sign-up role; seeker dashboard and actions |
| Recruiter | `recruiter` | Recruiter sign-up role; company and job management |
| Admin | `admin` | Seed/database only; platform management |

Endpoints marked **signed in** accept any active role. Role-protected endpoints
return `403 FORBIDDEN` for the wrong role. Suspended or deactivated accounts are
rejected by the auth middleware.

## Errors

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Enter a valid email address.",
    "field": "email"
  }
}
```

`field` is present for validation errors. Common status codes:

| Status | Meaning |
| --- | --- |
| `400` | Validation error or invalid state transition |
| `401` | Not signed in, invalid credentials, or invalid session |
| `403` | Wrong role, private profile, or forbidden origin |
| `404` | Resource not found or not visible to the current user |
| `409` | Conflict such as duplicate email, already applied, or invalid transition |
| `429` | Rate limit exceeded |

## Pagination

List endpoints accept `page` (default `1`) and `limit` (default `20`, maximum
`100` unless noted). Responses include:

```json
{
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 42,
    "totalPages": 3,
    "hasPrev": false,
    "hasNext": true
  }
}
```

## Service

### `GET /`

Returns service metadata and top-level endpoint groups.

### `GET /health`

```json
{
  "status": "ok",
  "store": "json",
  "version": "1.0.0",
  "uptime": 120
}
```

### `GET /api`

Lists route group prefixes.

---

## Auth

### `POST /api/auth/sign-up`

Public. Creates an account and starts a session.

```json
{
  "name": "Ada Lovelace",
  "email": "ada@example.com",
  "password": "password123",
  "role": "job_seeker"
}
```

`role` is optional and accepts `job_seeker` or `recruiter`. Returns `201` with
`{ user }`. A `Set-Cookie` session cookie is included.

### `POST /api/auth/sign-in`

Public.

```json
{ "email": "ada@example.com", "password": "password123" }
```

Returns `{ user }` and starts a session. Invalid credentials return
`401 INVALID_CREDENTIALS`.

### `POST /api/auth/sign-out`

Public. Deletes the current session and clears the cookie. Returns `{ ok: true }`.

### `GET /api/auth/me`

Signed in. Returns `{ user }` with unread notification count and a profile
summary. Returns `401` without a valid session.

### `PATCH /api/auth/me`

Signed in. Updates the account name.

```json
{ "name": "Ada Byron" }
```

### `POST /api/auth/change-password`

Signed in. Verifies the current password, invalidates all other sessions, and
starts a new session.

```json
{
  "currentPassword": "password123",
  "newPassword": "password456"
}
```

### `POST /api/auth/change-email`

Signed in. Requires the current password.

```json
{ "email": "new@example.com", "currentPassword": "password123" }
```

### `POST /api/auth/forgot-password`

Public. Always returns a generic success message. In non-production, when
`EXPOSE_RESET_TOKENS=true`, the response also includes `resetToken`,
`expiresAt`, and `resetUrl`.

```json
{ "email": "ada@example.com" }
```

### `POST /api/auth/reset-password`

Public. Consumes a reset token, updates the password, invalidates sessions, and
sends a notification.

```json
{ "token": "<reset-token>", "password": "password456" }
```

### `DELETE /api/auth/me`

Signed in. Deactivates the account and clears the session.

---

## Jobs

### `GET /api/jobs`

Public. Published jobs only.

Query parameters:

| Name | Type | Notes |
| --- | --- | --- |
| `q` | string | Keyword search |
| `types` / `type` | comma list | `full-time`, `contract`, `freelance` |
| `workplace` | comma list | `remote`, `hybrid`, `on-site` |
| `level` | string | Experience level |
| `remote` | boolean | `true` / `false` |
| `minSalary` | number | Minimum salary |
| `maxSalary` | number | Maximum salary |
| `postedWithinDays` | number | Recency filter |
| `sort` | string | `recent`, `oldest`, `salary-desc`, `salary-asc`, `title`, `views` |
| `page` / `limit` | number | `limit` defaults to 4, maximum 50 |

Returns `{ jobs, pagination, filters }` where `filters.types` contains counts per
job type.

### `GET /api/jobs/saved`

Job seeker. Saved jobs in the same `{ savedJobs, pagination }` shape as
`/api/saved-jobs`, where each row is `{ id, savedAt, job }`.

### `GET /api/jobs/:id`

Public, with optional auth. Returns `{ job, similarJobs, hasApplied, hasSaved }`.
Non-published jobs return `404`.

### `POST /api/jobs/:id/apply`

Job seeker. Applies to a published job. Body fields are optional except the job
ID comes from the path:

```json
{
  "coverLetter": "I would love to join the team.",
  "resumeUrl": "https://example.com/resume.pdf",
  "availability": "2 weeks",
  "expectedSalary": 120000
}
```

Returns `201` with `{ application }`. Duplicate applications return
`409 ALREADY_APPLIED`; closed deadlines return `409 JOB_CLOSED`.

### `POST /api/jobs/:id/save`

Job seeker. Saves a published job. Returns `201` when created, `200` when it was
already saved. Response: `{ saved: true, jobId, alreadySaved }`.

### `DELETE /api/jobs/:id/save`

Job seeker. Response: `{ saved: false, jobId, removed }`.

### `GET /api/jobs/:id/similar`

Public. Query: `limit` (1-12, default 3). Returns `{ jobs }`.

### `GET /api/jobs/:id/preview`

Signed in. Returns `{ job }` for any job status. Only the recruiter who created
the job or an admin may preview it; other users receive `404`.

---

## Saved jobs

All endpoints require a job seeker account.

### `GET /api/saved-jobs`

Query: `page`, `limit`. Returns rows as `{ id, savedAt, jobId, job }`.

### `GET /api/saved-jobs/ids`

Returns `{ jobIds }` for quick saved-state checks.

### `POST /api/saved-jobs`

```json
{ "jobId": "job-id" }
```

Returns `201` on creation or `200` if already saved.

### `DELETE /api/saved-jobs/:jobId`

Response: `{ saved: false, jobId, removed }`.

---

## Applications

All endpoints require a job seeker account.

### `GET /api/applications`

Query: `status`, `page`, `limit`. Returns `{ applications, pagination, counts,
statusBreakdown, activeCount }`.

### `POST /api/applications`

Alternative to `POST /api/jobs/:id/apply`.

```json
{
  "jobId": "job-id",
  "coverLetter": "Optional",
  "resumeUrl": "https://example.com/resume.pdf",
  "availability": "2 weeks",
  "expectedSalary": 120000
}
```

### `GET /api/applications/:id`

Returns `{ application }` for the signed-in applicant.

### `POST /api/applications/:id/withdraw`

```json
{ "note": "Accepted another role." }
```

Returns `{ application }` with status `withdrawn`. Statuses that can no longer
be withdrawn return `409 APPLICATION_NOT_WITHDRAWABLE`.

---

## Profile

### `GET /api/profile`

Signed in. Returns `{ profile }`, including completeness and all profile fields.

### `PATCH /api/profile`

Signed in. Accepts any subset of:

`name`, `headline`, `bio`, `location`, `phone`, `website`, `linkedin`, `github`,
`avatarUrl`, `skills`, `jobTypes`, `workplacePreference`, `expectedSalary`,
`availability`, `profileVisibility`, `experience`, `education`, `resume`.

`experience` is a list of `{ title, company, location, startDate, endDate,
current, description }`. `education` is a list of `{ school, degree, field,
startDate, endDate }`. `resume` is `{ fileName, url }` or `null`.

### `PUT /api/profile/resume`

```json
{ "fileName": "resume.pdf", "url": "https://example.com/resume.pdf" }
```

### `DELETE /api/profile/resume`

Removes the resume.

### `GET /api/profile/:userId`

Signed in. Admins and recruiters can view other profiles; job seekers can only
view their own. Private profiles return `403 PROFILE_PRIVATE` unless requested
by an admin.

---

## Settings

### `GET /api/settings`

Signed in. Returns the notification, privacy, and appearance settings.

### `PATCH /api/settings`

Signed in. Accepts any subset:

```json
{
  "notifications": {
    "jobAlerts": true,
    "applicationUpdates": true,
    "weeklyDigest": false,
    "productNews": false,
    "email": true,
    "push": false
  },
  "privacy": {
    "showSalary": true,
    "allowRecruiterMessages": true,
    "profileVisibility": "public"
  },
  "appearance": { "theme": "system" }
}
```

`profileVisibility` accepts `public`, `recruiters`, or `private`. Theme accepts
`light`, `dark`, or `system`.

### `DELETE /api/settings/account`

Signed in. Deactivates the account and clears the session.

---

## Plans

### `GET /api/plans`

Public. Query: `currency` (`USD` or `BDT`, default `USD`) and `interval`
(`monthly` or `yearly`, default `monthly`).

Returns `{ plans, exchangeRate, currency, interval }`.

### `GET /api/plans/:id`

Public. Returns `{ plan, exchangeRate, currency, interval }`.

Plan IDs: `starter`, `growth`, `pro`, `premium`.

---

## Checkout

Sandbox only. The demo card `pm_card_visa` is the only accepted payment method.

### `POST /api/checkout`

Public or signed in. When signed in, the payment is linked to the account and
creates or updates its subscription.

```json
{
  "planId": "growth",
  "currency": "USD",
  "interval": "monthly",
  "email": "ada@example.com",
  "name": "Ada Lovelace",
  "country": "United States",
  "paymentMethod": "pm_card_visa",
  "saveInfo": true
}
```

`currency` accepts `USD` or `BDT`. `interval` is optional and defaults to
`monthly`. Returns `201` with `{ session }`; the session includes `sessionId`,
plan details, amount, status `succeeded`, and card metadata.

### `GET /api/checkout/:sessionId`

Public. Returns `{ session }` for a checkout session.

---

## Companies

### `GET /api/companies`

Public. Query: `q`, `page`, `limit`. Returns `{ companies, pagination }` with job
counts.

### `GET /api/companies/:id`

Public. Returns `{ company, jobs, reviews, similarCompanies }`.

### `GET /api/companies/:id/jobs`

Public. Query: `page`, `limit` (maximum 50). Returns `{ jobs, pagination }`.

### `GET /api/companies/:id/reviews`

Public. Returns `{ reviews, rating, reviewsCount }`.

---

## Billing

All endpoints require a signed-in account.

### `GET /api/billing`

Returns `{ subscription, plan, nextPayment, paymentMethods, invoices, payments,
subscriptions }`.

### `GET /api/billing/invoices`

Query: `page`, `limit`.

### `GET /api/billing/invoices/:id`

Returns `{ invoice }` with a `downloadUrl`.

### `GET /api/billing/invoices/:id/download`

Returns printable HTML (`text/html`) for the invoice.

### `GET /api/billing/payments`

Query: `page`, `limit`.

### `POST /api/billing/change-plan`

```json
{ "planId": "pro", "interval": "yearly" }
```

Switching to `starter` cancels the active paid subscription. Other plans must
have checkout enabled. Returns `{ subscription, plan, message }`.

### `POST /api/billing/cancel`

Schedules cancellation at the end of the current period
(`cancelAtPeriodEnd: true`).

### `POST /api/billing/resume`

Clears a scheduled cancellation.

### `POST /api/billing/payment-method`

Adds or replaces the sandbox card on the latest subscription. All fields are
optional and default to a demo Visa.

```json
{
  "brand": "visa",
  "last4": "4242",
  "expMonth": 12,
  "expYear": 2032,
  "name": "Ada Lovelace"
}
```

Returns `{ paymentMethod, subscription }`.

### `DELETE /api/billing/payment-method`

Removes the payment method from the latest subscription.

---

## Notifications

All endpoints require a signed-in account.

### `GET /api/notifications`

Query: `unread=true` (or `unreadOnly=true`), `page`, `limit`. Returns
`{ notifications, pagination, unreadCount }`.

### `GET /api/notifications/unread-count`

Returns `{ count }`.

### `POST /api/notifications/read-all`

Marks all notifications read. Returns `{ ok: true, updated }`.

### `POST /api/notifications/:id/read`

Marks one notification read. Returns `{ notification }`.

### `POST /api/notifications/:id/unread`

Marks one notification unread.

### `DELETE /api/notifications/:id`

Deletes one notification.

---

## Seeker dashboard

All endpoints require a job seeker account.

| Endpoint | Response |
| --- | --- |
| `GET /api/dashboard` | Full dashboard: `stats`, `recommendedJobs`, `savedJobs`, recent activity |
| `GET /api/dashboard/stats` | `{ stats }` |
| `GET /api/dashboard/recommended-jobs` | `{ jobs }` |
| `GET /api/dashboard/recommended` | Alias for recommended jobs |
| `GET /api/dashboard/saved-jobs` | `{ jobs }` (up to 4 saved jobs) |

---

## Recruiter

All endpoints require a `recruiter` account.

### Dashboard

| Endpoint | Response |
| --- | --- |
| `GET /api/recruiter/dashboard` | Stats, company, recent jobs/applications |
| `GET /api/recruiter/analytics?days=30` | Time-series analytics and totals |

### Company profile

| Endpoint | Notes |
| --- | --- |
| `GET /api/recruiter/company` | `{ company, complete }`; `company` is `null` until created |
| `POST /api/recruiter/company` | Creates the company profile; returns `201` |
| `PATCH /api/recruiter/company` | Partial update |

Company fields: `name`, `industry`, `size`, `location`, `about` (required on
create), plus optional `phone`, `logo`, `coverImage`, `website`, `email`,
`founded`, `benefits`, `gallery`, `socials`.

### Jobs

| Endpoint | Notes |
| --- | --- |
| `GET /api/recruiter/jobs` | Query: `q`, `status`, `sort`, `page`, `limit`; returns `{ jobs, pagination, counts }` |
| `POST /api/recruiter/jobs` | Create a job; requires a company profile |
| `GET /api/recruiter/jobs/:id` | Job detail with application count |
| `PATCH /api/recruiter/jobs/:id` | Partial update; rejected jobs return to review |
| `DELETE /api/recruiter/jobs/:id` | Deletes the job, its applications, and saved references |
| `POST /api/recruiter/jobs/:id/duplicate` | Creates a draft copy titled `(Copy)` |

Create body:

```json
{
  "title": "Senior Product Designer",
  "type": "full-time",
  "workplace": "remote",
  "location": "Remote (US)",
  "level": "Senior",
  "experience": "5+ Years",
  "salaryMin": 140000,
  "salaryMax": 180000,
  "salaryPeriod": "year",
  "description": "At least 30 characters describing the role.",
  "summary": "Shown on job cards.",
  "responsibilities": ["Own a product area."],
  "skills": ["Figma", "Design Systems"],
  "requirements": ["5+ years of experience."],
  "benefits": ["Remote-first team"],
  "tags": ["Full-time", "Remote"],
  "positions": 1,
  "easyApply": true,
  "hot": false,
  "deadline": "2027-01-31T00:00:00.000Z",
  "status": "pending_review"
}
```

`type`: `full-time`, `contract`, `freelance`.
`workplace`: `remote`, `hybrid`, `on-site`.
`salaryPeriod`: `year`, `month`, `hour`.
`status`: `draft` or `pending_review` (default).

Status actions:

| Endpoint | Allowed current status | Result |
| --- | --- | --- |
| `POST /api/recruiter/jobs/:id/submit` | `draft`, `rejected`, `closed` | `pending_review` |
| `POST /api/recruiter/jobs/:id/pause` | `published` | `paused` |
| `POST /api/recruiter/jobs/:id/resume` | `paused` | `published` |
| `POST /api/recruiter/jobs/:id/close` | `published`, `paused`, `draft`, `pending_review` | `closed` |

Invalid transitions return `409 INVALID_JOB_TRANSITION`.

### Applicants

| Endpoint | Notes |
| --- | --- |
| `GET /api/recruiter/applications` | Query: `status`, `jobId`, `q`, `page`, `limit`; returns applications, counts, breakdown, and job list |
| `GET /api/recruiter/applications/:id` | Application with candidate and job |
| `PATCH /api/recruiter/applications/:id` | Update pipeline status and notes |
| `GET /api/recruiter/candidates/:id` | Candidate profile, only if they applied to one of your jobs |

Update body:

```json
{
  "status": "shortlisted",
  "note": "Great portfolio.",
  "recruiterNotes": "Internal note for the hiring team."
}
```

Allowed recruiter statuses: `in_review`, `shortlisted`, `interview`, `offer`,
`hired`, `rejected`.

---

## Admin

All endpoints require an `admin` account.

### Dashboard and metadata

| Endpoint | Notes |
| --- | --- |
| `GET /api/admin/dashboard` | Platform stats and revenue trend |
| `GET /api/admin/analytics?days=30` | Users, jobs, applications, and revenue analytics |
| `GET /api/admin/meta` | Roles, user/job/application/payment/subscription statuses |

### Users

| Endpoint | Notes |
| --- | --- |
| `GET /api/admin/users` | Query: `role`, `status`, `q`, `page`, `limit`; returns users, pagination, role/status counts |
| `GET /api/admin/users/:id` | User, profile, company, subscription, and activity counts |
| `PATCH /api/admin/users/:id` | Update `role` or `status` |
| `DELETE /api/admin/users/:id` | Deletes the user and related data |

`PATCH` body examples:

```json
{ "status": "suspended" }
{ "role": "recruiter" }
```

Admins cannot change their own role or deactivate/delete their own account.
Suspending a user deletes their sessions.

### Jobs

| Endpoint | Notes |
| --- | --- |
| `GET /api/admin/jobs` | Query: `q`, `status`, `source`, `companyId`, `sort`, `page`, `limit`; returns jobs, pagination, counts |
| `GET /api/admin/jobs/:id` | Job, recruiter, and application count |
| `POST /api/admin/jobs/:id/moderate` | Approve or reject a job |
| `PATCH /api/admin/jobs/:id` | Set any job status |
| `DELETE /api/admin/jobs/:id` | Delete the job and related applications/saves |

Moderation body:

```json
{ "action": "approve" }
{ "action": "reject", "reason": "Does not meet our posting guidelines." }
```

`approve` publishes the job. `reject` requires a reason of at least 3
characters. Direct status updates use:

```json
{ "status": "paused", "reason": "Optional unless rejected." }
```

### Applications

`GET /api/admin/applications` supports `status`, `jobId`, `q`, `page`, `limit`
and returns `{ applications, pagination, counts }`.

### Companies

| Endpoint | Notes |
| --- | --- |
| `GET /api/admin/companies` | Query: `q`, `page`, `limit`; includes job counts and owner |
| `PATCH /api/admin/companies/:id` | Update verification |

```json
{ "verified": true }
```

### Payments, invoices, and subscriptions

| Endpoint | Notes |
| --- | --- |
| `GET /api/admin/payments` | Query: `status`, `planId`, `q`, `page`, `limit`; includes revenue summary |
| `GET /api/admin/payments/:id` | Payment, invoice, and user |
| `POST /api/admin/payments/:id/refund` | Refunds a succeeded payment and its invoice |
| `GET /api/admin/invoices` | Query: `page`, `limit` |
| `GET /api/admin/subscriptions` | Query: `status`, `planId`, `page`, `limit` |
| `PATCH /api/admin/subscriptions/:id` | Update subscription status |
| `POST /api/admin/subscriptions/:id/cancel` | Cancel immediately and notify the subscriber |

Subscription statuses: `active`, `canceled`, `past_due`, `expired`.
