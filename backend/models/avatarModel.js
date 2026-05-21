// backend/models/courseModel.js
import {pool} from "../db/index.js";

export async function getAllAvatars() {
    const result = await pool.query("SELECT * FROM avatars WHERE deleted_at IS NULL ORDER BY avatar_name ASC");
    return result.rows;
}

export async function getDefaultAvatar() {
    const result = await pool.query(
        `SELECT avatar_id, avatar_name, avatar_public_path
         FROM avatars
         WHERE deleted_at IS NULL
         ORDER BY avatar_id ASC
         LIMIT 1`
    );
    return result.rows[0] || null;
}

export async function findAvatarById(avatarId) {
    const result = await pool.query(
        `SELECT avatar_id, avatar_name, avatar_public_path
         FROM avatars
         WHERE avatar_id = $1
           AND deleted_at IS NULL
         LIMIT 1`,
        [avatarId]
    );
    return result.rows[0] || null;
}
