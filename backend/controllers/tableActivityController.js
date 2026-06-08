import {findSession} from "../models/sessionModel.js";
import {
    getTableSessionGamification,
    upsertTableSessionScores,
} from "../models/gamificationModel.js";
import {
    beginFeedbackGeneration,
    beginFeedbackRetry,
    createGroupSession,
    endGroupSessionWithoutSubmission,
    ensureTableActivityTables,
    exitSessionMember,
    GROUP_ACTIVITY_DURATION_SECONDS,
    GROUP_START_DELAY_SECONDS,
    getActiveGroupOccupancy,
    getActiveGroupSession,
    getCourseById,
    getSessionAnswers,
    getSessionById,
    getSessionFeedbackGroups,
    getSessionMembers,
    getSessionParticipants,
    getTopicById,
    getTopicsForCourse,
    joinTableMemberWithLimit,
    saveSessionAnswer,
    saveSessionFeedbackResult,
    selectAvailableCaseForStudent,
    startGroupSessionWork,
    submitSessionFeedbackFailed,
    submitSessionAnswers,
    touchSessionMember,
} from "../models/tableActivityModel.js";
import {generateCognitiveFeedback} from "../services/openaiFeedbackService.js";

const MAX_GROUP_MEMBERS = 4;
const GROUP_FEEDBACK_STALE_MS = 5 * 60 * 1000;

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

function parseGroupIds(value) {
    return Array.from(new Set(
        String(value || "")
            .split(",")
            .map((item) => Number.parseInt(item.trim(), 10))
            .filter((item) => Number.isFinite(item) && item > 0)
    ));
}

function sameCourseGroup(session, user) {
    return String(session?.course_group_id || "") === String(user?.course_group_id || "");
}

function groupSessionRoom(sessionId) {
    const parsed = Number.parseInt(sessionId, 10);
    return Number.isFinite(parsed) && parsed > 0 ? `group:session:${parsed}` : null;
}

function emitGroupEvent(req, sessionId, eventName = "group:session_updated", payload = {}) {
    const room = groupSessionRoom(sessionId);
    const io = req.app.get("io");
    if (!room || !io) return;

    io.to(room).emit(eventName, {
        session_id: Number.parseInt(sessionId, 10),
        server_time_ms: Date.now(),
        ...payload,
    });
}

function getGroupTimer(session) {
    if (!session) {
        return {
            duration_seconds: GROUP_ACTIVITY_DURATION_SECONDS,
            seconds_spent: 0,
            seconds_left: GROUP_ACTIVITY_DURATION_SECONDS,
            timer_expires_at: null,
            is_time_up: false,
        };
    }

    const durationSeconds = Number(session.duration_seconds) || GROUP_ACTIVITY_DURATION_SECONDS;
    const startedAt = session.work_started_at ? new Date(session.work_started_at).getTime() : null;
    const elapsedSeconds = startedAt ? Math.max(0, Math.floor((Date.now() - startedAt) / 1000)) : 0;
    const isRunning = !!session.is_active && !session.submitted_at && !!startedAt;
    const secondsSpent = isRunning
        ? Math.min(durationSeconds, elapsedSeconds)
        : Math.min(durationSeconds, Math.max(0, Number(session.seconds_spent || 0)));
    const secondsLeft = isRunning
        ? Math.max(0, durationSeconds - secondsSpent)
        : Math.max(0, Number(session.seconds_left || 0));

    return {
        duration_seconds: durationSeconds,
        seconds_spent: secondsSpent,
        seconds_left: secondsLeft,
        timer_expires_at: startedAt ? new Date(startedAt + durationSeconds * 1000).toISOString() : null,
        is_time_up: isRunning && secondsLeft <= 0,
    };
}

function isGroupSessionTimeUp(session) {
    return getGroupTimer(session).is_time_up;
}

function isGroupSessionPendingStart(session) {
    if (!session?.work_started_at) return false;
    return Date.now() < new Date(session.work_started_at).getTime();
}

function isStaleFeedbackGeneration(session) {
    if (session?.feedback_status !== "generating" || session.submitted_at || !session.feedback_started_at) return false;
    const startedAt = new Date(session.feedback_started_at).getTime();
    return Number.isFinite(startedAt) && Date.now() - startedAt > GROUP_FEEDBACK_STALE_MS;
}

async function recoverStaleGroupFeedbackGeneration(session, user) {
    if (!isStaleFeedbackGeneration(session)) return session;
    const members = await getSessionMembers(session.session_id);
    const isMember = members.some((member) => String(member.user_id) === String(user.user_id));
    if (!isMember) return session;
    return await submitSessionFeedbackFailed(
        session.session_id,
        user.user_id,
        "Feedback AI terputus karena halaman direfresh atau koneksi terputus. Silakan coba ulang."
    ) || session;
}

function normalizeSession(session, members, answers, userId, feedbackGroups = [], gamification = null) {
    if (!session) return null;

    const safeMembers = members || [];
    const safeAnswers = answers || [];
    const myAnswer = safeAnswers.find((answer) => String(answer.user_id) === String(userId));
    const timer = getGroupTimer(session);

    return {
        server_time_ms: Date.now(),
        session_id: session.session_id,
        course_id: session.course_id,
        course_group_id: session.course_group_id,
        topic_id: session.topic_id,
        case_id: session.case_id,
        group_id: session.group_id,
        object_id: session.object_id,
        case_title: session.case_title,
        case_prompt: session.case_prompt,
        answer_text: session.answer_text || "",
        is_active: session.is_active,
        is_submitted: !!session.submitted_at,
        is_started: !!session.work_started_at,
        work_started_at: session.work_started_at || null,
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
        group_start_delay_seconds: GROUP_START_DELAY_SECONDS,
        is_starter: String(session.created_by) === String(userId),
        is_generating_feedback: session.feedback_status === "generating",
        can_start_work: String(session.created_by) === String(userId)
            && !session.work_started_at
            && !session.submitted_at
            && session.feedback_status !== "generating"
            && safeMembers.length >= 2,
        can_submit: safeMembers.some((member) => String(member.user_id) === String(userId))
            && !!session.work_started_at
            && !session.submitted_at
            && session.feedback_status !== "generating"
            && !timer.is_time_up,
        can_edit_answers: !!session.work_started_at && !session.submitted_at && session.feedback_status !== "generating" && !timer.is_time_up,
        member_count: safeMembers.length,
        max_members: MAX_GROUP_MEMBERS,
        is_full: safeMembers.length >= MAX_GROUP_MEMBERS,
        is_member: safeMembers.some((member) => String(member.user_id) === String(userId)),
        members: safeMembers.map((member) => ({
            ...member,
            is_host: String(member.user_id) === String(session.created_by),
        })),
        answers: safeAnswers,
        my_answer: myAnswer || null,
        gamification: gamification || {
            enabled: false,
            group_xp: 0,
            group_xp_reason: "",
            leaderboard: [],
        },
        ...timer,
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

async function submitTimedOutGroupSession(session, user, answerText = "") {
    const members = await getSessionMembers(session.session_id);
    const isMember = members.some((member) => String(member.user_id) === String(user.user_id));
    if (!isMember) {
        const error = new Error("NOT_GROUP_MEMBER");
        error.code = "NOT_GROUP_MEMBER";
        throw error;
    }

    const currentAnswerText = String(answerText || "").trim();
    if (currentAnswerText) {
        await saveSessionAnswer(session.session_id, user.user_id, currentAnswerText);
    }

    const answers = await getSessionAnswers(session.session_id);
    if (answers.length === 0) {
        return endGroupSessionWithoutSubmission(session.session_id);
    }

    const generatingSession = await beginFeedbackGeneration(session.session_id, user.user_id);
    if (!generatingSession) {
        return getSessionById(session.session_id);
    }

    let feedbackResult;
    try {
        feedbackResult = await generateCognitiveFeedback({
            caseTitle: session.case_title,
            casePrompt: session.case_prompt,
            answers,
        });
    } catch (error) {
        return submitSessionFeedbackFailed(session.session_id, user.user_id, error.message);
    }

    const submittedResult = await submitSessionAnswers(
        session.session_id,
        user.user_id,
        feedbackResult.feedback,
        feedbackResult.model
    );
    const submitted = submittedResult ? await getSessionById(session.session_id) : await getSessionById(session.session_id);
    if (submittedResult && user.gamification_enabled) {
        await upsertTableSessionScores(submitted, answers, feedbackResult.feedback.xp_awards);
    }
    return submitted;
}

export async function getTableOccupancy(req, res) {
    try {
        await ensureTableActivityTables();
        const user = await getAuthenticatedUser(req, res);
        if (!user) return;

        const groupIds = parseGroupIds(req.query.groups);
        const rows = await getActiveGroupOccupancy({
            courseId: user.course_id,
            courseGroupId: user.course_group_id || null,
            groupIds,
            userId: user.user_id,
        });

        res.json({
            occupancy: rows.map((row) => {
                const members = Array.isArray(row.members) ? row.members : [];
                const occupiedObjectIds = Array.from(new Set(
                    [row.object_id, ...members.map((member) => member.object_id)]
                        .map((value) => String(value || "").trim())
                        .filter(Boolean)
                ));
                const isMember = !!row.is_member;
                return {
                    session_id: row.session_id,
                    group_id: row.group_id,
                    object_id: row.object_id,
                    occupied_object_ids: occupiedObjectIds,
                    status: row.submitted_at
                        ? "submitted"
                        : row.work_started_at ? "started" : "waiting",
                    feedback_status: row.feedback_status || "idle",
                    is_member: isMember,
                    is_occupied: !isMember,
                    member_count: members.length,
                    member_names: members.map((member) => member.name).filter(Boolean),
                };
            }),
        });
    } catch (error) {
        console.error("Table occupancy error:", error);
        res.status(500).json({message: "Gagal memuat status meja"});
    }
}

export async function getTableContext(req, res) {
    try {
        await ensureTableActivityTables();
        const user = await getAuthenticatedUser(req, res);
        if (!user) return;

        const groupId = normalizeGroupId(req.query.group_id);
        const [course, topics, rawActiveSession] = await Promise.all([
            getCourseById(user.course_id),
            getTopicsForCourse(user.course_id, {includeInactive: true}),
            getActiveGroupSession(user.course_id, groupId, user.course_group_id || null),
        ]);
        const activeSession = rawActiveSession
            ? await recoverStaleGroupFeedbackGeneration(rawActiveSession, user)
            : null;
        const {members, answers, feedbackGroups, gamification} = await loadSessionActivity(activeSession, user);

        res.json({
            course,
            topics,
            group_id: groupId,
            object_id: req.query.object_id || null,
            max_members: MAX_GROUP_MEMBERS,
            group_start_delay_seconds: GROUP_START_DELAY_SECONDS,
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
        const rawActiveSession = await getActiveGroupSession(user.course_id, groupId, user.course_group_id || null);
        const activeSession = rawActiveSession
            ? await recoverStaleGroupFeedbackGeneration(rawActiveSession, user)
            : null;
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

        const caseSelection = await selectAvailableCaseForStudent(topic.topic_id, user.user_id);
        if (!caseSelection.caseStudy) {
            if (caseSelection.totalCases === 0) {
                return res.status(409).json({
                    message: `Belum ada case study aktif untuk topic ${topic.topic_name}.`,
                    reason: "NO_TOPIC_CASES_AVAILABLE",
                });
            }
            return res.status(409).json({
                message: `Kamu sudah menyelesaikan semua ${caseSelection.totalCases} case yang tersedia untuk topic ${topic.topic_name}.`,
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
        if (!session || !session.is_active || String(session.course_id) !== String(user.course_id) || !sameCourseGroup(session, user)) {
            return res.status(404).json({message: "Session tidak ditemukan"});
        }

        const joinResult = await joinTableMemberWithLimit(session.session_id, user, req.body.object_id || null, MAX_GROUP_MEMBERS);
        if (joinResult.reason === "STARTED") {
            return res.status(409).json({message: "Group discussion sudah dimulai. Student baru tidak bisa join sesi ini."});
        }
        if (joinResult.reason === "FULL") {
            return res.status(409).json({message: "Group sudah penuh"});
        }
        if (joinResult.reason === "NOT_JOINABLE") {
            return res.status(409).json({message: "Session tidak bisa dijoin saat ini."});
        }

        const joinedSession = joinResult.session || session;
        const {members, answers, feedbackGroups, gamification} = await loadSessionActivity(joinedSession, user);
        emitGroupEvent(req, session.session_id, "group:lobby_updated", {status: "lobby"});

        res.json({
            message: "Berhasil join group",
            session: normalizeSession(joinedSession, members, answers, user.user_id, feedbackGroups, gamification),
        });
    } catch (error) {
        console.error("Join table session error:", error);
        res.status(500).json({message: "Gagal join group"});
    }
}

export async function beginTableSessionWork(req, res) {
    try {
        await ensureTableActivityTables();
        const user = await getAuthenticatedUser(req, res);
        if (!user) return;

        const session = await getSessionById(req.params.sessionId);
        if (!session || !session.is_active || String(session.course_id) !== String(user.course_id) || !sameCourseGroup(session, user)) {
            return res.status(404).json({message: "Session tidak ditemukan"});
        }

        const result = await startGroupSessionWork(session.session_id, user.user_id, 2);
        if (result.reason === "NOT_HOST") {
            return res.status(403).json({message: "Hanya host yang bisa mulai group discussion."});
        }
        if (result.reason === "WAITING_FOR_MEMBERS") {
            const {members, answers, feedbackGroups, gamification} = await loadSessionActivity(session, user);
            return res.status(409).json({
                message: "Group discussion bisa dimulai setelah minimal 2 student bergabung.",
                session: normalizeSession(session, members, answers, user.user_id, feedbackGroups, gamification),
            });
        }
        if (result.reason === "NOT_AVAILABLE") {
            return res.status(409).json({message: "Session tidak bisa dimulai saat ini."});
        }

        const updated = await getSessionById(session.session_id);
        const {members, answers, feedbackGroups, gamification} = await loadSessionActivity(updated, user);
        emitGroupEvent(req, session.session_id, "group:starting", {
            work_started_at: updated?.work_started_at,
            delay_seconds: GROUP_START_DELAY_SECONDS,
        });
        res.json({
            message: result.reason === "ALREADY_STARTED" ? "Group discussion sudah dimulai." : "Group discussion dimulai.",
            session: normalizeSession(updated, members, answers, user.user_id, feedbackGroups, gamification),
        });
    } catch (error) {
        console.error("Begin table session work error:", error);
        res.status(500).json({message: "Gagal mulai group discussion"});
    }
}

export async function getTableSession(req, res) {
    try {
        await ensureTableActivityTables();
        const user = await getAuthenticatedUser(req, res);
        if (!user) return;

        let session = await getSessionById(req.params.sessionId);
        if (!session || String(session.course_id) !== String(user.course_id) || !sameCourseGroup(session, user)) {
            return res.status(404).json({message: "Session tidak ditemukan"});
        }
        session = await recoverStaleGroupFeedbackGeneration(session, user);

        const {members, answers, feedbackGroups, gamification} = await loadSessionActivity(session, user);
        res.json({session: normalizeSession(session, members, answers, user.user_id, feedbackGroups, gamification)});
    } catch (error) {
        console.error("Get table session error:", error);
        res.status(500).json({message: "Gagal memuat session"});
    }
}

export async function retryTableFeedback(req, res) {
    try {
        await ensureTableActivityTables();
        const user = await getAuthenticatedUser(req, res);
        if (!user) return;

        const session = await getSessionById(req.params.sessionId);
        if (!session || String(session.course_id) !== String(user.course_id) || !sameCourseGroup(session, user)) {
            return res.status(404).json({message: "Session tidak ditemukan"});
        }
        if (!session.submitted_at) {
            return res.status(409).json({message: "Group belum disubmit"});
        }

        const members = await getSessionParticipants(session.session_id);
        const isMember = members.some((member) => String(member.user_id) === String(user.user_id));
        if (!isMember) return res.status(403).json({message: "Join group terlebih dahulu"});

        const generating = await beginFeedbackRetry(session.session_id);
        if (!generating) {
            const {answers, feedbackGroups, gamification} = await loadSessionActivity(session, user);
            return res.status(409).json({
                message: "Feedback sedang dibuat atau session tidak bisa dicoba ulang.",
                session: normalizeSession(session, members, answers, user.user_id, feedbackGroups, gamification),
            });
        }
        emitGroupEvent(req, session.session_id, "group:feedback_generating", {status: "generating", retried_by: user.user_id});

        const answers = await getSessionAnswers(session.session_id);
        let feedbackResult;
        try {
            feedbackResult = await generateCognitiveFeedback({
                caseTitle: session.case_title,
                casePrompt: session.case_prompt,
                answers,
            });
        } catch (error) {
            const failed = await submitSessionFeedbackFailed(session.session_id, user.user_id, error.message);
            const {members: failedMembers, answers: failedAnswers, feedbackGroups, gamification} = await loadSessionActivity(failed, user);
            emitGroupEvent(req, session.session_id, "group:feedback_ready", {status: "error", retried_by: user.user_id});
            return res.json({
                message: "Feedback AI masih gagal dibuat.",
                session: normalizeSession(failed, failedMembers, failedAnswers, user.user_id, feedbackGroups, gamification),
            });
        }

        const updated = await saveSessionFeedbackResult(session.session_id, feedbackResult.feedback, feedbackResult.model);
        if (user.gamification_enabled) {
            await upsertTableSessionScores(updated || session, answers, feedbackResult.feedback.xp_awards);
        }
        const {members: updatedMembers, answers: updatedAnswers, feedbackGroups, gamification} = await loadSessionActivity(updated || session, user);
        emitGroupEvent(req, session.session_id, "group:feedback_ready", {status: "ready", retried_by: user.user_id});

        res.json({
            message: "Feedback AI berhasil dibuat ulang.",
            session: normalizeSession(updated || session, updatedMembers, updatedAnswers, user.user_id, feedbackGroups, gamification),
        });
    } catch (error) {
        console.error("Retry table feedback error:", error);
        res.status(500).json({message: "Gagal mencoba ulang feedback group"});
    }
}

export async function saveTableAnswer(req, res) {
    try {
        await ensureTableActivityTables();
        const user = await getAuthenticatedUser(req, res);
        if (!user) return;

        let session = await getSessionById(req.params.sessionId);
        if (!session || String(session.course_id) !== String(user.course_id) || !sameCourseGroup(session, user)) {
            return res.status(404).json({message: "Session tidak ditemukan"});
        }
        session = await recoverStaleGroupFeedbackGeneration(session, user);

        if (session.submitted_at) {
            return res.status(409).json({message: "Answers sudah disubmit dan tidak bisa diedit lagi"});
        }

        if (!session.work_started_at) {
            return res.status(409).json({message: "Group discussion belum dimulai oleh host."});
        }
        if (isGroupSessionPendingStart(session)) {
            const {members, answers, feedbackGroups, gamification} = await loadSessionActivity(session, user);
            return res.status(409).json({
                message: "Group discussion sedang bersiap dimulai.",
                session: normalizeSession(session, members, answers, user.user_id, feedbackGroups, gamification),
            });
        }

        if (session.feedback_status === "generating") {
            return res.status(409).json({message: "Feedback sedang dibuat. Answers tidak bisa diedit saat ini"});
        }

        if (isGroupSessionTimeUp(session)) {
            emitGroupEvent(req, session.session_id, "group:feedback_generating", {status: "generating", reason: "timeout"});
            const timedOutSession = await submitTimedOutGroupSession(session, user, req.body.answer_text);
            const {members, answers, feedbackGroups, gamification} = await loadSessionActivity(timedOutSession, user);
            emitGroupEvent(
                req,
                session.session_id,
                timedOutSession?.submitted_at ? "group:feedback_ready" : "group:session_updated",
                {reason: "timeout"}
            );
            return res.status(409).json({
                message: "Waktu group discussion sudah habis.",
                session: normalizeSession(timedOutSession, members, answers, user.user_id, feedbackGroups, gamification),
            });
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
        emitGroupEvent(req, session.session_id, "group:answer_updated", {user_id: user.user_id});

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

        let session = await getSessionById(req.params.sessionId);
        if (!session || !session.is_active || String(session.course_id) !== String(user.course_id) || !sameCourseGroup(session, user)) {
            return res.status(404).json({message: "Session tidak ditemukan"});
        }
        session = await recoverStaleGroupFeedbackGeneration(session, user);

        if (!session.work_started_at) {
            return res.status(409).json({message: "Group discussion belum dimulai oleh host."});
        }
        if (isGroupSessionPendingStart(session)) {
            const {members, answers, feedbackGroups, gamification} = await loadSessionActivity(session, user);
            return res.status(409).json({
                message: "Group discussion sedang bersiap dimulai.",
                session: normalizeSession(session, members, answers, user.user_id, feedbackGroups, gamification),
            });
        }

        const members = await getSessionMembers(session.session_id);
        const isMember = members.some((member) => String(member.user_id) === String(user.user_id));
        if (!isMember) {
            return res.status(403).json({message: "Join group terlebih dahulu"});
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

        if (isGroupSessionTimeUp(session)) {
            emitGroupEvent(req, session.session_id, "group:feedback_generating", {status: "generating", reason: "timeout"});
            const timedOutSession = await submitTimedOutGroupSession(session, user, req.body.answer_text);
            const {members: timedOutMembers, answers: timedOutAnswers, feedbackGroups: timedOutFeedbackGroups, gamification: timedOutGamification} =
                await loadSessionActivity(timedOutSession, user);
            emitGroupEvent(
                req,
                session.session_id,
                timedOutSession?.submitted_at ? "group:feedback_ready" : "group:session_updated",
                {reason: "timeout"}
            );
            return res.json({
                message: "Waktu group discussion sudah habis.",
                session: normalizeSession(timedOutSession, timedOutMembers, timedOutAnswers, user.user_id, timedOutFeedbackGroups, timedOutGamification),
            });
        }

        const answers = await getSessionAnswers(session.session_id);
        if (answers.length === 0) {
            return res.status(400).json({message: "Belum ada jawaban aktif untuk disubmit"});
        }
        const answeredUserIds = new Set(
            answers
                .filter((answer) => String(answer.answer_text || "").trim().length > 0)
                .map((answer) => String(answer.user_id))
        );
        const unansweredMembers = members.filter((member) => !answeredUserIds.has(String(member.user_id)));
        if (unansweredMembers.length > 0) {
            return res.status(409).json({
                message: "Submit bisa dilakukan setelah semua anggota group menyimpan jawaban.",
                waiting_for: unansweredMembers.map((member) => member.name),
            });
        }

        const generatingSession = await beginFeedbackGeneration(session.session_id, user.user_id);
        if (!generatingSession) {
            return res.status(409).json({message: "Feedback sedang dibuat. Mohon tunggu."});
        }
        emitGroupEvent(req, session.session_id, "group:feedback_generating", {status: "generating", submitted_by: user.user_id});

        let feedbackResult;
        try {
            feedbackResult = await generateCognitiveFeedback({
                caseTitle: session.case_title,
                casePrompt: session.case_prompt,
                answers,
            });
        } catch (error) {
            const failed = await submitSessionFeedbackFailed(session.session_id, user.user_id, error.message);
            const {members: failedMembers, answers: failedAnswers, feedbackGroups: failedFeedbackGroups, gamification: failedGamification} =
                await loadSessionActivity(failed, user);
            emitGroupEvent(req, session.session_id, "group:feedback_ready", {status: "error", submitted_by: user.user_id});
            return res.json({
                message: "Jawaban tersimpan, tetapi AI feedback gagal dibuat. Silakan coba ulang.",
                session: normalizeSession(failed, failedMembers, failedAnswers, user.user_id, failedFeedbackGroups, failedGamification),
            });
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
        emitGroupEvent(req, session.session_id, "group:feedback_ready", {submitted_by: user.user_id});

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

export async function timeoutTableSession(req, res) {
    try {
        await ensureTableActivityTables();
        const user = await getAuthenticatedUser(req, res);
        if (!user) return;

        let session = await getSessionById(req.params.sessionId);
        if (!session || String(session.course_id) !== String(user.course_id) || !sameCourseGroup(session, user)) {
            return res.status(404).json({message: "Session tidak ditemukan"});
        }
        session = await recoverStaleGroupFeedbackGeneration(session, user);

        if (!session.is_active || session.submitted_at) {
            const {members, answers, feedbackGroups, gamification} = await loadSessionActivity(session, user);
            return res.json({
                message: "Group session sudah selesai",
                session: normalizeSession(session, members, answers, user.user_id, feedbackGroups, gamification),
            });
        }

        if (!session.work_started_at) {
            const {members, answers, feedbackGroups, gamification} = await loadSessionActivity(session, user);
            return res.status(409).json({
                message: "Group discussion belum dimulai oleh host.",
                session: normalizeSession(session, members, answers, user.user_id, feedbackGroups, gamification),
            });
        }
        if (isGroupSessionPendingStart(session)) {
            const {members, answers, feedbackGroups, gamification} = await loadSessionActivity(session, user);
            return res.status(409).json({
                message: "Group discussion sedang bersiap dimulai.",
                session: normalizeSession(session, members, answers, user.user_id, feedbackGroups, gamification),
            });
        }

        if (!isGroupSessionTimeUp(session)) {
            const {members, answers, feedbackGroups, gamification} = await loadSessionActivity(session, user);
            return res.json({
                message: "Timer masih berjalan",
                session: normalizeSession(session, members, answers, user.user_id, feedbackGroups, gamification),
            });
        }

        emitGroupEvent(req, session.session_id, "group:feedback_generating", {status: "generating", reason: "timeout"});
        const timedOutSession = await submitTimedOutGroupSession(session, user, req.body.answer_text);
        const {members, answers, feedbackGroups, gamification} = await loadSessionActivity(timedOutSession, user);
        emitGroupEvent(
            req,
            session.session_id,
            timedOutSession?.submitted_at ? "group:feedback_ready" : "group:session_updated",
            {reason: "timeout"}
        );
        res.json({
            message: "Waktu group discussion sudah habis.",
            session: normalizeSession(timedOutSession, members, answers, user.user_id, feedbackGroups, gamification),
        });
    } catch (error) {
        console.error("Timeout table session error:", error);
        if (error.code === "NOT_GROUP_MEMBER") {
            return res.status(403).json({message: "Join group terlebih dahulu"});
        }
        if (error.code?.startsWith("OPENAI_")) {
            return res.status(502).json({message: "Gagal membuat feedback dari OpenAI"});
        }
        res.status(500).json({message: "Gagal menyelesaikan group yang waktunya habis"});
    }
}

export async function heartbeatTableSession(req, res) {
    try {
        await ensureTableActivityTables();
        const user = await getAuthenticatedUser(req, res);
        if (!user) return;

        let session = await getSessionById(req.params.sessionId);
        if (!session || !session.is_active || String(session.course_id) !== String(user.course_id) || !sameCourseGroup(session, user)) {
            return res.status(404).json({message: "Session tidak ditemukan"});
        }
        session = await recoverStaleGroupFeedbackGeneration(session, user);

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
        if (!session || String(session.course_id) !== String(user.course_id) || !sameCourseGroup(session, user)) {
            return res.status(404).json({message: "Session tidak ditemukan"});
        }

        if (session.feedback_status === "generating") {
            const {members, answers, feedbackGroups, gamification} = await loadSessionActivity(session, user);
            return res.status(409).json({
                message: "Feedback sedang dibuat. Siswa belum bisa keluar dari group.",
                session: normalizeSession(session, members, answers, user.user_id, feedbackGroups, gamification),
            });
        }

        if (session.work_started_at && !session.submitted_at) {
            const {members, answers, feedbackGroups, gamification} = await loadSessionActivity(session, user);
            return res.status(409).json({
                message: "Group discussion sudah dimulai dan tidak bisa ditinggalkan. Selesaikan aktivitas ini bersama group.",
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
        emitGroupEvent(
            req,
            session.session_id,
            exitResult.cancelledByHost ? "group:lobby_cancelled" : "group:lobby_updated",
            {remaining_members: exitResult.remainingMembers || 0}
        );

        res.json({
            message: exitResult.cancelledByHost
                ? "Host keluar sebelum aktivitas dimulai. Waiting room ditutup untuk semua student."
                : exitResult.remainingMembers === 0 ? "Group session selesai" : "Berhasil keluar dari group",
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
