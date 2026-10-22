# QuickChat

QuickChat is a small one-to-one text messaging application built as an npm-workspaces TypeScript monorepo. The current local implementation includes OTP sign-in, PostgreSQL-backed sessions, user discovery, direct conversations, paginated history, Socket.IO messaging, and in-memory online presence.

## Architecture

- `apps/web`: Next.js App Router, React, Bootstrap 5, Zustand, and Socket.IO client.
- `apps/api`: NestJS HTTP API and Socket.IO gateway.
- `packages/shared`: shared TypeScript package.
- PostgreSQL is the only application database. Drizzle ORM owns schema definitions and migration commands.

OTP verification creates or retrieves a user by normalized E.164 phone number, consumes a one-time OTP challenge, then creates a random server-side session. Only a SHA-256 hash of the opaque session token is persisted. The browser receives it in an HTTP-only cookie. The API checks the session on each protected HTTP request and each Socket.IO event. Messages are committed to PostgreSQL before the gateway emits `message:new` to the authorized conversation room. On reconnect, the client reloads history from PostgreSQL.

Conversation pairs are stored as UUID-sorted `user_a_id` and `user_b_id`; a database check and unique index enforce ordered, distinct pairs. The schema also defines client message idempotency and indexes for conversation history. Presence tracks multiple sockets per user in the API process. It is not shared between multiple API instances.

## Windows local setup

Use PowerShell in the repository root. If the machine's PowerShell execution policy blocks `npm.ps1`, invoke `npm.cmd` as shown below.

1. Install Node.js 20+ and Docker Desktop, then copy the environment template:

   ```powershell
   Copy-Item .env.example .env
   ```

2. Replace `POSTGRES_PASSWORD` and its matching password in `DATABASE_URL`. Set `OTP_HMAC_SECRET` to a unique random value of at least 32 characters. For example, generate one with:

   ```powershell
   node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
   ```

3. Install workspace dependencies:

   ```powershell
   npm.cmd install
   ```

4. Start PostgreSQL. Compose binds it only to loopback host port 5433 and keeps its data in the `postgres_data` volume:

   ```powershell
   docker compose up -d postgres
   docker compose ps
   ```

5. Inspect the database's existing `__drizzle_migrations` ledger before applying migrations. Generate migrations from schema edits with `npm.cmd run db:generate`; apply reviewed migrations with `npm.cmd run db:migrate`. Do not generate a replacement baseline or drop the database to repair migration history. The current checkout's migration directory was empty when audited; the database container was unavailable, so migration state could not be checked. Restore the expected migration history or safely establish a baseline against a known-empty database before running the API.

6. Run the API and web application in separate PowerShell windows:

   ```powershell
   npm.cmd run dev:api
   npm.cmd run dev:web
   ```

7. Visit <http://localhost:3000>. The API health/readiness endpoint is <http://localhost:4000/api/v1/health>.

The development SMS provider does not send a real text. It returns the code only to the local development UI/API response. It is rejected in production. For real delivery configure Twilio as described below.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `POSTGRES_PASSWORD` | Local Compose database password. |
| `DATABASE_URL` | PostgreSQL connection string; locally use host port `5433`. |
| `WEB_ORIGIN` | Exact allowed browser origin and cookie-authenticated request origin. |
| `API_PORT` | API listen port (default `4000`). |
| `NODE_ENV` | Use `development` locally and `production` in production. |
| `COOKIE_SAME_SITE` | `lax` locally; production may use `none` when frontend and API are cross-site. `none` requires HTTPS. |
| `OTP_HMAC_SECRET` | Independent random secret (at least 32 characters) used to store OTP verifiers. |
| `OTP_TTL_MINUTES` | OTP validity (default 5). |
| `OTP_RESEND_COOLDOWN_SECONDS` | Per-number challenge cooldown (default 60). |
| `OTP_MAX_ATTEMPTS` | Attempts allowed for one challenge (default 5). |
| `SESSION_TTL_HOURS` | Server-side session lifetime (default 168). |
| `SMS_PROVIDER` | `mock` only in development; `twilio` in production. |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` | Secret and sender configuration for production Twilio SMS. |
| `NEXT_PUBLIC_API_BASE_URL` | Optional API base URL, default `http://localhost:4000/api/v1`. |

Never put real credentials in `.env.example`, commit `.env`, expose session tokens to JavaScript, or use the mock provider in production. Production startup validates the database URL, OTP key, and Twilio configuration.

## HTTP API

All routes are prefixed by `/api/v1`. JSON errors use NestJS status codes and messages. Browser calls must send credentials; the frontend API client does this. Cookie-authenticated protected requests check the configured `Origin` when present.

| Method and route | Auth | Request / response |
| --- | --- | --- |
| `GET /health` | No | Checks PostgreSQL with `SELECT 1`; returns `{ "status": "ok", "database": "ok" }`. |
| `POST /auth/request-otp` | No | `{ "mobileNumber": "+14155550123" }`; returns a generic request message, with a development-only OTP field in development/mock mode. Returns 429 when throttled. |
| `POST /auth/verify-otp` | No | `{ "mobileNumber": "+14155550123", "otp": "123456" }`; sets `quickchat_session` as an HTTP-only cookie and returns safe user data. Invalid/expired codes return 401. |
| `GET /auth/me` | Cookie optional | Returns `{ authenticated, user? }`; the cookie is never returned. |
| `POST /auth/logout` | Cookie optional | Revokes the current session and clears the cookie. |
| `GET /users?q=...` | Session cookie | Finds up to 50 other users by display name or normalized phone number. |
| `GET /conversations` | Session cookie | Lists up to 100 of the current user's conversations with participant and latest message. |
| `POST /conversations` | Session cookie | `{ "userId": "<uuid>" }`; creates or returns the unique one-to-one conversation. Self conversations are rejected. |
| `GET /conversations/:id/messages?limit=30&cursor=...` | Session cookie | Returns up to 100 older messages in stable timestamp/UUID order and a `nextCursor`, or `null`. Cursor is opaque base64url data. |

Phone values are normalized with `libphonenumber-js`. A successful first OTP login registers a regular user; there are no privileged roles. Public user responses omit OTPs, sessions, and internal auth fields.

## Socket.IO (`/chat` namespace)

The socket uses the same HTTP-only cookie as the HTTP API. No browser-stored bearer token is used. Connection origins are restricted to `WEB_ORIGIN`, and the session is rechecked for each event.

| Event | Payload | Result |
| --- | --- | --- |
| `conversation:join` | `{ conversationId }` | Adds the socket to a room only after membership validation. Acknowledges `{ ok, data }` or `{ ok: false, error }`. |
| `conversation:leave` | `{ conversationId }` | Leaves that conversation room. |
| `message:send` | `{ conversationId, clientMessageId, content }` | Validates membership and content (1–4000 chars); writes before broadcast; sender/client ID uniqueness makes retries idempotent. Acknowledges acceptance or a safe error. |
| `message:new` | Server message object | Emitted to members currently subscribed to that conversation after persistence. Fetch history after reconnect to recover missed events. |
| `presence:snapshot` | Array of online user IDs | Initial online users for the current API process. |
| `presence:update` | `{ userId, online }` | Broadcast when a user's first socket connects or last socket disconnects. |

Delivery is persisted-before-broadcast, with at-least-once client retry handled by a unique client message ID. It is not an exactly-once transport guarantee. Current presence is process-local and needs a shared adapter before horizontal API scaling.

## Development, build, and quality commands

```powershell
npm.cmd run build:api
npm.cmd run build:web
npm.cmd run lint --workspace=@chat/web
npm.cmd run db:generate
npm.cmd run db:migrate
npm.cmd run db:studio
```

Run the API controller unit tests with `npm.cmd test --workspace=@chat/api`. The current three tests cover safe cookie-based verification responses, stale-cookie clearing, and normalized-number throttling. There are no PostgreSQL integration, Socket.IO, or frontend interaction tests yet. Integration testing requires a known isolated PostgreSQL test database and restored migration history. Never point tests at a database containing user data.

## Production deployment guide

Use a managed PostgreSQL service with TLS and network restrictions, a persistent Node.js/container host that supports WebSocket upgrades for NestJS, and a Next.js compatible frontend host. Put both behind HTTPS. Do not expose PostgreSQL publicly. The API should be deployed as one instance until presence and Socket.IO room state use a shared adapter.

1. Provision frontend and API DNS names and TLS certificates. Set frontend `NEXT_PUBLIC_API_BASE_URL` to the public API `/api/v1` URL. Set API `WEB_ORIGIN` to the exact HTTPS frontend origin, `API_PORT` to the platform-assigned port, `NODE_ENV=production`, and `COOKIE_SAME_SITE=none` only if browser traffic is cross-site. The API sets `Secure` and `HttpOnly` cookies in production. `deploy/nginx-api.conf.example` shows API, Socket.IO upgrade, and HTTPS proxy headers for a self-managed Nginx deployment; replace its example domain and certificate paths.
2. Create managed PostgreSQL with TLS enabled, a private network allowlist, backups, and a separate least-privilege application user. Supply its TLS-enabled connection string as `DATABASE_URL` through the host's secret manager.
3. Create an OTP HMAC secret of at least 32 random bytes in the secret manager. Configure a Twilio account, approved sender, and `SMS_PROVIDER=twilio`; supply its account SID, auth token, and sender through secrets. Do not copy production values to this repository.
4. Build and deploy the API to a host that supports long-lived WebSocket connections. Configure the platform proxy to forward HTTP and WebSocket upgrades to the same API service and preserve cookies/`Origin`. Use `/api/v1/health` as readiness check. Keep one instance until shared presence and a Socket.IO adapter are implemented.
5. Run reviewed Drizzle migrations as a controlled one-off release step against the production database. Back up first, verify the migration ledger and schema, then deploy the compatible API image. Never use schema push or destructive synchronization in production.
6. Build and deploy the Next.js frontend with the API URL set at build time. Configure frontend/API domains, exact CORS origin, TLS, and cookie policy together.
7. Smoke test OTP delivery, `/auth/me`, logout, user search, conversation creation, a two-browser message exchange, reconnect/history recovery, and online status. Confirm browser cookies are `HttpOnly`, `Secure`, and have the intended SameSite value.

For an Nginx reverse proxy, forward the `Upgrade` and `Connection` headers on the API route and use an idle timeout longer than the Socket.IO ping interval. Keep deployment secrets in the platform manager. Monitor health and error rates without logging phone numbers, OTPs, cookies, or session tokens. Enable managed point-in-time backups and rehearse restoration. For rollback, redeploy the previous API/frontend images; use forward-only corrective migrations unless a reviewed, data-safe down migration exists. Rotate Twilio credentials in the provider and secret manager; rotate the OTP HMAC key with an explicit plan for any still-live OTP challenges.

The API and web Dockerfiles are in `apps/api/Dockerfile` and `apps/web/Dockerfile`. Example image commands are:

```powershell
docker build -f apps/api/Dockerfile --target runtime -t quickchat-api .
docker build -f apps/web/Dockerfile --build-arg NEXT_PUBLIC_API_BASE_URL=https://api.example.com/api/v1 -t quickchat-web .
```

The API Dockerfile's `build` stage can be used as an isolated migration runner after reviewing the migration state:

```powershell
docker build -f apps/api/Dockerfile --target build -t quickchat-migrations .
docker run --rm --env-file .env quickchat-migrations npm run db:migrate --workspace=@chat/api
```

These Docker images and proxy configuration could not be built or exercised locally because the Docker engine was unavailable during this audit. No public deployment or paid resource has been created.

## Troubleshooting and known limitations

- If PowerShell blocks `npm.ps1`, use `npm.cmd` commands.
- PostgreSQL Compose binds host `127.0.0.1:5433`; update `DATABASE_URL` if that port is changed.
- `GET /api/v1/health` requires PostgreSQL to be reachable.
- Login request throttles are in-memory and are not shared across API instances; add a shared rate-limit store before scaling.
- The migration folder in this audited checkout was empty and the local Docker daemon was unavailable. Establish the actual database ledger before applying schema changes; the current database/migration status is not verified.
- There is no display-name editing flow, automated test suite, shared presence adapter, or selected real SMS credentials. These remain follow-up work before production use.

## Security notes

OTP verifiers are HMAC-SHA256 values, OTPs use a cryptographic random generator, and sessions use high-entropy tokens whose hashes are stored server-side. Sessions expire and can be revoked. User, conversation, and message history access is scoped to the current session. Production refuses the development SMS provider. The implementation is not yet independently security-audited; review rate-limit durability, CSRF/origin policy, provider configuration, migration baseline, monitoring, and deployment proxy behavior before serving real users.

`npm audit --omit=dev` reports zero known vulnerabilities after pinning Drizzle ORM to 0.45.2 and overriding Next.js's PostCSS dependency to 8.5.23. The full development dependency audit still reports advisories in `braces` (through the Next ESLint tooling) and `esbuild` (through Drizzle Kit's development loader). npm offered only incompatible forced downgrades for those chains, so they were left unchanged; do not expose development tooling to untrusted networks, and revisit the full audit when upstream releases compatible fixes.
