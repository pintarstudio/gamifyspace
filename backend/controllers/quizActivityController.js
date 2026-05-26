import {findSession} from "../models/sessionModel.js";
import {
    beginQuizFeedbackRetry,
    beginQuizResultSave,
    createQuizSession,
    ensureQuizActivityTables,
    exitQuizMember,
    getActiveQuizSession,
    getQuizAnswers,
    getQuizMembers,
    getQuizQuestionsByIds,
    getQuizQuestionsForTopic,
    getQuizSavedResult,
    getQuizSessionById,
    joinQuizMemberWithLimit,
    MAX_QUIZ_MEMBERS,
    QUESTION_COUNT,
    QUESTION_REVEAL_SECONDS,
    QUESTION_START_DELAY_SECONDS,
    QUESTION_TIME_SECONDS,
    refreshQuizProgress,
    saveQuizResult,
    startQuizSession,
    submitQuizAnswer,
    touchQuizMember,
    updateQuizResultFeedback,
} from "../models/quizActivityModel.js";
import {
    getCourseById,
    getTopicById,
    getTopicsForCourse,
} from "../models/tableActivityModel.js";
import {generateQuizWrongAnswerFeedback} from "../services/openaiFeedbackService.js";

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

function normalizeTableId(value) {
    const tableId = value || "1";
    return String(tableId).trim() || "1";
}

function normalizeGroupId(value) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function sameCourseGroup(session, user) {
    return String(session?.course_group_id || "") === String(user?.course_group_id || "");
}

function quizSessionRoom(sessionId) {
    const parsed = Number.parseInt(sessionId, 10);
    return Number.isFinite(parsed) && parsed > 0 ? `quiz:session:${parsed}` : null;
}

function emitQuizEvent(req, sessionId, eventName = "quiz:session_updated", payload = {}) {
    const room = quizSessionRoom(sessionId);
    const io = req.app.get("io");
    if (!room || !io) return;

    io.to(room).emit(eventName, {
        quiz_session_id: Number.parseInt(sessionId, 10),
        server_time_ms: Date.now(),
        ...payload,
    });
}

function buildScoreboard(members, questions, answers) {
    return members.map((member) => {
        const memberAnswers = answers.filter((answer) => String(answer.user_id) === String(member.user_id));
        const score = memberAnswers.reduce((total, answer) => total + Number(answer.score || 0), 0);
        const totalScore = score;
        const answeredQuestionIds = new Set(memberAnswers.map((answer) => String(answer.question_id)));

        return {
            user_id: member.user_id,
            name: member.name,
            avatar_public_path: member.avatar_public_path,
            correct_count: memberAnswers.filter((answer) => answer.is_correct).length,
            answered_count: memberAnswers.length,
            question_count: questions.length,
            finished: questions.length > 0 && questions.every((question) => answeredQuestionIds.has(String(question.question_id))),
            score,
            bonus_score: 0,
            total_score: totalScore,
        };
    }).sort((a, b) => b.total_score - a.total_score || b.correct_count - a.correct_count);
}

function getWinner(scoreboard) {
    if (!scoreboard.length) return null;
    const topScore = scoreboard[0].total_score;
    const winners = scoreboard.filter((item) => item.total_score === topScore);
    if (winners.length > 1) {
        return {
            is_tie: true,
            names: winners.map((winner) => winner.name),
            total_score: topScore,
        };
    }
    return {
        is_tie: false,
        user_id: scoreboard[0].user_id,
        name: scoreboard[0].name,
        total_score: topScore,
    };
}

function serializeQuestion(question, includeAnswer = false) {
    if (!question) return null;
    return {
        question_id: question.question_id,
        topic_id: question.topic_id,
        question_number: question.question_number,
        question_text: question.question_text,
        choices: question.choices || [],
        order_index: question.order_index,
        ...(includeAnswer ? {
            correct_answer_index: question.correct_answer_index,
            explanation: question.explanation,
        } : {}),
    };
}

function serializeAnswer(answer) {
    return {
        answer_id: answer.answer_id,
        quiz_session_id: answer.quiz_session_id,
        user_id: answer.user_id,
        name: answer.name,
        avatar_public_path: answer.avatar_public_path,
        question_id: answer.question_id,
        answer_index: answer.answer_index,
        is_correct: answer.is_correct,
        time_taken_seconds: answer.time_taken_seconds,
        time_left_seconds: answer.time_left_seconds,
        score: answer.score,
        bonus_score: answer.bonus_score,
        answered_at: answer.answered_at,
    };
}

function buildWrongAnswerFeedbackInput(questions, answers) {
    const questionMap = new Map((questions || []).map((question) => [String(question.question_id), question]));

    return (answers || [])
        .filter((answer) => !answer.is_correct && answer.answer_index !== null && answer.answer_index !== undefined)
        .map((answer) => {
            const question = questionMap.get(String(answer.question_id));
            if (!question) return null;

            return {
                user_id: Number(answer.user_id),
                student_name: answer.name,
                question_id: Number(question.question_id),
                question_text: question.question_text,
                chosen_answer: question.choices?.[answer.answer_index] || "",
                correct_answer: question.choices?.[question.correct_answer_index] || "",
            };
        })
        .filter(Boolean);
}

async function loadQuizSessionActivity(session, user) {
    if (!session) return {session: null, members: [], questions: [], answers: [], savedResult: null};

    const refreshed = session.status === "in_progress"
        ? await refreshQuizProgress(session.quiz_session_id)
        : session;
    const [members, questions, answers, savedResult] = await Promise.all([
        getQuizMembers(refreshed.quiz_session_id),
        getQuizQuestionsByIds(refreshed.question_ids),
        getQuizAnswers(refreshed.quiz_session_id),
        ["completed", "saved"].includes(refreshed.status) ? getQuizSavedResult(refreshed.quiz_session_id) : null,
    ]);

    return {session: refreshed, members, questions, answers, savedResult};
}

function normalizeQuizSession(session, members, questions, answers, userId, savedResult = null) {
    if (!session) return null;

    const safeMembers = members || [];
    const safeQuestions = questions || [];
    const safeAnswers = answers || [];
    const isMember = safeMembers.some((member) => String(member.user_id) === String(userId));
    const currentQuestion = safeQuestions[session.current_question_index] || null;
    const myCurrentAnswer = currentQuestion
        ? safeAnswers.find((answer) =>
            String(answer.user_id) === String(userId)
            && String(answer.question_id) === String(currentQuestion.question_id)
        )
        : null;
    const currentAnswers = currentQuestion
        ? safeAnswers.filter((answer) => String(answer.question_id) === String(currentQuestion.question_id))
        : [];
    const scoreboard = buildScoreboard(safeMembers, safeQuestions, safeAnswers);
    const includeFinalAnswers = ["completed", "saved"].includes(session.status);
    const questionStartedAt = session.question_started_at ? new Date(session.question_started_at).getTime() : null;
    const elapsedSeconds = questionStartedAt ? Math.max(0, Math.floor((Date.now() - questionStartedAt) / 1000)) : 0;
    const timeLeftSeconds = session.status === "in_progress"
        ? Math.max(0, QUESTION_TIME_SECONDS - elapsedSeconds)
        : QUESTION_TIME_SECONDS;

    return {
        server_time_ms: Date.now(),
        quiz_session_id: session.quiz_session_id,
        course_id: session.course_id,
        course_group_id: session.course_group_id,
        topic_id: session.topic_id,
        group_id: session.group_id,
        table_id: session.table_id,
        object_id: session.object_id,
        status: session.status,
        question_count: safeQuestions.length,
        question_time_seconds: QUESTION_TIME_SECONDS,
        question_reveal_seconds: QUESTION_REVEAL_SECONDS,
        current_question_index: session.current_question_index,
        question_started_at: session.question_started_at,
        question_completed_at: session.question_completed_at,
        time_left_seconds: timeLeftSeconds,
        is_host: String(session.hosted_by) === String(userId),
        hosted_by: session.hosted_by,
        is_member: isMember,
        member_count: safeMembers.length,
        max_members: MAX_QUIZ_MEMBERS,
        is_full: safeMembers.length >= MAX_QUIZ_MEMBERS,
        can_start: String(session.hosted_by) === String(userId)
            && session.status === "lobby"
            && safeMembers.length === MAX_QUIZ_MEMBERS,
        can_save: isMember && session.status === "completed",
        saved_by: session.saved_by,
        saved_at: session.saved_at,
        members: safeMembers.map((member) => ({
            member_id: member.member_id,
            user_id: member.user_id,
            name: member.name,
            email: member.email,
            avatar_public_path: member.avatar_public_path,
            joined_at: member.joined_at,
            last_seen_at: member.last_seen_at,
            is_host: String(member.user_id) === String(session.hosted_by),
        })),
        current_question: currentQuestion
            ? serializeQuestion(currentQuestion, !!myCurrentAnswer || includeFinalAnswers)
            : null,
        my_current_answer: myCurrentAnswer ? serializeAnswer(myCurrentAnswer) : null,
        current_statuses: safeMembers.map((member) => {
            const answer = currentAnswers.find((item) => String(item.user_id) === String(member.user_id));
            return {
                user_id: member.user_id,
                name: member.name,
                status: answer ? "answered" : "working",
            };
        }),
        questions: includeFinalAnswers
            ? safeQuestions.map((question) => serializeQuestion(question, true))
            : [],
        answers: includeFinalAnswers
            ? safeAnswers.map(serializeAnswer)
            : safeAnswers
                .filter((answer) => String(answer.user_id) === String(userId))
                .map(serializeAnswer),
        scoreboard,
        winner: includeFinalAnswers ? getWinner(scoreboard) : null,
        wrong_answer_feedback: savedResult?.results_json?.wrong_answer_feedback || [],
        wrong_answer_feedback_model: savedResult?.results_json?.wrong_answer_feedback_model || null,
        wrong_answer_feedback_error: savedResult?.results_json?.wrong_answer_feedback_error || null,
        save_status: session.save_status || (session.status === "saved" ? "saved" : "idle"),
        save_started_at: session.save_started_at || null,
        save_error: session.save_error || null,
        is_saving_result: session.save_status === "saving",
        created_at: session.created_at,
        updated_at: session.updated_at,
        ended_at: session.ended_at,
    };
}

async function hydrateSession(session, user) {
    const activity = await loadQuizSessionActivity(session, user);
    return normalizeQuizSession(
        activity.session,
        activity.members,
        activity.questions,
        activity.answers,
        user.user_id,
        activity.savedResult
    );
}

export async function getQuizContext(req, res) {
    try {
        await ensureQuizActivityTables();
        const user = await getAuthenticatedUser(req, res);
        if (!user) return;

        const groupId = normalizeGroupId(req.query.group_id || req.query.table_id);
        const tableId = normalizeTableId(groupId || req.query.table_id || req.query.object_id);
        const [course, topics, activeSession] = await Promise.all([
            getCourseById(user.course_id),
            getTopicsForCourse(user.course_id),
            getActiveQuizSession(user.course_id, tableId, user.course_group_id || null),
        ]);

        res.json({
            course,
            topics,
            group_id: groupId,
            table_id: tableId,
            object_id: req.query.object_id || null,
            max_members: MAX_QUIZ_MEMBERS,
            question_count: QUESTION_COUNT,
            question_time_seconds: QUESTION_TIME_SECONDS,
            question_reveal_seconds: QUESTION_REVEAL_SECONDS,
            question_start_delay_seconds: QUESTION_START_DELAY_SECONDS,
            gamification_enabled: !!user.gamification_enabled,
            active_session: activeSession ? await hydrateSession(activeSession, user) : null,
        });
    } catch (error) {
        console.error("Quiz context error:", error);
        res.status(500).json({message: "Gagal memuat quiz"});
    }
}

export async function startQuizLobby(req, res) {
    try {
        await ensureQuizActivityTables();
        const user = await getAuthenticatedUser(req, res);
        if (!user) return;

        const groupId = normalizeGroupId(req.body.group_id || req.body.table_id);
        const tableId = normalizeTableId(groupId || req.body.table_id || req.body.object_id);
        const activeSession = await getActiveQuizSession(user.course_id, tableId, user.course_group_id || null);
        if (activeSession) {
            return res.status(409).json({
                message: "Quiz di meja ini sudah aktif. Silakan join.",
                active_session: await hydrateSession(activeSession, user),
            });
        }

        const [course, topic] = await Promise.all([
            getCourseById(user.course_id),
            getTopicById(req.body.topic_id, user.course_id),
        ]);
        if (!course) return res.status(400).json({message: "Course tidak ditemukan"});
        if (!topic) return res.status(400).json({message: "Pilih topic terlebih dahulu"});

        const questions = await getQuizQuestionsForTopic(topic.topic_id);
        if (questions.length < QUESTION_COUNT) {
            return res.status(409).json({message: "Question bank belum cukup untuk topic ini"});
        }

        const session = await createQuizSession({
            course,
            topic,
            groupId,
            tableId,
            objectId: req.body.object_id,
            user,
            questions,
        });

        res.status(201).json({
            message: "Quiz lobby berhasil dibuat",
            session: await hydrateSession(session, user),
        });
    } catch (error) {
        if (error.code === "ACTIVE_QUIZ_EXISTS" || error.code === "23505") {
            return res.status(409).json({message: "Quiz di meja ini sudah aktif. Silakan join."});
        }
        console.error("Start quiz lobby error:", error);
        res.status(500).json({message: "Gagal membuat quiz lobby"});
    }
}

export async function joinQuizSession(req, res) {
    try {
        await ensureQuizActivityTables();
        const user = await getAuthenticatedUser(req, res);
        if (!user) return;

        const session = await getQuizSessionById(req.params.sessionId);
        if (!session || String(session.course_id) !== String(user.course_id) || !sameCourseGroup(session, user)) {
            return res.status(404).json({message: "Quiz tidak ditemukan"});
        }
        if (!["lobby", "in_progress"].includes(session.status)) {
            return res.status(409).json({message: "Quiz ini sudah selesai"});
        }

        const joinResult = await joinQuizMemberWithLimit(session.quiz_session_id, user, MAX_QUIZ_MEMBERS);
        if (joinResult.reason === "FULL") {
            return res.status(409).json({message: "Meja quiz sudah penuh"});
        }
        if (joinResult.reason === "NOT_JOINABLE") {
            return res.status(409).json({message: "Quiz ini sudah selesai"});
        }

        const updated = await getQuizSessionById(session.quiz_session_id);
        emitQuizEvent(req, session.quiz_session_id, "quiz:lobby_updated", {status: updated?.status || session.status});
        res.json({
            message: "Berhasil join quiz",
            session: await hydrateSession(updated, user),
        });
    } catch (error) {
        console.error("Join quiz error:", error);
        res.status(500).json({message: "Gagal join quiz"});
    }
}

export async function getQuizSession(req, res) {
    try {
        await ensureQuizActivityTables();
        const user = await getAuthenticatedUser(req, res);
        if (!user) return;

        const session = await getQuizSessionById(req.params.sessionId);
        if (!session || String(session.course_id) !== String(user.course_id) || !sameCourseGroup(session, user)) {
            return res.status(404).json({message: "Quiz tidak ditemukan"});
        }

        res.json({session: await hydrateSession(session, user)});
    } catch (error) {
        console.error("Get quiz session error:", error);
        res.status(500).json({message: "Gagal memuat quiz session"});
    }
}

export async function heartbeatQuizSession(req, res) {
    try {
        await ensureQuizActivityTables();
        const user = await getAuthenticatedUser(req, res);
        if (!user) return;

        const session = await getQuizSessionById(req.params.sessionId);
        if (!session || String(session.course_id) !== String(user.course_id) || !sameCourseGroup(session, user)) {
            return res.status(404).json({message: "Quiz tidak ditemukan"});
        }

        const member = await touchQuizMember(session.quiz_session_id, user);
        if (!member) return res.status(403).json({message: "Join quiz terlebih dahulu"});

        const activity = await loadQuizSessionActivity(session, user);
        const updated = activity.session;
        if (
            updated
            && (
                updated.status !== session.status
                || updated.current_question_index !== session.current_question_index
                || String(updated.question_completed_at || "") !== String(session.question_completed_at || "")
            )
        ) {
            emitQuizEvent(req, session.quiz_session_id, "quiz:session_updated", {status: updated.status});
        }
        res.json({
            message: "Heartbeat diterima",
            session: normalizeQuizSession(
                activity.session,
                activity.members,
                activity.questions,
                activity.answers,
                user.user_id,
                activity.savedResult
            ),
        });
    } catch (error) {
        console.error("Quiz heartbeat error:", error);
        res.status(500).json({message: "Gagal memperbarui quiz"});
    }
}

export async function exitQuizSession(req, res) {
    try {
        await ensureQuizActivityTables();
        const user = await getAuthenticatedUser(req, res);
        if (!user) return;

        const session = await getQuizSessionById(req.params.sessionId);
        if (!session || String(session.course_id) !== String(user.course_id) || !sameCourseGroup(session, user)) {
            return res.status(404).json({message: "Quiz tidak ditemukan"});
        }

        const members = await getQuizMembers(session.quiz_session_id);
        const isMember = members.some((member) => String(member.user_id) === String(user.user_id));
        if (!isMember) return res.status(403).json({message: "Join quiz terlebih dahulu"});

        const exitResult = await exitQuizMember(session.quiz_session_id, user.user_id);
        if (!exitResult) return res.status(404).json({message: "Quiz tidak ditemukan"});
        emitQuizEvent(
            req,
            session.quiz_session_id,
            exitResult.cancelled ? "quiz:lobby_cancelled" : "quiz:lobby_updated",
            {status: exitResult.session?.status || null}
        );

        res.json({
            message: exitResult.cancelled ? "Quiz lobby dibatalkan" : "Berhasil keluar dari quiz",
            session: exitResult.cancelled ? null : await hydrateSession(exitResult.session, user),
        });
    } catch (error) {
        console.error("Exit quiz error:", error);
        if (error.code === "QUIZ_ALREADY_STARTED") {
            return res.status(409).json({message: "Quiz sudah dimulai. Selesaikan quiz terlebih dahulu."});
        }
        res.status(500).json({message: "Gagal keluar dari quiz"});
    }
}

export async function beginQuiz(req, res) {
    try {
        await ensureQuizActivityTables();
        const user = await getAuthenticatedUser(req, res);
        if (!user) return;

        const session = await getQuizSessionById(req.params.sessionId);
        if (!session || String(session.course_id) !== String(user.course_id) || !sameCourseGroup(session, user)) {
            return res.status(404).json({message: "Quiz tidak ditemukan"});
        }

        const updated = await startQuizSession(session.quiz_session_id, user.user_id);
        if (!updated) {
            return res.status(409).json({message: "Host hanya bisa start setelah dua user join"});
        }

        emitQuizEvent(req, updated.quiz_session_id, "quiz:starting", {
            status: updated.status,
            question_started_at: updated.question_started_at,
            delay_seconds: QUESTION_START_DELAY_SECONDS,
        });

        res.json({
            message: "Quiz dimulai",
            session: await hydrateSession(updated, user),
        });
    } catch (error) {
        console.error("Begin quiz error:", error);
        res.status(500).json({message: "Gagal memulai quiz"});
    }
}

export async function answerQuizQuestion(req, res) {
    try {
        await ensureQuizActivityTables();
        const user = await getAuthenticatedUser(req, res);
        if (!user) return;

        const session = await getQuizSessionById(req.params.sessionId);
        if (!session || String(session.course_id) !== String(user.course_id) || !sameCourseGroup(session, user)) {
            return res.status(404).json({message: "Quiz tidak ditemukan"});
        }

        const members = await getQuizMembers(session.quiz_session_id);
        const isMember = members.some((member) => String(member.user_id) === String(user.user_id));
        if (!isMember) return res.status(403).json({message: "Join quiz terlebih dahulu"});
        if (session.status !== "in_progress") return res.status(409).json({message: "Quiz belum berjalan"});

        const {session: updated, reason} = await submitQuizAnswer(session, user, req.body.answer_index);
        if (reason === "QUESTION_NOT_STARTED") {
            return res.status(409).json({
                message: "Pertanyaan belum dimulai",
                session: await hydrateSession(updated || session, user),
            });
        }
        emitQuizEvent(req, session.quiz_session_id, "quiz:answer_updated", {status: updated?.status || session.status});
        res.json({
            message: "Jawaban quiz diterima",
            session: await hydrateSession(updated || session, user),
        });
    } catch (error) {
        console.error("Answer quiz error:", error);
        res.status(500).json({message: "Gagal menyimpan jawaban quiz"});
    }
}

export async function saveQuizSessionResult(req, res) {
    try {
        await ensureQuizActivityTables();
        const user = await getAuthenticatedUser(req, res);
        if (!user) return;

        const session = await getQuizSessionById(req.params.sessionId);
        if (!session || String(session.course_id) !== String(user.course_id) || !sameCourseGroup(session, user)) {
            return res.status(404).json({message: "Quiz tidak ditemukan"});
        }

        const activity = await loadQuizSessionActivity(session, user);
        const isMember = activity.members.some((member) => String(member.user_id) === String(user.user_id));
        if (!isMember) return res.status(403).json({message: "Join quiz terlebih dahulu"});
        if (!["completed", "saved"].includes(activity.session.status)) {
            return res.status(409).json({message: "Quiz belum selesai"});
        }
        const saveLock = await beginQuizResultSave(activity.session.quiz_session_id);
        if (saveLock.reason === "ALREADY_SAVED") {
            return res.json({
                message: "Hasil quiz sudah tersimpan",
                session: await hydrateSession(saveLock.session, user),
            });
        }
        if (saveLock.reason === "SAVING") {
            return res.json({
                message: "Hasil quiz sedang disimpan. Mohon tunggu.",
                session: await hydrateSession(saveLock.session, user),
            });
        }
        if (saveLock.reason !== "STARTED") {
            return res.status(409).json({
                message: "Quiz belum bisa disimpan saat ini",
                session: await hydrateSession(saveLock.session || activity.session, user),
            });
        }

        const normalized = normalizeQuizSession(
            saveLock.session,
            activity.members,
            activity.questions,
            activity.answers,
            user.user_id,
            activity.savedResult
        );

        let wrongAnswerFeedback = [];
        let wrongAnswerFeedbackModel = null;
        let wrongAnswerFeedbackError = null;
        const wrongAnswerItems = buildWrongAnswerFeedbackInput(activity.questions, activity.answers);
        if (wrongAnswerItems.length > 0) {
            try {
                const feedbackResult = await generateQuizWrongAnswerFeedback({items: wrongAnswerItems});
                wrongAnswerFeedback = feedbackResult.feedback;
                wrongAnswerFeedbackModel = feedbackResult.model;
            } catch (error) {
                wrongAnswerFeedbackError = error.message || "Gagal membuat feedback quiz";
            }
        }

        const saved = await saveQuizResult(
            saveLock.session.quiz_session_id,
            user.user_id,
            normalized.questions,
            normalized.answers,
            {
                scoreboard: normalized.scoreboard,
                winner: normalized.winner,
                wrong_answer_feedback: wrongAnswerFeedback,
                wrong_answer_feedback_model: wrongAnswerFeedbackModel,
                wrong_answer_feedback_error: wrongAnswerFeedbackError,
                saved_at: new Date().toISOString(),
            }
        );

        emitQuizEvent(req, saveLock.session.quiz_session_id, "quiz:result_saved", {status: saved?.status || "saved"});

        res.json({
            message: "Hasil quiz tersimpan",
            session: await hydrateSession(saved || activity.session, user),
        });
    } catch (error) {
        console.error("Save quiz result error:", error);
        res.status(500).json({message: "Gagal menyimpan hasil quiz"});
    }
}

export async function retryQuizFeedback(req, res) {
    try {
        await ensureQuizActivityTables();
        const user = await getAuthenticatedUser(req, res);
        if (!user) return;

        const session = await getQuizSessionById(req.params.sessionId);
        if (!session || String(session.course_id) !== String(user.course_id) || !sameCourseGroup(session, user)) {
            return res.status(404).json({message: "Quiz tidak ditemukan"});
        }

        const activity = await loadQuizSessionActivity(session, user);
        const isMember = activity.members.some((member) => String(member.user_id) === String(user.user_id));
        if (!isMember) return res.status(403).json({message: "Join quiz terlebih dahulu"});
        if (activity.session.status !== "saved" || !activity.savedResult) {
            return res.status(409).json({message: "Hasil quiz belum tersimpan"});
        }
        const retryLock = await beginQuizFeedbackRetry(activity.session.quiz_session_id);
        if (retryLock.reason === "SAVING") {
            return res.json({
                message: "Feedback AI sedang dibuat. Mohon tunggu.",
                session: await hydrateSession(retryLock.session, user),
            });
        }
        if (retryLock.reason !== "STARTED") {
            return res.status(409).json({
                message: "Feedback AI belum bisa dicoba ulang saat ini.",
                session: await hydrateSession(retryLock.session || activity.session, user),
            });
        }

        let wrongAnswerFeedback = [];
        let wrongAnswerFeedbackModel = null;
        let wrongAnswerFeedbackError = null;
        const wrongAnswerItems = buildWrongAnswerFeedbackInput(activity.questions, activity.answers);
        if (wrongAnswerItems.length > 0) {
            try {
                const feedbackResult = await generateQuizWrongAnswerFeedback({items: wrongAnswerItems});
                wrongAnswerFeedback = feedbackResult.feedback;
                wrongAnswerFeedbackModel = feedbackResult.model;
            } catch (error) {
                wrongAnswerFeedbackError = error.message || "Gagal membuat feedback quiz";
            }
        }

        await updateQuizResultFeedback(retryLock.session.quiz_session_id, {
            wrong_answer_feedback: wrongAnswerFeedback,
            wrong_answer_feedback_model: wrongAnswerFeedbackModel,
            wrong_answer_feedback_error: wrongAnswerFeedbackError,
            feedback_retried_at: new Date().toISOString(),
        });
        emitQuizEvent(req, retryLock.session.quiz_session_id, "quiz:result_saved", {status: "saved"});
        const updatedSession = await getQuizSessionById(retryLock.session.quiz_session_id);

        res.json({
            message: wrongAnswerFeedbackError ? "Feedback AI masih gagal dibuat." : "Feedback AI berhasil dibuat ulang.",
            session: await hydrateSession(updatedSession || retryLock.session, user),
        });
    } catch (error) {
        console.error("Retry quiz feedback error:", error);
        res.status(500).json({message: "Gagal mencoba ulang feedback quiz"});
    }
}
