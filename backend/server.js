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
import {ensureAdminTables} from "./models/adminModel.js";
import {ensureCourseSchema} from "./models/courseModel.js";
import {ensureQuestionBankAdminTables} from "./models/adminQuestionBankModel.js";
import {ensureGamificationTables} from "./models/gamificationModel.js";
import {ensureCourseGroupSchema} from "./models/courseGroupModel.js";

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

app.use("/api", authRoutes);
app.use("/api/courses", courseRoutes);
app.use("/api/session", sessionRoutes);
app.use("/api/users", userRoutes);
app.use("/api/avatars", avatarRoutes);
app.use("/api/table", tableActivityRoutes);
app.use("/api/quiz", quizActivityRoutes);
app.use("/api/individual", individualActivityRoutes);
app.use("/api/virtualspace", virtualSpaceDashboardRoutes);
app.use("/api/admin", adminRoutes);
app.get("/", (req, res) => {
    res.json({status: "ok", message: "GamifySpace backend active"});
});

// ====== SOCKET.IO ======
let users = {};
let userRooms = {}; // Track which room each socket belongs to

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

io.on("connection", (socket) => {
    console.log("User connected:", socket.id);

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

        console.log(`${user.name || user.email} joined ${visibleRoom} in course ${courseId}`);
        io.to(scopedRoom).emit("update_users", getUsersInRoom(scopedRoom));

        logUserAction(user.user_id, "enter_room", {course_id: courseId, room: visibleRoom, position: {x: spawnX, y: spawnY}});
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

    socket.on("logout", () => {
        const u = users[socket.id];
        const scopedRoom = userRooms[socket.id];
        if (u && scopedRoom) {
            logUserAction(u.user_id, "logout", {course_id: u.course_id, room: u.room, position: {x: u.x, y: u.y}});
            io.to(scopedRoom).emit("user_left", u.user_id);
            delete users[socket.id];
            io.to(scopedRoom).emit("update_users", getUsersInRoom(scopedRoom));
        }
        delete userRooms[socket.id];
        console.log("👋 User logged out:", socket.id);
    });

    socket.on("disconnect", () => {
        const u = users[socket.id];
        const scopedRoom = userRooms[socket.id];
        if (u && scopedRoom) {
            logUserAction(u.user_id, "exit_room", {course_id: u.course_id, room: u.room, position: {x: u.x, y: u.y}});
            io.to(scopedRoom).emit("user_left", u.user_id); // 🔹 notify others
            delete users[socket.id];
            io.to(scopedRoom).emit("update_users", getUsersInRoom(scopedRoom));
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
        if (u.scopedRoom === scopedRoom) filtered[id] = u;
    }
    return filtered;
}

server.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Server berjalan di port ${PORT}`);
    console.log(`🌐 Akses dari komputer lain di jaringan ini: http://<IP-lokal-Mac>:${PORT}`);
});
// server.listen(PORT, () => console.log(`✅ Server running with Socket.io on port ${PORT}`));
