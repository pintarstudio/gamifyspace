import {pool} from "../db/index.js";

let quizTablesReady = false;

const QUESTION_COUNT = 5;
const QUESTION_TIME_SECONDS = 15;
const QUESTION_REVEAL_SECONDS = 3;
const QUESTION_START_DELAY_SECONDS = 3;
const MAX_QUIZ_MEMBERS = 2;
const QUIZ_SAVE_STALE_SECONDS = 2 * 60;

export async function ensureQuizActivityTables() {
    if (quizTablesReady) return;

    await pool.query(`
        CREATE TABLE IF NOT EXISTS quiz_question_bank (
            question_id SERIAL PRIMARY KEY,
            topic_id INTEGER NOT NULL,
            question_number INTEGER NOT NULL,
            question_text TEXT NOT NULL,
            choices JSONB NOT NULL,
            correct_answer_index INTEGER NOT NULL CHECK (correct_answer_index BETWEEN 0 AND 3),
            explanation TEXT NOT NULL DEFAULT '',
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (topic_id, question_number)
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS quiz_sessions (
            quiz_session_id SERIAL PRIMARY KEY,
            course_id INTEGER NOT NULL,
            course_group_id INTEGER,
            topic_id INTEGER NOT NULL,
            group_id INTEGER,
            table_id TEXT NOT NULL,
            object_id TEXT,
            status TEXT NOT NULL DEFAULT 'lobby',
            question_ids INTEGER[] NOT NULL DEFAULT '{}',
            current_question_index INTEGER NOT NULL DEFAULT 0,
            question_started_at TIMESTAMPTZ,
            question_completed_at TIMESTAMPTZ,
            hosted_by INTEGER NOT NULL,
            saved_by INTEGER,
            saved_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            ended_at TIMESTAMPTZ
        )
    `);

    await pool.query(`ALTER TABLE quiz_sessions ADD COLUMN IF NOT EXISTS course_group_id INTEGER`);
    await pool.query(`ALTER TABLE quiz_sessions ADD COLUMN IF NOT EXISTS group_id INTEGER`);
    await pool.query(`ALTER TABLE quiz_sessions ADD COLUMN IF NOT EXISTS question_completed_at TIMESTAMPTZ`);
    await pool.query(`ALTER TABLE quiz_sessions ADD COLUMN IF NOT EXISTS save_status TEXT NOT NULL DEFAULT 'idle'`);
    await pool.query(`ALTER TABLE quiz_sessions ADD COLUMN IF NOT EXISTS save_started_at TIMESTAMPTZ`);
    await pool.query(`ALTER TABLE quiz_sessions ADD COLUMN IF NOT EXISTS save_error TEXT`);
    await pool.query(`
        UPDATE quiz_sessions
        SET save_status = CASE
                WHEN status = 'saved' THEN COALESCE(NULLIF(save_status, 'idle'), 'saved')
                ELSE save_status
            END
        WHERE status = 'saved'
    `);
    await pool.query(`
        UPDATE quiz_sessions qs
        SET course_group_id = u.course_group_id
        FROM users u
        WHERE qs.course_group_id IS NULL
          AND u.user_id = qs.hosted_by
    `);

    await pool.query(`DROP INDEX IF EXISTS quiz_sessions_one_open_table_idx`);
    await pool.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS quiz_sessions_one_open_table_course_group_idx
        ON quiz_sessions (course_id, (COALESCE(course_group_id, 0)), table_id)
        WHERE status IN ('lobby', 'in_progress', 'completed')
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS quiz_members (
            member_id SERIAL PRIMARY KEY,
            quiz_session_id INTEGER NOT NULL REFERENCES quiz_sessions(quiz_session_id) ON DELETE CASCADE,
            user_id INTEGER NOT NULL,
            avatar_public_path TEXT,
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (quiz_session_id, user_id)
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS quiz_answers (
            answer_id SERIAL PRIMARY KEY,
            quiz_session_id INTEGER NOT NULL REFERENCES quiz_sessions(quiz_session_id) ON DELETE CASCADE,
            user_id INTEGER NOT NULL,
            question_id INTEGER NOT NULL REFERENCES quiz_question_bank(question_id),
            answer_index INTEGER,
            is_correct BOOLEAN NOT NULL DEFAULT FALSE,
            time_taken_seconds INTEGER NOT NULL DEFAULT 15,
            time_left_seconds INTEGER NOT NULL DEFAULT 0,
            score INTEGER NOT NULL DEFAULT 0,
            bonus_score INTEGER NOT NULL DEFAULT 0,
            answered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (quiz_session_id, user_id, question_id)
        )
    `);

    await pool.query(`ALTER TABLE quiz_answers ALTER COLUMN time_taken_seconds SET DEFAULT 15`);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS quiz_session_results (
            result_id SERIAL PRIMARY KEY,
            quiz_session_id INTEGER NOT NULL REFERENCES quiz_sessions(quiz_session_id) ON DELETE CASCADE,
            saved_by INTEGER NOT NULL,
            questions_json JSONB NOT NULL,
            answers_json JSONB NOT NULL,
            results_json JSONB NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (quiz_session_id)
        )
    `);

    quizTablesReady = true;
}

export async function getQuizQuestionsForTopic(topicId) {
    const result = await pool.query(
        `SELECT question_id, topic_id, question_number, question_text, choices, correct_answer_index, explanation
         FROM quiz_question_bank
         WHERE topic_id = $1
           AND is_active = TRUE
         ORDER BY question_number ASC`,
        [topicId]
    );
    return result.rows;
}

export async function getQuizQuestionsByIds(questionIds) {
    if (!questionIds?.length) return [];

    const result = await pool.query(
        `SELECT
             q.question_id,
             q.topic_id,
             q.question_number,
             q.question_text,
             q.choices,
             q.correct_answer_index,
             q.explanation,
             ord.ordinality::int - 1 AS order_index
         FROM unnest($1::int[]) WITH ORDINALITY AS ord(question_id, ordinality)
         JOIN quiz_question_bank q ON q.question_id = ord.question_id
         ORDER BY ord.ordinality ASC`,
        [questionIds]
    );
    return result.rows;
}

export async function getActiveQuizSession(courseId, tableId, courseGroupId = null) {
    const result = await pool.query(
        `SELECT *
         FROM quiz_sessions
         WHERE course_id = $1
           AND table_id = $2
           AND course_group_id IS NOT DISTINCT FROM $3
           AND status IN ('lobby', 'in_progress', 'completed')
         ORDER BY created_at DESC
         LIMIT 1`,
        [courseId, String(tableId), courseGroupId || null]
    );
    return result.rows[0] || null;
}

export async function getQuizSessionById(sessionId) {
    const result = await pool.query(
        `SELECT *
         FROM quiz_sessions
         WHERE quiz_session_id = $1
         LIMIT 1`,
        [sessionId]
    );
    return result.rows[0] || null;
}

export async function getQuizMembers(sessionId) {
    const result = await pool.query(
        `SELECT
             m.member_id,
             m.quiz_session_id,
             m.user_id,
             u.name,
             u.email,
             m.avatar_public_path,
             m.joined_at,
             m.last_seen_at,
             m.is_active
         FROM quiz_members m
         JOIN users u ON u.user_id = m.user_id
         WHERE m.quiz_session_id = $1
           AND m.is_active = TRUE
         ORDER BY m.joined_at ASC`,
        [sessionId]
    );
    return result.rows;
}

export async function getQuizAnswers(sessionId) {
    const result = await pool.query(
        `SELECT
             a.answer_id,
             a.quiz_session_id,
             a.user_id,
             u.name,
             m.avatar_public_path,
             a.question_id,
             a.answer_index,
             a.is_correct,
             a.time_taken_seconds,
             a.time_left_seconds,
             a.score,
             a.bonus_score,
             a.answered_at
         FROM quiz_answers a
         JOIN users u ON u.user_id = a.user_id
         LEFT JOIN quiz_members m
           ON m.quiz_session_id = a.quiz_session_id
          AND m.user_id = a.user_id
         WHERE a.quiz_session_id = $1
         ORDER BY a.answered_at ASC`,
        [sessionId]
    );
    return result.rows;
}

export async function getQuizSavedResult(sessionId) {
    const result = await pool.query(
        `SELECT questions_json, answers_json, results_json, created_at
         FROM quiz_session_results
         WHERE quiz_session_id = $1
         LIMIT 1`,
        [sessionId]
    );
    return result.rows[0] || null;
}

export async function touchQuizMember(sessionId, user) {
    const result = await pool.query(
        `UPDATE quiz_members
         SET last_seen_at = NOW()
         WHERE quiz_session_id = $1
           AND user_id = $2
           AND is_active = TRUE
         RETURNING *`,
        [sessionId, user.user_id]
    );
    return result.rows[0] || null;
}

function pickQuestionIds(questions) {
    return [...questions]
        .sort(() => Math.random() - 0.5)
        .slice(0, QUESTION_COUNT)
        .map((question) => question.question_id);
}

export async function createQuizSession({course, topic, groupId, tableId, objectId, user, questions}) {
    const client = await pool.connect();
    const courseGroupId = user.course_group_id || null;

    try {
        await client.query("BEGIN");

        const existing = await client.query(
            `SELECT quiz_session_id
             FROM quiz_sessions
             WHERE course_id = $1
               AND table_id = $2
               AND course_group_id IS NOT DISTINCT FROM $3
               AND status IN ('lobby', 'in_progress', 'completed')
             LIMIT 1
             FOR UPDATE`,
            [course.course_id, String(tableId), courseGroupId]
        );

        if (existing.rows[0]) {
            const error = new Error("ACTIVE_QUIZ_EXISTS");
            error.code = "ACTIVE_QUIZ_EXISTS";
            throw error;
        }

        const questionIds = pickQuestionIds(questions);
        if (questionIds.length < QUESTION_COUNT) {
            const error = new Error("NOT_ENOUGH_QUESTIONS");
            error.code = "NOT_ENOUGH_QUESTIONS";
            throw error;
        }

        const created = await client.query(
            `INSERT INTO quiz_sessions
                 (course_id, course_group_id, topic_id, group_id, table_id, object_id, question_ids, hosted_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7::int[], $8)
             RETURNING *`,
            [
                course.course_id,
                courseGroupId,
                topic.topic_id,
                groupId || null,
                String(tableId),
                objectId || null,
                questionIds,
                user.user_id,
            ]
        );

        const sessionId = created.rows[0].quiz_session_id;
        await client.query(
            `INSERT INTO quiz_members (quiz_session_id, user_id, avatar_public_path)
             VALUES ($1, $2, $3)
             ON CONFLICT (quiz_session_id, user_id) DO NOTHING`,
            [sessionId, user.user_id, user.avatar_public_path || null]
        );

        await client.query("COMMIT");
        return getQuizSessionById(sessionId);
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

export async function addQuizMember(sessionId, user) {
    await pool.query(
        `INSERT INTO quiz_members (quiz_session_id, user_id, avatar_public_path)
         VALUES ($1, $2, $3)
         ON CONFLICT (quiz_session_id, user_id)
         DO UPDATE SET
             is_active = TRUE,
             avatar_public_path = EXCLUDED.avatar_public_path,
             last_seen_at = NOW()`,
        [sessionId, user.user_id, user.avatar_public_path || null]
    );
}

export async function joinQuizMemberWithLimit(sessionId, user, maxMembers = MAX_QUIZ_MEMBERS) {
    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        const locked = await client.query(
            `SELECT *
             FROM quiz_sessions
             WHERE quiz_session_id = $1
             FOR UPDATE`,
            [sessionId]
        );
        const session = locked.rows[0];
        if (!session) {
            await client.query("ROLLBACK");
            return {session: null, reason: "NOT_FOUND"};
        }
        if (!["lobby", "in_progress"].includes(session.status)) {
            await client.query("ROLLBACK");
            return {session, reason: "NOT_JOINABLE"};
        }

        const members = await client.query(
            `SELECT user_id
             FROM quiz_members
             WHERE quiz_session_id = $1
               AND is_active = TRUE`,
            [sessionId]
        );
        const alreadyMember = members.rows.some((member) => String(member.user_id) === String(user.user_id));
        if (!alreadyMember && members.rows.length >= maxMembers) {
            await client.query("ROLLBACK");
            return {session, reason: "FULL"};
        }

        await client.query(
            `INSERT INTO quiz_members (quiz_session_id, user_id, avatar_public_path)
             VALUES ($1, $2, $3)
             ON CONFLICT (quiz_session_id, user_id)
             DO UPDATE SET
                 is_active = TRUE,
                 avatar_public_path = EXCLUDED.avatar_public_path,
                 last_seen_at = NOW()`,
            [sessionId, user.user_id, user.avatar_public_path || null]
        );

        const updated = await client.query(
            `UPDATE quiz_sessions
             SET updated_at = NOW()
             WHERE quiz_session_id = $1
             RETURNING *`,
            [sessionId]
        );

        await client.query("COMMIT");
        return {
            session: updated.rows[0] || session,
            reason: alreadyMember ? "ALREADY_MEMBER" : "JOINED",
        };
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

export async function exitQuizMember(sessionId, userId) {
    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        const locked = await client.query(
            `SELECT *
             FROM quiz_sessions
             WHERE quiz_session_id = $1
             FOR UPDATE`,
            [sessionId]
        );
        const session = locked.rows[0];
        if (!session) {
            await client.query("ROLLBACK");
            return null;
        }

        if (session.status !== "lobby") {
            const error = new Error("QUIZ_ALREADY_STARTED");
            error.code = "QUIZ_ALREADY_STARTED";
            throw error;
        }

        await client.query(
            `UPDATE quiz_members
             SET is_active = FALSE,
                 last_seen_at = NOW()
             WHERE quiz_session_id = $1
               AND user_id = $2`,
            [sessionId, userId]
        );

        const shouldCancel = String(session.hosted_by) === String(userId);
        const activeMembers = await client.query(
            `SELECT COUNT(*)::int AS count
             FROM quiz_members
             WHERE quiz_session_id = $1
               AND is_active = TRUE`,
            [sessionId]
        );

        let updatedSession = session;
        if (shouldCancel) {
            await client.query(
                `UPDATE quiz_members
                 SET is_active = FALSE,
                     last_seen_at = NOW()
                 WHERE quiz_session_id = $1
                   AND is_active = TRUE`,
                [sessionId]
            );
        }

        if (shouldCancel || activeMembers.rows[0].count === 0) {
            const cancelled = await client.query(
                `UPDATE quiz_sessions
                 SET status = 'cancelled',
                     ended_at = NOW(),
                     updated_at = NOW()
                 WHERE quiz_session_id = $1
                 RETURNING *`,
                [sessionId]
            );
            updatedSession = cancelled.rows[0] || session;
        } else {
            const touched = await client.query(
                `UPDATE quiz_sessions
                 SET updated_at = NOW()
                 WHERE quiz_session_id = $1
                 RETURNING *`,
                [sessionId]
            );
            updatedSession = touched.rows[0] || session;
        }

        await client.query("COMMIT");
        return {
            session: updatedSession,
            remainingMembers: activeMembers.rows[0].count,
            cancelled: updatedSession.status === "cancelled",
        };
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

export async function startQuizSession(sessionId, userId) {
    const result = await pool.query(
        `UPDATE quiz_sessions
         SET status = 'in_progress',
             question_started_at = NOW() + ($3 * INTERVAL '1 second'),
             question_completed_at = NULL,
             updated_at = NOW()
         WHERE quiz_session_id = $1
           AND hosted_by = $2
           AND status = 'lobby'
           AND (
               SELECT COUNT(*)::int
               FROM quiz_members
               WHERE quiz_session_id = $1
                 AND is_active = TRUE
           ) = $4
         RETURNING *`,
        [sessionId, userId, QUESTION_START_DELAY_SECONDS, MAX_QUIZ_MEMBERS]
    );
    return result.rows[0] || null;
}

async function insertMissingTimedOutAnswers(client, session, questionId) {
    const elapsedSeconds = Math.floor((Date.now() - new Date(session.question_started_at).getTime()) / 1000);
    if (elapsedSeconds < QUESTION_TIME_SECONDS) return;

    await client.query(
        `INSERT INTO quiz_answers
             (quiz_session_id, user_id, question_id, answer_index, is_correct, time_taken_seconds, time_left_seconds, score, bonus_score)
         SELECT $1, m.user_id, $2, NULL, FALSE, $3, 0, 0, 0
         FROM quiz_members m
         WHERE m.quiz_session_id = $1
           AND m.is_active = TRUE
           AND NOT EXISTS (
               SELECT 1
               FROM quiz_answers a
               WHERE a.quiz_session_id = $1
                 AND a.user_id = m.user_id
                 AND a.question_id = $2
           )
         ON CONFLICT (quiz_session_id, user_id, question_id) DO NOTHING`,
        [session.quiz_session_id, questionId, QUESTION_TIME_SECONDS]
    );
}

async function advanceQuizIfReady(client, session) {
    if (session.status !== "in_progress") return session;

    const questionId = session.question_ids[session.current_question_index];
    if (!questionId) return session;

    await insertMissingTimedOutAnswers(client, session, questionId);

    const progress = await client.query(
        `SELECT
             (SELECT COUNT(*)::int FROM quiz_members WHERE quiz_session_id = $1 AND is_active = TRUE) AS member_count,
             (SELECT COUNT(*)::int FROM quiz_answers WHERE quiz_session_id = $1 AND question_id = $2) AS answer_count`,
        [session.quiz_session_id, questionId]
    );
    const {member_count: memberCount, answer_count: answerCount} = progress.rows[0];
    if (memberCount < MAX_QUIZ_MEMBERS || answerCount < memberCount) return session;

    if (!session.question_completed_at) {
        const completed = await client.query(
            `UPDATE quiz_sessions
             SET question_completed_at = NOW(),
                 updated_at = NOW()
             WHERE quiz_session_id = $1
             RETURNING *`,
            [session.quiz_session_id]
        );
        return completed.rows[0] || session;
    }

    const revealElapsedSeconds = Math.floor((Date.now() - new Date(session.question_completed_at).getTime()) / 1000);
    if (revealElapsedSeconds < QUESTION_REVEAL_SECONDS) return session;

    const isLastQuestion = session.current_question_index >= session.question_ids.length - 1;
    const updated = await client.query(
        isLastQuestion
            ? `UPDATE quiz_sessions
               SET status = 'completed',
                   ended_at = NOW(),
                   updated_at = NOW()
               WHERE quiz_session_id = $1
               RETURNING *`
            : `UPDATE quiz_sessions
               SET current_question_index = current_question_index + 1,
                   question_started_at = NOW(),
                   question_completed_at = NULL,
                   updated_at = NOW()
               WHERE quiz_session_id = $1
               RETURNING *`,
        [session.quiz_session_id]
    );
    return updated.rows[0] || session;
}

export async function refreshQuizProgress(sessionId) {
    const client = await pool.connect();

    try {
        await client.query("BEGIN");
        const locked = await client.query(
            `SELECT *
             FROM quiz_sessions
             WHERE quiz_session_id = $1
             FOR UPDATE`,
            [sessionId]
        );
        const session = locked.rows[0];
        if (!session) {
            await client.query("ROLLBACK");
            return null;
        }

        const updated = await advanceQuizIfReady(client, session);
        await client.query("COMMIT");
        return updated;
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

export async function submitQuizAnswer(session, user, answerIndex) {
    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        const locked = await client.query(
            `SELECT *
             FROM quiz_sessions
             WHERE quiz_session_id = $1
             FOR UPDATE`,
            [session.quiz_session_id]
        );
        const activeSession = locked.rows[0];
        if (!activeSession || activeSession.status !== "in_progress") {
            await client.query("ROLLBACK");
            return {session: activeSession, answer: null};
        }

        const questionId = activeSession.question_ids[activeSession.current_question_index];
        const question = await client.query(
            `SELECT question_id, correct_answer_index
             FROM quiz_question_bank
             WHERE question_id = $1`,
            [questionId]
        );
        if (!question.rows[0]) {
            await client.query("ROLLBACK");
            return {session: activeSession, answer: null};
        }

        const questionStartMs = new Date(activeSession.question_started_at).getTime();
        if (Date.now() < questionStartMs) {
            await client.query("ROLLBACK");
            return {session: activeSession, answer: null, reason: "QUESTION_NOT_STARTED"};
        }

        const elapsedSeconds = Math.max(
            0,
            Math.floor((Date.now() - questionStartMs) / 1000)
        );
        const timeTaken = Math.min(QUESTION_TIME_SECONDS, elapsedSeconds);
        const timeLeft = Math.max(0, QUESTION_TIME_SECONDS - timeTaken);
        const parsedAnswerIndex = Number.isInteger(answerIndex) ? answerIndex : Number.parseInt(answerIndex, 10);
        const isCorrect = parsedAnswerIndex === question.rows[0].correct_answer_index && timeTaken <= QUESTION_TIME_SECONDS;
        const score = isCorrect ? 10 : 0;
        const bonusScore = 0;

        const inserted = await client.query(
            `INSERT INTO quiz_answers
                 (quiz_session_id, user_id, question_id, answer_index, is_correct, time_taken_seconds, time_left_seconds, score, bonus_score)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             ON CONFLICT (quiz_session_id, user_id, question_id) DO NOTHING
             RETURNING *`,
            [
                activeSession.quiz_session_id,
                user.user_id,
                questionId,
                parsedAnswerIndex,
                isCorrect,
                timeTaken,
                timeLeft,
                score,
                bonusScore,
            ]
        );

        const existingOrInserted = inserted.rows[0] || (await client.query(
            `SELECT *
             FROM quiz_answers
             WHERE quiz_session_id = $1
               AND user_id = $2
               AND question_id = $3
             LIMIT 1`,
            [activeSession.quiz_session_id, user.user_id, questionId]
        )).rows[0];

        const updatedSession = await advanceQuizIfReady(client, activeSession);
        await client.query("COMMIT");
        return {session: updatedSession, answer: existingOrInserted || null};
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

export async function saveQuizResult(sessionId, userId, questions, answers, results) {
    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        const sessionResult = await client.query(
            `SELECT *
             FROM quiz_sessions
             WHERE quiz_session_id = $1
             FOR UPDATE`,
            [sessionId]
        );
        const session = sessionResult.rows[0];
        if (!session || !["completed", "saved"].includes(session.status)) {
            await client.query("ROLLBACK");
            return null;
        }

        await client.query(
            `INSERT INTO quiz_session_results
                 (quiz_session_id, saved_by, questions_json, answers_json, results_json)
             VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb)
             ON CONFLICT (quiz_session_id)
             DO UPDATE SET
                 saved_by = EXCLUDED.saved_by,
                 questions_json = EXCLUDED.questions_json,
                 answers_json = EXCLUDED.answers_json,
                 results_json = EXCLUDED.results_json`,
            [
                sessionId,
                userId,
                JSON.stringify(questions),
                JSON.stringify(answers),
                JSON.stringify(results),
            ]
        );

        const updated = await client.query(
            `UPDATE quiz_sessions
             SET status = 'saved',
                 saved_by = COALESCE(saved_by, $2),
                 saved_at = COALESCE(saved_at, NOW()),
                 save_status = $3,
                 save_started_at = NULL,
                 save_error = $4,
                 updated_at = NOW()
             WHERE quiz_session_id = $1
             RETURNING *`,
            [
                sessionId,
                userId,
                results?.wrong_answer_feedback_error ? "error" : "saved",
                results?.wrong_answer_feedback_error || null,
            ]
        );

        await client.query("COMMIT");
        return updated.rows[0] || session;
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

export async function beginQuizResultSave(sessionId) {
    const client = await pool.connect();

    try {
        await client.query("BEGIN");
        const locked = await client.query(
            `SELECT *
             FROM quiz_sessions
             WHERE quiz_session_id = $1
             FOR UPDATE`,
            [sessionId]
        );
        const session = locked.rows[0];
        if (!session) {
            await client.query("ROLLBACK");
            return {session: null, reason: "NOT_FOUND"};
        }
        if (session.status === "saved") {
            await client.query("COMMIT");
            return {session, reason: "ALREADY_SAVED"};
        }
        if (session.status !== "completed") {
            await client.query("ROLLBACK");
            return {session, reason: "NOT_COMPLETED"};
        }
        if (
            session.save_status === "saving"
            && session.save_started_at
            && new Date(session.save_started_at).getTime() > Date.now() - QUIZ_SAVE_STALE_SECONDS * 1000
        ) {
            await client.query("COMMIT");
            return {session, reason: "SAVING"};
        }

        const updated = await client.query(
            `UPDATE quiz_sessions
             SET save_status = 'saving',
                 save_started_at = NOW(),
                 save_error = NULL,
                 updated_at = NOW()
             WHERE quiz_session_id = $1
             RETURNING *`,
            [sessionId]
        );
        await client.query("COMMIT");
        return {session: updated.rows[0] || session, reason: "STARTED"};
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

export async function beginQuizFeedbackRetry(sessionId) {
    const client = await pool.connect();

    try {
        await client.query("BEGIN");
        const locked = await client.query(
            `SELECT *
             FROM quiz_sessions
             WHERE quiz_session_id = $1
             FOR UPDATE`,
            [sessionId]
        );
        const session = locked.rows[0];
        if (!session) {
            await client.query("ROLLBACK");
            return {session: null, reason: "NOT_FOUND"};
        }
        if (session.status !== "saved") {
            await client.query("ROLLBACK");
            return {session, reason: "NOT_SAVED"};
        }
        if (
            session.save_status === "saving"
            && session.save_started_at
            && new Date(session.save_started_at).getTime() > Date.now() - QUIZ_SAVE_STALE_SECONDS * 1000
        ) {
            await client.query("COMMIT");
            return {session, reason: "SAVING"};
        }

        const updated = await client.query(
            `UPDATE quiz_sessions
             SET save_status = 'saving',
                 save_started_at = NOW(),
                 save_error = NULL,
                 updated_at = NOW()
             WHERE quiz_session_id = $1
             RETURNING *`,
            [sessionId]
        );
        await client.query("COMMIT");
        return {session: updated.rows[0] || session, reason: "STARTED"};
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

export async function updateQuizResultFeedback(sessionId, resultsPatch) {
    const client = await pool.connect();

    try {
        await client.query("BEGIN");
        const result = await client.query(
            `UPDATE quiz_session_results
             SET results_json = results_json || $2::jsonb
             WHERE quiz_session_id = $1
             RETURNING questions_json, answers_json, results_json, created_at`,
            [sessionId, JSON.stringify(resultsPatch || {})]
        );
        await client.query(
            `UPDATE quiz_sessions
             SET save_status = $2,
                 save_started_at = NULL,
                 save_error = $3,
                 updated_at = NOW()
             WHERE quiz_session_id = $1`,
            [
                sessionId,
                resultsPatch?.wrong_answer_feedback_error ? "error" : "saved",
                resultsPatch?.wrong_answer_feedback_error || null,
            ]
        );
        await client.query("COMMIT");
        return result.rows[0] || null;
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

export {MAX_QUIZ_MEMBERS, QUESTION_COUNT, QUESTION_REVEAL_SECONDS, QUESTION_START_DELAY_SECONDS, QUESTION_TIME_SECONDS};
