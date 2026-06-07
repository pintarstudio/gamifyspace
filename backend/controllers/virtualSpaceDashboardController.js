import {findSession} from "../models/sessionModel.js";
import {pool} from "../db/index.js";
import {ensureGamificationTables} from "../models/gamificationModel.js";
import {ensureQuizActivityTables} from "../models/quizActivityModel.js";
import {ensureIndividualActivityTables} from "../models/individualActivityModel.js";

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

function labelIndividualActivity(activityType, questionKind) {
    if (activityType === "pre_test") return "Pre-test";
    if (activityType === "post_test") return "Post-test";
    return questionKind === "case_study" ? "Individual Case Study" : "Individual Exercise";
}

function sanitizeIndividualQuestion(question, revealCorrectAnswer) {
    if (revealCorrectAnswer) return question;
    const {correct_answer_index, explanation, ...safeQuestion} = question;
    return safeQuestion;
}

function sanitizeIndividualAnswer(answer, revealCorrectAnswer) {
    if (revealCorrectAnswer) return answer;
    const {answer_index, answer_text, correct_answer_index, explanation, ...safeAnswer} = answer;
    return safeAnswer;
}

function buildQuizCardOutcome(activity, user) {
    const results = activity.results_json || {};
    const scoreboard = Array.isArray(results.scoreboard) ? results.scoreboard : [];
    const winner = results.winner || null;
    const competitor = scoreboard.find((item) => String(item.user_id) !== String(user.user_id));
    const fallbackCompetitorName = (activity.member_names || []).find((name) => name && name !== user.name);

    let outcome = null;
    if (winner?.is_tie) {
        outcome = "tie";
    } else if (winner?.user_id !== undefined && winner?.user_id !== null) {
        outcome = String(winner.user_id) === String(user.user_id) ? "win" : "lose";
    }

    return {
        quiz_competitor_name: competitor?.name || fallbackCompetitorName || "Competitor",
        quiz_outcome: outcome,
        quiz_points: Number(
            activity.quiz_points
            ?? scoreboard.find((item) => String(item.user_id) === String(user.user_id))?.total_score
            ?? 0
        ),
    };
}

async function ensureDashboardTopicSchema() {
    await pool.query(`ALTER TABLE topics ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE`);
}

async function getDashboardTopics(courseId) {
    await ensureDashboardTopicSchema();
    const result = await pool.query(
        `SELECT
             topic_id,
             topic_name,
             week,
             COALESCE(is_active, TRUE) AS is_active
         FROM topics
         WHERE course_id = $1
           AND deleted_at IS NULL
           AND COALESCE(show_topic, TRUE) = TRUE
         ORDER BY
             CASE WHEN COALESCE(is_active, TRUE) THEN 0 ELSE 1 END ASC,
             week DESC NULLS LAST,
             topic_id DESC`,
        [courseId]
    );
    return result.rows;
}

async function getDashboardTopic(courseId, selectedTopicId = null) {
    const topics = await getDashboardTopics(courseId);
    const selected = selectedTopicId
        ? topics.find((topic) => String(topic.topic_id) === String(selectedTopicId))
        : null;
    return {
        topic: selected || topics[0] || null,
        topics,
    };
}

export async function getVirtualSpaceDashboard(req, res) {
    try {
        await ensureGamificationTables();
        await ensureQuizActivityTables();
        await ensureIndividualActivityTables();
        const user = await getAuthenticatedUser(req, res);
        if (!user) return;
        const requestedTopicId = Number.parseInt(req.query?.topic_id, 10);
        const {topic: activeTopic, topics: dashboardTopics} = await getDashboardTopic(
            user.course_id,
            Number.isFinite(requestedTopicId) ? requestedTopicId : null
        );
        const activeTopicId = activeTopic?.topic_id || null;

        const [
            summaryResult,
            quizSummaryResult,
            individualSummaryResult,
            individualXpResult,
            individualLevelResult,
            leaderboardResult,
            quizLeaderboardResult,
            individualLeaderboardResult,
            activitiesResult,
            quizActivitiesResult,
            individualActivitiesResult,
        ] = await Promise.all([
            pool.query(
                `SELECT
                     COALESCE(SUM(gus.xp_earned), 0)::int AS total_group_xp,
                     COALESCE(SUM(ggs.xp_total), 0)::int AS total_shared_group_xp,
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
                   AND s.submitted_at IS NOT NULL
                   AND s.topic_id = $2`,
                [user.user_id, activeTopicId]
            ),
            pool.query(
                `SELECT COUNT(DISTINCT qs.quiz_session_id)::int AS completed_quizzes
                 FROM quiz_sessions qs
                 JOIN quiz_members qm
                  ON qm.quiz_session_id = qs.quiz_session_id
                 AND qm.user_id = $1
                 WHERE qs.status = 'saved'
                   AND qs.topic_id = $2`,
                [user.user_id, activeTopicId]
            ),
            pool.query(
                `SELECT COUNT(*)::int AS completed_individual_activities
                 FROM individual_activity_sessions
                 WHERE user_id = $1
                   AND status = 'completed'
                   AND topic_id = $2`,
                [user.user_id, activeTopicId]
            ),
            pool.query(
                `SELECT COALESCE(SUM(gus.xp_earned), 0)::int AS total_individual_exercise_xp
                 FROM gamification_user_scores gus
                 JOIN individual_activity_sessions ias
                   ON ias.session_id = gus.activity_id
                  AND ias.user_id = gus.user_id
                  AND ias.course_id = gus.course_id
                 WHERE gus.activity_type = 'individual_exercise'
                   AND gus.user_id = $1
                   AND gus.course_id = $2
                   AND ias.status = 'completed'
                   AND ias.topic_id = $3`,
                [user.user_id, user.course_id, activeTopicId]
            ),
            pool.query(
                `WITH total AS (
                     SELECT COALESCE(SUM(gus.xp_earned), 0)::int AS total_xp
                     FROM gamification_user_scores gus
                     JOIN individual_activity_sessions ias
                       ON ias.session_id = gus.activity_id
                      AND ias.user_id = gus.user_id
                      AND ias.course_id = gus.course_id
                     WHERE gus.activity_type = 'individual_exercise'
                       AND gus.user_id = $1
                       AND gus.course_id = $2
                       AND ias.status = 'completed'
                       AND ias.topic_id = $3
                 )
                 SELECT
                     gl.level_id,
                     gl.level_name,
                     gl.min_xp,
                     gl.max_xp,
                     gl.color_hex,
                     total.total_xp,
                     next_level.min_xp AS next_level_xp
                 FROM total
                 JOIN gamification_levels gl
                   ON total.total_xp >= gl.min_xp
                  AND (gl.max_xp IS NULL OR total.total_xp <= gl.max_xp)
                 LEFT JOIN gamification_levels next_level
                   ON next_level.level_id = gl.level_id + 1
                 ORDER BY gl.level_id DESC
                 LIMIT 1`,
                [user.user_id, user.course_id, activeTopicId]
            ),
            pool.query(
                `WITH student_scores AS (
                     SELECT
                         u.user_id,
                         u.name,
                         u.course_group_id,
                         a.avatar_public_path,
                         COALESCE(SUM(
                             CASE WHEN score_session.session_id IS NOT NULL THEN gus.xp_earned ELSE 0 END
                         ), 0)::int AS total_xp,
                         COUNT(DISTINCT score_session.session_id)::int AS activities_count
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
                      AND gus.activity_type = 'table_case_study'
                     LEFT JOIN table_group_sessions score_session
                       ON score_session.session_id = gus.activity_id
                      AND score_session.course_id = gus.course_id
                      AND score_session.topic_id = $2
                      AND score_session.submitted_at IS NOT NULL
                     WHERE u.course_id = $1
                       AND u.deleted_at IS NULL
                     GROUP BY u.user_id, u.name, u.course_group_id, a.avatar_public_path
                 )
                 SELECT
                     cg.course_group_id,
                     cg.group_name,
                     COALESCE(SUM(ss.total_xp), 0)::int AS total_group_xp,
                     COUNT(ss.user_id)::int AS students_count,
                     COALESCE(SUM(ss.activities_count), 0)::int AS activities_count,
                     COALESCE(
                         JSONB_AGG(
                             JSONB_BUILD_OBJECT(
                                 'user_id', ss.user_id,
                                 'name', ss.name,
                                 'avatar_public_path', ss.avatar_public_path,
                                 'total_xp', ss.total_xp,
                                 'activities_count', ss.activities_count
                             )
                             ORDER BY ss.total_xp DESC, ss.activities_count DESC, ss.name ASC
                         ) FILTER (WHERE ss.user_id IS NOT NULL),
                         '[]'::jsonb
                     ) AS students
                 FROM course_groups cg
                 LEFT JOIN student_scores ss
                   ON ss.course_group_id = cg.course_group_id
                 WHERE cg.course_id = $1
                   AND cg.deleted_at IS NULL
                   AND cg.gamification_enabled = TRUE
                 GROUP BY cg.course_group_id, cg.group_name
                 ORDER BY total_group_xp DESC, activities_count DESC, cg.group_name ASC`,
                [user.course_id, activeTopicId]
            ),
            pool.query(
                `SELECT
                     u.user_id,
                     u.name,
                     cg.group_name,
                     a.avatar_public_path,
                     COALESCE(quiz_scores.total_quiz_score, 0)::int AS total_quiz_score,
                     COALESCE(quiz_scores.quizzes_count, 0)::int AS quizzes_count
                 FROM users u
                 LEFT JOIN sessions latest_session
                   ON latest_session.user_id = u.user_id
                  AND latest_session.id = (
                      SELECT MAX(s2.id)
                      FROM sessions s2
                      WHERE s2.user_id = u.user_id
                  )
                 LEFT JOIN avatars a ON a.avatar_id = latest_session.avatar_id
                 LEFT JOIN LATERAL (
                     SELECT
                         COALESCE(SUM((score.value->>'total_score')::int), 0)::int AS total_quiz_score,
                         COUNT(DISTINCT qs.quiz_session_id)::int AS quizzes_count
                     FROM quiz_session_results qsr
                     JOIN quiz_sessions qs
                       ON qs.quiz_session_id = qsr.quiz_session_id
                     CROSS JOIN LATERAL jsonb_array_elements(
                         CASE
                             WHEN jsonb_typeof(qsr.results_json->'scoreboard') = 'array'
                             THEN qsr.results_json->'scoreboard'
                             ELSE '[]'::jsonb
                         END
                     ) AS score(value)
                     WHERE qs.course_id = $1
                       AND qs.status = 'saved'
                       AND qs.topic_id = $2
                       AND (score.value->>'user_id')::int = u.user_id
                 ) quiz_scores ON TRUE
                 JOIN course_groups cg
                   ON cg.course_group_id = u.course_group_id
                  AND cg.deleted_at IS NULL
                  AND cg.gamification_enabled = TRUE
                 WHERE u.course_id = $1
                   AND u.deleted_at IS NULL
                 ORDER BY total_quiz_score DESC, quizzes_count DESC, u.name ASC
                 LIMIT 10`,
                [user.course_id, activeTopicId]
            ),
            pool.query(
                `WITH individual_scores AS (
                     SELECT
                         u.user_id,
                         u.name,
                         cg.group_name,
                         a.avatar_public_path,
                         COALESCE(SUM(
                             CASE WHEN score_session.session_id IS NOT NULL THEN gus.xp_earned ELSE 0 END
                         ), 0)::int AS total_xp,
                         COUNT(DISTINCT score_session.session_id)::int AS activities_count
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
                      AND gus.activity_type = 'individual_exercise'
                     LEFT JOIN individual_activity_sessions score_session
                       ON score_session.session_id = gus.activity_id
                      AND score_session.user_id = gus.user_id
                      AND score_session.course_id = gus.course_id
                      AND score_session.status = 'completed'
                      AND score_session.topic_id = $2
                     JOIN course_groups cg
                       ON cg.course_group_id = u.course_group_id
                      AND cg.deleted_at IS NULL
                      AND cg.gamification_enabled = TRUE
                     WHERE u.course_id = $1
                       AND u.deleted_at IS NULL
                     GROUP BY u.user_id, u.name, cg.group_name, a.avatar_public_path
                 )
                 SELECT
                     individual_scores.user_id,
                     individual_scores.name,
                     individual_scores.group_name,
                     individual_scores.avatar_public_path,
                     individual_scores.total_xp,
                     individual_scores.activities_count,
                     gl.level_id,
                     gl.level_name,
                     gl.color_hex
                 FROM individual_scores
                 JOIN gamification_levels gl
                   ON individual_scores.total_xp >= gl.min_xp
                  AND (gl.max_xp IS NULL OR individual_scores.total_xp <= gl.max_xp)
                 ORDER BY individual_scores.total_xp DESC,
                          individual_scores.activities_count DESC,
                          individual_scores.name ASC
                 LIMIT 10`,
                [user.course_id, activeTopicId]
            ),
            pool.query(
                `SELECT
                     s.session_id,
                     CONCAT('table-', s.session_id) AS activity_key,
                     'table_case_study' AS activity_type,
                     s.group_id,
                     s.topic_id,
                     t.topic_name,
                     COALESCE(tc.case_title, s.case_title) AS case_title,
                     s.created_at,
                     s.work_started_at,
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
                   AND s.topic_id = $2
                 GROUP BY
                     s.session_id,
                     s.group_id,
                     s.topic_id,
                     t.topic_name,
                     tc.case_title,
                     s.case_title,
                     s.created_at,
                     s.work_started_at,
                     s.submitted_at,
                     s.feedback_status,
                     ggs.xp_total,
                     gus.xp_earned
                 ORDER BY s.submitted_at DESC
                `,
                [user.user_id, activeTopicId]
            ),
            pool.query(
                `SELECT
                     qs.quiz_session_id AS session_id,
                     CONCAT('quiz-', qs.quiz_session_id) AS activity_key,
                     'quiz' AS activity_type,
                     qs.group_id,
                     qs.topic_id,
                     t.topic_name,
                     CONCAT('Quiz: ', COALESCE(t.topic_name, 'Topic')) AS case_title,
                     qs.created_at,
                     qs.saved_at AS submitted_at,
                     'ready' AS feedback_status,
                     0::int AS group_xp,
                     0::int AS my_xp,
                     COALESCE(
                         (
                             SELECT (score.value->>'total_score')::int
                             FROM jsonb_array_elements(
                                 CASE
                                     WHEN jsonb_typeof(qsr.results_json->'scoreboard') = 'array'
                                     THEN qsr.results_json->'scoreboard'
                                     ELSE '[]'::jsonb
                                 END
                             ) AS score(value)
                             WHERE (score.value->>'user_id')::int = $1
                             LIMIT 1
                         ),
                         (
                             SELECT COALESCE(SUM(qa.score), 0)::int
                             FROM quiz_answers qa
                             WHERE qa.quiz_session_id = qs.quiz_session_id
                               AND qa.user_id = $1
                         ),
                         0
                     )::int AS quiz_points,
                     qsr.results_json,
                     ARRAY_REMOVE(ARRAY_AGG(DISTINCT u.name), NULL) AS member_names
                 FROM quiz_sessions qs
                 JOIN quiz_members qm_self
                   ON qm_self.quiz_session_id = qs.quiz_session_id
                  AND qm_self.user_id = $1
                 LEFT JOIN quiz_members qm_all ON qm_all.quiz_session_id = qs.quiz_session_id
                 LEFT JOIN users u ON u.user_id = qm_all.user_id
                 LEFT JOIN topics t ON t.topic_id = qs.topic_id
                 LEFT JOIN quiz_session_results qsr ON qsr.quiz_session_id = qs.quiz_session_id
                 WHERE qs.status = 'saved'
                   AND qs.topic_id = $2
                 GROUP BY
                     qs.quiz_session_id,
                     qs.group_id,
                     qs.topic_id,
                     t.topic_name,
                     qs.created_at,
                     qs.saved_at,
                     qsr.results_json
                 ORDER BY qs.saved_at DESC
                `,
                [user.user_id, activeTopicId]
            ),
            pool.query(
                `SELECT
                     ias.session_id,
                     CONCAT('individual-', ias.session_id) AS activity_key,
                     'individual' AS activity_type,
                     ias.activity_type AS individual_activity_type,
                     ias.question_kind,
                     ias.object_id,
                     ias.topic_id,
                     t.topic_name,
                     CASE
                         WHEN ias.activity_type = 'pre_test' THEN 'Pre-test'
                         WHEN ias.activity_type = 'post_test' THEN 'Post-test'
                         WHEN ias.question_kind = 'case_study' THEN 'Individual Case Study'
                         ELSE 'Individual Exercise'
                     END AS activity_name,
                     CASE
                         WHEN ias.activity_type = 'pre_test' THEN CONCAT('Pre-test: ', COALESCE(t.topic_name, 'Topic'))
                         WHEN ias.activity_type = 'post_test' THEN CONCAT('Post-test: ', COALESCE(t.topic_name, 'Topic'))
                         WHEN ias.question_kind = 'case_study' THEN CONCAT('Case Study: ', COALESCE(t.topic_name, 'Topic'))
                         ELSE CONCAT('Exercise: ', COALESCE(t.topic_name, 'Topic'))
                     END AS case_title,
                     ias.started_at AS created_at,
                     ias.completed_at AS submitted_at,
                     'ready' AS feedback_status,
                     0::int AS group_xp,
                     COALESCE(gus.xp_earned, ias.xp_total, 0)::int AS my_xp,
                     ias.correct_count,
                     ias.score_total,
                     ias.xp_total,
                     ias.seconds_spent,
                     ias.seconds_left
                 FROM individual_activity_sessions ias
                 LEFT JOIN topics t ON t.topic_id = ias.topic_id
                 LEFT JOIN gamification_user_scores gus
                   ON gus.activity_type = 'individual_exercise'
                  AND gus.activity_id = ias.session_id
                  AND gus.user_id = ias.user_id
                 WHERE ias.user_id = $1
                   AND ias.course_id = $2
                   AND ias.status = 'completed'
                   AND ias.topic_id = $3
                 ORDER BY ias.completed_at DESC
                `,
                [user.user_id, user.course_id, activeTopicId]
            ),
        ]);

        const groupActivities = activitiesResult.rows.map((activity) => ({
            ...activity,
            activity_name: `Group ${activity.group_id} Activity`,
        }));
        const quizActivities = quizActivitiesResult.rows.map((activity) => ({
            ...activity,
            activity_name: "Big Table Quiz",
            ...buildQuizCardOutcome(activity, user),
        }));
        const individualActivities = individualActivitiesResult.rows;

        const hud = summaryResult.rows[0] || {
            total_group_xp: 0,
            total_individual_xp: 0,
            completed_activities: 0,
        };
        hud.completed_activities += quizSummaryResult.rows[0]?.completed_quizzes || 0;
        hud.completed_activities += individualSummaryResult.rows[0]?.completed_individual_activities || 0;
        hud.total_individual_exercise_xp = individualXpResult.rows[0]?.total_individual_exercise_xp || 0;
        const level = individualLevelResult.rows[0] || {
            level_id: 1,
            level_name: "Rookie",
            min_xp: 0,
            max_xp: 99,
            color_hex: "#6B7280",
            total_xp: 0,
            next_level_xp: 100,
        };
        const nextLevelXp = level.next_level_xp === null || level.next_level_xp === undefined
            ? null
            : Number(level.next_level_xp);
        const levelMinXp = Number(level.min_xp || 0);
        const levelTotalXp = Number(level.total_xp || hud.total_individual_exercise_xp || 0);
        const progressToNext = nextLevelXp === null
            ? 100
            : Math.max(0, Math.min(100, Math.round(((levelTotalXp - levelMinXp) / (nextLevelXp - levelMinXp)) * 100)));
        hud.individual_level = {
            level: Number(level.level_id),
            name: level.level_name,
            color: level.color_hex,
            min_xp: levelMinXp,
            max_xp: level.max_xp,
            total_xp: levelTotalXp,
            next_level_xp: nextLevelXp,
            progress_to_next_level: progressToNext,
        };

        res.json({
            user: {
                user_id: user.user_id,
                name: user.name,
                avatar_public_path: avatarPath(user.avatar_public_path),
                gamification_enabled: !!user.gamification_enabled,
                use_no_virtual_space: !!user.use_no_virtual_space,
            },
            active_topic: activeTopic ? {
                topic_id: activeTopic.topic_id,
                topic_name: activeTopic.topic_name,
                week: activeTopic.week,
                is_active: !!activeTopic.is_active,
            } : null,
            dashboard_topics: dashboardTopics,
            hud,
            leaderboard: leaderboardResult.rows,
            quiz_leaderboard: quizLeaderboardResult.rows,
            individual_leaderboard: individualLeaderboardResult.rows,
            activities: [...individualActivities, ...groupActivities, ...quizActivities]
                .sort((a, b) => new Date(b.submitted_at || 0) - new Date(a.submitted_at || 0))
                .slice(0, 12),
            individual_activities: individualActivities,
            group_activities: groupActivities,
            quiz_activities: quizActivities,
        });
    } catch (error) {
        console.error("Virtual space dashboard error:", error);
        res.status(500).json({message: "Gagal memuat dashboard virtual space"});
    }
}

export async function getVirtualSpaceActivityDetail(req, res) {
    try {
        await ensureGamificationTables();
        await ensureQuizActivityTables();
        await ensureIndividualActivityTables();
        const user = await getAuthenticatedUser(req, res);
        if (!user) return;

        const rawSessionId = String(req.params.sessionId || "");
        const isQuizActivity = rawSessionId.startsWith("quiz-");
        const isIndividualActivity = rawSessionId.startsWith("individual-");
        const sessionId = Number.parseInt(rawSessionId.replace(/^individual-/, "").replace(/^quiz-/, "").replace(/^table-/, ""), 10);
        if (!Number.isFinite(sessionId)) {
            return res.status(400).json({message: "Activity tidak valid"});
        }

        if (isIndividualActivity) {
            const [sessionResult, questionsResult, answersResult] = await Promise.all([
                pool.query(
                    `SELECT
                         ias.*,
                         t.topic_name
                     FROM individual_activity_sessions ias
                     LEFT JOIN topics t ON t.topic_id = ias.topic_id
                     WHERE ias.session_id = $1
                       AND ias.user_id = $2
                       AND ias.course_id = $3
                       AND ias.status = 'completed'
                     LIMIT 1`,
                    [sessionId, user.user_id, user.course_id]
                ),
                pool.query(
                    `SELECT *
                     FROM individual_questions
                     WHERE question_id = ANY(
                         COALESCE(
                             (SELECT question_ids FROM individual_activity_sessions WHERE session_id = $1),
                             '{}'::int[]
                         )
                     )`,
                    [sessionId]
                ),
                pool.query(
                    `SELECT
                         a.*,
                         q.question_text,
                         q.choices,
                         q.correct_answer_index,
                         q.explanation,
                         q.case_title,
                         q.case_prompt
                     FROM individual_activity_answers a
                     JOIN individual_questions q ON q.question_id = a.question_id
                     WHERE a.session_id = $1
                     ORDER BY a.answered_at ASC`,
                    [sessionId]
                ),
            ]);

            const session = sessionResult.rows[0];
            if (!session) return res.status(404).json({message: "Activity tidak ditemukan"});
            const orderMap = new Map((session.question_ids || []).map((questionId, index) => [Number(questionId), index]));
            const questions = questionsResult.rows.sort((a, b) =>
                orderMap.get(Number(a.question_id)) - orderMap.get(Number(b.question_id))
            );
            const revealCorrectAnswer = session.activity_type === "exercise";
            const primaryQuestion = questions[0] || {};

            return res.json({
                activity: {
                    session_id: `individual-${session.session_id}`,
                    activity_type: "individual",
                    individual_activity_type: session.activity_type,
                    question_kind: session.question_kind,
                    activity_name: labelIndividualActivity(session.activity_type, session.question_kind),
                    group_id: null,
                    topic_name: session.topic_name,
                    case_title: session.question_kind === "case_study"
                        ? (primaryQuestion.case_title || `Case Study: ${session.topic_name || "Topic"}`)
                        : `${labelIndividualActivity(session.activity_type, session.question_kind)}: ${session.topic_name || "Topic"}`,
                    case_prompt: session.question_kind === "case_study"
                        ? (primaryQuestion.case_prompt || "")
                        : "Saved individual multiple-choice activity.",
                    submitted_at: session.completed_at,
                    created_at: session.started_at,
                    seconds_spent: session.seconds_spent || 0,
                    seconds_left: session.seconds_left || 0,
                    group_xp: 0,
                    group_xp_reason: "",
                    members: [{
                        user_id: user.user_id,
                        name: user.name,
                        avatar_public_path: avatarPath(user.avatar_public_path),
                        xp_earned: session.xp_total || 0,
                        xp_reason: session.result_json?.case_feedback?.xp_reason || "",
                    }],
                    questions: questions.map((question) => sanitizeIndividualQuestion(question, revealCorrectAnswer)),
                    answers: answersResult.rows.map((answer) => sanitizeIndividualAnswer(answer, revealCorrectAnswer)),
                    results: session.result_json || null,
                    feedback: session.feedback_json || null,
                    feedback_status: session.feedback_status,
                    feedback_error: session.feedback_error,
                    feedback_model: session.feedback_model,
                    feedback_groups: [],
                    logs: [],
                },
            });
        }

        if (isQuizActivity) {
            const accessResult = await pool.query(
                `SELECT 1
                 FROM quiz_members
                 WHERE quiz_session_id = $1
                   AND user_id = $2
                 LIMIT 1`,
                [sessionId, user.user_id]
            );
            if (!accessResult.rows[0]) {
                return res.status(403).json({message: "Activity tidak tersedia untuk user ini"});
            }

            const [sessionResult, membersResult, resultDataResult] = await Promise.all([
                pool.query(
                    `SELECT
                         qs.*,
                         t.topic_name
                     FROM quiz_sessions qs
                     LEFT JOIN topics t ON t.topic_id = qs.topic_id
                     WHERE qs.quiz_session_id = $1
                     LIMIT 1`,
                    [sessionId]
                ),
                pool.query(
                    `SELECT
                         qm.user_id,
                         u.name,
                         qm.avatar_public_path,
                         qm.joined_at,
                         0::int AS xp_earned,
                         '' AS xp_reason
                     FROM quiz_members qm
                     JOIN users u ON u.user_id = qm.user_id
                     WHERE qm.quiz_session_id = $1
                     ORDER BY qm.joined_at ASC`,
                    [sessionId]
                ),
                pool.query(
                    `SELECT questions_json, answers_json, results_json, created_at
                     FROM quiz_session_results
                     WHERE quiz_session_id = $1
                     LIMIT 1`,
                    [sessionId]
                ),
            ]);

            const session = sessionResult.rows[0];
            if (!session) return res.status(404).json({message: "Activity tidak ditemukan"});
            const resultData = resultDataResult.rows[0];

            return res.json({
                activity: {
                    session_id: `quiz-${session.quiz_session_id}`,
                    activity_type: "quiz",
                    activity_name: "Big Table Quiz",
                    group_id: session.group_id || session.table_id,
                    topic_name: session.topic_name,
                    case_title: `Quiz: ${session.topic_name || "Topic"}`,
                    case_prompt: "Saved big table quiz result.",
                    submitted_at: session.saved_at,
                    created_at: session.created_at,
                    group_xp: 0,
                    group_xp_reason: "",
                    members: membersResult.rows,
                    questions: resultData?.questions_json || [],
                    answers: resultData?.answers_json || [],
                    results: resultData?.results_json || null,
                    wrong_answer_feedback_error: resultData?.results_json?.wrong_answer_feedback_error || null,
                    feedback_groups: [],
                    logs: [],
                },
            });
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

        const memberMap = new Map(membersResult.rows.map((member) => [Number(member.user_id), member]));
        const feedbackGroups = feedbackResult.rows.map((group) => ({
            ...group,
            students: (group.student_ids || [])
                .map((studentId) => memberMap.get(Number(studentId)))
                .filter(Boolean)
                .map((member) => ({
                    user_id: member.user_id,
                    name: member.name,
                    avatar_public_path: member.avatar_public_path,
                })),
        }));

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
                feedback_status: session.feedback_status,
                feedback_error: session.feedback_error,
                group_xp: groupScoreResult.rows[0]?.xp_total || 0,
                group_xp_reason: groupScoreResult.rows[0]?.reason || "",
                members: membersResult.rows,
                answers: answersResult.rows,
                feedback_groups: feedbackGroups,
                logs: logsResult.rows,
            },
        });
    } catch (error) {
        console.error("Virtual space activity detail error:", error);
        res.status(500).json({message: "Gagal memuat detail activity"});
    }
}
