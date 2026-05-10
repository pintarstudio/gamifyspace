// backend/models/courseModel.js
import {pool} from "../db/index.js";
import {ensureAdminTables} from "./adminModel.js";

let courseReadyPromise = null;

async function createCourseSchema() {
    await ensureAdminTables();

    await pool.query(`
        ALTER TABLE courses
        ADD COLUMN IF NOT EXISTS instructor_id INTEGER
    `);

    await pool.query(`
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1
                FROM information_schema.columns
                WHERE table_name = 'courses'
                  AND column_name = 'lecturer_name'
            ) THEN
                UPDATE courses c
                SET instructor_id = i.instructor_id,
                    updated_at = NOW()
                FROM instructor i
                WHERE c.instructor_id IS NULL
                  AND c.lecturer_name IS NOT NULL
                  AND LOWER(TRIM(c.lecturer_name::TEXT)) = LOWER(TRIM(i.instructor_name::TEXT));
            END IF;
        END $$;
    `);

    await pool.query(`
        UPDATE courses
        SET instructor_id = 1,
            updated_at = NOW()
        WHERE instructor_id IS NULL
          AND EXISTS (
              SELECT 1
              FROM instructor
              WHERE instructor_id = 1
          )
    `);

    await pool.query(`
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1
                FROM pg_constraint
                WHERE conname = 'courses_instructor_id_fkey'
                  AND conrelid = 'courses'::regclass
            ) THEN
                ALTER TABLE courses
                ADD CONSTRAINT courses_instructor_id_fkey
                FOREIGN KEY (instructor_id) REFERENCES instructor(instructor_id);
            END IF;
        END $$;
    `);

    await pool.query(`
        ALTER TABLE courses
        ALTER COLUMN instructor_id SET NOT NULL
    `);

    await pool.query(`
        ALTER TABLE courses
        DROP COLUMN IF EXISTS lecturer_name
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
        SELECT c.*, i.instructor_name
        FROM courses c
        JOIN instructor i ON i.instructor_id = c.instructor_id
        WHERE c.deleted_at IS NULL
        ORDER BY c.course_name ASC
    `);
    return result.rows;
}

export async function findCourseByName(courseName) {
    await ensureCourseSchema();
    const result = await pool.query(
        `SELECT c.*, i.instructor_name
         FROM courses c
         JOIN instructor i ON i.instructor_id = c.instructor_id
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
        `SELECT c.*, i.instructor_name
         FROM courses c
         JOIN instructor i ON i.instructor_id = c.instructor_id
         WHERE c.course_id = $1
           AND c.deleted_at IS NULL
         LIMIT 1`,
        [courseId]
    );
    return result.rows[0] || null;
}
