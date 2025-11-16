import * as PIXI from "pixi.js";

// Kamu boleh hapus lerp ini nanti kalau sudah tidak dipakai di mana-mana,
// untuk sekarang biarkan saja kalau masih merasa perlu.
// function lerp(current, target, factor = 0.2) {
//     return current + (target - current) * factor;
// }

// Cache atlas yang sudah dimuat untuk efisiensi
const atlasCache = {};

// Fungsi untuk render semua avatar user (asynchronous)
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
                avatars[id] = {
                    sprite,
                    nameText,
                    // target posisi (untuk di-lerp di ticker)
                    targetX: u.x,
                    targetY: u.y,
                    // simpan arah
                    lastDirection: u.direction || "right",
                };
            } catch (err) {
                console.error("Failed to load avatar:", avatarUrl, err);
                continue;
            }
        } else {
            // Avatar sudah ada → update target posisi & arah
            const avatar = avatars[id];

            // HANYA UPDATE TARGET, JANGAN GERAKKAN SPRITE DI SINI
            avatar.targetX = u.x;
            avatar.targetY = u.y;

            // Update arah sprite berdasarkan direction user
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

            // Name text POSISI- nya akan diikuti di ticker nanti
            // di sini tidak usah set x/y lagi
        }
    }

    // Tetap pakai sorting by zIndex
    worldContainer.sortableChildren = true;
}