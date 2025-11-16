import * as PIXI from "pixi.js";

function lerp(current, target, factor = 0.2) {
    return current + (target - current) * factor;
}

// Cache atlas yang sudah dimuat untuk efisiensi
const atlasCache = {};

// Fungsi untuk render semua avatar user (asynchronous)
export async function renderUsers(worldContainer, avatars, usersData, localKeyRef, TILE_SIZE) {
    // Hapus avatar yang sudah tidak ada di usersData
    Object.keys(avatars).forEach((id) => {
        if (!usersData[id]) {
            worldContainer.removeChild(avatars[id].sprite);
            worldContainer.removeChild(avatars[id].nameText);
            delete avatars[id];
        }
    });

    for (const [id, u] of Object.entries(usersData)) {
        let avatarUrl;
        if (u.avatar_public_path && u.avatar_public_path.trim() !== "") {
            avatarUrl = `/avatars${u.avatar_public_path}/walk.json`;
        } else if (u.avatar && u.avatar.trim() !== "") {
            avatarUrl = u.avatar;
        } else {
            avatarUrl = "/avatars/default.png";
        }
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
                            if (typeof frameItem === "string") texture = atlas.textures[frameItem];
                            else if (frameItem instanceof PIXI.Texture) texture = frameItem;
                            else if (frameItem?.frame) texture = new PIXI.Texture(atlas.baseTexture ?? atlas.source?.baseTexture, frameItem.frame);
                            if (texture) frames.push(texture);
                        }
                        if (frames.length > 0) {
                            sprite = new PIXI.AnimatedSprite(frames);
                            sprite.animationSpeed = 0.13;
                            sprite.play();
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
                worldContainer.addChild(sprite);

                const nameText = new PIXI.Text(u.name || "User", {
                    fontSize: 12,
                    fill: "#000",
                    fontWeight: "bold",
                    align: "center",
                    textureStyle: {
                        scaleMode: 'nearest',
                    }
                });
                nameText.zIndex=1000;
                nameText.anchor.set(0.5);
                nameText.x = u.x;
                nameText.y = u.y - sprite.height * 0.6;
                worldContainer.addChild(nameText);

                avatars[id] = {sprite, nameText};
            } catch (err) {
                console.error("Failed to load avatar:", avatarUrl, err);
                continue;
            }
        }

        // Set posisi awal avatar baru tanpa efek lerp
        if (avatars[id].sprite.x === 0 && avatars[id].sprite.y === 0) {
            avatars[id].sprite.x = u.x;
            avatars[id].sprite.y = u.y;
        } else {
            // Smooth (lerp) position update
            avatars[id].sprite.x = lerp(avatars[id].sprite.x, u.x);
            avatars[id].sprite.y = lerp(avatars[id].sprite.y, u.y);
        }

        // Update arah sprite berdasarkan direction user (kecuali avatar lokal)
        if (id !== localKeyRef.current) {
            let dir = u.direction;
            if (!dir && avatars[id].lastDirection) {
                dir = avatars[id].lastDirection;
            }

            if (dir === "left") {
                avatars[id].sprite.scale.x = -avatars[id].sprite.baseScaleX;
            } else if (dir === "right") {
                avatars[id].sprite.scale.x = avatars[id].sprite.baseScaleX;
            }

            avatars[id].lastDirection = dir; // simpan arah terakhir
        } else {
            // untuk local user, gunakan direction lokal jika server belum sync
            const localDir = u.direction || localStorage.getItem("lastDirection") || "right";
            avatars[id].sprite.scale.x = (localDir === "left")
                ? -avatars[id].sprite.baseScaleX
                : avatars[id].sprite.baseScaleX;
            avatars[id].lastDirection = localDir;
        }

        avatars[id].nameText.x = avatars[id].sprite.x;
        avatars[id].nameText.y = avatars[id].sprite.y - avatars[id].sprite.height * 0.6;
    }

    worldContainer.sortableChildren = true;
}