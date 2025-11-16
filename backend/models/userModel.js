// backend/models/userModel.js
import {pool} from "../db/index.js";

export async function findUserById(id) {
    const result = await pool.query("SELECT * FROM users WHERE user_id = $1", [id]);
    return result.rows[0];
}

export async function getAllUsersByCourseId(course_id = null) {
    let result;
    if (course_id) {
        result = await pool.query(
            `SELECT user_id, name, email, gender, course_id 
             FROM users 
             WHERE course_id = $1 
             ORDER BY name ASC`,
            [course_id]
        );
    } else {
        result = await pool.query(
            `SELECT user_id, name, email, gender, course_id 
             FROM users 
             ORDER BY name ASC`
        );
    }
    return result.rows;
}

export async function createUser({name, email, gender, avatar, course_id}) {
    const result = await pool.query(
        `INSERT INTO users (name, email, gender, avatar, course_id)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [name, email, gender, avatar, course_id]
    );
    return result.rows[0];
}