import {pool} from "../db/index.js";
import {findSession} from "../models/sessionModel.js";
import {findAdminById, ensureAdminTables} from "../models/adminModel.js";
import {findUserById} from "../models/userModel.js";
import {ensureIndividualActivityTables} from "../models/individualActivityModel.js";
import {ensureQuizActivityTables} from "../models/quizActivityModel.js";
import {ensureTableActivityTables} from "../models/tableActivityModel.js";
import {ensureGamificationTables} from "../models/gamificationModel.js";
import {INSTRUCTOR_ROLE_ID, STUDENT_ROLE_ID} from "../models/roleModel.js";

async function getAuthenticatedInstructor(req, res) {
    await ensureAdminTables();

    const adminId = req.session?.admin_useradmin_id;
    if (adminId) {
        const admin = await findAdminById(adminId);
        if (!admin || admin.is_disabled) {
            res.status(401).json({message: "Silakan login instructor terlebih dahulu"});
            return null;
        }

        if (admin.role === "admin") {
            return {
                admin,
                user_id: admin.user_id,
                name: admin.username,
                role_name: "admin",
                is_admin: true,
                course_id: null,
            };
        }

        if (!admin.user_id) {
            res.status(403).json({message: "Akun instructor belum terhubung dengan data user."});
            return null;
        }

        const linkedUser = await findUserById(admin.user_id);
        if (!linkedUser || String(linkedUser.role_id) !== String(INSTRUCTOR_ROLE_ID)) {
            res.status(403).json({message: "Dashboard hanya tersedia untuk instructor"});
            return null;
        }

        return {
            ...linkedUser,
            admin,
            is_admin: false,
        };
    }

    const sessionId = req.session?.session_id;
    if (!sessionId) {
        res.status(401).json({message: "Silakan login instructor terlebih dahulu"});
        return null;
    }

    const user = await findSession(sessionId);
    if (!user) {
        res.status(401).json({message: "Sesi tidak aktif"});
        return null;
    }
    if (String(user.role_id) !== String(INSTRUCTOR_ROLE_ID)) {
        res.status(403).json({message: "Dashboard hanya tersedia untuk instructor"});
        return null;
    }
    return user;
}

function activityLabel(activity) {
    if (!activity) return "Idle";
    if (activity.type === "table") return "Group Case";
    if (activity.type === "quiz") return "Quiz";
    if (activity.type === "individual") {
        if (activity.activity_type === "pre_test") return "Pre-test";
        if (activity.activity_type === "post_test") return "Post-test";
        return activity.question_kind === "case_study" ? "Individual Case" : "Individual Exercise";
    }
    if (activity.label) return activity.label;
    return "Activity";
}

function mapPresence(req, courseId) {
    const presenceStore = req.app.get("presenceStore");
    const liveUsers = presenceStore?.getCourseUsers?.(courseId) || [];
    const byUserId = new Map();

    for (const liveUser of liveUsers) {
        if (!liveUser?.user_id) continue;
        byUserId.set(String(liveUser.user_id), {
            user_id: liveUser.user_id,
            room: liveUser.room || null,
            x: liveUser.x ?? null,
            y: liveUser.y ?? null,
            activity_status: liveUser.activity_status || null,
        });
    }

    return byUserId;
}

function firstActivity(existing, next) {
    if (existing?.type === "table") return existing;
    if (next?.type === "table") return next;
    if (existing?.type === "quiz") return existing;
    if (next?.type === "quiz") return next;
    return existing || next || null;
}

function toNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function makeGroupKey(courseId, groupId) {
    return `${courseId || "course"}:${groupId || "ungrouped"}`;
}

function makeTopicGroupKey(topicId, courseGroupId) {
    return `${topicId || "topic"}:${courseGroupId || "ungrouped"}`;
}

function makeEmptyActivityCounts() {
    return {
        total: 0,
        individual: 0,
        pre_test: 0,
        post_test: 0,
        group: 0,
        quiz: 0,
    };
}

function incrementActivityCount(target, type) {
    target.total += 1;
    if (type === "pre_test") target.pre_test += 1;
    else if (type === "post_test") target.post_test += 1;
    else if (type === "group") target.group += 1;
    else if (type === "quiz") target.quiz += 1;
    else target.individual += 1;
}

function average(values) {
    const usable = values
        .filter((value) => value !== null && value !== undefined && value !== "")
        .map((value) => Number(value))
        .filter(Number.isFinite);
    if (!usable.length) return 0;
    return Math.round(usable.reduce((total, value) => total + value, 0) / usable.length);
}

function normalizeActivityType(row) {
    if (row.kind === "group") return "group";
    if (row.kind === "quiz") return "quiz";
    if (row.activity_type === "pre_test") return "pre_test";
    if (row.activity_type === "post_test") return "post_test";
    return "individual";
}

function activityTypeLabel(type, questionKind = "") {
    if (type === "pre_test") return "Pre-test";
    if (type === "post_test") return "Post-test";
    if (type === "group") return "Group Activity";
    if (type === "quiz") return "Quiz";
    return questionKind === "case_study" ? "Individual Case" : "Individual";
}

export async function getInstructorDashboard(req, res) {
    try {
        await Promise.all([
            ensureTableActivityTables(),
            ensureQuizActivityTables(),
            ensureIndividualActivityTables(),
            ensureGamificationTables(),
        ]);

        const instructor = await getAuthenticatedInstructor(req, res);
        if (!instructor) return;

        const managedCoursesResult = await pool.query(
            `SELECT
                 c.course_id,
                 c.course_code,
                 c.course_name,
                 c.semester,
                 c.location,
                 c.instructor_id,
                 c.instructor2_id,
                 u1.name AS instructor_name,
                 u2.name AS instructor2_name
             FROM courses c
             LEFT JOIN users u1 ON u1.user_id = c.instructor_id
             LEFT JOIN users u2 ON u2.user_id = c.instructor2_id
             WHERE c.deleted_at IS NULL
               AND (
                   $1::boolean = TRUE
                   OR c.instructor_id = $2
                   OR c.instructor2_id = $2
                   OR ($3::int IS NOT NULL AND c.course_id = $3)
               )
             ORDER BY c.course_name ASC`,
            [!!instructor.is_admin, instructor.user_id || null, instructor.course_id || null]
        );

        const managedCourses = managedCoursesResult.rows;
        const courseIds = managedCourses.map((course) => Number(course.course_id)).filter(Number.isFinite);

        if (courseIds.length === 0) {
            return res.json({
                course: null,
                courses: [],
                instructor: {
                    user_id: instructor.user_id,
                    name: instructor.name,
                    role_name: instructor.role_name,
                },
                generated_at: new Date().toISOString(),
                summary: {
                    managed_courses: 0,
                    total_topics: 0,
                    total_groups: 0,
                    total_students: 0,
                    total_activities: 0,
                    total_group_xp: 0,
                    total_individual_xp: 0,
                    average_score_improvement: 0,
                },
                groups: [],
                students: [],
                active_sessions: {table: [], quiz: [], individual: []},
            });
        }

        const courseId = instructor.course_id && courseIds.includes(Number(instructor.course_id))
            ? instructor.course_id
            : courseIds[0];
        const presenceByUserId = mapPresence(req, courseId);

        const [
            courseResult,
            topicsResult,
            groupsResult,
            studentsResult,
            tableSessionsResult,
            quizSessionsResult,
            individualSessionsResult,
            totalsResult,
        ] = await Promise.all([
            pool.query(
                `SELECT course_id, course_code, course_name
                 FROM courses
                 WHERE course_id = $1
                   AND deleted_at IS NULL
                 LIMIT 1`,
                [courseId]
            ),
            pool.query(
                `SELECT topic_id, course_id, topic_name, week, COALESCE(show_topic, TRUE) AS show_topic
                 FROM topics
                 WHERE course_id = ANY($1::int[])
                   AND deleted_at IS NULL
                 ORDER BY course_id ASC, week ASC NULLS LAST, topic_name ASC`,
                [courseIds]
            ),
            pool.query(
                `SELECT
                     cg.course_group_id,
                     cg.course_id,
                     cg.group_name,
                     cg.gamification_enabled,
                     cg.virtual_space_enabled,
                     COUNT(u.user_id) FILTER (WHERE u.role_id = $2 AND u.deleted_at IS NULL)::int AS student_count
                 FROM course_groups cg
                 LEFT JOIN users u
                   ON u.course_group_id = cg.course_group_id
                  AND u.course_id = cg.course_id
                 WHERE cg.course_id = ANY($1::int[])
                   AND cg.deleted_at IS NULL
                 GROUP BY cg.course_group_id, cg.course_id, cg.group_name, cg.gamification_enabled, cg.virtual_space_enabled
                 ORDER BY cg.course_id ASC, cg.group_name ASC`,
                [courseIds, STUDENT_ROLE_ID]
            ),
            pool.query(
                `SELECT
                     u.user_id,
                     u.name,
                     u.email,
                     u.course_id,
                     u.course_group_id,
                     cg.group_name AS course_group_name,
                     cg.virtual_space_enabled,
                     a.avatar_public_path,
                     latest_session.created_at AS last_login_at
                 FROM users u
                 LEFT JOIN course_groups cg
                   ON cg.course_group_id = u.course_group_id
                  AND cg.deleted_at IS NULL
                 LEFT JOIN LATERAL (
                     SELECT s.avatar_id, s.created_at
                     FROM sessions s
                     WHERE s.user_id = u.user_id
                     ORDER BY s.created_at DESC
                     LIMIT 1
                 ) latest_session ON TRUE
                 LEFT JOIN avatars a ON a.avatar_id = latest_session.avatar_id
                 WHERE u.course_id = ANY($1::int[])
                   AND u.role_id = $2
                   AND u.deleted_at IS NULL
                 ORDER BY u.course_id ASC, cg.group_name ASC NULLS LAST, u.name ASC`,
                [courseIds, STUDENT_ROLE_ID]
            ),
            pool.query(
                `SELECT
                     s.session_id,
                     s.group_id,
                     s.topic_id,
                     t.topic_name,
                     COALESCE(tc.case_title, s.case_title) AS case_title,
                     s.feedback_status,
                     s.created_at,
                     JSONB_AGG(
                         DISTINCT JSONB_BUILD_OBJECT(
                             'user_id', u.user_id,
                             'name', u.name,
                             'course_group_id', u.course_group_id,
                             'course_group_name', cg.group_name
                         )
                     ) FILTER (WHERE u.user_id IS NOT NULL) AS members
                 FROM table_group_sessions s
                 LEFT JOIN topics t ON t.topic_id = s.topic_id
                 LEFT JOIN topic_cases tc ON tc.case_id = s.case_id
                 LEFT JOIN table_group_members m
                   ON m.session_id = s.session_id
                  AND m.is_active = TRUE
                 LEFT JOIN users u
                   ON u.user_id = m.user_id
                  AND u.deleted_at IS NULL
                 LEFT JOIN course_groups cg ON cg.course_group_id = u.course_group_id
                 WHERE s.course_id = $1
                   AND s.is_active = TRUE
                   AND s.submitted_at IS NULL
                 GROUP BY s.session_id, s.group_id, s.topic_id, t.topic_name, tc.case_title, s.case_title, s.feedback_status, s.created_at
                 ORDER BY s.created_at DESC`,
                [courseId]
            ),
            pool.query(
                `SELECT
                     qs.quiz_session_id,
                     qs.group_id,
                     qs.table_id,
                     qs.object_id,
                     qs.topic_id,
                     qs.status,
                     qs.current_question_index,
                     qs.question_ids,
                     qs.created_at,
                     t.topic_name,
                     JSONB_AGG(
                         DISTINCT JSONB_BUILD_OBJECT(
                             'user_id', u.user_id,
                             'name', u.name,
                             'course_group_id', u.course_group_id,
                             'course_group_name', cg.group_name
                         )
                     ) FILTER (WHERE u.user_id IS NOT NULL) AS members
                 FROM quiz_sessions qs
                 LEFT JOIN topics t ON t.topic_id = qs.topic_id
                 LEFT JOIN quiz_members qm
                   ON qm.quiz_session_id = qs.quiz_session_id
                  AND qm.is_active = TRUE
                 LEFT JOIN users u
                   ON u.user_id = qm.user_id
                  AND u.deleted_at IS NULL
                 LEFT JOIN course_groups cg ON cg.course_group_id = u.course_group_id
                 WHERE qs.course_id = $1
                   AND qs.status IN ('lobby', 'in_progress', 'completed')
                 GROUP BY qs.quiz_session_id, qs.group_id, qs.table_id, qs.object_id, qs.topic_id, qs.status, qs.current_question_index, qs.question_ids, qs.created_at, t.topic_name
                 ORDER BY qs.created_at DESC`,
                [courseId]
            ),
            pool.query(
                `SELECT
                     ias.session_id,
                     ias.topic_id,
                     ias.user_id,
                     ias.object_id,
                     ias.activity_type,
                     ias.question_kind,
                     ias.current_question_index,
                     ias.question_ids,
                     ias.started_at,
                     ias.updated_at,
                     t.topic_name,
                     u.name,
                     u.course_group_id,
                     cg.group_name AS course_group_name
                 FROM individual_activity_sessions ias
                 JOIN users u
                   ON u.user_id = ias.user_id
                  AND u.deleted_at IS NULL
                 LEFT JOIN course_groups cg ON cg.course_group_id = u.course_group_id
                 LEFT JOIN topics t ON t.topic_id = ias.topic_id
                 WHERE ias.course_id = $1
                   AND ias.status = 'in_progress'
                 ORDER BY ias.started_at DESC`,
                [courseId]
            ),
            pool.query(
                `SELECT
                     (SELECT COUNT(*)::int FROM table_group_sessions WHERE course_id = ANY($1::int[]) AND submitted_at IS NOT NULL) AS completed_group_cases,
                     (SELECT COUNT(*)::int FROM quiz_sessions WHERE course_id = ANY($1::int[]) AND status = 'saved') AS completed_quizzes,
                     (SELECT COUNT(*)::int FROM individual_activity_sessions WHERE course_id = ANY($1::int[]) AND status = 'completed') AS completed_individual`
                ,
                [courseIds]
            ),
        ]);

        const activityByUserId = new Map();
        const activeTableSessions = tableSessionsResult.rows.map((session) => {
            const members = session.members || [];
            const activity = {
                type: "table",
                label: "Group Case",
                session_id: session.session_id,
                topic_name: session.topic_name,
                detail: session.case_title || "Group case study",
                status: session.feedback_status || "working",
                started_at: session.created_at,
            };
            members.forEach((member) => {
                activityByUserId.set(String(member.user_id), firstActivity(activityByUserId.get(String(member.user_id)), activity));
            });
            return {...session, members};
        });

        const activeQuizSessions = quizSessionsResult.rows.map((session) => {
            const members = session.members || [];
            const totalQuestions = Array.isArray(session.question_ids) ? session.question_ids.length : 0;
            const activity = {
                type: "quiz",
                label: "Quiz",
                session_id: session.quiz_session_id,
                topic_name: session.topic_name,
                detail: totalQuestions > 0 ? `Question ${Math.min(session.current_question_index + 1, totalQuestions)} of ${totalQuestions}` : session.status,
                status: session.status,
                started_at: session.created_at,
            };
            members.forEach((member) => {
                activityByUserId.set(String(member.user_id), firstActivity(activityByUserId.get(String(member.user_id)), activity));
            });
            return {...session, members, total_questions: totalQuestions};
        });

        const activeIndividualSessions = individualSessionsResult.rows.map((session) => {
            const totalQuestions = Array.isArray(session.question_ids) ? session.question_ids.length : 0;
            const activity = {
                type: "individual",
                label: activityLabel({type: "individual", activity_type: session.activity_type, question_kind: session.question_kind}),
                session_id: session.session_id,
                topic_name: session.topic_name,
                detail: totalQuestions > 0 ? `Question ${Math.min(session.current_question_index + 1, totalQuestions)} of ${totalQuestions}` : "Working",
                status: "in_progress",
                activity_type: session.activity_type,
                question_kind: session.question_kind,
                started_at: session.started_at,
            };
            activityByUserId.set(String(session.user_id), firstActivity(activityByUserId.get(String(session.user_id)), activity));
            return {...session, total_questions: totalQuestions};
        });

        for (const [userId, presence] of presenceByUserId.entries()) {
            if (!presence.activity_status) continue;
            const activity = {
                type: presence.activity_status.type,
                label: presence.activity_status.label,
                topic_name: null,
                detail: presence.activity_status.object_name || presence.activity_status.table_id || "",
                status: "live",
                started_at: presence.activity_status.started_at,
            };
            activityByUserId.set(userId, firstActivity(activityByUserId.get(userId), activity));
        }

        const students = studentsResult.rows.map((student) => {
            const presence = presenceByUserId.get(String(student.user_id));
            const activity = activityByUserId.get(String(student.user_id)) || null;
            const isOnline = !!presence;
            const isActive = !!activity;
            return {
                ...student,
                online: isOnline,
                room: presence?.room || null,
                position: presence ? {x: presence.x, y: presence.y} : null,
                activity,
                activity_label: activityLabel(activity),
                status: isActive ? "active" : isOnline ? "idle" : "offline",
            };
        });
        const monitorStudents = students.filter((student) => String(student.course_id) === String(courseId));

        const groups = groupsResult.rows.map((group) => {
            const groupStudents = students.filter((student) =>
                String(student.course_id) === String(group.course_id)
                && String(student.course_group_id) === String(group.course_group_id)
            );
            return {
                ...group,
                online_count: groupStudents.filter((student) => student.online).length,
                active_count: groupStudents.filter((student) => student.status === "active").length,
                idle_count: groupStudents.filter((student) => student.status === "idle").length,
                offline_count: groupStudents.filter((student) => student.status === "offline").length,
                active_sessions_count: [
                    ...activeTableSessions,
                    ...activeQuizSessions,
                    ...activeIndividualSessions,
                ].filter((session) => {
                    if (session.course_group_id && String(session.course_group_id) === String(group.course_group_id)) return true;
                    return (session.members || []).some((member) => String(member.course_group_id) === String(group.course_group_id));
                }).length,
            };
        });
        const monitorGroups = groups.filter((group) => String(group.course_id) === String(courseId));

        const monitorSummary = {
            total_students: monitorStudents.length,
            online_students: monitorStudents.filter((student) => student.online).length,
            active_students: monitorStudents.filter((student) => student.status === "active").length,
            idle_students: monitorStudents.filter((student) => student.status === "idle").length,
            offline_students: monitorStudents.filter((student) => student.status === "offline").length,
            active_table_sessions: activeTableSessions.length,
            active_quiz_sessions: activeQuizSessions.length,
            active_individual_sessions: activeIndividualSessions.length,
            active_sessions: activeTableSessions.length + activeQuizSessions.length + activeIndividualSessions.length,
            completed_group_cases: totalsResult.rows[0]?.completed_group_cases || 0,
            completed_quizzes: totalsResult.rows[0]?.completed_quizzes || 0,
            completed_individual: totalsResult.rows[0]?.completed_individual || 0,
        };
        const summary = {...monitorSummary};

        const [
            individualHistoryResult,
            groupHistoryResult,
            groupXpContributionResult,
            quizHistoryResult,
            studentXpTotalsResult,
            levelsResult,
        ] = await Promise.all([
            pool.query(
                `SELECT
                     ias.session_id,
                     ias.course_id,
                     ias.topic_id,
                     t.topic_name,
                     ias.user_id,
                     u.name AS student_name,
                     u.course_group_id,
                     cg.group_name,
                     ias.activity_type,
                     ias.question_kind,
                     ias.correct_count,
                     ias.score_total,
                     ias.xp_total,
                     COALESCE(gus.xp_earned, ias.xp_total, 0)::int AS xp_earned,
                     gus.reason AS xp_reason,
                     ias.started_at,
                     ias.completed_at
                 FROM individual_activity_sessions ias
                 JOIN users u
                   ON u.user_id = ias.user_id
                  AND u.deleted_at IS NULL
                 LEFT JOIN topics t ON t.topic_id = ias.topic_id
                 LEFT JOIN course_groups cg
                   ON cg.course_group_id = u.course_group_id
                  AND cg.deleted_at IS NULL
                 LEFT JOIN gamification_user_scores gus
                   ON gus.activity_type = 'individual_exercise'
                  AND gus.activity_id = ias.session_id
                  AND gus.user_id = ias.user_id
                 WHERE ias.course_id = ANY($1::int[])
                   AND ias.status = 'completed'
                 ORDER BY ias.completed_at DESC NULLS LAST`,
                [courseIds]
            ),
            pool.query(
                `SELECT
                     s.session_id,
                     s.course_id,
                     s.topic_id,
                     t.topic_name,
                     COALESCE(s.course_group_id, creator.course_group_id) AS course_group_id,
                     cg.group_name,
                     s.group_id,
                     COALESCE(tc.case_title, s.case_title, 'Group case study') AS activity_title,
                     COALESCE(ggs.xp_total, 0)::int AS group_xp,
                     ggs.reason AS group_xp_reason,
                     s.submitted_at,
                     s.created_at,
                     COUNT(DISTINCT m.user_id)::int AS member_count,
                     COUNT(DISTINCT a.user_id)::int AS answer_count,
                     JSONB_AGG(
                         DISTINCT JSONB_BUILD_OBJECT(
                             'user_id', u.user_id,
                             'name', u.name
                         )
                     ) FILTER (WHERE u.user_id IS NOT NULL) AS members
                 FROM table_group_sessions s
                 LEFT JOIN users creator ON creator.user_id = s.created_by
                 LEFT JOIN course_groups cg
                   ON cg.course_group_id = COALESCE(s.course_group_id, creator.course_group_id)
                  AND cg.deleted_at IS NULL
                 LEFT JOIN topics t ON t.topic_id = s.topic_id
                 LEFT JOIN topic_cases tc ON tc.case_id = s.case_id
                 LEFT JOIN table_group_members m ON m.session_id = s.session_id
                 LEFT JOIN users u
                   ON u.user_id = m.user_id
                  AND u.deleted_at IS NULL
                 LEFT JOIN table_group_answers a
                   ON a.session_id = s.session_id
                  AND COALESCE(a.answer_text, '') <> ''
                 LEFT JOIN gamification_group_scores ggs
                   ON ggs.activity_type = 'table_case_study'
                  AND ggs.activity_id = s.session_id
                  AND ggs.group_id = s.group_id
                 WHERE s.course_id = ANY($1::int[])
                   AND s.submitted_at IS NOT NULL
                 GROUP BY s.session_id, s.course_id, s.topic_id, t.topic_name,
                          COALESCE(s.course_group_id, creator.course_group_id), cg.group_name,
                          s.group_id, tc.case_title, s.case_title, ggs.xp_total, ggs.reason,
                          s.submitted_at, s.created_at
                 ORDER BY s.submitted_at DESC`,
                [courseIds]
            ),
            pool.query(
                `SELECT
                     s.session_id,
                     s.course_id,
                     s.topic_id,
                     COALESCE(s.course_group_id, creator.course_group_id) AS course_group_id,
                     gus.user_id,
                     u.name AS student_name,
                     gus.xp_earned,
                     gus.reason
                 FROM gamification_user_scores gus
                 JOIN table_group_sessions s
                   ON s.session_id = gus.activity_id
                  AND gus.activity_type = 'table_case_study'
                 LEFT JOIN users creator ON creator.user_id = s.created_by
                 JOIN users u ON u.user_id = gus.user_id
                 WHERE s.course_id = ANY($1::int[])
                   AND s.submitted_at IS NOT NULL
                 ORDER BY s.submitted_at DESC, u.name ASC`,
                [courseIds]
            ),
            pool.query(
                `SELECT
                     qs.quiz_session_id,
                     qs.course_id,
                     qs.topic_id,
                     t.topic_name,
                     COALESCE(qs.course_group_id, host.course_group_id) AS course_group_id,
                     cg.group_name,
                     qs.table_id,
                     qs.object_id,
                     qs.saved_at,
                     qs.created_at,
                     qsr.results_json,
                     qsr.created_at AS result_saved_at,
                     COUNT(DISTINCT qm.user_id)::int AS member_count,
                     JSONB_AGG(
                         DISTINCT JSONB_BUILD_OBJECT(
                             'user_id', u.user_id,
                             'name', u.name
                         )
                     ) FILTER (WHERE u.user_id IS NOT NULL) AS members
                 FROM quiz_sessions qs
                 LEFT JOIN users host ON host.user_id = qs.hosted_by
                 LEFT JOIN course_groups cg
                   ON cg.course_group_id = COALESCE(qs.course_group_id, host.course_group_id)
                  AND cg.deleted_at IS NULL
                 LEFT JOIN topics t ON t.topic_id = qs.topic_id
                 LEFT JOIN quiz_members qm ON qm.quiz_session_id = qs.quiz_session_id
                 LEFT JOIN users u
                   ON u.user_id = qm.user_id
                  AND u.deleted_at IS NULL
                 LEFT JOIN quiz_session_results qsr ON qsr.quiz_session_id = qs.quiz_session_id
                 WHERE qs.course_id = ANY($1::int[])
                   AND qs.status = 'saved'
                 GROUP BY qs.quiz_session_id, qs.course_id, qs.topic_id, t.topic_name,
                          COALESCE(qs.course_group_id, host.course_group_id), cg.group_name,
                          qs.table_id, qs.object_id, qs.saved_at, qs.created_at,
                          qsr.results_json, qsr.created_at
                 ORDER BY qs.saved_at DESC NULLS LAST, qs.created_at DESC`,
                [courseIds]
            ),
            pool.query(
                `WITH user_totals AS (
                     SELECT
                         u.user_id,
                         u.course_id,
                         u.course_group_id,
                         u.name,
                         COALESCE(SUM(gus.xp_earned), 0)::int AS total_xp,
                         COUNT(gus.score_id)::int AS xp_activity_count
                     FROM users u
                     LEFT JOIN gamification_user_scores gus
                       ON gus.user_id = u.user_id
                      AND gus.course_id = u.course_id
                     WHERE u.course_id = ANY($1::int[])
                       AND u.role_id = $2
                       AND u.deleted_at IS NULL
                     GROUP BY u.user_id, u.course_id, u.course_group_id, u.name
                 )
                 SELECT
                     ut.*,
                     gl.level_id,
                     gl.level_name,
                     gl.color_hex,
                     gl.min_xp,
                     gl.max_xp
                 FROM user_totals ut
                 LEFT JOIN gamification_levels gl
                   ON ut.total_xp >= gl.min_xp
                  AND (gl.max_xp IS NULL OR ut.total_xp <= gl.max_xp)
                 ORDER BY ut.course_id ASC, ut.course_group_id ASC NULLS LAST, ut.total_xp DESC, ut.name ASC`,
                [courseIds, STUDENT_ROLE_ID]
            ),
            pool.query(
                `SELECT level_id, level_name, min_xp, max_xp, color_hex
                 FROM gamification_levels
                 ORDER BY level_id ASC`
            ),
        ]);

        const courseMap = new Map(managedCourses.map((course) => [
            Number(course.course_id),
            {
                ...course,
                topics: [],
                summary: {
                    total_topics: 0,
                    total_groups: 0,
                    total_students: 0,
                    total_activities: 0,
                    total_group_xp: 0,
                    total_individual_xp: 0,
                    average_score_improvement: 0,
                },
            },
        ]));
        const topicsByCourse = new Map();
        const groupsByCourse = new Map();
        const studentsByGroup = new Map();
        const xpByUserId = new Map(studentXpTotalsResult.rows.map((row) => [Number(row.user_id), row]));

        for (const topic of topicsResult.rows) {
            const courseTopicList = topicsByCourse.get(Number(topic.course_id)) || [];
            courseTopicList.push(topic);
            topicsByCourse.set(Number(topic.course_id), courseTopicList);
        }

        for (const group of groups) {
            const courseGroupList = groupsByCourse.get(Number(group.course_id)) || [];
            courseGroupList.push(group);
            groupsByCourse.set(Number(group.course_id), courseGroupList);
        }

        for (const student of students) {
            const key = makeGroupKey(student.course_id, student.course_group_id);
            const groupStudents = studentsByGroup.get(key) || [];
            const xp = xpByUserId.get(Number(student.user_id));
            groupStudents.push({
                user_id: student.user_id,
                name: student.name,
                email: student.email,
                total_xp: xp?.total_xp || 0,
                level_id: xp?.level_id || 1,
                level_name: xp?.level_name || "Rookie",
                level_color: xp?.color_hex || "#6B7280",
                xp_activity_count: xp?.xp_activity_count || 0,
            });
            studentsByGroup.set(key, groupStudents);
        }

        const topicGroupMap = new Map();
        for (const [courseIdKey, course] of courseMap.entries()) {
            const courseTopics = topicsByCourse.get(courseIdKey) || [];
            const courseGroups = groupsByCourse.get(courseIdKey) || [];
            course.summary.total_topics = courseTopics.length;
            course.summary.total_groups = courseGroups.length;
            course.summary.total_students = courseGroups.reduce((total, group) => total + Number(group.student_count || 0), 0);

            course.topics = courseTopics.map((topic) => {
                const topicGroups = courseGroups.map((group) => {
                    const groupStudents = studentsByGroup.get(makeGroupKey(courseIdKey, group.course_group_id)) || [];
                    const levelDistribution = levelsResult.rows.map((level) => ({
                        level_id: level.level_id,
                        level_name: level.level_name,
                        color_hex: level.color_hex,
                        min_xp: level.min_xp,
                        max_xp: level.max_xp,
                        students: groupStudents.filter((student) => Number(student.level_id) === Number(level.level_id)),
                    })).filter((level) => level.students.length > 0);

                    const topicGroup = {
                        ...group,
                        topic_id: topic.topic_id,
                        topic_name: topic.topic_name,
                        students: groupStudents,
                        level_distribution: levelDistribution,
                        level_rules: levelsResult.rows,
                        activity_counts: makeEmptyActivityCounts(),
                        activities: [],
                        xp_contributions: [],
                        assessment_comparison: [],
                        total_group_xp: 0,
                        total_individual_xp: 0,
                        average_pre_score: 0,
                        average_post_score: 0,
                        average_score_improvement: 0,
                    };
                    topicGroupMap.set(makeTopicGroupKey(topic.topic_id, group.course_group_id), topicGroup);
                    return topicGroup;
                });

                return {
                    ...topic,
                    summary: {
                        total_activities: 0,
                        total_group_xp: 0,
                        total_individual_xp: 0,
                        average_score_improvement: 0,
                    },
                    groups: topicGroups,
                };
            });
        }

        const assessmentLatest = new Map();

        for (const row of individualHistoryResult.rows) {
            const activityType = normalizeActivityType(row);
            const topicGroup = topicGroupMap.get(makeTopicGroupKey(row.topic_id, row.course_group_id));
            if (!topicGroup) continue;

            incrementActivityCount(topicGroup.activity_counts, activityType);
            topicGroup.total_individual_xp += toNumber(row.xp_earned);
            topicGroup.xp_contributions.push({
                activity_id: row.session_id,
                activity_type: activityType,
                topic_id: row.topic_id,
                user_id: row.user_id,
                student_name: row.student_name,
                xp_earned: toNumber(row.xp_earned),
                reason: row.xp_reason || "",
                submitted_at: row.completed_at,
            });
            topicGroup.activities.push({
                id: `individual-${row.session_id}`,
                topic_id: row.topic_id,
                kind: "individual",
                type: activityType,
                label: activityTypeLabel(activityType, row.question_kind),
                title: activityTypeLabel(activityType, row.question_kind),
                student_name: row.student_name,
                user_id: row.user_id,
                participants: [{user_id: row.user_id, name: row.student_name}],
                activity_type: row.activity_type,
                question_kind: row.question_kind,
                score: toNumber(row.score_total),
                correct_count: toNumber(row.correct_count),
                xp: toNumber(row.xp_earned),
                submitted_at: row.completed_at,
            });

            if (activityType === "pre_test" || activityType === "post_test") {
                const key = `${row.topic_id}:${row.course_group_id}:${row.user_id}`;
                const current = assessmentLatest.get(key) || {
                    topic_id: row.topic_id,
                    course_group_id: row.course_group_id,
                    user_id: row.user_id,
                    student_name: row.student_name,
                    pre_score: null,
                    post_score: null,
                };
                const field = activityType === "pre_test" ? "pre_score" : "post_score";
                if (current[field] === null) current[field] = toNumber(row.score_total);
                assessmentLatest.set(key, current);
            }
        }

        for (const row of groupHistoryResult.rows) {
            const topicGroup = topicGroupMap.get(makeTopicGroupKey(row.topic_id, row.course_group_id));
            if (!topicGroup) continue;

            incrementActivityCount(topicGroup.activity_counts, "group");
            topicGroup.total_group_xp += toNumber(row.group_xp);
            topicGroup.activities.push({
                id: `group-${row.session_id}`,
                topic_id: row.topic_id,
                kind: "group",
                type: "group",
                label: "Group Activity",
                title: row.activity_title,
                member_count: toNumber(row.member_count),
                answer_count: toNumber(row.answer_count),
                participants: row.members || [],
                xp: toNumber(row.group_xp),
                xp_reason: row.group_xp_reason || "",
                submitted_at: row.submitted_at,
            });
        }

        for (const row of groupXpContributionResult.rows) {
            const topicGroup = topicGroupMap.get(makeTopicGroupKey(row.topic_id, row.course_group_id));
            if (!topicGroup) continue;
            topicGroup.xp_contributions.push({
                activity_id: row.session_id,
                activity_type: "group",
                topic_id: row.topic_id,
                user_id: row.user_id,
                student_name: row.student_name,
                xp_earned: toNumber(row.xp_earned),
                reason: row.reason || "",
                submitted_at: null,
            });
        }

        for (const row of quizHistoryResult.rows) {
            const topicGroup = topicGroupMap.get(makeTopicGroupKey(row.topic_id, row.course_group_id));
            if (!topicGroup) continue;

            const scoreboard = Array.isArray(row.results_json?.scoreboard) ? row.results_json.scoreboard : [];
            incrementActivityCount(topicGroup.activity_counts, "quiz");
            topicGroup.activities.push({
                id: `quiz-${row.quiz_session_id}`,
                topic_id: row.topic_id,
                kind: "quiz",
                type: "quiz",
                label: "Quiz",
                title: row.object_id || row.table_id || "Quiz",
                member_count: toNumber(row.member_count),
                average_score: average(scoreboard.map((score) => score.total_score)),
                top_score: scoreboard[0]?.total_score || 0,
                top_student: scoreboard[0]?.name || "",
                scoreboard,
                participants: row.members || [],
                submitted_at: row.saved_at || row.result_saved_at || row.created_at,
            });
        }

        for (const comparison of assessmentLatest.values()) {
            const topicGroup = topicGroupMap.get(makeTopicGroupKey(comparison.topic_id, comparison.course_group_id));
            if (!topicGroup) continue;
            topicGroup.assessment_comparison.push({
                ...comparison,
                improvement: comparison.pre_score !== null && comparison.post_score !== null
                    ? comparison.post_score - comparison.pre_score
                    : null,
            });
        }

        for (const course of courseMap.values()) {
            const improvements = [];
            for (const topic of course.topics) {
                const topicImprovements = [];
                for (const topicGroup of topic.groups) {
                    topicGroup.activities.sort((a, b) => new Date(b.submitted_at || 0) - new Date(a.submitted_at || 0));
                    topicGroup.xp_contributions.sort((a, b) => b.xp_earned - a.xp_earned || a.student_name.localeCompare(b.student_name));
                    topicGroup.assessment_comparison.sort((a, b) => a.student_name.localeCompare(b.student_name));
                    topicGroup.average_pre_score = average(topicGroup.assessment_comparison.map((item) => item.pre_score));
                    topicGroup.average_post_score = average(topicGroup.assessment_comparison.map((item) => item.post_score));
                    topicGroup.average_score_improvement = topicGroup.average_post_score - topicGroup.average_pre_score;
                    if (topicGroup.assessment_comparison.length) {
                        topicImprovements.push(...topicGroup.assessment_comparison
                            .map((item) => item.improvement)
                            .filter((value) => value !== null));
                    }
                    topic.summary.total_activities += topicGroup.activity_counts.total;
                    topic.summary.total_group_xp += topicGroup.total_group_xp;
                    topic.summary.total_individual_xp += topicGroup.total_individual_xp;
                }
                topic.summary.average_score_improvement = average(topicImprovements);
                improvements.push(...topicImprovements);
                course.summary.total_activities += topic.summary.total_activities;
                course.summary.total_group_xp += topic.summary.total_group_xp;
                course.summary.total_individual_xp += topic.summary.total_individual_xp;
            }
            course.summary.average_score_improvement = average(improvements);
        }

        const analyticsCourses = [...courseMap.values()];
        summary.managed_courses = analyticsCourses.length;
        summary.total_topics = analyticsCourses.reduce((total, course) => total + course.summary.total_topics, 0);
        summary.total_groups = analyticsCourses.reduce((total, course) => total + course.summary.total_groups, 0);
        summary.total_students = analyticsCourses.reduce((total, course) => total + course.summary.total_students, 0);
        summary.total_activities = analyticsCourses.reduce((total, course) => total + course.summary.total_activities, 0);
        summary.total_group_xp = analyticsCourses.reduce((total, course) => total + course.summary.total_group_xp, 0);
        summary.total_individual_xp = analyticsCourses.reduce((total, course) => total + course.summary.total_individual_xp, 0);
        summary.average_score_improvement = average(analyticsCourses.map((course) => course.summary.average_score_improvement));

        res.json({
            course: courseResult.rows[0] || null,
            courses: analyticsCourses,
            instructor: {
                user_id: instructor.user_id,
                name: instructor.name,
                role_name: instructor.role_name,
            },
            generated_at: new Date().toISOString(),
            summary,
            monitor: {
                summary: monitorSummary,
                groups: monitorGroups,
                students: monitorStudents,
                active_sessions: {
                    table: activeTableSessions,
                    quiz: activeQuizSessions,
                    individual: activeIndividualSessions,
                },
            },
            groups: monitorGroups,
            students: monitorStudents,
            active_sessions: {
                table: activeTableSessions,
                quiz: activeQuizSessions,
                individual: activeIndividualSessions,
            },
        });
    } catch (error) {
        console.error("Instructor dashboard error:", error);
        res.status(500).json({message: "Gagal memuat dashboard instructor"});
    }
}
