import 'dotenv/config';
import {pool} from '../db/index.js';
import {hashPassword} from '../models/adminModel.js';

try {
    const password = process.env.ADMIN_BOOTSTRAP_PASSWORD || '';
    if (password.length < 12) {
        throw new Error('Set ADMIN_BOOTSTRAP_PASSWORD to a password of at least 12 characters.');
    }
    if (!process.env.ADMIN_PASSWORD_SECRET) {
        throw new Error('Configure ADMIN_PASSWORD_SECRET in backend/.env first.');
    }

    // The installation SQL already supplies this table; do not seed default accounts.
    const result = await pool.query(
        `INSERT INTO useradmin (username, password_hash, role, is_disabled)
         VALUES ($1, $2, 'admin', FALSE)
         ON CONFLICT (username) DO UPDATE SET
             password_hash = EXCLUDED.password_hash,
             role = 'admin',
             is_disabled = FALSE,
             updated_at = NOW()
         RETURNING username`,
        ['admin', hashPassword(password)]
    );
    console.log(`Administrator '${result.rows[0].username}' is ready. Use your chosen password at /gamifyitadmin.`);
} catch (error) {
    console.error(`Admin setup failed: ${error.message}`);
    process.exitCode = 1;
} finally {
    await pool.end();
}
