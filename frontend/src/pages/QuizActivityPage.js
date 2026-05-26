import React, {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {useSearchParams} from "react-router-dom";
import {apiGet, apiPost} from "../api/apiClient";
import AvatarIcon from "../components/AvatarIcon";
import socket from "../utils/socketClient";
import {
    ACTIVITY_STATUS,
    activeActivityMessage,
    clearActivityStatus,
    setActivityStatus,
} from "../utils/activityStatus";
import useCopyProtection from "../utils/useCopyProtection";
import "./QuizActivityPage.css";

const getMessage = (data, fallback) => data?.message || fallback;

const isTypingTarget = (target) =>
    target && (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable
    );

const isNoVirtualCode = (value) => {
    const parsed = Number.parseInt(value, 10);
    return String(parsed) === String(value).trim() && parsed >= 101 && parsed <= 150;
};

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

function stampSession(session) {
    return session ? {...session, _received_at_ms: Date.now()} : null;
}

function getSessionNow(session, localNow) {
    if (!session?.server_time_ms || !session?._received_at_ms) return localNow;
    return Number(session.server_time_ms) + (localNow - Number(session._received_at_ms));
}

const QuizActivityPage = ({embedded = false, noVirtual = false, onBack, activitySearchParams = null, exitOnBack = false}) => {
    const [routeSearchParams] = useSearchParams();
    const searchParams = useMemo(
        () => activitySearchParams ? new URLSearchParams(activitySearchParams) : routeSearchParams,
        [activitySearchParams, routeSearchParams]
    );
    const routeTableId = searchParams.get("table_id") || searchParams.get("group_id") || searchParams.get("object_id") || (noVirtual ? "" : "1");
    const [entryCode, setEntryCode] = useState(noVirtual ? routeTableId : "");
    const [selectedEntryGroupId, setSelectedEntryGroupId] = useState(noVirtual && isNoVirtualCode(routeTableId) ? routeTableId : "");
    const tableId = noVirtual ? (selectedEntryGroupId || entryCode || "101") : routeTableId;
    const groupId = noVirtual ? tableId : (searchParams.get("group_id") || tableId);
    const objectId = searchParams.get("object_id");

    const [context, setContext] = useState(null);
    const [selectedTopicId, setSelectedTopicId] = useState("");
    const [activeSession, setActiveSession] = useState(null);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [savingResult, setSavingResult] = useState(false);
    const [retryingFeedback, setRetryingFeedback] = useState(false);
    const [message, setMessage] = useState("");
    const [now, setNow] = useState(Date.now());
    const [currentUser, setCurrentUser] = useState(null);
    const [confirmStartOpen, setConfirmStartOpen] = useState(false);
    const timeoutPulseRef = useRef("");
    const activityStatusKeyRef = useRef(null);
    const pageUnloadingRef = useRef(false);
    const autoSaveSessionRef = useRef("");

    const selectedTopic = useMemo(
        () => context?.topics?.find((topic) => String(topic.topic_id) === String(selectedTopicId)),
        [context, selectedTopicId]
    );
    const answerMap = useMemo(() => buildQuestionAnswerMap(activeSession), [activeSession]);
    const wrongFeedbackMap = useMemo(() => buildWrongFeedbackMap(activeSession), [activeSession]);

    useCopyProtection(
        !!activeSession?.is_member,
        setMessage,
        "Menyalin konten quiz tidak diizinkan."
    );

    const loadContext = async (nextTableId = tableId, nextGroupId = groupId, useActiveSession = true) => {
        setLoading(true);
        const query = `/quiz/context?table_id=${encodeURIComponent(nextTableId)}&group_id=${encodeURIComponent(nextGroupId)}${objectId ? `&object_id=${encodeURIComponent(objectId)}` : ""}`;
        const data = await apiGet(query);
        setContext(data);
        setActiveSession(useActiveSession ? stampSession(data.active_session || null) : null);
        if (!selectedTopicId && data.topics?.length > 0) {
            setSelectedTopicId(String((useActiveSession ? data.active_session?.topic_id : null) || data.topics[0].topic_id));
        }
        setLoading(false);
    };

    useEffect(() => {
        const initialCode = noVirtual && !selectedEntryGroupId ? "101" : tableId;
        loadContext(initialCode, initialCode, !noVirtual || !!selectedEntryGroupId);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [routeTableId, objectId, noVirtual, selectedEntryGroupId]);

    useEffect(() => {
        apiGet("/session").then((data) => {
            if (data.loggedIn && data.user) setCurrentUser(data.user);
        });
    }, []);

    useEffect(() => {
        const markUnloading = () => {
            pageUnloadingRef.current = true;
        };

        window.addEventListener("pagehide", markUnloading);
        return () => window.removeEventListener("pagehide", markUnloading);
    }, []);

    useEffect(() => {
        const timerId = window.setInterval(() => setNow(Date.now()), 500);
        return () => window.clearInterval(timerId);
    }, []);

    useEffect(() => {
        if (!activeSession?.quiz_session_id || !activeSession?.is_member || activeSession.status === "saved") return undefined;

        const sessionId = activeSession.quiz_session_id;
        const activityKey = `${ACTIVITY_STATUS.quiz.type}:${sessionId}`;
        let disposed = false;

        const refreshQuizSession = async () => {
            const data = await apiGet(`/quiz/sessions/${sessionId}`);
            if (disposed) return;
            if (data.session) {
                setActiveSession(stampSession(data.session));
            } else if (data.message) {
                setMessage(data.message);
            }
        };

        const handleSessionEvent = (event = {}) => {
            if (String(event.quiz_session_id) !== String(sessionId)) return;
            refreshQuizSession();
        };

        const handleLobbyCancelled = (event = {}) => {
            if (String(event.quiz_session_id) !== String(sessionId)) return;
            setActiveSession(null);
            setMessage("Quiz lobby dibatalkan oleh host.");
            if (currentUser) clearActivityStatus({user: currentUser, activityKey});
            if (activityStatusKeyRef.current === activityKey) activityStatusKeyRef.current = null;
        };

        socket.emit("quiz:join", {quiz_session_id: sessionId});
        socket.on("quiz:lobby_updated", handleSessionEvent);
        socket.on("quiz:starting", handleSessionEvent);
        socket.on("quiz:answer_updated", handleSessionEvent);
        socket.on("quiz:session_updated", handleSessionEvent);
        socket.on("quiz:result_saved", handleSessionEvent);
        socket.on("quiz:lobby_cancelled", handleLobbyCancelled);

        return () => {
            disposed = true;
            socket.emit("quiz:leave", {quiz_session_id: sessionId});
            socket.off("quiz:lobby_updated", handleSessionEvent);
            socket.off("quiz:starting", handleSessionEvent);
            socket.off("quiz:answer_updated", handleSessionEvent);
            socket.off("quiz:session_updated", handleSessionEvent);
            socket.off("quiz:result_saved", handleSessionEvent);
            socket.off("quiz:lobby_cancelled", handleLobbyCancelled);
        };
    }, [activeSession?.quiz_session_id, activeSession?.is_member, activeSession?.status, currentUser]);

    useEffect(() => {
        if (!savingResult && !activeSession?.is_saving_result) return undefined;

        const preventUnload = (event) => {
            event.preventDefault();
            event.returnValue = "";
            return "";
        };

        window.addEventListener("beforeunload", preventUnload);
        return () => window.removeEventListener("beforeunload", preventUnload);
    }, [savingResult, activeSession?.is_saving_result]);

    useEffect(() => {
        if (!activeSession?.quiz_session_id || !activeSession?.is_member || activeSession.status === "saved") return undefined;

        const intervalId = window.setInterval(() => {
            apiPost(`/quiz/sessions/${activeSession.quiz_session_id}/heartbeat`, {}).then((data) => {
                if (data.session) setActiveSession(stampSession(data.session));
                if (data.message && !data.session) {
                    setMessage(data.message);
                    setActiveSession(null);
                    if (currentUser) {
                        clearActivityStatus({
                            user: currentUser,
                            activityKey: `${ACTIVITY_STATUS.quiz.type}:${activeSession.quiz_session_id}`,
                        });
                    }
                }
            });
        }, activeSession.status === "in_progress" ? 1500 : 4000);

        return () => window.clearInterval(intervalId);
    }, [activeSession?.quiz_session_id, activeSession?.is_member, activeSession?.status, currentUser]);

    useEffect(() => {
        if (
            !currentUser
            || !activeSession?.quiz_session_id
            || !activeSession?.is_member
            || !["lobby", "in_progress", "completed"].includes(activeSession.status)
        ) {
            return undefined;
        }

        const status = ACTIVITY_STATUS.quiz;
        const activityKey = `${status.type}:${activeSession.quiz_session_id}`;
        const metadata = {
            object_id: activeSession.object_id || objectId,
            group_id: activeSession.group_id,
            table_id: activeSession.table_id,
        };
        const refreshStatus = () => {
            activityStatusKeyRef.current = activityKey;
            setActivityStatus({user: currentUser, status, activityKey, metadata});
        };

        refreshStatus();
        const intervalId = window.setInterval(refreshStatus, 120000);

        return () => {
            window.clearInterval(intervalId);
            if (!pageUnloadingRef.current) {
                clearActivityStatus({user: currentUser, activityKey, keepalive: true});
            }
            if (activityStatusKeyRef.current === activityKey) activityStatusKeyRef.current = null;
        };
    }, [
        currentUser,
        activeSession?.quiz_session_id,
        activeSession?.is_member,
        activeSession?.status,
        activeSession?.object_id,
        activeSession?.group_id,
        activeSession?.table_id,
        objectId,
    ]);

    const reserveQuizStatus = async (activityKey, metadata, isPending = false) => {
        if (!currentUser) return {ok: true};
        const result = await setActivityStatus({
            user: currentUser,
            status: ACTIVITY_STATUS.quiz,
            activityKey,
            metadata,
            isPending,
        });
        if (!result.ok) {
            setMessage(activeActivityMessage(result.current));
        } else {
            activityStatusKeyRef.current = activityKey;
        }
        return result;
    };

    const localTimeLeft = useMemo(() => {
        if (activeSession?.status !== "in_progress" || !activeSession.question_started_at) {
            return activeSession?.question_time_seconds || context?.question_time_seconds || 15;
        }
        const started = new Date(activeSession.question_started_at).getTime();
        const serverNow = getSessionNow(activeSession, now);
        const elapsed = Math.max(0, Math.floor((serverNow - started) / 1000));
        return Math.max(0, (activeSession.question_time_seconds || 15) - elapsed);
    }, [activeSession, context, now]);

    const quizCountdownSeconds = useMemo(() => {
        if (activeSession?.status !== "in_progress" || !activeSession.question_started_at) return 0;
        const started = new Date(activeSession.question_started_at).getTime();
        const serverNow = getSessionNow(activeSession, now);
        return Math.max(0, Math.ceil((started - serverNow) / 1000));
    }, [activeSession, now]);

    const revealTimeLeft = useMemo(() => {
        if (activeSession?.status !== "in_progress" || !activeSession.question_completed_at) return null;
        const completed = new Date(activeSession.question_completed_at).getTime();
        const serverNow = getSessionNow(activeSession, now);
        const elapsed = Math.max(0, Math.floor((serverNow - completed) / 1000));
        return Math.max(0, (activeSession.question_reveal_seconds || 3) - elapsed);
    }, [activeSession, now]);

    useEffect(() => {
        if (
            activeSession?.status !== "in_progress"
            || !activeSession?.quiz_session_id
            || !activeSession?.is_member
            || activeSession?.my_current_answer
            || quizCountdownSeconds > 0
            || localTimeLeft !== 0
        ) {
            return;
        }

        const timeoutKey = `${activeSession.quiz_session_id}:${activeSession.current_question_index}`;
        if (timeoutPulseRef.current === timeoutKey) return;
        timeoutPulseRef.current = timeoutKey;

        apiPost(`/quiz/sessions/${activeSession.quiz_session_id}/heartbeat`, {}).then((data) => {
            if (data.session) setActiveSession(stampSession(data.session));
        });
    }, [activeSession, localTimeLeft, quizCountdownSeconds]);

    useEffect(() => {
        if (!embedded) return undefined;

        const handleEscape = (event) => {
            if (event.key !== "Escape" || isTypingTarget(event.target)) return;
            event.preventDefault();

            if (!activeSession?.is_member) {
                onBack?.();
                return;
            }

            if (savingResult || activeSession?.is_saving_result) {
                setMessage("Hasil quiz sedang disimpan. Jangan refresh, tutup halaman, atau keluar sampai proses selesai.");
                return;
            }

            if (activeSession?.status === "lobby") {
                setMessage("Gunakan tombol Exit Quiz untuk keluar dari lobby.");
                return;
            }

            if (activeSession?.status === "in_progress" || activeSession?.status === "completed") {
                setMessage(activeSession.status === "completed"
                    ? "Simpan hasil quiz terlebih dahulu sebelum kembali ke map."
                    : "Quiz sudah dibuka. Selesaikan quiz ini sebelum kembali ke map.");
                return;
            }

            onBack?.();
        };

        window.addEventListener("keydown", handleEscape);
        return () => window.removeEventListener("keydown", handleEscape);
    }, [activeSession, embedded, onBack, savingResult]);

    const requestCreateQuiz = () => {
        const nextGroupId = noVirtual ? entryCode.trim() : groupId;
        if (noVirtual && !isNoVirtualCode(nextGroupId)) {
            setMessage("Masukkan kode unik antara 101-150.");
            return;
        }
        if (!selectedTopicId) {
            setMessage("Pilih topic terlebih dahulu.");
            return;
        }
        setConfirmStartOpen(true);
    };

    const handleCreateQuiz = async () => {
        const nextGroupId = noVirtual ? entryCode.trim() : groupId;
        if (noVirtual && !isNoVirtualCode(nextGroupId)) {
            setMessage("Masukkan kode unik antara 101-150.");
            return;
        }
        if (!selectedTopicId) {
            setMessage("Pilih topic terlebih dahulu.");
            return;
        }

        setConfirmStartOpen(false);
        setBusy(true);
        setMessage("");
        const pendingActivityKey = `${ACTIVITY_STATUS.quiz.type}:pending:${nextGroupId}`;
        const statusResult = await reserveQuizStatus(pendingActivityKey, {
            object_id: objectId,
            group_id: nextGroupId,
            table_id: noVirtual ? nextGroupId : tableId,
        }, true);
        if (!statusResult.ok) {
            setBusy(false);
            return;
        }

        const data = await apiPost("/quiz/sessions", {
            table_id: noVirtual ? nextGroupId : tableId,
            group_id: nextGroupId,
            object_id: objectId,
            topic_id: selectedTopicId,
        });

        if (data.session) {
            if (noVirtual) setSelectedEntryGroupId(nextGroupId);
            setActiveSession(stampSession(data.session));
        } else if (data.active_session) {
            if (noVirtual) setSelectedEntryGroupId(nextGroupId);
            setActiveSession(stampSession(data.active_session));
            setMessage(getMessage(data, "Quiz aktif ditemukan. Silakan join."));
        } else {
            setMessage(getMessage(data, "Gagal membuat quiz."));
            if (currentUser) clearActivityStatus({user: currentUser, activityKey: pendingActivityKey});
            if (activityStatusKeyRef.current === pendingActivityKey) activityStatusKeyRef.current = null;
        }
        setBusy(false);
    };

    const joinQuiz = async (session, nextGroupId = groupId) => {
        if (!session?.quiz_session_id) return;

        setBusy(true);
        setMessage("");
        const activityKey = `${ACTIVITY_STATUS.quiz.type}:${session.quiz_session_id}`;
        const statusResult = await reserveQuizStatus(activityKey, {
            object_id: session.object_id || objectId,
            group_id: session.group_id || nextGroupId,
            table_id: session.table_id || nextGroupId,
        });
        if (!statusResult.ok) {
            setBusy(false);
            return;
        }

        const data = await apiPost(`/quiz/sessions/${session.quiz_session_id}/join`, {});
        if (data.session) {
            if (noVirtual) setSelectedEntryGroupId(nextGroupId);
            setActiveSession(stampSession(data.session));
        } else {
            setMessage(getMessage(data, "Gagal join quiz."));
            if (currentUser) clearActivityStatus({user: currentUser, activityKey});
            if (activityStatusKeyRef.current === activityKey) activityStatusKeyRef.current = null;
        }
        setBusy(false);
    };

    const handleJoinQuiz = async () => joinQuiz(activeSession);

    const handleJoinQuizByCode = async () => {
        const nextGroupId = entryCode.trim();
        if (!isNoVirtualCode(nextGroupId)) {
            setMessage("Masukkan kode unik antara 101-150.");
            return;
        }

        setBusy(true);
        setMessage("");
        const data = await apiGet(`/quiz/context?table_id=${encodeURIComponent(nextGroupId)}&group_id=${encodeURIComponent(nextGroupId)}`);
        setContext(data);
        if (!selectedTopicId && data.topics?.length > 0) {
            setSelectedTopicId(String(data.active_session?.topic_id || data.topics[0].topic_id));
        }

        if (!data.active_session) {
            setActiveSession(null);
            setMessage(`Tidak ada quiz aktif untuk group ${nextGroupId}.`);
            setBusy(false);
            return;
        }

        setBusy(false);
        await joinQuiz(data.active_session, nextGroupId);
    };

    const handleBeginQuiz = async () => {
        if (!activeSession?.quiz_session_id) return;

        setBusy(true);
        setMessage("");
        const data = await apiPost(`/quiz/sessions/${activeSession.quiz_session_id}/start`, {});
        if (data.session) {
            setActiveSession(stampSession(data.session));
        } else {
            setMessage(getMessage(data, "Quiz belum bisa dimulai."));
        }
        setBusy(false);
    };

    const handleExitQuiz = async (options = {}) => {
        if (!activeSession?.quiz_session_id) return false;
        if (activeSession.status !== "lobby") {
            setMessage("Quiz sudah dimulai. Selesaikan quiz terlebih dahulu.");
            return false;
        }

        setBusy(true);
        setMessage("");
        const activityKey = `${ACTIVITY_STATUS.quiz.type}:${activeSession.quiz_session_id}`;
        const data = await apiPost(`/quiz/sessions/${activeSession.quiz_session_id}/exit`, {});
        if (currentUser) clearActivityStatus({user: currentUser, activityKey});
        if (activityStatusKeyRef.current === activityKey) activityStatusKeyRef.current = null;

        if (data.session?.is_member) {
            setActiveSession(stampSession(data.session));
            setMessage(getMessage(data, "Berhasil keluar dari quiz."));
        } else {
            setActiveSession(null);
            setMessage(getMessage(data, "Quiz lobby ditutup."));
            if (options.closeAfterExit && embedded) {
                onBack?.();
            } else {
                loadContext(tableId, groupId, false);
            }
        }
        setBusy(false);
        return true;
    };

    const handleEmbeddedBack = async () => {
        if (exitOnBack && (savingResult || activeSession?.is_saving_result)) {
            setMessage("Hasil quiz sedang disimpan. Jangan refresh, tutup halaman, atau keluar sampai proses selesai.");
            return;
        }
        if (exitOnBack && activeSession?.status === "lobby") {
            const exited = await handleExitQuiz({closeAfterExit: true});
            if (!exited) return;
            return;
        }
        if (exitOnBack && ["in_progress", "completed"].includes(activeSession?.status)) {
            setMessage(activeSession?.status === "completed"
                ? "Simpan hasil quiz terlebih dahulu sebelum kembali ke map."
                : "Quiz sudah dibuka. Selesaikan quiz ini sebelum kembali ke map.");
            return;
        }
        onBack?.();
    };

    const handleAnswer = async (answerIndex) => {
        if (!activeSession?.quiz_session_id || activeSession.my_current_answer || quizCountdownSeconds > 0 || localTimeLeft <= 0) return;

        setBusy(true);
        setMessage("");
        const data = await apiPost(`/quiz/sessions/${activeSession.quiz_session_id}/answer`, {
            answer_index: answerIndex,
        });
        if (data.session) {
            setActiveSession(stampSession(data.session));
        } else {
            setMessage(getMessage(data, "Gagal mengirim jawaban."));
        }
        setBusy(false);
    };

    const handleSaveResult = useCallback(async () => {
        if (!activeSession?.quiz_session_id) return;

        setBusy(true);
        setSavingResult(true);
        setMessage("");
        try {
            const data = await apiPost(`/quiz/sessions/${activeSession.quiz_session_id}/save`, {});
            if (data.session) {
                setActiveSession(stampSession(data.session));
                setMessage(getMessage(data, "Hasil quiz tersimpan."));
                if (currentUser && data.session.status === "saved") {
                    clearActivityStatus({
                        user: currentUser,
                        activityKey: `${ACTIVITY_STATUS.quiz.type}:${activeSession.quiz_session_id}`,
                    });
                }
            } else {
                setMessage(getMessage(data, "Gagal menyimpan hasil quiz."));
            }
        } catch (error) {
            setMessage("Gagal menyimpan hasil quiz.");
        }
        setSavingResult(false);
        setBusy(false);
    }, [activeSession?.quiz_session_id, currentUser]);

    const handleRetryFeedback = async () => {
        if (!activeSession?.quiz_session_id || retryingFeedback || activeSession?.is_saving_result) return;
        setRetryingFeedback(true);
        setMessage("");
        try {
            const data = await apiPost(`/quiz/sessions/${activeSession.quiz_session_id}/retry-feedback`, {});
            if (data.session) {
                setActiveSession(stampSession(data.session));
                setMessage(getMessage(data, "Feedback AI berhasil dibuat ulang."));
            } else {
                setMessage(getMessage(data, "Gagal mencoba ulang AI feedback."));
            }
        } catch (error) {
            setMessage("Gagal mencoba ulang AI feedback.");
        }
        setRetryingFeedback(false);
    };

    useEffect(() => {
        if (
            activeSession?.status !== "completed"
            || !activeSession?.quiz_session_id
            || !activeSession?.is_member
            || activeSession?.is_saving_result
            || savingResult
        ) {
            return;
        }

        const autoSaveKey = `${activeSession.quiz_session_id}:${activeSession.updated_at || ""}`;
        if (autoSaveSessionRef.current === autoSaveKey) return;
        autoSaveSessionRef.current = autoSaveKey;
        const timerId = window.setTimeout(handleSaveResult, activeSession.is_host ? 0 : 8000);
        return () => window.clearTimeout(timerId);
    }, [activeSession?.status, activeSession?.quiz_session_id, activeSession?.is_member, activeSession?.is_host, activeSession?.is_saving_result, activeSession?.updated_at, savingResult, handleSaveResult]);

    if (loading) {
        return <main className={`quiz-app quiz-app--center${embedded ? " quiz-app--embedded" : ""}`}>Memuat quiz...</main>;
    }

    const showGamification = !!context?.gamification_enabled;
    const showStudentAvatars = !noVirtual;

    if (activeSession?.is_member) {
        const currentQuestion = activeSession.current_question;
        const myAnswer = activeSession.my_current_answer;
        const progressText = activeSession.status === "in_progress"
            ? `${activeSession.current_question_index + 1}/${activeSession.question_count}`
            : `${activeSession.question_count} questions`;

        return (
            <main className={`quiz-app quiz-workspace${embedded ? " quiz-app--embedded" : ""}`}>
                <aside className="quiz-members" aria-label="Quiz members">
                    <div className="quiz-members__heading">Group {activeSession.group_id || activeSession.table_id}</div>
                    {activeSession.members.map((member) => (
                        <div className="quiz-member" key={member.member_id}>
                            {showStudentAvatars && <AvatarIcon path={member.avatar_public_path} alt={member.name} />}
                            <span>{member.name}</span>
                            {member.is_host && <em>Host</em>}
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
                                    type="button"
                                    onClick={() => handleExitQuiz({closeAfterExit: true})}
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
                                    <div style={{width: quizCountdownSeconds > 0 ? "100%" : `${Math.max(0, Math.min(100, (localTimeLeft / activeSession.question_time_seconds) * 100))}%`}} />
                                </div>
                                <strong>{quizCountdownSeconds > 0 ? `Start ${quizCountdownSeconds}s` : revealTimeLeft !== null ? `Next ${revealTimeLeft}s` : `${localTimeLeft}s`}</strong>
                            </div>

                            {quizCountdownSeconds > 0 ? (
                                <div className="quiz-panel quiz-countdown" role="status" aria-live="polite">
                                    <span className="quiz-label">Get Ready</span>
                                    <strong>{quizCountdownSeconds}</strong>
                                    <p>Pertanyaan pertama akan dimulai bersama untuk semua peserta.</p>
                                </div>
                            ) : (
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
                            )}

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
                                    <div className="quiz-result-actions">
                                        <span className="quiz-auto-save">
                                            Menyimpan hasil quiz dan membuat AI feedback...
                                        </span>
                                    </div>
                                ) : (
                                    <div className="quiz-result-actions">
                                        <span className="quiz-saved">Saved</span>
                                        {embedded && (
                                            <button className="quiz-button quiz-button--primary" onClick={onBack} type="button">
                                                Close
                                            </button>
                                        )}
                                    </div>
                                )}
                                {activeSession.wrong_answer_feedback_error && (
                                    <div className="quiz-feedback-error">
                                        <div>
                                            <strong>Feedback AI gagal dibuat.</strong>
                                            <p>{activeSession.wrong_answer_feedback_error}</p>
                                        </div>
                                        {activeSession.status === "saved" && (
                                            <button
                                                className="quiz-button quiz-button--primary"
                                                type="button"
                                                onClick={handleRetryFeedback}
                                                disabled={retryingFeedback || activeSession.is_saving_result}
                                            >
                                                {retryingFeedback || activeSession.is_saving_result ? "Retrying..." : "Retry AI Feedback"}
                                            </button>
                                        )}
                                    </div>
                                )}
                            </div>

                            {(savingResult || activeSession.is_saving_result) && (
                                <div className="quiz-panel quiz-feedback-loading" role="status" aria-live="polite">
                                    <span className="quiz-spinner" aria-hidden="true" />
                                    <div>
                                        <h2>Getting AI Feedback</h2>
                                        <p>Please keep this window open while wrong-answer feedback is generated and the result is saved. Do not refresh or close this page.</p>
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
                                            <article className={`quiz-score-row ${showStudentAvatars ? "" : "quiz-score-row--no-avatar"}`} key={item.user_id}>
                                                <div className="quiz-rank">{index + 1}</div>
                                                {showStudentAvatars && <AvatarIcon path={item.avatar_public_path} alt={item.name} />}
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
        <main className={`quiz-app quiz-landing${embedded ? " quiz-app--embedded" : ""}`}>
            {embedded && (
                <button className="no-virtual-back" type="button" onClick={handleEmbeddedBack}>
                    Back
                </button>
            )}
            <section className="quiz-hero">
                <span className="quiz-label">{noVirtual ? "No Map Competition Quiz" : "Big Table Quiz"}</span>
                <h1>{context?.course?.course_name || "Course Quiz"}</h1>
                <p>
                    {noVirtual
                        ? "Enter a unique code from 101 to 150 to host or join a live competition quiz."
                        : showGamification
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
                            <p>A quiz is already active at this big table. New users can only join while a seat is available.</p>
                            <div className="quiz-member-strip">
                                {activeSession.members.map((member) => (
                                    <div className="quiz-strip-member" key={member.member_id}>
                                        {showStudentAvatars && <AvatarIcon path={member.avatar_public_path} alt={member.name} />}
                                        <span>{member.name}</span>
                                        {member.is_host && <em>Host</em>}
                                    </div>
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
                            {noVirtual ? (
                                <div className="no-virtual-code-actions">
                                    <button
                                        className="quiz-button quiz-button--primary"
                                        onClick={requestCreateQuiz}
                                        disabled={!canStart || busy || !isNoVirtualCode(entryCode)}
                                    >
                                        Host Quiz
                                    </button>
                                    <button
                                        className="quiz-button quiz-button--primary"
                                        onClick={handleJoinQuizByCode}
                                        disabled={busy || !isNoVirtualCode(entryCode)}
                                    >
                                        Join Quiz
                                    </button>
                                </div>
                            ) : (
                                <button
                                    className="quiz-button quiz-button--primary"
                                    onClick={requestCreateQuiz}
                                    disabled={!canStart || busy}
                                >
                                    Host Quiz
                                </button>
                            )}
                        </>
                    )}

                    {activeSession?.is_full && <p className="quiz-message">This quiz table is full.</p>}
                    {message && <p className="quiz-message">{message}</p>}
                </div>
            </section>

            {confirmStartOpen && (
                <div className="activity-exit-confirm" role="dialog" aria-modal="true" aria-labelledby="quiz-start-confirm-title">
                    <section className="activity-exit-confirm__panel">
                        <h2 id="quiz-start-confirm-title">Mulai host quiz?</h2>
                        <p>
                            Setelah lobby quiz dibuat, paket pertanyaan akan terkunci untuk meja ini.
                            Refresh atau menutup halaman tidak akan membuat percobaan quiz baru.
                        </p>
                        <div className="activity-exit-confirm__actions">
                            <button type="button" onClick={() => setConfirmStartOpen(false)}>
                                Batal
                            </button>
                            <button className="is-danger" type="button" onClick={handleCreateQuiz} disabled={busy}>
                                Host Quiz
                            </button>
                        </div>
                    </section>
                </div>
            )}
        </main>
    );
};

export default QuizActivityPage;
