import {pool} from "../db/index.js";
import {ensureIndividualActivityTables} from "./individualActivityModel.js";
import {ensureQuizActivityTables} from "./quizActivityModel.js";
import {ensureTableActivityTables} from "./tableActivityModel.js";

let questionBankReadyPromise = null;

function estimateTokens(text) {
    return Math.ceil(String(text || "").length / 4);
}

function nullableText(value) {
    const text = String(value ?? "").trim();
    return text || null;
}

function intValue(value, fallback = 1) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}

async function createQuestionBankAdminTables() {
    await Promise.all([
        ensureIndividualActivityTables(),
        ensureQuizActivityTables(),
        ensureTableActivityTables(),
    ]);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS topic_materials (
            material_id SERIAL PRIMARY KEY,
            topic_id INTEGER NOT NULL REFERENCES topics(topic_id),
            title TEXT NOT NULL,
            content_text TEXT NOT NULL,
            content_token_estimate INTEGER NOT NULL DEFAULT 0,
            digest_json JSONB,
            digest_model TEXT,
            digest_status TEXT NOT NULL DEFAULT 'idle',
            digest_error TEXT,
            created_by INTEGER REFERENCES useradmin(useradmin_id),
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            deleted_at TIMESTAMPTZ
        )
    `);
}

export async function ensureQuestionBankAdminTables() {
    if (!questionBankReadyPromise) {
        questionBankReadyPromise = createQuestionBankAdminTables().catch((error) => {
            questionBankReadyPromise = null;
            throw error;
        });
    }
    return questionBankReadyPromise;
}

export async function listTopicMaterials(topicId = null) {
    await ensureQuestionBankAdminTables();
    const params = [];
    const where = ["tm.deleted_at IS NULL", "t.deleted_at IS NULL", "c.deleted_at IS NULL"];
    if (topicId) {
        params.push(topicId);
        where.push(`tm.topic_id = $${params.length}`);
    }

    const result = await pool.query(
        `SELECT
             tm.material_id,
             tm.topic_id,
             t.topic_name,
             c.course_id,
             c.course_name,
             tm.title,
             tm.content_text,
             tm.content_token_estimate,
             tm.digest_json,
             tm.digest_model,
             tm.digest_status,
             tm.digest_error,
             tm.updated_at
         FROM topic_materials tm
         JOIN topics t ON t.topic_id = tm.topic_id
         JOIN courses c ON c.course_id = t.course_id
         WHERE ${where.join(" AND ")}
         ORDER BY c.course_name ASC, t.topic_name ASC, tm.updated_at DESC`,
        params
    );
    return result.rows;
}

export async function getTopicMaterialById(materialId) {
    await ensureQuestionBankAdminTables();
    const result = await pool.query(
        `SELECT
             tm.*,
             t.topic_name,
             c.course_id,
             c.course_name
         FROM topic_materials tm
         JOIN topics t ON t.topic_id = tm.topic_id
         JOIN courses c ON c.course_id = t.course_id
         WHERE tm.material_id = $1
           AND tm.deleted_at IS NULL
           AND t.deleted_at IS NULL
           AND c.deleted_at IS NULL
         LIMIT 1`,
        [materialId]
    );
    return result.rows[0] || null;
}

export async function getTopicMaterialsByIds(materialIds) {
    await ensureQuestionBankAdminTables();
    const ids = (materialIds || []).map(Number).filter(Number.isFinite);
    if (ids.length === 0) return [];

    const result = await pool.query(
        `SELECT
             tm.*,
             t.topic_name,
             c.course_id,
             c.course_name
         FROM topic_materials tm
         JOIN topics t ON t.topic_id = tm.topic_id
         JOIN courses c ON c.course_id = t.course_id
         WHERE tm.material_id = ANY($1::int[])
           AND tm.deleted_at IS NULL
           AND t.deleted_at IS NULL
           AND c.deleted_at IS NULL
         ORDER BY array_position($1::int[], tm.material_id)`,
        [ids]
    );
    return result.rows;
}

export async function createTopicMaterial({topicId, title, contentText, createdBy}) {
    await ensureQuestionBankAdminTables();
    const result = await pool.query(
        `INSERT INTO topic_materials
             (topic_id, title, content_text, content_token_estimate, created_by)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING material_id`,
        [topicId, nullableText(title), nullableText(contentText), estimateTokens(contentText), createdBy]
    );
    return result.rows[0];
}

export async function updateTopicMaterial(materialId, {topicId, title, contentText}) {
    await ensureQuestionBankAdminTables();
    const result = await pool.query(
        `UPDATE topic_materials
         SET topic_id = $2,
             title = $3,
             content_text = $4,
             content_token_estimate = $5,
             digest_status = 'idle',
             digest_error = NULL,
             updated_at = NOW()
         WHERE material_id = $1
           AND deleted_at IS NULL
         RETURNING material_id`,
        [materialId, topicId, nullableText(title), nullableText(contentText), estimateTokens(contentText)]
    );
    return result.rows[0] || null;
}

export async function deleteTopicMaterial(materialId) {
    await ensureQuestionBankAdminTables();
    const result = await pool.query(
        `UPDATE topic_materials
         SET deleted_at = NOW(),
             updated_at = NOW()
         WHERE material_id = $1
           AND deleted_at IS NULL
         RETURNING material_id`,
        [materialId]
    );
    return result.rows[0] || null;
}

export async function saveMaterialDigest(materialId, digest, model) {
    const result = await pool.query(
        `UPDATE topic_materials
         SET digest_json = $2::jsonb,
             digest_model = $3,
             digest_status = 'ready',
             digest_error = NULL,
             updated_at = NOW()
         WHERE material_id = $1
           AND deleted_at IS NULL
         RETURNING material_id`,
        [materialId, JSON.stringify(digest), model]
    );
    return result.rows[0] || null;
}

export async function markMaterialDigestError(materialId, errorMessage) {
    await pool.query(
        `UPDATE topic_materials
         SET digest_status = 'error',
             digest_error = $2,
             updated_at = NOW()
         WHERE material_id = $1`,
        [materialId, errorMessage]
    );
}

export async function getNextQuestionNumber({bankType, topicId, activityType, questionKind}) {
    await ensureQuestionBankAdminTables();
    if (bankType === "quiz_question_bank") {
        const result = await pool.query(
            `SELECT COALESCE(MAX(question_number), 0) + 1 AS next_number
             FROM quiz_question_bank
             WHERE topic_id = $1`,
            [topicId]
        );
        return Number(result.rows[0]?.next_number || 1);
    }

    if (bankType === "individual_questions") {
        const result = await pool.query(
            `SELECT COALESCE(MAX(question_number), 0) + 1 AS next_number
             FROM individual_questions
             WHERE topic_id = $1
               AND activity_type = $2
               AND question_kind = $3`,
            [topicId, activityType, questionKind]
        );
        return Number(result.rows[0]?.next_number || 1);
    }

    if (bankType === "topic_cases") {
        const result = await pool.query(
            `SELECT COALESCE(MAX(case_number), 0) + 1 AS next_number
             FROM topic_cases
             WHERE topic_id = $1`,
            [topicId]
        );
        return Number(result.rows[0]?.next_number || 1);
    }

    return 1;
}

export async function saveGeneratedQuestions({bankType, topicId, activityType, questionKind, items}) {
    await ensureQuestionBankAdminTables();
    const saved = [];

    if (bankType === "quiz_question_bank") {
        for (const item of items || []) {
            const result = await pool.query(
                `INSERT INTO quiz_question_bank
                     (topic_id, question_number, question_text, choices, correct_answer_index, explanation)
                 VALUES ($1, $2, $3, $4::jsonb, $5, $6)
                 ON CONFLICT (topic_id, question_number)
                 DO UPDATE SET
                     question_text = EXCLUDED.question_text,
                     choices = EXCLUDED.choices,
                     correct_answer_index = EXCLUDED.correct_answer_index,
                     explanation = EXCLUDED.explanation,
                     is_active = TRUE,
                     updated_at = NOW()
                 RETURNING question_id`,
                [
                    topicId,
                    intValue(item.question_number),
                    nullableText(item.question_text),
                    JSON.stringify((item.choices || []).slice(0, 4)),
                    Math.max(0, Math.min(3, intValue(item.correct_answer_index, 0))),
                    nullableText(item.explanation) || "",
                ]
            );
            saved.push(result.rows[0]);
        }
    }

    if (bankType === "individual_questions") {
        for (const item of items || []) {
            const isCase = questionKind === "case_study";
            const result = await pool.query(
                `INSERT INTO individual_questions
                     (topic_id, activity_type, question_kind, question_number, question_text, choices, correct_answer_index, explanation, case_title, case_prompt)
                 VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10)
                 ON CONFLICT (topic_id, activity_type, question_kind, question_number)
                 DO UPDATE SET
                     question_text = EXCLUDED.question_text,
                     choices = EXCLUDED.choices,
                     correct_answer_index = EXCLUDED.correct_answer_index,
                     explanation = EXCLUDED.explanation,
                     case_title = EXCLUDED.case_title,
                     case_prompt = EXCLUDED.case_prompt,
                     is_active = TRUE,
                     updated_at = NOW()
                 RETURNING question_id`,
                [
                    topicId,
                    activityType,
                    questionKind,
                    intValue(item.question_number),
                    isCase ? null : nullableText(item.question_text),
                    JSON.stringify(isCase ? [] : (item.choices || []).slice(0, 4)),
                    isCase ? null : Math.max(0, Math.min(3, intValue(item.correct_answer_index, 0))),
                    isCase ? null : nullableText(item.explanation),
                    isCase ? nullableText(item.case_title) : null,
                    isCase ? nullableText(item.case_prompt) : null,
                ]
            );
            saved.push(result.rows[0]);
        }
    }

    if (bankType === "topic_cases") {
        for (const item of items || []) {
            const result = await pool.query(
                `INSERT INTO topic_cases
                     (topic_id, case_number, case_title, case_prompt)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT (topic_id, case_number)
                 DO UPDATE SET
                     case_title = EXCLUDED.case_title,
                     case_prompt = EXCLUDED.case_prompt,
                     is_active = TRUE,
                     updated_at = NOW()
                 RETURNING case_id`,
                [
                    topicId,
                    Math.max(1, intValue(item.case_number)),
                    nullableText(item.case_title),
                    nullableText(item.case_prompt),
                ]
            );
            saved.push(result.rows[0]);
        }
    }

    return saved;
}

export async function listQuestionBankItems(bankType, topicId = null) {
    await ensureQuestionBankAdminTables();
    const params = [];
    const topicFilter = topicId ? "AND q.topic_id = $1" : "";
    if (topicId) params.push(topicId);

    if (bankType === "quiz_question_bank") {
        const result = await pool.query(
            `SELECT
                 q.question_id,
                 q.topic_id,
                 t.topic_name,
                 c.course_id,
                 c.course_name,
                 q.question_number,
                 q.question_text,
                 q.choices,
                 q.correct_answer_index,
                 q.explanation,
                 'multiple_choice' AS question_type,
                 q.is_active,
                 q.updated_at
             FROM quiz_question_bank q
             JOIN topics t ON t.topic_id = q.topic_id
             JOIN courses c ON c.course_id = t.course_id
             WHERE q.is_active = TRUE
               AND t.deleted_at IS NULL
               AND c.deleted_at IS NULL
               ${topicFilter}
             ORDER BY c.course_name ASC, t.topic_name ASC, q.question_number ASC`,
            params
        );
        return result.rows;
    }

    if (bankType === "individual_questions") {
        const result = await pool.query(
            `SELECT
                 q.question_id,
                 q.topic_id,
                 t.topic_name,
                 c.course_id,
                 c.course_name,
                 q.activity_type,
                 q.question_kind,
                 q.question_kind AS question_type,
                 q.question_number,
                 q.question_text,
                 q.choices,
                 q.correct_answer_index,
                 q.explanation,
                 q.case_title,
                 q.case_prompt,
                 q.is_active,
                 q.updated_at
             FROM individual_questions q
             JOIN topics t ON t.topic_id = q.topic_id
             JOIN courses c ON c.course_id = t.course_id
             WHERE q.is_active = TRUE
               AND t.deleted_at IS NULL
               AND c.deleted_at IS NULL
               ${topicFilter}
             ORDER BY c.course_name ASC, t.topic_name ASC, q.activity_type ASC, q.question_kind ASC, q.question_number ASC`,
            params
        );
        return result.rows;
    }

    if (bankType === "topic_cases") {
        const result = await pool.query(
            `SELECT
                 q.case_id,
                 q.topic_id,
                 t.topic_name,
                 c.course_id,
                 c.course_name,
                 q.case_number,
                 q.case_title,
                 q.case_prompt,
                 'case_study' AS question_type,
                 q.is_active,
                 q.updated_at
             FROM topic_cases q
             JOIN topics t ON t.topic_id = q.topic_id
             JOIN courses c ON c.course_id = t.course_id
             WHERE q.is_active = TRUE
               AND t.deleted_at IS NULL
               AND c.deleted_at IS NULL
               ${topicFilter}
             ORDER BY c.course_name ASC, t.topic_name ASC, q.case_number ASC`,
            params
        );
        return result.rows;
    }

    return null;
}

export async function upsertQuestionBankItem(bankType, payload, id = null) {
    await ensureQuestionBankAdminTables();
    const topicId = payload.topic_id;

    if (bankType === "quiz_question_bank") {
        const choices = Array.isArray(payload.choices)
            ? payload.choices
            : String(payload.choices_text || "").split("\n").map((item) => item.trim()).filter(Boolean);
        const values = [
            topicId,
            intValue(payload.question_number),
            nullableText(payload.question_text),
            JSON.stringify(choices.slice(0, 4)),
            Math.max(0, Math.min(3, intValue(payload.correct_answer_index, 0))),
            nullableText(payload.explanation) || "",
        ];

        if (id) {
            const result = await pool.query(
                `UPDATE quiz_question_bank
                 SET topic_id = $2,
                     question_number = $3,
                     question_text = $4,
                     choices = $5::jsonb,
                     correct_answer_index = $6,
                     explanation = $7,
                     is_active = TRUE,
                     updated_at = NOW()
                 WHERE question_id = $1
                 RETURNING question_id`,
                [id, ...values]
            );
            return result.rows[0] || null;
        }

        const result = await pool.query(
            `INSERT INTO quiz_question_bank
                 (topic_id, question_number, question_text, choices, correct_answer_index, explanation)
             VALUES ($1, $2, $3, $4::jsonb, $5, $6)
             ON CONFLICT (topic_id, question_number)
             DO UPDATE SET
                 question_text = EXCLUDED.question_text,
                 choices = EXCLUDED.choices,
                 correct_answer_index = EXCLUDED.correct_answer_index,
                 explanation = EXCLUDED.explanation,
                 is_active = TRUE,
                 updated_at = NOW()
             RETURNING question_id`,
            values
        );
        return result.rows[0] || null;
    }

    if (bankType === "individual_questions") {
        const questionKind = payload.question_kind;
        const activityType = questionKind === "case_study" ? "exercise" : payload.activity_type;
        const isCase = questionKind === "case_study";
        const choices = Array.isArray(payload.choices)
            ? payload.choices
            : String(payload.choices_text || "").split("\n").map((item) => item.trim()).filter(Boolean);
        const values = [
            topicId,
            activityType,
            questionKind,
            intValue(payload.question_number),
            isCase ? null : nullableText(payload.question_text),
            JSON.stringify(isCase ? [] : choices.slice(0, 4)),
            isCase ? null : Math.max(0, Math.min(3, intValue(payload.correct_answer_index, 0))),
            isCase ? null : nullableText(payload.explanation),
            isCase ? nullableText(payload.case_title) : null,
            isCase ? nullableText(payload.case_prompt) : null,
        ];

        if (id) {
            const result = await pool.query(
                `UPDATE individual_questions
                 SET topic_id = $2,
                     activity_type = $3,
                     question_kind = $4,
                     question_number = $5,
                     question_text = $6,
                     choices = $7::jsonb,
                     correct_answer_index = $8,
                     explanation = $9,
                     case_title = $10,
                     case_prompt = $11,
                     is_active = TRUE,
                     updated_at = NOW()
                 WHERE question_id = $1
                 RETURNING question_id`,
                [id, ...values]
            );
            return result.rows[0] || null;
        }

        const result = await pool.query(
            `INSERT INTO individual_questions
                 (topic_id, activity_type, question_kind, question_number, question_text, choices, correct_answer_index, explanation, case_title, case_prompt)
             VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10)
             ON CONFLICT (topic_id, activity_type, question_kind, question_number)
             DO UPDATE SET
                 question_text = EXCLUDED.question_text,
                 choices = EXCLUDED.choices,
                 correct_answer_index = EXCLUDED.correct_answer_index,
                 explanation = EXCLUDED.explanation,
                 case_title = EXCLUDED.case_title,
                 case_prompt = EXCLUDED.case_prompt,
                 is_active = TRUE,
                 updated_at = NOW()
             RETURNING question_id`,
            values
        );
        return result.rows[0] || null;
    }

    if (bankType === "topic_cases") {
        const values = [
            topicId,
            Math.max(1, intValue(payload.case_number)),
            nullableText(payload.case_title),
            nullableText(payload.case_prompt),
        ];

        if (id) {
            const result = await pool.query(
                `UPDATE topic_cases
                 SET topic_id = $2,
                     case_number = $3,
                     case_title = $4,
                     case_prompt = $5,
                     is_active = TRUE,
                     updated_at = NOW()
                 WHERE case_id = $1
                 RETURNING case_id`,
                [id, ...values]
            );
            return result.rows[0] || null;
        }

        const result = await pool.query(
            `INSERT INTO topic_cases
                 (topic_id, case_number, case_title, case_prompt)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (topic_id, case_number)
             DO UPDATE SET
                 case_title = EXCLUDED.case_title,
                 case_prompt = EXCLUDED.case_prompt,
                 is_active = TRUE,
                 updated_at = NOW()
             RETURNING case_id`,
            values
        );
        return result.rows[0] || null;
    }

    return null;
}

export async function bulkDeactivateQuestionBankItems(bankType, ids = []) {
    await ensureQuestionBankAdminTables();
    const itemIds = (ids || []).map((id) => Number.parseInt(id, 10)).filter(Number.isFinite);
    if (itemIds.length === 0) return {updated_count: 0};

    if (bankType === "quiz_question_bank") {
        const result = await pool.query(
            `UPDATE quiz_question_bank
             SET is_active = FALSE,
                 updated_at = NOW()
             WHERE question_id = ANY($1::int[])
               AND is_active = TRUE
             RETURNING question_id`,
            [itemIds]
        );
        return {updated_count: result.rowCount, ids: result.rows.map((row) => row.question_id)};
    }

    if (bankType === "individual_questions") {
        const result = await pool.query(
            `UPDATE individual_questions
             SET is_active = FALSE,
                 updated_at = NOW()
             WHERE question_id = ANY($1::int[])
               AND is_active = TRUE
             RETURNING question_id`,
            [itemIds]
        );
        return {updated_count: result.rowCount, ids: result.rows.map((row) => row.question_id)};
    }

    if (bankType === "topic_cases") {
        const result = await pool.query(
            `UPDATE topic_cases
             SET is_active = FALSE,
                 updated_at = NOW()
             WHERE case_id = ANY($1::int[])
               AND is_active = TRUE
             RETURNING case_id`,
            [itemIds]
        );
        return {updated_count: result.rowCount, ids: result.rows.map((row) => row.case_id)};
    }

    return null;
}
