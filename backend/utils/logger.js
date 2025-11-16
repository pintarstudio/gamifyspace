import {pool} from "../db/index.js";

export async function logUserAction(user_id, action_type, details = {}) {
    try {
        await pool.query(
            `INSERT INTO user_logs (user_id, action_type, details)
             VALUES ($1, $2, $3)`,
            [user_id, action_type, details]
        );
    } catch (err) {
        console.error("❌ Log error:", err.message);
    }
}