// backend/models/courseModel.js
import {pool} from "../db/index.js";

export async function getAllAvatars() {
    const result = await pool.query("SELECT * FROM avatars WHERE deleted_at IS NULL ORDER BY avatar_name ASC");
    return result.rows;
}