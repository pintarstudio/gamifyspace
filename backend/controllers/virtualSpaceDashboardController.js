import {findSession} from "../models/sessionModel.js";
import {pool} from "../db/index.js";
import {ensureGamificationTables} from "../models/gamificationModel.js";

async function getAuthenticatedUser(req, res) {
    const sessionId = req.session?.session_id;
    if (!sessionId) {
        res.status(401).json({message: "Silakan login terlebih dahulu"});
        return null;
    }

    const user = await findSession(sessionId);
    if (!user) {
        res.status(401).json({message: "Sesi tidak aktif"});
        return null;
    }

    return user;
}

function avatarPath(path) {
    return path || null;
}

export async function getVirtualSpaceDashboard(req, res) {
    try {
        await ensureGamificationTables();
        const user = await getAuthenticatedUser(req, res);
        if (!user) return;

        const [summaryResult, leaderboardResult, activitiesResult] = await Promise.all([
            pool.query(
                `SELECT
                     COALESCE(SUM(ggs.xp_total), 0)::int AS total_group_xp,
                     COALESCE(SUM(gus.xp_earned), 0)::int AS total_individual_xp,
                     COUNT(DISTINCT s.session_id)::int AS completed_activities
                 FROM table_group_sessions s
                 JOIN table_group_members m ON m.session_id = s.session_id
                 LEFT JOIN gamification_group_scores ggs
                   ON ggs.activity_type = 'table_case_study'
                  AND ggs.activity_id = s.session_id
                  AND ggs.group_id = s.group_id
                 LEFT JOIN gamification_user_scores gus
                   ON gus.activity_type = 'table_case_study'
                  AND gus.activity_id = s.session_id
                  AND gus.user_id = $1
                 WHERE m.user_id = $1
                   AND s.submitted_at IS NOT NULL`,
                [user.user_id]
            ),
            pool.query(
                `SELECT
                     u.user_id,
                     u.name,
                     a.avatar_public_path,
                     COALESCE(SUM(gus.xp_earned), 0)::int AS total_xp,
                     COUNT(DISTINCT gus.activity_id)::int AS activities_count
                 FROM users u
                 LEFT JOIN sessions latest_session
                   ON latest_session.user_id = u.user_id
                  AND latest_session.id = (
                      SELECT MAX(s2.id)
                      FROM sessions s2
                      WHERE s2.user_id = u.user_id
                  )
                 LEFT JOIN avatars a ON a.avatar_id = latest_session.avatar_id
                 LEFT JOIN gamification_user_scores gus
                   ON gus.user_id = u.user_id
                  AND gus.course_id = $1
                 WHERE u.course_id = $1
                   AND u.deleted_at IS NULL
                 GROUP BY u.user_id, u.name, a.avatar_public_path
                 ORDER BY total_xp DESC, activities_count DESC, u.name ASC
                 LIMIT 10`,
                [user.course_id]
            ),
            pool.query(
                `SELECT
                     s.session_id,
                     s.group_id,
                     s.topic_id,
                     t.topic_name,
                     COALESCE(tc.case_title, s.case_title) AS case_title,
                     s.submitted_at,
                     s.feedback_status,
                     COALESCE(ggs.xp_total, 0)::int AS group_xp,
                     COALESCE(gus.xp_earned, 0)::int AS my_xp,
                     ARRAY_REMOVE(ARRAY_AGG(DISTINCT u.name), NULL) AS member_names
                 FROM table_group_sessions s
                 JOIN table_group_members m_self
                   ON m_self.session_id = s.session_id
                  AND m_self.user_id = $1
                 LEFT JOIN table_group_members m_all ON m_all.session_id = s.session_id
                 LEFT JOIN users u ON u.user_id = m_all.user_id
                 LEFT JOIN topics t ON t.topic_id = s.topic_id
                 LEFT JOIN topic_cases tc ON tc.case_id = s.case_id
                 LEFT JOIN gamification_group_scores ggs
                   ON ggs.activity_type = 'table_case_study'
                  AND ggs.activity_id = s.session_id
                  AND ggs.group_id = s.group_id
                 LEFT JOIN gamification_user_scores gus
                   ON gus.activity_type = 'table_case_study'
                  AND gus.activity_id = s.session_id
                  AND gus.user_id = $1
                 WHERE s.submitted_at IS NOT NULL
                 GROUP BY
                     s.session_id,
                     s.group_id,
                     s.topic_id,
                     t.topic_name,
                     tc.case_title,
                     s.case_title,
                     s.submitted_at,
                     s.feedback_status,
                     ggs.xp_total,
                     gus.xp_earned
                 ORDER BY s.submitted_at DESC
                 LIMIT 12`,
                [user.user_id]
            ),
        ]);

        res.json({
            user: {
                user_id: user.user_id,
                name: user.name,
                avatar_public_path: avatarPath(user.avatar_public_path),
                gamification_enabled: !!user.gamification_enabled,
            },
            hud: summaryResult.rows[0] || {
                total_group_xp: 0,
                total_individual_xp: 0,
                completed_activities: 0,
            },
            leaderboard: leaderboardResult.rows,
            activities: activitiesResult.rows.map((activity) => ({
                ...activity,
                activity_name: `Group ${activity.group_id} Activity`,
            })),
        });
    } catch (error) {
        console.error("Virtual space dashboard error:", error);
        res.status(500).json({message: "Gagal memuat dashboard virtual space"});
    }
}

export async function getVirtualSpaceActivityDetail(req, res) {
    try {
        await ensureGamificationTables();
        const user = await getAuthenticatedUser(req, res);
        if (!user) return;

        const sessionId = Number.parseInt(req.params.sessionId, 10);
        if (!Number.isFinite(sessionId)) {
            return res.status(400).json({message: "Activity tidak valid"});
        }

        const accessResult = await pool.query(
            `SELECT 1
             FROM table_group_members
             WHERE session_id = $1
               AND user_id = $2
             LIMIT 1`,
            [sessionId, user.user_id]
        );
        if (!accessResult.rows[0]) {
            return res.status(403).json({message: "Activity tidak tersedia untuk user ini"});
        }

        const [sessionResult, membersResult, answersResult, feedbackResult, groupScoreResult, logsResult] = await Promise.all([
            pool.query(
                `SELECT
                     s.*,
                     t.topic_name,
                     COALESCE(tc.case_title, s.case_title) AS case_title,
                     COALESCE(tc.case_prompt, s.case_prompt) AS case_prompt
                 FROM table_group_sessions s
                 LEFT JOIN topics t ON t.topic_id = s.topic_id
                 LEFT JOIN topic_cases tc ON tc.case_id = s.case_id
                 WHERE s.session_id = $1
                 LIMIT 1`,
                [sessionId]
            ),
            pool.query(
                `SELECT
                     m.user_id,
                     u.name,
                     m.avatar_public_path,
                     m.joined_at,
                     COALESCE(gus.xp_earned, 0)::int AS xp_earned,
                     gus.reason AS xp_reason
                 FROM table_group_members m
                 JOIN users u ON u.user_id = m.user_id
                 LEFT JOIN table_group_sessions s ON s.session_id = m.session_id
                 LEFT JOIN gamification_user_scores gus
                   ON gus.activity_type = 'table_case_study'
                  AND gus.activity_id = m.session_id
                  AND gus.user_id = m.user_id
                 WHERE m.session_id = $1
                 ORDER BY m.joined_at ASC`,
                [sessionId]
            ),
            pool.query(
                `SELECT
                     a.user_id,
                     u.name,
                     m.avatar_public_path,
                     a.answer_text,
                     a.updated_at
                 FROM table_group_answers a
                 JOIN users u ON u.user_id = a.user_id
                 LEFT JOIN table_group_members m
                   ON m.session_id = a.session_id
                  AND m.user_id = a.user_id
                 WHERE a.session_id = $1
                   AND a.answer_text <> ''
                 ORDER BY a.updated_at ASC`,
                [sessionId]
            ),
            pool.query(
                `SELECT feedback_group_id, student_ids, student_names, www, ebi
                 FROM table_group_feedback_groups
                 WHERE session_id = $1
                 ORDER BY feedback_group_id ASC`,
                [sessionId]
            ),
            pool.query(
                `SELECT xp_total, reason
                 FROM gamification_group_scores
                 WHERE activity_type = 'table_case_study'
                   AND activity_id = $1
                 LIMIT 1`,
                [sessionId]
            ),
            pool.query(
                `SELECT action_type, details, created_at
                 FROM user_logs
                 WHERE user_id = $1
                   AND created_at BETWEEN
                       COALESCE((SELECT created_at FROM table_group_sessions WHERE session_id = $2), NOW()) - INTERVAL '5 minutes'
                       AND COALESCE((SELECT submitted_at FROM table_group_sessions WHERE session_id = $2), NOW()) + INTERVAL '5 minutes'
                 ORDER BY created_at ASC
                 LIMIT 30`,
                [user.user_id, sessionId]
            ),
        ]);

        const session = sessionResult.rows[0];
        if (!session) {
            return res.status(404).json({message: "Activity tidak ditemukan"});
        }

        res.json({
            activity: {
                session_id: session.session_id,
                activity_name: `Group ${session.group_id} Activity`,
                group_id: session.group_id,
                topic_name: session.topic_name,
                case_title: session.case_title,
                case_prompt: session.case_prompt,
                submitted_at: session.submitted_at,
                created_at: session.created_at,
                combined_feedback: session.combined_feedback,
                feedback_text: session.feedback_text,
                group_xp: groupScoreResult.rows[0]?.xp_total || 0,
                group_xp_reason: groupScoreResult.rows[0]?.reason || "",
                members: membersResult.rows,
                answers: answersResult.rows,
                feedback_groups: feedbackResult.rows,
                logs: logsResult.rows,
            },
        });
    } catch (error) {
        console.error("Virtual space activity detail error:", error);
        res.status(500).json({message: "Gagal memuat detail activity"});
    }
}
