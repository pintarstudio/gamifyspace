import React, {useEffect, useMemo, useState} from "react";
import {useSearchParams} from "react-router-dom";
import {apiGet, apiPatch, apiPost} from "../api/apiClient";
import "./IndividualActivityPage.css";

const choiceLabel = (index) => ["A", "B", "C", "D"][index] || String(index + 1);
const getMessage = (data, fallback) => data?.message || fallback;

function activityTitle(activityType, questionKind) {
    if (activityType === "pre_test") return "Pre-test";
    if (activityType === "post_test") return "Post-test";
    return questionKind === "case_study" ? "Individual Case Study" : "Individual Exercise";
}

function feedbackForAnswer(session, answer) {
    return (session?.result?.wrong_answer_feedback || session?.feedback?.wrong_answer_feedback || [])
        .find((item) => String(item.question_id) === String(answer.question_id));
}

const IndividualActivityPage = () => {
    const [searchParams] = useSearchParams();
    const objectId = searchParams.get("object_id") || "computer";
    const showAdminControls = searchParams.get("admin") === "1";

    const [context, setContext] = useState(null);
    const [selectedTopicId, setSelectedTopicId] = useState("");
    const [activityType, setActivityType] = useState("exercise");
    const [questionKind, setQuestionKind] = useState("multiple_choice");
    const [activeSession, setActiveSession] = useState(null);
    const [caseAnswer, setCaseAnswer] = useState("");
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState("");
    const [completionNotice, setCompletionNotice] = useState("");

    const selectedTopic = useMemo(
        () => context?.topics?.find((topic) => String(topic.topic_id) === String(selectedTopicId)),
        [context, selectedTopicId]
    );
    const showGamification = !!context?.gamification_enabled;

    const availableActivityTypes = useMemo(() => {
        const types = ["exercise"];
        if (selectedTopic?.show_pre_test) types.push("pre_test");
        if (selectedTopic?.show_post_test) types.push("post_test");
        return types;
    }, [selectedTopic]);

    const loadContext = async () => {
        setLoading(true);
        const data = await apiGet(`/individual/context?object_id=${encodeURIComponent(objectId)}`);
        setContext(data);
        setActiveSession(data.active_session || null);
        if (!selectedTopicId && data.topics?.length > 0) {
            setSelectedTopicId(String(data.active_session?.topic_id || data.topics[0].topic_id));
        }
        if (data.active_session) {
            setActivityType(data.active_session.activity_type);
            setQuestionKind(data.active_session.question_kind);
            setCaseAnswer(data.active_session.answers?.[0]?.answer_text || "");
        }
        setLoading(false);
    };

    useEffect(() => {
        loadContext();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [objectId]);

    useEffect(() => {
        if (!availableActivityTypes.includes(activityType)) {
            setActivityType("exercise");
            setQuestionKind("multiple_choice");
        }
    }, [availableActivityTypes, activityType]);

    const handleStart = async () => {
        if (!selectedTopicId) {
            setMessage("Pilih topic terlebih dahulu.");
            return;
        }

        setBusy(true);
        setMessage("");
        const data = await apiPost("/individual/sessions", {
            object_id: objectId,
            topic_id: selectedTopicId,
            activity_type: activityType,
            question_kind: activityType === "exercise" ? questionKind : "multiple_choice",
        });

        if (data.session) {
            setActiveSession(data.session);
            setCaseAnswer("");
        } else if (data.active_session) {
            setActiveSession(data.active_session);
            setMessage(getMessage(data, "Aktivitas aktif ditemukan."));
        } else {
            setMessage(getMessage(data, "Gagal memulai aktivitas."));
        }
        setBusy(false);
    };

    const handleAnswer = async (answerIndex) => {
        if (!activeSession?.session_id || busy) return;
        const isLastQuestion = activeSession.current_question_index >= activeSession.question_count - 1;
        setBusy(true);
        setMessage("");
        if (isLastQuestion) {
            setCompletionNotice(activeSession.activity_type === "exercise"
                ? "Getting AI feedback for your answers..."
                : "Calculating your result...");
        }
        try {
            const data = await apiPost(`/individual/sessions/${activeSession.session_id}/answer`, {
                answer_index: answerIndex,
            });
            if (data.session) {
                setActiveSession(data.session);
            } else {
                setMessage(getMessage(data, "Gagal menyimpan jawaban."));
            }
        } catch (error) {
            setMessage("Gagal menyimpan jawaban.");
        }
        setCompletionNotice("");
        setBusy(false);
    };

    const handleSubmitCase = async () => {
        if (!activeSession?.session_id || busy) return;
        setBusy(true);
        setMessage("");
        setCompletionNotice("Getting AI feedback for your case study...");
        try {
            const data = await apiPost(`/individual/sessions/${activeSession.session_id}/case-submit`, {
                answer_text: caseAnswer,
            });
            if (data.session) {
                setActiveSession(data.session);
            } else {
                setMessage(getMessage(data, "Gagal submit case study."));
            }
        } catch (error) {
            setMessage("Gagal submit case study.");
        }
        setCompletionNotice("");
        setBusy(false);
    };

    const handleExit = async () => {
        if (!activeSession?.session_id) return;
        setBusy(true);
        const data = await apiPost(`/individual/sessions/${activeSession.session_id}/exit`, {});
        setActiveSession(null);
        setMessage(getMessage(data, "Aktivitas dibatalkan."));
        setBusy(false);
    };

    const handleAdminToggle = async (topic, key) => {
        const nextValue = !topic[key];
        const data = await apiPatch(`/individual/settings/${topic.topic_id}`, {[key]: nextValue});
        if (data.settings) {
            setContext((prev) => ({
                ...prev,
                topics: prev.topics.map((item) =>
                    String(item.topic_id) === String(topic.topic_id)
                        ? {...item, ...data.settings}
                        : item
                ),
            }));
        }
    };

    if (loading) {
        return <main className="individual-app individual-app--center">Memuat aktivitas individual...</main>;
    }

    if (activeSession?.status === "in_progress") {
        const currentQuestion = activeSession.current_question;
        const isCaseStudy = activeSession.question_kind === "case_study";
        const progress = isCaseStudy
            ? "Case study"
            : `${activeSession.current_question_index + 1}/${activeSession.question_count}`;

        return (
            <main className="individual-app individual-workspace">
                <header className="individual-header">
                    <div>
                        <span className="individual-label">{context?.course?.course_name}</span>
                        <h1>{activityTitle(activeSession.activity_type, activeSession.question_kind)}</h1>
                    </div>
                    <div className="individual-header__actions">
                        <span>{progress}</span>
                        <button className="individual-button individual-button--danger" onClick={handleExit} disabled={busy}>
                            {busy ? "Please Wait" : "Exit"}
                        </button>
                    </div>
                </header>

                {completionNotice && (
                    <section className="individual-panel individual-loading" role="status" aria-live="polite">
                        <span className="individual-spinner" aria-hidden="true" />
                        <div>
                            <h2>{completionNotice}</h2>
                            <p>Please keep this window open while the activity is being saved.</p>
                        </div>
                    </section>
                )}

                {isCaseStudy ? (
                    <>
                        <section className="individual-panel">
                            <span className="individual-label">Case Study</span>
                            <h2>{currentQuestion?.case_title}</h2>
                            <p>{currentQuestion?.case_prompt}</p>
                        </section>

                        <section className="individual-panel individual-answer">
                            <h2>My Answer</h2>
                            <textarea
                                value={caseAnswer}
                                onChange={(event) => setCaseAnswer(event.target.value)}
                                placeholder="Write your case study answer here..."
                                disabled={busy}
                            />
                            <button
                                className="individual-button individual-button--primary"
                                onClick={handleSubmitCase}
                                disabled={busy || caseAnswer.trim().length < 20}
                            >
                                {busy ? "Getting AI Feedback..." : "Submit Answer"}
                            </button>
                        </section>
                    </>
                ) : (
                    <section className="individual-panel individual-question">
                        <div className="individual-section-title">
                            <h2>Question {activeSession.current_question_index + 1}</h2>
                            <span>{activeSession.question_count} questions</span>
                        </div>
                        <p>{currentQuestion?.question_text}</p>
                        <div className="individual-options">
                            {(currentQuestion?.choices || []).map((choice, index) => (
                                <button
                                    className="individual-option"
                                    key={`${index}-${choice}`}
                                    type="button"
                                    onClick={() => handleAnswer(index)}
                                    disabled={busy}
                                >
                                    <span>{choiceLabel(index)}</span>
                                    <strong>{choice}</strong>
                                </button>
                            ))}
                        </div>
                    </section>
                )}

                {message && <p className="individual-message">{message}</p>}
            </main>
        );
    }

    if (activeSession?.status === "completed") {
        const isAssessment = ["pre_test", "post_test"].includes(activeSession.activity_type);
        const isCaseStudy = activeSession.question_kind === "case_study";

        return (
            <main className="individual-app individual-results">
                <section className="individual-panel individual-result-hero">
                    <span className="individual-label">Completed</span>
                    <h1>{activityTitle(activeSession.activity_type, activeSession.question_kind)}</h1>
                    {isAssessment ? (
                        <p>Your score: <strong>{activeSession.score_total}/100</strong></p>
                    ) : isCaseStudy ? (
                        <p>
                            {showGamification
                                ? <>Individual XP: <strong>{activeSession.xp_total} XP</strong></>
                                : "Your answer has been submitted and feedback is ready."}
                        </p>
                    ) : (
                        <p>
                            {showGamification
                                ? <>Individual XP: <strong>{activeSession.xp_total} XP</strong></>
                                : <>Correct answers: <strong>{activeSession.correct_count}/{activeSession.question_count}</strong></>}
                        </p>
                    )}
                </section>

                {isCaseStudy ? (
                    <section className="individual-panel individual-feedback">
                        <div className="individual-section-title">
                            <h2>AI Feedback</h2>
                            <span>{activeSession.feedback_model || "Saved"}</span>
                        </div>
                        <div className="individual-feedback-grid">
                            <article>
                                <strong>What Went Well</strong>
                                <p>{activeSession.feedback?.www || "Feedback unavailable."}</p>
                            </article>
                            <article>
                                <strong>Even Better If</strong>
                                <p>{activeSession.feedback?.ebi || "Feedback unavailable."}</p>
                            </article>
                        </div>
                        {showGamification && activeSession.feedback?.xp_reason && (
                            <p className="individual-xp-reason">{activeSession.feedback.xp_reason}</p>
                        )}
                    </section>
                ) : (
                    <section className="individual-panel">
                        <div className="individual-section-title">
                            <h2>Review</h2>
                            <span>{activeSession.correct_count}/{activeSession.question_count} correct</span>
                        </div>
                        <div className="individual-review">
                            {(activeSession.questions || []).map((question, index) => {
                                const answer = (activeSession.answers || []).find((item) => String(item.question_id) === String(question.question_id));
                                const feedback = answer ? feedbackForAnswer(activeSession, answer) : null;
                                return (
                                    <article key={question.question_id}>
                                        <div className="individual-review__question">
                                            <span>Question {index + 1}</span>
                                            <strong>{question.question_text}</strong>
                                            <p>Correct: {choiceLabel(question.correct_answer_index)}. {question.choices?.[question.correct_answer_index]}</p>
                                        </div>
                                        <div className="individual-review__answer">
                                            <b className={answer?.is_correct ? "is-correct" : "is-wrong"}>
                                                {answer?.is_correct ? "Correct" : "Wrong"}
                                            </b>
                                            <span>
                                                Your answer: {answer?.answer_index === null || answer?.answer_index === undefined
                                                    ? "No answer"
                                                    : `${choiceLabel(answer.answer_index)}. ${question.choices?.[answer.answer_index] || ""}`}
                                            </span>
                                            {showGamification && activeSession.activity_type === "exercise" && (
                                                <em>{answer?.xp_earned || 0} XP</em>
                                            )}
                                            {isAssessment && <em>{answer?.score || 0} pts</em>}
                                        </div>
                                        {feedback && (
                                            <div className="individual-ai-feedback">
                                                <strong>AI Feedback</strong>
                                                <p>{feedback.feedback}</p>
                                            </div>
                                        )}
                                    </article>
                                );
                            })}
                        </div>
                    </section>
                )}

                {activeSession.feedback_error && (
                    <p className="individual-message">Feedback note: {activeSession.feedback_error}</p>
                )}
            </main>
        );
    }

    const canStart = !!selectedTopicId && availableActivityTypes.includes(activityType);

    return (
        <main className="individual-app individual-landing">
            <section className="individual-hero">
                <span className="individual-label">Computer Individual Activity</span>
                <h1>{context?.course?.course_name || "Course Activity"}</h1>
                <p>Choose a topic and work independently on an exercise, pre-test, or post-test.</p>
            </section>

            <section className="individual-layout">
                <div className="individual-panel">
                    <div className="individual-section-title">
                        <h2>Topics</h2>
                        <span>{context?.topics?.length || 0} available</span>
                    </div>
                    <div className="individual-topic-list">
                        {(context?.topics || []).map((topic) => (
                            <button
                                type="button"
                                className={`individual-topic${String(topic.topic_id) === String(selectedTopicId) ? " is-selected" : ""}`}
                                key={topic.topic_id}
                                onClick={() => setSelectedTopicId(String(topic.topic_id))}
                            >
                                <strong>{topic.topic_name}</strong>
                                <span>
                                    Pre-test {topic.show_pre_test ? "open" : "hidden"} · Post-test {topic.show_post_test ? "open" : "hidden"}
                                </span>
                            </button>
                        ))}
                    </div>
                </div>

                <div className="individual-panel individual-setup">
                    <div className="individual-section-title">
                        <h2>Activity</h2>
                        <span>Computer {objectId}</span>
                    </div>

                    <div className="individual-segment">
                        {availableActivityTypes.map((type) => (
                            <button
                                key={type}
                                className={activityType === type ? "is-selected" : ""}
                                type="button"
                                onClick={() => {
                                    setActivityType(type);
                                    if (type !== "exercise") setQuestionKind("multiple_choice");
                                }}
                            >
                                {activityTitle(type, "multiple_choice")}
                            </button>
                        ))}
                    </div>

                    {activityType === "exercise" && (
                        <div className="individual-segment individual-segment--secondary">
                            <button
                                className={questionKind === "multiple_choice" ? "is-selected" : ""}
                                type="button"
                                onClick={() => setQuestionKind("multiple_choice")}
                            >
                                Multiple Choice
                            </button>
                            <button
                                className={questionKind === "case_study" ? "is-selected" : ""}
                                type="button"
                                onClick={() => setQuestionKind("case_study")}
                            >
                                Case Study
                            </button>
                        </div>
                    )}

                    <p>
                        {selectedTopic
                            ? `${activityTitle(activityType, questionKind)} for ${selectedTopic.topic_name}.`
                            : "Select a topic before starting."}
                    </p>
                    <button className="individual-button individual-button--primary" onClick={handleStart} disabled={!canStart || busy}>
                        Start Activity
                    </button>
                    {message && <p className="individual-message">{message}</p>}
                </div>
            </section>

            {showAdminControls && (
                <section className="individual-panel individual-admin">
                    <div className="individual-section-title">
                        <h2>Admin Topic Visibility</h2>
                        <span>Testing controls</span>
                    </div>
                    {(context?.topics || []).map((topic) => (
                        <article key={topic.topic_id}>
                            <strong>{topic.topic_name}</strong>
                            <label>
                                <input
                                    type="checkbox"
                                    checked={!!topic.show_pre_test}
                                    onChange={() => handleAdminToggle(topic, "show_pre_test")}
                                />
                                Show pre-test
                            </label>
                            <label>
                                <input
                                    type="checkbox"
                                    checked={!!topic.show_post_test}
                                    onChange={() => handleAdminToggle(topic, "show_post_test")}
                                />
                                Show post-test
                            </label>
                        </article>
                    ))}
                </section>
            )}
        </main>
    );
};

export default IndividualActivityPage;
