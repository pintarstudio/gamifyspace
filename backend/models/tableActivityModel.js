import {pool} from "../db/index.js";
import {ensureGamificationTables} from "./gamificationModel.js";

let tablesReady = false;
export const GROUP_ACTIVITY_DURATION_SECONDS = 600;
export const GROUP_START_DELAY_SECONDS = 3;

const hasColumn = (columns, name) => columns.includes(name);

const pickColumn = (columns, candidates) =>
    candidates.find((candidate) => hasColumn(columns, candidate));

const quoteIdent = (name) => `"${String(name).replace(/"/g, '""')}"`;

const SESSION_SELECT = `
    SELECT
        s.*,
        COALESCE(tc.case_title, s.case_title) AS case_title,
        COALESCE(tc.case_prompt, s.case_prompt) AS case_prompt
    FROM table_group_sessions s
    LEFT JOIN topic_cases tc ON tc.case_id = s.case_id
`;

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

async function ensureTopicVisibilityColumns() {
    const columns = await getColumns("topics");
    if (columns.length === 0) return [];

    await pool.query(`ALTER TABLE topics ADD COLUMN IF NOT EXISTS show_topic BOOLEAN NOT NULL DEFAULT TRUE`);
    await pool.query(`ALTER TABLE topics ADD COLUMN IF NOT EXISTS show_pre_test BOOLEAN NOT NULL DEFAULT TRUE`);
    await pool.query(`ALTER TABLE topics ADD COLUMN IF NOT EXISTS show_post_test BOOLEAN NOT NULL DEFAULT TRUE`);

    await pool.query(`
        DO $$
        BEGIN
            IF to_regclass('public.individual_topic_settings') IS NOT NULL THEN
                UPDATE topics t
                SET show_pre_test = COALESCE(s.show_pre_test, TRUE),
                    show_post_test = COALESCE(s.show_post_test, TRUE)
                FROM individual_topic_settings s
                WHERE s.topic_id = t.topic_id;
            END IF;
        END $$;
    `);

    await pool.query(`DROP TABLE IF EXISTS individual_topic_settings`);

    return Array.from(new Set([...columns, "show_topic", "show_pre_test", "show_post_test"]));
}

export async function ensureTableActivityTables() {
    if (tablesReady) return;

    await ensureGamificationTables();
    await ensureTopicVisibilityColumns();

    await pool.query(`
        CREATE TABLE IF NOT EXISTS topic_cases (
            case_id SERIAL PRIMARY KEY,
            topic_id INTEGER NOT NULL,
            case_number INTEGER NOT NULL,
            case_title TEXT NOT NULL,
            case_prompt TEXT NOT NULL,
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (topic_id, case_number)
        )
    `);

    await pool.query(`
        ALTER TABLE topic_cases
        DROP CONSTRAINT IF EXISTS topic_cases_case_number_check
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS table_group_sessions (
            session_id SERIAL PRIMARY KEY,
            course_id INTEGER NOT NULL,
            course_group_id INTEGER,
            topic_id INTEGER,
            case_id INTEGER REFERENCES topic_cases(case_id),
            group_id INTEGER NOT NULL,
            object_id TEXT,
            answer_text TEXT NOT NULL DEFAULT '',
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            created_by INTEGER NOT NULL,
            submitted_by INTEGER,
            submitted_at TIMESTAMPTZ,
            feedback_text TEXT,
            duration_seconds INTEGER NOT NULL DEFAULT 600,
            seconds_spent INTEGER NOT NULL DEFAULT 0,
            seconds_left INTEGER NOT NULL DEFAULT 600,
            work_started_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            ended_at TIMESTAMPTZ
        )
    `);

    await pool.query(`ALTER TABLE table_group_sessions ADD COLUMN IF NOT EXISTS course_group_id INTEGER`);
    await pool.query(`
        UPDATE table_group_sessions s
        SET course_group_id = u.course_group_id
        FROM users u
        WHERE s.course_group_id IS NULL
          AND u.user_id = s.created_by
    `);
    await pool.query(`ALTER TABLE table_group_sessions ADD COLUMN IF NOT EXISTS case_id INTEGER REFERENCES topic_cases(case_id)`);
    await pool.query(`ALTER TABLE table_group_sessions ADD COLUMN IF NOT EXISTS case_title TEXT`);
    await pool.query(`ALTER TABLE table_group_sessions ADD COLUMN IF NOT EXISTS case_prompt TEXT`);
    await pool.query(`ALTER TABLE table_group_sessions ALTER COLUMN case_title DROP NOT NULL`);
    await pool.query(`ALTER TABLE table_group_sessions ALTER COLUMN case_prompt DROP NOT NULL`);
    await pool.query(`ALTER TABLE table_group_sessions ADD COLUMN IF NOT EXISTS submitted_by INTEGER`);
    await pool.query(`ALTER TABLE table_group_sessions ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ`);
    await pool.query(`ALTER TABLE table_group_sessions ADD COLUMN IF NOT EXISTS feedback_text TEXT`);
    await pool.query(`ALTER TABLE table_group_sessions ADD COLUMN IF NOT EXISTS combined_feedback JSONB`);
    await pool.query(`ALTER TABLE table_group_sessions ADD COLUMN IF NOT EXISTS feedback_model TEXT`);
    await pool.query(`ALTER TABLE table_group_sessions ADD COLUMN IF NOT EXISTS feedback_generated_at TIMESTAMPTZ`);
    await pool.query(`ALTER TABLE table_group_sessions ADD COLUMN IF NOT EXISTS feedback_status TEXT NOT NULL DEFAULT 'idle'`);
    await pool.query(`ALTER TABLE table_group_sessions ADD COLUMN IF NOT EXISTS feedback_started_at TIMESTAMPTZ`);
    await pool.query(`ALTER TABLE table_group_sessions ADD COLUMN IF NOT EXISTS feedback_error TEXT`);
    await pool.query(`ALTER TABLE table_group_sessions ADD COLUMN IF NOT EXISTS duration_seconds INTEGER NOT NULL DEFAULT ${GROUP_ACTIVITY_DURATION_SECONDS}`);
    await pool.query(`ALTER TABLE table_group_sessions ADD COLUMN IF NOT EXISTS seconds_spent INTEGER NOT NULL DEFAULT 0`);
    await pool.query(`ALTER TABLE table_group_sessions ADD COLUMN IF NOT EXISTS seconds_left INTEGER NOT NULL DEFAULT ${GROUP_ACTIVITY_DURATION_SECONDS}`);
    await pool.query(`ALTER TABLE table_group_sessions ADD COLUMN IF NOT EXISTS work_started_at TIMESTAMPTZ`);
    await pool.query(`
        UPDATE table_group_sessions
        SET duration_seconds = ${GROUP_ACTIVITY_DURATION_SECONDS},
            seconds_left = CASE WHEN seconds_left > 0 THEN seconds_left ELSE ${GROUP_ACTIVITY_DURATION_SECONDS} END
        WHERE duration_seconds = 0
    `);

    await pool.query(`DROP INDEX IF EXISTS table_group_sessions_one_active_idx`);
    await pool.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS table_group_sessions_one_active_course_group_idx
        ON table_group_sessions (course_id, (COALESCE(course_group_id, 0)), group_id)
        WHERE is_active = TRUE
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS table_group_members (
            member_id SERIAL PRIMARY KEY,
            session_id INTEGER NOT NULL REFERENCES table_group_sessions(session_id) ON DELETE CASCADE,
            user_id INTEGER NOT NULL,
            avatar_public_path TEXT,
            object_id TEXT,
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (session_id, user_id)
        )
    `);
    await pool.query(`ALTER TABLE table_group_members ADD COLUMN IF NOT EXISTS object_id TEXT`);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS table_group_answers (
            answer_id SERIAL PRIMARY KEY,
            session_id INTEGER NOT NULL REFERENCES table_group_sessions(session_id) ON DELETE CASCADE,
            user_id INTEGER NOT NULL,
            answer_text TEXT NOT NULL DEFAULT '',
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (session_id, user_id)
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS table_group_feedback_groups (
            feedback_group_id SERIAL PRIMARY KEY,
            session_id INTEGER NOT NULL REFERENCES table_group_sessions(session_id) ON DELETE CASCADE,
            student_ids INTEGER[] NOT NULL,
            student_names TEXT[] NOT NULL,
            www TEXT NOT NULL,
            ebi TEXT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);

    tablesReady = true;
}

export async function getCourseById(courseId) {
    const result = await pool.query(
        `SELECT course_id, course_name
         FROM courses
         WHERE course_id = $1
           AND deleted_at IS NULL
         LIMIT 1`,
        [courseId]
    );
    return result.rows[0] || null;
}

export async function getTopicsForCourse(courseId, options = {}) {
    const columns = await ensureTopicVisibilityColumns();
    if (columns.length === 0) return [];

    const idColumn = pickColumn(columns, ["topic_id", "id"]);
    const nameColumn = pickColumn(columns, ["topic_name", "name", "title"]);
    const descriptionColumn = pickColumn(columns, ["topic_description", "description", "content"]);
    const courseColumn = pickColumn(columns, ["course_id"]);

    if (!idColumn || !nameColumn) return [];

    const selectColumns = [
        `${quoteIdent(idColumn)} AS topic_id`,
        `${quoteIdent(nameColumn)} AS topic_name`,
    ];
    if (descriptionColumn) {
        selectColumns.push(`${quoteIdent(descriptionColumn)} AS topic_description`);
    } else {
        selectColumns.push(`NULL AS topic_description`);
    }
    selectColumns.push(`COALESCE(show_topic, TRUE) AS show_topic`);
    selectColumns.push(`COALESCE(show_pre_test, TRUE) AS show_pre_test`);
    selectColumns.push(`COALESCE(show_post_test, TRUE) AS show_post_test`);

    const where = [];
    const params = [];
    if (courseColumn) {
        params.push(courseId);
        where.push(`${quoteIdent(courseColumn)} = $${params.length}`);
    }
    if (hasColumn(columns, "deleted_at")) {
        where.push(`deleted_at IS NULL`);
    }
    if (!options.includeHidden) {
        where.push(`COALESCE(show_topic, TRUE) = TRUE`);
    }

    const result = await pool.query(
        `SELECT ${selectColumns.join(", ")}
         FROM topics
         ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
         ORDER BY ${quoteIdent(nameColumn)} ASC`,
        params
    );

    return result.rows;
}

export async function getTopicById(topicId, courseId) {
    const topics = await getTopicsForCourse(courseId);
    return topics.find((topic) => String(topic.topic_id) === String(topicId)) || null;
}

export async function getTopicByIdIncludingHidden(topicId, courseId) {
    const topics = await getTopicsForCourse(courseId, {includeHidden: true});
    return topics.find((topic) => String(topic.topic_id) === String(topicId)) || null;
}

export async function updateTopicVisibility(topicId, showTopic) {
    const columns = await ensureTopicVisibilityColumns();
    const idColumn = pickColumn(columns, ["topic_id", "id"]);
    if (!idColumn) return null;

    const result = await pool.query(
        `UPDATE topics
         SET show_topic = $2
         WHERE ${quoteIdent(idColumn)} = $1
         RETURNING ${quoteIdent(idColumn)} AS topic_id, show_topic`,
        [topicId, !!showTopic]
    );
    return result.rows[0] || null;
}

export async function updateTopicAssessmentVisibility(topicId, settings = {}) {
    const columns = await ensureTopicVisibilityColumns();
    const idColumn = pickColumn(columns, ["topic_id", "id"]);
    if (!idColumn) return null;

    const result = await pool.query(
        `UPDATE topics
         SET show_pre_test = COALESCE($2, show_pre_test),
             show_post_test = COALESCE($3, show_post_test)
         WHERE ${quoteIdent(idColumn)} = $1
         RETURNING ${quoteIdent(idColumn)} AS topic_id, show_pre_test, show_post_test`,
        [
            topicId,
            settings.show_pre_test === undefined ? null : !!settings.show_pre_test,
            settings.show_post_test === undefined ? null : !!settings.show_post_test,
        ]
    );
    return result.rows[0] || null;
}

export async function getCasesForTopic(topicId) {
    const result = await pool.query(
        `SELECT case_id, topic_id, case_number, case_title, case_prompt
         FROM topic_cases
         WHERE topic_id = $1
           AND is_active = TRUE
         ORDER BY case_number ASC`,
        [topicId]
    );
    return result.rows;
}

export async function getSubmittedCaseIdsForStudent(userId, topicId) {
    const result = await pool.query(
        `SELECT DISTINCT s.case_id
         FROM table_group_sessions s
         JOIN table_group_members m
           ON m.session_id = s.session_id
          AND m.user_id = $1
         WHERE s.topic_id = $2
           AND s.case_id IS NOT NULL
           AND s.submitted_at IS NOT NULL`,
        [userId, topicId]
    );
    return result.rows.map((row) => row.case_id);
}

export async function selectAvailableCaseForStudent(topicId, userId) {
    const [cases, completedCaseIds] = await Promise.all([
        getCasesForTopic(topicId),
        getSubmittedCaseIdsForStudent(userId, topicId),
    ]);
    const completedSet = new Set(completedCaseIds.map(String));
    const availableCases = cases.filter((item) => !completedSet.has(String(item.case_id)));

    if (availableCases.length === 0) {
        return {caseStudy: null, availableCases, completedCount: completedCaseIds.length, totalCases: cases.length};
    }

    const selectedIndex = Math.floor(Math.random() * availableCases.length);
    return {
        caseStudy: availableCases[selectedIndex],
        availableCases,
        completedCount: completedCaseIds.length,
        totalCases: cases.length,
    };
}

export async function getActiveGroupSession(courseId, groupId, courseGroupId = null) {
    await cleanupStaleMembersForGroup(courseId, groupId, courseGroupId);

    const result = await pool.query(
        `${SESSION_SELECT}
         WHERE s.course_id = $1
           AND s.group_id = $2
           AND s.course_group_id IS NOT DISTINCT FROM $3
           AND s.is_active = TRUE
         ORDER BY s.created_at DESC
         LIMIT 1`,
        [courseId, groupId, courseGroupId || null]
    );
    return result.rows[0] || null;
}

export async function getActiveGroupOccupancy({courseId, courseGroupId = null, groupIds = [], userId = null}) {
    const safeGroupIds = Array.from(new Set(
        (Array.isArray(groupIds) ? groupIds : [])
            .map((groupId) => Number.parseInt(groupId, 10))
            .filter((groupId) => Number.isFinite(groupId) && groupId > 0)
    ));

    await Promise.all(
        safeGroupIds.map((groupId) => cleanupStaleMembersForGroup(courseId, groupId, courseGroupId))
    );

    const params = [courseId, courseGroupId || null, userId || null];
    const groupFilter = safeGroupIds.length > 0
        ? `AND s.group_id = ANY($${params.push(safeGroupIds)}::int[])`
        : "";

    const result = await pool.query(
        `SELECT
             s.session_id,
             s.group_id,
             s.object_id,
             s.created_by,
             s.work_started_at,
             s.submitted_at,
             s.feedback_status,
             COALESCE(
                 JSON_AGG(
                     JSON_BUILD_OBJECT(
                         'user_id', m.user_id,
                         'name', u.name,
                         'avatar_public_path', m.avatar_public_path,
                         'object_id', m.object_id
                     )
                     ORDER BY m.joined_at ASC
                 ) FILTER (WHERE m.member_id IS NOT NULL AND m.is_active = TRUE),
                 '[]'::json
             ) AS members,
             COALESCE(BOOL_OR(m.is_active = TRUE AND m.user_id = $3), FALSE) AS is_member
         FROM table_group_sessions s
         LEFT JOIN table_group_members m
           ON m.session_id = s.session_id
          AND m.is_active = TRUE
         LEFT JOIN users u ON u.user_id = m.user_id
         WHERE s.course_id = $1
           AND s.course_group_id IS NOT DISTINCT FROM $2
           AND s.is_active = TRUE
           ${groupFilter}
         GROUP BY
             s.session_id,
             s.group_id,
             s.object_id,
             s.created_by,
             s.work_started_at,
             s.submitted_at,
             s.feedback_status
         ORDER BY s.group_id ASC`,
        params
    );

    return result.rows;
}

export async function getSessionById(sessionId) {
    await cleanupStaleMembers(sessionId);

    const result = await pool.query(
        `${SESSION_SELECT}
         WHERE s.session_id = $1
         LIMIT 1`,
        [sessionId]
    );
    return result.rows[0] || null;
}

export async function getSessionMembers(sessionId) {
    await cleanupStaleMembers(sessionId);

    const result = await pool.query(
        `SELECT
             m.member_id,
             m.session_id,
             m.user_id,
             u.name,
             u.email,
             m.avatar_public_path,
             m.object_id,
             m.joined_at,
             m.last_seen_at,
             m.is_active
         FROM table_group_members m
         JOIN users u ON u.user_id = m.user_id
         WHERE m.session_id = $1
           AND m.is_active = TRUE
         ORDER BY m.joined_at ASC`,
        [sessionId]
    );
    return result.rows;
}

export async function getSessionAnswers(sessionId) {
    await cleanupStaleMembers(sessionId);

    const result = await pool.query(
        `SELECT
             a.answer_id,
             a.session_id,
             a.user_id,
             u.name,
             m.avatar_public_path,
             a.answer_text,
             a.updated_at
         FROM table_group_answers a
         JOIN table_group_sessions s ON s.session_id = a.session_id
         LEFT JOIN table_group_members m
           ON m.session_id = a.session_id
          AND m.user_id = a.user_id
         JOIN users u ON u.user_id = a.user_id
         WHERE a.session_id = $1
           AND a.is_active = TRUE
           AND a.answer_text <> ''
           AND (s.submitted_at IS NOT NULL OR m.is_active = TRUE)
         ORDER BY a.updated_at DESC`,
        [sessionId]
    );
    return result.rows;
}

export async function getSessionFeedbackGroups(sessionId) {
    const result = await pool.query(
        `SELECT
             feedback_group_id,
             session_id,
             student_ids,
             student_names,
             www,
             ebi,
             created_at
         FROM table_group_feedback_groups
         WHERE session_id = $1
         ORDER BY feedback_group_id ASC`,
        [sessionId]
    );
    return result.rows;
}

export async function addMemberToSession(sessionId, user, objectId = null) {
    await pool.query(
        `INSERT INTO table_group_members (session_id, user_id, avatar_public_path, object_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (session_id, user_id)
         DO UPDATE SET
             is_active = TRUE,
             avatar_public_path = EXCLUDED.avatar_public_path,
             object_id = COALESCE(EXCLUDED.object_id, table_group_members.object_id),
             last_seen_at = NOW()`,
        [sessionId, user.user_id, user.avatar_public_path || null, objectId || null]
    );
}

export async function touchSessionMember(sessionId, user) {
    const result = await pool.query(
        `UPDATE table_group_members
         SET last_seen_at = NOW()
         WHERE session_id = $1
           AND user_id = $2
           AND is_active = TRUE
         RETURNING *`,
        [sessionId, user.user_id]
    );
    return result.rows[0] || null;
}

export async function startGroupSessionWork(sessionId, userId, minMembers = 2) {
    const client = await pool.connect();

    try {
        await client.query("BEGIN");
        const sessionResult = await client.query(
            `SELECT session_id, created_by, work_started_at, submitted_at, is_active
             FROM table_group_sessions
             WHERE session_id = $1
             FOR UPDATE`,
            [sessionId]
        );
        const session = sessionResult.rows[0];
        if (!session || !session.is_active || session.submitted_at) {
            await client.query("ROLLBACK");
            return {session: null, reason: "NOT_AVAILABLE"};
        }
        if (String(session.created_by) !== String(userId)) {
            await client.query("ROLLBACK");
            return {session, reason: "NOT_HOST"};
        }
        if (session.work_started_at) {
            await client.query("COMMIT");
            return {session: await getSessionById(sessionId), reason: "ALREADY_STARTED"};
        }

        const memberResult = await client.query(
            `SELECT COUNT(*)::int AS count
             FROM table_group_members
             WHERE session_id = $1
               AND is_active = TRUE`,
            [sessionId]
        );
        if (Number(memberResult.rows[0]?.count || 0) < minMembers) {
            await client.query("ROLLBACK");
            return {session, reason: "WAITING_FOR_MEMBERS", memberCount: Number(memberResult.rows[0]?.count || 0)};
        }

        const updated = await client.query(
            `UPDATE table_group_sessions
	             SET work_started_at = NOW() + ($2 * INTERVAL '1 second'),
	                 seconds_spent = 0,
	                 seconds_left = duration_seconds,
	                 updated_at = NOW()
	             WHERE session_id = $1
	             RETURNING *`,
	            [sessionId, GROUP_START_DELAY_SECONDS]
	        );

        await client.query("COMMIT");
        return {session: updated.rows[0], reason: "STARTED"};
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

export async function createGroupSession({course, topic, caseStudy, groupId, objectId, user}) {
    const client = await pool.connect();
    const courseGroupId = user.course_group_id || null;

    try {
        await client.query("BEGIN");

        const existing = await client.query(
            `SELECT session_id
             FROM table_group_sessions
             WHERE course_id = $1
               AND group_id = $2
               AND course_group_id IS NOT DISTINCT FROM $3
               AND is_active = TRUE
             LIMIT 1
             FOR UPDATE`,
            [course.course_id, groupId, courseGroupId]
        );

        if (existing.rows[0]) {
            const error = new Error("ACTIVE_SESSION_EXISTS");
            error.code = "ACTIVE_SESSION_EXISTS";
            throw error;
        }

        const created = await client.query(
            `INSERT INTO table_group_sessions
                 (course_id, course_group_id, topic_id, case_id, group_id, object_id, created_by, duration_seconds, seconds_left)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
             RETURNING *`,
            [
                course.course_id,
                courseGroupId,
                topic?.topic_id || null,
                caseStudy.case_id,
                groupId,
                objectId || null,
                user.user_id,
                GROUP_ACTIVITY_DURATION_SECONDS,
            ]
        );

        const sessionId = created.rows[0].session_id;
        await client.query(
            `INSERT INTO table_group_members (session_id, user_id, avatar_public_path, object_id)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (session_id, user_id) DO NOTHING`,
            [sessionId, user.user_id, user.avatar_public_path || null, objectId || null]
        );

        await client.query("COMMIT");
        return getSessionById(sessionId);
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

export async function saveSessionAnswer(sessionId, userId, answerText) {
    const result = await pool.query(
        `INSERT INTO table_group_answers (session_id, user_id, answer_text)
         VALUES ($1, $2, $3)
         ON CONFLICT (session_id, user_id)
         DO UPDATE SET
             answer_text = EXCLUDED.answer_text,
             is_active = TRUE,
             updated_at = NOW()
         RETURNING *`,
        [sessionId, userId, answerText || ""]
    );
    return result.rows[0] || null;
}

export async function beginFeedbackGeneration(sessionId, userId) {
    const result = await pool.query(
        `UPDATE table_group_sessions
         SET feedback_status = 'generating',
             feedback_started_at = NOW(),
             feedback_error = NULL,
             updated_at = NOW()
         WHERE session_id = $1
           AND submitted_at IS NULL
           AND is_active = TRUE
           AND COALESCE(feedback_status, 'idle') <> 'generating'
         RETURNING *`,
        [sessionId]
    );
    return result.rows[0] || null;
}

export async function beginFeedbackRetry(sessionId) {
    const result = await pool.query(
        `UPDATE table_group_sessions
         SET feedback_status = 'generating',
             feedback_started_at = NOW(),
             feedback_error = NULL,
             updated_at = NOW()
         WHERE session_id = $1
           AND submitted_at IS NOT NULL
           AND is_active = TRUE
           AND COALESCE(feedback_status, 'idle') <> 'generating'
         RETURNING *`,
        [sessionId]
    );
    return result.rows[0] || null;
}

export async function markFeedbackGenerationFailed(sessionId, errorMessage) {
    const result = await pool.query(
        `UPDATE table_group_sessions
         SET feedback_status = 'error',
             feedback_error = $2,
             updated_at = NOW()
         WHERE session_id = $1
           AND submitted_at IS NULL
         RETURNING *`,
        [sessionId, errorMessage || "Feedback generation failed"]
    );
    return result.rows[0] || null;
}

export async function submitSessionFeedbackFailed(sessionId, userId, errorMessage) {
    const result = await pool.query(
        `UPDATE table_group_sessions
         SET submitted_by = COALESCE(submitted_by, $2),
             submitted_at = COALESCE(submitted_at, NOW()),
             feedback_status = 'error',
             feedback_error = $3,
             feedback_text = '',
             combined_feedback = NULL,
             feedback_model = NULL,
             feedback_generated_at = NULL,
             seconds_spent = LEAST(duration_seconds, GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (NOW() - COALESCE(work_started_at, created_at))))::int)),
             seconds_left = GREATEST(0, duration_seconds - LEAST(duration_seconds, GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (NOW() - COALESCE(work_started_at, created_at))))::int))),
             updated_at = NOW()
         WHERE session_id = $1
           AND is_active = TRUE
         RETURNING *`,
        [sessionId, userId, errorMessage || "Feedback generation failed"]
    );
    return result.rows[0] || null;
}

function buildFeedbackText(feedback) {
    return [
        "WWW:",
        feedback.combined_feedback?.www || "",
        "",
        "EBI:",
        feedback.combined_feedback?.ebi || "",
    ].join("\n").trim();
}

export async function submitSessionAnswers(sessionId, userId, feedback, model) {
    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        const updated = await client.query(
            `UPDATE table_group_sessions
	             SET submitted_by = $2,
                 submitted_at = NOW(),
                 feedback_text = $3,
                 combined_feedback = $4::jsonb,
                 feedback_model = $5,
                 feedback_generated_at = NOW(),
                 feedback_status = 'ready',
                 feedback_error = NULL,
	                 seconds_spent = LEAST(duration_seconds, GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (NOW() - COALESCE(work_started_at, created_at))))::int)),
	                 seconds_left = GREATEST(0, duration_seconds - LEAST(duration_seconds, GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (NOW() - COALESCE(work_started_at, created_at))))::int))),
                 updated_at = NOW()
	             WHERE session_id = $1
	               AND submitted_at IS NULL
	               AND is_active = TRUE
	               AND feedback_status = 'generating'
             RETURNING *`,
            [sessionId, userId, buildFeedbackText(feedback), JSON.stringify(feedback.combined_feedback), model]
        );

        if (!updated.rows[0]) {
            await client.query("ROLLBACK");
            return null;
        }

        await client.query(
            `DELETE FROM table_group_feedback_groups
             WHERE session_id = $1`,
            [sessionId]
        );

        for (const group of feedback.student_feedback_groups || []) {
            await client.query(
                `INSERT INTO table_group_feedback_groups
                     (session_id, student_ids, student_names, www, ebi)
                 VALUES ($1, $2::int[], $3::text[], $4, $5)`,
                [
                    sessionId,
                    group.student_ids || [],
                    group.student_names || [],
                    group.www || "",
                    group.ebi || "",
                ]
            );
        }

        await client.query("COMMIT");
        return updated.rows[0];
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

export async function saveSessionFeedbackResult(sessionId, feedback, model) {
    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        const updated = await client.query(
            `UPDATE table_group_sessions
	             SET feedback_text = $2,
                 combined_feedback = $3::jsonb,
                 feedback_model = $4,
                 feedback_generated_at = NOW(),
                 feedback_status = 'ready',
                 feedback_error = NULL,
                 updated_at = NOW()
	             WHERE session_id = $1
	               AND submitted_at IS NOT NULL
	               AND is_active = TRUE
	               AND feedback_status = 'generating'
             RETURNING *`,
            [sessionId, buildFeedbackText(feedback), JSON.stringify(feedback.combined_feedback), model]
        );

        if (!updated.rows[0]) {
            await client.query("ROLLBACK");
            return null;
        }

        await client.query(
            `DELETE FROM table_group_feedback_groups
             WHERE session_id = $1`,
            [sessionId]
        );

        for (const group of feedback.student_feedback_groups || []) {
            await client.query(
                `INSERT INTO table_group_feedback_groups
                     (session_id, student_ids, student_names, www, ebi)
                 VALUES ($1, $2::int[], $3::text[], $4, $5)`,
                [
                    sessionId,
                    group.student_ids || [],
                    group.student_names || [],
                    group.www || "",
                    group.ebi || "",
                ]
            );
        }

        await client.query("COMMIT");
        return updated.rows[0];
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

export async function exitSessionMember(sessionId, userId) {
    const client = await pool.connect();

    try {
        await client.query("BEGIN");
        const session = await client.query(
            `SELECT created_by, feedback_status, work_started_at, submitted_at
             FROM table_group_sessions
             WHERE session_id = $1
             FOR UPDATE`,
            [sessionId]
        );

        if (session.rows[0]?.feedback_status === "generating") {
            const error = new Error("FEEDBACK_GENERATING");
            error.code = "FEEDBACK_GENERATING";
            throw error;
        }
        if (session.rows[0]?.work_started_at && !session.rows[0]?.submitted_at) {
            const error = new Error("SESSION_ALREADY_STARTED");
            error.code = "SESSION_ALREADY_STARTED";
            throw error;
        }

        const hostCancelledLobby = !session.rows[0]?.work_started_at
            && String(session.rows[0]?.created_by) === String(userId);
        if (hostCancelledLobby) {
            await client.query(
                `UPDATE table_group_members
                 SET is_active = FALSE,
                     last_seen_at = NOW()
                 WHERE session_id = $1
                   AND is_active = TRUE`,
                [sessionId]
            );
            await client.query(
                `UPDATE table_group_answers
                 SET is_active = FALSE,
                     updated_at = NOW()
                 WHERE session_id = $1`,
                [sessionId]
            );
            await client.query(
                `UPDATE table_group_sessions
                 SET is_active = FALSE,
                     seconds_spent = 0,
                     seconds_left = duration_seconds,
                     ended_at = NOW(),
                     updated_at = NOW()
                 WHERE session_id = $1`,
                [sessionId]
            );
            await client.query("COMMIT");
            return {remainingMembers: 0, cancelledByHost: true};
        }

        await client.query(
            `UPDATE table_group_members
             SET is_active = FALSE,
                 last_seen_at = NOW()
             WHERE session_id = $1
               AND user_id = $2`,
            [sessionId, userId]
        );
        await client.query(
            `UPDATE table_group_answers
             SET is_active = FALSE,
                 updated_at = NOW()
             WHERE session_id = $1
               AND user_id = $2
               AND NOT EXISTS (
                   SELECT 1
                   FROM table_group_sessions
                   WHERE table_group_sessions.session_id = $1
                     AND table_group_sessions.submitted_at IS NOT NULL
               )`,
            [sessionId, userId]
        );

        const activeMembers = await client.query(
            `SELECT COUNT(*)::int AS count
             FROM table_group_members
             WHERE session_id = $1
               AND is_active = TRUE`,
            [sessionId]
        );

        if (activeMembers.rows[0].count === 0) {
            await client.query(
                `UPDATE table_group_sessions
                 SET is_active = FALSE,
	                     seconds_spent = LEAST(duration_seconds, GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (NOW() - COALESCE(work_started_at, created_at))))::int)),
	                     seconds_left = GREATEST(0, duration_seconds - LEAST(duration_seconds, GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (NOW() - COALESCE(work_started_at, created_at))))::int))),
                     ended_at = NOW(),
                     updated_at = NOW()
                 WHERE session_id = $1`,
                [sessionId]
            );
        }

        await client.query("COMMIT");
        return {remainingMembers: activeMembers.rows[0].count};
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

export async function cleanupStaleMembers(sessionId, staleSeconds = 30) {
    const client = await pool.connect();

    try {
        await client.query("BEGIN");
        const session = await client.query(
            `SELECT feedback_status, work_started_at, submitted_at
             FROM table_group_sessions
             WHERE session_id = $1`,
            [sessionId]
        );

        if (session.rows[0]?.feedback_status === "generating" || (session.rows[0]?.work_started_at && !session.rows[0]?.submitted_at)) {
            await client.query("COMMIT");
            return;
        }

        const staleMembers = await client.query(
            `UPDATE table_group_members
             SET is_active = FALSE
             WHERE session_id = $1
               AND is_active = TRUE
               AND last_seen_at < NOW() - ($2::int * INTERVAL '1 second')
             RETURNING user_id`,
            [sessionId, staleSeconds]
        );

        if (staleMembers.rows.length > 0) {
            const userIds = staleMembers.rows.map((row) => row.user_id);
            await client.query(
                `UPDATE table_group_answers
                 SET is_active = FALSE,
                     updated_at = NOW()
                 WHERE session_id = $1
                   AND user_id = ANY($2::int[])
                   AND NOT EXISTS (
                       SELECT 1
                       FROM table_group_sessions
                       WHERE table_group_sessions.session_id = $1
                         AND table_group_sessions.submitted_at IS NOT NULL
                   )`,
                [sessionId, userIds]
            );
        }

        const activeMembers = await client.query(
            `SELECT COUNT(*)::int AS count
             FROM table_group_members
             WHERE session_id = $1
               AND is_active = TRUE`,
            [sessionId]
        );

        if (activeMembers.rows[0].count === 0) {
            await client.query(
                `UPDATE table_group_sessions
                 SET is_active = FALSE,
	                     seconds_spent = LEAST(duration_seconds, GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (NOW() - COALESCE(work_started_at, created_at))))::int)),
	                     seconds_left = GREATEST(0, duration_seconds - LEAST(duration_seconds, GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (NOW() - COALESCE(work_started_at, created_at))))::int))),
                     ended_at = COALESCE(ended_at, NOW()),
                     updated_at = NOW()
                 WHERE session_id = $1
                   AND is_active = TRUE`,
                [sessionId]
            );
        }

        await client.query("COMMIT");
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

export async function endGroupSessionWithoutSubmission(sessionId) {
    const result = await pool.query(
        `UPDATE table_group_sessions
         SET is_active = FALSE,
             seconds_spent = LEAST(duration_seconds, GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (NOW() - COALESCE(work_started_at, created_at))))::int)),
             seconds_left = GREATEST(0, duration_seconds - LEAST(duration_seconds, GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (NOW() - COALESCE(work_started_at, created_at))))::int))),
             ended_at = COALESCE(ended_at, NOW()),
             updated_at = NOW()
         WHERE session_id = $1
           AND is_active = TRUE
           AND submitted_at IS NULL
         RETURNING *`,
        [sessionId]
    );
    return result.rows[0] || null;
}

export async function cleanupStaleMembersForGroup(courseId, groupId, courseGroupId = null, staleSeconds = 30) {
    const result = await pool.query(
        `SELECT session_id
         FROM table_group_sessions
         WHERE course_id = $1
           AND group_id = $2
           AND course_group_id IS NOT DISTINCT FROM $3
           AND is_active = TRUE`,
        [courseId, groupId, courseGroupId || null]
    );

    await Promise.all(result.rows.map((row) => cleanupStaleMembers(row.session_id, staleSeconds)));
}
