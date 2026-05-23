import React, {useEffect, useRef, useState} from "react";
import * as PIXI from "pixi.js";
import socket from "../utils/socketClient";
import {initMap} from "../pixi/mapRenderer";
import {initObjects} from "../pixi/objectHandler";
import {
    AVATAR_SHEET_DIRECTIONS,
    AVATAR_SHEET_FRAME_HEIGHT,
    AVATAR_SHEET_FRAME_WIDTH,
    AVATAR_SHEET_FRAMES_PER_DIRECTION,
    AVATAR_SHEET_RENDER_TILE_WIDTH,
    avatarFallbackSrc,
    avatarSpriteSheetSrc,
} from "../utils/avatarAssets";
// Controls how high the name label sits above the avatar.
// Increase these values to add more space.
const NAME_OFFSET_MULT = 1.15;   // multiplier of sprite height
const NAME_OFFSET_PX = 1;        // extra pixels
// import { initAvatars } from "../pixi/avatarHandler";

const randomSpawnPosition = () => ({
    x: Math.floor(Math.random() * (900 - 650 + 1)) + 650,
    y: Math.floor(Math.random() * (850 - 650 + 1)) + 650,
});

const avatarPositionStorageKey = (user, suffix = "position") => {
    const userKey = user?.user_id || user?.id || user?.email || "guest";
    const courseKey = user?.course_id || "course";
    return `gamifyit:avatar:${courseKey}:${userKey}:${suffix}`;
};

const readStoredAvatarPosition = (user, suffix = "position") => {
    try {
        const raw = localStorage.getItem(avatarPositionStorageKey(user, suffix));
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        const x = Number(parsed.x);
        const y = Number(parsed.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
        return {
            x,
            y,
            room: normalizeRoomName(parsed.room || "room1"),
            direction: parsed.direction || "right",
        };
    } catch (error) {
        return null;
    }
};

const saveStoredAvatarPosition = (user, position, suffix = "position") => {
    if (!position) return;
    try {
        localStorage.setItem(avatarPositionStorageKey(user, suffix), JSON.stringify({
            x: Number(position.x),
            y: Number(position.y),
            room: normalizeRoomName(position.room || "room1"),
            direction: position.direction || "right",
            saved_at: Date.now(),
        }));
    } catch (error) {
        // Ignore storage failures; avatar can still spawn normally.
    }
};

const clearStoredActivityStartPosition = (user) => {
    try {
        localStorage.removeItem(avatarPositionStorageKey(user, "activity-start"));
    } catch (error) {
        // Ignore storage failures.
    }
};

const avatarAnimationCache = {};

const avatarPublicPath = (user) => {
    if (user.avatar_public_path && user.avatar_public_path.trim() !== "") {
        return user.avatar_public_path;
    }
    return user.avatar && user.avatar.trim() !== "" ? user.avatar : null;
};

const textureFromFrame = (baseTexture, frame) => new PIXI.Texture({
    source: baseTexture.source,
    frame,
});

const buildDirectionalFrames = (texture) => {
    const framesByDirection = {};

    AVATAR_SHEET_DIRECTIONS.forEach((direction, directionIndex) => {
        framesByDirection[direction] = [];

        for (let i = 0; i < AVATAR_SHEET_FRAMES_PER_DIRECTION; i += 1) {
            const frameIndex = directionIndex * AVATAR_SHEET_FRAMES_PER_DIRECTION + i;
            framesByDirection[direction].push(textureFromFrame(
                texture,
                new PIXI.Rectangle(
                    frameIndex * AVATAR_SHEET_FRAME_WIDTH,
                    0,
                    AVATAR_SHEET_FRAME_WIDTH,
                    AVATAR_SHEET_FRAME_HEIGHT
                )
            ));
        }
    });

    return framesByDirection;
};

const loadAvatarAnimation = async (path) => {
    const cacheKey = path || "__default__";
    if (avatarAnimationCache[cacheKey]) return avatarAnimationCache[cacheKey];

    const loadPromise = (async () => {
        if (path) {
            const texture = await PIXI.Assets.load(avatarSpriteSheetSrc(path));
            return {
                frames: buildDirectionalFrames(texture),
                mode: "directional-sheet",
            };
        }

        const texture = await PIXI.Assets.load(avatarFallbackSrc());
        return {
            frames: {right: [texture], up: [texture], left: [texture], down: [texture]},
            mode: "static",
        };
    })();

    avatarAnimationCache[cacheKey] = loadPromise;
    return loadPromise;
};

const setAvatarDirection = (avatar, direction) => {
    const dir = direction || avatar.lastDirection || "right";
    const frames = avatar.framesByDirection?.[dir] || avatar.framesByDirection?.right;
    const sprite = avatar.sprite;

    if (frames && sprite.textures !== frames) {
        const wasPlaying = sprite.playing;
        sprite.textures = frames;
        sprite.gotoAndStop(0);
        if (wasPlaying && sprite.play) sprite.play();
    }

    sprite.scale.x = sprite.baseScaleX;
};

const normalizeRoomName = (room) => {
    const cleaned = String(room || "room1").trim().replace(/^\/+/, "");
    const fileName = cleaned.split("/").pop() || "room1";
    return fileName.replace(/\.json$/i, "") || "room1";
};

const roomFileName = (room) => `${normalizeRoomName(room)}.json`;

const createAvatarNameTag = (name) => {
    const paddingX = 8;
    const paddingY = 4;
    const borderSize = 2;
    const corner = 4;
    const container = new PIXI.Container();
    const label = new PIXI.Text({
        text: name || "User",
        style: {
            fontFamily: "monospace",
            fontSize: 11,
            fill: "#ffffff",
            fontWeight: "900",
            align: "center",
            stroke: {
                color: "#111827",
                width: 2,
            },
        },
        textureStyle: {
            scaleMode: "nearest",
        },
    });

    const width = Math.ceil(label.width + paddingX * 2);
    const height = Math.ceil(label.height + paddingY * 2);
    const shadow = new PIXI.Graphics()
        .rect(corner + 2, 2, width - corner * 2, height)
        .rect(2, corner + 2, width, height - corner * 2)
        .fill(0x111827);
    shadow.alpha = 0.5;

    const background = new PIXI.Graphics()
        .rect(corner, 0, width - corner * 2, height)
        .rect(0, corner, width, height - corner * 2)
        .fill(0x38bdf8)
        .rect(corner + borderSize, borderSize, width - (corner + borderSize) * 2, height - borderSize * 2)
        .rect(borderSize, corner + borderSize, width - borderSize * 2, height - (corner + borderSize) * 2)
        .fill(0x172033);

    const shine = new PIXI.Graphics()
        .rect(corner + borderSize, borderSize, width - (corner + borderSize) * 2, 1)
        .fill(0xffffff);
    shine.alpha = 0.24;

    label.x = width / 2;
    label.y = height / 2;
    label.anchor.set(0.5);
    container.addChild(shadow, background, shine, label);
    container.pivot.set(width / 2, height);
    container.__bubbleHeight = height;
    return container;
};

const createAvatarStatusBubble = (text) => {
    const paddingX = 7;
    const paddingY = 4;
    const borderSize = 2;
    const corner = 4;
    const container = new PIXI.Container();
    const label = new PIXI.Text({
        text,
        style: {
            fontFamily: "monospace",
            fontSize: 10,
            fill: "#fff7ed",
            fontWeight: "900",
            align: "center",
            wordWrap: true,
            wordWrapWidth: 130,
            lineHeight: 14,
            stroke: {
                color: "#111827",
                width: 2,
            },
        },
        textureStyle: {
            scaleMode: "nearest",
        },
    });

    const width = Math.ceil(label.width + paddingX * 2);
    const height = Math.ceil(label.height + paddingY * 2);
    const shadow = new PIXI.Graphics()
        .rect(corner + 2, 2, width - corner * 2, height)
        .rect(2, corner + 2, width, height - corner * 2)
        .fill(0x111827);
    shadow.alpha = 0.48;

    const background = new PIXI.Graphics()
        .rect(corner, 0, width - corner * 2, height)
        .rect(0, corner, width, height - corner * 2)
        .fill(0xf59e0b)
        .rect(corner + borderSize, borderSize, width - (corner + borderSize) * 2, height - borderSize * 2)
        .rect(borderSize, corner + borderSize, width - borderSize * 2, height - (corner + borderSize) * 2)
        .fill(0x3b2a12);

    label.x = width / 2;
    label.y = height / 2;
    label.anchor.set(0.5);
    container.addChild(shadow, background, label);
    container.pivot.set(width / 2, height);
    container.__bubbleHeight = height;
    container.__statusText = text;
    return container;
};

const isActiveAvatarStatus = (status) =>
    !!status?.label && (!status.expires_at || Number(status.expires_at) > Date.now());

const labelRect = (display, padding = 3) => {
    if (!display || display.destroyed) return null;
    const width = Math.max(1, display.width || display.getLocalBounds?.()?.width || 1);
    const height = Math.max(1, display.height || display.getLocalBounds?.()?.height || 1);
    const pivotX = display.pivot?.x || 0;
    const pivotY = display.pivot?.y || 0;
    return {
        x: display.x - pivotX - padding,
        y: display.y - pivotY - padding,
        width: width + padding * 2,
        height: height + padding * 2,
    };
};

const rectsOverlap = (a, b) =>
    !!a && !!b
    && a.x < b.x + b.width
    && a.x + a.width > b.x
    && a.y < b.y + b.height
    && a.y + a.height > b.y;

const positionAvatarLabels = (avatar) => {
    if (!avatar?.sprite) return;
    const nameText = avatar.nameText;
    const statusText = avatar.statusText;

    if (nameText) {
        nameText.x = avatar.sprite.x;
        nameText.y = avatar.sprite.y - avatar.sprite.height * NAME_OFFSET_MULT - NAME_OFFSET_PX;
        nameText.zIndex = avatar.sprite.zIndex + 1;
    }

    if (statusText && nameText) {
        statusText.x = avatar.sprite.x;
        statusText.y = nameText.y - (nameText.__bubbleHeight || nameText.height || 18) - 5;
        statusText.zIndex = avatar.sprite.zIndex + 2;
    }
};

const resolveAvatarLabelVisibility = (worldContainer, avatars, localKey) => {
    const candidates = [];
    if (worldContainer.__objectPromptCollisionRect?.rect) {
        candidates.push({
            display: null,
            rect: worldContainer.__objectPromptCollisionRect.rect,
            priority: worldContainer.__objectPromptCollisionRect.priority || 95,
            type: "object-prompt",
            id: "nearest-object",
        });
    }

    Object.entries(avatars).forEach(([id, avatar]) => {
        if (!avatar?.sprite || avatar.sprite.destroyed) return;
        const isLocal = id === localKey;

        if (avatar.statusText) {
            candidates.push({
                display: avatar.statusText,
                rect: labelRect(avatar.statusText, 4),
                priority: isLocal ? 100 : 70,
                type: "avatar-status",
                id,
            });
        }

        if (avatar.nameText) {
            candidates.push({
                display: avatar.nameText,
                rect: labelRect(avatar.nameText, 3),
                priority: isLocal ? 90 : 50,
                type: "avatar-name",
                id,
            });
        }
    });

    const accepted = [];
    candidates
        .filter((item) => item.rect)
        .sort((a, b) => b.priority - a.priority)
        .forEach((item) => {
            const collides = accepted.some((acceptedItem) =>
                acceptedItem.id !== item.id && rectsOverlap(item.rect, acceptedItem.rect)
            );
            if (item.display) item.display.visible = !collides;
            if (!collides) accepted.push(item);
        });

    worldContainer.__labelCollisionRects = accepted.map(({rect, priority, type, id}) => ({
        rect,
        priority,
        type,
        id,
    }));
};

const updateAvatarStatusBubble = (worldContainer, avatar, status) => {
    const nextText = isActiveAvatarStatus(status) ? status.label : null;

    if (!nextText) {
        if (avatar.statusText) {
            worldContainer.removeChild(avatar.statusText);
            avatar.statusText.destroy({children: true});
            avatar.statusText = null;
        }
        return;
    }

    if (!avatar.statusText || avatar.statusText.__statusText !== nextText) {
        if (avatar.statusText) {
            worldContainer.removeChild(avatar.statusText);
            avatar.statusText.destroy({children: true});
        }
        avatar.statusText = createAvatarStatusBubble(nextText);
        worldContainer.addChild(avatar.statusText);
    }
    positionAvatarLabels(avatar);
};

const destroyPixiApp = (app) => {
    if (!app) return;
    try {
        app.ticker?.stop();
        app.destroy(true, {
            children: true,
            texture: false,
            textureSource: false,
        });
    } catch (error) {
        console.warn("Pixi cleanup skipped:", error);
    }
};

const VirtualSpacePixi = ({user, onOpenActivity, activityPanelOpen = false}) => {
    const pixiContainer = useRef(null);
    const [currentRoom, setCurrentRoom] = useState(() =>
        roomFileName(readStoredAvatarPosition(user, "activity-start")?.room
            || readStoredAvatarPosition(user, "position")?.room
            || "room1")
    );
    const [roomData, setRoomData] = useState(null);
    const localUserRef = useRef(null);
    const activityPanelOpenRef = useRef(activityPanelOpen);
    const onOpenActivityRef = useRef(onOpenActivity);
    // console.log("User", user);

    useEffect(() => {
        activityPanelOpenRef.current = activityPanelOpen;
        window.__virtualActivityModalOpen = activityPanelOpen;

        return () => {
            window.__virtualActivityModalOpen = false;
        };
    }, [activityPanelOpen]);

    useEffect(() => {
        onOpenActivityRef.current = onOpenActivity;
    }, [onOpenActivity]);

    // Handle room switching
    const handleRoomChange = (newRoom) => {
        //console.log("🏠 Switching to:", newRoom);
        const nextRoom = normalizeRoomName(newRoom);

        // Update local user room info
        if (localUserRef.current) {
            const spawnPosition = randomSpawnPosition();
            localUserRef.current.room = nextRoom;
            localUserRef.current.course_id = user.course_id;
            localUserRef.current.x = spawnPosition.x;
            localUserRef.current.y = spawnPosition.y;
            saveStoredAvatarPosition(user, localUserRef.current);
            clearStoredActivityStartPosition(user);
        }

        // Update displayed room and notify server
        setCurrentRoom(roomFileName(nextRoom));
        socket.emit("join_room", {
            user: localUserRef.current,
            room: nextRoom,
        });
    };
    const initAvatars = (app, worldContainer, checkCollision, TILE_SIZE, mapWidth, mapHeight, user, zoomFactor, localUserRef) => {
        const localKeyRef = {current: null};
        const avatars = {};
        window.__avatars = avatars;

        // Inisialisasi localUser dengan user_id agar server mengenali dengan benar
        const restoredPosition = readStoredAvatarPosition(user, "activity-start")
            || readStoredAvatarPosition(user, "position");
        const spawnPosition = restoredPosition || randomSpawnPosition();
        const localUser = {
            user_id: user.user_id || user.id,
            avatar: avatarPublicPath(user),
            x: spawnPosition.x,
            y: spawnPosition.y,
            name: user.name || "User",
            course_id: user.course_id,
            direction: restoredPosition?.direction || localStorage.getItem("lastDirection") || "right",
            room: normalizeRoomName(restoredPosition?.room || localUserRef.current?.room || user.room || currentRoom || "room1"),
        };
        localUserRef.current = localUser;

        // Setelah localUserRef.current = localUser;
        setTimeout(() => {
            const activeRoom = normalizeRoomName(localUserRef.current.room || "room1");
            localUserRef.current.room = activeRoom;
            socket.emit("join_room", {user: localUserRef.current, room: activeRoom});
            //console.log("➡️ Joining room (delayed):", activeRoom);
        }, 200);

        // Update users state saat menerima update dari server
        socket.on("update_users", async (usersData) => {
            //console.log("🔁 Received update_users for all rooms:", usersData);
            let myKey = null;
            const currentRoom = normalizeRoomName(localUserRef.current?.room || "room1");
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
                    localUser.room = normalizeRoomName(filteredUsers[myKey].room || currentRoom);
                    localUser.activity_status = filteredUsers[myKey].activity_status || null;
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
        const cleanupMovement = initAvatarMovement(app, worldContainer, avatars, localUserRef, localKeyRef, checkCollision, TILE_SIZE, mapWidth, mapHeight, zoomFactor, user);

        return {localUserRef, localKeyRef, cleanupMovement};
    }
    // Fetch current room data
    useEffect(() => {
        // Fetch room JSON from public folder
        fetch(`/maps/${roomFileName(currentRoom)}`)
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

        let cleanupPixi = null;
        let cancelled = false;

        (async () => {
            // Pixel-art friendly rendering: avoid texture bleeding / seams when zooming
            //PIXI.TextureStyle.defaultOptions.scaleMode = 'nearest'; // untuk zoom 1.5 tapi kualitas render kurang baik
            const app = new PIXI.Application();
            // We'll get mapWidth, mapHeight, TILE_SIZE from initMap
            // But we need to set the app size initially to something reasonable (will be resized below)
            await app.init({
                width: 1280,
                height: 720,
                backgroundColor: 0xf0f0f0,
                antialias: false,
            });
            // Round rendering to whole pixels to prevent grey seams between tiles at non-integer zoom
            const container = pixiContainer.current;
            if (!container) return;
            if (cancelled) {
                destroyPixiApp(app);
                return;
            }
            container.innerHTML = "";
            container.appendChild(app.canvas);
            app.canvas.style.display = "block";
            app.canvas.style.margin = "0";

            // Init Map
            const {worldContainer, checkCollision, TILE_SIZE, mapWidth, mapHeight} = await initMap(app, roomData);
            app.stage.addChild(worldContainer);

            // Zoom factor
            const zoomFactor = 1;
            worldContainer.scale.set(zoomFactor);

            const resizeToContainer = () => {
                const width = Math.max(320, container.clientWidth || window.innerWidth);
                const height = Math.max(320, container.clientHeight || window.innerHeight);
                app.renderer.resize(width, height);
                // IMPORTANT: keep container aligned to whole pixels to avoid tile seams at zoom 1.5
                worldContainer.x = Math.round((app.renderer.width - mapWidth * zoomFactor) / 2);
                worldContainer.y = Math.round((app.renderer.height - mapHeight * zoomFactor) / 2);
            };
            resizeToContainer();
            window.addEventListener("resize", resizeToContainer);
            //================================================================================================================================================

            // Avatars
            const avatarRuntime = initAvatars(app, worldContainer, checkCollision, TILE_SIZE, mapWidth, mapHeight, user, zoomFactor, localUserRef);

            //============================================================================================================
            // Smooth ticker updates for avatar movement
            const smoothAvatarTicker = () => {
                if (cancelled || !app.renderer || worldContainer.destroyed) return;
                if (!window.__avatars) return;

                for (const id in window.__avatars) {
                    const a = window.__avatars[id];
                    if (!a?.sprite || a.sprite.destroyed) continue;

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

                    // Keep depth sorting correct for moving avatars (sort by feet Y)
                    a.sprite.zIndex = a.sprite.y;

                    positionAvatarLabels(a);
                }
                resolveAvatarLabelVisibility(worldContainer, window.__avatars, avatarRuntime?.localKeyRef?.current);
            };
            app.ticker.add(smoothAvatarTicker);

            // Objects
            //console.log("🧭 Calling initObjects...");
            initObjects(app, worldContainer, roomData, user, localUserRef, zoomFactor, handleRoomChange, {
                onOpenActivity: (launch) => {
                    const localUser = localUserRef.current;
                    if (localUser) {
                        const position = {
                            x: localUser.x,
                            y: localUser.y,
                            room: localUser.room || currentRoom,
                            direction: localUser.direction || "right",
                        };
                        saveStoredAvatarPosition(user, position, "activity-start");
                        saveStoredAvatarPosition(user, position, "position");
                    }
                    return onOpenActivityRef.current?.(launch);
                },
                isInteractionDisabled: () => activityPanelOpenRef.current,
            });
            socket.emit("request_update_users", {
                course_id: user.course_id,
                room: normalizeRoomName(localUserRef.current?.room || currentRoom || "room1"),
            });

            cleanupPixi = () => {
                app.ticker.remove(smoothAvatarTicker);
                avatarRuntime?.cleanupMovement?.();
                window.removeEventListener("resize", resizeToContainer);
                socket.off("update_users");
                socket.off("user_moved");
                socket.off("user_left");
                if (window.__avatars) window.__avatars = null;
                destroyPixiApp(app);
            };
        })();

        return () => {
            cancelled = true;
            if (cleanupPixi) cleanupPixi();
        };
    }, [roomData, user]);

    if (!roomData) {
        return null; // or loading indicator if desired
    }

    return (
        <div
            ref={pixiContainer}
            style={{
                width: "100%",
                height: "100%",
                background: "#dcdcdc",
                overflow: "hidden",
            }}
        />
    );
};

export default VirtualSpacePixi;

export async function renderUsers(worldContainer, avatars, usersData, localKeyRef, TILE_SIZE) {
    // Hapus avatar yang sudah tidak ada di usersData
    Object.keys(avatars).forEach((id) => {
        if (!usersData[id]) {
            if (avatars[id].sprite) {
                worldContainer.removeChild(avatars[id].sprite);
            }
            if (avatars[id].nameText) {
                worldContainer.removeChild(avatars[id].nameText);
            }
            if (avatars[id].statusText) {
                worldContainer.removeChild(avatars[id].statusText);
            }
            delete avatars[id];
        }
    });

    for (const [id, u] of Object.entries(usersData)) {
        const avatarPath = avatarPublicPath(u);

        // Jika avatar untuk user ini belum ada → buat sprite & nameText
        if (!avatars[id]) {
            let sprite;

            try {
                const animation = await loadAvatarAnimation(avatarPath);
                const initialDirection = u.direction || "right";
                const initialFrames = animation.frames[initialDirection] || animation.frames.right;

                sprite = new PIXI.AnimatedSprite(initialFrames);
                sprite.animationSpeed = 0.13;
                sprite.gotoAndStop(0);

                // Ukuran Avatar
                const targetAvatarWidth = animation.mode === "directional-sheet"
                    ? TILE_SIZE * AVATAR_SHEET_RENDER_TILE_WIDTH
                    : TILE_SIZE * 3;
                const scaleFactor = targetAvatarWidth / sprite.texture.width;
                sprite.scale.set(scaleFactor);

// Top-down: x/y represents FEET so the head can go behind walls
                sprite.anchor.set(0.5, 1);

// Save base scale for left/right flipping (always positive)
                sprite.baseScaleX = Math.abs(sprite.scale.x);

// zIndex will be set after positioning (sort by feet Y)

                // SET POSISI AWAL LANGSUNG KE POSISI USER (feet position)
                sprite.x = u.x;
                sprite.y = u.y;

// Depth sorting by feet Y
                sprite.zIndex = sprite.y;

                worldContainer.addChild(sprite);

                const nameText = createAvatarNameTag(u.name || "User");

                nameText.zIndex = sprite.zIndex + 1;
                nameText.x = sprite.x;
                nameText.y = sprite.y - sprite.height * NAME_OFFSET_MULT - NAME_OFFSET_PX;
                worldContainer.addChild(nameText);

                // Simpan avatar + state tambahan
                const isLocal = id === localKeyRef.current;
                avatars[id] = {
                    sprite,
                    nameText,
                    statusText: null,
                    framesByDirection: animation.frames,
                    animationMode: animation.mode,
                    // Only remote avatars get targetX/targetY for smoothing
                    ...(isLocal ? {} : {targetX: u.x, targetY: u.y}),
                    lastDirection: u.direction || "right",
                };
                setAvatarDirection(avatars[id], u.direction || "right");
                updateAvatarStatusBubble(worldContainer, avatars[id], u.activity_status);
            } catch (err) {
                console.error("Failed to load avatar:", avatarPath, err);
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
            updateAvatarStatusBubble(worldContainer, avatar, u.activity_status);

            // 2) UPDATE ARAH SPRITE BERDASARKAN direction USER
            let dir = u.direction;
            if (!dir && avatar.lastDirection) {
                dir = avatar.lastDirection;
            }

            if (id === localKeyRef.current) {
                // Local user: kalau server belum sync, pakai lastDirection di localStorage
                dir = dir || localStorage.getItem("lastDirection") || "right";
            }

            setAvatarDirection(avatar, dir);

            avatar.lastDirection = dir;

            // Remote avatars: play walk animation only if moving
            if (id !== localKeyRef.current) {
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
    resolveAvatarLabelVisibility(worldContainer, avatars, localKeyRef.current);
}

export function initAvatarMovement(app, worldContainer, avatars, localUserRef, localKeyRef, checkCollision, TILE_SIZE, mapWidth, mapHeight, zoomFactor, user) {
    const step = 2;
    let lastDirection = localUserRef.current?.direction || "right";
    if (!window.__gs_keys) window.__gs_keys = {};
    const keys = window.__gs_keys;
    const clearMovementKeys = () => {
        keys.ArrowUp = false;
        keys.ArrowDown = false;
        keys.ArrowLeft = false;
        keys.ArrowRight = false;
    };

    // Hindari multi-attach ketika initAvatarMovement dipanggil berkali-kali
    if (!window.__gs_keysBound) {
        window.addEventListener("keydown", (e) => {
            if (window.__virtualActivityModalOpen) {
                clearMovementKeys();
                return;
            }
            const target = e.target;
            const isTyping = target && (
                target.tagName === "INPUT" ||
                target.tagName === "TEXTAREA" ||
                target.tagName === "SELECT" ||
                target.isContentEditable
            );
            if (isTyping) return;
            // Cegah halaman scroll saat pakai Arrow keys
            if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(e.key)) e.preventDefault();
            window.__gs_keys[e.key] = true;
        }, {passive: false});
        window.addEventListener("keyup", (e) => {
            window.__gs_keys[e.key] = false;
        }, {passive: true});
        window.__gs_keysBound = true;
    }

    const movementTicker = () => {
        // >>> Perbaikan utama: ambil localUser sebelum dipakai
        if (!app.renderer || worldContainer.destroyed) return;
        if (window.__virtualActivityModalOpen) {
            clearMovementKeys();
            const myKey = localKeyRef.current;
            if (myKey && avatars[myKey]?.sprite && !avatars[myKey].sprite.destroyed) {
                avatars[myKey].sprite.gotoAndStop?.(0);
            }
            return;
        }
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

            if (keys["ArrowUp"]) {
                newY -= scaledStep;
                direction = "up";
            }
            if (keys["ArrowDown"]) {
                newY += scaledStep;
                direction = "down";
            }
            if (keys["ArrowLeft"]) {
                newX -= scaledStep;
                direction = "left";
            }
            if (keys["ArrowRight"]) {
                newX += scaledStep;
                direction = "right";
            }

            // Prevent movement into collision tiles (feet collider)
            // Use axis-separated resolution so bumping horizontally doesn't let part of the sprite clip into walls.
            const rx = TILE_SIZE * 0.9; // horizontal shoe radius (slightly larger than before)
            const ry = TILE_SIZE * 0.25; // vertical shoe radius

            const isBlockedAt = (x, y) => {
                // Sample a small set of points around the feet area.
                // Extra diagonal points prevent left/right "partial" clipping when sliding along a wall.
                return (
                    checkCollision(x, y) ||
                    checkCollision(x - rx, y) ||
                    checkCollision(x + rx, y) ||
                    checkCollision(x, y - ry) ||
                    checkCollision(x - rx, y - ry) ||
                    checkCollision(x + rx, y - ry)
                );
            };

            // Resolve X then Y (allows sliding along walls)
            let nextX = localUser.x;
            let nextY = localUser.y;

            if (!isBlockedAt(newX, localUser.y)) {
                nextX = newX;
            }
            if (!isBlockedAt(nextX, newY)) {
                nextY = newY;
            }

            localUser.x = nextX;
            localUser.y = nextY;

            // Clamp to map boundaries
            const margin = TILE_SIZE * 2;
            localUser.x = Math.max(margin, Math.min(localUser.x, mapWidth - margin));
            localUser.y = Math.max(margin, Math.min(localUser.y, mapHeight - margin));

            // Update avatar position visually
            const myKey = localKeyRef.current;
            if (myKey && avatars[myKey]?.sprite && !avatars[myKey].sprite.destroyed) {

                avatars[myKey].sprite.x = localUser.x;
                avatars[myKey].sprite.y = localUser.y;
                // Depth sorting by feet Y
                avatars[myKey].sprite.zIndex = avatars[myKey].sprite.y;

                if (avatars[myKey].nameText && !avatars[myKey].nameText.destroyed) {
                    positionAvatarLabels(avatars[myKey]);
                }

                setAvatarDirection(avatars[myKey], direction);

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
            saveStoredAvatarPosition(user, {
                x: localUser.x,
                y: localUser.y,
                room: localUser.room || "room1",
                direction,
            });
            clearStoredActivityStartPosition(user);
            socket.emit("move", {
                id: localKeyRef.current || localUser.user_id,
                user_id: localUser.user_id,
                x: localUser.x,
                y: localUser.y,
                direction,
            });
        } else {
            // No movement → force idle animation for local avatar
            const myKey = localKeyRef.current;
            if (myKey && avatars[myKey]?.sprite && !avatars[myKey].sprite.destroyed) {
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

        // Keep camera aligned to whole pixels to avoid grey seams between tiles
        worldContainer.x = Math.round(Math.min(maxX, Math.max(minX, targetX)));
        worldContainer.y = Math.round(Math.min(maxY, Math.max(minY, targetY)));
    };
    app.ticker.add(movementTicker);
    return () => app.ticker.remove(movementTicker);

}
