import {pool} from "../db/index.js";

export const SETTING_KEYS = {
    ALLOW_URL_LOGIN_USER_CREATION: "allow_url_login_user_creation",
    MAINTENANCE_MODE: "maintenance_mode",
    MAINTENANCE_AUTO_OFF_AT: "maintenance_auto_off_at",
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
    {
        key: SETTING_KEYS.MAINTENANCE_AUTO_OFF_AT,
        name: "Maintenance Auto-Off Datetime",
        description: "Automatically turn maintenance mode off at this date and time.",
        type: "datetime",
        datetimeValue: null,
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
            setting_type TEXT NOT NULL CHECK (setting_type IN ('boolean', 'text', 'number', 'datetime')),
            boolean_value BOOLEAN,
            text_value TEXT,
            number_value NUMERIC,
            datetime_value TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);

    await pool.query(`ALTER TABLE settings ADD COLUMN IF NOT EXISTS datetime_value TIMESTAMPTZ`);
    await pool.query(`
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1
                FROM pg_constraint
                WHERE conname = 'settings_setting_type_check'
                  AND conrelid = 'settings'::regclass
            ) THEN
                ALTER TABLE settings DROP CONSTRAINT settings_setting_type_check;
            END IF;

            ALTER TABLE settings
            ADD CONSTRAINT settings_setting_type_check
            CHECK (setting_type IN ('boolean', 'text', 'number', 'datetime'));
        END $$;
    `);

    for (const setting of DEFAULT_SETTINGS) {
        await pool.query(
            `INSERT INTO settings (
                 setting_key,
                 setting_name,
                 setting_description,
                 setting_type,
                 boolean_value,
                 datetime_value
             )
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (setting_key)
             DO UPDATE SET
                 setting_name = EXCLUDED.setting_name,
                 setting_description = EXCLUDED.setting_description,
                 setting_type = EXCLUDED.setting_type,
                 boolean_value = COALESCE(settings.boolean_value, EXCLUDED.boolean_value),
                 datetime_value = COALESCE(settings.datetime_value, EXCLUDED.datetime_value),
                 updated_at = NOW()`,
            [
                setting.key,
                setting.name,
                setting.description,
                setting.type,
                setting.booleanValue ?? null,
                setting.datetimeValue ?? null,
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
    await applyMaintenanceAutoOff();
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
            datetime_value,
            updated_at
        FROM settings
        ORDER BY setting_id ASC
    `);
    return result.rows;
}

function normalizeDateTime(value) {
    const text = String(value ?? "").trim();
    if (!text) return null;
    if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(text)) return text;
    return `${text.length === 16 ? `${text}:00` : text}+07:00`;
}

export async function applyMaintenanceAutoOff() {
    await ensureSettingsTable();
    const result = await pool.query(
        `WITH auto_off AS (
             SELECT datetime_value
             FROM settings
             WHERE setting_key = $1
               AND setting_type = 'datetime'
               AND datetime_value IS NOT NULL
               AND datetime_value <= NOW()
             LIMIT 1
         ),
         updated AS (
             UPDATE settings
             SET boolean_value = FALSE,
                 updated_at = NOW()
             WHERE setting_key = $2
               AND setting_type = 'boolean'
               AND boolean_value = TRUE
               AND EXISTS (SELECT 1 FROM auto_off)
             RETURNING setting_id
         )
         UPDATE settings
         SET datetime_value = NULL,
             updated_at = CASE
                 WHEN EXISTS (SELECT 1 FROM updated) THEN NOW()
                 ELSE updated_at
             END
         WHERE setting_key = $1
           AND EXISTS (SELECT 1 FROM updated)
         RETURNING (SELECT COUNT(*)::int FROM updated) AS updated_count`,
        [SETTING_KEYS.MAINTENANCE_AUTO_OFF_AT, SETTING_KEYS.MAINTENANCE_MODE]
    );
    return Number(result.rows[0]?.updated_count || 0) > 0;
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
             datetime_value = CASE
                 WHEN setting_type = 'datetime' THEN $5::timestamptz
                 ELSE datetime_value
             END,
             updated_at = NOW()
         WHERE setting_id = $1
         RETURNING setting_id, setting_key, setting_type, boolean_value, text_value, number_value, datetime_value`,
        [
            settingId,
            payload.boolean_value === undefined ? null : !!payload.boolean_value,
            payload.text_value ?? null,
            payload.number_value === undefined || payload.number_value === "" ? null : Number(payload.number_value),
            normalizeDateTime(payload.datetime_value),
        ]
    );
    const updated = result.rows[0] || null;
    if (
        updated?.setting_key === SETTING_KEYS.MAINTENANCE_MODE
        && updated.boolean_value === true
    ) {
        await pool.query(
            `UPDATE settings
             SET datetime_value = NULL,
                 updated_at = NOW()
             WHERE setting_key = $1
               AND datetime_value <= NOW()`,
            [SETTING_KEYS.MAINTENANCE_AUTO_OFF_AT]
        );
    }
    if (updated?.setting_key === SETTING_KEYS.MAINTENANCE_AUTO_OFF_AT) {
        await applyMaintenanceAutoOff();
    }
    return updated;
}

export async function getBooleanSetting(settingKey, fallback = false) {
    await ensureSettingsTable();
    if (settingKey === SETTING_KEYS.MAINTENANCE_MODE) {
        await applyMaintenanceAutoOff();
    }
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
