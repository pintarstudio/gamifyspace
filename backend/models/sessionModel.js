// backend/models/sessionModel.js
import {pool} from "../db/index.js";

export async function createSession(session_id, user_id, course_id, avatar_id) {
    await pool.query(
        `INSERT INTO sessions (session_id, user_id, course_id, avatar_id)
         VALUES ($1, $2, $3, $4)`,
        [session_id, user_id, course_id, avatar_id]
    );
}

export async function deactivateSession(session_id) {
    await pool.query(`UPDATE sessions
                      SET is_active = FALSE
                      WHERE session_id = $1`, [session_id]);
}

export async function findSession(session_id) {
    const result = await pool.query(
        `SELECT
             s.*,
             u.name,
             u.email,
             u.gender,
             u.course_id,
             c.course_name,
             u.course_group_id,
             cg.group_name AS course_group_name,
             COALESCE(cg.gamification_enabled, FALSE) AS gamification_enabled,
             NOT COALESCE(cg.virtual_space_enabled, FALSE) AS use_no_virtual_space,
             COALESCE(cg.virtual_space_enabled, FALSE) AS virtual_space_enabled,
             a.avatar_name,
             a.avatar_public_path
         FROM sessions s
         JOIN users u ON s.user_id = u.user_id
         JOIN courses c
           ON c.course_id = u.course_id
          AND c.deleted_at IS NULL
         LEFT JOIN course_groups cg
                ON cg.course_group_id = u.course_group_id
               AND cg.deleted_at IS NULL
         JOIN avatars a ON a.avatar_id = s.avatar_id        
         WHERE s.session_id = $1
           AND s.is_active = TRUE`,
        [session_id]
    );
    return result.rows[0];
}
