import React, {useEffect, useMemo, useState} from "react";
import {useSearchParams} from "react-router-dom";
import {API_URL, apiGet, apiPatch, apiPost} from "../api/apiClient";
import "./TableActivityPage.css";

const avatarSrc = (path) => {
    if (!path) return "/avatars/default.png";
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    return `/avatars${normalizedPath}/thumbnail.png`;
};

const getMessage = (data, fallback) => data?.message || fallback;

const isNoVirtualCode = (value) => {
    const parsed = Number.parseInt(value, 10);
    return String(parsed) === String(value).trim() && parsed >= 101 && parsed <= 150;
};

const TableActivityPage = ({embedded = false, noVirtual = false, onBack}) => {
    const [searchParams] = useSearchParams();
    const routeGroupId = searchParams.get("group_id") || (noVirtual ? "" : "1");
    const objectId = searchParams.get("object_id");
    const [entryCode, setEntryCode] = useState(noVirtual ? routeGroupId : "");
    const [selectedEntryGroupId, setSelectedEntryGroupId] = useState(noVirtual && isNoVirtualCode(routeGroupId) ? routeGroupId : "");
    const groupId = noVirtual ? (selectedEntryGroupId || entryCode || "101") : routeGroupId;

    const [context, setContext] = useState(null);
    const [selectedTopicId, setSelectedTopicId] = useState("");
    const [activeSession, setActiveSession] = useState(null);
    const [answerText, setAnswerText] = useState("");
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [submittingFeedback, setSubmittingFeedback] = useState(false);
    const [message, setMessage] = useState("");

    const selectedTopic = useMemo(
        () => context?.topics?.find((topic) => String(topic.topic_id) === String(selectedTopicId)),
        [context, selectedTopicId]
    );

    const activeAnswers = activeSession?.answers || [];
    const isGeneratingFeedback = submittingFeedback || activeSession?.is_generating_feedback;
    const answersLocked = !!activeSession?.is_submitted || !!isGeneratingFeedback;
    const combinedFeedback = activeSession?.combined_feedback;
    const feedbackGroups = activeSession?.feedback_groups || [];
    const gamification = activeSession?.gamification;
    const showGamification = !!gamification?.enabled;

    const loadContext = async (nextGroupId = groupId, useActiveSession = true) => {
        setLoading(true);
        const data = await apiGet(`/table/context?group_id=${nextGroupId}${objectId ? `&object_id=${objectId}` : ""}`);
        setContext(data);
        setActiveSession(useActiveSession ? data.active_session || null : null);
        setAnswerText(useActiveSession ? data.active_session?.my_answer?.answer_text || "" : "");
        if (!selectedTopicId && data.topics?.length > 0) {
            setSelectedTopicId(String((useActiveSession ? data.active_session?.topic_id : null) || data.topics[0].topic_id));
        }
        setLoading(false);
    };

    useEffect(() => {
        loadContext(noVirtual && !selectedEntryGroupId ? "101" : groupId, !noVirtual || !!selectedEntryGroupId);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [routeGroupId, objectId, noVirtual, selectedEntryGroupId]);

    useEffect(() => {
        if (!activeSession?.session_id || !activeSession?.is_member || isGeneratingFeedback) return undefined;

        const intervalId = window.setInterval(() => {
            apiPost(`/table/sessions/${activeSession.session_id}/heartbeat`, {}).then((data) => {
                if (data.session) {
                    setActiveSession(data.session);
                } else {
                    setMessage(getMessage(data, "Group session tidak tersedia."));
                    setActiveSession(null);
                }
            });
        }, 10000);

        return () => window.clearInterval(intervalId);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeSession?.session_id, activeSession?.is_member, isGeneratingFeedback]);

    useEffect(() => {
        if (!isGeneratingFeedback) return undefined;

        const preventUnload = (event) => {
            event.preventDefault();
            event.returnValue = "";
            return "";
        };

        window.addEventListener("beforeunload", preventUnload);

        return () => {
            window.removeEventListener("beforeunload", preventUnload);
        };
    }, [isGeneratingFeedback]);

    useEffect(() => {
        if (!activeSession?.session_id || !activeSession?.is_member) return undefined;

        const exitUrl = `${API_URL}/table/sessions/${activeSession.session_id}/exit`;
        const exitGroup = () => {
            fetch(exitUrl, {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                credentials: "include",
                body: "{}",
                keepalive: true,
            }).catch(() => {});
        };

        window.addEventListener("pagehide", exitGroup);

        return () => {
            window.removeEventListener("pagehide", exitGroup);
        };
    }, [activeSession?.session_id, activeSession?.is_member]);

    const handleStart = async () => {
        const nextGroupId = noVirtual ? entryCode.trim() : groupId;
        if (noVirtual && !isNoVirtualCode(nextGroupId)) {
            setMessage("Masukkan kode unik antara 101-150.");
            return;
        }
        if (!selectedTopicId) {
            setMessage("Pilih topic terlebih dahulu.");
            return;
        }

        setBusy(true);
        setMessage("");
        const data = await apiPost("/table/sessions", {
            group_id: nextGroupId,
            object_id: objectId,
            topic_id: selectedTopicId,
        });

        if (data.session) {
            if (noVirtual) setSelectedEntryGroupId(nextGroupId);
            setActiveSession(data.session);
            setAnswerText(data.session.my_answer?.answer_text || "");
        } else if (data.active_session) {
            if (noVirtual) setSelectedEntryGroupId(nextGroupId);
            setActiveSession(data.active_session);
            setAnswerText(data.active_session.my_answer?.answer_text || "");
            setMessage(getMessage(data, "Session aktif ditemukan. Silakan join."));
        } else {
            setMessage(getMessage(data, "Gagal membuat group session."));
        }
        setBusy(false);
    };

    const joinSession = async (session, nextGroupId = groupId) => {
        if (!session?.session_id) return;

        setBusy(true);
        setMessage("");
        const data = await apiPost(`/table/sessions/${session.session_id}/join`, {});
        if (data.session) {
            if (noVirtual) setSelectedEntryGroupId(nextGroupId);
            setActiveSession(data.session);
            setAnswerText(data.session.my_answer?.answer_text || "");
        } else {
            setMessage(getMessage(data, "Gagal join group."));
        }
        setBusy(false);
    };

    const handleJoin = async () => joinSession(activeSession);

    const handleJoinByCode = async () => {
        const nextGroupId = entryCode.trim();
        if (!isNoVirtualCode(nextGroupId)) {
            setMessage("Masukkan kode unik antara 101-150.");
            return;
        }

        setBusy(true);
        setMessage("");
        const data = await apiGet(`/table/context?group_id=${nextGroupId}`);
        setContext(data);
        if (!selectedTopicId && data.topics?.length > 0) {
            setSelectedTopicId(String(data.active_session?.topic_id || data.topics[0].topic_id));
        }

        if (!data.active_session) {
            setActiveSession(null);
            setMessage(`Tidak ada sesi aktif untuk group ${nextGroupId}.`);
            setBusy(false);
            return;
        }

        setBusy(false);
        await joinSession(data.active_session, nextGroupId);
    };

    const handleExitGroup = async () => {
        if (!activeSession?.session_id) return;
        if (isGeneratingFeedback) {
            setMessage("Feedback sedang dibuat. Mohon tunggu sebelum keluar dari group.");
            return;
        }

        setBusy(true);
        setMessage("");
        const data = await apiPost(`/table/sessions/${activeSession.session_id}/exit`, {});
        setAnswerText("");
        if (data.session?.is_active) {
            setActiveSession(data.session);
            setMessage(getMessage(data, "Berhasil keluar dari group."));
        } else {
            setActiveSession(null);
            setMessage(getMessage(data, "Group session selesai."));
            loadContext();
        }
        setBusy(false);
    };

    const handleSaveAnswer = async () => {
        if (!activeSession?.session_id) return;
        if (isGeneratingFeedback) {
            setMessage("Feedback sedang dibuat. Jawaban tidak bisa diedit saat ini.");
            return;
        }

        setBusy(true);
        setMessage("");
        const data = await apiPatch(`/table/sessions/${activeSession.session_id}/answer`, {
            answer_text: answerText,
        });

        if (data.session) {
            setActiveSession(data.session);
            setMessage("Jawaban tersimpan.");
        } else {
            setMessage(getMessage(data, "Gagal menyimpan jawaban."));
        }
        setBusy(false);
    };

    const handleSubmitAllAnswers = async () => {
        if (!activeSession?.session_id) return;

        setBusy(true);
        setSubmittingFeedback(true);
        setMessage("");
        const data = await apiPost(`/table/sessions/${activeSession.session_id}/submit`, {});

        if (data.session) {
            setActiveSession(data.session);
            setMessage(getMessage(data, "Semua jawaban berhasil disubmit."));
        } else {
            setMessage(getMessage(data, "Gagal submit semua jawaban."));
        }
        setSubmittingFeedback(false);
        setBusy(false);
    };

    const blockClipboard = (event) => {
        event.preventDefault();
        setMessage("Copy, cut, paste, and drop are disabled in the answer field.");
    };

    if (loading) {
        return <main className={`table-app table-app--center${embedded ? " table-app--embedded" : ""}`}>Memuat aktivitas meja...</main>;
    }

    if (activeSession?.is_member) {
        return (
            <main className={`table-app table-workspace${embedded ? " table-app--embedded" : ""}`}>
                <aside className="table-members" aria-label="Group members">
                    <div className="table-members__heading">Group {activeSession.group_id}</div>
                    {activeSession.members.map((member) => (
                        <div className="table-member" key={member.member_id}>
                            <img src={avatarSrc(member.avatar_public_path)} alt={member.name} />
                            <span>{member.name}</span>
                        </div>
                    ))}
                </aside>

                <section className="table-case">
                    <div className="table-case__header">
                        <div>
                            <span className="table-label">{context?.course?.course_name}</span>
                            <h1>{activeSession.case_title}</h1>
                        </div>
                        <div className="table-case__actions">
                            {embedded && (
                                <button className="no-virtual-back" type="button" onClick={onBack}>
                                    Back
                                </button>
                            )}
                            <span className="table-count">{activeSession.member_count}/{activeSession.max_members}</span>
                            <button className="table-button table-button--danger" onClick={handleExitGroup} disabled={busy || isGeneratingFeedback}>
                                {isGeneratingFeedback ? "Please Wait" : "Exit Group"}
                            </button>
                        </div>
                    </div>

                    {isGeneratingFeedback && (
                        <div className="table-panel table-feedback-loading" role="status" aria-live="polite">
                            <span className="table-spinner" aria-hidden="true" />
                            <div>
                                <h2>Getting Feedback</h2>
                                <p>The system is analyzing the case and all submitted answers. Students cannot exit the group during this process.</p>
                            </div>
                        </div>
                    )}

                    {showGamification && (
                        <div className="table-panel table-gamification">
                            <div className="table-section-title">
                                <h2>Group XP</h2>
                                <span>{gamification.group_xp || 0} XP</span>
                            </div>

                            <div className="xp-meter" aria-label={`Group XP ${gamification.group_xp || 0} out of 100`}>
                                <div style={{width: `${Math.min(100, Math.max(0, gamification.group_xp || 0))}%`}} />
                            </div>
                            {gamification.group_xp_reason && <p className="xp-reason">{gamification.group_xp_reason}</p>}

                            <div className="leaderboard">
                                {(gamification.leaderboard || []).map((item, index) => (
                                    <article className="leaderboard-row" key={item.user_id}>
                                        <div className="leaderboard-rank">{index + 1}</div>
                                        <img src={avatarSrc(item.avatar_public_path)} alt={item.name} />
                                        <div className="leaderboard-student">
                                            <strong>{item.name}</strong>
                                            <span>{item.answered ? "Answered" : "Waiting for answer"}</span>
                                        </div>
                                        <div className="leaderboard-xp">{item.xp_earned || 0} XP</div>
                                    </article>
                                ))}
                            </div>
                        </div>
                    )}

                    <div className="table-panel">
                        <h2>Case Study</h2>
                        <p>{activeSession.case_prompt}</p>
                    </div>

                    <div className="table-panel table-answer">
                        <h2>My Answer</h2>
                        <textarea
                            value={answerText}
                            onChange={(event) => setAnswerText(event.target.value)}
                            onCopy={blockClipboard}
                            onCut={blockClipboard}
                            onDrop={blockClipboard}
                            onPaste={blockClipboard}
                            placeholder="Write your answer here..."
                            disabled={answersLocked}
                        />
                        <button className="table-button table-button--primary" onClick={handleSaveAnswer} disabled={busy || answersLocked}>
                            {answersLocked ? "Answer Locked" : "Save My Answer"}
                        </button>
                    </div>

                    <div className="table-panel table-answer-list">
                        <div className="table-section-title">
                            <h2>Saved Answers</h2>
                            <span>{activeAnswers.length} visible</span>
                        </div>

                        {activeSession.can_submit && (
                            <button
                                className="table-button table-button--submit"
                                onClick={handleSubmitAllAnswers}
                                disabled={busy || isGeneratingFeedback || activeAnswers.length === 0}
                            >
                                {isGeneratingFeedback ? "Getting Feedback..." : "Submit All Answers"}
                            </button>
                        )}

                        {activeSession.is_starter && activeSession.is_submitted && (
                            <p className="table-submit-note">Submitted. Answers are locked for every student.</p>
                        )}

                        {activeAnswers.length > 0 ? (
                            <div className="answer-list">
                                {activeAnswers.map((answer) => (
                                    <article className="answer-card" key={answer.answer_id}>
                                        <div className="answer-card__author">
                                            <img src={avatarSrc(answer.avatar_public_path)} alt={answer.name} />
                                            <div>
                                                <strong>{answer.name}</strong>
                                                <span>{new Date(answer.updated_at).toLocaleTimeString([], {hour: "2-digit", minute: "2-digit"})}</span>
                                            </div>
                                        </div>
                                        <p>{answer.answer_text}</p>
                                    </article>
                                ))}
                            </div>
                        ) : (
                            <p className="table-empty">No active student has saved an answer yet.</p>
                        )}
                    </div>

                    {activeSession.is_submitted && (
                        <div className="table-panel table-feedback">
                            <div className="table-section-title">
                                <h2>Cognitive Evaluation Feedback</h2>
                                <span>{activeSession.feedback_model || "Submitted"}</span>
                            </div>

                            {combinedFeedback ? (
                                <div className="feedback-block">
                                    <h3>Combined Answer</h3>
                                    <div className="feedback-grid">
                                        <article>
                                            <strong>WWW</strong>
                                            <p>{combinedFeedback.www}</p>
                                        </article>
                                        <article>
                                            <strong>EBI</strong>
                                            <p>{combinedFeedback.ebi}</p>
                                        </article>
                                    </div>
                                </div>
                            ) : (
                                <p>{activeSession.feedback_text}</p>
                            )}

                            {feedbackGroups.length > 0 && (
                                <div className="feedback-block">
                                    <h3>Student Feedback</h3>
                                    <div className="student-feedback-list">
                                        {feedbackGroups.map((group) => (
                                            <article className="student-feedback-card" key={group.feedback_group_id}>
                                                <div className="student-feedback-card__names">
                                                    {(group.student_names || []).join(", ")}
                                                </div>
                                                <div className="feedback-grid">
                                                    <article>
                                                        <strong>WWW</strong>
                                                        <p>{group.www}</p>
                                                    </article>
                                                    <article>
                                                        <strong>EBI</strong>
                                                        <p>{group.ebi}</p>
                                                    </article>
                                                </div>
                                            </article>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {message && <p className="table-message">{message}</p>}
                </section>
            </main>
        );
    }

    const hasActiveSession = !!activeSession;
    const groupFull = activeSession?.is_full;
    const canStart = !hasActiveSession && !!selectedTopicId;
    const canJoin = hasActiveSession && !groupFull;

    return (
        <main className={`table-app table-landing${embedded ? " table-app--embedded" : ""}`}>
            {embedded && (
                <button className="no-virtual-back" type="button" onClick={onBack}>
                    Back
                </button>
            )}
            <section className="table-landing__hero">
                <span className="table-label">{noVirtual ? "No Map Group Activity" : "Table Group Activity"}</span>
                <h1>{context?.course?.course_name || "Course Activity"}</h1>
                <p>
                    {noVirtual
                        ? "Enter a unique code from 101 to 150 to host or join a live case study group."
                        : `Group ${groupId} can work together on one active case study session with up to four students.`}
                </p>
            </section>

            <section className="table-layout">
                <div className="table-topics">
                    <div className="table-section-title">
                        <h2>Course Topics</h2>
                        <span>{context?.topics?.length || 0} available</span>
                    </div>

                    {context?.topics?.length > 0 ? (
                        <div className="topic-list">
                            {context.topics.map((topic) => (
                                <button
                                    type="button"
                                    className={`topic-option${String(topic.topic_id) === String(selectedTopicId) ? " is-selected" : ""}`}
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
                        <p className="table-empty">No topics found for this course yet.</p>
                    )}
                </div>

                <div className="table-status">
                    <div className="table-section-title">
                        <h2>Group {noVirtual ? entryCode || selectedEntryGroupId || "Code" : groupId}</h2>
                        <span>{hasActiveSession ? "Active" : "Ready"}</span>
                    </div>

                    {noVirtual && (
                        <div className="no-virtual-code-form">
                            <label>
                                Group code
                                <input
                                    type="text"
                                    inputMode="numeric"
                                    pattern="[0-9]*"
                                    value={entryCode}
                                    onChange={(event) => {
                                        const nextCode = event.target.value.replace(/\D/g, "").slice(0, 3);
                                        setEntryCode(nextCode);
                                        if (selectedEntryGroupId && nextCode !== selectedEntryGroupId) {
                                            setSelectedEntryGroupId("");
                                            setActiveSession(null);
                                        }
                                    }}
                                    placeholder="101-150"
                                    disabled={!!activeSession?.is_member || busy}
                                />
                            </label>
                        </div>
                    )}

                    {hasActiveSession ? (
                        <>
                            <p className="table-status__copy">
                                A session is already active. Join is available until the group reaches four students.
                            </p>
                            <div className="member-strip">
                                {activeSession.members.map((member) => (
                                    <img key={member.member_id} src={avatarSrc(member.avatar_public_path)} alt={member.name} />
                                ))}
                            </div>
                            <button
                                className="table-button table-button--primary"
                                onClick={handleJoin}
                                disabled={!canJoin || busy}
                            >
                                Join Group {groupId}
                            </button>
                        </>
                    ) : (
                        <>
                            <p className="table-status__copy">
                                {selectedTopic
                                    ? `Start a case study for ${selectedTopic.topic_name}.`
                                    : "Select a topic before starting the group."}
                            </p>
                            {noVirtual ? (
                                <div className="no-virtual-code-actions">
                                    <button
                                        className="table-button table-button--primary"
                                        onClick={handleStart}
                                        disabled={!canStart || busy || !isNoVirtualCode(entryCode)}
                                    >
                                        Host Group
                                    </button>
                                    <button
                                        className="table-button table-button--primary"
                                        onClick={handleJoinByCode}
                                        disabled={busy || !isNoVirtualCode(entryCode)}
                                    >
                                        Join Group
                                    </button>
                                </div>
                            ) : (
                                <button
                                    className="table-button table-button--primary"
                                    onClick={handleStart}
                                    disabled={!canStart || busy}
                                >
                                    Create/Start Group {groupId}
                                </button>
                            )}
                        </>
                    )}

                    {groupFull && <p className="table-message">This group is full. Create and join are unavailable.</p>}
                    {message && <p className="table-message">{message}</p>}
                </div>
            </section>
        </main>
    );
};

export default TableActivityPage;
