// backend/models/userModel.js
import {pool} from "../db/index.js";
import {
    ensureCourseGroupSchema,
    getDefaultCourseGroupForCourse,
} from "./courseGroupModel.js";
import {ensureRoleSchema, STUDENT_ROLE_ID} from "./roleModel.js";

export async function ensureUserAccessModeColumn() {
    await ensureCourseGroupSchema();
    return ensureRoleSchema();
}

export async function findUserById(id) {
    await ensureUserAccessModeColumn();
    const result = await pool.query(
        `SELECT
             u.*,
             c.course_name,
             cg.group_name AS course_group_name,
             r.role_name,
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
         JOIN roles r
           ON r.role_id = u.role_id
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
                 u.course_id,
                 c.course_name,
                 u.course_group_id,
                 cg.group_name AS course_group_name,
                 u.role_id,
                 r.role_name,
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
             JOIN roles r
               ON r.role_id = u.role_id
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
                 u.course_id,
                 c.course_name,
                 u.course_group_id,
                 cg.group_name AS course_group_name,
                 u.role_id,
                 r.role_name,
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
             JOIN roles r
               ON r.role_id = u.role_id
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
             u.course_id,
             c.course_name,
             u.course_group_id,
             cg.group_name AS course_group_name,
             u.role_id,
             r.role_name,
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
         JOIN roles r
           ON r.role_id = u.role_id
         WHERE u.course_id = $1
           AND LOWER(TRIM(u.name)) = LOWER(TRIM($2))
           AND LOWER(TRIM(u.email)) = LOWER(TRIM($3))
           AND u.deleted_at IS NULL
         LIMIT 1`,
        [course_id, name, email]
    );
    return result.rows[0] || null;
}

export async function findUserByEmail(email) {
    await ensureUserAccessModeColumn();
    const result = await pool.query(
        `SELECT
             u.user_id,
             u.name,
             u.email,
             u.course_id,
             c.course_name,
             u.course_group_id,
             cg.group_name AS course_group_name,
             u.role_id,
             r.role_name,
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
         JOIN roles r
           ON r.role_id = u.role_id
         WHERE LOWER(TRIM(u.email)) = LOWER(TRIM($1))
           AND u.deleted_at IS NULL
         LIMIT 1`,
        [email]
    );
    return result.rows[0] || null;
}

export async function createDemoUser({name, email, course_id}) {
    await ensureUserAccessModeColumn();
    const defaultGroup = await getDefaultCourseGroupForCourse(course_id);
    const result = await pool.query(
        `INSERT INTO users (name, email, course_id, course_group_id, role_id)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING user_id, name, email, course_id, course_group_id`,
        [name, email, course_id, defaultGroup?.course_group_id || null, STUDENT_ROLE_ID]
    );
    return findUserById(result.rows[0].user_id);
}

export async function createUser({name, email, avatar, course_id}) {
    await ensureUserAccessModeColumn();
    const defaultGroup = await getDefaultCourseGroupForCourse(course_id);
    const result = await pool.query(
        `INSERT INTO users (name, email, avatar, course_id, course_group_id)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [name, email, avatar, course_id, defaultGroup?.course_group_id || null]
    );
    return findUserById(result.rows[0].user_id);
}

export async function updateUserRole(userId, roleId) {
    await ensureUserAccessModeColumn();
    const result = await pool.query(
        `UPDATE users
         SET role_id = $2
         WHERE user_id = $1
           AND deleted_at IS NULL
           AND EXISTS (
               SELECT 1
               FROM roles r
               WHERE r.role_id = $2
           )
         RETURNING user_id`,
        [userId, roleId]
    );
    if (!result.rows[0]) return null;
    return findUserById(userId);
}
