# GamifyIt with Spatial Interface

**Legacy version 1.0.0** preserves the original development for GamifyIt: a browser-based learning environment with a 2.5D spatial interface, individual exercises, collaborative case studies, quizzes, gamification, and AI feedback.

This guide applies to **`release/legacy-v1`**, based on application commit `aa0554b` from 31 May 2026. The `v1.0.0` tag preserves that original code. Later README improvements on this branch do not move the tag or change `main`.

## Before you begin

The application source is available here, but **this branch does not include a complete database bootstrap or seed dataset**. You need a compatible, sanitized PostgreSQL backup from the maintainer before you can complete installation. Starting the backend against an empty database is not sufficient: its startup helpers extend an existing schema rather than create the whole system.

Do not use a live production database for a legacy installation. Startup code changes schemas and seeds settings, admin accounts, and level definitions.

### Requirements

| Component | Requirement |
| --- | --- |
| Node.js and npm | Node.js 20 or newer; choose a supported Node release for hosting |
| PostgreSQL | A running server and matching PostgreSQL client tools (`psql`, `createdb`, `pg_restore`) |
| Database snapshot | A schema and seed dataset compatible with this legacy version |
| Git | To clone the release branch |
| OpenAI API key | Required for AI feedback and question generation, not basic server startup |
| Telegram bot | Optional, for student-login notifications |
| PM2 and Nginx | Optional, for a hosted installation |

The backend uses Express and Socket.IO. The frontend uses React and PixiJS. PHP and MySQL are not required.

## 1. Get the legacy source

```bash
git clone --branch release/legacy-v1 --single-branch https://github.com/pintarstudio/gamifyspace.git gamifyit-legacy
cd gamifyit-legacy
```

For an exact copy of the original release instead of the branch's latest documentation:

```bash
git clone --branch v1.0.0 --single-branch https://github.com/pintarstudio/gamifyspace.git gamifyit-v1
```

Run subsequent commands from the `gamifyit-legacy` directory unless a step says otherwise.

## 2. Prepare PostgreSQL

Obtain a **sanitized, legacy-compatible custom-format dump** from the maintainer. It must contain the base schema and reference data, including courses, users, avatars, topics, activity content, application sessions, and the Express session-store table `user_sessions`. Do not publish real student records or production backups.

Create a separate database role and database. These commands connect as a PostgreSQL administrator and prompt for passwords:

```bash
createuser -h localhost -U postgres --pwprompt gamifyit_legacy_user
createdb -h localhost -U postgres --owner=gamifyit_legacy_user gamifyit_legacy
```

Restore into the newly created, empty database:

```bash
pg_restore \
  --host=localhost \
  --username=gamifyit_legacy_user \
  --dbname=gamifyit_legacy \
  --no-owner \
  --no-privileges \
  --exit-on-error \
  /path/to/legacy-compatible.dump
```

Restoring as the application role makes it the owner of the restored objects. Ownership matters because this version runs `ALTER TABLE` and index-creation statements during initialization; read/write grants alone are not enough.

Check that the base tables are present:

```bash
psql -h localhost -U gamifyit_legacy_user -d gamifyit_legacy -c '\dt'
```

If the maintainer provides plain SQL instead, use `psql --set=ON_ERROR_STOP=1 --file=/path/to/legacy-compatible.sql` with the same host, username, and database. The SQL must not retain ownership statements for unavailable production roles.

## 3. Configure the backend

Create **`backend/.env`** with your own values:

```dotenv
PORT=4000
DB_HOST=127.0.0.1
DB_PORT=5432
DB_NAME=gamifyit_legacy
DB_USER=gamifyit_legacy_user
DB_PASSWORD=replace-with-your-database-password

SESSION_SECRET=replace-with-a-long-random-session-secret
ADMIN_PASSWORD_SECRET=replace-with-a-separate-long-random-secret

# Optional for startup; required when using AI features.
OPENAI_API_KEY=

# Optional student-login notifications. Leave both blank to disable.
TELEGRAM_BOT_TOKEN=
TELEGRAM_LOGIN_CHAT_ID=
LOGIN_NOTIFICATION_TIME_ZONE=Asia/Jakarta
```

Generate each secret separately, for example with `openssl rand -hex 32`. Keep `.env` private; it is excluded from Git.

`ADMIN_PASSWORD_SECRET` is used to hash admin passwords. Passwords restored from another installation will not verify with a different secret. For a sanitized installation, reset the local admin password using the recovery steps below rather than reuse a production secret.

The backend also reads `OPENAI_FEEDBACK_MODEL` and `OPENAI_QUESTION_MODEL`. Leaving them unset retains the legacy defaults. If configuring them, choose models compatible with the code's Responses API and structured-output requests. Model selection is also influenced by question-generation settings in the app.

## 4. Configure the frontend

Create **`frontend/.env`**:

```dotenv
REACT_APP_API_URL=http://localhost:4000/api
REACT_APP_SOCKET_URL=http://localhost:4000
```

The API URL includes `/api`; the Socket.IO URL does not. These values are embedded when the frontend starts or builds, so restart or rebuild after changing them. Never put private API keys or database credentials in frontend environment variables.

Use `localhost` consistently. This version explicitly allows frontend origins `http://localhost:3000` through `http://localhost:3003`; `http://127.0.0.1:3000` is a different origin.

## 5. Install dependencies

```bash
cd backend
npm ci
cd ../frontend
npm ci
cd ..
```

Both folders have their own `package.json` and lockfile. There is no root-level install or start command. Keep lockfiles unchanged when reproducing the legacy release.

## 6. Start locally

In one terminal:

```bash
cd backend
node server.js
```

In a second terminal, starting from the repository root:

```bash
cd frontend
npm start
```

| Address | Purpose |
| --- | --- |
| `http://localhost:3000` | Application landing page |
| `http://localhost:3000/demo` | Student demo login |
| `http://localhost:3000/gamifyitadmin` | Admin login |
| `http://localhost:3000/instructor` | Instructor login |
| `http://localhost:4000/` | Backend health response |

Verify the backend in another terminal:

```bash
curl http://localhost:4000/
curl http://localhost:4000/api/avatars
```

The root response should contain `"status":"ok"`. The avatars endpoint should return an array. A healthy root response alone does not prove the database is ready: startup initialization errors are logged separately.

### First login and reference data

For a newly initialized admin account, this version seeds username **`admin`** with password **`gamifyitadmin`**. A restored account may already have a different password. After login, change it at `/adminpassword` before exposing the installation.

The legacy student demo password is **`adminadmin`**, hard-coded in `backend/controllers/authController.js`. Students also need an existing course and avatar. This is a pilot/demo access mechanism, not individual student-password authentication.

An instructor account must be linked to a user with the Instructor role and an assigned course. A generic seeded instructor account without that linkage cannot access instructor features.

If course or student lists are empty, check the restored seed data. Use the admin pages to manage courses, topics, groups, students, avatars, and question banks. If student login is blocked by maintenance mode, inspect it in Settings.

### Reset an admin password after restoring a database

Run this from `backend/`, after the compatible schema is restored. The commands below assume Bash and prompt without echoing the password:

```bash
read -r -s -p "New admin password (at least 8 characters): " ADMIN_BOOTSTRAP_PASSWORD
echo
export ADMIN_BOOTSTRAP_PASSWORD
node --input-type=module <<'JS'
import 'dotenv/config';
import { pool } from './db/index.js';
import { ensureAdminTables, hashPassword } from './models/adminModel.js';

try {
  const password = process.env.ADMIN_BOOTSTRAP_PASSWORD || '';
  if (password.length < 8) throw new Error('Use at least 8 characters.');
  await ensureAdminTables();
  const result = await pool.query(
    'UPDATE useradmin SET password_hash = $1, updated_at = NOW() WHERE username = $2',
    [hashPassword(password), 'admin']
  );
  if (result.rowCount !== 1) throw new Error('Expected exactly one admin account.');
  console.log('Local admin password updated.');
} finally {
  await pool.end();
}
JS
unset ADMIN_BOOTSTRAP_PASSWORD
```

### Optional local launcher

The repository's `deploy.sh` starts the development servers and manages local PID/log files:

```bash
bash deploy.sh start
bash deploy.sh status
bash deploy.sh logs
bash deploy.sh stop
```

It requires Bash and `lsof`, does not install dependencies, and does not pull GitHub updates or configure PM2/Nginx. **It stops processes occupying ports 3000 and 4000**, including unrelated applications, so use the two-terminal approach if those ports are already in use.

## Hosted installation

Complete the database and environment setup first. Choose a separate hostname and database for the legacy version.

1. Add the exact HTTPS hostname to `allowedOrigins` in `backend/server.js`. That list configures both HTTP CORS and Socket.IO. It is not controlled by an environment variable in this release.
2. Set `frontend/.env` to the hosted values:

   ```dotenv
   REACT_APP_API_URL=https://legacy.example.com/api
   REACT_APP_SOCKET_URL=https://legacy.example.com
   ```

3. Build the frontend:

   ```bash
   cd frontend
   npm run build
   cd ..
   ```

4. Install PM2 if needed, then start the backend. Replace the example checkout path:

   ```bash
   npm install --global pm2
   pm2 start /var/www/gamifyit-legacy/backend/server.js \
     --name gamifyit-legacy \
     --cwd /var/www/gamifyit-legacy/backend
   pm2 save
   pm2 startup
   ```

   Follow the startup command PM2 prints for your operating system. The backend's working directory must be `backend/` so dotenv finds the correct `.env`.

5. Configure Nginx to serve `frontend/build`, preserve `/api/` when proxying to the backend, and forward WebSocket upgrades. This example assumes backend port 4000 and shows the routing portion of an HTTP server block:

   ```nginx
   server {
       listen 80;
       server_name legacy.example.com;
       root /var/www/gamifyit-legacy/frontend/build;
       index index.html;

       location / {
           try_files $uri $uri/ /index.html;
       }

       location /api/ {
           proxy_pass http://127.0.0.1:4000;
           proxy_http_version 1.1;
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
           proxy_read_timeout 300s;
       }

       location /socket.io/ {
           proxy_pass http://127.0.0.1:4000;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection "upgrade";
           proxy_set_header Host $host;
           proxy_read_timeout 86400s;
       }
   }
   ```

6. Configure HTTPS for the hostname before using the HTTPS frontend settings. Test with `nginx -t`, then reload Nginx. Restrict direct access to the backend port.

The original session cookie configuration has `secure: false`. Before a public deployment, review HTTPS-only cookies and Express proxy trust together. Keep this legacy pilot behind suitable access controls until its demo authentication and dependency risks have been assessed for your use case.

### Updating this installation

Back up the dedicated legacy database before updates. Pull **`release/legacy-v1`**, not `main`, if you intend to remain on this release line:

```bash
git switch release/legacy-v1
git pull --ff-only origin release/legacy-v1
```

Reinstall dependencies and rebuild only when relevant files change; restart PM2 after backend changes. A tag checkout is intentionally fixed and does not receive branch updates automatically. Avoid the local `deploy.sh` on a shared VPS.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| `relation ... does not exist` | Restore a compatible base schema and seed dataset. Startup helpers are not a complete migration system. |
| `must be owner of table ...` | Restore objects as the application role, or have the database administrator correct their ownership. |
| Database authentication failure | Match `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, and `DB_PASSWORD`; confirm PostgreSQL permits that connection. |
| `ADMIN_PASSWORD_SECRET is not configured` | Create `backend/.env`, set the secret, and start Node from `backend/`. |
| Admin password rejected after restore | The restored hash may use another secret. Reset the local admin password with the procedure above. |
| Page stays at `Memuat sesi...` | Check browser network errors, the backend, and `REACT_APP_API_URL`; restart/rebuild after changing frontend variables. |
| CORS errors or avatars do not move | Check `allowedOrigins`, Socket.IO URL, WebSocket proxying, and the browser's exact origin. |
| Nginx returns `502` | Check `pm2 status`, `pm2 logs gamifyit-legacy --lines 60`, backend port, and PostgreSQL connectivity. |
| AI generation or feedback fails | Configure your own backend API key and a model compatible with the legacy service requests. Inspect backend logs. |
| `Environment key "jest/globals" is unknown` during build | The legacy CRA/ESLint configuration may fail with installed dependencies. On macOS/Linux, use `DISABLE_ESLINT_PLUGIN=true npm run build` from `frontend/`. This bypasses build-time linting, not a code fix. |

The same lint-plugin workaround can be used for local development with `DISABLE_ESLINT_PLUGIN=true npm start` if that error occurs there.

## Repository layout

```text
backend/
  controllers/     HTTP request handlers
  db/              PostgreSQL connection
  models/          Queries and incremental schema initialization
  routes/          API routes
  services/        AI feedback, question generation, and notifications
  server.js        Express server and Socket.IO
frontend/
  public/          Maps, avatars, and other static assets
  src/             React pages, components, and spatial interface
deploy.sh          Local development launcher
```

## Release scope

- Application baseline: `aa0554b4b59ce2e6105669b290e0de9013f0b2d1`.
- Original release: [`v1.0.0`](https://github.com/pintarstudio/gamifyspace/releases/tag/v1.0.0).
- Legacy branch: [`release/legacy-v1`](https://github.com/pintarstudio/gamifyspace/tree/release/legacy-v1).
- Database snapshots, `.env` files, private credentials, and server-specific deployment scripts are not bundled.
- Dependency audit findings may exist in this archived stack. Review changes in an isolated environment rather than applying automatic breaking upgrades to reproduce the pilot.
- `main` is a separate development line; these instructions do not describe its current setup.
