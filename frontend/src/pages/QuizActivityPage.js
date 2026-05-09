import React, {useEffect, useMemo, useRef, useState} from "react";
import {useSearchParams} from "react-router-dom";
import {apiGet, apiPost} from "../api/apiClient";
import "./QuizActivityPage.css";

const avatarSrc = (path) => {
    if (!path) return "/avatars/default.png";
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    return `/avatars${normalizedPath}/thumbnail.png`;
};

const getMessage = (data, fallback) => data?.message || fallback;

function formatChoiceLabel(index) {
    return ["A", "B", "C", "D"][index] || String(index + 1);
}

function buildQuestionAnswerMap(session) {
    const grouped = {};
    (session?.answers || []).forEach((answer) => {
        const key = String(answer.question_id);
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(answer);
    });
    return grouped;
}

function buildWrongFeedbackMap(session) {
    const grouped = {};
    (session?.wrong_answer_feedback || []).forEach((item) => {
        grouped[`${item.user_id}:${item.question_id}`] = item.feedback;
    });
    return grouped;
}

const QuizActivityPage = () => {
    const [searchParams] = useSearchParams();
    const tableId = searchParams.get("table_id") || searchParams.get("group_id") || searchParams.get("object_id") || "1";
    const groupId = searchParams.get("group_id") || tableId;
    const objectId = searchParams.get("object_id");

    const [context, setContext] = useState(null);
    const [selectedTopicId, setSelectedTopicId] = useState("");
    const [activeSession, setActiveSession] = useState(null);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [savingResult, setSavingResult] = useState(false);
    const [message, setMessage] = useState("");
    const [now, setNow] = useState(Date.now());
    const timeoutPulseRef = useRef("");

    const selectedTopic = useMemo(
        () => context?.topics?.find((topic) => String(topic.topic_id) === String(selectedTopicId)),
        [context, selectedTopicId]
    );
    const answerMap = useMemo(() => buildQuestionAnswerMap(activeSession), [activeSession]);
    const wrongFeedbackMap = useMemo(() => buildWrongFeedbackMap(activeSession), [activeSession]);

    const loadContext = async () => {
        setLoading(true);
        const query = `/quiz/context?table_id=${encodeURIComponent(tableId)}&group_id=${encodeURIComponent(groupId)}${objectId ? `&object_id=${encodeURIComponent(objectId)}` : ""}`;
        const data = await apiGet(query);
        setContext(data);
        setActiveSession(data.active_session || null);
        if (!selectedTopicId && data.topics?.length > 0) {
            setSelectedTopicId(String(data.active_session?.topic_id || data.topics[0].topic_id));
        }
        setLoading(false);
    };

    useEffect(() => {
        loadContext();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tableId, objectId]);

    useEffect(() => {
        const timerId = window.setInterval(() => setNow(Date.now()), 500);
        return () => window.clearInterval(timerId);
    }, []);

    useEffect(() => {
        if (!activeSession?.quiz_session_id || !activeSession?.is_member || activeSession.status === "saved") return undefined;

        const intervalId = window.setInterval(() => {
            apiPost(`/quiz/sessions/${activeSession.quiz_session_id}/heartbeat`, {}).then((data) => {
                if (data.session) setActiveSession(data.session);
                if (data.message && !data.session) setMessage(data.message);
            });
        }, activeSession.status === "in_progress" ? 1500 : 4000);

        return () => window.clearInterval(intervalId);
    }, [activeSession?.quiz_session_id, activeSession?.is_member, activeSession?.status]);

    const localTimeLeft = useMemo(() => {
        if (activeSession?.status !== "in_progress" || !activeSession.question_started_at) {
            return activeSession?.question_time_seconds || context?.question_time_seconds || 15;
        }
        const started = new Date(activeSession.question_started_at).getTime();
        const elapsed = Math.floor((now - started) / 1000);
        return Math.max(0, (activeSession.question_time_seconds || 15) - elapsed);
    }, [activeSession, context, now]);

    const revealTimeLeft = useMemo(() => {
        if (activeSession?.status !== "in_progress" || !activeSession.question_completed_at) return null;
        const completed = new Date(activeSession.question_completed_at).getTime();
        const elapsed = Math.floor((now - completed) / 1000);
        return Math.max(0, (activeSession.question_reveal_seconds || 3) - elapsed);
    }, [activeSession, now]);

    useEffect(() => {
        if (
            activeSession?.status !== "in_progress"
            || !activeSession?.quiz_session_id
            || !activeSession?.is_member
            || activeSession?.my_current_answer
            || localTimeLeft !== 0
        ) {
            return;
        }

        const timeoutKey = `${activeSession.quiz_session_id}:${activeSession.current_question_index}`;
        if (timeoutPulseRef.current === timeoutKey) return;
        timeoutPulseRef.current = timeoutKey;

        apiPost(`/quiz/sessions/${activeSession.quiz_session_id}/heartbeat`, {}).then((data) => {
            if (data.session) setActiveSession(data.session);
        });
    }, [activeSession, localTimeLeft]);

    const handleCreateQuiz = async () => {
        if (!selectedTopicId) {
            setMessage("Pilih topic terlebih dahulu.");
            return;
        }

        setBusy(true);
        setMessage("");
        const data = await apiPost("/quiz/sessions", {
            table_id: tableId,
            group_id: groupId,
            object_id: objectId,
            topic_id: selectedTopicId,
        });

        if (data.session) {
            setActiveSession(data.session);
        } else if (data.active_session) {
            setActiveSession(data.active_session);
            setMessage(getMessage(data, "Quiz aktif ditemukan. Silakan join."));
        } else {
            setMessage(getMessage(data, "Gagal membuat quiz."));
        }
        setBusy(false);
    };

    const handleJoinQuiz = async () => {
        if (!activeSession?.quiz_session_id) return;

        setBusy(true);
        setMessage("");
        const data = await apiPost(`/quiz/sessions/${activeSession.quiz_session_id}/join`, {});
        if (data.session) {
            setActiveSession(data.session);
        } else {
            setMessage(getMessage(data, "Gagal join quiz."));
        }
        setBusy(false);
    };

    const handleBeginQuiz = async () => {
        if (!activeSession?.quiz_session_id) return;

        setBusy(true);
        setMessage("");
        const data = await apiPost(`/quiz/sessions/${activeSession.quiz_session_id}/start`, {});
        if (data.session) {
            setActiveSession(data.session);
        } else {
            setMessage(getMessage(data, "Quiz belum bisa dimulai."));
        }
        setBusy(false);
    };

    const handleExitQuiz = async () => {
        if (!activeSession?.quiz_session_id) return;

        setBusy(true);
        setMessage("");
        const data = await apiPost(`/quiz/sessions/${activeSession.quiz_session_id}/exit`, {});
        if (data.session) {
            setActiveSession(data.session);
            setMessage(getMessage(data, "Berhasil keluar dari quiz."));
        } else {
            setActiveSession(null);
            setMessage(getMessage(data, "Quiz lobby dibatalkan."));
            loadContext();
        }
        setBusy(false);
    };

    const handleAnswer = async (answerIndex) => {
        if (!activeSession?.quiz_session_id || activeSession.my_current_answer || localTimeLeft <= 0) return;

        setBusy(true);
        setMessage("");
        const data = await apiPost(`/quiz/sessions/${activeSession.quiz_session_id}/answer`, {
            answer_index: answerIndex,
        });
        if (data.session) {
            setActiveSession(data.session);
        } else {
            setMessage(getMessage(data, "Gagal mengirim jawaban."));
        }
        setBusy(false);
    };

    const handleSaveResult = async () => {
        if (!activeSession?.quiz_session_id) return;

        setBusy(true);
        setSavingResult(true);
        setMessage("");
        try {
            const data = await apiPost(`/quiz/sessions/${activeSession.quiz_session_id}/save`, {});
            if (data.session) {
                setActiveSession(data.session);
                setMessage(getMessage(data, "Hasil quiz tersimpan."));
            } else {
                setMessage(getMessage(data, "Gagal menyimpan hasil quiz."));
            }
        } catch (error) {
            setMessage("Gagal menyimpan hasil quiz.");
        }
        setSavingResult(false);
        setBusy(false);
    };

    if (loading) {
        return <main className="quiz-app quiz-app--center">Memuat quiz...</main>;
    }

    const showGamification = !!context?.gamification_enabled;

    if (activeSession?.is_member) {
        const currentQuestion = activeSession.current_question;
        const myAnswer = activeSession.my_current_answer;
        const progressText = activeSession.status === "in_progress"
            ? `${activeSession.current_question_index + 1}/${activeSession.question_count}`
            : `${activeSession.question_count} questions`;

        return (
            <main className="quiz-app quiz-workspace">
                <aside className="quiz-members" aria-label="Quiz members">
                    <div className="quiz-members__heading">Group {activeSession.group_id || activeSession.table_id}</div>
                    {activeSession.members.map((member) => (
                        <div className="quiz-member" key={member.member_id}>
                            <img src={avatarSrc(member.avatar_public_path)} alt={member.name} />
                            <span>{member.name}</span>
                        </div>
                    ))}
                </aside>

                <section className="quiz-main">
                    <div className="quiz-header">
                        <div>
                            <span className="quiz-label">{context?.course?.course_name}</span>
                            <h1>Live Quiz</h1>
                        </div>
                        <div className="quiz-header__meta">
                            <span>{progressText}</span>
                            <span>{activeSession.member_count}/{activeSession.max_members}</span>
                        </div>
                    </div>

                    {activeSession.status === "lobby" && (
                        <div className="quiz-panel quiz-lobby">
                            <div>
                                <h2>Waiting Room</h2>
                                <p>
                                    {activeSession.is_host
                                        ? "Start unlocks when the second user joins this table."
                                        : "You joined the quiz. Wait for the host to start."}
                                </p>
                            </div>
                            <div className="quiz-lobby__actions">
                                {activeSession.is_host && (
                                    <button
                                        className="quiz-button quiz-button--primary"
                                        onClick={handleBeginQuiz}
                                        disabled={!activeSession.can_start || busy}
                                    >
                                        Start Quiz
                                    </button>
                                )}
                                <button
                                    className="quiz-button quiz-button--danger"
                                    onClick={handleExitQuiz}
                                    disabled={busy}
                                >
                                    Exit Quiz
                                </button>
                            </div>
                        </div>
                    )}

                    {activeSession.status === "in_progress" && currentQuestion && (
                        <>
                            <div className="quiz-timer" aria-label={`Time left ${localTimeLeft} seconds`}>
                                <div className="quiz-timer__bar">
                                    <div style={{width: `${Math.max(0, Math.min(100, (localTimeLeft / activeSession.question_time_seconds) * 100))}%`}} />
                                </div>
                                <strong>{revealTimeLeft !== null ? `Next ${revealTimeLeft}s` : `${localTimeLeft}s`}</strong>
                            </div>

                            <div className="quiz-panel quiz-question">
                                <div className="quiz-question__topline">
                                    <span>Question {activeSession.current_question_index + 1}</span>
                                    {myAnswer && (
                                        <strong className={myAnswer.is_correct ? "is-correct" : "is-wrong"}>
                                            {myAnswer.is_correct ? "Correct" : "Wrong"}
                                        </strong>
                                    )}
                                </div>
                                <h2>{currentQuestion.question_text}</h2>

                                <div className="quiz-options">
                                    {(currentQuestion.choices || []).map((choice, index) => {
                                        const isSelected = myAnswer?.answer_index === index;
                                        const isCorrect = currentQuestion.correct_answer_index === index;
                                        const reveal = !!myAnswer;
                                        return (
                                            <button
                                                type="button"
                                                className={[
                                                    "quiz-option",
                                                    isSelected ? "is-selected" : "",
                                                    reveal && isCorrect ? "is-correct" : "",
                                                    reveal && isSelected && !myAnswer.is_correct ? "is-wrong" : "",
                                                ].filter(Boolean).join(" ")}
                                                key={`${index}-${choice}`}
                                                onClick={() => handleAnswer(index)}
                                                disabled={busy || !!myAnswer || localTimeLeft <= 0}
                                            >
                                                <span>{formatChoiceLabel(index)}</span>
                                                <strong>{choice}</strong>
                                            </button>
                                        );
                                    })}
                                </div>

                                {myAnswer && (
                                    <p className="quiz-answer-note">
                                        {showGamification
                                            ? (myAnswer.is_correct ? `+${myAnswer.score} points.` : "No score for this answer.")
                                            : (myAnswer.is_correct ? "Correct answer." : "Wrong answer.")}
                                        {revealTimeLeft !== null ? ` Next question in ${revealTimeLeft}s.` : ""}
                                    </p>
                                )}
                            </div>

                            <div className="quiz-panel quiz-status">
                                <div className="quiz-section-title">
                                    <h2>Player Status</h2>
                                    <span>{revealTimeLeft !== null ? "Revealing" : myAnswer ? "Waiting" : "Answering"}</span>
                                </div>
                                {activeSession.current_statuses.map((status) => (
                                    <div className="quiz-status-row" key={status.user_id}>
                                        <strong>{status.name}</strong>
                                        <span>{status.status === "answered" ? "Answered" : "Working on quiz"}</span>
                                    </div>
                                ))}
                            </div>
                        </>
                    )}

                    {["completed", "saved"].includes(activeSession.status) && (
                        <div className="quiz-results">
                            <div className="quiz-panel quiz-winner">
                                <span className="quiz-label">Result</span>
                                <h2>
                                    {activeSession.winner?.is_tie
                                        ? `Tie: ${(activeSession.winner.names || []).join(", ")}`
                                        : `${activeSession.winner?.name || "Winner"} wins`}
                                </h2>
                                <p>
                                    {showGamification
                                        ? "Total score is based on correct answers."
                                        : "Result is based on correct answers."}
                                </p>
                                {activeSession.status === "completed" ? (
                                    <button className="quiz-button quiz-button--primary" onClick={handleSaveResult} disabled={busy}>
                                        {busy ? "Saving Result..." : "Save Result"}
                                    </button>
                                ) : (
                                    <span className="quiz-saved">Saved</span>
                                )}
                                {activeSession.wrong_answer_feedback_error && (
                                    <p className="quiz-feedback-error">{activeSession.wrong_answer_feedback_error}</p>
                                )}
                            </div>

                            {savingResult && (
                                <div className="quiz-panel quiz-feedback-loading" role="status" aria-live="polite">
                                    <span className="quiz-spinner" aria-hidden="true" />
                                    <div>
                                        <h2>Getting AI Feedback</h2>
                                        <p>Please keep this window open while wrong-answer feedback is generated and the result is saved.</p>
                                    </div>
                                </div>
                            )}

                            {showGamification && (
                                <div className="quiz-panel">
                                    <div className="quiz-section-title">
                                        <h2>Scoreboard</h2>
                                        <span>{activeSession.scoreboard.length} players</span>
                                    </div>
                                    <div className="quiz-scoreboard">
                                        {activeSession.scoreboard.map((item, index) => (
                                            <article className="quiz-score-row" key={item.user_id}>
                                                <div className="quiz-rank">{index + 1}</div>
                                                <img src={avatarSrc(item.avatar_public_path)} alt={item.name} />
                                                <div>
                                                    <strong>{item.name}</strong>
                                                    <span>{item.correct_count}/{item.question_count} correct</span>
                                                </div>
                                                <b>{item.total_score}</b>
                                            </article>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <div className="quiz-panel">
                                <div className="quiz-section-title">
                                    <h2>Quiz Review</h2>
                                    <span>{activeSession.questions.length} questions</span>
                                </div>
                                <div className="quiz-review-list">
                                    {activeSession.questions.map((question, questionIndex) => (
                                        <article className="quiz-review-card" key={question.question_id}>
                                            <h3>{questionIndex + 1}. {question.question_text}</h3>
                                            <p>Correct answer: {formatChoiceLabel(question.correct_answer_index)}. {question.choices?.[question.correct_answer_index]}</p>
                                            {(answerMap[String(question.question_id)] || []).map((answer) => (
                                                <div
                                                    className={`quiz-review-answer${showGamification ? "" : " quiz-review-answer--no-score"}`}
                                                    key={answer.answer_id}
                                                >
                                                    <strong>{answer.name}</strong>
                                                    <span>
                                                        {answer.answer_index === null
                                                            ? "No answer"
                                                            : `${formatChoiceLabel(answer.answer_index)}. ${question.choices?.[answer.answer_index] || ""}`}
                                                    </span>
                                                    {showGamification && (
                                                        <b className={answer.is_correct ? "is-correct" : "is-wrong"}>
                                                            {answer.score} pts
                                                        </b>
                                                    )}
                                                    {wrongFeedbackMap[`${answer.user_id}:${question.question_id}`] && (
                                                        <div className="quiz-ai-feedback">
                                                            <strong>AI Feedback</strong>
                                                            <p>{wrongFeedbackMap[`${answer.user_id}:${question.question_id}`]}</p>
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                        </article>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}

                    {message && <p className="quiz-message">{message}</p>}
                </section>
            </main>
        );
    }

    const hasActiveSession = !!activeSession;
    const canStart = !hasActiveSession && !!selectedTopicId;
    const canJoin = hasActiveSession && !activeSession.is_full && ["lobby", "in_progress"].includes(activeSession.status);

    return (
        <main className="quiz-app quiz-landing">
            <section className="quiz-hero">
                <span className="quiz-label">Big Table Quiz</span>
                <h1>{context?.course?.course_name || "Course Quiz"}</h1>
                <p>
                    {showGamification
                        ? "Choose a topic, host a two-player live quiz, and compete with correct-answer scores."
                        : "Choose a topic, host a two-player live quiz, and compare the final result."}
                </p>
            </section>

            <section className="quiz-layout">
                <div className="quiz-panel">
                    <div className="quiz-section-title">
                        <h2>Topics</h2>
                        <span>{context?.topics?.length || 0} available</span>
                    </div>
                    {context?.topics?.length > 0 ? (
                        <div className="quiz-topic-list">
                            {context.topics.map((topic) => (
                                <button
                                    type="button"
                                    className={`quiz-topic${String(topic.topic_id) === String(selectedTopicId) ? " is-selected" : ""}`}
                                    key={topic.topic_id}
                                    onClick={() => setSelectedTopicId(String(topic.topic_id))}
                                    disabled={hasActiveSession}
                                >
                                    <strong>{topic.topic_name}</strong>
                                    {topic.topic_description && <span>{topic.topic_description}</span>}
                                </button>
                            ))}
                        </div>
                    ) : (
                        <p className="quiz-empty">No topics found for this course yet.</p>
                    )}
                </div>

                <div className="quiz-panel quiz-table-card">
                    <div className="quiz-section-title">
                        <h2>Group {groupId}</h2>
                        <span>{hasActiveSession ? "Active" : "Ready"}</span>
                    </div>

                    {hasActiveSession ? (
                        <>
                            <p>A quiz is already active at this big table. New users can only join while a seat is available.</p>
                            <div className="quiz-member-strip">
                                {activeSession.members.map((member) => (
                                    <img key={member.member_id} src={avatarSrc(member.avatar_public_path)} alt={member.name} />
                                ))}
                            </div>
                            <button className="quiz-button quiz-button--primary" onClick={handleJoinQuiz} disabled={!canJoin || busy}>
                                Join Quiz
                            </button>
                        </>
                    ) : (
                        <>
                            <p>
                                {selectedTopic
                                    ? `Host a 5-question quiz for ${selectedTopic.topic_name}.`
                                    : "Select a topic before hosting."}
                            </p>
                            <button className="quiz-button quiz-button--primary" onClick={handleCreateQuiz} disabled={!canStart || busy}>
                                Host Quiz
                            </button>
                        </>
                    )}

                    {activeSession?.is_full && <p className="quiz-message">This quiz table is full.</p>}
                    {message && <p className="quiz-message">{message}</p>}
                </div>
            </section>
        </main>
    );
};

export default QuizActivityPage;
