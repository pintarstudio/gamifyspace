import React, {useEffect, useMemo, useRef, useState} from "react";
import {useSearchParams} from "react-router-dom";
import {apiGet, apiPatch, apiPost} from "../api/apiClient";
import {
    activeActivityMessage,
    activityStatusForIndividual,
    clearActivityStatus,
    setActivityStatus,
} from "../utils/activityStatus";
import "./IndividualActivityPage.css";

const choiceLabel = (index) => ["A", "B", "C", "D"][index] || String(index + 1);
const getMessage = (data, fallback) => data?.message || fallback;

const isTypingTarget = (target) =>
    target && (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable
    );

function activityTitle(activityType, questionKind) {
    if (activityType === "pre_test") return "Pre-test";
    if (activityType === "post_test") return "Post-test";
    return questionKind === "case_study" ? "Individual Case Study" : "Individual Exercise";
}

function feedbackForAnswer(session, answer) {
    return (session?.result?.wrong_answer_feedback || session?.feedback?.wrong_answer_feedback || [])
        .find((item) => String(item.question_id) === String(answer.question_id));
}

const IndividualActivityPage = ({embedded = false, onBack, activitySearchParams = null, exitOnBack = false}) => {
    const [routeSearchParams] = useSearchParams();
    const searchParams = useMemo(
        () => activitySearchParams ? new URLSearchParams(activitySearchParams) : routeSearchParams,
        [activitySearchParams, routeSearchParams]
    );
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
    const [currentUser, setCurrentUser] = useState(null);
    const [confirmExitOpen, setConfirmExitOpen] = useState(false);
    const activityStatusKeyRef = useRef(null);
    const cancelExitButtonRef = useRef(null);

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
        const query = new URLSearchParams({object_id: objectId});
        if (showAdminControls) query.set("admin", "1");
        const data = await apiGet(`/individual/context?${query.toString()}`);
        setContext(data);
        setActiveSession(data.active_session || null);
        const hasSelectedTopic = data.topics?.some((topic) => String(topic.topic_id) === String(selectedTopicId));
        if ((!selectedTopicId || !hasSelectedTopic) && data.topics?.length > 0) {
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
        apiGet("/session").then((data) => {
            if (data.loggedIn && data.user) setCurrentUser(data.user);
        });
    }, []);

    useEffect(() => {
        if (!currentUser) return undefined;

        const clearStatusOnPageHide = () => {
            if (!activityStatusKeyRef.current) return;
            clearActivityStatus({
                user: currentUser,
                activityKey: activityStatusKeyRef.current,
                keepalive: true,
            });
        };

        window.addEventListener("pagehide", clearStatusOnPageHide);
        return () => window.removeEventListener("pagehide", clearStatusOnPageHide);
    }, [currentUser]);

    useEffect(() => {
        if (!availableActivityTypes.includes(activityType)) {
            setActivityType("exercise");
            setQuestionKind("multiple_choice");
        }
    }, [availableActivityTypes, activityType]);

    useEffect(() => {
        if (!currentUser || activeSession?.status !== "in_progress") return undefined;

        const status = activityStatusForIndividual(activeSession.activity_type);
        const activityKey = `${status.type}:${activeSession.session_id}`;
        const metadata = {
            object_id: activeSession.object_id || objectId,
        };
        const refreshStatus = () => {
            activityStatusKeyRef.current = activityKey;
            setActivityStatus({user: currentUser, status, activityKey, metadata});
        };

        refreshStatus();
        const intervalId = window.setInterval(refreshStatus, 120000);

        return () => {
            window.clearInterval(intervalId);
            clearActivityStatus({user: currentUser, activityKey, keepalive: true});
            if (activityStatusKeyRef.current === activityKey) activityStatusKeyRef.current = null;
        };
    }, [currentUser, activeSession?.status, activeSession?.session_id, activeSession?.activity_type, activeSession?.object_id, objectId]);

    useEffect(() => {
        if (!completionNotice) return undefined;

        const preventUnload = (event) => {
            event.preventDefault();
            event.returnValue = "";
            return "";
        };

        window.addEventListener("beforeunload", preventUnload);
        return () => window.removeEventListener("beforeunload", preventUnload);
    }, [completionNotice]);

    useEffect(() => {
        if (confirmExitOpen) {
            window.setTimeout(() => cancelExitButtonRef.current?.focus(), 0);
        }
    }, [confirmExitOpen]);

    useEffect(() => {
        if (!embedded) return undefined;

        const handleEscape = (event) => {
            if (event.key !== "Escape" || isTypingTarget(event.target)) return;
            event.preventDefault();

            if (confirmExitOpen) {
                setConfirmExitOpen(false);
                return;
            }

            if (!activeSession) {
                onBack?.();
                return;
            }

            if (activeSession.status !== "in_progress") return;

            if (completionNotice) {
                setMessage("Aktivitas sedang disimpan. Jangan refresh, tutup halaman, atau keluar sampai proses selesai.");
                return;
            }

            setConfirmExitOpen(true);
        };

        window.addEventListener("keydown", handleEscape);
        return () => window.removeEventListener("keydown", handleEscape);
    }, [activeSession, completionNotice, confirmExitOpen, embedded, onBack]);

    const handleStart = async () => {
        if (!selectedTopicId) {
            setMessage("Pilih topic terlebih dahulu.");
            return;
        }

        setBusy(true);
        setMessage("");
        const status = activityStatusForIndividual(activityType);
        const pendingActivityKey = `${status.type}:pending:${objectId}`;
        if (currentUser) {
            const statusResult = await setActivityStatus({
                user: currentUser,
                status,
                activityKey: pendingActivityKey,
                metadata: {object_id: objectId},
                isPending: true,
            });
            if (!statusResult.ok) {
                setMessage(activeActivityMessage(statusResult.current));
                setBusy(false);
                return;
            }
            activityStatusKeyRef.current = pendingActivityKey;
        }

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
            if (currentUser) clearActivityStatus({user: currentUser, activityKey: pendingActivityKey});
            if (activityStatusKeyRef.current === pendingActivityKey) activityStatusKeyRef.current = null;
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
        if (!activeSession?.session_id) return false;
        setBusy(true);
        const data = await apiPost(`/individual/sessions/${activeSession.session_id}/exit`, {});
        const status = activityStatusForIndividual(activeSession.activity_type);
        if (currentUser) clearActivityStatus({user: currentUser, activityKey: `${status.type}:${activeSession.session_id}`});
        activityStatusKeyRef.current = null;
        setActiveSession(null);
        setMessage(getMessage(data, "Aktivitas dibatalkan."));
        setBusy(false);
        return true;
    };

    const handleEmbeddedBack = async () => {
        if (exitOnBack && activeSession?.status === "in_progress") {
            const exited = await handleExit();
            if (!exited) return;
        }
        onBack?.();
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
        return <main className={`individual-app individual-app--center${embedded ? " individual-app--embedded" : ""}`}>Memuat aktivitas individual...</main>;
    }

    if (activeSession?.status === "in_progress") {
        const currentQuestion = activeSession.current_question;
        const isCaseStudy = activeSession.question_kind === "case_study";
        const progress = isCaseStudy
            ? "Case study"
            : `${activeSession.current_question_index + 1}/${activeSession.question_count}`;

        return (
            <main className={`individual-app individual-workspace${embedded ? " individual-app--embedded" : ""}`}>
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
                            <p>Please keep this window open while the activity is being saved. Do not refresh or close this page.</p>
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
                {confirmExitOpen && (
                    <div className="activity-exit-confirm" role="dialog" aria-modal="true" aria-labelledby="individual-exit-confirm-title">
                        <section className="activity-exit-confirm__panel">
                            <h2 id="individual-exit-confirm-title">Exit activity?</h2>
                            <p>Your current individual activity will be closed.</p>
                            <div className="activity-exit-confirm__actions">
                                <button ref={cancelExitButtonRef} type="button" onClick={() => setConfirmExitOpen(false)}>
                                    No, stay
                                </button>
                                <button className="is-danger" type="button" onClick={() => {
                                    setConfirmExitOpen(false);
                                    handleExit();
                                }}>
                                    Yes, exit
                                </button>
                            </div>
                        </section>
                    </div>
                )}
            </main>
        );
    }

    if (activeSession?.status === "completed") {
        const isAssessment = ["pre_test", "post_test"].includes(activeSession.activity_type);
        const isCaseStudy = activeSession.question_kind === "case_study";

        return (
            <main className={`individual-app individual-results${embedded ? " individual-app--embedded" : ""}`}>
                {embedded && (
                    <button className="individual-button individual-button--primary" type="button" onClick={onBack}>
                        Close
                    </button>
                )}
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
        <main className={`individual-app individual-landing${embedded ? " individual-app--embedded" : ""}`}>
            {embedded && (
                <button className="no-virtual-back" type="button" onClick={handleEmbeddedBack}>
                    Back
                </button>
            )}
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
                                    checked={topic.show_topic !== false}
                                    onChange={() => handleAdminToggle(topic, "show_topic")}
                                />
                                Show topic
                            </label>
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
