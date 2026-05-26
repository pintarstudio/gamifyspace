import dotenv from "dotenv";
dotenv.config();

import express from "express";
import session from "express-session";
import pgSession from "connect-pg-simple";
import cors from "cors";
import {pool} from "./db/index.js";
import http from "http";
import {Server} from "socket.io";
import {logUserAction} from "./utils/logger.js";
import authRoutes from "./routes/authRoutes.js";
import courseRoutes from "./routes/courseRoutes.js";
import sessionRoutes from "./routes/sessionRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import avatarRoutes from "./routes/avatarRoutes.js";
import tableActivityRoutes from "./routes/tableActivityRoutes.js";
import quizActivityRoutes from "./routes/quizActivityRoutes.js";
import individualActivityRoutes from "./routes/individualActivityRoutes.js";
import virtualSpaceDashboardRoutes from "./routes/virtualSpaceDashboardRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";
import roleRoutes from "./routes/roleRoutes.js";
import chatRoutes from "./routes/chatRoutes.js";
import instructorRoutes from "./routes/instructorRoutes.js";
import {ensureAdminTables} from "./models/adminModel.js";
import {ensureCourseSchema} from "./models/courseModel.js";
import {ensureQuestionBankAdminTables} from "./models/adminQuestionBankModel.js";
import {ensureGamificationTables} from "./models/gamificationModel.js";
import {ensureCourseGroupSchema} from "./models/courseGroupModel.js";
import {ensureRoleSchema} from "./models/roleModel.js";
import {ensureChatSchema} from "./models/chatModel.js";
import {getBooleanSetting, SETTING_KEYS} from "./models/settingsModel.js";
import {deactivateSession, findSession} from "./models/sessionModel.js";
import {STUDENT_ROLE_ID} from "./models/roleModel.js";

const app = express();
const server = http.createServer(app);
const allowedOrigins = [
    "http://localhost:3000",
    "http://localhost:3001",
    "http://localhost:3002",
    "http://localhost:3003",
    "https://space.gamifyit.id",
];
const io = new Server(server, {
    cors: {origin: allowedOrigins, methods: ["GET", "POST"]},
});
app.set("io", io);
const PORT = process.env.PORT || 4000;
const PgSession = pgSession(session);

ensureGamificationTables().catch((error) => {
    console.error("Failed to initialize gamification tables:", error);
});
ensureAdminTables().catch((error) => {
    console.error("Failed to initialize admin tables:", error);
});
ensureCourseSchema().catch((error) => {
    console.error("Failed to initialize course schema:", error);
});
ensureQuestionBankAdminTables().catch((error) => {
    console.error("Failed to initialize question bank admin tables:", error);
});
ensureCourseGroupSchema().catch((error) => {
    console.error("Failed to initialize course group schema:", error);
});
ensureRoleSchema().catch((error) => {
    console.error("Failed to initialize role schema:", error);
});
ensureChatSchema().catch((error) => {
    console.error("Failed to initialize chat schema:", error);
});

// ====== MIDDLEWARE & ROUTES ======
app.use(
    cors({
        origin: allowedOrigins,
        credentials: true,
    })
);

app.use(express.json());

app.use(
    session({
        store: new PgSession({
            pool,
            tableName: "user_sessions",
        }),
        secret: process.env.SESSION_SECRET,
        resave: false,
        saveUninitialized: false,
        cookie: {
            maxAge: 2 * 60 * 60 * 1000, // 2 jam
            sameSite: "lax",
            secure: false,
        },
    })
);

const STUDENT_MAINTENANCE_MESSAGE = "Sistem sedang dalam mode pemeliharaan. Login student sementara dinonaktifkan.";

app.use(async (req, res, next) => {
    try {
        if (!req.path.startsWith("/api") || req.path.startsWith("/api/admin")) return next();
        const sessionId = req.session?.session_id;
        if (!sessionId) return next();

        const maintenanceMode = await getBooleanSetting(SETTING_KEYS.MAINTENANCE_MODE, false);
        if (!maintenanceMode) return next();

        const sessionUser = await findSession(sessionId);
        if (!sessionUser || String(sessionUser.role_id) !== String(STUDENT_ROLE_ID)) return next();

        await deactivateSession(sessionId);
        req.session.destroy(() => {});

        if (req.path === "/api/session") {
            return res.json({
                loggedIn: false,
                maintenance: true,
                message: STUDENT_MAINTENANCE_MESSAGE,
            });
        }

        if (req.path === "/api/logout") {
            return res.json({message: "Logout berhasil", maintenance: true});
        }

        return res.status(503).json({
            message: STUDENT_MAINTENANCE_MESSAGE,
            maintenance: true,
        });
    } catch (error) {
        console.error("Maintenance guard error:", error);
        return next();
    }
});

app.use("/api", authRoutes);
app.use("/api/courses", courseRoutes);
app.use("/api/session", sessionRoutes);
app.use("/api/users", userRoutes);
app.use("/api/avatars", avatarRoutes);
app.use("/api/roles", roleRoutes);
app.use("/api/table", tableActivityRoutes);
app.use("/api/quiz", quizActivityRoutes);
app.use("/api/individual", individualActivityRoutes);
app.use("/api/virtualspace", virtualSpaceDashboardRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/instructor", instructorRoutes);
app.use("/api/chat", chatRoutes);
app.get("/", (req, res) => {
    res.json({status: "ok", message: "GamifySpace backend active"});
});

// ====== SOCKET.IO ======
let users = {};
let userRooms = {}; // Track which room each socket belongs to
const activityLocks = {};
const ACTIVITY_STATUS_TIMEOUT_MS = 5 * 60 * 1000;
const VALID_ACTIVITY_STATUS_TYPES = new Set([
    "individual_exercise",
    "individual_pre_test",
    "individual_post_test",
    "group_discussion",
    "quiz",
]);

function normalizeRoomName(room) {
    const cleaned = String(room || "room1").trim().replace(/^\/+/, "");
    const fileName = cleaned.split("/").pop() || "room1";
    return fileName.replace(/\.json$/i, "") || "room1";
}

function normalizeCourseId(courseId) {
    const parsed = Number.parseInt(courseId, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function buildScopedRoom({courseId, room}) {
    const normalizedCourseId = normalizeCourseId(courseId);
    if (!normalizedCourseId) return null;
    return `course:${normalizedCourseId}:room:${normalizeRoomName(room)}`;
}

function buildInstructorMonitorRoom(courseId) {
    const normalizedCourseId = normalizeCourseId(courseId);
    return normalizedCourseId ? `instructor:monitor:${normalizedCourseId}` : null;
}

function emitInstructorMonitorUpdate(courseId, reason, payload = {}) {
    const room = buildInstructorMonitorRoom(courseId);
    if (!room) return;
    io.to(room).emit("instructor:monitor:update", {
        course_id: normalizeCourseId(courseId),
        reason,
        updated_at: new Date().toISOString(),
        ...payload,
    });
}

function buildQuizSessionRoom(sessionId) {
    const parsed = Number.parseInt(sessionId, 10);
    return Number.isFinite(parsed) && parsed > 0 ? `quiz:session:${parsed}` : null;
}

function buildGroupSessionRoom(sessionId) {
    const parsed = Number.parseInt(sessionId, 10);
    return Number.isFinite(parsed) && parsed > 0 ? `group:session:${parsed}` : null;
}

function activityLockKey(courseId, userId) {
    const normalizedCourseId = normalizeCourseId(courseId);
    if (!normalizedCourseId || !userId) return null;
    return `${normalizedCourseId}:${userId}`;
}

function isStatusActive(status) {
    return !!status?.expires_at && Number(status.expires_at) > Date.now();
}

function sanitizeActivityStatus(status) {
    if (!status || !isStatusActive(status)) return null;
    const {
        type,
        label,
        activity_key,
        object_id,
        object_name,
        group_id,
        table_id,
        started_at,
        expires_at,
    } = status;
    return {
        type,
        label,
        activity_key,
        object_id,
        object_name,
        group_id,
        table_id,
        started_at,
        expires_at,
    };
}

function serializeUserForRoom(user) {
    const {activityStatusTimer, ...serializableUser} = user;
    const status = sanitizeActivityStatus(serializableUser.activity_status);
    if (status) return {...serializableUser, activity_status: status};
    const {activity_status, ...withoutStatus} = serializableUser;
    return withoutStatus;
}

function matchingUserEntries(courseId, userId) {
    return Object.entries(users).filter(([, u]) =>
        String(u.user_id) === String(userId)
        && String(u.course_id) === String(normalizeCourseId(courseId))
    );
}

function broadcastRoomsForEntries(entries) {
    const rooms = new Set(entries.map(([, u]) => u.scopedRoom).filter(Boolean));
    rooms.forEach((room) => io.to(room).emit("update_users", getUsersInRoom(room)));
}

function clearActivityStatusForUser({courseId, userId, activityKey = null, broadcast = true}) {
    const key = activityLockKey(courseId, userId);
    const current = key ? activityLocks[key] : null;
    if (current && activityKey && current.activity_key !== activityKey) return false;

    if (key) delete activityLocks[key];
    const entries = matchingUserEntries(courseId, userId);
    entries.forEach(([socketId, u]) => {
        if (activityKey && u.activity_status?.activity_key !== activityKey) return;
        if (u.activityStatusTimer) clearTimeout(u.activityStatusTimer);
        delete u.activityStatusTimer;
        delete u.activity_status;
    });
    if (broadcast) broadcastRoomsForEntries(entries);
    emitInstructorMonitorUpdate(courseId, "activity_status_cleared", {user_id: userId});
    return true;
}

function scheduleActivityStatusTimeout(courseId, userId, activityKey) {
    const entries = matchingUserEntries(courseId, userId);
    entries.forEach(([, u]) => {
        if (u.activityStatusTimer) clearTimeout(u.activityStatusTimer);
        u.activityStatusTimer = setTimeout(() => {
            clearActivityStatusForUser({courseId, userId, activityKey});
        }, ACTIVITY_STATUS_TIMEOUT_MS + 250);
    });
}

function setActivityStatusForUser({courseId, userId, status}) {
    const key = activityLockKey(courseId, userId);
    if (!key || !status || !VALID_ACTIVITY_STATUS_TYPES.has(status.type)) {
        return {ok: false, reason: "INVALID_STATUS"};
    }

    const now = Date.now();
    const current = activityLocks[key];
    if (
        current
        && isStatusActive(current)
        && current.activity_key
        && status.activity_key
        && current.activity_key !== status.activity_key
    ) {
        const canPromotePendingActivity = current.is_pending && current.type === status.type;
        if (!canPromotePendingActivity) {
            return {
                ok: false,
                reason: "ACTIVITY_ALREADY_ACTIVE",
                current: sanitizeActivityStatus(current),
            };
        }
    }

    if (
        current
        && isStatusActive(current)
        && !current.is_pending
        && current.activity_key
        && !status.activity_key
    ) {
        return {
            ok: false,
            reason: "ACTIVITY_ALREADY_ACTIVE",
            current: sanitizeActivityStatus(current),
        };
    }

    const nextStatus = {
        type: status.type,
        label: String(status.label || "").trim() || "In activity",
        activity_key: status.activity_key || `${status.type}:pending`,
        object_id: status.object_id || null,
        object_name: status.object_name || null,
        group_id: status.group_id || null,
        table_id: status.table_id || null,
        is_pending: !!status.is_pending,
        started_at: current?.started_at && current.activity_key === status.activity_key ? current.started_at : now,
        expires_at: now + ACTIVITY_STATUS_TIMEOUT_MS,
    };

    activityLocks[key] = nextStatus;
    const entries = matchingUserEntries(courseId, userId);
    entries.forEach(([, u]) => {
        u.activity_status = nextStatus;
    });
    scheduleActivityStatusTimeout(courseId, userId, nextStatus.activity_key);
    broadcastRoomsForEntries(entries);
    emitInstructorMonitorUpdate(courseId, "activity_status_set", {user_id: userId});

    return {ok: true, status: sanitizeActivityStatus(nextStatus)};
}

app.post("/api/activity-status/clear", (req, res) => {
    const sessionUser = req.session?.user;
    const bodyUserId = req.body?.user_id;
    const bodyCourseId = req.body?.course_id;
    const userId = sessionUser?.user_id || bodyUserId;
    const courseId = sessionUser?.course_id || bodyCourseId;

    if (!userId || !courseId) {
        return res.status(400).json({ok: false, reason: "MISSING_USER"});
    }

    if (
        sessionUser
        && (
            String(sessionUser.user_id) !== String(bodyUserId || sessionUser.user_id)
            || String(sessionUser.course_id) !== String(bodyCourseId || sessionUser.course_id)
        )
    ) {
        return res.status(403).json({ok: false, reason: "SESSION_MISMATCH"});
    }

    const cleared = clearActivityStatusForUser({
        courseId,
        userId,
        activityKey: req.body?.activity_key || null,
    });

    return res.json({ok: true, cleared});
});

async function findDatabaseBackedActivityStatus(sessionUser) {
    const courseId = normalizeCourseId(sessionUser?.course_id);
    const userId = sessionUser?.user_id;
    if (!courseId || !userId) return null;

    const individual = await pool.query(
        `SELECT session_id, activity_type, object_id
         FROM individual_activity_sessions
         WHERE course_id = $1
           AND user_id = $2
           AND status = 'in_progress'
         ORDER BY started_at DESC
         LIMIT 1`,
        [courseId, userId]
    ).catch(() => ({rows: []}));
    if (individual.rows[0]) {
        const row = individual.rows[0];
        const type = row.activity_type === "pre_test"
            ? "individual_pre_test"
            : row.activity_type === "post_test"
                ? "individual_post_test"
                : "individual_exercise";
        return {
            type,
            label: type === "individual_pre_test"
                ? "Taking pre-test"
                : type === "individual_post_test"
                    ? "Taking post-test"
                    : "Doing exercise",
            activity_key: `${type}:${row.session_id}`,
            object_id: row.object_id || "computer",
            object_name: "computer",
            is_pending: false,
        };
    }

    const quiz = await pool.query(
        `SELECT s.quiz_session_id, s.object_id, s.group_id, s.table_id
         FROM quiz_sessions s
         JOIN quiz_members m ON m.quiz_session_id = s.quiz_session_id
         WHERE s.course_id = $1
           AND m.user_id = $2
           AND m.is_active = TRUE
           AND s.status IN ('lobby', 'in_progress', 'completed')
         ORDER BY s.created_at DESC
         LIMIT 1`,
        [courseId, userId]
    ).catch(() => ({rows: []}));
    if (quiz.rows[0]) {
        const row = quiz.rows[0];
        return {
            type: "quiz",
            label: "In quiz",
            activity_key: `quiz:${row.quiz_session_id}`,
            object_id: row.object_id || row.table_id,
            object_name: "bigtable",
            group_id: row.group_id,
            table_id: row.table_id,
            is_pending: false,
        };
    }

    const group = await pool.query(
        `SELECT s.session_id, s.object_id, s.group_id
         FROM table_group_sessions s
         JOIN table_group_members m ON m.session_id = s.session_id
         WHERE s.course_id = $1
           AND m.user_id = $2
           AND m.is_active = TRUE
           AND s.is_active = TRUE
           AND s.submitted_at IS NULL
         ORDER BY s.created_at DESC
         LIMIT 1`,
        [courseId, userId]
    ).catch(() => ({rows: []}));
    if (group.rows[0]) {
        const row = group.rows[0];
        return {
            type: "group_discussion",
            label: "In group discussion",
            activity_key: `group_discussion:${row.session_id}`,
            object_id: row.object_id,
            object_name: "table",
            group_id: row.group_id,
            is_pending: false,
        };
    }

    return null;
}

async function clearStaleActivityLockIfNeeded(courseId, userId) {
    const key = activityLockKey(courseId, userId);
    const current = key ? activityLocks[key] : null;
    if (!current || !isStatusActive(current) || current.is_pending) return false;

    const databaseStatus = await findDatabaseBackedActivityStatus({course_id: courseId, user_id: userId});
    const isStillBacked = databaseStatus
        && databaseStatus.type === current.type
        && databaseStatus.activity_key === current.activity_key;
    if (isStillBacked) return false;

    clearActivityStatusForUser({courseId, userId});
    return true;
}

app.get("/api/activity-status/current", async (req, res) => {
    const sessionUser = req.session?.user;
    if (!sessionUser?.user_id || !sessionUser?.course_id) {
        return res.status(401).json({ok: false, reason: "MISSING_USER"});
    }

    const key = activityLockKey(sessionUser.course_id, sessionUser.user_id);
    const status = key ? sanitizeActivityStatus(activityLocks[key]) : null;
    if (status) {
        const clearedStaleLock = await clearStaleActivityLockIfNeeded(sessionUser.course_id, sessionUser.user_id);
        if (!clearedStaleLock) return res.json({ok: true, status});
    }

    const databaseStatus = await findDatabaseBackedActivityStatus(sessionUser);
    if (!databaseStatus) return res.json({ok: true, status: null});

    const locked = setActivityStatusForUser({
        courseId: sessionUser.course_id,
        userId: sessionUser.user_id,
        status: databaseStatus,
    });
    return res.json({ok: true, status: locked.status || null});
});

io.on("connection", (socket) => {
    console.log("User connected:", socket.id);

    socket.on("chat:join", (data = {}) => {
        const courseId = normalizeCourseId(data.course_id);
        const userId = Number.parseInt(data.user_id, 10);
        const roomIds = Array.isArray(data.room_ids) ? data.room_ids : [];
        if (courseId) socket.join(`chat:course:${courseId}`);
        if (Number.isFinite(userId) && userId > 0) socket.join(`chat:user:${userId}`);
        roomIds.forEach((roomId) => {
            const parsedRoomId = Number.parseInt(roomId, 10);
            if (Number.isFinite(parsedRoomId) && parsedRoomId > 0) {
                socket.join(`chat:room:${parsedRoomId}`);
            }
        });
    });

    socket.on("chat:join_room", (data = {}) => {
        const roomId = Number.parseInt(data.room_id, 10);
        if (Number.isFinite(roomId) && roomId > 0) socket.join(`chat:room:${roomId}`);
    });

    socket.on("chat:leave_room", (data = {}) => {
        const roomId = Number.parseInt(data.room_id, 10);
        if (Number.isFinite(roomId) && roomId > 0) socket.leave(`chat:room:${roomId}`);
    });

    socket.on("quiz:join", (data = {}) => {
        const room = buildQuizSessionRoom(data.quiz_session_id);
        if (room) socket.join(room);
    });

    socket.on("quiz:leave", (data = {}) => {
        const room = buildQuizSessionRoom(data.quiz_session_id);
        if (room) socket.leave(room);
    });

    socket.on("group:join", (data = {}) => {
        const room = buildGroupSessionRoom(data.session_id);
        if (room) socket.join(room);
    });

    socket.on("group:leave", (data = {}) => {
        const room = buildGroupSessionRoom(data.session_id);
        if (room) socket.leave(room);
    });

    socket.on("instructor:monitor:join", (data = {}) => {
        const room = buildInstructorMonitorRoom(data.course_id);
        if (room) socket.join(room);
    });

    socket.on("instructor:monitor:leave", (data = {}) => {
        const room = buildInstructorMonitorRoom(data.course_id);
        if (room) socket.leave(room);
    });

    // Join room handler
    socket.on("join_room", ({user, room}) => {
        if (!user || !room) return;
        const courseId = normalizeCourseId(user.course_id);
        const visibleRoom = normalizeRoomName(room);
        const scopedRoom = buildScopedRoom({courseId, room: visibleRoom});
        if (!scopedRoom) return;

        // Leave previous room if any
        const prevScopedRoom = userRooms[socket.id];
        if (prevScopedRoom) socket.leave(prevScopedRoom);

        // Join new room
        socket.join(scopedRoom);

        // Update room lama
        if (prevScopedRoom && prevScopedRoom !== scopedRoom) {
            io.to(prevScopedRoom).emit("update_users", getUsersInRoom(prevScopedRoom));
        }

        // Broadcast ke room baru setelah update
        io.to(scopedRoom).emit("update_users", getUsersInRoom(scopedRoom));

        userRooms[socket.id] = scopedRoom;

        const spawnX = Number.isFinite(Number(user.x)) ? Number(user.x) : 400;
        const spawnY = Number.isFinite(Number(user.y)) ? Number(user.y) : 300;

        // Register user in the room
        users[socket.id] = {
            ...user,
            course_id: courseId,
            room: visibleRoom,
            scopedRoom,
            x: spawnX,
            y: spawnY,
            direction: user.direction || "right",
        };
        const lock = activityLocks[activityLockKey(courseId, user.user_id)];
        if (lock && isStatusActive(lock)) {
            users[socket.id].activity_status = lock;
            scheduleActivityStatusTimeout(courseId, user.user_id, lock.activity_key);
        }

        console.log(`${user.name || user.email} joined ${visibleRoom} in course ${courseId}`);
        io.to(scopedRoom).emit("update_users", getUsersInRoom(scopedRoom));

        logUserAction(user.user_id, "enter_room", {course_id: courseId, room: visibleRoom, position: {x: spawnX, y: spawnY}});
        emitInstructorMonitorUpdate(courseId, "presence_joined", {user_id: user.user_id});
    });

    socket.on("move", (pos) => {
        const u = users[socket.id];
        if (!u) return;
        const scopedRoom = userRooms[socket.id];
        if (!scopedRoom) return;

        // Update position
        u.x = pos.x;
        u.y = pos.y;
        u.direction = pos.direction;

        const now = Date.now();
        if (!u.lastEmitTime || now - u.lastEmitTime > 100) {
            io.to(scopedRoom).emit("update_users", getUsersInRoom(scopedRoom));
            u.lastEmitTime = now;
        }

    });

    socket.on("interact_obj", (data) => {
        if (!data?.user_id) return;
        const {user_id, object_name, object_id, group_id, url, action, targetRoom} = data;
        logUserAction(user_id, "interact_obj", {object_name, object_id, group_id, url, action, targetRoom});
    });

    socket.on("activity_status:set", async (data, callback) => {
        await clearStaleActivityLockIfNeeded(data?.course_id, data?.user_id);
        const result = setActivityStatusForUser({
            courseId: data?.course_id,
            userId: data?.user_id,
            status: data?.status,
        });
        callback?.(result);
    });

    socket.on("activity_status:clear", (data, callback) => {
        const cleared = clearActivityStatusForUser({
            courseId: data?.course_id,
            userId: data?.user_id,
            activityKey: data?.activity_key || null,
        });
        callback?.({ok: true, cleared});
    });

    socket.on("logout", () => {
        const u = users[socket.id];
        const scopedRoom = userRooms[socket.id];
        if (u && scopedRoom) {
            logUserAction(u.user_id, "logout", {course_id: u.course_id, room: u.room, position: {x: u.x, y: u.y}});
            clearActivityStatusForUser({courseId: u.course_id, userId: u.user_id, broadcast: false});
            io.to(scopedRoom).emit("user_left", u.user_id);
            delete users[socket.id];
            io.to(scopedRoom).emit("update_users", getUsersInRoom(scopedRoom));
            emitInstructorMonitorUpdate(u.course_id, "presence_left", {user_id: u.user_id});
        }
        delete userRooms[socket.id];
        console.log("👋 User logged out:", socket.id);
    });

    socket.on("disconnect", () => {
        const u = users[socket.id];
        const scopedRoom = userRooms[socket.id];
        if (u && scopedRoom) {
            logUserAction(u.user_id, "exit_room", {course_id: u.course_id, room: u.room, position: {x: u.x, y: u.y}});
            clearActivityStatusForUser({courseId: u.course_id, userId: u.user_id, broadcast: false});
            io.to(scopedRoom).emit("user_left", u.user_id); // 🔹 notify others
            delete users[socket.id];
            io.to(scopedRoom).emit("update_users", getUsersInRoom(scopedRoom));
            emitInstructorMonitorUpdate(u.course_id, "presence_left", {user_id: u.user_id});
        }
        delete userRooms[socket.id];
        console.log("🔴 User disconnected:", socket.id);
    });

    socket.on("request_update_users", ({room, course_id}) => {
        const u = users[socket.id];
        const scopedRoom = buildScopedRoom({
            courseId: course_id || u?.course_id,
            room: room || u?.room,
        });
        if (!scopedRoom) return;
        io.to(socket.id).emit("update_users", getUsersInRoom(scopedRoom));
    });
});

// Helper function
function getUsersInRoom(scopedRoom) {
    const filtered = {};
    for (const [id, u] of Object.entries(users)) {
        if (u.scopedRoom === scopedRoom) filtered[id] = serializeUserForRoom(u);
    }
    return filtered;
}

function getCoursePresenceUsers(courseId) {
    const normalizedCourseId = normalizeCourseId(courseId);
    if (!normalizedCourseId) return [];

    const latestByUser = new Map();
    for (const [socketId, user] of Object.entries(users)) {
        if (String(user.course_id) !== String(normalizedCourseId)) continue;
        latestByUser.set(String(user.user_id), {
            socket_id: socketId,
            ...serializeUserForRoom(user),
        });
    }
    return [...latestByUser.values()];
}

app.set("presenceStore", {
    getCourseUsers: getCoursePresenceUsers,
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Server berjalan di port ${PORT}`);
    console.log(`🌐 Akses dari komputer lain di jaringan ini: http://<IP-lokal-Mac>:${PORT}`);
});
// server.listen(PORT, () => console.log(`✅ Server running with Socket.io on port ${PORT}`));
