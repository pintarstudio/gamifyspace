import React, {useEffect, useRef, useState} from "react";
import * as PIXI from "pixi.js";
import socket from "../utils/socketClient";
import {initMap} from "../pixi/mapRenderer";
import {initObjects} from "../pixi/objectHandler";
import { initAvatars } from "../pixi/avatarHandler";

const VirtualSpacePixi = ({user}) => {
    const pixiContainer = useRef(null);
    const [currentRoom, setCurrentRoom] = useState("room1.json");
    const [roomData, setRoomData] = useState(null);
    const [users, setUsers] = useState({});
    const localUserRef = useRef(null);
    // console.log("User", user);

    // Handle room switching
    const handleRoomChange = (newRoom) => {
        console.log("🏠 Switching to:", newRoom);

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

            // Avatars
            initAvatars(app, worldContainer, checkCollision, TILE_SIZE, mapWidth, mapHeight, user, zoomFactor, localUserRef);

            // Smooth ticker updates for avatar movement
            PIXI.Ticker.shared.add(() => {
                if (!window.__avatars) return;
                for (const id in window.__avatars) {
                    const a = window.__avatars[id];
                    if (!a?.sprite) continue;
                    a.sprite.x += (a.targetX - a.sprite.x) * 0.15;
                    a.sprite.y += (a.targetY - a.sprite.y) * 0.15;
                    if (a.nameText) {
                        a.nameText.x = a.sprite.x;
                        a.nameText.y = a.sprite.y - a.sprite.height * 0.6;
                    }
                }
            });

            // Objects
            console.log("🧭 Calling initObjects...");
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