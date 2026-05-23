import {pool} from "../db/index.js";
import {ensureGamificationTables} from "./gamificationModel.js";

export const INDIVIDUAL_ACTIVITY_TYPE = "individual_exercise";
export const ACTIVITY_TYPES = ["exercise", "pre_test", "post_test"];
export const QUESTION_KINDS = ["multiple_choice", "case_study"];
export const MC_QUESTION_COUNT = 10;
export const ASSESSMENT_QUESTION_COUNT = 20;
export const INDIVIDUAL_MC_DURATION_SECONDS = 180;
export const INDIVIDUAL_CASE_DURATION_SECONDS = 240;
export const INDIVIDUAL_ASSESSMENT_DURATION_SECONDS = 900;

export function getIndividualQuestionCount(activityType, questionKind) {
    if (questionKind === "case_study") return 1;
    return ["pre_test", "post_test"].includes(activityType) ? ASSESSMENT_QUESTION_COUNT : MC_QUESTION_COUNT;
}

export function getIndividualActivityDuration(activityType, questionKind) {
    if (activityType === "pre_test" || activityType === "post_test") return INDIVIDUAL_ASSESSMENT_DURATION_SECONDS;
    if (questionKind === "case_study") return INDIVIDUAL_CASE_DURATION_SECONDS;
    return INDIVIDUAL_MC_DURATION_SECONDS;
}

let individualReadyPromise = null;

function clampInt(value, min, max, fallback = min) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, parsed));
}

async function createIndividualTables() {
    await ensureGamificationTables();

    await pool.query(`
        CREATE TABLE IF NOT EXISTS individual_questions (
            question_id SERIAL PRIMARY KEY,
            topic_id INTEGER NOT NULL,
            activity_type TEXT NOT NULL CHECK (activity_type IN ('exercise', 'pre_test', 'post_test')),
            question_kind TEXT NOT NULL CHECK (question_kind IN ('multiple_choice', 'case_study')),
            question_number INTEGER NOT NULL,
            question_text TEXT,
            choices JSONB NOT NULL DEFAULT '[]'::jsonb,
            correct_answer_index INTEGER,
            explanation TEXT,
            case_title TEXT,
            case_prompt TEXT,
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (topic_id, activity_type, question_kind, question_number)
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS individual_activity_sessions (
            session_id SERIAL PRIMARY KEY,
            course_id INTEGER NOT NULL,
            topic_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            object_id TEXT,
            activity_type TEXT NOT NULL CHECK (activity_type IN ('exercise', 'pre_test', 'post_test')),
            question_kind TEXT NOT NULL CHECK (question_kind IN ('multiple_choice', 'case_study')),
            status TEXT NOT NULL DEFAULT 'in_progress',
            question_ids INTEGER[] NOT NULL DEFAULT '{}',
            current_question_index INTEGER NOT NULL DEFAULT 0,
            answer_text TEXT NOT NULL DEFAULT '',
            correct_count INTEGER NOT NULL DEFAULT 0,
            score_total INTEGER NOT NULL DEFAULT 0,
            xp_total INTEGER NOT NULL DEFAULT 0,
            result_json JSONB,
            feedback_json JSONB,
            feedback_model TEXT,
            feedback_status TEXT NOT NULL DEFAULT 'idle',
            feedback_error TEXT,
            duration_seconds INTEGER NOT NULL DEFAULT 0,
            seconds_spent INTEGER NOT NULL DEFAULT 0,
            seconds_left INTEGER NOT NULL DEFAULT 0,
            started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            completed_at TIMESTAMPTZ,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);

    await pool.query(`ALTER TABLE individual_activity_sessions ADD COLUMN IF NOT EXISTS duration_seconds INTEGER NOT NULL DEFAULT 0`);
    await pool.query(`ALTER TABLE individual_activity_sessions ADD COLUMN IF NOT EXISTS seconds_spent INTEGER NOT NULL DEFAULT 0`);
    await pool.query(`ALTER TABLE individual_activity_sessions ADD COLUMN IF NOT EXISTS seconds_left INTEGER NOT NULL DEFAULT 0`);
    await pool.query(`
        UPDATE individual_activity_sessions
        SET duration_seconds = CASE
                WHEN activity_type IN ('pre_test', 'post_test') THEN ${INDIVIDUAL_ASSESSMENT_DURATION_SECONDS}
                WHEN question_kind = 'case_study' THEN ${INDIVIDUAL_CASE_DURATION_SECONDS}
                ELSE ${INDIVIDUAL_MC_DURATION_SECONDS}
            END,
            seconds_left = CASE
                WHEN seconds_left > 0 THEN seconds_left
                WHEN activity_type IN ('pre_test', 'post_test') THEN ${INDIVIDUAL_ASSESSMENT_DURATION_SECONDS}
                WHEN question_kind = 'case_study' THEN ${INDIVIDUAL_CASE_DURATION_SECONDS}
                ELSE ${INDIVIDUAL_MC_DURATION_SECONDS}
            END
        WHERE duration_seconds = 0
    `);

    await pool.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS individual_activity_one_active_idx
        ON individual_activity_sessions (course_id, user_id, object_id)
        WHERE status = 'in_progress'
    `);

    await pool.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS individual_activity_one_active_computer_idx
        ON individual_activity_sessions (course_id, object_id)
        WHERE status = 'in_progress'
          AND COALESCE(object_id, '') <> ''
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS individual_activity_answers (
            answer_id SERIAL PRIMARY KEY,
            session_id INTEGER NOT NULL REFERENCES individual_activity_sessions(session_id) ON DELETE CASCADE,
            question_id INTEGER NOT NULL REFERENCES individual_questions(question_id),
            user_id INTEGER NOT NULL,
            answer_index INTEGER,
            answer_text TEXT,
            is_correct BOOLEAN,
            score INTEGER NOT NULL DEFAULT 0,
            xp_earned INTEGER NOT NULL DEFAULT 0,
            answered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (session_id, question_id, user_id)
        )
    `);
}

export async function ensureIndividualActivityTables() {
    if (!individualReadyPromise) {
        individualReadyPromise = createIndividualTables().catch((error) => {
            individualReadyPromise = null;
            throw error;
        });
    }
    return individualReadyPromise;
}

export async function getCompletedIndividualAssessmentsForTopics({courseId, userId, topics}) {
    const topicIds = (topics || []).map((topic) => Number(topic.topic_id)).filter(Number.isFinite);
    if (topicIds.length === 0) return new Map();

    const result = await pool.query(
        `SELECT topic_id, activity_type, COUNT(*)::int AS completed_count
         FROM individual_activity_sessions
         WHERE course_id = $1
           AND user_id = $2
           AND topic_id = ANY($3::int[])
           AND activity_type IN ('pre_test', 'post_test')
           AND status = 'completed'
         GROUP BY topic_id, activity_type`,
        [courseId, userId, topicIds]
    );

    const completionMap = new Map();
    for (const row of result.rows) {
        const topicId = Number(row.topic_id);
        const current = completionMap.get(topicId) || {
            pre_test_completed: false,
            post_test_completed: false,
        };
        if (row.activity_type === "pre_test") current.pre_test_completed = Number(row.completed_count) > 0;
        if (row.activity_type === "post_test") current.post_test_completed = Number(row.completed_count) > 0;
        completionMap.set(topicId, current);
    }
    return completionMap;
}

export async function hasCompletedIndividualAssessment({courseId, userId, topicId, activityType}) {
    if (!["pre_test", "post_test"].includes(activityType)) return false;

    const result = await pool.query(
        `SELECT 1
         FROM individual_activity_sessions
         WHERE course_id = $1
           AND user_id = $2
           AND topic_id = $3
           AND activity_type = $4
           AND status = 'completed'
         LIMIT 1`,
        [courseId, userId, topicId, activityType]
    );
    return !!result.rows[0];
}

export async function updateIndividualTopicSettings(topicId, settings) {
    const result = await pool.query(
        `UPDATE topics
         SET show_pre_test = COALESCE($2, show_pre_test),
             show_post_test = COALESCE($3, show_post_test),
             updated_at = NOW()
         WHERE topic_id = $1
         RETURNING topic_id, show_pre_test, show_post_test`,
        [
            topicId,
            settings.show_pre_test === undefined ? null : !!settings.show_pre_test,
            settings.show_post_test === undefined ? null : !!settings.show_post_test,
        ]
    );
    return result.rows[0] || null;
}

export async function getIndividualQuestions({courseId, topicId, userId, activityType, questionKind}) {
    const limit = getIndividualQuestionCount(activityType, questionKind);

    if (activityType === "exercise" && courseId && userId) {
        const result = await pool.query(
            `WITH used_questions AS (
                 SELECT DISTINCT used_question_id::int AS question_id
                 FROM individual_activity_sessions ias
                 CROSS JOIN LATERAL unnest(ias.question_ids) AS used_question_id
                 WHERE ias.course_id = $1
                   AND ias.user_id = $2
                   AND ias.topic_id = $3
                   AND ias.activity_type = $4
                   AND ias.question_kind = $5
             )
             SELECT iq.*
             FROM individual_questions iq
             LEFT JOIN used_questions uq ON uq.question_id = iq.question_id
             WHERE iq.topic_id = $3
               AND iq.activity_type = $4
               AND iq.question_kind = $5
               AND iq.is_active = TRUE
             ORDER BY CASE WHEN uq.question_id IS NULL THEN 0 ELSE 1 END, RANDOM()
             LIMIT $6`,
            [courseId, userId, topicId, activityType, questionKind, limit]
        );
        return result.rows;
    }

    const result = await pool.query(
        `SELECT *
         FROM individual_questions
         WHERE topic_id = $1
           AND activity_type = $2
           AND question_kind = $3
           AND is_active = TRUE
         ORDER BY RANDOM()
         LIMIT $4`,
        [topicId, activityType, questionKind, limit]
    );
    return result.rows;
}

export async function getIndividualQuestionsByIds(questionIds) {
    const ids = (questionIds || []).map(Number).filter(Number.isFinite);
    if (ids.length === 0) return [];

    const result = await pool.query(
        `SELECT *
         FROM individual_questions
         WHERE question_id = ANY($1::int[])`,
        [ids]
    );
    const order = new Map(ids.map((id, index) => [id, index]));
    return result.rows.sort((a, b) => order.get(Number(a.question_id)) - order.get(Number(b.question_id)));
}

export async function getActiveIndividualSession({courseId, userId, objectId}) {
    const result = await pool.query(
        `SELECT *
         FROM individual_activity_sessions
         WHERE course_id = $1
           AND user_id = $2
           AND COALESCE(object_id, '') = COALESCE($3, '')
           AND status = 'in_progress'
         ORDER BY started_at DESC
         LIMIT 1`,
        [courseId, userId, objectId || ""]
    );
    return result.rows[0] || null;
}

export async function getActiveIndividualSessionForObject({courseId, objectId}) {
    const normalizedObjectId = objectId || "";
    if (!normalizedObjectId) return null;

    const result = await pool.query(
        `SELECT ias.*, u.name AS user_name
         FROM individual_activity_sessions ias
         LEFT JOIN users u ON u.user_id = ias.user_id
         WHERE ias.course_id = $1
           AND COALESCE(ias.object_id, '') = $2
           AND ias.status = 'in_progress'
         ORDER BY ias.started_at DESC
         LIMIT 1`,
        [courseId, normalizedObjectId]
    );
    return result.rows[0] || null;
}

export async function getIndividualSessionById(sessionId) {
    const result = await pool.query(
        `SELECT *
         FROM individual_activity_sessions
         WHERE session_id = $1
         LIMIT 1`,
        [sessionId]
    );
    return result.rows[0] || null;
}

export async function getIndividualAnswers(sessionId) {
    const result = await pool.query(
        `SELECT
             a.*,
             q.question_text,
             q.choices,
             q.correct_answer_index,
             q.explanation,
             q.case_title,
             q.case_prompt
         FROM individual_activity_answers a
         JOIN individual_questions q ON q.question_id = a.question_id
         WHERE a.session_id = $1
         ORDER BY a.answered_at ASC`,
        [sessionId]
    );
    return result.rows;
}

export async function createIndividualSession({courseId, topicId, userId, objectId, activityType, questionKind, questions}) {
    const durationSeconds = getIndividualActivityDuration(activityType, questionKind);
    const result = await pool.query(
        `INSERT INTO individual_activity_sessions
             (course_id, topic_id, user_id, object_id, activity_type, question_kind, question_ids, duration_seconds, seconds_left)
         VALUES ($1, $2, $3, $4, $5, $6, $7::int[], $8, $8)
         RETURNING *`,
        [
            courseId,
            topicId,
            userId,
            objectId || "",
            activityType,
            questionKind,
            questions.map((question) => question.question_id),
            durationSeconds,
        ]
    );
    return result.rows[0] || null;
}

export async function saveIndividualMcAnswer({session, question, userId, answerIndex, awardXp = true}) {
    const normalizedAnswerIndex = Number.isFinite(Number(answerIndex)) ? Number(answerIndex) : null;
    const isCorrect = normalizedAnswerIndex !== null && Number(question.correct_answer_index) === normalizedAnswerIndex;
    const isAssessment = ["pre_test", "post_test"].includes(session.activity_type);
    const score = isAssessment && isCorrect ? Math.round(100 / getIndividualQuestionCount(session.activity_type, session.question_kind)) : 0;
    const xp = awardXp && session.activity_type === "exercise" && isCorrect ? 10 : 0;

    const result = await pool.query(
        `INSERT INTO individual_activity_answers
             (session_id, question_id, user_id, answer_index, is_correct, score, xp_earned)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (session_id, question_id, user_id)
         DO UPDATE SET
             answer_index = EXCLUDED.answer_index,
             is_correct = EXCLUDED.is_correct,
             score = EXCLUDED.score,
             xp_earned = EXCLUDED.xp_earned,
             answered_at = NOW()
         RETURNING *`,
        [session.session_id, question.question_id, userId, normalizedAnswerIndex, isCorrect, score, xp]
    );

    return result.rows[0] || null;
}

export async function advanceIndividualSession(sessionId) {
    const result = await pool.query(
        `UPDATE individual_activity_sessions
         SET current_question_index = current_question_index + 1,
             updated_at = NOW()
         WHERE session_id = $1
           AND status = 'in_progress'
         RETURNING *`,
        [sessionId]
    );
    return result.rows[0] || null;
}

export async function completeIndividualSession({sessionId, resultJson, feedbackJson = null, feedbackModel = null, feedbackError = null, xpTotal = 0}) {
    const result = await pool.query(
        `UPDATE individual_activity_sessions
         SET status = 'completed',
             correct_count = $2,
             score_total = $3,
             xp_total = $4,
             result_json = $5::jsonb,
             feedback_json = $6::jsonb,
             feedback_model = $7,
             feedback_status = $8,
             feedback_error = $9,
             seconds_spent = LEAST(duration_seconds, GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (NOW() - started_at)))::int)),
             seconds_left = GREATEST(0, duration_seconds - LEAST(duration_seconds, GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (NOW() - started_at)))::int))),
             completed_at = NOW(),
             updated_at = NOW()
         WHERE session_id = $1
         RETURNING *`,
        [
            sessionId,
            resultJson.correct_count || 0,
            resultJson.score_total || 0,
            xpTotal,
            JSON.stringify(resultJson || {}),
            feedbackJson ? JSON.stringify(feedbackJson) : null,
            feedbackModel,
            feedbackError ? "error" : "ready",
            feedbackError,
        ]
    );
    return result.rows[0] || null;
}

export async function saveIndividualCaseAnswer({sessionId, userId, questionId, answerText}) {
    const result = await pool.query(
        `INSERT INTO individual_activity_answers
             (session_id, question_id, user_id, answer_text, is_correct, score, xp_earned)
         VALUES ($1, $2, $3, $4, NULL, 0, 0)
         ON CONFLICT (session_id, question_id, user_id)
         DO UPDATE SET
             answer_text = EXCLUDED.answer_text,
             answered_at = NOW()
         RETURNING *`,
        [sessionId, questionId, userId, answerText || ""]
    );
    return result.rows[0] || null;
}

export async function upsertIndividualXpScore(session, xp, reason) {
    await pool.query(
        `INSERT INTO gamification_user_scores
             (activity_type, activity_id, user_id, group_id, course_id, xp_earned, reason)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (activity_type, activity_id, user_id)
         DO UPDATE SET
             xp_earned = EXCLUDED.xp_earned,
             reason = EXCLUDED.reason,
             updated_at = NOW()`,
        [
            INDIVIDUAL_ACTIVITY_TYPE,
            session.session_id,
            session.user_id,
            0,
            session.course_id,
            clampInt(xp, 0, 100, 0),
            reason || "Individual XP earned from exercise activity.",
        ]
    );
}

export async function cancelIndividualSession(sessionId, userId) {
    const result = await pool.query(
        `UPDATE individual_activity_sessions
         SET status = 'cancelled',
             seconds_spent = LEAST(duration_seconds, GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (NOW() - started_at)))::int)),
             seconds_left = GREATEST(0, duration_seconds - LEAST(duration_seconds, GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (NOW() - started_at)))::int))),
             updated_at = NOW()
         WHERE session_id = $1
           AND user_id = $2
           AND status = 'in_progress'
         RETURNING *`,
        [sessionId, userId]
    );
    return result.rows[0] || null;
}
