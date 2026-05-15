import {findSession} from "../models/sessionModel.js";
import {
    getTableSessionGamification,
    upsertTableSessionScores,
} from "../models/gamificationModel.js";
import {
    addMemberToSession,
    beginFeedbackGeneration,
    createGroupSession,
    ensureTableActivityTables,
    ensureSampleCasesForTopics,
    exitSessionMember,
    getActiveGroupSession,
    getCourseById,
    getSessionAnswers,
    getSessionById,
    getSessionFeedbackGroups,
    getSessionMembers,
    getTopicById,
    getTopicsForCourse,
    markFeedbackGenerationFailed,
    saveSessionAnswer,
    selectAvailableCaseForStudent,
    submitSessionAnswers,
    touchSessionMember,
} from "../models/tableActivityModel.js";
import {generateCognitiveFeedback} from "../services/openaiFeedbackService.js";

const MAX_GROUP_MEMBERS = 4;

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

function normalizeGroupId(groupId) {
    const parsed = Number.parseInt(groupId || "1", 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function normalizeSession(session, members, answers, userId, feedbackGroups = [], gamification = null) {
    if (!session) return null;

    const safeMembers = members || [];
    const safeAnswers = answers || [];
    const myAnswer = safeAnswers.find((answer) => String(answer.user_id) === String(userId));

    return {
        session_id: session.session_id,
        course_id: session.course_id,
        topic_id: session.topic_id,
        case_id: session.case_id,
        group_id: session.group_id,
        object_id: session.object_id,
        case_title: session.case_title,
        case_prompt: session.case_prompt,
        answer_text: session.answer_text || "",
        is_active: session.is_active,
        is_submitted: !!session.submitted_at,
        submitted_by: session.submitted_by,
        submitted_at: session.submitted_at,
        feedback_text: session.feedback_text || "",
        combined_feedback: session.combined_feedback || null,
        feedback_groups: feedbackGroups || [],
        feedback_model: session.feedback_model || null,
        feedback_generated_at: session.feedback_generated_at || null,
        feedback_status: session.feedback_status || "idle",
        feedback_started_at: session.feedback_started_at || null,
        feedback_error: session.feedback_error || null,
        is_starter: String(session.created_by) === String(userId),
        is_generating_feedback: session.feedback_status === "generating",
        can_submit: String(session.created_by) === String(userId)
            && !session.submitted_at
            && session.feedback_status !== "generating",
        can_edit_answers: !session.submitted_at && session.feedback_status !== "generating",
        member_count: safeMembers.length,
        max_members: MAX_GROUP_MEMBERS,
        is_full: safeMembers.length >= MAX_GROUP_MEMBERS,
        is_member: safeMembers.some((member) => String(member.user_id) === String(userId)),
        members: safeMembers,
        answers: safeAnswers,
        my_answer: myAnswer || null,
        gamification: gamification || {
            enabled: false,
            group_xp: 0,
            group_xp_reason: "",
            leaderboard: [],
        },
        created_at: session.created_at,
        updated_at: session.updated_at,
    };
}

async function loadSessionActivity(session, user) {
    if (!session) {
        return {
            members: [],
            answers: [],
            feedbackGroups: [],
            gamification: {
                enabled: !!user?.gamification_enabled,
                group_xp: 0,
                group_xp_reason: "",
                leaderboard: [],
            },
        };
    }

    const members = await getSessionMembers(session.session_id);
    const answers = await getSessionAnswers(session.session_id);
    const feedbackGroups = await getSessionFeedbackGroups(session.session_id);
    const gamification = await getTableSessionGamification(
        session,
        members,
        answers,
        !!user?.gamification_enabled
    );

    return {members, answers, feedbackGroups, gamification};
}

export async function getTableContext(req, res) {
    try {
        await ensureTableActivityTables();
        const user = await getAuthenticatedUser(req, res);
        if (!user) return;

        const groupId = normalizeGroupId(req.query.group_id);
        const [course, topics, activeSession] = await Promise.all([
            getCourseById(user.course_id),
            getTopicsForCourse(user.course_id),
            getActiveGroupSession(user.course_id, groupId),
        ]);
        if (course && topics.length > 0) {
            await ensureSampleCasesForTopics(course, topics);
        }

        const {members, answers, feedbackGroups, gamification} = await loadSessionActivity(activeSession, user);

        res.json({
            course,
            topics,
            group_id: groupId,
            object_id: req.query.object_id || null,
            max_members: MAX_GROUP_MEMBERS,
            gamification_enabled: !!user.gamification_enabled,
            active_session: normalizeSession(activeSession, members, answers, user.user_id, feedbackGroups, gamification),
        });
    } catch (error) {
        console.error("Table context error:", error);
        res.status(500).json({message: "Gagal memuat aktivitas meja"});
    }
}

export async function startTableSession(req, res) {
    try {
        await ensureTableActivityTables();
        const user = await getAuthenticatedUser(req, res);
        if (!user) return;

        const groupId = normalizeGroupId(req.body.group_id);
        const activeSession = await getActiveGroupSession(user.course_id, groupId);
        if (activeSession) {
            const {members, answers, feedbackGroups, gamification} = await loadSessionActivity(activeSession, user);
            return res.status(409).json({
                message: "Group ini sudah memiliki sesi aktif. Silakan join.",
                active_session: normalizeSession(activeSession, members, answers, user.user_id, feedbackGroups, gamification),
            });
        }

        const course = await getCourseById(user.course_id);
        if (!course) {
            return res.status(400).json({message: "Course tidak ditemukan"});
        }

        const topic = await getTopicById(req.body.topic_id, user.course_id);
        if (!topic) {
            return res.status(400).json({message: "Pilih topic terlebih dahulu"});
        }

        await ensureSampleCasesForTopics(course, [topic]);
        const caseSelection = await selectAvailableCaseForStudent(topic.topic_id, user.user_id);
        if (!caseSelection.caseStudy) {
            return res.status(409).json({
                message: `You already completed all ${caseSelection.totalCases || 2} cases for ${topic.topic_name}. You can't start another group for this topic.`,
                reason: "ALL_TOPIC_CASES_COMPLETED",
            });
        }

        const session = await createGroupSession({
            course,
            topic,
            caseStudy: caseSelection.caseStudy,
            groupId,
            objectId: req.body.object_id,
            user,
        });
        const {members, answers, feedbackGroups, gamification} = await loadSessionActivity(session, user);

        res.status(201).json({
            message: "Group session berhasil dibuat",
            session: normalizeSession(session, members, answers, user.user_id, feedbackGroups, gamification),
        });
    } catch (error) {
        if (error.code === "ACTIVE_SESSION_EXISTS" || error.code === "23505") {
            return res.status(409).json({message: "Group ini sudah memiliki sesi aktif. Silakan join."});
        }

        console.error("Start table session error:", error);
        res.status(500).json({message: "Gagal membuat group session"});
    }
}

export async function joinTableSession(req, res) {
    try {
        await ensureTableActivityTables();
        const user = await getAuthenticatedUser(req, res);
        if (!user) return;

        const session = await getSessionById(req.params.sessionId);
        if (!session || !session.is_active || String(session.course_id) !== String(user.course_id)) {
            return res.status(404).json({message: "Session tidak ditemukan"});
        }

        const currentMembers = await getSessionMembers(session.session_id);
        const alreadyMember = currentMembers.some((member) => String(member.user_id) === String(user.user_id));
        if (!alreadyMember && currentMembers.length >= MAX_GROUP_MEMBERS) {
            return res.status(409).json({message: "Group sudah penuh"});
        }

        await addMemberToSession(session.session_id, user);
        const {members, answers, feedbackGroups, gamification} = await loadSessionActivity(session, user);

        res.json({
            message: "Berhasil join group",
            session: normalizeSession(session, members, answers, user.user_id, feedbackGroups, gamification),
        });
    } catch (error) {
        console.error("Join table session error:", error);
        res.status(500).json({message: "Gagal join group"});
    }
}

export async function getTableSession(req, res) {
    try {
        await ensureTableActivityTables();
        const user = await getAuthenticatedUser(req, res);
        if (!user) return;

        const session = await getSessionById(req.params.sessionId);
        if (!session || String(session.course_id) !== String(user.course_id)) {
            return res.status(404).json({message: "Session tidak ditemukan"});
        }

        const {members, answers, feedbackGroups, gamification} = await loadSessionActivity(session, user);
        res.json({session: normalizeSession(session, members, answers, user.user_id, feedbackGroups, gamification)});
    } catch (error) {
        console.error("Get table session error:", error);
        res.status(500).json({message: "Gagal memuat session"});
    }
}

export async function saveTableAnswer(req, res) {
    try {
        await ensureTableActivityTables();
        const user = await getAuthenticatedUser(req, res);
        if (!user) return;

        const session = await getSessionById(req.params.sessionId);
        if (!session || String(session.course_id) !== String(user.course_id)) {
            return res.status(404).json({message: "Session tidak ditemukan"});
        }

        if (session.submitted_at) {
            return res.status(409).json({message: "Answers sudah disubmit dan tidak bisa diedit lagi"});
        }

        if (session.feedback_status === "generating") {
            return res.status(409).json({message: "Feedback sedang dibuat. Answers tidak bisa diedit saat ini"});
        }

        const members = await getSessionMembers(session.session_id);
        const isMember = members.some((member) => String(member.user_id) === String(user.user_id));
        if (!isMember) {
            return res.status(403).json({message: "Join group terlebih dahulu"});
        }

        await touchSessionMember(session.session_id, user);
        await saveSessionAnswer(session.session_id, user.user_id, req.body.answer_text);
        const updated = await getSessionById(session.session_id);
        const {members: updatedMembers, answers, feedbackGroups, gamification} = await loadSessionActivity(updated, user);

        res.json({
            message: "Jawaban tersimpan",
            session: normalizeSession(updated, updatedMembers, answers, user.user_id, feedbackGroups, gamification),
        });
    } catch (error) {
        console.error("Save table answer error:", error);
        res.status(500).json({message: "Gagal menyimpan jawaban"});
    }
}

export async function submitTableAnswers(req, res) {
    try {
        await ensureTableActivityTables();
        const user = await getAuthenticatedUser(req, res);
        if (!user) return;

        const session = await getSessionById(req.params.sessionId);
        if (!session || !session.is_active || String(session.course_id) !== String(user.course_id)) {
            return res.status(404).json({message: "Session tidak ditemukan"});
        }

        const members = await getSessionMembers(session.session_id);
        const isMember = members.some((member) => String(member.user_id) === String(user.user_id));
        if (!isMember) {
            return res.status(403).json({message: "Join group terlebih dahulu"});
        }

        if (String(session.created_by) !== String(user.user_id)) {
            return res.status(403).json({message: "Hanya student yang membuat group yang bisa submit semua jawaban"});
        }

        if (session.submitted_at) {
            const {answers, feedbackGroups, gamification} = await loadSessionActivity(session, user);
            return res.json({
                message: "Answers sudah pernah disubmit",
                session: normalizeSession(session, members, answers, user.user_id, feedbackGroups, gamification),
            });
        }

        if (session.feedback_status === "generating") {
            const {answers, feedbackGroups, gamification} = await loadSessionActivity(session, user);
            return res.status(409).json({
                message: "Feedback sedang dibuat. Mohon tunggu.",
                session: normalizeSession(session, members, answers, user.user_id, feedbackGroups, gamification),
            });
        }

        const answers = await getSessionAnswers(session.session_id);
        if (answers.length === 0) {
            return res.status(400).json({message: "Belum ada jawaban aktif untuk disubmit"});
        }

        const generatingSession = await beginFeedbackGeneration(session.session_id, user.user_id);
        if (!generatingSession) {
            return res.status(409).json({message: "Feedback sedang dibuat. Mohon tunggu."});
        }

        let feedbackResult;
        try {
            feedbackResult = await generateCognitiveFeedback({
                caseTitle: session.case_title,
                casePrompt: session.case_prompt,
                answers,
            });
        } catch (error) {
            await markFeedbackGenerationFailed(session.session_id, error.message);
            throw error;
        }

        const submittedResult = await submitSessionAnswers(
            session.session_id,
            user.user_id,
            feedbackResult.feedback,
            feedbackResult.model
        );
        if (!submittedResult) {
            return res.status(409).json({message: "Answers tidak bisa disubmit saat ini"});
        }

        const submitted = await getSessionById(session.session_id);
        if (user.gamification_enabled) {
            await upsertTableSessionScores(submitted, answers, feedbackResult.feedback.xp_awards);
        }
        const {
            members: updatedMembers,
            answers: submittedAnswers,
            feedbackGroups,
            gamification,
        } = await loadSessionActivity(submitted, user);

        res.json({
            message: "Semua jawaban berhasil disubmit",
            session: normalizeSession(submitted, updatedMembers, submittedAnswers, user.user_id, feedbackGroups, gamification),
        });
    } catch (error) {
        console.error("Submit table answers error:", error);
        if (error.code === "OPENAI_API_KEY_MISSING") {
            return res.status(500).json({message: "OpenAI API key belum dikonfigurasi"});
        }
        if (error.code === "OPENAI_FEEDBACK_FAILED" && error.status === 429) {
            return res.status(502).json({message: "OpenAI quota atau billing limit tercapai. Feedback belum dibuat."});
        }
        if (error.code?.startsWith("OPENAI_")) {
            return res.status(502).json({message: "Gagal membuat feedback dari OpenAI"});
        }
        res.status(500).json({message: "Gagal submit semua jawaban"});
    }
}

export async function heartbeatTableSession(req, res) {
    try {
        await ensureTableActivityTables();
        const user = await getAuthenticatedUser(req, res);
        if (!user) return;

        const session = await getSessionById(req.params.sessionId);
        if (!session || !session.is_active || String(session.course_id) !== String(user.course_id)) {
            return res.status(404).json({message: "Session tidak ditemukan"});
        }

        const member = await touchSessionMember(session.session_id, user);
        if (!member) {
            return res.status(403).json({message: "Join group terlebih dahulu"});
        }

        const {members, answers, feedbackGroups, gamification} = await loadSessionActivity(session, user);
        res.json({
            message: "Heartbeat diterima",
            session: normalizeSession(session, members, answers, user.user_id, feedbackGroups, gamification),
        });
    } catch (error) {
        console.error("Table heartbeat error:", error);
        res.status(500).json({message: "Gagal memperbarui kehadiran group"});
    }
}

export async function exitTableSession(req, res) {
    try {
        await ensureTableActivityTables();
        const user = await getAuthenticatedUser(req, res);
        if (!user) return;

        const session = await getSessionById(req.params.sessionId);
        if (!session || String(session.course_id) !== String(user.course_id)) {
            return res.status(404).json({message: "Session tidak ditemukan"});
        }

        if (session.feedback_status === "generating") {
            const {members, answers, feedbackGroups, gamification} = await loadSessionActivity(session, user);
            return res.status(409).json({
                message: "Feedback sedang dibuat. Siswa belum bisa keluar dari group.",
                session: normalizeSession(session, members, answers, user.user_id, feedbackGroups, gamification),
            });
        }

        const exitResult = await exitSessionMember(session.session_id, user.user_id);
        const updated = await getSessionById(session.session_id);
        const {members, answers, feedbackGroups, gamification} = updated?.is_active
            ? await loadSessionActivity(updated, user)
            : {
                members: [],
                answers: [],
                feedbackGroups: [],
                gamification: {enabled: !!user.gamification_enabled, group_xp: 0, group_xp_reason: "", leaderboard: []},
            };

        res.json({
            message: exitResult.remainingMembers === 0 ? "Group session selesai" : "Berhasil keluar dari group",
            session: normalizeSession(updated, members, answers, user.user_id, feedbackGroups, gamification),
        });
    } catch (error) {
        console.error("Exit table session error:", error);
        if (error.code === "FEEDBACK_GENERATING") {
            return res.status(409).json({message: "Feedback sedang dibuat. Siswa belum bisa keluar dari group."});
        }
        res.status(500).json({message: "Gagal keluar dari group"});
    }
}
