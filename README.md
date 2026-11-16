# HireLoop API

Express 5 API for the HireLoop job platform. It serves the public job board and
checkout flow, the job seeker dashboard, the recruiter workspace, and the admin
console.

The API can run against MongoDB or a local JSON file, and the same client
contracts work with either driver.

## Features

### Public

- Job search with keyword, type, workplace, level, salary, recency, and sort filters
- Job detail pages with similar jobs, saved/applied state, and company profiles
- Company directory, company jobs, and company reviews
- Plan catalogue in USD or BDT, monthly or yearly
- Sandbox checkout (`pm_card_visa` only) that creates a payment, subscription,
  invoice, and billing notification

### Job seeker

- Email/password accounts with sessions, password reset, email change, and
  account deactivation
- Profile editor (headline, bio, skills, experience, education, links, resume)
- Saved jobs, job applications, application withdrawal, and status tracking
- Seeker dashboard with stats, recommendations, and saved jobs
- Billing: subscription details, invoices, invoice download, payment methods,
  plan changes, cancel, and resume
- Notification centre with unread counts and read state
- Settings for notifications, privacy, and appearance

### Recruiter

- Recruiter sign-up and company profile management
- Job posting, editing, duplication, submission, pause/resume, and close
- Moderation workflow: new jobs are `pending_review` until an admin approves
  them
- Applicant pipeline with status transitions, notes, filtering, and search
- Candidate profiles for applicants to the recruiter's jobs
- Recruiter dashboard and analytics

### Admin

- Platform dashboard and analytics
- User management (role, status, suspend/reactivate, delete)
- Job moderation (approve/reject) and direct status changes
- Company directory and verification
- Payment list/detail/refund, invoices, and subscription management
- Admin metadata endpoint for status/role options

Seeded admin accounts can only be created through seeding or the database; the
public sign-up endpoint accepts `job_seeker` and `recruiter` roles only.

## Quick start

```bash
npm install
cp .env.example .env
npm run dev
```

The API listens on `http://localhost:5000` by default. The client is expected at
`http://localhost:3000`; both are allowed by the default CORS configuration.

By default, outside production and test, the server seeds base content plus demo
users, companies, jobs, applications, billing, and notifications. Set
`SEED_DEMO_DATA=false` to seed only the base catalogue.

### Demo accounts

All demo accounts use the password `Hireloop123!`.

| Role      | Email                  |
| --------- | ---------------------- |
| Job seeker| `seeker@hireloop.dev`  |
| Recruiter | `recruiter@hireloop.dev` |
| Admin     | `admin@hireloop.dev`   |

Demo seeding is idempotent: existing records are reused when the server starts
again.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `5000` | HTTP port |
| `NODE_ENV` | `development` | Enables production defaults |
| `API_VERSION` | `1.0.0` | Version shown by `/` and `/health` |
| `CLIENT_ORIGIN` | `http://localhost:3000,http://127.0.0.1:3000` | Allowed CORS origins |
| `SESSION_DAYS` | `7` | Session lifetime in days |
| `SESSION_COOKIE_NAME` | `hireloop_session` | Session cookie name |
| `COOKIE_SECURE` | `true` in production | Send cookie over HTTPS only |
| `TRUST_PROXY` | disabled | Express `trust proxy` value |
| `MONGODB_URI` | empty | Use MongoDB when set |
| `MONGODB_DB` | `hireloop` | MongoDB database name |
| `DEV_STORE_PATH` | `data/store.json` | JSON store location |
| `SEED_DEMO_DATA` | `true` outside production/test | Seed demo content |
| `EXPOSE_RESET_TOKENS` | `true` outside production | Return reset tokens in API responses |
| `PASSWORD_RESET_MINUTES` | `30` | Reset token lifetime |
| `RATE_LIMIT_ENABLED` | `true` outside test | Enable in-memory rate limits |
| `REQUEST_LOGGING` | `true` outside test | Structured request logs |

### Storage

- If `MONGODB_URI` is set, data is stored in MongoDB (`MONGODB_DB`).
- If it is empty, the API uses a JSON file at `DEV_STORE_PATH`.
- The JSON store is intended for local development and tests. It serialises
  writes and keeps data across restarts.

Both drivers implement the same store interface, so routes and services do not
depend on the active database.

## API

The full endpoint reference is in [`docs/API.md`](docs/API.md). A summary:

| Area | Prefix | Access |
| --- | --- | --- |
| Auth | `/api/auth` | Public / signed in |
| Jobs | `/api/jobs` | Public, with authenticated save/apply actions |
| Companies | `/api/companies` | Public |
| Plans | `/api/plans` | Public |
| Checkout | `/api/checkout` | Public or signed in |
| Saved jobs | `/api/saved-jobs` | Job seeker |
| Applications | `/api/applications` | Job seeker |
| Profile | `/api/profile` | Signed in |
| Settings | `/api/settings` | Signed in |
| Billing | `/api/billing` | Signed in |
| Notifications | `/api/notifications` | Signed in |
| Seeker dashboard | `/api/dashboard` | Job seeker |
| Recruiter | `/api/recruiter` | Recruiter |
| Admin | `/api/admin` | Admin |

`GET /` returns service metadata, `GET /health` returns status and the active
store, and `GET /api` lists the top-level route groups.

### Conventions

- Requests and responses are JSON. The exception is invoice download, which
  returns printable HTML.
- Authentication uses an `HttpOnly`, `SameSite=Lax` session cookie. Enable
  credentials on the client (`credentials: "include"`).
- The error shape is consistent:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Enter a valid email address.",
    "field": "email"
  }
}
```

- List endpoints use `page` and `limit` and return a `pagination` object with
  `page`, `limit`, `total`, `totalPages`, `hasPrev`, and `hasNext`.
- All timestamps are ISO 8601 strings.

## Tests

```bash
npm test
```

The test suite uses Node's built-in test runner (`node --test`) and an isolated
temporary JSON store. It covers the public catalogue, auth and password reset,
the job seeker journey, sandbox checkout and billing, the recruiter journey,
admin moderation, and error handling.

## Project layout

```text
index.js              startup, seeding, graceful shutdown
src/app.js            Express app, CORS, security headers, routers
src/config.js         environment configuration
src/auth/             passwords, sessions, auth middleware, auth routes
src/data/             plans, companies, jobs, reviews, demo seed data
src/lib/              constants, validation, serializers, dates, cookies
src/middleware/       error handling, rate limiting, request logging
src/services/         jobs, applications, billing, dashboards, profiles
src/store/            JSON and MongoDB stores with a shared interface
src/<domain>/         feature routers
test/api.test.js      end-to-end API tests
docs/API.md           endpoint reference
```

## Production notes

Before deploying:

- Set `NODE_ENV=production`, `COOKIE_SECURE=true`, and a real HTTPS origin.
- Set `EXPOSE_RESET_TOKENS=false` and deliver reset links by email.
- Set `SEED_DEMO_DATA=false`; keep only intentional base content.
- Configure a shared rate limiter if you run more than one instance (the
  built-in limiter is in-memory).
- Use MongoDB rather than the JSON store.
- Review the CORS allowlist, log retention, and backup policy.
