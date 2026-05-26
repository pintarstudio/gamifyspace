import {findSession} from "../models/sessionModel.js";
import {
    ACTIVITY_TYPES,
    cancelIndividualSession,
    completeIndividualSession,
    createIndividualSession,
    ensureIndividualActivityTables,
    getIndividualActivityDuration,
    getIndividualQuestionDuration,
    getActiveIndividualSession,
    getActiveIndividualSessionForObject,
    getActiveIndividualOccupancy,
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
    updateCompletedIndividualFeedback,
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

function parseObjectIds(value) {
    return Array.from(new Set(
        String(value || "")
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean)
    ));
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
        time_spent_seconds: answer.time_spent_seconds,
        answered_at: answer.answered_at,
    };
    if (includeAnswerValue) {
        serialized.answer_index = answer.answer_index;
        serialized.answer_text = answer.answer_text;
    }
    return serialized;
}

function normalizeExerciseAnswerReveal(question, answer) {
    if (!question || !answer) return null;
    return {
        question: serializeQuestion(question, true),
        answer: serializeAnswer(answer, true),
    };
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

    const totalDurationSeconds = Number(session.duration_seconds)
        || getIndividualActivityDuration(session.activity_type, session.question_kind);
    const isRunning = session.status === "in_progress";
    const isMultipleChoice = session.question_kind === "multiple_choice";
    const activeDurationSeconds = isRunning && isMultipleChoice
        ? getIndividualQuestionDuration(session.activity_type, session.question_kind)
        : totalDurationSeconds;
    const timerStartedAtValue = isRunning && isMultipleChoice
        ? (session.current_question_started_at || session.started_at)
        : session.started_at;
    const startedAt = timerStartedAtValue ? new Date(timerStartedAtValue).getTime() : Date.now();
    const elapsedSeconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
    const secondsSpent = isRunning
        ? Math.min(activeDurationSeconds, elapsedSeconds)
        : Math.min(totalDurationSeconds, Math.max(0, Number(session.seconds_spent || 0)));
    const secondsLeft = isRunning
        ? Math.max(0, activeDurationSeconds - secondsSpent)
        : Math.max(0, Number(session.seconds_left || 0));

    return {
        duration_seconds: activeDurationSeconds,
        activity_duration_seconds: totalDurationSeconds,
        question_duration_seconds: isMultipleChoice ? getIndividualQuestionDuration(session.activity_type, session.question_kind) : null,
        seconds_spent: secondsSpent,
        seconds_left: secondsLeft,
        timer_expires_at: new Date(startedAt + activeDurationSeconds * 1000).toISOString(),
        is_time_up: isRunning && secondsLeft <= 0,
    };
}

function getCurrentQuestionTimeSpent(session) {
    if (!session) return 0;
    const questionDuration = getIndividualQuestionDuration(session.activity_type, session.question_kind);
    const startedAt = session.current_question_started_at
        ? new Date(session.current_question_started_at).getTime()
        : (session.started_at ? new Date(session.started_at).getTime() : Date.now());
    return Math.min(questionDuration, Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
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
        server_time_ms: Date.now(),
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

export async function completeIndividualMultipleChoice(req, res) {
    try {
        await ensureIndividualActivityTables();
        const user = await getAuthenticatedUser(req, res);
        if (!user) return;

        const session = await getIndividualSessionById(req.params.sessionId);
        if (!session || String(session.user_id) !== String(user.user_id) || String(session.course_id) !== String(user.course_id)) {
            return res.status(404).json({message: "Session tidak ditemukan"});
        }
        if (session.status === "completed") {
            const activity = await loadIndividualSession(session, user);
            return res.json({
                message: "Aktivitas sudah selesai",
                session: normalizeSession(activity.session, activity.questions, activity.answers, user),
            });
        }
        if (session.status !== "in_progress" || session.activity_type !== "exercise" || session.question_kind !== "multiple_choice") {
            return res.status(409).json({message: "Session tidak bisa diselesaikan saat ini"});
        }

        const questions = await getIndividualQuestionsByIds(session.question_ids);
        const answers = await getIndividualAnswers(session.session_id);
        if (answers.length < questions.length) {
            const activity = await loadIndividualSession(session, user);
            return res.status(409).json({
                message: "Jawab semua pertanyaan terlebih dahulu.",
                session: normalizeSession(activity.session, activity.questions, activity.answers, user),
            });
        }

        const completed = await completeMultipleChoiceSession(session, questions, user);
        const activity = await loadIndividualSession(completed, user);
        res.json({
            message: "Aktivitas selesai",
            session: normalizeSession(activity.session, activity.questions, activity.answers, user),
        });
    } catch (error) {
        console.error("Complete individual multiple choice error:", error);
        res.status(500).json({message: "Gagal menyelesaikan aktivitas multiple choice"});
    }
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

async function timeoutMultipleChoiceQuestion(session, questions, user) {
    const currentQuestion = questions[session.current_question_index];
    if (!currentQuestion) return session;

    const existingAnswers = await getIndividualAnswers(session.session_id);
    const alreadyAnswered = existingAnswers.some((answer) => String(answer.question_id) === String(currentQuestion.question_id));
    if (!alreadyAnswered) {
        await saveIndividualMcAnswer({
            session,
            question: currentQuestion,
            userId: user.user_id,
            answerIndex: null,
            awardXp: !!user.gamification_enabled,
            timeSpentSeconds: getIndividualQuestionDuration(session.activity_type, session.question_kind),
        });
    }

    const isLastQuestion = session.current_question_index >= questions.length - 1;
    if (isLastQuestion) {
        return completeMultipleChoiceSession(session, questions, user, {timedOut: true});
    }
    return advanceIndividualSession(session.session_id);
}

async function completeAnsweredMultipleChoiceSessionIfReady(session, questions, user) {
    if (!session || session.status !== "in_progress" || session.question_kind !== "multiple_choice") return session;
    const answers = await getIndividualAnswers(session.session_id);
    if (questions.length === 0 || answers.length < questions.length) return session;
    return completeMultipleChoiceSession(session, questions, user);
}

async function completeSubmittedCaseSessionIfReady(session, questions, user) {
    if (!session || session.status !== "in_progress" || session.question_kind !== "case_study") return session;
    const caseQuestion = questions[0];
    if (!caseQuestion) return session;

    const answers = await getIndividualAnswers(session.session_id);
    const submittedAnswer = answers.find((answer) =>
        String(answer.question_id) === String(caseQuestion.question_id)
        && String(answer.answer_text || "").trim().length > 0
    );
    if (!submittedAnswer) return session;

    return completeCaseSession(session, caseQuestion, user, submittedAnswer.answer_text);
}

async function recoverSubmittedIndividualSessionIfReady(session, questions, user) {
    if (!session || session.status !== "in_progress") return session;
    if (session.question_kind === "multiple_choice") {
        return completeAnsweredMultipleChoiceSessionIfReady(session, questions, user);
    }
    if (session.question_kind === "case_study") {
        return completeSubmittedCaseSessionIfReady(session, questions, user);
    }
    return session;
}

async function retryCompletedExerciseFeedback(session, questions, answers, user) {
    const resultJson = session.result_json || {};
    const wrongItems = buildWrongAnswerFeedbackInput(session, questions, answers, user);
    let wrongAnswerFeedback = [];
    let wrongAnswerFeedbackModel = null;
    let wrongAnswerFeedbackError = null;

    if (wrongItems.length > 0) {
        try {
            const feedbackResult = await generateQuizWrongAnswerFeedback({items: wrongItems});
            wrongAnswerFeedback = feedbackResult.feedback;
            wrongAnswerFeedbackModel = feedbackResult.model;
        } catch (error) {
            wrongAnswerFeedbackError = error.message || "Gagal membuat feedback";
        }
    }

    return updateCompletedIndividualFeedback({
        sessionId: session.session_id,
        resultJson: {
            ...resultJson,
            wrong_answer_feedback: wrongAnswerFeedback,
            wrong_answer_feedback_model: wrongAnswerFeedbackModel,
            wrong_answer_feedback_error: wrongAnswerFeedbackError,
        },
        feedbackJson: {wrong_answer_feedback: wrongAnswerFeedback},
        feedbackModel: wrongAnswerFeedbackModel,
        feedbackError: wrongAnswerFeedbackError,
        xpTotal: Number(session.xp_total || resultJson.xp_total || 0),
    });
}

async function retryCompletedCaseFeedback(session, questions, answers) {
    const caseQuestion = questions[0];
    const answer = answers[0];
    if (!caseQuestion) return session;

    let feedback;
    let model = null;
    let feedbackError = null;
    const answerText = String(answer?.answer_text || "").trim();

    if (answerText.length >= 20) {
        try {
            const feedbackResult = await generateIndividualCaseFeedback({
                caseTitle: caseQuestion.case_title,
                casePrompt: caseQuestion.case_prompt,
                answerText,
            });
            feedback = feedbackResult.feedback;
            model = feedbackResult.model;
        } catch (error) {
            feedbackError = error.message || "Gagal membuat feedback";
            feedback = {
                www: "",
                ebi: "Feedback AI gagal dibuat. Silakan coba lagi.",
                xp: 0,
                xp_reason: "0 XP sementara karena feedback AI gagal dibuat.",
                error: feedbackError,
            };
        }
    } else {
        feedbackError = "Jawaban belum cukup panjang untuk dievaluasi.";
        feedback = {
            www: "",
            ebi: feedbackError,
            xp: 0,
            xp_reason: "0 XP karena jawaban belum cukup lengkap untuk dievaluasi.",
            error: feedbackError,
        };
    }

    const updated = await updateCompletedIndividualFeedback({
        sessionId: session.session_id,
        resultJson: {
            ...(session.result_json || {}),
            xp_total: feedback.xp || 0,
            case_feedback: feedback,
        },
        feedbackJson: feedback,
        feedbackModel: model,
        feedbackError,
        xpTotal: feedback.xp || 0,
    });
    if (!feedbackError) {
        await upsertIndividualXpScore(updated || session, feedback.xp || 0, feedback.xp_reason);
    }
    return updated;
}

export async function getIndividualOccupancy(req, res) {
    try {
        await ensureIndividualActivityTables();
        const user = await getAuthenticatedUser(req, res);
        if (!user) return;

        const objectIds = parseObjectIds(req.query.objects);
        const rows = await getActiveIndividualOccupancy({
            courseId: user.course_id,
            objectIds,
            userId: user.user_id,
        });

        res.json({
            occupancy: rows.map((row) => ({
                session_id: row.session_id,
                object_id: row.object_id,
                user_id: row.user_id,
                user_name: row.user_name,
                activity_type: row.activity_type,
                question_kind: row.question_kind,
                is_owner: !!row.is_owner,
                is_occupied: !row.is_owner,
            })),
        });
    } catch (error) {
        console.error("Individual occupancy error:", error);
        res.status(500).json({message: "Gagal memuat status komputer"});
    }
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
            effectiveActiveSession = effectiveActiveSession.question_kind === "multiple_choice"
                ? await timeoutMultipleChoiceQuestion(effectiveActiveSession, questions, user)
                : await completeTimedOutIndividualSession(effectiveActiveSession, questions, user);
        } else if (effectiveActiveSession?.question_kind === "multiple_choice") {
            const questions = await getIndividualQuestionsByIds(effectiveActiveSession.question_ids);
            effectiveActiveSession = await recoverSubmittedIndividualSessionIfReady(effectiveActiveSession, questions, user);
        } else if (effectiveActiveSession?.question_kind === "case_study") {
            const questions = await getIndividualQuestionsByIds(effectiveActiveSession.question_ids);
            effectiveActiveSession = await recoverSubmittedIndividualSessionIfReady(effectiveActiveSession, questions, user);
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

export async function retryIndividualFeedback(req, res) {
    try {
        await ensureIndividualActivityTables();
        const user = await getAuthenticatedUser(req, res);
        if (!user) return;

        const session = await getIndividualSessionById(req.params.sessionId);
        if (!session || String(session.user_id) !== String(user.user_id) || String(session.course_id) !== String(user.course_id)) {
            return res.status(404).json({message: "Session tidak ditemukan"});
        }
        if (session.status !== "completed") {
            return res.status(409).json({message: "Aktivitas belum selesai"});
        }

        const activity = await loadIndividualSession(session, user);
        const updated = session.question_kind === "case_study"
            ? await retryCompletedCaseFeedback(session, activity.questions, activity.answers)
            : session.activity_type === "exercise"
                ? await retryCompletedExerciseFeedback(session, activity.questions, activity.answers, user)
                : session;
        const refreshed = await loadIndividualSession(updated || session, user);

        res.json({
            message: refreshed.session.feedback_status === "error"
                ? "Feedback AI masih gagal dibuat."
                : "Feedback AI berhasil dibuat ulang.",
            session: normalizeSession(refreshed.session, refreshed.questions, refreshed.answers, user),
        });
    } catch (error) {
        console.error("Retry individual feedback error:", error);
        res.status(500).json({message: "Gagal mencoba ulang AI feedback"});
    }
}

export async function startIndividualSession(req, res) {
    try {
        await ensureIndividualActivityTables();
        const user = await getAuthenticatedUser(req, res);
        if (!user) return;

        const objectId = normalizeObjectId(req.body.object_id);
        const activeObjectSession = await getActiveIndividualSessionForObject({courseId: user.course_id, objectId});
        let effectiveActiveObjectSession = activeObjectSession;
        if (effectiveActiveObjectSession && String(effectiveActiveObjectSession.user_id) === String(user.user_id)) {
            const questions = await getIndividualQuestionsByIds(effectiveActiveObjectSession.question_ids);
            effectiveActiveObjectSession = await recoverSubmittedIndividualSessionIfReady(effectiveActiveObjectSession, questions, user);
        }
        if (effectiveActiveObjectSession?.status === "in_progress") {
            if (String(effectiveActiveObjectSession.user_id) !== String(user.user_id)) {
                return res.status(409).json({
                    message: `${effectiveActiveObjectSession.user_name || "Student lain"} sedang menggunakan komputer ini. Silakan pilih komputer lain.`,
                    reason: "COMPUTER_IN_USE",
                });
            }

            const activity = await loadIndividualSession(effectiveActiveObjectSession, user);
            return res.status(409).json({
                message: "Masih ada aktivitas individual aktif di komputer ini.",
                active_session: normalizeSession(activity.session, activity.questions, activity.answers, user),
            });
        }

        const activeSession = await getActiveIndividualSession({courseId: user.course_id, userId: user.user_id, objectId});
        let effectiveActiveSession = activeSession;
        if (effectiveActiveSession) {
            const questions = await getIndividualQuestionsByIds(effectiveActiveSession.question_ids);
            effectiveActiveSession = await recoverSubmittedIndividualSessionIfReady(effectiveActiveSession, questions, user);
        }
        if (effectiveActiveSession?.status === "in_progress") {
            const activity = await loadIndividualSession(effectiveActiveSession, user);
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
            effectiveSession = effectiveSession.question_kind === "multiple_choice"
                ? await timeoutMultipleChoiceQuestion(effectiveSession, questions, user)
                : await completeTimedOutIndividualSession(effectiveSession, questions, user);
        } else if (effectiveSession.question_kind === "multiple_choice") {
            const questions = await getIndividualQuestionsByIds(effectiveSession.question_ids);
            effectiveSession = await recoverSubmittedIndividualSessionIfReady(effectiveSession, questions, user);
        } else if (effectiveSession.question_kind === "case_study") {
            const questions = await getIndividualQuestionsByIds(effectiveSession.question_ids);
            effectiveSession = await recoverSubmittedIndividualSessionIfReady(effectiveSession, questions, user);
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
            const timedOutSession = await timeoutMultipleChoiceQuestion(session, questions, user);
            const activity = await loadIndividualSession(timedOutSession, user);
            return res.status(409).json({
                message: timedOutSession?.status === "completed"
                    ? "Waktu pertanyaan terakhir habis. Aktivitas selesai."
                    : "Waktu pertanyaan habis. Lanjut ke pertanyaan berikutnya.",
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

        const savedAnswer = await saveIndividualMcAnswer({
            session,
            question: currentQuestion,
            userId: user.user_id,
            answerIndex: req.body.answer_index,
            awardXp: !!user.gamification_enabled,
            timeSpentSeconds: getCurrentQuestionTimeSpent(session),
        });

        const isLastQuestion = session.current_question_index >= questions.length - 1;
        const shouldRevealExerciseAnswer = session.activity_type === "exercise";
        const updatedSession = shouldRevealExerciseAnswer && isLastQuestion
            ? session
            : isLastQuestion
                ? await completeMultipleChoiceSession(session, questions, user)
                : await advanceIndividualSession(session.session_id, {startDelayMs: shouldRevealExerciseAnswer ? 1200 : 0});
        const activity = await loadIndividualSession(updatedSession, user);

        res.json({
            message: isLastQuestion && !shouldRevealExerciseAnswer ? "Aktivitas selesai" : "Jawaban tersimpan",
            session: normalizeSession(activity.session, activity.questions, activity.answers, user),
            answer_reveal: shouldRevealExerciseAnswer ? normalizeExerciseAnswerReveal(currentQuestion, savedAnswer) : null,
            needs_completion: shouldRevealExerciseAnswer && isLastQuestion,
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
        if (session.status === "completed") {
            const activity = await loadIndividualSession(session, user);
            return res.json({
                message: "Case study sudah selesai",
                session: normalizeSession(activity.session, activity.questions, activity.answers, user),
            });
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

        const timedOutSession = session.question_kind === "multiple_choice"
            ? await timeoutMultipleChoiceQuestion(session, questions, user)
            : await completeTimedOutIndividualSession(session, questions, user, req.body.answer_text);
        const activity = await loadIndividualSession(timedOutSession, user);
        res.json({
            message: timedOutSession?.status === "completed"
                ? "Waktu aktivitas sudah habis."
                : "Waktu pertanyaan habis. Lanjut ke pertanyaan berikutnya.",
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
                ? session.question_kind === "multiple_choice"
                    ? await timeoutMultipleChoiceQuestion(session, questions, user)
                    : await completeTimedOutIndividualSession(session, questions, user)
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
