import {pool} from "../db/index.js";

const TABLE_ACTIVITY_TYPE = "table_case_study";
let gamificationReadyPromise = null;

function clampXp(value) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return 0;
    return Math.max(0, Math.min(100, parsed));
}

async function runSchemaQuery(query) {
    try {
        await pool.query(query);
    } catch (error) {
        if (error.code === "42P07") return;
        throw error;
    }
}

async function createGamificationTables() {
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS gamification_enabled BOOLEAN NOT NULL DEFAULT TRUE`);

    await runSchemaQuery(`
        CREATE TABLE IF NOT EXISTS gamification_levels (
            level_id INTEGER PRIMARY KEY,
            level_name TEXT NOT NULL,
            min_xp INTEGER NOT NULL,
            max_xp INTEGER,
            color_hex TEXT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CHECK (level_id BETWEEN 1 AND 5),
            CHECK (min_xp >= 0),
            CHECK (max_xp IS NULL OR max_xp >= min_xp)
        )
    `);

    await pool.query(
        `INSERT INTO gamification_levels (level_id, level_name, min_xp, max_xp, color_hex)
         VALUES
             (1, 'Rookie', 0, 99, '#6B7280'),
             (2, 'Explorer', 100, 249, '#2F7197'),
             (3, 'Achiever', 250, 499, '#2D6A4F'),
             (4, 'Strategist', 500, 899, '#8A4F08'),
             (5, 'Mastermind', 900, NULL, '#A03C53')
         ON CONFLICT (level_id)
         DO UPDATE SET
             level_name = EXCLUDED.level_name,
             min_xp = EXCLUDED.min_xp,
             max_xp = EXCLUDED.max_xp,
             color_hex = EXCLUDED.color_hex,
             updated_at = NOW()`
    );

    await runSchemaQuery(`
        CREATE TABLE IF NOT EXISTS gamification_group_scores (
            score_id SERIAL PRIMARY KEY,
            activity_type TEXT NOT NULL,
            activity_id INTEGER NOT NULL,
            group_id INTEGER NOT NULL,
            course_id INTEGER NOT NULL,
            xp_total INTEGER NOT NULL DEFAULT 0,
            reason TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (activity_type, activity_id, group_id)
        )
    `);

    await runSchemaQuery(`
        CREATE TABLE IF NOT EXISTS gamification_user_scores (
            score_id SERIAL PRIMARY KEY,
            activity_type TEXT NOT NULL,
            activity_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            group_id INTEGER NOT NULL,
            course_id INTEGER NOT NULL,
            xp_earned INTEGER NOT NULL DEFAULT 0,
            reason TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (activity_type, activity_id, user_id)
        )
    `);
}

export async function ensureGamificationTables() {
    if (!gamificationReadyPromise) {
        gamificationReadyPromise = createGamificationTables().catch((error) => {
            gamificationReadyPromise = null;
            throw error;
        });
    }

    return gamificationReadyPromise;
}

export function normalizeXpAwards(xpAwards, answers) {
    const answerMap = new Map(answers.map((answer) => [Number(answer.user_id), answer]));
    const submittedStudentIds = [...answerMap.keys()];
    const awardMap = new Map();

    for (const award of xpAwards?.student_xp_awards || []) {
        const studentId = Number(award.student_id);
        if (!answerMap.has(studentId)) continue;
        awardMap.set(studentId, {
            student_id: studentId,
            xp: clampXp(award.xp),
            reason: String(award.reason || "XP awarded for the submitted answer."),
        });
    }

    for (const studentId of submittedStudentIds) {
        if (!awardMap.has(studentId)) {
            awardMap.set(studentId, {
                student_id: studentId,
                xp: 0,
                reason: "No XP awarded because the answer was not evaluated.",
            });
        }
    }

    return {
        group_xp: clampXp(xpAwards?.group_xp),
        group_xp_reason: String(xpAwards?.group_xp_reason || "Group XP awarded for the combined submitted answers."),
        student_xp_awards: [...awardMap.values()],
    };
}

export async function upsertTableSessionScores(session, answers, xpAwards) {
    const normalizedAwards = normalizeXpAwards(xpAwards, answers);
    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        await client.query(
            `INSERT INTO gamification_group_scores
                 (activity_type, activity_id, group_id, course_id, xp_total, reason)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (activity_type, activity_id, group_id)
             DO UPDATE SET
                 xp_total = EXCLUDED.xp_total,
                 reason = EXCLUDED.reason,
                 updated_at = NOW()`,
            [
                TABLE_ACTIVITY_TYPE,
                session.session_id,
                session.group_id,
                session.course_id,
                normalizedAwards.group_xp,
                normalizedAwards.group_xp_reason,
            ]
        );

        for (const award of normalizedAwards.student_xp_awards) {
            await client.query(
                `INSERT INTO gamification_user_scores
                     (activity_type, activity_id, user_id, group_id, course_id, xp_earned, reason)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)
                 ON CONFLICT (activity_type, activity_id, user_id)
                 DO UPDATE SET
                     xp_earned = EXCLUDED.xp_earned,
                     reason = EXCLUDED.reason,
                     updated_at = NOW()`,
                [
                    TABLE_ACTIVITY_TYPE,
                    session.session_id,
                    award.student_id,
                    session.group_id,
                    session.course_id,
                    award.xp,
                    award.reason,
                ]
            );
        }

        await client.query("COMMIT");
        return normalizedAwards;
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

export async function getTableSessionGamification(session, members, answers, enabled) {
    if (!enabled || !session) {
        return {
            enabled: false,
            group_xp: 0,
            group_xp_reason: "",
            leaderboard: [],
        };
    }

    const [groupScore, userScores] = await Promise.all([
        pool.query(
            `SELECT xp_total, reason
             FROM gamification_group_scores
             WHERE activity_type = $1
               AND activity_id = $2
               AND group_id = $3
             LIMIT 1`,
            [TABLE_ACTIVITY_TYPE, session.session_id, session.group_id]
        ),
        pool.query(
            `SELECT user_id, xp_earned, reason
             FROM gamification_user_scores
             WHERE activity_type = $1
               AND activity_id = $2`,
            [TABLE_ACTIVITY_TYPE, session.session_id]
        ),
    ]);

    const answerSet = new Set((answers || []).map((answer) => Number(answer.user_id)));
    const scoreMap = new Map(userScores.rows.map((row) => [Number(row.user_id), row]));

    return {
        enabled: true,
        group_xp: groupScore.rows[0]?.xp_total || 0,
        group_xp_reason: groupScore.rows[0]?.reason || "",
        leaderboard: (members || []).map((member) => {
            const score = scoreMap.get(Number(member.user_id));
            return {
                user_id: member.user_id,
                name: member.name,
                avatar_public_path: member.avatar_public_path,
                answered: answerSet.has(Number(member.user_id)),
                xp_earned: score?.xp_earned || 0,
                reason: score?.reason || "",
            };
        }).sort((a, b) => b.xp_earned - a.xp_earned || a.name.localeCompare(b.name)),
    };
}
