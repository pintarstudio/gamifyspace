import {pool} from "../db/index.js";
import {ensureGamificationTables} from "./gamificationModel.js";

let tablesReady = false;

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

async function ensureTopicVisibilityColumn() {
    const columns = await getColumns("topics");
    if (columns.length === 0) return [];

    if (!hasColumn(columns, "show_topic")) {
        await pool.query(`ALTER TABLE topics ADD COLUMN IF NOT EXISTS show_topic BOOLEAN NOT NULL DEFAULT TRUE`);
        return [...columns, "show_topic"];
    }

    return columns;
}

export async function ensureTableActivityTables() {
    if (tablesReady) return;

    await ensureGamificationTables();
    await ensureTopicVisibilityColumn();

    await pool.query(`
        CREATE TABLE IF NOT EXISTS topic_cases (
            case_id SERIAL PRIMARY KEY,
            topic_id INTEGER NOT NULL,
            case_number INTEGER NOT NULL CHECK (case_number BETWEEN 1 AND 2),
            case_title TEXT NOT NULL,
            case_prompt TEXT NOT NULL,
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (topic_id, case_number)
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS table_group_sessions (
            session_id SERIAL PRIMARY KEY,
            course_id INTEGER NOT NULL,
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
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            ended_at TIMESTAMPTZ
        )
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

    await pool.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS table_group_sessions_one_active_idx
        ON table_group_sessions (course_id, group_id)
        WHERE is_active = TRUE
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS table_group_members (
            member_id SERIAL PRIMARY KEY,
            session_id INTEGER NOT NULL REFERENCES table_group_sessions(session_id) ON DELETE CASCADE,
            user_id INTEGER NOT NULL,
            avatar_public_path TEXT,
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (session_id, user_id)
        )
    `);

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
    const columns = await ensureTopicVisibilityColumn();
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
    const columns = await ensureTopicVisibilityColumn();
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

export async function getCasesForTopic(topicId) {
    const result = await pool.query(
        `SELECT case_id, topic_id, case_number, case_title, case_prompt
         FROM topic_cases
         WHERE topic_id = $1
           AND is_active = TRUE
         ORDER BY case_number ASC
         LIMIT 2`,
        [topicId]
    );
    return result.rows;
}

export async function getSubmittedCaseIdsForStudent(userId, topicId) {
    const result = await pool.query(
        `SELECT DISTINCT case_id
         FROM table_group_sessions
         WHERE created_by = $1
           AND topic_id = $2
           AND case_id IS NOT NULL
           AND submitted_at IS NOT NULL`,
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

export async function getActiveGroupSession(courseId, groupId) {
    await cleanupStaleMembersForGroup(courseId, groupId);

    const result = await pool.query(
        `${SESSION_SELECT}
         WHERE s.course_id = $1
           AND s.group_id = $2
           AND s.is_active = TRUE
         ORDER BY s.created_at DESC
         LIMIT 1`,
        [courseId, groupId]
    );
    return result.rows[0] || null;
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

export async function addMemberToSession(sessionId, user) {
    await pool.query(
        `INSERT INTO table_group_members (session_id, user_id, avatar_public_path)
         VALUES ($1, $2, $3)
         ON CONFLICT (session_id, user_id)
         DO UPDATE SET
             is_active = TRUE,
             avatar_public_path = EXCLUDED.avatar_public_path,
             last_seen_at = NOW()`,
        [sessionId, user.user_id, user.avatar_public_path || null]
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

export async function createGroupSession({course, topic, caseStudy, groupId, objectId, user}) {
    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        const existing = await client.query(
            `SELECT session_id
             FROM table_group_sessions
             WHERE course_id = $1
               AND group_id = $2
               AND is_active = TRUE
             LIMIT 1
             FOR UPDATE`,
            [course.course_id, groupId]
        );

        if (existing.rows[0]) {
            const error = new Error("ACTIVE_SESSION_EXISTS");
            error.code = "ACTIVE_SESSION_EXISTS";
            throw error;
        }

        const created = await client.query(
            `INSERT INTO table_group_sessions
                 (course_id, topic_id, case_id, group_id, object_id, created_by)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING *`,
            [
                course.course_id,
                topic?.topic_id || null,
                caseStudy.case_id,
                groupId,
                objectId || null,
                user.user_id,
            ]
        );

        const sessionId = created.rows[0].session_id;
        await client.query(
            `INSERT INTO table_group_members (session_id, user_id, avatar_public_path)
             VALUES ($1, $2, $3)
             ON CONFLICT (session_id, user_id) DO NOTHING`,
            [sessionId, user.user_id, user.avatar_public_path || null]
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
           AND created_by = $2
           AND submitted_at IS NULL
           AND is_active = TRUE
           AND COALESCE(feedback_status, 'idle') <> 'generating'
         RETURNING *`,
        [sessionId, userId]
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
                 updated_at = NOW()
             WHERE session_id = $1
               AND created_by = $2
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

export async function exitSessionMember(sessionId, userId) {
    const client = await pool.connect();

    try {
        await client.query("BEGIN");
        const session = await client.query(
            `SELECT feedback_status
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
            `SELECT feedback_status
             FROM table_group_sessions
             WHERE session_id = $1`,
            [sessionId]
        );

        if (session.rows[0]?.feedback_status === "generating") {
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

export async function cleanupStaleMembersForGroup(courseId, groupId, staleSeconds = 30) {
    const result = await pool.query(
        `SELECT session_id
         FROM table_group_sessions
         WHERE course_id = $1
           AND group_id = $2
           AND is_active = TRUE`,
        [courseId, groupId]
    );

    await Promise.all(result.rows.map((row) => cleanupStaleMembers(row.session_id, staleSeconds)));
}
