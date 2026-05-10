import crypto from "crypto";
import {pool} from "../db/index.js";
import {ensureGamificationTables} from "./gamificationModel.js";
import {ensureUserAccessModeColumn} from "./userModel.js";

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
    await ensureUserAccessModeColumn();

    await pool.query(`
        DO $$
        BEGIN
            IF to_regclass('public.instructor') IS NULL AND to_regclass('public.instructors') IS NOT NULL THEN
                ALTER TABLE instructors RENAME TO instructor;
            END IF;
        END $$;
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS instructor (
            instructor_id SERIAL PRIMARY KEY,
            instructor_name TEXT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS useradmin (
            useradmin_id SERIAL PRIMARY KEY,
            instructor_id INTEGER NOT NULL REFERENCES instructor(instructor_id),
            username TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            last_login TIMESTAMPTZ,
            role TEXT NOT NULL CHECK (role IN ('admin', 'instructor')),
            is_disabled BOOLEAN NOT NULL DEFAULT FALSE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);

    await pool.query(
        `INSERT INTO instructor (instructor_id, instructor_name)
         VALUES
             (1, 'Instructor 1'),
             (2, 'Instructor 2')
         ON CONFLICT (instructor_id)
         DO UPDATE SET
             instructor_name = EXCLUDED.instructor_name,
             updated_at = NOW()`
    );

    await pool.query(
        `INSERT INTO useradmin (instructor_id, username, password_hash, role, is_disabled)
         VALUES
             (1, 'admin', $1, 'admin', FALSE),
             (1, 'instructor', $2, 'instructor', FALSE)
         ON CONFLICT (username)
         DO UPDATE SET
             instructor_id = EXCLUDED.instructor_id,
             password_hash = EXCLUDED.password_hash,
             role = EXCLUDED.role,
             is_disabled = EXCLUDED.is_disabled,
             updated_at = NOW()`,
        [hashPassword("gamifyitadmin"), hashPassword("gamifyitinstructor")]
    );
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
             ua.instructor_id,
             ua.username,
             ua.password_hash,
             ua.last_login,
             ua.role,
             ua.is_disabled,
             i.instructor_name
         FROM useradmin ua
         JOIN instructor i ON i.instructor_id = ua.instructor_id
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
             ua.instructor_id,
             ua.username,
             ua.last_login,
             ua.role,
             ua.is_disabled,
             i.instructor_name
         FROM useradmin ua
         JOIN instructor i ON i.instructor_id = ua.instructor_id
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

export async function getAdminReferences() {
    await ensureAdminTables();
    const [instructors, courses, topics] = await Promise.all([
        pool.query(
            `SELECT instructor_id, instructor_name
             FROM instructor
             ORDER BY instructor_name ASC`
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
                 t.course_id,
                 c.course_name
             FROM topics t
             JOIN courses c ON c.course_id = t.course_id
             WHERE t.deleted_at IS NULL
               AND c.deleted_at IS NULL
             ORDER BY c.course_name ASC, t.topic_name ASC`
        ),
    ]);

    return {
        instructors: instructors.rows,
        courses: courses.rows,
        topics: topics.rows,
    };
}

export async function listAdminResource(resource) {
    await ensureAdminTables();
    if (resource === "levels") await ensureGamificationTables();

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
                 i.instructor_name,
                 c.semester,
                 c.location,
                 c.updated_at
             FROM courses c
             JOIN instructor i ON i.instructor_id = c.instructor_id
             WHERE c.deleted_at IS NULL
             ORDER BY c.course_name ASC`
        );
        return result.rows;
    }

    if (resource === "topics") {
        const result = await pool.query(
            `SELECT
                 t.topic_id,
                 t.course_id,
                 c.course_name,
                 t.topic_name,
                 t.show_topic,
                 t.updated_at
             FROM topics t
             JOIN courses c ON c.course_id = t.course_id
             WHERE t.deleted_at IS NULL
               AND c.deleted_at IS NULL
             ORDER BY c.course_name ASC, t.topic_name ASC`
        );
        return result.rows;
    }

    if (resource === "students") {
        await ensureUserAccessModeColumn();
        const result = await pool.query(
            `SELECT
                 u.user_id,
                 u.name,
                 u.email,
                 u.gender,
                 u.course_id,
                 c.course_name,
                 COALESCE(u.gamification_enabled, FALSE) AS gamification_enabled,
                 COALESCE(u.use_no_virtual_space, FALSE) AS use_no_virtual_space
             FROM users u
             JOIN courses c ON c.course_id = u.course_id
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
             VALUES ($1, $2, $3, $4, $5)
             RETURNING course_id`,
            [
                nullableText(payload.course_code),
                nullableText(payload.course_name),
                nullableInteger(payload.instructor_id),
                nullableInteger(payload.semester),
                nullableText(payload.location),
            ]
        );
        return result.rows[0];
    }

    if (resource === "topics") {
        const result = await pool.query(
            `INSERT INTO topics (course_id, topic_name, show_topic, updated_at)
             VALUES ($1, $2, $3, NOW())
             RETURNING topic_id`,
            [
                nullableInteger(payload.course_id),
                nullableText(payload.topic_name),
                booleanValue(payload.show_topic),
            ]
        );
        return result.rows[0];
    }

    return null;
}

export async function updateAdminResource(resource, id, payload) {
    await ensureAdminTables();
    if (resource === "levels") await ensureGamificationTables();

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
             RETURNING course_id`,
            [
                id,
                nullableText(payload.course_code),
                nullableText(payload.course_name),
                nullableInteger(payload.instructor_id),
                nullableInteger(payload.semester),
                nullableText(payload.location),
            ]
        );
        return result.rows[0] || null;
    }

    if (resource === "topics") {
        const result = await pool.query(
            `UPDATE topics
             SET course_id = $2,
                 topic_name = $3,
                 show_topic = $4,
                 updated_at = NOW()
             WHERE topic_id = $1
               AND deleted_at IS NULL
             RETURNING topic_id`,
            [
                id,
                nullableInteger(payload.course_id),
                nullableText(payload.topic_name),
                booleanValue(payload.show_topic),
            ]
        );
        return result.rows[0] || null;
    }

    if (resource === "students") {
        await ensureUserAccessModeColumn();
        const result = await pool.query(
            `UPDATE users
             SET name = $2,
                 email = $3,
                 course_id = $4,
                 gamification_enabled = $5,
                 use_no_virtual_space = $6
             WHERE user_id = $1
               AND deleted_at IS NULL
             RETURNING user_id`,
            [
                id,
                nullableText(payload.name),
                nullableText(payload.email),
                nullableInteger(payload.course_id),
                booleanValue(payload.gamification_enabled, false),
                booleanValue(payload.use_no_virtual_space, false),
            ]
        );
        return result.rows[0] || null;
    }

    return null;
}

export async function deleteAdminResource(resource, id) {
    await ensureAdminTables();

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
