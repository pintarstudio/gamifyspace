import {test, before, after} from "node:test";
import assert from "node:assert/strict";
import {pool} from "../db/index.js";
import {deleteSelectedUserActivities} from "./userActivityDeleteModel.js";

const originalQuery = pool.query;
const originalConnect = pool.connect;
const originalSecret = process.env.ADMIN_PASSWORD_SECRET;
before(() => {
    process.env.ADMIN_PASSWORD_SECRET = "test-only-placeholder";
    pool.query = async () => ({rows: []});
});
after(() => {
    pool.query = originalQuery; pool.connect = originalConnect;
    if (originalSecret === undefined) delete process.env.ADMIN_PASSWORD_SECRET;
    else process.env.ADMIN_PASSWORD_SECRET = originalSecret;
});

function database({missing = false, fail = false} = {}) {
    const calls = [];
    let released = false;
    pool.connect = async () => ({
        query: async (sql, params) => {
            calls.push({sql, params});
            if (sql.startsWith("SELECT user_id")) return {rows: [{user_id: 1, name: "Test"}]};
            if (sql.startsWith("SELECT")) return {rows: missing ? [] : params[1].map((id) => ({id}))};
            if (fail && sql.startsWith("DELETE")) throw new Error("Database failure");
            return {rowCount: 1, rows: []};
        },
        release: () => { released = true; },
    });
    return {calls, released: () => released};
}

test("rejects empty selections, invalid types/IDs, and oversized batches", async () => {
    for (const activities of [[], null, [{type: "sessions", id: 1}], [{type: "__proto__", id: 1}], [{type: "individual", id: "1 OR 1=1"}], Array.from({length: 101}, () => ({type: "log", id: 1}))]) {
        await assert.rejects(deleteSelectedUserActivities(1, activities), (error) => error.status === 400);
    }
});

test("deletes only selected sessions/logs and their scores; duplicate selections are counted once", async () => {
    const db = database();
    const result = await deleteSelectedUserActivities(1, [
        {type: "individual", id: 2}, {type: "group", id: 3}, {type: "quiz", id: 4}, {type: "log", id: 5}, {type: "log", id: 5},
    ]);
    assert.equal(result.count, 4);
    const scores = db.calls.find((call) => call.sql.startsWith("DELETE FROM gamification_user_scores"));
    assert.deepEqual(scores.params, [[2], [3], [4]]);
    const logs = db.calls.find((call) => call.sql.startsWith("DELETE FROM user_logs"));
    assert.deepEqual(logs.params, [1, [5]]);
    assert.ok(!db.calls.some((call) => /^DELETE FROM (users|sessions)\b/.test(call.sql)));
    assert.equal(db.calls.at(-1).sql, "COMMIT");
    assert.ok(db.released());
});

test("rejects foreign or stale activities before deleting anything", async () => {
    const db = database({missing: true});
    await assert.rejects(deleteSelectedUserActivities(1, [{type: "group", id: 99}]), (error) => error.status === 400);
    assert.ok(!db.calls.some((call) => call.sql.startsWith("DELETE")));
    assert.equal(db.calls.at(-1).sql, "ROLLBACK");
    assert.ok(db.released());
});

test("rolls back database failures and always releases the connection", async () => {
    const db = database({fail: true});
    await assert.rejects(deleteSelectedUserActivities(1, [{type: "individual", id: 2}]));
    assert.equal(db.calls.at(-1).sql, "ROLLBACK");
    assert.ok(!db.calls.some((call) => call.sql === "COMMIT"));
    assert.ok(db.released());
});
