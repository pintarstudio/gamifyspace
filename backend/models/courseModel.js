// backend/models/courseModel.js
import {pool} from "../db/index.js";

export async function getAllCourses() {
    const result = await pool.query("SELECT * FROM courses WHERE deleted_at IS NULL ORDER BY course_name ASC");
    return result.rows;
}