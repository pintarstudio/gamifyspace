import assert from "node:assert/strict";
import {randomBytes} from "node:crypto";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import pg from "pg";
import {pool} from "../db/index.js";

// Uses a newly created database only. Never imports SQL into the configured database.
const databaseName = `gamifyspace_install_check_${randomBytes(8).toString("hex")}`;
let created = false;
let testPool;
try {
    await pool.query(`CREATE DATABASE "${databaseName}"`);
    created = true;
    const env = {
        ...process.env,
        PGHOST: process.env.DB_HOST || "localhost",
        PGPORT: process.env.DB_PORT || "5432",
        PGUSER: process.env.DB_USER,
        PGPASSWORD: process.env.DB_PASSWORD,
        PGDATABASE: databaseName,
        DB_NAME: databaseName,
        ADMIN_PASSWORD_SECRET: randomBytes(32).toString("hex"),
    };
    for (const file of ["schema.sql", "seed.sql"]) {
        const result = spawnSync("psql", ["-X", "-v", "ON_ERROR_STOP=1", "-f", fileURLToPath(new URL(`../../database/${file}`, import.meta.url))], {env, encoding: "utf8"});
        assert.equal(result.status, 0, `Import failed for ${file}: ${result.stderr || result.error?.message || "Unknown error"}`);
    }
    testPool = new pg.Pool({host: env.PGHOST, port: env.PGPORT, user: env.PGUSER, password: env.PGPASSWORD, database: databaseName});
    const tables = (await testPool.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename")).rows;
    assert.equal(tables.length, 34);
    const expected = {roles: 2, avatars: 50, settings: 4, gamification_levels: 10};
    for (const {tablename} of tables) {
        const count = (await testPool.query(`SELECT COUNT(*)::int AS count FROM public."${tablename}"`)).rows[0].count;
        assert.equal(count, expected[tablename] || 0, `Unexpected starter data in ${tablename}`);
    }
    const settings = (await testPool.query("SELECT * FROM settings ORDER BY setting_id")).rows;
    assert.equal(settings[0].boolean_value, false);
    assert.equal(settings[1].boolean_value, false);
    assert.equal(settings[2].datetime_value, null);
    assert.equal(settings[3].datetime_value, null);
    const avatarNext = (await testPool.query("SELECT nextval(pg_get_serial_sequence('avatars', 'avatar_id')) AS id")).rows[0].id;
    assert.equal(Number(avatarNext), 51);

    const validation = spawnSync(process.execPath, ["--input-type=module", "-e", `
        import assert from 'node:assert/strict';
        import {randomBytes} from 'node:crypto';
        import {pool} from './db/index.js';
        import {ensureAdminTables, verifyAdminPassword, findAdminByUsername} from './models/adminModel.js';
        import {ensureCourseSchema} from './models/courseModel.js';
        import {ensureQuestionBankAdminTables} from './models/adminQuestionBankModel.js';
        import {ensureChatSchema} from './models/chatModel.js';
        import {createInitialAdmin} from './scripts/setup-admin.js';
        try {
            await Promise.all([ensureAdminTables(), ensureCourseSchema(), ensureQuestionBankAdminTables(), ensureChatSchema()]);
            assert.equal((await pool.query('SELECT COUNT(*)::int AS n FROM useradmin')).rows[0].n, 0);
            const password = randomBytes(24).toString('hex');
            await assert.rejects(createInitialAdmin('admin', 'short'));
            await createInitialAdmin('admin', password);
            const admin = await findAdminByUsername('admin');
            assert.equal(admin.role, 'admin');
            assert.ok(verifyAdminPassword(password, admin.password_hash));
            await assert.rejects(createInitialAdmin('another-admin', randomBytes(24).toString('hex')), /already exists/);
            assert.equal((await pool.query('SELECT COUNT(*)::int AS n FROM useradmin')).rows[0].n, 1);
            assert.equal((await pool.query("SELECT boolean_value FROM settings WHERE setting_key='allow_url_login_user_creation'")).rows[0].boolean_value, false);
            console.log('Startup initialization, private admin creation, password verification, and existing-admin protection passed.');
        } finally { await pool.end(); }
    `], {cwd: fileURLToPath(new URL("../", import.meta.url)), env, encoding: "utf8"});
    assert.equal(validation.status, 0, validation.stderr || "Startup validation failed");
    console.log("Fresh install passed: 34 tables; 66 starter records; all operational tables initially empty.");
    console.log("Startup and administrator setup checks passed. Temporary database will be removed.");
} catch (error) {
    console.error(error.message);
    process.exitCode = 1;
} finally {
    if (testPool) await testPool.end();
    if (created) await pool.query(`DROP DATABASE "${databaseName}"`);
    await pool.end();
}
