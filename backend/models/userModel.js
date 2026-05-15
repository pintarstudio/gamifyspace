// backend/models/userModel.js
import {pool} from "../db/index.js";
import {
    ensureCourseGroupSchema,
    getDefaultCourseGroupForCourse,
} from "./courseGroupModel.js";

export async function ensureUserAccessModeColumn() {
    return ensureCourseGroupSchema();
}

export async function findUserById(id) {
    await ensureUserAccessModeColumn();
    const result = await pool.query(
        `SELECT
             u.*,
             c.course_name,
             cg.group_name AS course_group_name,
             COALESCE(cg.gamification_enabled, FALSE) AS gamification_enabled,
             NOT COALESCE(cg.virtual_space_enabled, FALSE) AS use_no_virtual_space,
             COALESCE(cg.virtual_space_enabled, FALSE) AS virtual_space_enabled
         FROM users u
         JOIN courses c
           ON c.course_id = u.course_id
          AND c.deleted_at IS NULL
         LEFT JOIN course_groups cg
                ON cg.course_group_id = u.course_group_id
               AND cg.deleted_at IS NULL
         WHERE u.user_id = $1
         LIMIT 1`,
        [id]
    );
    return result.rows[0];
}

export async function getAllUsersByCourseId(course_id = null) {
    await ensureUserAccessModeColumn();
    let result;
    if (course_id) {
        result = await pool.query(
            `SELECT
                 u.user_id,
                 u.name,
                 u.email,
                 u.gender,
                 u.course_id,
                 c.course_name,
                 u.course_group_id,
                 cg.group_name AS course_group_name,
                 COALESCE(cg.gamification_enabled, FALSE) AS gamification_enabled,
                 NOT COALESCE(cg.virtual_space_enabled, FALSE) AS use_no_virtual_space,
                 COALESCE(cg.virtual_space_enabled, FALSE) AS virtual_space_enabled
             FROM users u
             JOIN courses c
               ON c.course_id = u.course_id
              AND c.deleted_at IS NULL
             LEFT JOIN course_groups cg
                    ON cg.course_group_id = u.course_group_id
                   AND cg.deleted_at IS NULL
             WHERE u.course_id = $1 
               AND u.deleted_at IS NULL
             ORDER BY u.name ASC`,
            [course_id]
        );
    } else {
        result = await pool.query(
            `SELECT
                 u.user_id,
                 u.name,
                 u.email,
                 u.gender,
                 u.course_id,
                 c.course_name,
                 u.course_group_id,
                 cg.group_name AS course_group_name,
                 COALESCE(cg.gamification_enabled, FALSE) AS gamification_enabled,
                 NOT COALESCE(cg.virtual_space_enabled, FALSE) AS use_no_virtual_space,
                 COALESCE(cg.virtual_space_enabled, FALSE) AS virtual_space_enabled
             FROM users u
             JOIN courses c
               ON c.course_id = u.course_id
              AND c.deleted_at IS NULL
             LEFT JOIN course_groups cg
                    ON cg.course_group_id = u.course_group_id
                   AND cg.deleted_at IS NULL
             WHERE u.deleted_at IS NULL
             ORDER BY u.name ASC`
        );
    }
    return result.rows;
}

export async function findUserByCourseNameEmail({course_id, name, email}) {
    await ensureUserAccessModeColumn();
    const result = await pool.query(
        `SELECT
             u.user_id,
             u.name,
             u.email,
             u.gender,
             u.course_id,
             c.course_name,
             u.course_group_id,
             cg.group_name AS course_group_name,
             COALESCE(cg.gamification_enabled, FALSE) AS gamification_enabled,
             NOT COALESCE(cg.virtual_space_enabled, FALSE) AS use_no_virtual_space,
             COALESCE(cg.virtual_space_enabled, FALSE) AS virtual_space_enabled
         FROM users u
         JOIN courses c
           ON c.course_id = u.course_id
          AND c.deleted_at IS NULL
         LEFT JOIN course_groups cg
                ON cg.course_group_id = u.course_group_id
               AND cg.deleted_at IS NULL
         WHERE u.course_id = $1
           AND LOWER(TRIM(u.name)) = LOWER(TRIM($2))
           AND LOWER(TRIM(u.email)) = LOWER(TRIM($3))
           AND u.deleted_at IS NULL
         LIMIT 1`,
        [course_id, name, email]
    );
    return result.rows[0] || null;
}

export async function createDemoUser({name, email, course_id}) {
    await ensureUserAccessModeColumn();
    const defaultGroup = await getDefaultCourseGroupForCourse(course_id);
    const result = await pool.query(
        `INSERT INTO users (name, email, gender, course_id, course_group_id)
         VALUES ($1, $2, NULL, $3, $4)
         RETURNING user_id, name, email, gender, course_id, course_group_id`,
        [name, email, course_id, defaultGroup?.course_group_id || null]
    );
    return findUserById(result.rows[0].user_id);
}

export async function createUser({name, email, gender, avatar, course_id}) {
    await ensureUserAccessModeColumn();
    const defaultGroup = await getDefaultCourseGroupForCourse(course_id);
    const result = await pool.query(
        `INSERT INTO users (name, email, gender, avatar, course_id, course_group_id)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [name, email, gender, avatar, course_id, defaultGroup?.course_group_id || null]
    );
    return findUserById(result.rows[0].user_id);
}
