export const AVATAR_SHEET_DIRECTIONS = ["right", "up", "left", "down"];
export const AVATAR_SHEET_FRAME_WIDTH = 16;
export const AVATAR_SHEET_FRAME_HEIGHT = 32;
export const AVATAR_SHEET_FRAMES_PER_DIRECTION = 6;
export const AVATAR_SHEET_TOTAL_FRAMES = AVATAR_SHEET_DIRECTIONS.length * AVATAR_SHEET_FRAMES_PER_DIRECTION;
export const AVATAR_ICON_FRAME_INDEX = 18;
export const AVATAR_SHEET_RENDER_TILE_WIDTH = 2;

const normalizeAvatarPath = (path) => {
    if (!path) return "";
    return path.startsWith("/") ? path : `/${path}`;
};

const stripTrailingSlash = (path) => path.replace(/\/+$/, "");
const withAvatarsRoot = (path) => path.startsWith("/avatars/") ? path : `/avatars${path}`;

const fileNameWithoutExtension = (path) => {
    const cleanPath = stripTrailingSlash(path);
    const fileName = cleanPath.split("/").pop() || "";
    return fileName.replace(/\.[^.]+$/, "");
};

export const avatarFallbackSrc = () => "/avatars/default.png";

export const isAvatarSpriteSheetPath = (path) => /\.(png|webp)$/i.test(path || "");

export const avatarSpriteSheetSrc = (path) => {
    const normalized = stripTrailingSlash(normalizeAvatarPath(path));
    if (!normalized) return avatarFallbackSrc();
    if (isAvatarSpriteSheetPath(normalized)) return withAvatarsRoot(normalized);

    const avatarName = fileNameWithoutExtension(normalized);
    return `${withAvatarsRoot(normalized)}/${avatarName}.png`;
};

export const avatarIconFramePosition = () => {
    const maxFrameIndex = AVATAR_SHEET_TOTAL_FRAMES - 1;
    const frameIndex = Math.max(0, Math.min(AVATAR_ICON_FRAME_INDEX, maxFrameIndex));
    return `${(frameIndex / maxFrameIndex) * 100}% 0`;
};
