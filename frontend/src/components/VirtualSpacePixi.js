import React, {useEffect, useRef, useState} from "react";
import * as PIXI from "pixi.js";
import socket from "../utils/socketClient";
import {initMap} from "../pixi/mapRenderer";
import {initObjects} from "../pixi/objectHandler";
// import { initAvatars } from "../pixi/avatarHandler";

const VirtualSpacePixi = ({user}) => {
    const pixiContainer = useRef(null);
    const [currentRoom, setCurrentRoom] = useState("room1.json");
    const [roomData, setRoomData] = useState(null);
    const [users, setUsers] = useState({});
    const localUserRef = useRef(null);
    // console.log("User", user);

    // Handle room switching
    const handleRoomChange = (newRoom) => {
        //console.log("🏠 Switching to:", newRoom);

        // Update local user room info
        if (localUserRef.current) {
            localUserRef.current.room = newRoom;
            localUserRef.current.x = 400;
            localUserRef.current.y = 300;
        }

        // Update displayed room and notify server
        setCurrentRoom(newRoom);
        socket.emit("join_room", {
            user: localUserRef.current,
            room: newRoom,
        });
    };
    const initAvatars=(app, worldContainer, checkCollision, TILE_SIZE, mapWidth, mapHeight, user, zoomFactor, localUserRef)=> {
        const localKeyRef = {current: null};
        const avatars = {};
        window.__avatars = avatars;

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
            //console.log("➡️ Joining room (delayed):", activeRoom);
        }, 200);

        // Update users state saat menerima update dari server
        socket.on("update_users", async (usersData) => {
            //console.log("🔁 Received update_users for all rooms:", usersData);
            let myKey = null;
            const currentRoom = localUserRef.current?.room || "room1";
            const filteredUsers = Object.fromEntries(
                Object.entries(usersData).filter(([_, u]) => u.room === currentRoom)
            );
            //console.log("🏠 Filtered users for room:", currentRoom, filteredUsers);

            for (const [id, u] of Object.entries(filteredUsers)) {
                //console.log(`🔍 Checking user key=${id}`, u);
                if (
                    u.user_id === localUser.user_id ||
                    id === localUser.user_id ||
                    (u.email && u.email === user.email)
                ) {
                    //console.log("✅ Match found for local user:", id);
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
                    // Do NOT overwrite local x/y — only update room
                    localUser.room = filteredUsers[myKey].room || currentRoom;
                    localUserRef.current = localUser;
                }
            }

            await renderUsers(worldContainer, avatars, filteredUsers, localKeyRef, TILE_SIZE);
        });

        // Tangani user yang keluar (logout/disconnect)
        socket.on("user_left", (userId) => {
            //console.log(`🧹 User left: ${userId}`);
            if (avatars[userId]) {
                worldContainer.removeChild(avatars[userId]);
                delete avatars[userId];
            }
        });

        // Pindahkan logika movement dan camera follow ke modul terpisah
        initAvatarMovement(app, worldContainer, avatars, localUserRef, localKeyRef, checkCollision, TILE_SIZE, mapWidth, mapHeight, zoomFactor);

        return {localUserRef, localKeyRef};
    }
    // Fetch current room data
    useEffect(() => {
        // Fetch room JSON from public folder
        fetch(`/maps/${currentRoom}`)
            .then((response) => response.json())
            .then((data) => {
                setRoomData(data);
            })
            .catch((error) => {
                console.error("Failed to load room data:", error);
            });
    }, [currentRoom]);

    useEffect(() => {
        if (!roomData) return; // Do not run if roomData not loaded yet

        (async () => {
            const app = new PIXI.Application();
            // We'll get mapWidth, mapHeight, TILE_SIZE from initMap
            // But we need to set the app size initially to something reasonable (will be resized below)
            await app.init({
                width: 1280,
                height: 720,
                backgroundColor: 0xf0f0f0,
                antialias: true,
            });
            app.renderer.resize(window.innerWidth, window.innerHeight);

            const container = pixiContainer.current;
            if (!container) return;
            container.innerHTML = "";
            container.appendChild(app.canvas);
            app.canvas.style.display = "block";
            app.canvas.style.margin = "0";

            // Init Map
            const {worldContainer, checkCollision, TILE_SIZE, mapWidth, mapHeight} = await initMap(app, roomData);
            app.stage.addChild(worldContainer);

            // Zoom factor
            const zoomFactor = 1.5;
            worldContainer.scale.set(zoomFactor);
            worldContainer.x = (app.renderer.width - mapWidth * zoomFactor) / 2;
            worldContainer.y = (app.renderer.height - mapHeight * zoomFactor) / 2;
            //================================================================================================================================================

            // Avatars
            initAvatars(app, worldContainer, checkCollision, TILE_SIZE, mapWidth, mapHeight, user, zoomFactor, localUserRef);

            //============================================================================================================
            // Smooth ticker updates for avatar movement
            app.ticker.add(() => {
                if (!window.__avatars) return;

                for (const id in window.__avatars) {
                    const a = window.__avatars[id];
                    if (!a?.sprite) continue;

                    // Only apply smoothing if targetX/targetY are numeric (remote avatars)
                    if (typeof a.targetX === "number" && typeof a.targetY === "number") {
                        // Optional: use velocity if available
                        if (typeof a.vx === "number" && typeof a.vy === "number") {
                            a.sprite.x += a.vx * 0.5;
                            a.sprite.y += a.vy * 0.5;
                        }
                        // Soft correction toward the target
                        a.sprite.x += (a.targetX - a.sprite.x) * 0.05;
                        a.sprite.y += (a.targetY - a.sprite.y) * 0.05;
                    }

                    if (a.nameText) {
                        a.nameText.x = a.sprite.x;
                        a.nameText.y = a.sprite.y - a.sprite.height * 0.6;
                    }
                }
            });

            // Objects
            //console.log("🧭 Calling initObjects...");
            initObjects(app, worldContainer, roomData, user, localUserRef, zoomFactor, handleRoomChange);
            socket.emit("request_update_users", { room: localUserRef.current?.room || "room1.json" });

            // Cleanup
            return () => {
                socket.off("update_users");
                socket.off("user_moved");
                socket.off("user_left");
                app.destroy(true, true);
            };
        })();
    }, [roomData, user]);

    if (!roomData) {
        return null; // or loading indicator if desired
    }

    return (
        <div
            ref={pixiContainer}
            style={{
                width: "100vw",
                height: "100vh",
                background: "#dcdcdc",
                overflow: "hidden",
            }}
        />
    );
};

export default VirtualSpacePixi;

export async function renderUsers(worldContainer, avatars, usersData, localKeyRef, TILE_SIZE) {
    const atlasCache = {};
    // Hapus avatar yang sudah tidak ada di usersData
    Object.keys(avatars).forEach((id) => {
        if (!usersData[id]) {
            if (avatars[id].sprite) {
                worldContainer.removeChild(avatars[id].sprite);
            }
            if (avatars[id].nameText) {
                worldContainer.removeChild(avatars[id].nameText);
            }
            delete avatars[id];
        }
    });

    for (const [id, u] of Object.entries(usersData)) {
        // Tentukan URL avatar
        let avatarUrl;
        if (u.avatar_public_path && u.avatar_public_path.trim() !== "") {
            avatarUrl = `/avatars${u.avatar_public_path}/walk.json`;
        } else if (u.avatar && u.avatar.trim() !== "") {
            avatarUrl = u.avatar;
        } else {
            avatarUrl = "/avatars/default.png";
        }

        // Jika avatar untuk user ini belum ada → buat sprite & nameText
        if (!avatars[id]) {
            let sprite;

            try {
                if (avatarUrl.endsWith(".json")) {
                    // Gunakan cache atlas jika sudah pernah dimuat
                    const atlas = atlasCache[avatarUrl] || await PIXI.Assets.load(avatarUrl);
                    atlasCache[avatarUrl] = atlas;

                    const frames = [];
                    const animKeys = Object.keys(atlas.animations || {});
                    const firstAnimKey = animKeys.length > 0 ? animKeys[0] : null;

                    if (firstAnimKey) {
                        for (const frameItem of atlas.animations[firstAnimKey]) {
                            let texture;
                            if (typeof frameItem === "string") {
                                texture = atlas.textures[frameItem];
                            } else if (frameItem instanceof PIXI.Texture) {
                                texture = frameItem;
                            } else if (frameItem?.frame) {
                                // v8 style
                                texture = new PIXI.Texture(
                                    atlas.baseTexture ?? atlas.source?.baseTexture,
                                    frameItem.frame
                                );
                            }
                            if (texture) frames.push(texture);
                        }

                        if (frames.length > 0) {
                            sprite = new PIXI.AnimatedSprite(frames);
                            sprite.animationSpeed = 0.13;

                            // Save idle frame (first frame of animation)
                            sprite.idleTexture = frames[0];

                            // Do NOT play yet — default idle
                            sprite.gotoAndStop(0);
                        } else {
                            const texture = await PIXI.Assets.load("/avatars/default.png");
                            sprite = new PIXI.Sprite(texture);
                        }
                    } else {
                        const texture = await PIXI.Assets.load("/avatars/default.png");
                        sprite = new PIXI.Sprite(texture);
                    }
                } else {
                    const texture = await PIXI.Assets.load(avatarUrl);
                    sprite = new PIXI.Sprite(texture);
                }

                // Ukuran Avatar
                const scaleFactor = (TILE_SIZE * 3) / sprite.texture.width;
                sprite.scale.set(scaleFactor);
                sprite.anchor.set(0.5);
                sprite.baseScaleX = sprite.scale.x;
                sprite.zIndex = 1000;

                // SET POSISI AWAL LANGSUNG KE POSISI USER
                sprite.x = u.x;
                sprite.y = u.y;

                worldContainer.addChild(sprite);

                // Name text di atas kepala
                const nameText = new PIXI.Text(u.name || "User", {
                    fontSize: 12,
                    fill: "#000",
                    fontWeight: "bold",
                    align: "center",
                    textureStyle: {
                        scaleMode: "nearest",
                    },
                });

                nameText.zIndex = 1000;
                nameText.anchor.set(0.5);
                nameText.x = sprite.x;
                nameText.y = sprite.y - sprite.height * 0.6;
                worldContainer.addChild(nameText);

                // Simpan avatar + state tambahan
                const isLocal = id === localKeyRef.current;
                avatars[id] = {
                    sprite,
                    nameText,
                    // Only remote avatars get targetX/targetY for smoothing
                    ...(isLocal ? {} : { targetX: u.x, targetY: u.y }),
                    lastDirection: u.direction || "right",
                };
            } catch (err) {
                console.error("Failed to load avatar:", avatarUrl, err);
                continue;
            }
        } else {
            // Avatar sudah ada → update posisi & arah
            const avatar = avatars[id];

            // 1) UPDATE targetX/targetY untuk diinterpolasi di ticker (remote only)
            if (id !== localKeyRef.current) {
                avatar.targetX = u.x;
                avatar.targetY = u.y;
            }

            // 2) UPDATE ARAH SPRITE BERDASARKAN direction USER
            let dir = u.direction;
            if (!dir && avatar.lastDirection) {
                dir = avatar.lastDirection;
            }

            if (id !== localKeyRef.current) {
                // Remote user: pakai direction dari server
                if (dir === "left") {
                    avatar.sprite.scale.x = -avatar.sprite.baseScaleX;
                } else if (dir === "right") {
                    avatar.sprite.scale.x = avatar.sprite.baseScaleX;
                }
            } else {
                // Local user: kalau server belum sync, pakai lastDirection di localStorage
                const localDir = dir || localStorage.getItem("lastDirection") || "right";
                avatar.sprite.scale.x =
                    localDir === "left"
                        ? -avatar.sprite.baseScaleX
                        : avatar.sprite.baseScaleX;
                dir = localDir;
            }

            avatar.lastDirection = dir;

            // Remote avatars: play walk animation only if moving
            if (id !== localKeyRef.current) {
                const isMoving = u.vx !== 0 || u.vy !== 0; // server may not send velocity
                const deltaX = Math.abs(avatar.targetX - avatar.sprite.x);
                const deltaY = Math.abs(avatar.targetY - avatar.sprite.y);
                const moving = deltaX > 0.5 || deltaY > 0.5;

                if (moving) {
                    if (avatar.sprite.play) avatar.sprite.play();
                } else {
                    if (avatar.sprite.gotoAndStop) avatar.sprite.gotoAndStop(0);
                }
            }
        }
    }

    // Tetap pakai sorting by zIndex
    worldContainer.sortableChildren = true;
}

export function initAvatarMovement(app, worldContainer, avatars, localUserRef, localKeyRef, checkCollision, TILE_SIZE, mapWidth, mapHeight, zoomFactor) {
    const step = 2;
    let lastDirection = localUserRef.current?.direction || "right";
    const keys = {};

    // Hindari multi-attach ketika initAvatarMovement dipanggil berkali-kali
    if (!window.__gs_keysBound) {
        window.addEventListener("keydown", (e) => {
            // Cegah halaman scroll saat pakai Arrow keys
            if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(e.key)) e.preventDefault();
            keys[e.key] = true;
        }, {passive: false});
        window.addEventListener("keyup", (e) => {
            keys[e.key] = false;
        }, {passive: true});
        window.__gs_keysBound = true;
    }

    app.ticker.add(() => {
        // >>> Perbaikan utama: ambil localUser sebelum dipakai
        const localUser = localUserRef.current;
        if (!localUser) return;
        let moved = false;
        if (keys["ArrowUp"]) {
            moved = true;
        }
        if (keys["ArrowDown"]) {
            moved = true;
        }
        if (keys["ArrowLeft"]) {
            moved = true;
        }
        if (keys["ArrowRight"]) {
            moved = true;
        }
        if (moved) {
            let newX = localUser.x;
            let newY = localUser.y;
            // Persist last known direction
            let direction = lastDirection || "right";

            // Frame-rate independent movement
            // Clamp dt to avoid stutter on slower devices
            const dt = app.ticker.deltaMS / 16.67;   // Normalize to 60fps
            const clampedDt = Math.min(dt, 1.2);
            const scaledStep = step * clampedDt;

            if (keys["ArrowUp"]) newY -= scaledStep;
            if (keys["ArrowDown"]) newY += scaledStep;
            if (keys["ArrowLeft"]) {
                newX -= scaledStep;
                direction = "left";
            }
            if (keys["ArrowRight"]) {
                newX += scaledStep;
                direction = "right";
            }

            // Prevent movement into collision tiles
            if (!checkCollision(newX, newY)) {
                localUser.x = newX;
                localUser.y = newY;
            }

            // Clamp to map boundaries
            const margin = TILE_SIZE * 2;
            localUser.x = Math.max(margin, Math.min(localUser.x, mapWidth - margin));
            localUser.y = Math.max(margin, Math.min(localUser.y, mapHeight - margin));

            // Update avatar position visually
            const myKey = localKeyRef.current;
            if (myKey && avatars[myKey]) {

                avatars[myKey].sprite.x = localUser.x;
                avatars[myKey].sprite.y = localUser.y;
                avatars[myKey].nameText.x = localUser.x;
                avatars[myKey].nameText.y =
                    localUser.y - avatars[myKey].sprite.height * 0.6;

                if (direction === "left") {
                    avatars[myKey].sprite.scale.x = -avatars[myKey].sprite.baseScaleX;
                } else if (direction === "right") {
                    avatars[myKey].sprite.scale.x = avatars[myKey].sprite.baseScaleX;
                }

            const isMovingNow =
                keys["ArrowUp"] || keys["ArrowDown"] || keys["ArrowLeft"] || keys["ArrowRight"];

            if (isMovingNow) {
                if (avatars[myKey].sprite.play) avatars[myKey].sprite.play();
            } else {
                if (avatars[myKey].sprite.gotoAndStop) avatars[myKey].sprite.gotoAndStop(0);
            }
            }
            // Simpan arah terakhir di memori dan localStorage untuk persistensi antar-room
            localUser.direction = direction;
            lastDirection = direction;
            localStorage.setItem("lastDirection", direction);
            socket.emit("move", {
                id: localKeyRef.current || localUser.user_id,
                user_id: localUser.user_id,
                x: localUser.x,
                y: localUser.y,
                direction,
            });
        }
        else {
            // No movement → force idle animation for local avatar
            const myKey = localKeyRef.current;
            if (myKey && avatars[myKey]?.sprite) {
                if (avatars[myKey].sprite.gotoAndStop) {
                    avatars[myKey].sprite.gotoAndStop(0);
                }
            }
        }

        // Kamera mengikuti avatar (camera follow)
        const viewWidth = app.renderer.width;
        const viewHeight = app.renderer.height;
        const targetX = -localUser.x * zoomFactor + viewWidth / 2;
        const targetY = -localUser.y * zoomFactor + viewHeight / 2;

        // Batasi kamera agar tidak keluar batas map
        const maxX = 0;
        const maxY = 0;
        const minX = -mapWidth * zoomFactor + viewWidth;
        const minY = -mapHeight * zoomFactor + viewHeight;

        worldContainer.x = Math.min(maxX, Math.max(minX, targetX));
        worldContainer.y = Math.min(maxY, Math.max(minY, targetY));
    });

}