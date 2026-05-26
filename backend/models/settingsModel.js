import {pool} from "../db/index.js";

export const SETTING_KEYS = {
    ALLOW_URL_LOGIN_USER_CREATION: "allow_url_login_user_creation",
    MAINTENANCE_MODE: "maintenance_mode",
};

const DEFAULT_SETTINGS = [
    {
        key: SETTING_KEYS.ALLOW_URL_LOGIN_USER_CREATION,
        name: "Allow URL Login User Creation",
        description: "Allow public student access links to create a new student account when the email is not registered yet.",
        type: "boolean",
        booleanValue: true,
    },
    {
        key: SETTING_KEYS.MAINTENANCE_MODE,
        name: "Maintenance Mode",
        description: "When active, student login is disabled and active student sessions are logged out.",
        type: "boolean",
        booleanValue: false,
    },
];

let settingsReadyPromise = null;

async function createSettingsTable() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS settings (
            setting_id SERIAL PRIMARY KEY,
            setting_key TEXT NOT NULL UNIQUE,
            setting_name TEXT NOT NULL,
            setting_description TEXT,
            setting_type TEXT NOT NULL CHECK (setting_type IN ('boolean', 'text', 'number')),
            boolean_value BOOLEAN,
            text_value TEXT,
            number_value NUMERIC,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);

    for (const setting of DEFAULT_SETTINGS) {
        await pool.query(
            `INSERT INTO settings (
                 setting_key,
                 setting_name,
                 setting_description,
                 setting_type,
                 boolean_value
             )
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (setting_key)
             DO UPDATE SET
                 setting_name = EXCLUDED.setting_name,
                 setting_description = EXCLUDED.setting_description,
                 setting_type = EXCLUDED.setting_type,
                 boolean_value = COALESCE(settings.boolean_value, EXCLUDED.boolean_value),
                 updated_at = NOW()`,
            [
                setting.key,
                setting.name,
                setting.description,
                setting.type,
                setting.booleanValue,
            ]
        );
    }
}

export async function ensureSettingsTable() {
    if (!settingsReadyPromise) {
        settingsReadyPromise = createSettingsTable().catch((error) => {
            settingsReadyPromise = null;
            throw error;
        });
    }
    return settingsReadyPromise;
}

export async function listSettings() {
    await ensureSettingsTable();
    const result = await pool.query(`
        SELECT
            setting_id,
            setting_key,
            setting_name,
            setting_description,
            setting_type,
            boolean_value,
            text_value,
            number_value,
            updated_at
        FROM settings
        ORDER BY setting_id ASC
    `);
    return result.rows;
}

export async function updateSetting(settingId, payload) {
    await ensureSettingsTable();
    const result = await pool.query(
        `UPDATE settings
         SET boolean_value = CASE
                 WHEN setting_type = 'boolean' THEN $2
                 ELSE boolean_value
             END,
             text_value = CASE
                 WHEN setting_type = 'text' THEN $3
                 ELSE text_value
             END,
             number_value = CASE
                 WHEN setting_type = 'number' THEN $4
                 ELSE number_value
             END,
             updated_at = NOW()
         WHERE setting_id = $1
         RETURNING setting_id, setting_key, setting_type, boolean_value, text_value, number_value`,
        [
            settingId,
            payload.boolean_value === undefined ? null : !!payload.boolean_value,
            payload.text_value ?? null,
            payload.number_value === undefined || payload.number_value === "" ? null : Number(payload.number_value),
        ]
    );
    return result.rows[0] || null;
}

export async function getBooleanSetting(settingKey, fallback = false) {
    await ensureSettingsTable();
    const result = await pool.query(
        `SELECT boolean_value
         FROM settings
         WHERE setting_key = $1
           AND setting_type = 'boolean'
         LIMIT 1`,
        [settingKey]
    );
    if (!result.rows[0]) return fallback;
    return result.rows[0].boolean_value !== false;
}
