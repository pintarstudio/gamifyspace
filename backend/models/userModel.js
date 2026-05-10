// backend/models/userModel.js
import {pool} from "../db/index.js";

let userAccessModeReadyPromise = null;

async function createUserAccessModeColumn() {
    await pool.query(`
        ALTER TABLE users
        ADD COLUMN IF NOT EXISTS use_no_virtual_space BOOLEAN NOT NULL DEFAULT FALSE
    `);
}

export async function ensureUserAccessModeColumn() {
    if (!userAccessModeReadyPromise) {
        userAccessModeReadyPromise = createUserAccessModeColumn().catch((error) => {
            userAccessModeReadyPromise = null;
            throw error;
        });
    }

    return userAccessModeReadyPromise;
}

export async function findUserById(id) {
    await ensureUserAccessModeColumn();
    const result = await pool.query("SELECT * FROM users WHERE user_id = $1", [id]);
    return result.rows[0];
}

export async function getAllUsersByCourseId(course_id = null) {
    await ensureUserAccessModeColumn();
    let result;
    if (course_id) {
        result = await pool.query(
            `SELECT user_id, name, email, gender, course_id, gamification_enabled, use_no_virtual_space
             FROM users 
             WHERE course_id = $1 
             ORDER BY name ASC`,
            [course_id]
        );
    } else {
        result = await pool.query(
            `SELECT user_id, name, email, gender, course_id, gamification_enabled, use_no_virtual_space
             FROM users 
             ORDER BY name ASC`
        );
    }
    return result.rows;
}

export async function findUserByCourseNameEmail({course_id, name, email}) {
    await ensureUserAccessModeColumn();
    const result = await pool.query(
        `SELECT user_id, name, email, gender, course_id, gamification_enabled, use_no_virtual_space
         FROM users
         WHERE course_id = $1
           AND LOWER(TRIM(name)) = LOWER(TRIM($2))
           AND LOWER(TRIM(email)) = LOWER(TRIM($3))
           AND deleted_at IS NULL
         LIMIT 1`,
        [course_id, name, email]
    );
    return result.rows[0] || null;
}

export async function createDemoUser({name, email, course_id}) {
    await ensureUserAccessModeColumn();
    const result = await pool.query(
        `INSERT INTO users (name, email, gender, course_id, gamification_enabled, use_no_virtual_space)
         VALUES ($1, $2, NULL, $3, FALSE, FALSE)
         RETURNING user_id, name, email, gender, course_id, gamification_enabled, use_no_virtual_space`,
        [name, email, course_id]
    );
    return result.rows[0];
}

export async function createUser({name, email, gender, avatar, course_id}) {
    await ensureUserAccessModeColumn();
    const result = await pool.query(
        `INSERT INTO users (name, email, gender, avatar, course_id)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [name, email, gender, avatar, course_id]
    );
    return result.rows[0];
}
