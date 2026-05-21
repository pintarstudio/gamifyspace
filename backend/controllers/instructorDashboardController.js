import {pool} from "../db/index.js";
import {findSession} from "../models/sessionModel.js";
import {ensureIndividualActivityTables} from "../models/individualActivityModel.js";
import {ensureQuizActivityTables} from "../models/quizActivityModel.js";
import {ensureTableActivityTables} from "../models/tableActivityModel.js";
import {INSTRUCTOR_ROLE_ID, STUDENT_ROLE_ID} from "../models/roleModel.js";

async function getAuthenticatedInstructor(req, res) {
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

export async function getInstructorDashboard(req, res) {
    try {
        await Promise.all([
            ensureTableActivityTables(),
            ensureQuizActivityTables(),
            ensureIndividualActivityTables(),
        ]);

        const instructor = await getAuthenticatedInstructor(req, res);
        if (!instructor) return;

        const courseId = instructor.course_id;
        const presenceByUserId = mapPresence(req, courseId);

        const [
            courseResult,
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
                `SELECT
                     cg.course_group_id,
                     cg.group_name,
                     cg.gamification_enabled,
                     cg.virtual_space_enabled,
                     COUNT(u.user_id) FILTER (WHERE u.role_id = $2 AND u.deleted_at IS NULL)::int AS student_count
                 FROM course_groups cg
                 LEFT JOIN users u
                   ON u.course_group_id = cg.course_group_id
                  AND u.course_id = cg.course_id
                 WHERE cg.course_id = $1
                   AND cg.deleted_at IS NULL
                 GROUP BY cg.course_group_id, cg.group_name, cg.gamification_enabled, cg.virtual_space_enabled
                 ORDER BY cg.group_name ASC`,
                [courseId, STUDENT_ROLE_ID]
            ),
            pool.query(
                `SELECT
                     u.user_id,
                     u.name,
                     u.email,
                     u.course_group_id,
                     cg.group_name AS course_group_name,
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
                 WHERE u.course_id = $1
                   AND u.role_id = $2
                   AND u.deleted_at IS NULL
                 ORDER BY cg.group_name ASC NULLS LAST, u.name ASC`,
                [courseId, STUDENT_ROLE_ID]
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
                     (SELECT COUNT(*)::int FROM table_group_sessions WHERE course_id = $1 AND submitted_at IS NOT NULL) AS completed_group_cases,
                     (SELECT COUNT(*)::int FROM quiz_sessions WHERE course_id = $1 AND status = 'saved') AS completed_quizzes,
                     (SELECT COUNT(*)::int FROM individual_activity_sessions WHERE course_id = $1 AND status = 'completed') AS completed_individual`
                ,
                [courseId]
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

        const groups = groupsResult.rows.map((group) => {
            const groupStudents = students.filter((student) => String(student.course_group_id) === String(group.course_group_id));
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

        const summary = {
            total_students: students.length,
            online_students: students.filter((student) => student.online).length,
            active_students: students.filter((student) => student.status === "active").length,
            idle_students: students.filter((student) => student.status === "idle").length,
            offline_students: students.filter((student) => student.status === "offline").length,
            active_table_sessions: activeTableSessions.length,
            active_quiz_sessions: activeQuizSessions.length,
            active_individual_sessions: activeIndividualSessions.length,
            active_sessions: activeTableSessions.length + activeQuizSessions.length + activeIndividualSessions.length,
            completed_group_cases: totalsResult.rows[0]?.completed_group_cases || 0,
            completed_quizzes: totalsResult.rows[0]?.completed_quizzes || 0,
            completed_individual: totalsResult.rows[0]?.completed_individual || 0,
        };

        res.json({
            course: courseResult.rows[0] || null,
            instructor: {
                user_id: instructor.user_id,
                name: instructor.name,
                role_name: instructor.role_name,
            },
            generated_at: new Date().toISOString(),
            summary,
            groups,
            students,
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
