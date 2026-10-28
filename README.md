# GamifySpace

A course-based learning platform that combines individual exercises, group case studies, quizzes, and gamification. Students can participate through a virtual classroom or a standard activity interface, while instructors monitor participation and progress.

The application is presented to users as **GamifyIt**.

> **Setup status:** The application can run against an existing compatible PostgreSQL database. A clean database schema and starter-data package are not included yet, so a fresh installation cannot currently be completed from this repository alone. The steps below document the setup available today; missing steps are listed at the end.

## Contents

- [Features](#features)
- [Project Structure](#project-structure)
- [Requirements](#requirements)
- [Installation](#installation)
- [Configuration](#configuration)
- [Database Setup](#database-setup)
- [Run Locally](#run-locally)
- [First-Time Use](#first-time-use)
- [Production Deployment](#production-deployment)
- [Troubleshooting](#troubleshooting)
- [Documentation Still to Come](#documentation-still-to-come)

## Features

| Area | Capabilities |
| --- | --- |
| Learning activities | Individual multiple-choice exercises, individual case studies, group case studies, and fun quizzes |
| Assessments | Separate pre-test and post-test question banks and assessment schedules |
| Learning spaces | A PixiJS virtual classroom and a non-virtual activity interface |
| Gamification | Individual XP, shared group XP, student contribution XP, and levels |
| Instructor tools | Course and topic dashboards, activity monitoring, and Excel progress/comparison downloads |
| Question management | Text-based course materials, AI digests and question drafts, reusable instruction presets, and copying between compatible banks |
| Communication | Course announcements and student group chats |
| Administration | Student/instructor accounts, course groups, maintenance schedules, and activity-history management |

AI-generated questions are drafts for instructor review before saving to a question bank.

## Project Structure

```text
gamifyspace/
├── backend/                  Express API, Socket.IO, and PostgreSQL access
│   ├── controllers/          Request handlers
│   ├── db/                   Database connection
│   ├── models/               Data access and schema helpers
│   ├── routes/               API routes
│   ├── services/             AI generation, reporting, and scheduled tasks
│   └── server.js             Backend entry point
├── frontend/                 React application
│   ├── public/               Maps, avatars, and other static assets
│   └── src/                  Pages, components, and API/socket clients
└── README.md
```

There is no root-level npm application. Install dependencies and run commands inside the appropriate application directory.

## Requirements

- Git.
- Node.js and npm. A tested Node.js version range has not been documented yet.
- PostgreSQL and an existing database compatible with this application.
- An OpenAI API key if you want AI digest, question-generation, or feedback features.

The frontend uses React, React Router, PixiJS, and Socket.IO Client. The backend uses Express, Socket.IO, PostgreSQL, and PostgreSQL-backed sessions.

## Installation

Clone the repository:

```bash
git clone https://github.com/pintarstudio/gamifyspace.git
cd gamifyspace
```

Install backend dependencies:

```bash
cd backend
npm ci
cd ..
```

Install frontend dependencies:

```bash
cd frontend
npm ci
cd ..
```

## Configuration

Create the following local configuration files. Both `.env` paths are excluded from Git. Example files have not been packaged yet; the templates below contain placeholders only.

### Backend: `backend/.env`

```dotenv
PORT=4000

DB_HOST=localhost
DB_PORT=5432
DB_NAME=gamifyspace
DB_USER=your_database_user
DB_PASSWORD=your_database_password

SESSION_SECRET=replace_with_a_long_random_secret
ADMIN_PASSWORD_SECRET=replace_with_a_different_long_random_secret

# Optional: required for AI features.
OPENAI_API_KEY=

# Optional: set model IDs available to your OpenAI account.
# OPENAI_QUESTION_MODEL=your_question_model_id
# OPENAI_FEEDBACK_MODEL=your_feedback_model_id
```

| Setting | Purpose |
| --- | --- |
| `DB_*` | PostgreSQL connection details |
| `PORT` | Backend HTTP and Socket.IO port; defaults to `4000` |
| `SESSION_SECRET` | Signs browser session cookies |
| `ADMIN_PASSWORD_SECRET` | Used when hashing and verifying admin/instructor passwords |
| `OPENAI_API_KEY` | Authenticates backend requests for AI features |
| `OPENAI_QUESTION_MODEL` | Optional default model for digests and question generation; individual generation requests can override the question model |
| `OPENAI_FEEDBACK_MODEL` | Optional default model for AI feedback; also participates in the question-model fallback |

Generate a separate random value for each secret, for example by running this command twice:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Keep secrets on the backend. Never put database credentials, the OpenAI key, or password secrets in frontend environment variables. Preserve `ADMIN_PASSWORD_SECRET` when moving an existing database: changing it prevents existing password hashes from verifying unless passwords are reset.

Optional Telegram login notifications use `TELEGRAM_BOT_TOKEN`, `TELEGRAM_LOGIN_CHAT_ID`, and `LOGIN_NOTIFICATION_TIME_ZONE` (default: `Asia/Jakarta`). These are not required to start the core application.

### Frontend: `frontend/.env`

```dotenv
REACT_APP_API_URL=http://localhost:4000/api
REACT_APP_SOCKET_URL=http://localhost:4000
```

The API URL includes `/api`; the Socket.IO URL points to the backend origin without `/api`.

Restart the backend after changing its environment. Restart the frontend development server after changing its environment, or rebuild the frontend for deployment.

## Database Setup

**This step currently requires an existing compatible database.**

Some schema helpers create or update feature tables on startup, but they assume core tables such as `users`, `courses`, `topics`, and `avatars` already exist. An empty PostgreSQL database is therefore not sufficient. The application also stores browser sessions in `user_sessions`.

For now:

1. Obtain a compatible database through an authorized project maintainer.
2. Restore it into your own PostgreSQL instance using the appropriate PostgreSQL restore tool for its format.
3. Set the database connection details in `backend/.env`.
4. Start the backend and check for schema-initialization errors before using the frontend.

Use a database account with the permissions needed for the application's startup schema changes, not just read-only access.

> A schema-only installation script and non-personal starter data will be added later. Do not use or publish production/student database dumps as a public installation package.

## Run Locally

Once the configuration and database are ready, open two terminals. Run each command block from the repository root.

**Terminal 1: backend**

```bash
cd backend
node server.js
```

**Terminal 2: frontend**

```bash
cd frontend
npm start
```

| Service | Local Address |
| --- | --- |
| Frontend | <http://localhost:3000> |
| Backend API | <http://localhost:4000/api> |
| Admin login/dashboard | <http://localhost:3000/gamifyitadmin> |
| Instructor login | <http://localhost:3000/instructor> |
| Student/demo login | <http://localhost:3000/demo> |

Keep both processes running. Stop a process with `Ctrl+C` in its terminal.

If you change ports or access the frontend from another hostname, update its API/socket URLs and the backend's HTTP and Socket.IO allowed origins in `backend/server.js`. When testing from another device, `localhost` refers to that device, so use your server's reachable hostname or IP address instead.

## First-Time Use

### Administrator

On a compatible database where the default admin account has not already been created, initialization creates:

| Username | Initial Password |
| --- | --- |
| `admin` | `gamifyitadmin` |

An existing account may have a different password. Change the default password before making an installation publicly accessible. The **Change Password** menu signs you out after a successful change.

Suggested setup order:

1. Open `/gamifyitadmin` and sign in.
2. Add a course in **Admin Config → Course**. A course can initially have no instructor; course creation adds groups A, B, and C.
3. Add instructor and student records in **Admin Config → Student & Instructor**. Assign students to the appropriate course and course group.
4. Assign up to two instructors to the course. Check linked instructor login accounts in **User Admin**.
5. Review each course group's virtual-space and gamification settings in **Course Master → Course Groups**.
6. Add topics, visibility, and assessment schedules in **Admin Config → Topics**.
7. Add text materials in **Course Master → Material & Question Bank**. Configure an OpenAI key before generating digests or question drafts.
8. Review drafts before saving them to the intended bank. Use **Question Bank Monitor** to check topic coverage.
9. Review maintenance and public-link account-creation settings before inviting students.

### Instructor

Use `/instructor` with an enabled login account linked to a user whose role is Instructor. Enter credentials, select an available course, choose an avatar, and sign in to the virtual classroom.

Automatically provisioned instructor accounts initially use `12345678`, unless changed. The username is generally based on the email address before `@`, with a suffix if needed; **User Admin** shows the exact value. A generic account that is not linked to an instructor user cannot complete the instructor login flow.

Instructors can also sign in through `/gamifyitadmin` for the dashboard. Admin Config is reserved for administrators.

### Student

The `/demo` page selects an existing student and is intended for testing. It is not a production authentication mechanism and can allow tester access during maintenance; restrict access appropriately before a public deployment.

The public student entry flow uses a course name, student name, and student email supplied in the URL. Whether this flow may create new accounts is controlled in Settings. It does not establish verified ownership of an email address; decide how access links will be distributed and protected before using this flow in a new environment.

Students are routed to the virtual or non-virtual activity interface according to their course-group configuration. Activities require the relevant topics and question banks to be available.

## Production Deployment

Build the frontend:

```bash
cd frontend
npm run build
```

Deploy `frontend/build/` through your web server or static host. Configure a single-page application fallback to `index.html` so direct visits to routes such as `/instructor` and `/questionbankadmin` work.

The backend remains a separate, long-running Node.js process started with `node server.js` from `backend/`. The frontend build does not start or deploy the API.

Before exposing a deployment:

- Set production API and Socket.IO URLs **before building** the frontend; these values are embedded in the build.
- Configure the backend's allowed origins for the deployed frontend.
- Use HTTPS and review session-cookie and reverse-proxy settings. The current backend sets `secure: false` and `sameSite: "lax"`; these are not a complete production configuration for every hosting layout.
- If using a reverse proxy, forward Socket.IO connections and WebSocket upgrades to the backend.
- Keep the backend alive for maintenance scheduling and automatic topic hiding.
- Change default passwords and restrict the demo login route.
- Back up the database outside the public source tree and keep `.env` files private.

A provider-specific deployment guide, process-manager setup, and database bootstrap instructions are still to come.

## Troubleshooting

| Problem | What to Check |
| --- | --- |
| Backend cannot connect to PostgreSQL | Database service, hostname, port, database name, credentials, and connection permissions |
| Startup reports missing tables or relations | A compatible database has not been initialized; startup helpers do not bootstrap all core tables |
| Login/session requests fail | `SESSION_SECRET`, database session storage, frontend/API hostname consistency, allowed origins, and cookie settings |
| Admin/instructor password stops working after a move | Preserve the original `ADMIN_PASSWORD_SECRET` or reset the affected passwords |
| Instructor has no courses or cannot log in | Instructor role, enabled linked login account, and active course association |
| HTTP requests work but live chat or presence does not | `REACT_APP_SOCKET_URL`, Socket.IO allowed origins, and proxy WebSocket support |
| AI features fail | Backend OpenAI key, available model IDs, account limits, and backend error output |
| Question generation returns a 504 | Hosting/proxy timeout and request duration; try fewer questions or materials while diagnosing |
| Students cannot enter during maintenance | Maintenance settings and scheduled activation/deactivation times |
| A page works after navigation but returns 404 on refresh | Web-server fallback to `index.html` |

## Documentation Still to Come

- [ ] Clean PostgreSQL schema and installation/upgrade procedure.
- [ ] Minimal starter data for a new installation, without student or production records.
- [ ] Dedicated `.env.example` files.
- [ ] Tested Node.js, npm, and PostgreSQL version matrix.
- [ ] Screenshots and a fuller student/instructor walkthrough.
- [ ] Provider-specific deployment and backup/restore instructions.
- [ ] Project-wide license and asset-attribution details.
