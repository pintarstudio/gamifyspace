import {test, before, after} from "node:test";
import assert from "node:assert/strict";
import {pool} from "../db/index.js";
import {copyQuestionBankItems, shuffledCopy} from "./questionBankCopyModel.js";

const originalQuery = pool.query;
const originalConnect = pool.connect;
before(() => { pool.query = async () => ({rows: []}); });
after(() => { pool.query = originalQuery; pool.connect = originalConnect; });

function fakeDatabase(items, {missingTopic = false, failInsert = false} = {}) {
    const calls = [];
    let released = false;
    pool.connect = async () => ({
        query: async (sql, params) => {
            calls.push({sql, params});
            if (sql.includes("SELECT t.topic_id")) return {rows: missingTopic ? [] : [{topic_id: 1}, {topic_id: 2}]};
            if (sql.includes("SELECT * FROM")) return {rows: items};
            if (sql.includes("MAX(")) return {rows: [{last_number: 7}]};
            if (sql.includes("INSERT INTO")) {
                if (failInsert) throw new Error("insert failed");
                return {rows: [{question_id: 100 + calls.length, case_id: 100 + calls.length}]};
            }
            return {rows: []};
        },
        release: () => { released = true; },
    });
    return {calls, released: () => released};
}

const base = {source_bank: "quiz", target_bank: "individual_mc", source_topic_id: 1, target_topic_id: 2, item_ids: [1, 2]};
const mcItems = [1, 2].map((question_id) => ({question_id, question_text: `Question ${question_id}\n\`\`\`c\nint x = 1;\n\`\`\``, choices: ["A", "B", "C", "D"], correct_answer_index: 2, explanation: "Explanation"}));

test("shuffles without changing the source, and prevents unchanged order for multiple items", () => {
    const original = [1, 2, 3, 4];
    const result = shuffledCopy(original, (max) => max - 1);
    assert.notDeepEqual(result, original);
    assert.deepEqual([...result].sort(), original);
    assert.deepEqual(original, [1, 2, 3, 4]);
    assert.deepEqual(shuffledCopy([1]), [1]);
});

test("copies MC in both directions and pre/post banks, appends new numbers, and preserves code and answer indices", async () => {
    for (const [source_bank, target_bank] of [["quiz", "individual_mc"], ["individual_mc", "quiz"], ["quiz", "pre_test"], ["post_test", "quiz"]]) {
        const db = fakeDatabase(mcItems);
        const result = await copyQuestionBankItems({...base, source_bank, target_bank});
        assert.deepEqual(result.saved.map((row) => row.number), [8, 9]);
        assert.deepEqual(result.saved.map((row) => row.source_id), [2, 1]);
        const inserts = db.calls.filter((call) => call.sql.includes("INSERT INTO"));
        const individualTarget = target_bank !== "quiz";
        for (const [index, insert] of inserts.entries()) {
            const source = mcItems.find((item) => item.question_id === result.saved[index].source_id);
            assert.equal(insert.params[individualTarget ? 4 : 2], source.question_text);
            assert.deepEqual(JSON.parse(insert.params[individualTarget ? 5 : 3]), source.choices);
            assert.equal(insert.params[individualTarget ? 6 : 4], source.correct_answer_index);
            assert.doesNotMatch(insert.sql, /ON CONFLICT|UPDATE|DELETE/);
        }
        assert.ok(db.calls.some((call) => call.sql.startsWith("LOCK TABLE")));
        assert.equal(db.calls.at(-1).sql, "COMMIT");
        assert.ok(db.released());
    }
});

test("copies case studies in both directions and sets individual exercise case fields", async () => {
    for (const [source_bank, target_bank] of [["individual_case", "group_case"], ["group_case", "individual_case"]]) {
        const db = fakeDatabase([{question_id: 1, case_id: 1, case_title: "Case", case_prompt: "```c\nint x = 1;\n```"}]);
        const result = await copyQuestionBankItems({...base, source_bank, target_bank, item_ids: [1]});
        assert.equal(result.count, 1);
        const insert = db.calls.find((call) => call.sql.includes("INSERT INTO"));
        if (target_bank === "individual_case") {
            assert.deepEqual(insert.params.slice(1), ["exercise", "case_study", 8, null, "[]", null, null, "Case", "```c\nint x = 1;\n```"]);
        } else {
            assert.deepEqual(insert.params, [2, 8, "Case", "```c\nint x = 1;\n```"]);
        }
    }
});

test("rejects incompatible banks, inherited keys, invalid IDs, and empty selections", async () => {
    for (const override of [{target_bank: "group_case"}, {target_bank: "quiz"}, {source_bank: "__proto__"}, {item_ids: []}, {item_ids: ["1 OR 1=1"]}, {source_topic_id: -1}]) {
        await assert.rejects(copyQuestionBankItems({...base, ...override}), (error) => error.status === 400);
    }
});

test("rolls back missing/stale questions, missing topics, and insert failures without partial copies", async () => {
    for (const [items, options] of [[[], {}], [mcItems, {missingTopic: true}], [mcItems, {failInsert: true}]]) {
        const db = fakeDatabase(items, options);
        await assert.rejects(copyQuestionBankItems(base));
        assert.equal(db.calls.at(-1).sql, "ROLLBACK");
        assert.ok(!db.calls.some((call) => call.sql === "COMMIT"));
        assert.ok(db.released());
    }
});
