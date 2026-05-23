import {findSession} from "../models/sessionModel.js";
import {
    ACTIVITY_TYPES,
    cancelIndividualSession,
    completeIndividualSession,
    createIndividualSession,
    ensureIndividualActivityTables,
    getIndividualActivityDuration,
    getActiveIndividualSession,
    getActiveIndividualSessionForObject,
    getCompletedIndividualAssessmentsForTopics,
    getIndividualAnswers,
    getIndividualQuestionCount,
    getIndividualQuestions,
    getIndividualQuestionsByIds,
    getIndividualSessionById,
    hasCompletedIndividualAssessment,
    MC_QUESTION_COUNT,
    ASSESSMENT_QUESTION_COUNT,
    saveIndividualCaseAnswer,
    saveIndividualMcAnswer,
    advanceIndividualSession,
    updateIndividualTopicSettings,
    upsertIndividualXpScore,
} from "../models/individualActivityModel.js";
import {
    getCourseById,
    getTopicById,
    getTopicByIdIncludingHidden,
    getTopicsForCourse,
    updateTopicVisibility,
} from "../models/tableActivityModel.js";
import {
    generateIndividualCaseFeedback,
    generateQuizWrongAnswerFeedback,
} from "../services/openaiFeedbackService.js";

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

function normalizeObjectId(value) {
    return String(value || "computer").trim() || "computer";
}

function normalizeActivityType(value) {
    return ACTIVITY_TYPES.includes(value) ? value : null;
}

function normalizeQuestionKind(activityType, value) {
    if (activityType === "pre_test" || activityType === "post_test") return "multiple_choice";
    return value === "case_study" ? "case_study" : "multiple_choice";
}

function serializeQuestion(question, includeAnswer = false) {
    if (!question) return null;
    return {
        question_id: question.question_id,
        topic_id: question.topic_id,
        activity_type: question.activity_type,
        question_kind: question.question_kind,
        question_number: question.question_number,
        question_text: question.question_text,
        choices: question.choices || [],
        case_title: question.case_title,
        case_prompt: question.case_prompt,
        ...(includeAnswer ? {
            correct_answer_index: question.correct_answer_index,
            explanation: question.explanation,
        } : {}),
    };
}

function serializeAnswer(answer, includeAnswerValue = true) {
    const serialized = {
        answer_id: answer.answer_id,
        session_id: answer.session_id,
        question_id: answer.question_id,
        user_id: answer.user_id,
        is_correct: answer.is_correct,
        score: answer.score,
        xp_earned: answer.xp_earned,
        answered_at: answer.answered_at,
    };
    if (includeAnswerValue) {
        serialized.answer_index = answer.answer_index;
        serialized.answer_text = answer.answer_text;
    }
    return serialized;
}

function canRevealIndividualCorrectAnswers(session) {
    return session?.activity_type === "exercise";
}

function getIndividualTimer(session) {
    if (!session) {
        return {
            duration_seconds: 0,
            seconds_spent: 0,
            seconds_left: 0,
            timer_expires_at: null,
            is_time_up: false,
        };
    }

    const durationSeconds = Number(session.duration_seconds)
        || getIndividualActivityDuration(session.activity_type, session.question_kind);
    const startedAt = session.started_at ? new Date(session.started_at).getTime() : Date.now();
    const elapsedSeconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
    const isRunning = session.status === "in_progress";
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
        timer_expires_at: new Date(startedAt + durationSeconds * 1000).toISOString(),
        is_time_up: isRunning && secondsLeft <= 0,
    };
}

function isIndividualSessionTimeUp(session) {
    return getIndividualTimer(session).is_time_up;
}

function buildWrongAnswerFeedbackInput(session, questions, answers, user) {
    const questionMap = new Map((questions || []).map((question) => [String(question.question_id), question]));

    return (answers || [])
        .filter((answer) => !answer.is_correct && answer.answer_index !== null && answer.answer_index !== undefined)
        .map((answer) => {
            const question = questionMap.get(String(answer.question_id));
            if (!question) return null;
            return {
                user_id: Number(user.user_id),
                student_name: user.name,
                question_id: Number(question.question_id),
                question_text: question.question_text,
                chosen_answer: question.choices?.[answer.answer_index] || "",
                correct_answer: question.choices?.[question.correct_answer_index] || "",
            };
        })
        .filter(Boolean);
}

async function loadIndividualSession(session, user) {
    if (!session) return {session: null, questions: [], answers: []};
    const [questions, answers] = await Promise.all([
        getIndividualQuestionsByIds(session.question_ids),
        getIndividualAnswers(session.session_id),
    ]);
    return {session, questions, answers};
}

async function completeCaseSession(session, caseQuestion, user, answerText, options = {}) {
    const trimmedAnswer = String(answerText || "").trim();

    await saveIndividualCaseAnswer({
        sessionId: session.session_id,
        userId: user.user_id,
        questionId: caseQuestion.question_id,
        answerText: trimmedAnswer,
    });

    let feedback;
    let model = null;
    if (trimmedAnswer.length >= 20) {
        try {
            const feedbackResult = await generateIndividualCaseFeedback({
                caseTitle: caseQuestion.case_title,
                casePrompt: caseQuestion.case_prompt,
                answerText: trimmedAnswer,
            });
            feedback = feedbackResult.feedback;
            model = feedbackResult.model;
        } catch (error) {
            feedback = {
                www: "",
                ebi: "",
                xp: 0,
                xp_reason: "0 XP disimpan karena feedback AI gagal dibuat.",
                error: error.message || "Gagal membuat feedback",
            };
        }
    } else {
        feedback = {
            www: "",
            ebi: options.timedOut
                ? "Waktu habis sebelum jawaban cukup lengkap untuk dievaluasi."
                : "Jawaban belum cukup panjang untuk dievaluasi.",
            xp: 0,
            xp_reason: "0 XP karena jawaban belum cukup lengkap untuk dievaluasi.",
        };
    }

    const resultJson = {
        question_count: 1,
        answered_count: trimmedAnswer ? 1 : 0,
        correct_count: 0,
        score_total: 0,
        xp_total: user.gamification_enabled ? feedback.xp : 0,
        case_feedback: feedback,
        timed_out: !!options.timedOut,
    };
    const completed = await completeIndividualSession({
        sessionId: session.session_id,
        resultJson,
        feedbackJson: feedback,
        feedbackModel: model,
        feedbackError: feedback.error || null,
        xpTotal: user.gamification_enabled ? feedback.xp : 0,
    });
    if (user.gamification_enabled) {
        await upsertIndividualXpScore(session, feedback.xp, feedback.xp_reason);
    }

    return completed;
}

function normalizeSession(session, questions, answers, user, options = {}) {
    if (!session) return null;

    const includeFinalAnswers = session.status === "completed";
    const revealCorrectAnswers = canRevealIndividualCorrectAnswers(session);
    const currentQuestion = questions[session.current_question_index] || null;
    const currentAnswer = currentQuestion
        ? answers.find((answer) => String(answer.question_id) === String(currentQuestion.question_id))
        : null;
    const resultJson = session.result_json || {};
    const feedbackJson = session.feedback_json || null;
    const showGamification = !!user.gamification_enabled;
    const timer = getIndividualTimer(session);

    return {
        session_id: session.session_id,
        course_id: session.course_id,
        topic_id: session.topic_id,
        user_id: session.user_id,
        object_id: session.object_id,
        activity_type: session.activity_type,
        question_kind: session.question_kind,
        status: session.status,
        question_count: questions.length,
        current_question_index: session.current_question_index,
        current_question: currentQuestion ? serializeQuestion(
            currentQuestion,
            session.question_kind === "case_study" || (revealCorrectAnswers && (!!currentAnswer || includeFinalAnswers))
        ) : null,
        current_answer: currentAnswer ? serializeAnswer(currentAnswer, revealCorrectAnswers) : null,
        questions: includeFinalAnswers ? questions.map((question) => serializeQuestion(question, revealCorrectAnswers)) : [],
        answers: answers.map((answer) => serializeAnswer(answer, revealCorrectAnswers)),
        correct_count: session.correct_count || resultJson.correct_count || 0,
        score_total: session.score_total || resultJson.score_total || 0,
        xp_total: session.xp_total || resultJson.xp_total || 0,
        result: resultJson,
        feedback: feedbackJson,
        feedback_model: session.feedback_model,
        feedback_status: session.feedback_status,
        feedback_error: session.feedback_error,
        gamification_enabled: showGamification,
        ...timer,
        started_at: session.started_at,
        completed_at: session.completed_at,
        ...options,
    };
}

async function completeMultipleChoiceSession(session, questions, user, options = {}) {
    const answers = await getIndividualAnswers(session.session_id);
    const correctCount = answers.filter((answer) => answer.is_correct).length;
    const scoreTotal = answers.reduce((total, answer) => total + Number(answer.score || 0), 0);
    const xpTotal = answers.reduce((total, answer) => total + Number(answer.xp_earned || 0), 0);
    let wrongAnswerFeedback = [];
    let wrongAnswerFeedbackModel = null;
    let wrongAnswerFeedbackError = null;

    if (session.activity_type === "exercise") {
        const wrongItems = buildWrongAnswerFeedbackInput(session, questions, answers, user);
        if (wrongItems.length > 0) {
            try {
                const feedbackResult = await generateQuizWrongAnswerFeedback({items: wrongItems});
                wrongAnswerFeedback = feedbackResult.feedback;
                wrongAnswerFeedbackModel = feedbackResult.model;
            } catch (error) {
                wrongAnswerFeedbackError = error.message || "Gagal membuat feedback";
            }
        }
        if (user.gamification_enabled) {
            await upsertIndividualXpScore(session, xpTotal, `${correctCount}/${questions.length} multiple-choice answers correct.`);
        }
    }

    const resultJson = {
        question_count: questions.length,
        answered_count: answers.length,
        correct_count: correctCount,
        score_total: scoreTotal,
        xp_total: xpTotal,
        wrong_answer_feedback: wrongAnswerFeedback,
        wrong_answer_feedback_model: wrongAnswerFeedbackModel,
        wrong_answer_feedback_error: wrongAnswerFeedbackError,
        timed_out: !!options.timedOut,
    };

    return completeIndividualSession({
        sessionId: session.session_id,
        resultJson,
        feedbackJson: session.activity_type === "exercise" ? {wrong_answer_feedback: wrongAnswerFeedback} : null,
        feedbackModel: wrongAnswerFeedbackModel,
        feedbackError: wrongAnswerFeedbackError,
        xpTotal,
    });
}

async function completeTimedOutIndividualSession(session, questions, user, answerText = "") {
    if (session.status !== "in_progress") return session;
    if (session.question_kind === "case_study") {
        const caseQuestion = questions[0];
        if (!caseQuestion) return session;
        return completeCaseSession(session, caseQuestion, user, answerText, {timedOut: true});
    }
    return completeMultipleChoiceSession(session, questions, user, {timedOut: true});
}

export async function getIndividualContext(req, res) {
    try {
        await ensureIndividualActivityTables();
        const user = await getAuthenticatedUser(req, res);
        if (!user) return;

        const objectId = normalizeObjectId(req.query.object_id);
        const includeHiddenTopics = req.query.admin === "1";
        const [course, topics, activeSession] = await Promise.all([
            getCourseById(user.course_id),
            getTopicsForCourse(user.course_id, {includeHidden: includeHiddenTopics}),
            getActiveIndividualSession({courseId: user.course_id, userId: user.user_id, objectId}),
        ]);

        const completionMap = await getCompletedIndividualAssessmentsForTopics({
            courseId: user.course_id,
            userId: user.user_id,
            topics,
        });
        let effectiveActiveSession = activeSession;
        if (effectiveActiveSession && isIndividualSessionTimeUp(effectiveActiveSession)) {
            const questions = await getIndividualQuestionsByIds(effectiveActiveSession.question_ids);
            effectiveActiveSession = await completeTimedOutIndividualSession(effectiveActiveSession, questions, user);
        }
        const activity = effectiveActiveSession ? await loadIndividualSession(effectiveActiveSession, user) : null;

        res.json({
            course,
            object_id: objectId,
            topics: topics.map((topic) => {
                const completion = completionMap.get(Number(topic.topic_id)) || {};
                return {
                    ...topic,
                    show_topic: topic.show_topic !== false,
                    show_pre_test: topic.show_pre_test !== false,
                    show_post_test: topic.show_post_test !== false,
                    pre_test_completed: completion.pre_test_completed === true,
                    post_test_completed: completion.post_test_completed === true,
                };
            }),
            gamification_enabled: !!user.gamification_enabled,
            mc_question_count: MC_QUESTION_COUNT,
            assessment_question_count: ASSESSMENT_QUESTION_COUNT,
            active_session: activity && activity.session?.status === "in_progress"
                ? normalizeSession(activity.session, activity.questions, activity.answers, user)
                : null,
        });
    } catch (error) {
        console.error("Individual context error:", error);
        res.status(500).json({message: "Gagal memuat aktivitas individual"});
    }
}

export async function startIndividualSession(req, res) {
    try {
        await ensureIndividualActivityTables();
        const user = await getAuthenticatedUser(req, res);
        if (!user) return;

        const objectId = normalizeObjectId(req.body.object_id);
        const activeObjectSession = await getActiveIndividualSessionForObject({courseId: user.course_id, objectId});
        if (activeObjectSession) {
            if (String(activeObjectSession.user_id) !== String(user.user_id)) {
                return res.status(409).json({
                    message: `${activeObjectSession.user_name || "Student lain"} sedang menggunakan komputer ini. Silakan pilih komputer lain.`,
                    reason: "COMPUTER_IN_USE",
                });
            }

            const activity = await loadIndividualSession(activeObjectSession, user);
            return res.status(409).json({
                message: "Masih ada aktivitas individual aktif di komputer ini.",
                active_session: normalizeSession(activity.session, activity.questions, activity.answers, user),
            });
        }

        const activeSession = await getActiveIndividualSession({courseId: user.course_id, userId: user.user_id, objectId});
        if (activeSession) {
            const activity = await loadIndividualSession(activeSession, user);
            return res.status(409).json({
                message: "Masih ada aktivitas individual aktif di komputer ini.",
                active_session: normalizeSession(activity.session, activity.questions, activity.answers, user),
            });
        }

        const activityType = normalizeActivityType(req.body.activity_type);
        if (!activityType) return res.status(400).json({message: "Tipe aktivitas tidak valid"});

        const questionKind = normalizeQuestionKind(activityType, req.body.question_kind);
        const [course, topic] = await Promise.all([
            getCourseById(user.course_id),
            getTopicById(req.body.topic_id, user.course_id),
        ]);
        if (!course) return res.status(400).json({message: "Course tidak ditemukan"});
        if (!topic) return res.status(400).json({message: "Pilih topic terlebih dahulu"});

        if (activityType === "pre_test" && topic.show_pre_test === false) {
            return res.status(403).json({message: "Pre-test belum dibuka untuk topic ini"});
        }
        if (activityType === "post_test" && topic.show_post_test === false) {
            return res.status(403).json({message: "Post-test belum dibuka untuk topic ini"});
        }
        if (["pre_test", "post_test"].includes(activityType)) {
            const alreadyCompleted = await hasCompletedIndividualAssessment({
                courseId: user.course_id,
                userId: user.user_id,
                topicId: topic.topic_id,
                activityType,
            });
            if (alreadyCompleted) {
                return res.status(409).json({
                    message: `${activityType === "pre_test" ? "Pre-test" : "Post-test"} untuk topic ini sudah pernah dikerjakan dan hanya bisa dilakukan satu kali.`,
                });
            }
        }

        const questions = await getIndividualQuestions({
            courseId: user.course_id,
            topicId: topic.topic_id,
            userId: user.user_id,
            activityType,
            questionKind,
        });
        const expectedCount = getIndividualQuestionCount(activityType, questionKind);
        if (questions.length < expectedCount) {
            return res.status(409).json({message: "Question bank belum cukup untuk aktivitas ini"});
        }

        const session = await createIndividualSession({
            courseId: course.course_id,
            topicId: topic.topic_id,
            userId: user.user_id,
            objectId,
            activityType,
            questionKind,
            questions,
        });
        const activity = await loadIndividualSession(session, user);

        res.status(201).json({
            message: "Aktivitas individual dimulai",
            session: normalizeSession(activity.session, activity.questions, activity.answers, user),
        });
    } catch (error) {
        if (error.code === "23505") {
            return res.status(409).json({message: "Masih ada aktivitas individual aktif di komputer ini."});
        }
        console.error("Start individual session error:", error);
        res.status(500).json({message: "Gagal memulai aktivitas individual"});
    }
}

export async function getIndividualSession(req, res) {
    try {
        await ensureIndividualActivityTables();
        const user = await getAuthenticatedUser(req, res);
        if (!user) return;

        const session = await getIndividualSessionById(req.params.sessionId);
        if (!session || String(session.user_id) !== String(user.user_id) || String(session.course_id) !== String(user.course_id)) {
            return res.status(404).json({message: "Session tidak ditemukan"});
        }

        let effectiveSession = session;
        if (isIndividualSessionTimeUp(effectiveSession)) {
            const questions = await getIndividualQuestionsByIds(effectiveSession.question_ids);
            effectiveSession = await completeTimedOutIndividualSession(effectiveSession, questions, user);
        }
        const activity = await loadIndividualSession(effectiveSession, user);
        res.json({session: normalizeSession(activity.session, activity.questions, activity.answers, user)});
    } catch (error) {
        console.error("Get individual session error:", error);
        res.status(500).json({message: "Gagal memuat session"});
    }
}

export async function answerIndividualQuestion(req, res) {
    try {
        await ensureIndividualActivityTables();
        const user = await getAuthenticatedUser(req, res);
        if (!user) return;

        const session = await getIndividualSessionById(req.params.sessionId);
        if (!session || String(session.user_id) !== String(user.user_id) || String(session.course_id) !== String(user.course_id)) {
            return res.status(404).json({message: "Session tidak ditemukan"});
        }
        if (session.status !== "in_progress" || session.question_kind !== "multiple_choice") {
            return res.status(409).json({message: "Session tidak bisa dijawab saat ini"});
        }

        const questions = await getIndividualQuestionsByIds(session.question_ids);
        if (isIndividualSessionTimeUp(session)) {
            const completed = await completeTimedOutIndividualSession(session, questions, user);
            const activity = await loadIndividualSession(completed, user);
            return res.status(409).json({
                message: "Waktu aktivitas sudah habis.",
                session: normalizeSession(activity.session, activity.questions, activity.answers, user),
            });
        }
        const currentQuestion = questions[session.current_question_index];
        if (!currentQuestion) return res.status(409).json({message: "Pertanyaan tidak tersedia"});

        const existingAnswers = await getIndividualAnswers(session.session_id);
        const alreadyAnswered = existingAnswers.some((answer) => String(answer.question_id) === String(currentQuestion.question_id));
        if (alreadyAnswered) {
            const activity = await loadIndividualSession(session, user);
            return res.status(409).json({
                message: "Pertanyaan ini sudah dijawab.",
                session: normalizeSession(activity.session, activity.questions, activity.answers, user),
            });
        }

        await saveIndividualMcAnswer({
            session,
            question: currentQuestion,
            userId: user.user_id,
            answerIndex: req.body.answer_index,
            awardXp: !!user.gamification_enabled,
        });

        const isLastQuestion = session.current_question_index >= questions.length - 1;
        const updatedSession = isLastQuestion
            ? await completeMultipleChoiceSession(session, questions, user)
            : await advanceIndividualSession(session.session_id);
        const activity = await loadIndividualSession(updatedSession, user);

        res.json({
            message: isLastQuestion ? "Aktivitas selesai" : "Jawaban tersimpan",
            session: normalizeSession(activity.session, activity.questions, activity.answers, user),
        });
    } catch (error) {
        console.error("Answer individual question error:", error);
        res.status(500).json({message: "Gagal menyimpan jawaban"});
    }
}

export async function submitIndividualCase(req, res) {
    try {
        await ensureIndividualActivityTables();
        const user = await getAuthenticatedUser(req, res);
        if (!user) return;

        const session = await getIndividualSessionById(req.params.sessionId);
        if (!session || String(session.user_id) !== String(user.user_id) || String(session.course_id) !== String(user.course_id)) {
            return res.status(404).json({message: "Session tidak ditemukan"});
        }
        if (session.status !== "in_progress" || session.question_kind !== "case_study") {
            return res.status(409).json({message: "Session tidak bisa disubmit saat ini"});
        }

        const questions = await getIndividualQuestionsByIds(session.question_ids);
        const caseQuestion = questions[0];
        if (!caseQuestion) return res.status(409).json({message: "Case study tidak tersedia"});

        const answerText = String(req.body.answer_text || "").trim();
        const timedOut = isIndividualSessionTimeUp(session);
        if (!timedOut && answerText.length < 20) {
            return res.status(400).json({message: "Jawaban case study terlalu singkat"});
        }

        const completed = await completeCaseSession(session, caseQuestion, user, answerText, {timedOut});
        const activity = await loadIndividualSession(completed, user);
        res.json({
            message: timedOut ? "Waktu habis. Case study selesai." : "Case study selesai",
            session: normalizeSession(activity.session, activity.questions, activity.answers, user),
        });
    } catch (error) {
        console.error("Submit individual case error:", error);
        res.status(500).json({message: "Gagal submit case study"});
    }
}

export async function timeoutIndividualSession(req, res) {
    try {
        await ensureIndividualActivityTables();
        const user = await getAuthenticatedUser(req, res);
        if (!user) return;

        const session = await getIndividualSessionById(req.params.sessionId);
        if (!session || String(session.user_id) !== String(user.user_id) || String(session.course_id) !== String(user.course_id)) {
            return res.status(404).json({message: "Session tidak ditemukan"});
        }

        const questions = await getIndividualQuestionsByIds(session.question_ids);
        if (session.status !== "in_progress") {
            const activity = await loadIndividualSession(session, user);
            return res.json({
                message: "Session sudah selesai",
                session: normalizeSession(activity.session, activity.questions, activity.answers, user),
            });
        }

        if (!isIndividualSessionTimeUp(session)) {
            const activity = await loadIndividualSession(session, user);
            return res.json({
                message: "Timer masih berjalan",
                session: normalizeSession(activity.session, activity.questions, activity.answers, user),
            });
        }

        const completed = await completeTimedOutIndividualSession(session, questions, user, req.body.answer_text);
        const activity = await loadIndividualSession(completed, user);
        res.json({
            message: "Waktu aktivitas sudah habis.",
            session: normalizeSession(activity.session, activity.questions, activity.answers, user),
        });
    } catch (error) {
        console.error("Timeout individual session error:", error);
        res.status(500).json({message: "Gagal menyelesaikan aktivitas yang waktunya habis"});
    }
}

export async function exitIndividualSession(req, res) {
    try {
        await ensureIndividualActivityTables();
        const user = await getAuthenticatedUser(req, res);
        if (!user) return;

        const session = await getIndividualSessionById(req.params.sessionId);
        if (!session || String(session.user_id) !== String(user.user_id) || String(session.course_id) !== String(user.course_id)) {
            return res.status(404).json({message: "Session tidak ditemukan"});
        }
        if (session.status === "in_progress") {
            const questions = await getIndividualQuestionsByIds(session.question_ids);
            const effectiveSession = isIndividualSessionTimeUp(session)
                ? await completeTimedOutIndividualSession(session, questions, user)
                : session;
            const activity = await loadIndividualSession(effectiveSession, user);
            return res.status(409).json({
                message: "Aktivitas individual sudah dimulai dan tidak bisa dibatalkan. Timer tetap berjalan sampai selesai.",
                session: normalizeSession(activity.session, activity.questions, activity.answers, user),
            });
        }

        const updated = await cancelIndividualSession(req.params.sessionId, user.user_id);
        res.json({
            message: updated ? "Aktivitas dibatalkan" : "Tidak ada aktivitas aktif",
            session: null,
        });
    } catch (error) {
        console.error("Exit individual session error:", error);
        res.status(500).json({message: "Gagal keluar dari aktivitas"});
    }
}

export async function updateIndividualSettings(req, res) {
    try {
        await ensureIndividualActivityTables();
        const user = await getAuthenticatedUser(req, res);
        if (!user) return;

        const topic = await getTopicByIdIncludingHidden(req.params.topicId, user.course_id);
        if (!topic) return res.status(404).json({message: "Topic tidak ditemukan"});

        const topicVisibility = req.body.show_topic === undefined
            ? null
            : await updateTopicVisibility(topic.topic_id, req.body.show_topic);
        const settings = await updateIndividualTopicSettings(topic.topic_id, {
            show_pre_test: req.body.show_pre_test,
            show_post_test: req.body.show_post_test,
        });
        res.json({
            settings: {
                ...settings,
                show_topic: topicVisibility ? topicVisibility.show_topic !== false : topic.show_topic !== false,
            },
        });
    } catch (error) {
        console.error("Update individual settings error:", error);
        res.status(500).json({message: "Gagal menyimpan setting individual"});
    }
}
