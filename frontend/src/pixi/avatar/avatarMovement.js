import socket from "../../utils/socketClient";

export function initAvatarMovement(app, worldContainer, avatars, localUserRef, localKeyRef, checkCollision, TILE_SIZE, mapWidth, mapHeight, zoomFactor) {
    const step = 1.4;
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

            if (keys["ArrowUp"]) newY -= step;
            if (keys["ArrowDown"]) newY += step;
            if (keys["ArrowLeft"]) {
                newX -= step;
                direction = "left";
            }
            if (keys["ArrowRight"]) {
                newX += step;
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