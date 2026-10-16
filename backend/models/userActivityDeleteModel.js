import {pool} from "../db/index.js";
import {ensureAdminTables} from "./adminModel.js";
import {ensureIndividualActivityTables} from "./individualActivityModel.js";
import {ensureTableActivityTables} from "./tableActivityModel.js";
import {ensureQuizActivityTables} from "./quizActivityModel.js";
import {ensureGamificationTables} from "./gamificationModel.js";

function invalid(message) {
    return Object.assign(new Error(message), {status: 400});
}

export async function deleteSelectedUserActivities(userId, activities) {
    const positiveId = (value) => /^\d+$/.test(String(value)) && Number(value) > 0 && Number(value) <= 2147483647;
    const ids = {individual: [], group: [], quiz: [], log: []};
    if (!positiveId(userId) || !Array.isArray(activities) || !activities.length || activities.length > 100) {
        throw invalid("Pilih 1 sampai 100 aktivitas yang akan dihapus.");
    }
    for (const activity of activities) {
        if (!activity || !Object.hasOwn(ids, activity.type) || !positiveId(activity.id)) throw invalid("Pilihan aktivitas tidak valid.");
        if (!ids[activity.type].includes(Number(activity.id))) ids[activity.type].push(Number(activity.id));
    }
    await ensureAdminTables();
    await Promise.all([ensureIndividualActivityTables(), ensureTableActivityTables(), ensureQuizActivityTables(), ensureGamificationTables()]);
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const user = await client.query("SELECT user_id, name FROM users WHERE user_id = $1 AND deleted_at IS NULL FOR UPDATE", [userId]);
        if (!user.rows[0]) {
            await client.query("ROLLBACK");
            return null;
        }
        const scopes = {
            individual: `SELECT s.session_id AS id FROM individual_activity_sessions s
                         WHERE s.user_id = $1 AND s.session_id = ANY($2::int[]) FOR UPDATE OF s`,
            group: `SELECT s.session_id AS id FROM table_group_sessions s WHERE s.session_id = ANY($2::int[]) AND (
                        s.created_by = $1 OR s.submitted_by = $1
                        OR EXISTS (SELECT 1 FROM table_group_members m WHERE m.session_id = s.session_id AND m.user_id = $1)
                        OR EXISTS (SELECT 1 FROM table_group_answers a WHERE a.session_id = s.session_id AND a.user_id = $1)) FOR UPDATE OF s`,
            quiz: `SELECT s.quiz_session_id AS id FROM quiz_sessions s WHERE s.quiz_session_id = ANY($2::int[]) AND (
                        s.hosted_by = $1 OR s.saved_by = $1
                        OR EXISTS (SELECT 1 FROM quiz_members m WHERE m.quiz_session_id = s.quiz_session_id AND m.user_id = $1)
                        OR EXISTS (SELECT 1 FROM quiz_answers a WHERE a.quiz_session_id = s.quiz_session_id AND a.user_id = $1)) FOR UPDATE OF s`,
            log: `SELECT log_id AS id FROM user_logs WHERE user_id = $1 AND log_id = ANY($2::int[]) FOR UPDATE`,
        };
        for (const [type, selected] of Object.entries(ids)) {
            if (!selected.length) continue;
            const found = await client.query(scopes[type], [userId, selected]);
            if (found.rows.length !== selected.length) {
                throw invalid("Sebagian aktivitas tidak ditemukan atau bukan milik user ini. Muat ulang daftar aktivitas.");
            }
        }
        const deleted = {};
        const remove = async (key, sql, params) => {
            deleted[key] = (await client.query(sql, params)).rowCount || 0;
        };
        await remove("gamification_user_scores", `DELETE FROM gamification_user_scores
            WHERE (activity_type = 'individual_exercise' AND activity_id = ANY($1::int[]))
               OR (activity_type = 'table_case_study' AND activity_id = ANY($2::int[]))
               OR (activity_type = 'quiz' AND activity_id = ANY($3::int[]))`, [ids.individual, ids.group, ids.quiz]);
        await remove("gamification_group_scores", `DELETE FROM gamification_group_scores
            WHERE (activity_type = 'table_case_study' AND activity_id = ANY($1::int[]))
               OR (activity_type = 'quiz' AND activity_id = ANY($2::int[]))`, [ids.group, ids.quiz]);
        // Session foreign keys cascade to answers, memberships, and saved results.
        await remove("individual_sessions", "DELETE FROM individual_activity_sessions WHERE session_id = ANY($1::int[])", [ids.individual]);
        await remove("group_sessions", "DELETE FROM table_group_sessions WHERE session_id = ANY($1::int[])", [ids.group]);
        await remove("quiz_sessions", "DELETE FROM quiz_sessions WHERE quiz_session_id = ANY($1::int[])", [ids.quiz]);
        if (ids.log.length) await remove("user_logs", "DELETE FROM user_logs WHERE user_id = $1 AND log_id = ANY($2::int[])", [userId, ids.log]);
        await client.query("COMMIT");
        return {user: user.rows[0], deleted, count: Object.values(ids).reduce((sum, list) => sum + list.length, 0)};
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}
