// src/pixi/avatarHandler.js
import * as PIXI from "pixi.js";
import socket from "../utils/socketClient";
import {renderUsers} from "./avatar/avatarRenderer";
import {initAvatarMovement} from "./avatar/avatarMovement";

export function initAvatars(app, worldContainer, checkCollision, TILE_SIZE, mapWidth, mapHeight, user, zoomFactor, localUserRef) {
    const localKeyRef = {current: null};
    const avatars = {};

    // Inisialisasi localUser dengan user_id agar server mengenali dengan benar
    const localUser = {
        user_id: user.user_id || user.id,
        avatar: user.avatar_public_path && user.avatar_public_path.trim() !== ""
            ? `/avatars${user.avatar_public_path}/walk.json`
            : user.avatar && user.avatar.trim() !== ""
                ? user.avatar
                : "/avatars/default.png",
        x: 400,
        y: 300,
        name: user.name || "User",
        room: localUserRef.current?.room || user.room || "room1",
    };
    localUserRef.current = localUser;

    // Setelah localUserRef.current = localUser;
    setTimeout(() => {
        const activeRoom = localUserRef.current.room || "room1";
        socket.emit("join_room", { user: localUserRef.current, room: activeRoom });
        console.log("➡️ Joining room (delayed):", activeRoom);
    }, 200);

    // Update users state saat menerima update dari server
    socket.on("update_users", async (usersData) => {
        console.log("🔁 Received update_users for all rooms:", usersData);
        let myKey = null;
        const currentRoom = localUserRef.current?.room || "room1";
        const filteredUsers = Object.fromEntries(
            Object.entries(usersData).filter(([_, u]) => u.room === currentRoom)
        );
        console.log("🏠 Filtered users for room:", currentRoom, filteredUsers);

        for (const [id, u] of Object.entries(filteredUsers)) {
            console.log(`🔍 Checking user key=${id}`, u);
            if (
                u.user_id === localUser.user_id ||
                id === localUser.user_id ||
                (u.email && u.email === user.email)
            ) {
                console.log("✅ Match found for local user:", id);
                myKey = id;
                break;
            }
        }

        if (!myKey) {
            console.warn("⚠️ Local user key not found in usersData, attempting fallback match...");
            myKey = Object.keys(filteredUsers).find(
                (id) => filteredUsers[id].name === localUser.name
            );
            if (myKey) {
                console.warn("⚠️ Fallback key used:", myKey);
            } else {
                console.error("❌ No matching user found even with fallback!");
            }
        }

        if (myKey) {
            localKeyRef.current = myKey;
            if (filteredUsers[myKey]) {
                localUser.x = filteredUsers[myKey].x;
                localUser.y = filteredUsers[myKey].y;
                localUser.room = filteredUsers[myKey].room || currentRoom;
                localUserRef.current = localUser;
            }
        }

        await renderUsers(worldContainer, avatars, filteredUsers, localKeyRef, TILE_SIZE);
    });

    // Tangani user yang keluar (logout/disconnect)
    socket.on("user_left", (userId) => {
        console.log(`🧹 User left: ${userId}`);
        if (avatars[userId]) {
            worldContainer.removeChild(avatars[userId]);
            delete avatars[userId];
        }
    });

    // Pindahkan logika movement dan camera follow ke modul terpisah
    initAvatarMovement(app, worldContainer, avatars, localUserRef, localKeyRef, checkCollision, TILE_SIZE, mapWidth, mapHeight, zoomFactor);

    return {localUserRef, localKeyRef};
}
