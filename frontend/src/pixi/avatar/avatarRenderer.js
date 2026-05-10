import * as PIXI from "pixi.js";

// Kamu boleh hapus lerp ini nanti kalau sudah tidak dipakai di mana-mana,
// untuk sekarang biarkan saja kalau masih merasa perlu.
// function lerp(current, target, factor = 0.2) {
//     return current + (target - current) * factor;
// }

// Cache atlas yang sudah dimuat untuk efisiensi
const atlasCache = {};

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
    return container;
};

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

                const nameText = createAvatarNameTag(u.name || "User");

                nameText.zIndex = 1000;
                nameText.x = sprite.x;
                nameText.y = sprite.y - sprite.height * 0.6;
                worldContainer.addChild(nameText);

                // Simpan avatar + state tambahan
                avatars[id] = {
                    sprite,
                    nameText,
                    // target posisi (untuk di-lerp di ticker)
                    // targetX: u.x,
                    // targetY: u.y,
                    // simpan arah
                    lastDirection: u.direction || "right",
                };
            } catch (err) {
                console.error("Failed to load avatar:", avatarUrl, err);
                continue;
            }
        } else {
            // Avatar sudah ada → update posisi & arah
            const avatar = avatars[id];

            // 1) UPDATE POSISI LANGSUNG DARI DATA SERVER
            avatar.sprite.x = u.x;
            avatar.sprite.y = u.y;

            if (avatar.nameText) {
                avatar.nameText.x = avatar.sprite.x;
                avatar.nameText.y = avatar.sprite.y - avatar.sprite.height * 0.6;
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
        }
    }

    // Tetap pakai sorting by zIndex
    worldContainer.sortableChildren = true;
}
