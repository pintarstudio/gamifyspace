import {findSession} from "../models/sessionModel.js";
import {
    ACTIVITY_TYPES,
    cancelIndividualSession,
    completeIndividualSession,
    createIndividualSession,
    ensureIndividualActivityTables,
    ensureIndividualSettingsForTopics,
    ensureSampleIndividualQuestionsForTopics,
    getActiveIndividualSession,
    getIndividualAnswers,
    getIndividualQuestions,
    getIndividualQuestionsByIds,
    getIndividualSessionById,
    getIndividualSettingsForTopics,
    MC_QUESTION_COUNT,
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

function serializeAnswer(answer) {
    return {
        answer_id: answer.answer_id,
        session_id: answer.session_id,
        question_id: answer.question_id,
        user_id: answer.user_id,
        answer_index: answer.answer_index,
        answer_text: answer.answer_text,
        is_correct: answer.is_correct,
        score: answer.score,
        xp_earned: answer.xp_earned,
        answered_at: answer.answered_at,
    };
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

function normalizeSession(session, questions, answers, user, options = {}) {
    if (!session) return null;

    const includeFinalAnswers = session.status === "completed";
    const currentQuestion = questions[session.current_question_index] || null;
    const currentAnswer = currentQuestion
        ? answers.find((answer) => String(answer.question_id) === String(currentQuestion.question_id))
        : null;
    const resultJson = session.result_json || {};
    const feedbackJson = session.feedback_json || null;
    const showGamification = !!user.gamification_enabled;

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
        current_question: currentQuestion ? serializeQuestion(currentQuestion, !!currentAnswer || includeFinalAnswers || session.question_kind === "case_study") : null,
        current_answer: currentAnswer ? serializeAnswer(currentAnswer) : null,
        questions: includeFinalAnswers ? questions.map((question) => serializeQuestion(question, true)) : [],
        answers: includeFinalAnswers ? answers.map(serializeAnswer) : answers.map(serializeAnswer),
        correct_count: session.correct_count || resultJson.correct_count || 0,
        score_total: session.score_total || resultJson.score_total || 0,
        xp_total: session.xp_total || resultJson.xp_total || 0,
        result: resultJson,
        feedback: feedbackJson,
        feedback_model: session.feedback_model,
        feedback_status: session.feedback_status,
        feedback_error: session.feedback_error,
        gamification_enabled: showGamification,
        started_at: session.started_at,
        completed_at: session.completed_at,
        ...options,
    };
}

async function completeMultipleChoiceSession(session, questions, user) {
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

        await ensureIndividualSettingsForTopics(topics);
        await ensureSampleIndividualQuestionsForTopics(topics);
        const settingsMap = await getIndividualSettingsForTopics(topics);
        const activity = activeSession ? await loadIndividualSession(activeSession, user) : null;

        res.json({
            course,
            object_id: objectId,
            topics: topics.map((topic) => {
                const settings = settingsMap.get(Number(topic.topic_id)) || {};
                return {
                    ...topic,
                    show_topic: topic.show_topic !== false,
                    show_pre_test: settings.show_pre_test !== false,
                    show_post_test: settings.show_post_test !== false,
                };
            }),
            gamification_enabled: !!user.gamification_enabled,
            mc_question_count: MC_QUESTION_COUNT,
            active_session: activity
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

        await ensureIndividualSettingsForTopics([topic]);
        const settingsMap = await getIndividualSettingsForTopics([topic]);
        const settings = settingsMap.get(Number(topic.topic_id));
        if (activityType === "pre_test" && settings?.show_pre_test === false) {
            return res.status(403).json({message: "Pre-test belum dibuka untuk topic ini"});
        }
        if (activityType === "post_test" && settings?.show_post_test === false) {
            return res.status(403).json({message: "Post-test belum dibuka untuk topic ini"});
        }

        await ensureSampleIndividualQuestionsForTopics([topic]);
        const questions = await getIndividualQuestions({topicId: topic.topic_id, activityType, questionKind});
        const expectedCount = questionKind === "case_study" ? 1 : MC_QUESTION_COUNT;
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

        const activity = await loadIndividualSession(session, user);
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
        if (answerText.length < 20) {
            return res.status(400).json({message: "Jawaban case study terlalu singkat"});
        }

        await saveIndividualCaseAnswer({
            sessionId: session.session_id,
            userId: user.user_id,
            questionId: caseQuestion.question_id,
            answerText,
        });

        let feedback;
        let model = null;
        try {
            const feedbackResult = await generateIndividualCaseFeedback({
                caseTitle: caseQuestion.case_title,
                casePrompt: caseQuestion.case_prompt,
                answerText,
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

        const resultJson = {
            question_count: 1,
            answered_count: 1,
            correct_count: 0,
            score_total: 0,
            xp_total: user.gamification_enabled ? feedback.xp : 0,
            case_feedback: feedback,
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

        const activity = await loadIndividualSession(completed, user);
        res.json({
            message: "Case study selesai",
            session: normalizeSession(activity.session, activity.questions, activity.answers, user),
        });
    } catch (error) {
        console.error("Submit individual case error:", error);
        res.status(500).json({message: "Gagal submit case study"});
    }
}

export async function exitIndividualSession(req, res) {
    try {
        await ensureIndividualActivityTables();
        const user = await getAuthenticatedUser(req, res);
        if (!user) return;

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
