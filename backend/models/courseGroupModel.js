import {pool} from "../db/index.js";

export const DEFAULT_COURSE_GROUPS = [
    {group_name: "Group A", gamification_enabled: false, virtual_space_enabled: false},
    {group_name: "Group B", gamification_enabled: true, virtual_space_enabled: false},
    {group_name: "Group C", gamification_enabled: true, virtual_space_enabled: true},
];

const LEGACY_VIRTUAL_GROUP = {
    group_name: "Legacy Virtual Space",
    gamification_enabled: false,
    virtual_space_enabled: true,
};

let courseGroupReadyPromise = null;

function nullableText(value) {
    const text = String(value ?? "").trim();
    return text || null;
}

function nullableInteger(value) {
    if (value === null || value === undefined || value === "") return null;
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
}

function booleanValue(value, fallback = false) {
    if (value === undefined || value === null || value === "") return fallback;
    if (typeof value === "boolean") return value;
    return ["true", "1", "yes", "on"].includes(String(value).toLowerCase());
}

async function getColumns(tableName) {
    const result = await pool.query(
        `SELECT column_name
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = $1`,
        [tableName]
    );
    return result.rows.map((row) => row.column_name);
}

async function insertDefaultGroupsForCourse(courseId) {
    for (const group of DEFAULT_COURSE_GROUPS) {
        await pool.query(
            `INSERT INTO course_groups (course_id, group_name, gamification_enabled, virtual_space_enabled)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (course_id, group_name)
             DO UPDATE SET
                 gamification_enabled = EXCLUDED.gamification_enabled,
                 virtual_space_enabled = EXCLUDED.virtual_space_enabled,
                 deleted_at = NULL,
                 updated_at = NOW()`,
            [courseId, group.group_name, group.gamification_enabled, group.virtual_space_enabled]
        );
    }
}

async function insertDefaultGroupsForAllCourses() {
    const result = await pool.query(`
        SELECT course_id
        FROM courses
        WHERE deleted_at IS NULL
        ORDER BY course_id ASC
    `);

    for (const course of result.rows) {
        await insertDefaultGroupsForCourse(course.course_id);
    }
}

async function migrateUsersToCourseGroups() {
    const columns = await getColumns("users");
    if (!columns.includes("course_group_id")) return;

    const hasGamificationColumn = columns.includes("gamification_enabled");
    const hasNoVirtualColumn = columns.includes("use_no_virtual_space");

    if (hasGamificationColumn && hasNoVirtualColumn) {
        await pool.query(
            `INSERT INTO course_groups (course_id, group_name, gamification_enabled, virtual_space_enabled)
             SELECT DISTINCT u.course_id, $1::text, $2::boolean, $3::boolean
             FROM users u
             JOIN courses c ON c.course_id = u.course_id
             WHERE u.deleted_at IS NULL
               AND c.deleted_at IS NULL
               AND COALESCE(u.gamification_enabled, FALSE) = FALSE
               AND COALESCE(u.use_no_virtual_space, FALSE) = FALSE
             ON CONFLICT (course_id, group_name)
             DO UPDATE SET
                 gamification_enabled = EXCLUDED.gamification_enabled,
                 virtual_space_enabled = EXCLUDED.virtual_space_enabled,
                 deleted_at = NULL,
                 updated_at = NOW()`,
            [LEGACY_VIRTUAL_GROUP.group_name, LEGACY_VIRTUAL_GROUP.gamification_enabled, LEGACY_VIRTUAL_GROUP.virtual_space_enabled]
        );

        await pool.query(`
            UPDATE users u
            SET course_group_id = cg.course_group_id
            FROM course_groups cg
            WHERE u.course_group_id IS NULL
              AND cg.course_id = u.course_id
              AND cg.deleted_at IS NULL
              AND cg.group_name = CASE
                    WHEN COALESCE(u.gamification_enabled, FALSE) = FALSE
                     AND COALESCE(u.use_no_virtual_space, FALSE) = TRUE THEN 'Group A'
                    WHEN COALESCE(u.gamification_enabled, FALSE) = TRUE
                     AND COALESCE(u.use_no_virtual_space, FALSE) = TRUE THEN 'Group B'
                    WHEN COALESCE(u.gamification_enabled, FALSE) = TRUE
                     AND COALESCE(u.use_no_virtual_space, FALSE) = FALSE THEN 'Group C'
                    ELSE 'Legacy Virtual Space'
                  END
        `);
    }

    await pool.query(`
        UPDATE users u
        SET course_group_id = cg.course_group_id
        FROM course_groups cg
        WHERE u.course_group_id IS NULL
          AND cg.course_id = u.course_id
          AND cg.deleted_at IS NULL
          AND cg.group_name = 'Group A'
    `);
}

async function createCourseGroupSchema() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS course_groups (
            course_group_id SERIAL PRIMARY KEY,
            course_id INTEGER NOT NULL REFERENCES courses(course_id),
            group_name TEXT NOT NULL,
            gamification_enabled BOOLEAN NOT NULL DEFAULT FALSE,
            virtual_space_enabled BOOLEAN NOT NULL DEFAULT FALSE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            deleted_at TIMESTAMPTZ,
            UNIQUE (course_id, group_name)
        )
    `);

    await pool.query(`
        ALTER TABLE users
        ADD COLUMN IF NOT EXISTS course_group_id INTEGER REFERENCES course_groups(course_group_id)
    `);

    await pool.query(`
        CREATE INDEX IF NOT EXISTS users_course_group_id_idx
        ON users (course_group_id)
    `);

    await insertDefaultGroupsForAllCourses();
    await migrateUsersToCourseGroups();

    await pool.query(`ALTER TABLE users DROP COLUMN IF EXISTS gamification_enabled`);
    await pool.query(`ALTER TABLE users DROP COLUMN IF EXISTS use_no_virtual_space`);
}

export async function ensureCourseGroupSchema() {
    if (!courseGroupReadyPromise) {
        courseGroupReadyPromise = createCourseGroupSchema().catch((error) => {
            courseGroupReadyPromise = null;
            throw error;
        });
    }

    return courseGroupReadyPromise;
}

export async function ensureDefaultCourseGroups(courseId) {
    await ensureCourseGroupSchema();
    if (!courseId) return;
    await insertDefaultGroupsForCourse(courseId);
}

export async function getDefaultCourseGroupForCourse(courseId) {
    await ensureCourseGroupSchema();
    const result = await pool.query(
        `SELECT *
         FROM course_groups
         WHERE course_id = $1
           AND deleted_at IS NULL
           AND group_name = 'Group A'
         LIMIT 1`,
        [courseId]
    );
    return result.rows[0] || null;
}

export async function listCourseGroups() {
    await ensureCourseGroupSchema();
    const result = await pool.query(`
        SELECT
            cg.course_group_id,
            cg.course_id,
            c.course_name,
            cg.group_name,
            cg.gamification_enabled,
            cg.virtual_space_enabled,
            COUNT(u.user_id)::int AS student_count,
            cg.updated_at
        FROM course_groups cg
        JOIN courses c ON c.course_id = cg.course_id
        LEFT JOIN users u
               ON u.course_group_id = cg.course_group_id
              AND u.deleted_at IS NULL
        WHERE cg.deleted_at IS NULL
          AND c.deleted_at IS NULL
        GROUP BY cg.course_group_id, c.course_name
        ORDER BY c.course_name ASC, cg.group_name ASC
    `);
    return result.rows;
}

export async function createCourseGroup(payload) {
    await ensureCourseGroupSchema();
    const result = await pool.query(
        `INSERT INTO course_groups (course_id, group_name, gamification_enabled, virtual_space_enabled)
         VALUES ($1, $2, $3, $4)
         RETURNING course_group_id`,
        [
            nullableInteger(payload.course_id),
            nullableText(payload.group_name),
            booleanValue(payload.gamification_enabled, false),
            booleanValue(payload.virtual_space_enabled, false),
        ]
    );
    return result.rows[0];
}

export async function updateCourseGroup(id, payload) {
    await ensureCourseGroupSchema();
    const result = await pool.query(
        `UPDATE course_groups
         SET course_id = $2,
             group_name = $3,
             gamification_enabled = $4,
             virtual_space_enabled = $5,
             updated_at = NOW()
         WHERE course_group_id = $1
           AND deleted_at IS NULL
         RETURNING course_group_id`,
        [
            nullableInteger(id),
            nullableInteger(payload.course_id),
            nullableText(payload.group_name),
            booleanValue(payload.gamification_enabled, false),
            booleanValue(payload.virtual_space_enabled, false),
        ]
    );
    return result.rows[0] || null;
}

export async function deleteCourseGroup(id) {
    await ensureCourseGroupSchema();
    const result = await pool.query(
        `UPDATE course_groups cg
         SET deleted_at = NOW(),
             updated_at = NOW()
         WHERE cg.course_group_id = $1
           AND cg.deleted_at IS NULL
           AND cg.group_name NOT IN ('Group A', 'Group B', 'Group C')
           AND NOT EXISTS (
               SELECT 1
               FROM users u
               WHERE u.course_group_id = cg.course_group_id
                 AND u.deleted_at IS NULL
           )
         RETURNING cg.course_group_id`,
        [nullableInteger(id)]
    );
    return result.rows[0] || null;
}

export async function assignUsersToCourseGroup({courseGroupId, userIds}) {
    await ensureCourseGroupSchema();
    const normalizedIds = [...new Set((userIds || [])
        .map((id) => nullableInteger(id))
        .filter((id) => Number.isInteger(id)))];

    if (!courseGroupId || normalizedIds.length === 0) return {updated_count: 0};

    const groupResult = await pool.query(
        `SELECT course_group_id, course_id
         FROM course_groups
         WHERE course_group_id = $1
           AND deleted_at IS NULL
         LIMIT 1`,
        [nullableInteger(courseGroupId)]
    );
    const group = groupResult.rows[0];
    if (!group) {
        const error = new Error("Course group tidak ditemukan");
        error.code = "COURSE_GROUP_NOT_FOUND";
        throw error;
    }

    const updateResult = await pool.query(
        `UPDATE users
         SET course_group_id = $1
         WHERE user_id = ANY($2::int[])
           AND course_id = $3
           AND deleted_at IS NULL
         RETURNING user_id`,
        [group.course_group_id, normalizedIds, group.course_id]
    );

    return {
        updated_count: updateResult.rowCount,
        skipped_count: normalizedIds.length - updateResult.rowCount,
    };
}
