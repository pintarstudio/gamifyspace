// backend/models/courseModel.js
import {pool} from "../db/index.js";
import {ensureAdminTables} from "./adminModel.js";
import {ensureRoleSchema, INSTRUCTOR_ROLE_ID} from "./roleModel.js";

let courseReadyPromise = null;

async function createCourseSchema() {
    await ensureAdminTables();
    await ensureRoleSchema();

    await pool.query(`
        ALTER TABLE courses
        ADD COLUMN IF NOT EXISTS instructor_id INTEGER
    `);

    await pool.query(`
        ALTER TABLE courses
        ADD COLUMN IF NOT EXISTS instructor2_id INTEGER
    `);

    await pool.query(`
        ALTER TABLE courses
        ALTER COLUMN instructor_id DROP NOT NULL
    `);

    await pool.query(`
        ALTER TABLE courses
        ALTER COLUMN instructor2_id DROP NOT NULL
    `);

    await pool.query(`
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1
                FROM pg_constraint
                WHERE conname = 'courses_instructor_id_fkey'
                  AND conrelid = 'courses'::regclass
            ) THEN
                ALTER TABLE courses DROP CONSTRAINT courses_instructor_id_fkey;
            END IF;
        END $$;
    `);

    await pool.query(`
        DO $$
        BEGIN
            IF to_regclass('public.instructor') IS NOT NULL THEN
                UPDATE users u
                SET role_id = ${INSTRUCTOR_ROLE_ID}
                FROM instructor i
                WHERE u.deleted_at IS NULL
                  AND LOWER(TRIM(u.name::TEXT)) = LOWER(TRIM(i.instructor_name::TEXT));

                UPDATE courses c
                SET instructor_id = u.user_id,
                    updated_at = NOW()
                FROM instructor i
                JOIN users u
                  ON LOWER(TRIM(u.name::TEXT)) = LOWER(TRIM(i.instructor_name::TEXT))
                 AND u.deleted_at IS NULL
                WHERE c.instructor_id = i.instructor_id;
            END IF;

            IF EXISTS (
                SELECT 1
                FROM information_schema.columns
                WHERE table_name = 'courses'
                  AND column_name = 'lecturer_name'
            ) THEN
                UPDATE courses c
                SET instructor_id = u.user_id,
                    updated_at = NOW()
                FROM users u
                WHERE c.instructor_id IS NULL
                  AND c.lecturer_name IS NOT NULL
                  AND u.deleted_at IS NULL
                  AND LOWER(TRIM(c.lecturer_name::TEXT)) = LOWER(TRIM(u.name::TEXT));

                UPDATE users u
                SET role_id = ${INSTRUCTOR_ROLE_ID}
                FROM courses c
                WHERE c.lecturer_name IS NOT NULL
                  AND u.deleted_at IS NULL
                  AND LOWER(TRIM(c.lecturer_name::TEXT)) = LOWER(TRIM(u.name::TEXT));
            END IF;
        END $$;
    `);

    await pool.query(`
        UPDATE courses c
        SET instructor_id = NULL,
            updated_at = NOW()
        WHERE c.instructor_id IS NOT NULL
          AND NOT EXISTS (
              SELECT 1
              FROM users u
              WHERE u.user_id = c.instructor_id
                AND u.role_id = ${INSTRUCTOR_ROLE_ID}
                AND u.deleted_at IS NULL
          )
    `);

    await pool.query(`
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
          )
    `);

    await pool.query(`
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1
                FROM pg_constraint
                WHERE conname = 'courses_instructor_id_users_fkey'
                  AND conrelid = 'courses'::regclass
            ) THEN
                ALTER TABLE courses
                ADD CONSTRAINT courses_instructor_id_users_fkey
                FOREIGN KEY (instructor_id) REFERENCES users(user_id)
                ON DELETE SET NULL;
            END IF;
        END $$;
    `);

    await pool.query(`
        DO $$
        BEGIN
            IF NOT EXISTS (
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
        ALTER TABLE courses
        DROP COLUMN IF EXISTS lecturer_name
    `);

    await pool.query(`
        DROP TABLE IF EXISTS instructors CASCADE
    `);

    await pool.query(`
        DROP TABLE IF EXISTS instructor CASCADE
    `);
}

export async function ensureCourseSchema() {
    if (!courseReadyPromise) {
        courseReadyPromise = createCourseSchema().catch((error) => {
            courseReadyPromise = null;
            throw error;
        });
    }

    return courseReadyPromise;
}

export async function getAllCourses() {
    await ensureCourseSchema();
    const result = await pool.query(`
        SELECT c.*,
               u1.name AS instructor_name,
               u2.name AS instructor2_name,
               CONCAT_WS(', ', u1.name, u2.name) AS instructor_names
        FROM courses c
        LEFT JOIN users u1 ON u1.user_id = c.instructor_id
        LEFT JOIN users u2 ON u2.user_id = c.instructor2_id
        WHERE c.deleted_at IS NULL
        ORDER BY c.course_name ASC
    `);
    return result.rows;
}

export async function findCourseByName(courseName) {
    await ensureCourseSchema();
    const result = await pool.query(
        `SELECT c.*,
                u1.name AS instructor_name,
                u2.name AS instructor2_name,
                CONCAT_WS(', ', u1.name, u2.name) AS instructor_names
         FROM courses c
         LEFT JOIN users u1 ON u1.user_id = c.instructor_id
         LEFT JOIN users u2 ON u2.user_id = c.instructor2_id
         WHERE c.deleted_at IS NULL
           AND LOWER(TRIM(c.course_name)) = LOWER(TRIM($1))
         LIMIT 1`,
        [courseName]
    );
    return result.rows[0] || null;
}

export async function findActiveCourseById(courseId) {
    await ensureCourseSchema();
    const result = await pool.query(
        `SELECT c.*,
                u1.name AS instructor_name,
                u2.name AS instructor2_name,
                CONCAT_WS(', ', u1.name, u2.name) AS instructor_names
         FROM courses c
         LEFT JOIN users u1 ON u1.user_id = c.instructor_id
         LEFT JOIN users u2 ON u2.user_id = c.instructor2_id
         WHERE c.course_id = $1
           AND c.deleted_at IS NULL
         LIMIT 1`,
        [courseId]
    );
    return result.rows[0] || null;
}

export async function getManagedCoursesForInstructor(userId, fallbackCourseId = null) {
    await ensureCourseSchema();
    const result = await pool.query(
        `SELECT
             c.course_id,
             c.course_code,
             c.course_name,
             c.semester,
             c.location,
             c.instructor_id,
             c.instructor2_id,
             u1.name AS instructor_name,
             u2.name AS instructor2_name,
             CONCAT_WS(', ', u1.name, u2.name) AS instructor_names
         FROM courses c
         LEFT JOIN users u1 ON u1.user_id = c.instructor_id
         LEFT JOIN users u2 ON u2.user_id = c.instructor2_id
         WHERE c.deleted_at IS NULL
           AND (
               c.instructor_id = $1
               OR c.instructor2_id = $1
               OR ($2::int IS NOT NULL AND c.course_id = $2)
           )
         ORDER BY c.course_name ASC`,
        [userId, fallbackCourseId || null]
    );
    return result.rows;
}
