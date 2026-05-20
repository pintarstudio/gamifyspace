import crypto from "crypto";
import {pool} from "../db/index.js";
import {ensureGamificationTables} from "./gamificationModel.js";
import {
    assignUsersToCourseGroup,
    createCourseGroup,
    deleteCourseGroup,
    ensureCourseGroupSchema,
    ensureDefaultCourseGroups,
    listCourseGroups,
    updateCourseGroup,
} from "./courseGroupModel.js";
import {
    ensureRoleSchema,
    INSTRUCTOR_ROLE_ID,
    listRoles,
    updateRole,
} from "./roleModel.js";

let adminReadyPromise = null;

const hashPassword = (password) => {
    const secret = process.env.ADMIN_PASSWORD_SECRET;
    if (!secret) {
        throw new Error("ADMIN_PASSWORD_SECRET is not configured");
    }

    return crypto
        .createHmac("sha256", secret)
        .update(String(password || ""))
        .digest("hex");
};

async function createAdminTables() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS useradmin (
            useradmin_id SERIAL PRIMARY KEY,
            username TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            last_login TIMESTAMPTZ,
            role TEXT NOT NULL CHECK (role IN ('admin', 'instructor')),
            is_disabled BOOLEAN NOT NULL DEFAULT FALSE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);

    await pool.query(`
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1
                FROM pg_constraint
                WHERE conname IN ('useradmin_instructor_id_fkey', 'useradmin_instructor_id_users_fkey')
                  AND conrelid = 'useradmin'::regclass
            ) THEN
                ALTER TABLE useradmin DROP CONSTRAINT IF EXISTS useradmin_instructor_id_fkey;
                ALTER TABLE useradmin DROP CONSTRAINT IF EXISTS useradmin_instructor_id_users_fkey;
            END IF;
        END $$;
    `);

    await pool.query(`
        ALTER TABLE useradmin
        DROP COLUMN IF EXISTS instructor_id
    `);

    await pool.query(
        `INSERT INTO useradmin (username, password_hash, role, is_disabled)
         VALUES
             ('admin', $1, 'admin', FALSE),
             ('instructor', $2, 'instructor', FALSE)
         ON CONFLICT (username)
         DO UPDATE SET
             password_hash = EXCLUDED.password_hash,
             role = EXCLUDED.role,
             is_disabled = EXCLUDED.is_disabled,
             updated_at = NOW()`,
        [hashPassword("gamifyitadmin"), hashPassword("gamifyitinstructor")]
    );

    await ensureTopicAdminSchema();
}

export async function ensureAdminTables() {
    if (!adminReadyPromise) {
        adminReadyPromise = createAdminTables().catch((error) => {
            adminReadyPromise = null;
            throw error;
        });
    }

    return adminReadyPromise;
}

export async function findAdminByUsername(username) {
    await ensureAdminTables();
    const result = await pool.query(
        `SELECT
             ua.useradmin_id,
             ua.username,
             ua.password_hash,
             ua.last_login,
             ua.role,
             ua.is_disabled
         FROM useradmin ua
         WHERE LOWER(ua.username) = LOWER($1)
         LIMIT 1`,
        [String(username || "").trim()]
    );
    return result.rows[0] || null;
}

export async function findAdminById(useradminId) {
    await ensureAdminTables();
    const result = await pool.query(
        `SELECT
             ua.useradmin_id,
             ua.username,
             ua.last_login,
             ua.role,
             ua.is_disabled
         FROM useradmin ua
         WHERE ua.useradmin_id = $1
         LIMIT 1`,
        [useradminId]
    );
    return result.rows[0] || null;
}

export async function updateAdminLastLogin(useradminId) {
    const result = await pool.query(
        `UPDATE useradmin
         SET last_login = NOW(),
             updated_at = NOW()
         WHERE useradmin_id = $1
         RETURNING last_login`,
        [useradminId]
    );
    return result.rows[0]?.last_login || null;
}

export function verifyAdminPassword(password, passwordHash) {
    const incomingHash = hashPassword(password);
    if (!passwordHash || incomingHash.length !== passwordHash.length) return false;
    return crypto.timingSafeEqual(Buffer.from(incomingHash), Buffer.from(passwordHash));
}

function nullableText(value) {
    const text = String(value ?? "").trim();
    return text || null;
}

function nullableInteger(value) {
    if (value === null || value === undefined || value === "") return null;
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
}

function booleanValue(value, fallback = true) {
    if (value === undefined || value === null || value === "") return fallback;
    if (typeof value === "boolean") return value;
    return ["true", "1", "yes", "on"].includes(String(value).toLowerCase());
}

async function ensureTopicAdminSchema() {
    await pool.query(`
        DO $$
        BEGIN
            IF to_regclass('public.topics') IS NOT NULL THEN
                ALTER TABLE topics
                ADD COLUMN IF NOT EXISTS week INTEGER;
            END IF;
        END $$;
    `);
}

export async function getAdminReferences() {
    await ensureAdminTables();
    await ensureCourseGroupSchema();
    await ensureRoleSchema();
    await ensureTopicAdminSchema();
    const [instructors, courses, topics, courseGroups, roles] = await Promise.all([
        pool.query(
            `SELECT
                 u.user_id AS instructor_id,
                 u.name AS instructor_name,
                 u.email
             FROM users u
             WHERE u.role_id = $1
               AND u.deleted_at IS NULL
             ORDER BY u.name ASC`,
            [INSTRUCTOR_ROLE_ID]
        ),
        pool.query(
            `SELECT course_id, course_code, course_name
             FROM courses
             WHERE deleted_at IS NULL
             ORDER BY course_name ASC`
        ),
        pool.query(
            `SELECT
                 t.topic_id,
                 t.topic_name,
                 t.week,
                 t.course_id,
                 c.course_name
             FROM topics t
             JOIN courses c ON c.course_id = t.course_id
             WHERE t.deleted_at IS NULL
               AND c.deleted_at IS NULL
             ORDER BY c.course_name ASC, t.week ASC NULLS LAST, t.topic_name ASC`
        ),
        pool.query(
            `SELECT
                 cg.course_group_id,
                 cg.course_id,
                 cg.group_name,
                 c.course_name,
                 cg.gamification_enabled,
                 cg.virtual_space_enabled
             FROM course_groups cg
             JOIN courses c ON c.course_id = cg.course_id
             WHERE cg.deleted_at IS NULL
               AND c.deleted_at IS NULL
             ORDER BY c.course_name ASC, cg.group_name ASC`
        ),
        listRoles(),
    ]);

    return {
        instructors: instructors.rows,
        courses: courses.rows,
        topics: topics.rows,
        course_groups: courseGroups.rows,
        roles,
    };
}

export async function listAdminResource(resource) {
    await ensureAdminTables();
    if (resource === "levels") await ensureGamificationTables();
    if (resource === "course-groups") return listCourseGroups();
    if (resource === "roles") return listRoles();

    if (resource === "levels") {
        const result = await pool.query(
            `SELECT level_id, level_name, min_xp, max_xp, color_hex, updated_at
             FROM gamification_levels
             ORDER BY level_id ASC`
        );
        return result.rows;
    }

    if (resource === "avatars") {
        const result = await pool.query(
            `SELECT avatar_id, avatar_name, avatar_public_path, updated_at
             FROM avatars
             WHERE deleted_at IS NULL
             ORDER BY avatar_name ASC`
        );
        return result.rows;
    }

    if (resource === "courses") {
        const result = await pool.query(
            `SELECT
                 c.course_id,
                 c.course_code,
                 c.course_name,
                 c.instructor_id,
                 u.name AS instructor_name,
                 c.semester,
                 c.location,
                 c.updated_at
             FROM courses c
             LEFT JOIN users u ON u.user_id = c.instructor_id
             WHERE c.deleted_at IS NULL
             ORDER BY c.course_name ASC`
        );
        return result.rows;
    }

    if (resource === "topics") {
        await ensureTopicAdminSchema();
        const result = await pool.query(
            `SELECT
                 t.topic_id,
                 t.course_id,
                 c.course_name,
                 t.topic_name,
                 t.week,
                 t.show_topic,
                 t.updated_at
             FROM topics t
             JOIN courses c ON c.course_id = t.course_id
             WHERE t.deleted_at IS NULL
               AND c.deleted_at IS NULL
             ORDER BY c.course_name ASC, t.week ASC NULLS LAST, t.topic_name ASC`
        );
        return result.rows;
    }

    if (resource === "students") {
        await ensureCourseGroupSchema();
        await ensureRoleSchema();
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
             JOIN courses c ON c.course_id = u.course_id
             LEFT JOIN course_groups cg
                    ON cg.course_group_id = u.course_group_id
                   AND cg.deleted_at IS NULL
             JOIN roles r
               ON r.role_id = u.role_id
             WHERE u.deleted_at IS NULL
               AND c.deleted_at IS NULL
             ORDER BY c.course_name ASC, u.name ASC`
        );
        return result.rows;
    }

    return null;
}

export async function createAdminResource(resource, payload) {
    await ensureAdminTables();

    if (resource === "avatars") {
        const result = await pool.query(
            `INSERT INTO avatars (avatar_name, avatar_public_path)
             VALUES ($1, $2)
             RETURNING avatar_id`,
            [nullableText(payload.avatar_name), nullableText(payload.avatar_public_path)]
        );
        return result.rows[0];
    }

    if (resource === "courses") {
        const result = await pool.query(
            `INSERT INTO courses (course_code, course_name, instructor_id, semester, location)
             SELECT $1, $2, $3, $4, $5
             WHERE (
                 $3::int IS NULL
                 OR EXISTS (
                     SELECT 1
                     FROM users u
                     WHERE u.user_id = $3
                       AND u.role_id = $6
                       AND u.deleted_at IS NULL
                 )
               )
             RETURNING course_id`,
            [
                nullableText(payload.course_code),
                nullableText(payload.course_name),
                nullableInteger(payload.instructor_id),
                nullableInteger(payload.semester),
                nullableText(payload.location),
                INSTRUCTOR_ROLE_ID,
            ]
        );
        if (!result.rows[0]) return null;
        await ensureDefaultCourseGroups(result.rows[0].course_id);
        return result.rows[0];
    }

    if (resource === "course-groups") {
        return createCourseGroup(payload);
    }

    if (resource === "topics") {
        await ensureTopicAdminSchema();
        const result = await pool.query(
            `INSERT INTO topics (course_id, topic_name, week, show_topic, updated_at)
             VALUES ($1, $2, $3, $4, NOW())
             RETURNING topic_id`,
            [
                nullableInteger(payload.course_id),
                nullableText(payload.topic_name),
                nullableInteger(payload.week),
                booleanValue(payload.show_topic),
            ]
        );
        return result.rows[0];
    }

    if (resource === "students") {
        await ensureCourseGroupSchema();
        await ensureRoleSchema();
        const result = await pool.query(
            `INSERT INTO users (name, email, course_id, course_group_id, role_id)
             SELECT $1, $2, $3, $4, $5
             WHERE EXISTS (
                 SELECT 1
                 FROM courses c
                 WHERE c.course_id = $3
                   AND c.deleted_at IS NULL
             )
               AND EXISTS (
                 SELECT 1
                 FROM roles r
                 WHERE r.role_id = $5
             )
               AND (
                 EXISTS (
                     SELECT 1
                     FROM course_groups cg
                     WHERE cg.course_group_id = $4
                       AND cg.course_id = $3
                       AND cg.deleted_at IS NULL
                 )
                 OR (
                     $5::int = $6
                     AND $4::int IS NULL
                 )
             )
             RETURNING user_id`,
            [
                nullableText(payload.name),
                nullableText(payload.email),
                nullableInteger(payload.course_id),
                nullableInteger(payload.course_group_id),
                nullableInteger(payload.role_id),
                INSTRUCTOR_ROLE_ID,
            ]
        );
        return result.rows[0] || null;
    }

    return null;
}

export async function updateAdminResource(resource, id, payload) {
    await ensureAdminTables();
    if (resource === "levels") await ensureGamificationTables();
    if (resource === "course-groups") return updateCourseGroup(id, payload);
    if (resource === "roles") return updateRole(id, payload);

    if (resource === "levels") {
        const result = await pool.query(
            `UPDATE gamification_levels
             SET level_name = $2,
                 min_xp = $3,
                 max_xp = $4,
                 color_hex = $5,
                 updated_at = NOW()
             WHERE level_id = $1
             RETURNING level_id`,
            [
                id,
                nullableText(payload.level_name),
                nullableInteger(payload.min_xp),
                nullableInteger(payload.max_xp),
                nullableText(payload.color_hex),
            ]
        );
        return result.rows[0] || null;
    }

    if (resource === "avatars") {
        const result = await pool.query(
            `UPDATE avatars
             SET avatar_name = $2,
                 avatar_public_path = $3,
                 updated_at = NOW()
             WHERE avatar_id = $1
               AND deleted_at IS NULL
             RETURNING avatar_id`,
            [id, nullableText(payload.avatar_name), nullableText(payload.avatar_public_path)]
        );
        return result.rows[0] || null;
    }

    if (resource === "courses") {
        const result = await pool.query(
            `UPDATE courses
             SET course_code = $2,
                 course_name = $3,
                 instructor_id = $4,
                 semester = $5,
                 location = $6,
                 updated_at = NOW()
             WHERE course_id = $1
               AND deleted_at IS NULL
               AND (
                   $4::int IS NULL
                   OR EXISTS (
                       SELECT 1
                       FROM users u
                       WHERE u.user_id = $4
                         AND u.role_id = $7
                         AND u.deleted_at IS NULL
                   )
               )
             RETURNING course_id`,
            [
                id,
                nullableText(payload.course_code),
                nullableText(payload.course_name),
                nullableInteger(payload.instructor_id),
                nullableInteger(payload.semester),
                nullableText(payload.location),
                INSTRUCTOR_ROLE_ID,
            ]
        );
        return result.rows[0] || null;
    }

    if (resource === "topics") {
        await ensureTopicAdminSchema();
        const result = await pool.query(
            `UPDATE topics
             SET course_id = $2,
                 topic_name = $3,
                 week = $4,
                 show_topic = $5,
                 updated_at = NOW()
             WHERE topic_id = $1
               AND deleted_at IS NULL
             RETURNING topic_id`,
            [
                id,
                nullableInteger(payload.course_id),
                nullableText(payload.topic_name),
                nullableInteger(payload.week),
                booleanValue(payload.show_topic),
            ]
        );
        return result.rows[0] || null;
    }

    if (resource === "students") {
        await ensureCourseGroupSchema();
        await ensureRoleSchema();
        const result = await pool.query(
            `UPDATE users
             SET name = $2,
                 email = $3,
                 course_id = $4,
                 course_group_id = $5,
                 role_id = $6
             WHERE user_id = $1
               AND deleted_at IS NULL
               AND (
                   $5::int IS NULL
                   OR EXISTS (
                       SELECT 1
                       FROM course_groups cg
                       WHERE cg.course_group_id = $5
                         AND cg.course_id = $4
                       AND cg.deleted_at IS NULL
                   )
               )
               AND EXISTS (
                   SELECT 1
                   FROM roles r
                   WHERE r.role_id = $6
               )
             RETURNING user_id`,
            [
                id,
                nullableText(payload.name),
                nullableText(payload.email),
                nullableInteger(payload.course_id),
                nullableInteger(payload.course_group_id),
                nullableInteger(payload.role_id),
            ]
        );
        return result.rows[0] || null;
    }

    return null;
}

export async function deleteAdminResource(resource, id) {
    await ensureAdminTables();

    if (resource === "course-groups") return deleteCourseGroup(id);

    if (resource === "courses") {
        const result = await pool.query(
            `UPDATE courses
             SET deleted_at = NOW(),
                 updated_at = NOW()
             WHERE course_id = $1
               AND deleted_at IS NULL
             RETURNING course_id`,
            [id]
        );
        return result.rows[0] || null;
    }

    if (resource === "topics") {
        const result = await pool.query(
            `UPDATE topics
             SET deleted_at = NOW(),
                 updated_at = NOW()
             WHERE topic_id = $1
               AND deleted_at IS NULL
             RETURNING topic_id`,
            [id]
        );
        return result.rows[0] || null;
    }

    return null;
}

export async function bulkAssignStudentsToCourseGroup(payload) {
    return assignUsersToCourseGroup({
        courseGroupId: payload.course_group_id,
        userIds: payload.user_ids,
    });
}
