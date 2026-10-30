import readline from "node:readline";
import {Writable} from "node:stream";
import {pathToFileURL} from "node:url";
import {pool} from "../db/index.js";
import {hashPassword} from "../models/adminModel.js";

export async function createInitialAdmin(username, password, database = pool) {
    const name = String(username || "").trim();
    if (!name || name.length > 120) throw new Error("Administrator username must contain 1-120 characters.");
    if (typeof password !== "string" || password.length < 12) throw new Error("Choose an administrator password of at least 12 characters.");
    const passwordHash = hashPassword(password);
    const client = await database.connect();
    try {
        await client.query("BEGIN");
        await client.query("LOCK TABLE useradmin IN SHARE ROW EXCLUSIVE MODE");
        const admins = await client.query("SELECT 1 FROM useradmin WHERE role = 'admin' LIMIT 1");
        if (admins.rows.length) throw new Error("An administrator already exists. This command does not replace existing accounts or reset passwords.");
        const existing = await client.query("SELECT 1 FROM useradmin WHERE LOWER(username) = LOWER($1) LIMIT 1", [name]);
        if (existing.rows.length) throw new Error("That username is already in use. Choose another username.");
        const result = await client.query(
            `INSERT INTO useradmin (username, password_hash, role, is_disabled)
             VALUES ($1, $2, 'admin', FALSE) RETURNING useradmin_id, username`,
            [name, passwordHash]
        );
        await client.query("COMMIT");
        return result.rows[0];
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

async function main() {
    if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("Run npm run setup:admin in an interactive terminal.");
    let hidden = false;
    const output = new Writable({write(chunk, encoding, done) {
        if (!hidden) process.stdout.write(chunk, encoding);
        done();
    }});
    const terminal = readline.createInterface({input: process.stdin, output, terminal: true, historySize: 0});
    const ask = (prompt, conceal = false) => new Promise((resolve, reject) => {
        if (conceal) process.stdout.write(prompt);
        hidden = conceal;
        const interrupted = () => { terminal.close(); reject(new Error("Administrator setup cancelled.")); };
        terminal.once("SIGINT", interrupted);
        terminal.question(conceal ? "" : prompt, (answer) => {
            terminal.removeListener("SIGINT", interrupted);
            hidden = false;
            if (conceal) process.stdout.write("\n");
            resolve(answer);
        });
    });
    try {
        const username = await ask("Administrator username: ");
        const password = await ask("Password (at least 12 characters; input hidden): ", true);
        const confirmation = await ask("Confirm password (input hidden): ", true);
        if (password !== confirmation) throw new Error("Passwords do not match.");
        const admin = await createInitialAdmin(username, password);
        console.log(`Administrator '${admin.username}' created. Sign in at /gamifyitadmin.`);
    } finally {
        terminal.close();
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try {
        await main();
    } catch (error) {
        console.error(error.code ? "Administrator setup failed. Check the database schema, configuration, and connection." : error.message);
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
}
