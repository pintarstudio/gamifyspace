import {pool} from "../db/index.js";

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

let schedulerStarted = false;

export async function applyExpiredTopicVisibility() {
    await pool.query(`
        DO $$
        BEGIN
            IF to_regclass('public.topics') IS NOT NULL THEN
                ALTER TABLE topics
                ADD COLUMN IF NOT EXISTS show_topic BOOLEAN NOT NULL DEFAULT TRUE;

                ALTER TABLE topics
                ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

                ALTER TABLE topics
                ADD COLUMN IF NOT EXISTS post_test_end_at TIMESTAMPTZ;
            END IF;
        END $$;
    `);

    const result = await pool.query(
        `UPDATE topics
         SET show_topic = FALSE,
             is_active = FALSE,
             updated_at = NOW()
         WHERE deleted_at IS NULL
           AND post_test_end_at IS NOT NULL
           AND post_test_end_at <= NOW()
           AND (show_topic = TRUE OR is_active = TRUE)
         RETURNING topic_id, topic_name, course_id`
    );

    if (result.rowCount > 0) {
        console.log(`Auto-hidden ${result.rowCount} expired topic(s) after post-test end.`);
    }

    return result.rows;
}

export function startTopicAutoHideScheduler() {
    if (schedulerStarted) return;
    schedulerStarted = true;

    applyExpiredTopicVisibility().catch((error) => {
        console.error("Failed to auto-hide expired topics:", error);
    });

    setInterval(() => {
        applyExpiredTopicVisibility().catch((error) => {
            console.error("Failed to auto-hide expired topics:", error);
        });
    }, FIFTEEN_MINUTES_MS);
}
