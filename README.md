# GamifyIt with Spatial Interface

**Legacy version 1.0.0** preserves the original development for GamifyIt: a browser-based learning environment with a 2.5D spatial interface, individual exercises, collaborative case studies, quizzes, gamification, and AI feedback.

This guide applies to **`release/legacy-v1`**, based on application commit `aa0554b` from 31 May 2026. This branch also includes the clean installation SQL and an administrator setup command. The `v1.0.0` tag preserves the original code and does not contain these later installation additions. Neither the tag nor `main` is changed by this guide.

## Before you begin

**A clean installation database is included at [`database/install.sql`](database/install.sql).** It supplies the complete schema and built-in reference data. You do not need an existing database backup or any real student data.

The SQL is derived from the development database schema in an isolated preparation process. It contains 33 tables, 50 built-in avatars, 2 roles, 5 legacy levels, and 2 default settings. Courses, groups, topics, questions, cases, materials, accounts, chats, scores, activities, sessions, and logs start empty. No existing password hashes or API keys are included.

Do not use a live production database for a legacy installation. Startup code changes schemas and seeds settings, admin accounts, and level definitions.

### Requirements

| Component | Requirement |
| --- | --- |
| Node.js and npm | Node.js 20 or newer; choose a supported Node release for hosting |
| PostgreSQL | PostgreSQL 13 or newer, with client tools (`psql`, `createuser`, `createdb`) |
| Installation database | Included as `database/install.sql`; restore it into a new database |
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

For an exact copy of the original source release, without the installation additions described here:

```bash
git clone --branch v1.0.0 --single-branch https://github.com/pintarstudio/gamifyspace.git gamifyit-v1
```

Run subsequent commands from the `gamifyit-legacy` directory unless a step says otherwise.

## 2. Prepare PostgreSQL

Use the included SQL file. It defines all base tables, including the `user_sessions` session store, and intentionally provides no courses or student accounts. The installer adds their own content through the admin pages after setup.

Create a separate database role and database. These commands connect as a PostgreSQL administrator and prompt for passwords:

```bash
createuser -h localhost -U postgres --pwprompt gamifyit_legacy_user
createdb -h localhost -U postgres --owner=gamifyit_legacy_user gamifyit_legacy
```

Restore into the newly created, empty database:

```bash
psql \
  --host=localhost \
  --username=gamifyit_legacy_user \
  --dbname=gamifyit_legacy \
  --set=ON_ERROR_STOP=1 \
  --single-transaction \
  --file=database/install.sql
```

Restoring as the application role makes it the owner of the restored objects. Ownership matters because this version runs `ALTER TABLE` and index-creation statements during initialization; read/write grants alone are not enough.

Check that the base tables are present:

```bash
psql -h localhost -U gamifyit_legacy_user -d gamifyit_legacy -c '\dt'
```

Run the import once, into an empty database. It deliberately does not drop or overwrite existing tables. If you accidentally use an occupied database, the transaction fails without applying a partial installation. Accounts, content, and activity sequences start at ID 1; reference-data sequences continue after their seeded IDs.

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

`ADMIN_PASSWORD_SECRET` is used to hash admin passwords. Choose your own secret and keep it stable. Changing it later invalidates existing admin password hashes; use the setup command below to reset your local administrator if needed.

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

## 6. Create your administrator

The installation database contains no accounts. After installing backend dependencies and configuring `backend/.env`, create the `admin` account with your own password **before starting the server**. These commands assume Bash and prompt without echoing the password:

```bash
cd backend
read -r -s -p "Administrator password (at least 12 characters): " ADMIN_BOOTSTRAP_PASSWORD
echo
export ADMIN_BOOTSTRAP_PASSWORD
npm run setup:admin
unset ADMIN_BOOTSTRAP_PASSWORD
cd ..
```

The command uses the `ADMIN_PASSWORD_SECRET` from `backend/.env`. It creates or updates only the `admin` account; it does not create courses, students, or sample activities. Run it again to reset the local administrator password. Never point the setup command at someone else's database.

## 7. Start locally

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

### First login and your own data

Log in at `/gamifyitadmin` as **`admin`**, using the password you chose in step 6. You can change it later at `/adminpassword`.

An empty course or student list is expected on a clean installation. To configure the application:

1. Create your courses in Course Admin. Instructor fields can initially be left blank.
2. Review the automatically created A/B/C groups in Course Group Admin, choosing whether gamification and the spatial interface are enabled. Add other groups if needed.
3. Create your instructor and student users in Student Admin with the appropriate roles and group assignments. Assign instructors to their courses and configure their linked instructor accounts in User Admin.
4. Create topics in Topic Admin and configure which activities or tests are visible.
5. Add your own questions and cases in the question-bank admin pages, or provide your own course material and generate questions using your own OpenAI API key.
6. Use `/demo` to select a configured course, student, and avatar. Instructor login is at `/instructor`.

Automatic student creation through access links and maintenance mode are both off by default. Adjust these settings deliberately in Settings Admin.

The legacy student demo password is **`adminadmin`**, hard-coded in `backend/controllers/authController.js`. Students also need an existing course and avatar. This is a pilot/demo access mechanism, not individual student-password authentication.

An instructor account must be linked to a user with the Instructor role and an assigned course. A generic seeded instructor account without that linkage cannot access instructor features.

The historical backend still has fallback account seeding: if no `admin` account exists at startup, it creates one with the original default password. It also creates an unlinked generic instructor account. Step 6 prevents the admin fallback by creating your chosen password first. Use properly linked instructor accounts of your own rather than assigning the generic account to a real instructor.

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
| `relation ... does not exist` | Import `database/install.sql` into a new database before running setup or starting the server. |
| `must be owner of table ...` | Restore objects as the application role, or have the database administrator correct their ownership. |
| Database authentication failure | Match `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, and `DB_PASSWORD`; confirm PostgreSQL permits that connection. |
| `ADMIN_PASSWORD_SECRET is not configured` | Create `backend/.env`, set the secret, and start Node from `backend/`. |
| Admin password rejected | Check `ADMIN_PASSWORD_SECRET` and rerun step 6 with your chosen password. |
| Course or student lists are empty | This is expected after installation. Create your own courses, groups, and users through the admin pages. |
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
  scripts/         Administrator setup
database/
  install.sql      Complete schema and built-in reference data only
frontend/
  public/          Maps, avatars, and other static assets
  src/             React pages, components, and spatial interface
deploy.sh          Local development launcher
```

## Release scope

- Application baseline: `aa0554b4b59ce2e6105669b290e0de9013f0b2d1`.
- Original release: [`v1.0.0`](https://github.com/pintarstudio/gamifyspace/releases/tag/v1.0.0).
- Legacy branch: [`release/legacy-v1`](https://github.com/pintarstudio/gamifyspace/tree/release/legacy-v1).
- A clean installation database is included. Existing development/production data, `.env` files, private credentials, and server-specific deployment scripts are not bundled.
- Dependency audit findings may exist in this archived stack. Review changes in an isolated environment rather than applying automatic breaking upgrades to reproduce the pilot.
- `main` is a separate development line; these instructions do not describe its current setup.
