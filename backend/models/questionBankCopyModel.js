import {randomInt} from "node:crypto";
import {pool} from "../db/index.js";
import {ensureQuestionBankAdminTables} from "./adminQuestionBankModel.js";

const BANKS = {
    quiz: {table: "quiz_question_bank", id: "question_id", number: "question_number", kind: "multiple_choice"},
    individual_mc: {table: "individual_questions", id: "question_id", number: "question_number", kind: "multiple_choice", activity: "exercise"},
    pre_test: {table: "individual_questions", id: "question_id", number: "question_number", kind: "multiple_choice", activity: "pre_test"},
    post_test: {table: "individual_questions", id: "question_id", number: "question_number", kind: "multiple_choice", activity: "post_test"},
    individual_case: {table: "individual_questions", id: "question_id", number: "question_number", kind: "case_study", activity: "exercise"},
    group_case: {table: "topic_cases", id: "case_id", number: "case_number", kind: "case_study"},
};

function invalid(message) {
    const error = new Error(message);
    error.status = 400;
    return error;
}

function positiveId(value) {
    return /^\d+$/.test(String(value)) && Number.isSafeInteger(Number(value)) && Number(value) > 0 && Number(value) <= 2147483647;
}

export function shuffledCopy(rows, pick = randomInt) {
    const shuffled = [...rows];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
        const other = pick(index + 1);
        [shuffled[index], shuffled[other]] = [shuffled[other], shuffled[index]];
    }
    // Even a valid random shuffle can reproduce the source order.
    if (shuffled.length > 1 && shuffled.every((row, index) => row === rows[index])) shuffled.push(shuffled.shift());
    return shuffled;
}

export async function copyQuestionBankItems({source_bank, target_bank, source_topic_id, target_topic_id, item_ids}) {
    const source = Object.hasOwn(BANKS, source_bank) ? BANKS[source_bank] : null;
    const target = Object.hasOwn(BANKS, target_bank) ? BANKS[target_bank] : null;
    if (!source || !target || source.kind !== target.kind || source_bank === target_bank) {
        throw invalid("Pilih bank asal dan tujuan berbeda dengan jenis soal yang sama.");
    }
    if (!positiveId(source_topic_id) || !positiveId(target_topic_id)) throw invalid("Topic asal dan tujuan wajib dipilih.");
    if (!Array.isArray(item_ids) || !item_ids.length || !item_ids.every(positiveId)) throw invalid("Pilih soal yang akan disalin.");
    const ids = [...new Set(item_ids.map(Number))];
    await ensureQuestionBankAdminTables();
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const topics = await client.query(
            `SELECT t.topic_id FROM topics t JOIN courses c ON c.course_id = t.course_id
             WHERE t.topic_id = ANY($1::int[]) AND t.deleted_at IS NULL AND c.deleted_at IS NULL
             FOR SHARE OF t, c`, [[Number(source_topic_id), Number(target_topic_id)]]
        );
        const validTopics = new Set(topics.rows.map((row) => Number(row.topic_id)));
        if (!validTopics.has(Number(source_topic_id)) || !validTopics.has(Number(target_topic_id))) throw invalid("Topic tidak ditemukan atau sudah dihapus.");
        // Serialize numbering with other writers, including the existing bank editors.
        await client.query(`LOCK TABLE ${target.table} IN SHARE ROW EXCLUSIVE MODE`);
        const sourceParams = [source_topic_id, ids];
        const sourceScope = source.activity ? "AND activity_type = $3 AND question_kind = $4" : "";
        if (source.activity) sourceParams.push(source.activity, source.kind);
        const selected = await client.query(
            `SELECT * FROM ${source.table} WHERE topic_id = $1 AND ${source.id} = ANY($2::int[])
               AND is_active = TRUE ${sourceScope} ORDER BY ${source.number}, ${source.id}`,
            sourceParams
        );
        if (selected.rows.length !== ids.length) throw invalid("Sebagian soal sudah berubah atau tidak tersedia. Muat ulang daftar soal.");
        const targetParams = [target_topic_id];
        const targetScope = target.activity ? "AND activity_type = $2 AND question_kind = $3" : "";
        if (target.activity) targetParams.push(target.activity, target.kind);
        const lastNumber = await client.query(
            `SELECT COALESCE(MAX(${target.number}), 0)::int AS last_number FROM ${target.table}
             WHERE topic_id = $1 ${targetScope}`, targetParams
        );
        const start = Number(lastNumber.rows[0].last_number) + 1;
        const saved = [];
        for (const [index, item] of shuffledCopy(selected.rows).entries()) {
            let result;
            if (target.table === "quiz_question_bank") {
                result = await client.query(
                    `INSERT INTO quiz_question_bank (topic_id, question_number, question_text, choices, correct_answer_index, explanation)
                     VALUES ($1, $2, $3, $4::jsonb, $5, $6) RETURNING question_id`,
                    [target_topic_id, start + index, item.question_text, JSON.stringify(item.choices), item.correct_answer_index, item.explanation || ""]
                );
            } else if (target.table === "topic_cases") {
                result = await client.query(
                    `INSERT INTO topic_cases (topic_id, case_number, case_title, case_prompt)
                     VALUES ($1, $2, $3, $4) RETURNING case_id`,
                    [target_topic_id, start + index, item.case_title, item.case_prompt]
                );
            } else {
                const isCase = target.kind === "case_study";
                result = await client.query(
                    `INSERT INTO individual_questions (topic_id, activity_type, question_kind, question_number,
                         question_text, choices, correct_answer_index, explanation, case_title, case_prompt)
                     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10) RETURNING question_id`,
                    [target_topic_id, target.activity, target.kind, start + index,
                        isCase ? null : item.question_text, JSON.stringify(isCase ? [] : item.choices),
                        isCase ? null : item.correct_answer_index, isCase ? null : item.explanation,
                        isCase ? item.case_title : null, isCase ? item.case_prompt : null]
                );
            }
            saved.push({...result.rows[0], source_id: item[source.id], number: start + index});
        }
        await client.query("COMMIT");
        return {saved, count: saved.length, start_number: start, end_number: start + saved.length - 1};
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}
