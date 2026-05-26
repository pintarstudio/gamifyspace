import React, {useEffect, useMemo, useRef, useState} from "react";
import {useSearchParams} from "react-router-dom";
import {apiGet, apiPatch, apiPost} from "../api/apiClient";
import AvatarIcon from "../components/AvatarIcon";
import socket from "../utils/socketClient";
import {
    ACTIVITY_STATUS,
    activeActivityMessage,
    clearActivityStatus,
    setActivityStatus,
} from "../utils/activityStatus";
import useCopyProtection from "../utils/useCopyProtection";
import "./TableActivityPage.css";

const getMessage = (data, fallback) => data?.message || fallback;
function stampSession(session) {
    return session ? {...session, _received_at_ms: Date.now()} : null;
}

function getSessionNow(session, localNow) {
    if (!session?.server_time_ms || !session?._received_at_ms) return localNow;
    return Number(session.server_time_ms) + (localNow - Number(session._received_at_ms));
}

const formatSeconds = (value) => {
    const total = Math.max(0, Number(value || 0));
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
};

const getSessionTimer = (session, now) => {
    if (!session) return null;
    const sessionNow = getSessionNow(session, now);
    const duration = Math.max(0, Number(session.duration_seconds || 0));
    if (!session.is_active || session.is_submitted) {
        return {
            duration,
            secondsLeft: Math.max(0, Number(session.seconds_left || 0)),
            secondsSpent: Math.max(0, Number(session.seconds_spent || 0)),
            percentLeft: duration > 0 ? Math.max(0, Math.min(100, (Number(session.seconds_left || 0) / duration) * 100)) : 0,
        };
    }

    const expiresAt = session.timer_expires_at ? new Date(session.timer_expires_at).getTime() : null;
    const startedAt = session.work_started_at ? new Date(session.work_started_at).getTime() : null;
    if (startedAt && sessionNow < startedAt) {
        return {
            duration,
            secondsLeft: duration,
            secondsSpent: 0,
            percentLeft: 100,
        };
    }
    const secondsLeft = expiresAt
        ? Math.max(0, Math.ceil((expiresAt - sessionNow) / 1000))
        : Math.max(0, Number(session.seconds_left || 0));
    const secondsSpent = duration > 0 ? Math.max(0, duration - secondsLeft) : Math.max(0, Number(session.seconds_spent || 0));
    return {
        duration,
        secondsLeft,
        secondsSpent,
        percentLeft: duration > 0 ? Math.max(0, Math.min(100, (secondsLeft / duration) * 100)) : 0,
    };
};

const isNoVirtualCode = (value) => {
    const parsed = Number.parseInt(value, 10);
    return String(parsed) === String(value).trim() && parsed >= 101 && parsed <= 150;
};

const isTypingTarget = (target) =>
    target && (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable
    );

const TableActivityPage = ({embedded = false, noVirtual = false, onBack, activitySearchParams = null, exitOnBack = false}) => {
    const [routeSearchParams] = useSearchParams();
    const searchParams = useMemo(
        () => activitySearchParams ? new URLSearchParams(activitySearchParams) : routeSearchParams,
        [activitySearchParams, routeSearchParams]
    );
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
    const [retryingFeedback, setRetryingFeedback] = useState(false);
    const [message, setMessage] = useState("");
    const [currentUser, setCurrentUser] = useState(null);
    const [confirmExitOpen, setConfirmExitOpen] = useState(false);
    const [confirmSubmitOpen, setConfirmSubmitOpen] = useState(false);
    const [now, setNow] = useState(Date.now());
    const activityStatusKeyRef = useRef(null);
    const cancelExitButtonRef = useRef(null);
    const timeoutSubmittedRef = useRef(false);

    const selectedTopic = useMemo(
        () => context?.topics?.find((topic) => String(topic.topic_id) === String(selectedTopicId)),
        [context, selectedTopicId]
    );

    const sessionTimer = useMemo(() => getSessionTimer(activeSession, now), [activeSession, now]);
    const groupCountdownSeconds = useMemo(() => {
        if (!activeSession?.is_started || !activeSession?.work_started_at) return 0;
        const started = new Date(activeSession.work_started_at).getTime();
        const sessionNow = getSessionNow(activeSession, now);
        return Math.max(0, Math.ceil((started - sessionNow) / 1000));
    }, [activeSession, now]);
    const activeAnswers = useMemo(() => activeSession?.answers || [], [activeSession?.answers]);
    const answeredUserIds = useMemo(
        () => new Set(activeAnswers
            .filter((answer) => String(answer.answer_text || "").trim().length > 0)
            .map((answer) => String(answer.user_id))),
        [activeAnswers]
    );
    const allMembersAnswered = !!activeSession?.is_started
        && (activeSession?.members || []).length > 0
        && (activeSession?.members || []).every((member) => answeredUserIds.has(String(member.user_id)));
    const isGeneratingFeedback = submittingFeedback || activeSession?.is_generating_feedback;
    const isTimeUp = activeSession?.is_member && activeSession?.is_started && groupCountdownSeconds <= 0 && sessionTimer?.secondsLeft <= 0 && !activeSession?.is_submitted;
    const answersLocked = !activeSession?.is_started || groupCountdownSeconds > 0 || !!activeSession?.is_submitted || !!isGeneratingFeedback || !!isTimeUp;
    const combinedFeedback = activeSession?.combined_feedback;
    const feedbackGroups = activeSession?.feedback_groups || [];
    const gamification = activeSession?.gamification;
    const showGamification = !!gamification?.enabled;
    const showStudentAvatars = !noVirtual;

    useCopyProtection(
        !!activeSession?.is_member,
        setMessage,
        "Menyalin konten aktivitas group tidak diizinkan."
    );

    const loadContext = async (nextGroupId = groupId, useActiveSession = true) => {
        setLoading(true);
        const data = await apiGet(`/table/context?group_id=${nextGroupId}${objectId ? `&object_id=${objectId}` : ""}`);
        setContext(data);
        setActiveSession(useActiveSession ? stampSession(data.active_session || null) : null);
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
        timeoutSubmittedRef.current = false;
    }, [activeSession?.session_id]);

    useEffect(() => {
        if (!activeSession?.is_member || !activeSession?.is_started || activeSession?.is_submitted || !activeSession?.is_active) return undefined;
        setNow(Date.now());
        const timerId = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(timerId);
    }, [activeSession?.session_id, activeSession?.is_member, activeSession?.is_started, activeSession?.is_submitted, activeSession?.is_active]);

    useEffect(() => {
        apiGet("/session").then((data) => {
            if (data.loggedIn && data.user) setCurrentUser(data.user);
        });
    }, []);

    useEffect(() => {
        if (!currentUser) return undefined;

        const clearStatusOnPageHide = () => {
            if (activeSession?.is_started && !activeSession?.is_submitted) return;
            if (!activityStatusKeyRef.current) return;
            clearActivityStatus({
                user: currentUser,
                activityKey: activityStatusKeyRef.current,
                keepalive: true,
            });
        };

        window.addEventListener("pagehide", clearStatusOnPageHide);
        return () => window.removeEventListener("pagehide", clearStatusOnPageHide);
    }, [currentUser, activeSession?.is_started, activeSession?.is_submitted]);

    useEffect(() => {
        if (!activeSession?.session_id || !activeSession?.is_member) return undefined;

        const sessionId = activeSession.session_id;
        const activityKey = `${ACTIVITY_STATUS.group_discussion.type}:${sessionId}`;
        let disposed = false;

        const refreshGroupSession = async () => {
            const data = await apiGet(`/table/sessions/${sessionId}`);
            if (disposed) return;
            if (data.session) {
                setActiveSession(stampSession(data.session));
                if (data.session.is_submitted || !data.session.is_generating_feedback) {
                    setSubmittingFeedback(false);
                }
            } else {
                setMessage(getMessage(data, "Group session tidak tersedia."));
            }
        };

        const handleSessionEvent = (event = {}) => {
            if (String(event.session_id) !== String(sessionId)) return;
            if (event.status === "generating") setSubmittingFeedback(true);
            refreshGroupSession();
        };

        const handleLobbyCancelled = (event = {}) => {
            if (String(event.session_id) !== String(sessionId)) return;
            setActiveSession(null);
            setAnswerText("");
            setMessage("Waiting room ditutup karena host keluar sebelum aktivitas dimulai.");
            if (currentUser) clearActivityStatus({user: currentUser, activityKey});
            if (activityStatusKeyRef.current === activityKey) activityStatusKeyRef.current = null;
        };

        socket.emit("group:join", {session_id: sessionId});
        socket.on("group:lobby_updated", handleSessionEvent);
        socket.on("group:starting", handleSessionEvent);
        socket.on("group:answer_updated", handleSessionEvent);
        socket.on("group:feedback_generating", handleSessionEvent);
        socket.on("group:feedback_ready", handleSessionEvent);
        socket.on("group:session_updated", handleSessionEvent);
        socket.on("group:lobby_cancelled", handleLobbyCancelled);

        return () => {
            disposed = true;
            socket.emit("group:leave", {session_id: sessionId});
            socket.off("group:lobby_updated", handleSessionEvent);
            socket.off("group:starting", handleSessionEvent);
            socket.off("group:answer_updated", handleSessionEvent);
            socket.off("group:feedback_generating", handleSessionEvent);
            socket.off("group:feedback_ready", handleSessionEvent);
            socket.off("group:session_updated", handleSessionEvent);
            socket.off("group:lobby_cancelled", handleLobbyCancelled);
        };
    }, [activeSession?.session_id, activeSession?.is_member, currentUser]);

    useEffect(() => {
        if (!activeSession?.session_id || !activeSession?.is_member) return undefined;

        const intervalId = window.setInterval(() => {
            apiPost(`/table/sessions/${activeSession.session_id}/heartbeat`, {}).then((data) => {
                if (data.session) {
                    setActiveSession(stampSession(data.session));
                    if (data.session.is_submitted || !data.session.is_generating_feedback) {
                        setSubmittingFeedback(false);
                    }
                } else {
                    setMessage(getMessage(data, "Group session tidak tersedia."));
                    setActiveSession(null);
                }
            });
        }, isGeneratingFeedback ? 3000 : 10000);

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
            if (confirmSubmitOpen) {
                setConfirmSubmitOpen(false);
                return;
            }

            if (!activeSession?.is_member) {
                onBack?.();
                return;
            }

            if (isGeneratingFeedback) {
                setMessage("Feedback sedang dibuat. Jangan refresh, tutup halaman, atau keluar dari group sampai proses selesai.");
                return;
            }

            if (activeSession?.is_started && !activeSession?.is_submitted) {
                setMessage("Group discussion sudah dimulai. Selesaikan aktivitas ini sebelum kembali ke map.");
                return;
            }

            setConfirmExitOpen(true);
        };

        window.addEventListener("keydown", handleEscape);
        return () => window.removeEventListener("keydown", handleEscape);
    }, [activeSession?.is_member, activeSession?.is_started, activeSession?.is_submitted, confirmExitOpen, confirmSubmitOpen, embedded, isGeneratingFeedback, onBack]);

    useEffect(() => {
        if (!currentUser || !activeSession?.session_id || !activeSession?.is_member || activeSession?.is_submitted) return undefined;

        const status = ACTIVITY_STATUS.group_discussion;
        const activityKey = `${status.type}:${activeSession.session_id}`;
        const metadata = {
            object_id: objectId || activeSession.object_id,
            group_id: activeSession.group_id,
        };
        const refreshStatus = () => {
            activityStatusKeyRef.current = activityKey;
            setActivityStatus({user: currentUser, status, activityKey, metadata});
        };

        refreshStatus();
        const intervalId = window.setInterval(refreshStatus, 120000);

        return () => {
            window.clearInterval(intervalId);
            if (!activeSession?.is_started || activeSession?.is_submitted) {
                clearActivityStatus({user: currentUser, activityKey, keepalive: true});
            }
            if (activityStatusKeyRef.current === activityKey) activityStatusKeyRef.current = null;
        };
    }, [currentUser, activeSession?.session_id, activeSession?.is_member, activeSession?.is_started, activeSession?.is_submitted, activeSession?.object_id, activeSession?.group_id, objectId]);

    const reserveGroupActivityStatus = async (activityKey, metadata, isPending = false) => {
        if (!currentUser) return {ok: true};
        const result = await setActivityStatus({
            user: currentUser,
            status: ACTIVITY_STATUS.group_discussion,
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
        const pendingActivityKey = `${ACTIVITY_STATUS.group_discussion.type}:pending:${nextGroupId}`;
        const statusResult = await reserveGroupActivityStatus(pendingActivityKey, {
            object_id: objectId,
            group_id: nextGroupId,
        }, true);
        if (!statusResult.ok) {
            setBusy(false);
            return;
        }

        const data = await apiPost("/table/sessions", {
            group_id: nextGroupId,
            object_id: objectId,
            topic_id: selectedTopicId,
        });

        if (data.session) {
            if (noVirtual) setSelectedEntryGroupId(nextGroupId);
            setActiveSession(stampSession(data.session));
            setAnswerText(data.session.my_answer?.answer_text || "");
        } else if (data.active_session) {
            if (noVirtual) setSelectedEntryGroupId(nextGroupId);
            setActiveSession(stampSession(data.active_session));
            setAnswerText(data.active_session.my_answer?.answer_text || "");
            setMessage(getMessage(data, "Session aktif ditemukan. Silakan join."));
        } else {
            setMessage(getMessage(data, "Gagal membuat group session."));
            if (currentUser) clearActivityStatus({user: currentUser, activityKey: pendingActivityKey});
            if (activityStatusKeyRef.current === pendingActivityKey) activityStatusKeyRef.current = null;
        }
        setBusy(false);
    };

    const joinSession = async (session, nextGroupId = groupId) => {
        if (!session?.session_id) return;

        setBusy(true);
        setMessage("");
        const statusResult = await reserveGroupActivityStatus(`${ACTIVITY_STATUS.group_discussion.type}:${session.session_id}`, {
            object_id: objectId || session.object_id,
            group_id: session.group_id || nextGroupId,
        });
        if (!statusResult.ok) {
            setBusy(false);
            return;
        }

        const data = await apiPost(`/table/sessions/${session.session_id}/join`, {
            object_id: objectId || null,
        });
        if (data.session) {
            if (noVirtual) setSelectedEntryGroupId(nextGroupId);
            setActiveSession(stampSession(data.session));
            setAnswerText(data.session.my_answer?.answer_text || "");
        } else {
            setMessage(getMessage(data, "Gagal join group."));
            if (currentUser) clearActivityStatus({user: currentUser, activityKey: `${ACTIVITY_STATUS.group_discussion.type}:${session.session_id}`});
            if (activityStatusKeyRef.current === `${ACTIVITY_STATUS.group_discussion.type}:${session.session_id}`) activityStatusKeyRef.current = null;
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

    const handleExitGroup = async (options = {}) => {
        if (!activeSession?.session_id) return false;
        if (activeSession?.is_started && !activeSession?.is_submitted) {
            setMessage("Group discussion sudah dimulai dan tidak bisa ditinggalkan. Selesaikan aktivitas ini bersama group.");
            return false;
        }
        if (isGeneratingFeedback) {
            setMessage("Feedback sedang dibuat. Mohon tunggu sebelum keluar dari group.");
            return false;
        }

        setBusy(true);
        setMessage("");
        const data = await apiPost(`/table/sessions/${activeSession.session_id}/exit`, {});
        if (currentUser) clearActivityStatus({user: currentUser, activityKey: `${ACTIVITY_STATUS.group_discussion.type}:${activeSession.session_id}`});
        activityStatusKeyRef.current = null;
        setAnswerText("");
        if (data.session?.is_active && data.session?.is_member) {
            setActiveSession(stampSession(data.session));
            setMessage(getMessage(data, "Berhasil keluar dari group."));
        } else {
            setActiveSession(null);
            setMessage(getMessage(data, "Group session selesai."));
            if (options.closeAfterExit && embedded) {
                onBack?.();
            } else {
                loadContext();
            }
        }
        setBusy(false);
        return true;
    };

    const handleEmbeddedBack = async () => {
        if (exitOnBack && activeSession?.is_member && activeSession?.is_started && !activeSession?.is_submitted) {
            setMessage("Group discussion sudah dimulai. Selesaikan aktivitas ini sebelum kembali ke map.");
            return;
        }
        if (exitOnBack && activeSession?.is_member) {
            const exited = await handleExitGroup();
            if (!exited) return;
        }
        onBack?.();
    };

    const handleBeginGroupWork = async () => {
        if (!activeSession?.session_id) return;

        setBusy(true);
        setMessage("");
        const data = await apiPost(`/table/sessions/${activeSession.session_id}/start`, {});
        if (data.session) {
            setActiveSession(stampSession(data.session));
            setAnswerText(data.session.my_answer?.answer_text || "");
            setMessage(getMessage(data, "Group discussion dimulai."));
        } else {
            setMessage(getMessage(data, "Gagal mulai group discussion."));
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
            setActiveSession(stampSession(data.session));
            setMessage("Jawaban tersimpan.");
        } else {
            setMessage(getMessage(data, "Gagal menyimpan jawaban."));
        }
        setBusy(false);
    };

    const handleSubmitAllAnswers = async () => {
        if (!activeSession?.session_id) return;
        setConfirmSubmitOpen(false);

        setBusy(true);
        setSubmittingFeedback(true);
        setMessage("");
        const data = await apiPost(`/table/sessions/${activeSession.session_id}/submit`, {});

        if (data.session) {
            setActiveSession(stampSession(data.session));
            setMessage(getMessage(data, "Semua jawaban berhasil disubmit."));
        } else {
            setMessage(getMessage(data, "Gagal submit semua jawaban."));
        }
        setSubmittingFeedback(false);
        setBusy(false);
    };

    const handleRetryFeedback = async () => {
        if (!activeSession?.session_id || retryingFeedback) return;
        setRetryingFeedback(true);
        setSubmittingFeedback(true);
        setMessage("");
        try {
            const data = await apiPost(`/table/sessions/${activeSession.session_id}/retry-feedback`, {});
            if (data.session) {
                setActiveSession(stampSession(data.session));
                setMessage(getMessage(data, "Feedback AI berhasil dibuat ulang."));
            } else {
                setMessage(getMessage(data, "Gagal mencoba ulang feedback AI."));
            }
        } catch (error) {
            setMessage("Gagal mencoba ulang feedback AI.");
        }
        setSubmittingFeedback(false);
        setRetryingFeedback(false);
    };

    async function handleSessionTimeout() {
        if (!activeSession?.session_id || activeSession.is_submitted || !activeSession.is_active) return;

        setBusy(true);
        setSubmittingFeedback(true);
        setMessage("");
        const data = await apiPost(`/table/sessions/${activeSession.session_id}/timeout`, {
            answer_text: answerText,
        });

        if (data.session) {
            setActiveSession(stampSession(data.session));
            setAnswerText(data.session.my_answer?.answer_text || answerText);
            setMessage(getMessage(data, "Waktu group discussion sudah habis."));
        } else {
            setMessage(getMessage(data, "Gagal menyelesaikan group yang waktunya habis."));
        }
        setSubmittingFeedback(false);
        setBusy(false);
    }

    useEffect(() => {
        if (!activeSession?.is_member || !activeSession?.is_started || activeSession?.is_submitted || !activeSession?.is_active) return;
        if (groupCountdownSeconds > 0) return;
        if (!sessionTimer || sessionTimer.secondsLeft > 0) return;
        if (busy || isGeneratingFeedback) return;
        if (timeoutSubmittedRef.current) return;
        timeoutSubmittedRef.current = true;
        handleSessionTimeout();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeSession?.session_id, activeSession?.is_member, activeSession?.is_started, activeSession?.is_submitted, activeSession?.is_active, groupCountdownSeconds, sessionTimer?.secondsLeft, busy, isGeneratingFeedback]);

    const blockClipboard = (event) => {
        event.preventDefault();
        setMessage("Copy, cut, paste, dan drop teks tidak diizinkan di jawaban case study.");
    };

    if (loading) {
        return <main className={`table-app table-app--center${embedded ? " table-app--embedded" : ""}`}>Memuat aktivitas meja...</main>;
    }

    if (activeSession?.is_member) {
        if (!activeSession.is_started) {
            return (
                <main className={`table-app table-workspace${embedded ? " table-app--embedded" : ""}`}>
                    <aside className="table-members" aria-label="Group members">
                        <div className="table-members__heading">Group {activeSession.group_id}</div>
                        {activeSession.members.map((member) => (
                            <div className="table-member" key={member.member_id}>
                                {showStudentAvatars && <AvatarIcon path={member.avatar_public_path} alt={member.name} />}
                                <span>{member.name}</span>
                                {member.is_host && <em>Host</em>}
                            </div>
                        ))}
                    </aside>

                    <section className="table-case">
                        <div className="table-case__header">
                            <div>
                                <span className="table-label">{context?.course?.course_name}</span>
                                <h1>Waiting Room</h1>
                            </div>
                            <div className="table-case__actions">
                                <span className="table-count">{activeSession.member_count}/{activeSession.max_members}</span>
                                <button className="table-button table-button--danger" onClick={handleExitGroup} disabled={busy}>
                                    Exit Group
                                </button>
                            </div>
                        </div>

                        <div className="table-panel table-waiting-room">
                            <div className="table-section-title">
                                <h2>Menunggu Anggota Group</h2>
                                <span>{activeSession.member_count}/{activeSession.max_members} joined</span>
                            </div>
                            <p>
                                Case study dan timer akan muncul setelah host memulai group discussion.
                                Minimal 2 student harus bergabung sebelum aktivitas bisa dimulai.
                            </p>
                            <div className="member-strip member-strip--large">
                                {activeSession.members.map((member) => (
                                    <div className="table-waiting-member" key={member.member_id}>
                                        {showStudentAvatars && <AvatarIcon path={member.avatar_public_path} alt={member.name} />}
                                        <span>{member.name}</span>
                                        {member.is_host && <em>Host</em>}
                                    </div>
                                ))}
                            </div>
                            {activeSession.is_starter ? (
                                <button
                                    className="table-button table-button--submit"
                                    type="button"
                                    onClick={handleBeginGroupWork}
                                    disabled={busy || !activeSession.can_start_work}
                                >
                                    {activeSession.can_start_work ? "Start Group Discussion" : "Menunggu minimal 2 student"}
                                </button>
                            ) : (
                                <p className="table-submit-note">Tunggu host memulai group discussion.</p>
                            )}
                        </div>

                        {message && <p className="table-message">{message}</p>}
                    </section>

                    {confirmExitOpen && (
                        <div className="activity-exit-confirm" role="dialog" aria-modal="true" aria-labelledby="table-waiting-exit-confirm-title">
                            <section className="activity-exit-confirm__panel">
                                <h2 id="table-waiting-exit-confirm-title">Keluar dari waiting room?</h2>
                                <p>Kamu bisa keluar selama group discussion belum dimulai.</p>
                                <div className="activity-exit-confirm__actions">
                                    <button ref={cancelExitButtonRef} type="button" onClick={() => setConfirmExitOpen(false)}>
                                        Tetap di Sini
                                    </button>
                                    <button className="is-danger" type="button" onClick={() => {
                                        setConfirmExitOpen(false);
                                        handleExitGroup();
                                    }}>
                                        Ya, Keluar
                                    </button>
                                </div>
                            </section>
                        </div>
                    )}
                </main>
            );
        }

        return (
            <main className={`table-app table-workspace${embedded ? " table-app--embedded" : ""}`}>
                <aside className="table-members" aria-label="Group members">
                    <div className="table-members__heading">Group {activeSession.group_id}</div>
                    {activeSession.members.map((member) => (
                        <div className="table-member" key={member.member_id}>
                            {showStudentAvatars && <AvatarIcon path={member.avatar_public_path} alt={member.name} />}
                            <span>{member.name}</span>
                            {member.is_host && <em>Host</em>}
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
                            <div className={`table-timer${isTimeUp ? " is-danger" : ""}`} aria-label={`Time left ${sessionTimer?.secondsLeft || 0} seconds`}>
                                <span>{groupCountdownSeconds > 0 ? `Start ${groupCountdownSeconds}s` : formatSeconds(sessionTimer?.secondsLeft)}</span>
                                <div>
                                    <i style={{width: `${sessionTimer?.percentLeft || 0}%`}} />
                                </div>
                            </div>
                            <span className="table-count">{activeSession.member_count}/{activeSession.max_members}</span>
                            {activeSession.is_submitted && (
                                <button
                                    className="table-button table-button--danger"
                                    type="button"
                                    onClick={() => handleExitGroup({closeAfterExit: true})}
                                    disabled={busy}
                                >
                                    Exit Activity
                                </button>
                            )}
                        </div>
                    </div>

                    {isGeneratingFeedback && (
                        <div className="table-panel table-feedback-loading" role="status" aria-live="polite">
                            <span className="table-spinner" aria-hidden="true" />
                            <div>
                                <h2>Getting Feedback</h2>
                                <p>The system is analyzing the case and all submitted answers. Do not refresh or close this page. Students cannot exit the group during this process.</p>
                            </div>
                        </div>
                    )}

                    {groupCountdownSeconds > 0 && !activeSession.is_submitted && !isGeneratingFeedback && (
                        <div className="table-panel table-start-countdown" role="status" aria-live="polite">
                            <span className="table-label">Get Ready</span>
                            <strong>{groupCountdownSeconds}</strong>
                            <p>Diskusi case study akan dimulai bersama untuk semua anggota group.</p>
                        </div>
                    )}

                    {activeSession.is_submitted && (
                        <div className="table-panel table-time-summary">
                            <strong>Time used</strong>
                            <span>{formatSeconds(sessionTimer?.secondsSpent)} used · {formatSeconds(sessionTimer?.secondsLeft)} left</span>
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
                                    <article className={`leaderboard-row ${showStudentAvatars ? "" : "leaderboard-row--no-avatar"}`} key={item.user_id}>
                                        <div className="leaderboard-rank">{index + 1}</div>
                                        {showStudentAvatars && <AvatarIcon path={item.avatar_public_path} alt={item.name} />}
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

                    {groupCountdownSeconds <= 0 && (
                        <>
                            <div className="table-panel">
                                <h2>Case Study</h2>
                                <p>{activeSession.case_prompt}</p>
                            </div>

                            <div className="table-panel table-answer">
                                <h2>My Answer</h2>
                                <textarea
                                    value={answerText}
                                    onChange={(event) => setAnswerText(event.target.value)}
                                    onContextMenu={blockClipboard}
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
                        </>
                    )}

                    <div className="table-panel table-answer-list">
                        <div className="table-section-title">
                            <h2>Saved Answers</h2>
                            <span>{activeAnswers.length} visible</span>
                        </div>

                        <div className="table-member-status-list">
                            {activeSession.members.map((member) => {
                                const answered = answeredUserIds.has(String(member.user_id));
                                return (
                                    <div
                                        className={`table-member-status ${showStudentAvatars ? "" : "table-member-status--no-avatar"}`}
                                        key={member.member_id}
                                    >
                                        {showStudentAvatars && <AvatarIcon path={member.avatar_public_path} alt={member.name} />}
                                        <strong>{member.name}</strong>
                                        <span className={answered ? "is-ready" : ""}>
                                            {answered ? "Jawaban tersimpan" : "Sedang mengerjakan"}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>

                        {activeSession.can_submit && allMembersAnswered && (
                            <button
                                className="table-button table-button--submit"
                                onClick={() => setConfirmSubmitOpen(true)}
                                disabled={busy || isGeneratingFeedback || activeAnswers.length === 0}
                            >
                                {isGeneratingFeedback ? "Getting Feedback..." : "Submit All Answers"}
                            </button>
                        )}
                        {activeSession.can_submit && !allMembersAnswered && (
                            <p className="table-submit-note">Submit button will appear after every group member saves an answer.</p>
                        )}

                        {activeSession.is_starter && activeSession.is_submitted && (
                            <p className="table-submit-note">Submitted. Answers are locked for every student.</p>
                        )}

                        {activeAnswers.length > 0 ? (
                            <div className="answer-list">
                                {activeAnswers.map((answer) => (
                                    <article className="answer-card" key={answer.answer_id}>
                                        <div className="answer-card__author">
                                            {showStudentAvatars && <AvatarIcon path={answer.avatar_public_path} alt={answer.name} />}
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
                                            <strong>What Went Well</strong>
                                            <p>{combinedFeedback.www}</p>
                                        </article>
                                        <article>
                                            <strong>Even Better If</strong>
                                            <p>{combinedFeedback.ebi}</p>
                                        </article>
                                    </div>
                                </div>
                            ) : activeSession.feedback_status === "error" ? (
                                <div className="feedback-retry-block">
                                    <div>
                                        <strong>Feedback AI gagal dibuat.</strong>
                                        <p>{activeSession.feedback_error || "Silakan coba ulang."}</p>
                                    </div>
                                    <button
                                        className="table-button table-button--primary"
                                        type="button"
                                        onClick={handleRetryFeedback}
                                        disabled={retryingFeedback || isGeneratingFeedback}
                                    >
                                        {retryingFeedback || isGeneratingFeedback ? "Retrying..." : "Retry AI Feedback"}
                                    </button>
                                </div>
                            ) : (
                                <p>{activeSession.feedback_text || "Feedback AI belum tersedia."}</p>
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
                                                        <strong>What Went Well</strong>
                                                        <p>{group.www}</p>
                                                    </article>
                                                    <article>
                                                        <strong>Even Better If</strong>
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
                    {confirmExitOpen && (
                        <div className="activity-exit-confirm" role="dialog" aria-modal="true" aria-labelledby="table-exit-confirm-title">
                            <section className="activity-exit-confirm__panel">
                                <h2 id="table-exit-confirm-title">Keluar dari aktivitas group?</h2>
                                <p>Sesi group ini akan ditutup untuk akun kamu. Jawaban yang belum disimpan tidak akan ikut terkirim.</p>
                                <div className="activity-exit-confirm__actions">
                                    <button ref={cancelExitButtonRef} type="button" onClick={() => setConfirmExitOpen(false)}>
                                        Tetap di Sini
                                    </button>
                                    <button className="is-danger" type="button" onClick={() => {
                                        setConfirmExitOpen(false);
                                        handleExitGroup();
                                    }}>
                                        Ya, Keluar
                                    </button>
                                </div>
                            </section>
                        </div>
                    )}
                    {confirmSubmitOpen && (
                        <div className="activity-exit-confirm" role="dialog" aria-modal="true" aria-labelledby="table-submit-confirm-title">
                            <section className="activity-exit-confirm__panel">
                                <h2 id="table-submit-confirm-title">Submit semua jawaban?</h2>
                                <p>
                                    Setelah disubmit, semua jawaban akan dikunci dan AI feedback akan dibuat untuk group ini.
                                </p>
                                <div className="activity-exit-confirm__actions">
                                    <button type="button" onClick={() => setConfirmSubmitOpen(false)}>
                                        Batal
                                    </button>
                                    <button className="is-danger" type="button" onClick={handleSubmitAllAnswers} disabled={busy}>
                                        Ya, Submit
                                    </button>
                                </div>
                            </section>
                        </div>
                    )}
                </section>
            </main>
        );
    }

    const hasActiveSession = !!activeSession;
    const groupFull = activeSession?.is_full;
    const canStart = !hasActiveSession && !!selectedTopicId;
    const canJoin = hasActiveSession && !groupFull && !activeSession?.is_started && !activeSession?.is_time_up;

    return (
        <main className={`table-app table-landing${embedded ? " table-app--embedded" : ""}`}>
            {embedded && (
                <button className="no-virtual-back" type="button" onClick={handleEmbeddedBack}>
                    Back
                </button>
            )}
            <section className="table-landing__hero">
                <span className="table-label">{noVirtual ? "No Map Group Activity" : "Table Group Activity"}</span>
                <h1>{context?.course?.course_name || "Course Activity"}</h1>
                <p>
                    {noVirtual
                        ? "Masukkan kode unik 101-150 untuk menjadi host atau bergabung ke group case study."
                        : `Group ${groupId} dapat bekerja bersama dalam satu sesi case study aktif dengan maksimal empat student.`}
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
                                {activeSession?.is_started
                                    ? "Group discussion sudah dimulai. Student baru tidak bisa join sesi ini."
                                    : activeSession?.is_time_up
                                    ? "This session time has ended. Wait for the group result or start again after it closes."
                                    : "A session is already active. Join is available until the group reaches four students."}
                            </p>
                            <div className="member-strip">
                                {activeSession.members.map((member) => (
                                    showStudentAvatars
                                        ? <AvatarIcon key={member.member_id} path={member.avatar_public_path} alt={member.name} />
                                        : <span key={member.member_id}>{member.name}</span>
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
