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
const DEFAULT_INSTRUCTOR_ADMIN_PASSWORD = "12345678";

export const hashPassword = (password) => {
    const secret = process.env.ADMIN_PASSWORD_SECRET;
    if (!secret) {
        throw new Error("ADMIN_PASSWORD_SECRET is not configured");
    }

    return crypto
        .createHmac("sha256", secret)
        .update(String(password || ""))
        .digest("hex");
};

function normalizeAdminRole(role) {
    const normalized = String(role || "instructor").trim().toLowerCase();
    return normalized === "admin" ? "admin" : "instructor";
}

function buildUserAdminUsername(user) {
    const emailLocal = String(user?.email || "").split("@")[0];
    const source = emailLocal || user?.name || "instructor";
    const cleaned = String(source)
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, ".")
        .replace(/^[._-]+|[._-]+$/g, "");
    return cleaned || "instructor";
}

async function getUniqueUserAdminUsername(baseUsername, currentUseradminId = null) {
    const base = String(baseUsername || "instructor").trim().toLowerCase() || "instructor";
    let candidate = base;
    let suffix = 2;

    while (true) {
        const result = await pool.query(
            `SELECT useradmin_id
             FROM useradmin
             WHERE LOWER(username) = LOWER($1)
               AND ($2::int IS NULL OR useradmin_id <> $2)
             LIMIT 1`,
            [candidate, nullableInteger(currentUseradminId)]
        );
        if (!result.rows[0]) return candidate;
        candidate = `${base}${suffix}`;
        suffix += 1;
    }
}

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

    await pool.query(`
        ALTER TABLE useradmin
        ADD COLUMN IF NOT EXISTS user_id INTEGER
    `);

    await pool.query(`
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1
                FROM pg_constraint
                WHERE conname = 'useradmin_user_id_users_fkey'
                  AND conrelid = 'useradmin'::regclass
            ) THEN
                ALTER TABLE useradmin
                ADD CONSTRAINT useradmin_user_id_users_fkey
                FOREIGN KEY (user_id) REFERENCES users(user_id)
                ON DELETE SET NULL;
            END IF;
        END $$;
    `);

    await pool.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS useradmin_user_id_unique_idx
        ON useradmin (user_id)
        WHERE user_id IS NOT NULL
    `);

    await pool.query(
        `INSERT INTO useradmin (username, password_hash, role, is_disabled)
         VALUES
             ('admin', $1, 'admin', FALSE),
             ('instructor', $2, 'instructor', FALSE)
         ON CONFLICT (username)
         DO UPDATE SET
             role = EXCLUDED.role,
             is_disabled = EXCLUDED.is_disabled,
             updated_at = NOW()`,
        [hashPassword("gamifyitadmin"), hashPassword(DEFAULT_INSTRUCTOR_ADMIN_PASSWORD)]
    );

    await pool.query(
        `UPDATE useradmin
         SET password_hash = $1,
             updated_at = NOW()
         WHERE LOWER(username) = 'instructor'
           AND password_hash = $2`,
        [hashPassword(DEFAULT_INSTRUCTOR_ADMIN_PASSWORD), hashPassword("gamifyitinstructor")]
    );

    await ensureTopicAdminSchema();
    await ensureCourseInstructorSchema();
    await ensureUserAdminsForExistingInstructors();
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
             ua.is_disabled,
             ua.user_id
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
	             ua.password_hash,
	             ua.last_login,
	             ua.role,
	             ua.is_disabled,
	             ua.user_id
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

export async function updateAdminPassword(useradminId, password) {
    const result = await pool.query(
        `UPDATE useradmin
         SET password_hash = $2,
             updated_at = NOW()
         WHERE useradmin_id = $1
         RETURNING useradmin_id`,
        [useradminId, hashPassword(password)]
    );
    return result.rows[0] || null;
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

async function ensureCourseInstructorSchema() {
    await pool.query(`
        DO $$
        BEGIN
            IF to_regclass('public.courses') IS NOT NULL THEN
                ALTER TABLE courses
                ADD COLUMN IF NOT EXISTS instructor2_id INTEGER;
            END IF;
        END $$;
    `);

    await pool.query(`
        DO $$
        BEGIN
            IF to_regclass('public.courses') IS NOT NULL
               AND NOT EXISTS (
                SELECT 1
                FROM pg_constraint
                WHERE conname = 'courses_instructor2_id_users_fkey'
                  AND conrelid = 'courses'::regclass
            ) THEN
                ALTER TABLE courses
                ADD CONSTRAINT courses_instructor2_id_users_fkey
                FOREIGN KEY (instructor2_id) REFERENCES users(user_id)
                ON DELETE SET NULL;
            END IF;
        END $$;
    `);

    await pool.query(`
        DO $$
        BEGIN
            IF to_regclass('public.courses') IS NOT NULL THEN
                UPDATE courses c
                SET instructor2_id = NULL,
                    updated_at = NOW()
                WHERE c.instructor2_id IS NOT NULL
                  AND (
                      c.instructor2_id = c.instructor_id
                      OR NOT EXISTS (
                          SELECT 1
                          FROM users u
                          WHERE u.user_id = c.instructor2_id
                            AND u.role_id = ${INSTRUCTOR_ROLE_ID}
                            AND u.deleted_at IS NULL
                      )
                  );
            END IF;
        END $$;
    `);
}

export async function getAdminReferences() {
    await ensureAdminTables();
    await ensureCourseGroupSchema();
    await ensureRoleSchema();
    await ensureTopicAdminSchema();
    await ensureCourseInstructorSchema();
    const [instructors, courses, topics, courseGroups, roles, userAdminUsers] = await Promise.all([
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
        pool.query(
            `SELECT
                 u.user_id,
                 u.name,
                 u.email,
                 r.role_name
             FROM users u
             JOIN roles r ON r.role_id = u.role_id
             WHERE u.deleted_at IS NULL
             ORDER BY r.role_name ASC, u.name ASC`
        ),
    ]);

    return {
        instructors: instructors.rows,
        courses: courses.rows,
        topics: topics.rows,
        course_groups: courseGroups.rows,
        roles,
        useradmin_users: userAdminUsers.rows,
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
        await ensureCourseInstructorSchema();
        const result = await pool.query(
            `SELECT
                 c.course_id,
                 c.course_code,
                 c.course_name,
                 c.instructor_id,
                 c.instructor2_id,
                 u1.name AS instructor_name,
                 u2.name AS instructor2_name,
                 CONCAT_WS(', ', u1.name, u2.name) AS instructor_names,
                 c.semester,
                 c.location,
                 c.updated_at
             FROM courses c
             LEFT JOIN users u1 ON u1.user_id = c.instructor_id
             LEFT JOIN users u2 ON u2.user_id = c.instructor2_id
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

    if (resource === "useradmins") {
        const result = await pool.query(
            `SELECT
                 ua.useradmin_id,
                 ua.username,
                 ua.role,
                 ua.user_id,
                 u.name AS user_name,
                 u.email AS user_email,
                 ua.is_disabled,
                 ua.last_login,
                 ua.updated_at
             FROM useradmin ua
             LEFT JOIN users u ON u.user_id = ua.user_id
             ORDER BY
                 CASE WHEN ua.username = 'admin' THEN 0 ELSE 1 END,
                 ua.username ASC`
        );
        return result.rows;
    }

    return null;
}

async function ensureInstructorUserAdminRow(userId) {
    const userResult = await pool.query(
        `SELECT user_id, name, email
         FROM users
         WHERE user_id = $1
           AND role_id = $2
           AND deleted_at IS NULL
         LIMIT 1`,
        [userId, INSTRUCTOR_ROLE_ID]
    );
    const user = userResult.rows[0];
    if (!user) return null;

    const existing = await pool.query(
        `SELECT useradmin_id
         FROM useradmin
         WHERE user_id = $1
            OR (LOWER(username) = LOWER($2) AND role = 'instructor')
         ORDER BY user_id NULLS LAST
         LIMIT 1`,
        [user.user_id, buildUserAdminUsername(user)]
    );
    if (existing.rows[0]) {
        const result = await pool.query(
            `UPDATE useradmin
             SET user_id = COALESCE(user_id, $2),
                 role = 'instructor',
                 password_hash = CASE
                     WHEN user_id IS NULL THEN $3
                     ELSE password_hash
                 END,
                 is_disabled = FALSE,
                 updated_at = NOW()
             WHERE useradmin_id = $1
             RETURNING useradmin_id, username`,
            [existing.rows[0].useradmin_id, user.user_id, hashPassword(DEFAULT_INSTRUCTOR_ADMIN_PASSWORD)]
        );
        return result.rows[0];
    }

    const username = await getUniqueUserAdminUsername(buildUserAdminUsername(user));
    const result = await pool.query(
        `INSERT INTO useradmin (username, password_hash, role, is_disabled, user_id)
         VALUES ($1, $2, 'instructor', FALSE, $3)
         RETURNING useradmin_id, username`,
        [username, hashPassword(DEFAULT_INSTRUCTOR_ADMIN_PASSWORD), user.user_id]
    );
    return result.rows[0];
}

async function ensureUserAdminsForExistingInstructors() {
    const result = await pool.query(
        `SELECT u.user_id
         FROM users u
         WHERE u.role_id = $1
           AND u.deleted_at IS NULL
           AND NOT EXISTS (
               SELECT 1
               FROM useradmin ua
               WHERE ua.user_id = u.user_id
           )
         ORDER BY u.user_id ASC`,
        [INSTRUCTOR_ROLE_ID]
    );

    for (const row of result.rows) {
        await ensureInstructorUserAdminRow(row.user_id);
    }
}

export async function ensureInstructorUserAdmin(userId) {
    await ensureAdminTables();
    return ensureInstructorUserAdminRow(userId);
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
        await ensureCourseInstructorSchema();
        const result = await pool.query(
            `INSERT INTO courses (course_code, course_name, instructor_id, instructor2_id, semester, location)
             SELECT $1, $2, $3, $4, $5, $6
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
               AND ($3::int IS NULL OR $4::int IS NULL OR $3::int <> $4::int)
             RETURNING course_id`,
            [
                nullableText(payload.course_code),
                nullableText(payload.course_name),
                nullableInteger(payload.instructor_id),
                nullableInteger(payload.instructor2_id),
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
        const created = result.rows[0] || null;
        if (created && String(payload.role_id) === String(INSTRUCTOR_ROLE_ID)) {
            await ensureInstructorUserAdmin(created.user_id);
        }
        return created;
    }

    if (resource === "useradmins") {
        const role = normalizeAdminRole(payload.role);
        const username = await getUniqueUserAdminUsername(payload.username);
        const userId = nullableInteger(payload.user_id);
        const result = await pool.query(
            `INSERT INTO useradmin (username, password_hash, role, is_disabled, user_id)
             SELECT $1, $2, $3, $4, $5
             WHERE (
                 $5::int IS NULL
                 OR EXISTS (
                     SELECT 1
                     FROM users u
                     WHERE u.user_id = $5
                       AND u.deleted_at IS NULL
                       AND ($3 <> 'instructor' OR u.role_id = $6)
                 )
             )
             RETURNING useradmin_id`,
            [
                username,
                hashPassword(payload.password),
                role,
                booleanValue(payload.is_disabled, false),
                userId,
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
        await ensureCourseInstructorSchema();
        const result = await pool.query(
            `UPDATE courses
             SET course_code = $2,
                 course_name = $3,
                 instructor_id = $4,
                 instructor2_id = $5,
                 semester = $6,
                 location = $7,
                 updated_at = NOW()
             WHERE course_id = $1
               AND deleted_at IS NULL
               AND (
                   $4::int IS NULL
                   OR EXISTS (
                       SELECT 1
                       FROM users u
                       WHERE u.user_id = $4
                         AND u.role_id = $8
                         AND u.deleted_at IS NULL
                   )
               )
               AND (
                   $5::int IS NULL
                   OR EXISTS (
                       SELECT 1
                       FROM users u
                       WHERE u.user_id = $5
                         AND u.role_id = $8
                         AND u.deleted_at IS NULL
                   )
               )
               AND ($4::int IS NULL OR $5::int IS NULL OR $4::int <> $5::int)
             RETURNING course_id`,
            [
                id,
                nullableText(payload.course_code),
                nullableText(payload.course_name),
                nullableInteger(payload.instructor_id),
                nullableInteger(payload.instructor2_id),
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
        const updated = result.rows[0] || null;
        if (updated && String(payload.role_id) === String(INSTRUCTOR_ROLE_ID)) {
            await ensureInstructorUserAdmin(updated.user_id);
        }
        return updated;
    }

    if (resource === "useradmins") {
        const role = normalizeAdminRole(payload.role);
        const username = await getUniqueUserAdminUsername(payload.username, id);
        const userId = nullableInteger(payload.user_id);
        const password = nullableText(payload.password);
        const result = await pool.query(
            `UPDATE useradmin
             SET username = $2,
                 password_hash = COALESCE($3, password_hash),
                 role = $4,
                 is_disabled = $5,
                 user_id = $6,
                 updated_at = NOW()
             WHERE useradmin_id = $1
               AND (
                   $6::int IS NULL
                   OR EXISTS (
                       SELECT 1
                       FROM users u
                       WHERE u.user_id = $6
                         AND u.deleted_at IS NULL
                         AND ($4 <> 'instructor' OR u.role_id = $7)
                   )
               )
             RETURNING useradmin_id`,
            [
                id,
                username,
                password ? hashPassword(password) : null,
                role,
                booleanValue(payload.is_disabled, false),
                userId,
                INSTRUCTOR_ROLE_ID,
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

    if (resource === "useradmins") {
        const result = await pool.query(
            `DELETE FROM useradmin
             WHERE useradmin_id = $1
               AND LOWER(username) <> 'admin'
             RETURNING useradmin_id`,
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
