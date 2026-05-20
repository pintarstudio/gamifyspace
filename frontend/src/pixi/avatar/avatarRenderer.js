import * as PIXI from "pixi.js";
import {
    AVATAR_SHEET_DIRECTIONS,
    AVATAR_SHEET_FRAME_HEIGHT,
    AVATAR_SHEET_FRAME_WIDTH,
    AVATAR_SHEET_FRAMES_PER_DIRECTION,
    AVATAR_SHEET_RENDER_TILE_WIDTH,
    avatarFallbackSrc,
    avatarSpriteSheetSrc,
} from "../../utils/avatarAssets";

// Kamu boleh hapus lerp ini nanti kalau sudah tidak dipakai di mana-mana,
// untuk sekarang biarkan saja kalau masih merasa perlu.
// function lerp(current, target, factor = 0.2) {
//     return current + (target - current) * factor;
// }

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
                    framesByDirection: animation.frames,
                    animationMode: animation.mode,
                    // target posisi (untuk di-lerp di ticker)
                    // targetX: u.x,
                    // targetY: u.y,
                    // simpan arah
                    setDirection: (direction) => setAvatarDirection(avatars[id], direction),
                    lastDirection: u.direction || "right",
                };
                setAvatarDirection(avatars[id], u.direction || "right");
            } catch (err) {
                console.error("Failed to load avatar:", avatarPath, err);
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

            if (id === localKeyRef.current) {
                // Local user: kalau server belum sync, pakai lastDirection di localStorage
                dir = dir || localStorage.getItem("lastDirection") || "right";
            }

            setAvatarDirection(avatar, dir);
            avatar.lastDirection = dir;
        }
    }

    // Tetap pakai sorting by zIndex
    worldContainer.sortableChildren = true;
}
