import {pool} from "../db/index.js";

export const STUDENT_ROLE_ID = 1;
export const INSTRUCTOR_ROLE_ID = 2;

let roleReadyPromise = null;

async function createRoleSchema() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS roles (
            role_id SERIAL PRIMARY KEY,
            role_name TEXT NOT NULL UNIQUE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);

    await pool.query(
        `INSERT INTO roles (role_id, role_name)
         VALUES
             ($1, 'Student'),
             ($2, 'Instructor')
         ON CONFLICT (role_id)
         DO NOTHING`,
        [STUDENT_ROLE_ID, INSTRUCTOR_ROLE_ID]
    );

    await pool.query(`
        SELECT setval(
            pg_get_serial_sequence('roles', 'role_id'),
            GREATEST((SELECT MAX(role_id) FROM roles), 1)
        )
    `);

    await pool.query(`
        ALTER TABLE users
        ADD COLUMN IF NOT EXISTS role_id INTEGER DEFAULT ${STUDENT_ROLE_ID}
    `);

    await pool.query(`
        ALTER TABLE users
        DROP COLUMN IF EXISTS gender
    `);

    await pool.query(
        `UPDATE users
         SET role_id = $1
         WHERE role_id IS NULL`,
        [STUDENT_ROLE_ID]
    );

    await pool.query(`
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1
                FROM pg_constraint
                WHERE conname = 'users_role_id_fkey'
                  AND conrelid = 'users'::regclass
            ) THEN
                ALTER TABLE users
                ADD CONSTRAINT users_role_id_fkey
                FOREIGN KEY (role_id) REFERENCES roles(role_id);
            END IF;
        END $$;
    `);

    await pool.query(`
        ALTER TABLE users
        ALTER COLUMN role_id SET DEFAULT ${STUDENT_ROLE_ID}
    `);

    await pool.query(`
        ALTER TABLE users
        ALTER COLUMN role_id SET NOT NULL
    `);

    await pool.query(`
        CREATE INDEX IF NOT EXISTS users_role_id_idx
        ON users (role_id)
    `);
}

export async function ensureRoleSchema() {
    if (!roleReadyPromise) {
        roleReadyPromise = createRoleSchema().catch((error) => {
            roleReadyPromise = null;
            throw error;
        });
    }

    return roleReadyPromise;
}

export async function listRoles() {
    await ensureRoleSchema();
    const result = await pool.query(
        `SELECT role_id, role_name, updated_at
         FROM roles
         ORDER BY role_id ASC`
    );
    return result.rows;
}

export async function findRoleById(roleId) {
    await ensureRoleSchema();
    const result = await pool.query(
        `SELECT role_id, role_name
         FROM roles
         WHERE role_id = $1
         LIMIT 1`,
        [roleId]
    );
    return result.rows[0] || null;
}

export async function updateRole(roleId, payload) {
    await ensureRoleSchema();
    const roleName = String(payload.role_name || "").trim();
    const result = await pool.query(
        `UPDATE roles
         SET role_name = $2,
             updated_at = NOW()
         WHERE role_id = $1
         RETURNING role_id`,
        [roleId, roleName]
    );
    return result.rows[0] || null;
}
