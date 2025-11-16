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

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {origin: ["http://192.168.100.21:3000", "http://localhost:3000"], methods: ["GET", "POST"]},
});
const PORT = process.env.PORT || 4000;
const PgSession = pgSession(session);

// ====== MIDDLEWARE & ROUTES ======
app.use(
    cors({
        origin: ["http://192.168.100.21:3000", "http://localhost:3000"],
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
app.get("/", (req, res) => {
    res.json({status: "ok", message: "GamifySpace backend active"});
});

// ====== SOCKET.IO ======
let users = {};
let userRooms = {}; // Track which room each socket belongs to

io.on("connection", (socket) => {
    console.log("User connected:", socket.id);

    // Join room handler
    socket.on("join_room", ({user, room}) => {
        if (!user || !room) return;
        // Leave previous room if any
        const prevRoom = userRooms[socket.id];
        if (prevRoom) socket.leave(prevRoom);

        // Join new room
        socket.join(room);

        // Update room lama
        if (prevRoom && prevRoom !== room) {
            io.to(prevRoom).emit("update_users", getUsersInRoom(prevRoom));
        }

        // Broadcast ke room baru setelah update
        io.to(room).emit("update_users", getUsersInRoom(room));

        userRooms[socket.id] = room;

        // Register user in the room
        users[socket.id] = {...user, room, x: 400, y: 300, direction: "right", lastLogTime: Date.now()};

        console.log(`${user.name || user.email} joined ${room}`);
        io.to(room).emit("update_users", getUsersInRoom(room));

        logUserAction(user.user_id, "enter_room", {room, position: {x: 400, y: 300}});
    });

    socket.on("move", (pos) => {
        const u = users[socket.id];
        if (!u) return;
        const room = userRooms[socket.id];
        if (!room) return;

        // Update position
        u.x = pos.x;
        u.y = pos.y;
        u.direction = pos.direction;

        const now = Date.now();
        if (!u.lastEmitTime || now - u.lastEmitTime > 100) {
            io.to(room).emit("update_users", getUsersInRoom(room));
            u.lastEmitTime = now;
        }

        // Logging every 10 seconds
        if (now - u.lastLogTime >= 10000) {
            u.lastLogTime = now;
            logUserAction(u.user_id, "move", {room, position: {x: pos.x, y: pos.y}});
        }
    });

    socket.on("interact_obj", (data) => {
        if (!data?.user_id) return;
        const {user_id, object_name, url, action, targetRoom} = data;
        logUserAction(user_id, "interact_obj", {object_name, url, action, targetRoom});
    });

    socket.on("logout", () => {
        const u = users[socket.id];
        const room = userRooms[socket.id];
        if (u && room) {
            logUserAction(u.user_id, "logout", {room, position: {x: u.x, y: u.y}});
            io.to(room).emit("user_left", u.user_id);
            delete users[socket.id];
            io.to(room).emit("update_users", getUsersInRoom(room));
        }
        delete userRooms[socket.id];
        console.log("👋 User logged out:", socket.id);
    });

    socket.on("disconnect", () => {
        const u = users[socket.id];
        const room = userRooms[socket.id];
        if (u && room) {
            logUserAction(u.user_id, "exit_room", {room, position: {x: u.x, y: u.y}});
            io.to(room).emit("user_left", u.user_id); // 🔹 notify others
            delete users[socket.id];
            io.to(room).emit("update_users", getUsersInRoom(room));
        }
        delete userRooms[socket.id];
        console.log("🔴 User disconnected:", socket.id);
    });

    socket.on("request_update_users", ({room}) => {
        io.to(socket.id).emit("update_users", getUsersInRoom(room));
    });
});

// Helper function
function getUsersInRoom(room) {
    const filtered = {};
    for (const [id, u] of Object.entries(users)) {
        if (u.room === room) filtered[id] = u;
    }
    return filtered;
}

server.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Server berjalan di port ${PORT}`);
    console.log(`🌐 Akses dari komputer lain di jaringan ini: http://<IP-lokal-Mac>:${PORT}`);
});
// server.listen(PORT, () => console.log(`✅ Server running with Socket.io on port ${PORT}`));