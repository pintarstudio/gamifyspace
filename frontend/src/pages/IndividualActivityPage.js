import React, {useEffect, useMemo, useRef, useState} from "react";
import {useSearchParams} from "react-router-dom";
import {apiGet, apiPatch, apiPost} from "../api/apiClient";
import {
    activeActivityMessage,
    activityStatusForIndividual,
    clearActivityStatus,
    setActivityStatus,
} from "../utils/activityStatus";
import {clearActivityRecovery, saveActivityRecovery} from "../utils/activityRecovery";
import useCopyProtection from "../utils/useCopyProtection";
import "./IndividualActivityPage.css";

const choiceLabel = (index) => ["A", "B", "C", "D"][index] || String(index + 1);
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
    if (session.status !== "in_progress") {
        return {
            duration,
            secondsLeft: Math.max(0, Number(session.seconds_left || 0)),
            secondsSpent: Math.max(0, Number(session.seconds_spent || 0)),
            percentLeft: duration > 0 ? Math.max(0, Math.min(100, (Number(session.seconds_left || 0) / duration) * 100)) : 0,
        };
    }

    const expiresAt = session.timer_expires_at ? new Date(session.timer_expires_at).getTime() : null;
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

function getStartConfirmation(activityType, questionKind, context) {
    const title = activityTitle(activityType, questionKind);
    if (activityType === "pre_test" || activityType === "post_test") {
        return {
            title: `Konfirmasi ${title}`,
            intro: `${title} ini hanya bisa dikerjakan satu kali untuk setiap topik. Pastikan kamu siap sebelum memulai.`,
            facts: [
                {badge: String(context?.assessment_question_count || 20), title: "Jumlah soal", text: `${context?.assessment_question_count || 20} soal pilihan ganda.`},
                {badge: "15s", title: "Waktu per soal", text: "Setiap soal harus dijawab dalam 15 detik."},
                {badge: "1x", title: "Kesempatan", text: `${title} hanya dapat dikerjakan satu kali.`},
            ],
            note: "Jangan refresh atau menutup halaman saat aktivitas berjalan agar percobaan dan hasil tersimpan dengan baik.",
        };
    }

    if (questionKind === "case_study") {
        return {
            title: "Konfirmasi Studi Kasus Individual",
            intro: "Studi kasus individual akan terkunci setelah dimulai. Bacalah kasus dengan teliti sebelum mengirim jawaban.",
            facts: [
                {badge: "1", title: "Jumlah kasus", text: "1 studi kasus untuk diselesaikan."},
                {badge: "4m", title: "Waktu pengerjaan", text: "Kamu memiliki waktu 4 menit untuk menjawab."},
                {badge: "AI", title: "AI Feedback", text: "AI akan memberi What Went Well dan Even Better If berdasarkan kualitas jawaban."},
            ],
            note: "Jangan refresh atau menutup halaman saat feedback AI sedang dibuat agar hasilnya tersimpan dengan baik.",
        };
    }

    return {
        title: "Konfirmasi Latihan Individual",
        intro: "Latihan pilihan ganda akan terkunci setelah dimulai. Jawab setiap soal sebelum waktunya habis.",
        facts: [
            {badge: String(context?.mc_question_count || 10), title: "Jumlah soal", text: `${context?.mc_question_count || 10} soal pilihan ganda.`},
            {badge: "15s", title: "Waktu per soal", text: "Setiap soal harus dijawab dalam 15 detik."},
            {badge: "AI", title: "AI Feedback", text: "Feedback AI akan dibuat untuk membantu memahami jawaban yang salah."},
        ],
        note: "Setelah selesai, feedback AI untuk jawaban yang salah akan dibuat dan disimpan otomatis.",
    };
}

function assessmentCompletionKey(type) {
    if (type === "pre_test") return "pre_test_completed";
    if (type === "post_test") return "post_test_completed";
    return null;
}

function isAssessmentCompleted(topic, type) {
    const key = assessmentCompletionKey(type);
    return key ? topic?.[key] === true : false;
}

function getAssessmentAccess(topic, type) {
    if (type === "pre_test") return topic?.pre_test_access || null;
    if (type === "post_test") return topic?.post_test_access || null;
    return null;
}

function isAssessmentOpen(topic, type) {
    if (!["pre_test", "post_test"].includes(type)) return true;
    return getAssessmentAccess(topic, type)?.is_open === true;
}

function hasAssessmentSchedule(topic, type) {
    const access = getAssessmentAccess(topic, type);
    return !!(access?.start_at && access?.end_at);
}

function assessmentStatusText(topic, type) {
    const label = activityTitle(type, "multiple_choice");
    if (isAssessmentCompleted(topic, type)) return `${label} sudah dikerjakan`;
    const access = getAssessmentAccess(topic, type);
    if (access?.is_open) return `${label} sedang dibuka`;
    if (access?.message) return access.message;
    return `${label} belum tersedia. Silakan tunggu informasi dari instructor.`;
}

function assessmentStatusKind(topic, type) {
    if (isAssessmentCompleted(topic, type)) return "done";
    const access = getAssessmentAccess(topic, type);
    if (access?.is_open) return "open";
    return access?.status || "unavailable";
}

function assessmentShortStatus(topic, type) {
    if (isAssessmentCompleted(topic, type)) return "Selesai";
    const access = getAssessmentAccess(topic, type);
    if (access?.is_open) return "Dibuka";
    if (access?.status === "not_started") return "Belum mulai";
    if (access?.status === "closed") return "Ditutup";
    return "Belum dijadwalkan";
}

function isTopicSelectable(topic) {
    return !!topic && topic.is_active !== false;
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
    const restoreSessionId = searchParams.get("session_id");
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
    const [retryingFeedback, setRetryingFeedback] = useState(false);
    const [currentUser, setCurrentUser] = useState(null);
    const [confirmStartOpen, setConfirmStartOpen] = useState(false);
    const [now, setNow] = useState(Date.now());
    const [answerReveal, setAnswerReveal] = useState(null);
    const activityStatusKeyRef = useRef(null);
    const timeoutSubmittedRef = useRef(false);
    const pageUnloadingRef = useRef(false);
    const answerRevealTimerRef = useRef(null);

    const selectedTopic = useMemo(
        () => context?.topics?.find((topic) => String(topic.topic_id) === String(selectedTopicId)),
        [context, selectedTopicId]
    );
    const showGamification = !!context?.gamification_enabled;
    const sessionTimer = useMemo(() => getSessionTimer(activeSession, now), [activeSession, now]);
    const startConfirmation = useMemo(
        () => getStartConfirmation(activityType, questionKind, context),
        [activityType, questionKind, context]
    );

    const availableActivityTypes = useMemo(() => {
        const types = ["exercise"];
        if (selectedTopic && (hasAssessmentSchedule(selectedTopic, "pre_test") || selectedTopic.pre_test_completed)) types.push("pre_test");
        if (selectedTopic && (hasAssessmentSchedule(selectedTopic, "post_test") || selectedTopic.post_test_completed)) types.push("post_test");
        return types;
    }, [selectedTopic]);

    const loadContext = async () => {
        setLoading(true);
        const query = new URLSearchParams({object_id: objectId});
        if (showAdminControls) query.set("admin", "1");
        const data = await apiGet(`/individual/context?${query.toString()}`);
        let nextActiveSession = data.active_session || null;
        if (restoreSessionId && String(nextActiveSession?.session_id || "") !== String(restoreSessionId)) {
            try {
                const restored = await apiGet(`/individual/sessions/${restoreSessionId}`);
                if (restored.session) {
                    nextActiveSession = restored.session;
                    if (restored.session.status === "completed") {
                        setMessage("Aktivitas sebelumnya sudah selesai. Hasilnya ditampilkan kembali di sini.");
                    } else if (restored.session.is_generating_feedback) {
                        setMessage("Aktivitasmu sudah terkirim. AI feedback sedang dibuat, mohon tunggu.");
                    }
                }
            } catch (error) {
                setMessage("Aktivitas sebelumnya tidak bisa dipulihkan otomatis. Cek riwayat aktivitas untuk melihat hasil yang sudah tersimpan.");
            }
        }
        setContext(data);
        setActiveSession(stampSession(nextActiveSession));
        const selectedTopicInList = data.topics?.find((topic) => String(topic.topic_id) === String(selectedTopicId));
        if ((!selectedTopicId || !isTopicSelectable(selectedTopicInList)) && data.topics?.length > 0) {
            const selectableTopic = data.topics.find(isTopicSelectable);
            setSelectedTopicId(String(nextActiveSession?.topic_id || selectableTopic?.topic_id || ""));
        }
        if (nextActiveSession) {
            setActivityType(nextActiveSession.activity_type);
            setQuestionKind(nextActiveSession.question_kind);
            setCaseAnswer(nextActiveSession.answers?.[0]?.answer_text || "");
        }
        setLoading(false);
    };

    useEffect(() => {
        loadContext();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [objectId]);

    useEffect(() => {
        timeoutSubmittedRef.current = false;
        setAnswerReveal(null);
    }, [activeSession?.session_id, activeSession?.current_question_index]);

    useEffect(() => () => {
        if (answerRevealTimerRef.current) window.clearTimeout(answerRevealTimerRef.current);
    }, []);

    useEffect(() => {
        if (activeSession?.status !== "in_progress") return undefined;
        setNow(Date.now());
        const timerId = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(timerId);
    }, [activeSession?.status, activeSession?.session_id]);

    useEffect(() => {
        apiGet("/session").then((data) => {
            if (data.loggedIn && data.user) setCurrentUser(data.user);
        });
    }, []);

    useEffect(() => {
        if (!currentUser || !activeSession?.session_id) return;
        if (activeSession.status === "in_progress" || activeSession.status === "completed") {
            saveActivityRecovery(currentUser, {
                type: "individual",
                session_id: activeSession.session_id,
                object_id: activeSession.object_id || objectId,
            });
        }
    }, [currentUser, activeSession?.session_id, activeSession?.status, activeSession?.object_id, objectId]);

    useEffect(() => {
        if (!activeSession?.session_id || !activeSession?.is_generating_feedback) return undefined;

        let disposed = false;
        const refreshGeneratingSession = async () => {
            try {
                const data = await apiGet(`/individual/sessions/${activeSession.session_id}`);
                if (!disposed && data.session) {
                    setActiveSession(stampSession(data.session));
                }
            } catch (error) {
                if (!disposed) {
                    setMessage("AI feedback masih diproses. Jika halaman ini tidak berubah, cek riwayat aktivitas beberapa saat lagi.");
                }
            }
        };

        const intervalId = window.setInterval(refreshGeneratingSession, 2500);
        return () => {
            disposed = true;
            window.clearInterval(intervalId);
        };
    }, [activeSession?.session_id, activeSession?.is_generating_feedback]);

    useEffect(() => {
        const markUnloading = () => {
            pageUnloadingRef.current = true;
        };

        window.addEventListener("pagehide", markUnloading);
        return () => window.removeEventListener("pagehide", markUnloading);
    }, []);

    useEffect(() => {
        if (!availableActivityTypes.includes(activityType) || isAssessmentCompleted(selectedTopic, activityType)) {
            setActivityType("exercise");
            setQuestionKind("multiple_choice");
        }
    }, [availableActivityTypes, activityType, selectedTopic]);

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
            if (!pageUnloadingRef.current) {
                clearActivityStatus({user: currentUser, activityKey, keepalive: true});
            }
            if (activityStatusKeyRef.current === activityKey) activityStatusKeyRef.current = null;
        };
    }, [currentUser, activeSession?.status, activeSession?.session_id, activeSession?.activity_type, activeSession?.object_id, objectId]);

    useEffect(() => {
        if (!currentUser || activeSession?.status !== "completed") return;
        const status = activityStatusForIndividual(activeSession.activity_type);
        const activityKey = `${status.type}:${activeSession.session_id}`;
        clearActivityStatus({user: currentUser, activityKey, keepalive: true});
        if (activityStatusKeyRef.current === activityKey) activityStatusKeyRef.current = null;
    }, [currentUser, activeSession?.status, activeSession?.session_id, activeSession?.activity_type]);

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
        if (!embedded) return undefined;

        const handleEscape = (event) => {
            if (event.key !== "Escape" || isTypingTarget(event.target)) return;
            event.preventDefault();

            if (!activeSession) {
                onBack?.();
                return;
            }

            if (completionNotice) {
                setMessage("Aktivitas sedang disimpan. Jangan refresh, tutup halaman, atau keluar sampai proses selesai.");
                return;
            }

            if (activeSession?.status === "in_progress") {
                setMessage("Aktivitas sudah dimulai. Selesaikan aktivitas ini sebelum kembali ke map.");
                return;
            }

            onBack?.();
        };

        window.addEventListener("keydown", handleEscape);
        return () => window.removeEventListener("keydown", handleEscape);
    }, [activeSession, completionNotice, embedded, onBack]);

    useCopyProtection(
        !!activeSession,
        setMessage,
        "Menyalin konten aktivitas individual tidak diizinkan."
    );

    const requestStart = () => {
        if (!selectedTopicId) {
            setMessage("Pilih topic terlebih dahulu.");
            return;
        }
        const completedKey = assessmentCompletionKey(activityType);
        if (completedKey && selectedTopic?.[completedKey]) {
            setMessage(`${activityTitle(activityType, questionKind)} untuk topic ini sudah pernah dikerjakan dan hanya bisa dilakukan satu kali.`);
            return;
        }
        setConfirmStartOpen(true);
    };

    const handleStart = async () => {
        if (!selectedTopicId) {
            setMessage("Pilih topic terlebih dahulu.");
            return;
        }
        const completedKey = assessmentCompletionKey(activityType);
        if (completedKey && selectedTopic?.[completedKey]) {
            setMessage(`${activityTitle(activityType, questionKind)} untuk topic ini sudah pernah dikerjakan dan hanya bisa dilakukan satu kali.`);
            return;
        }

        setConfirmStartOpen(false);
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
            setActiveSession(stampSession(data.session));
            setCaseAnswer("");
        } else if (data.active_session) {
            setActiveSession(stampSession(data.active_session));
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
        const shouldRevealAnswer = activeSession.activity_type === "exercise" && activeSession.question_kind === "multiple_choice";
        setBusy(true);
        setMessage("");
        setAnswerReveal(null);
        if (isLastQuestion && !shouldRevealAnswer) {
            setCompletionNotice(activeSession.activity_type === "exercise"
                ? "Getting AI feedback for your answers..."
                : "Calculating your result...");
        }
        try {
            const data = await apiPost(`/individual/sessions/${activeSession.session_id}/answer`, {
                answer_index: answerIndex,
            });
            if (data.session) {
                if (shouldRevealAnswer && data.answer_reveal) {
                    setAnswerReveal(data.answer_reveal);
                    answerRevealTimerRef.current = window.setTimeout(async () => {
                        answerRevealTimerRef.current = null;
                        setAnswerReveal(null);

                        if (data.needs_completion) {
                            setCompletionNotice("Getting AI feedback for your answers...");
                            try {
                                const completedData = await apiPost(`/individual/sessions/${activeSession.session_id}/complete-multiple-choice`, {});
                                if (completedData.session) {
                                    setActiveSession(stampSession(completedData.session));
                                } else {
                                    setMessage(getMessage(completedData, "Gagal menyelesaikan aktivitas."));
                                }
                            } catch (error) {
                                setMessage("Gagal menyelesaikan aktivitas.");
                            }
                            setCompletionNotice("");
                        } else {
                            setActiveSession(stampSession(data.session));
                        }
                        setBusy(false);
                    }, 1200);
                    return;
                }
                setActiveSession(stampSession(data.session));
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
                setActiveSession(stampSession(data.session));
            } else {
                setMessage(getMessage(data, "Gagal submit case study."));
            }
        } catch (error) {
            setMessage("Gagal submit case study.");
        }
        setCompletionNotice("");
        setBusy(false);
    };

    async function handleSessionTimeout() {
        if (!activeSession?.session_id || activeSession.status !== "in_progress") return;
        const isMultipleChoice = activeSession.question_kind === "multiple_choice";
        const isLastQuestion = activeSession.current_question_index >= activeSession.question_count - 1;
        setBusy(true);
        setMessage("");
        setCompletionNotice(activeSession.question_kind === "case_study"
            ? "Time is up. Saving your answer and getting feedback..."
            : isMultipleChoice && !isLastQuestion
                ? "Time is up. Moving to the next question..."
                : activeSession.activity_type === "exercise"
                    ? "Time is up. Saving your progress and getting AI feedback..."
                    : "Time is up. Calculating your result...");
        try {
            const data = await apiPost(`/individual/sessions/${activeSession.session_id}/timeout`, {
                answer_text: activeSession.question_kind === "case_study" ? caseAnswer : "",
            });
            if (data.session) {
                setActiveSession(stampSession(data.session));
                setMessage(getMessage(data, "Waktu aktivitas sudah habis."));
            } else {
                setMessage(getMessage(data, "Waktu aktivitas sudah habis."));
            }
        } catch (error) {
            setMessage("Gagal menyelesaikan aktivitas yang waktunya habis.");
        }
        setCompletionNotice("");
        setBusy(false);
    }

    useEffect(() => {
        if (activeSession?.status !== "in_progress" || !sessionTimer || sessionTimer.secondsLeft > 0) return;
        if (busy || completionNotice) return;
        if (timeoutSubmittedRef.current) return;
        timeoutSubmittedRef.current = true;
        handleSessionTimeout();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeSession?.status, activeSession?.session_id, sessionTimer?.secondsLeft, busy, completionNotice]);

    const handleEmbeddedBack = async () => {
        if (exitOnBack && activeSession?.status === "in_progress" && completionNotice) {
            setMessage("Aktivitas sedang disimpan. Jangan refresh, tutup halaman, atau keluar sampai proses selesai.");
            return;
        }
        if (exitOnBack && activeSession?.status === "in_progress") {
            setMessage("Aktivitas sudah dimulai. Selesaikan aktivitas ini sebelum kembali ke map.");
            return;
        }
        onBack?.();
    };

    const handleCloseCompletedActivity = () => {
        if (currentUser && activeSession?.session_id) {
            clearActivityRecovery(currentUser, {
                type: "individual",
                session_id: activeSession.session_id,
            });
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

    const handleRetryFeedback = async () => {
        if (!activeSession?.session_id || retryingFeedback) return;
        setRetryingFeedback(true);
        setMessage("");
        try {
            const data = await apiPost(`/individual/sessions/${activeSession.session_id}/retry-feedback`, {});
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

    const blockCaseAnswerPaste = (event) => {
        event.preventDefault();
        setMessage("Paste dan drop teks tidak diizinkan di jawaban case study.");
    };

    if (loading) {
        return <main className={`individual-app individual-app--center${embedded ? " individual-app--embedded" : ""}`}>Memuat aktivitas individual...</main>;
    }

    if (activeSession?.status === "in_progress") {
        if (activeSession.is_generating_feedback) {
            return (
                <main className={`individual-app individual-results${embedded ? " individual-app--embedded" : ""}`}>
                    <section className="individual-panel individual-loading" role="status" aria-live="polite">
                        <span className="individual-spinner" aria-hidden="true" />
                        <div>
                            <h2>AI feedback sedang dibuat</h2>
                            <p>
                                Jawabanmu sudah terkirim. Tetap tunggu di halaman ini sampai feedback dan hasil aktivitas muncul.
                                Jika halaman sempat direfresh, sistem akan mencoba memulihkan hasilnya otomatis.
                            </p>
                        </div>
                    </section>
                    {message && <p className="individual-message">{message}</p>}
                </main>
            );
        }

        const currentQuestion = activeSession.current_question;
        const isCaseStudy = activeSession.question_kind === "case_study";
        const isAssessment = ["pre_test", "post_test"].includes(activeSession.activity_type);
        const isTimeUp = sessionTimer?.secondsLeft <= 0;
        const revealAnswer = answerReveal?.answer || null;
        const displayedQuestion = answerReveal?.question || currentQuestion;
        const revealExerciseChoice = activeSession.activity_type === "exercise" && activeSession.question_kind === "multiple_choice" && !!revealAnswer;
        const progress = isCaseStudy
            ? "Case study"
            : `${activeSession.current_question_index + 1}/${activeSession.question_count}`;

        return (
            <main className={[
                "individual-app",
                "individual-workspace",
                isAssessment ? "individual-workspace--assessment" : "",
                embedded ? "individual-app--embedded" : "",
            ].filter(Boolean).join(" ")}>
                <header className="individual-header">
                    <div>
                        <span className="individual-label">{context?.course?.course_name}</span>
                        <h1>{activityTitle(activeSession.activity_type, activeSession.question_kind)}</h1>
                    </div>
                    <div className="individual-header__actions">
                        <div className={`individual-timer${isTimeUp ? " is-danger" : ""}`} aria-label={`Time left ${sessionTimer?.secondsLeft || 0} seconds`}>
                            <span>{formatSeconds(sessionTimer?.secondsLeft)}</span>
                            <div>
                                <i style={{width: `${sessionTimer?.percentLeft || 0}%`}} />
                            </div>
                        </div>
                        <span>{progress}</span>
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
                            <h2>{displayedQuestion?.case_title}</h2>
                            <p>{displayedQuestion?.case_prompt}</p>
                        </section>

                        <section className="individual-panel individual-answer">
                            <h2>My Answer</h2>
                            <textarea
                                value={caseAnswer}
                                onChange={(event) => setCaseAnswer(event.target.value)}
                                onDrop={blockCaseAnswerPaste}
                                onPaste={blockCaseAnswerPaste}
                                placeholder="Write your case study answer here..."
                                disabled={busy || isTimeUp}
                            />
                            <button
                                className="individual-button individual-button--primary"
                                onClick={handleSubmitCase}
                                disabled={busy || isTimeUp || caseAnswer.trim().length < 20}
                            >
                                {busy ? "Getting AI Feedback..." : "Submit Answer"}
                            </button>
                        </section>
                    </>
                ) : (
                    <section className={`individual-panel individual-question${isAssessment ? " individual-question--protected" : ""}`}>
                        <div className="individual-section-title">
                            <h2>Question {activeSession.current_question_index + 1}</h2>
                            <span>{activeSession.question_count} questions</span>
                        </div>
                        <p>{displayedQuestion?.question_text}</p>
                        <div className="individual-options">
                            {(displayedQuestion?.choices || []).map((choice, index) => {
                                const isSelected = revealAnswer?.answer_index === index;
                                const isCorrect = displayedQuestion?.correct_answer_index === index;
                                return (
                                    <button
                                        className={[
                                            "individual-option",
                                            revealExerciseChoice && isCorrect ? "is-correct" : "",
                                            revealExerciseChoice && isSelected && !revealAnswer.is_correct ? "is-wrong" : "",
                                        ].filter(Boolean).join(" ")}
                                        key={`${index}-${choice}`}
                                        type="button"
                                        onClick={() => handleAnswer(index)}
                                        disabled={busy || isTimeUp || revealExerciseChoice}
                                    >
                                        <span>{choiceLabel(index)}</span>
                                        <strong>{choice}</strong>
                                    </button>
                                );
                            })}
                        </div>
                        {revealExerciseChoice && (
                            <p className={`individual-answer-note${revealAnswer.is_correct ? " is-correct" : " is-wrong"}`}>
                                {revealAnswer.is_correct ? "Correct answer." : "Wrong answer."}
                            </p>
                        )}
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
            <main className={`individual-app individual-results${embedded ? " individual-app--embedded" : ""}`}>
                {embedded && (
                    <button className="individual-button individual-button--primary" type="button" onClick={handleCloseCompletedActivity}>
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
                    <p className="individual-time-result">
                        Time used: <strong>{formatSeconds(sessionTimer?.secondsSpent)}</strong>
                        {" "}· Time left: <strong>{formatSeconds(sessionTimer?.secondsLeft)}</strong>
                    </p>
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
                                            {!isAssessment && (
                                                <p>Correct: {choiceLabel(question.correct_answer_index)}. {question.choices?.[question.correct_answer_index]}</p>
                                            )}
                                        </div>
                                        <div className="individual-review__answer">
                                            <b className={answer?.is_correct ? "is-correct" : "is-wrong"}>
                                                {answer?.is_correct ? "Correct" : "Wrong"}
                                            </b>
                                            {!isAssessment && (
                                                <span>
                                                    Your answer: {answer?.answer_index === null || answer?.answer_index === undefined
                                                        ? "No answer"
                                                        : `${choiceLabel(answer.answer_index)}. ${question.choices?.[answer.answer_index] || ""}`}
                                                </span>
                                            )}
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
                    <section className="individual-panel individual-feedback-retry">
                        <div>
                            <strong>Feedback AI gagal dibuat.</strong>
                            <p>{activeSession.feedback_error}</p>
                        </div>
                        {activeSession.activity_type === "exercise" || isCaseStudy ? (
                            <button
                                className="individual-button individual-button--primary"
                                type="button"
                                onClick={handleRetryFeedback}
                                disabled={retryingFeedback}
                            >
                                {retryingFeedback ? "Retrying..." : "Retry AI Feedback"}
                            </button>
                        ) : null}
                    </section>
                )}
            </main>
        );
    }

    const canStart = !!selectedTopicId
        && isTopicSelectable(selectedTopic)
        && availableActivityTypes.includes(activityType)
        && !isAssessmentCompleted(selectedTopic, activityType)
        && isAssessmentOpen(selectedTopic, activityType);
    const selectedAssessmentUnavailable = ["pre_test", "post_test"].includes(activityType)
        && selectedTopic
        && !isAssessmentCompleted(selectedTopic, activityType)
        && !isAssessmentOpen(selectedTopic, activityType);
    const showComputerLabel = !String(objectId).startsWith("novirtual-computer-");

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
                        {(context?.topics || []).map((topic) => {
                            const selectableTopic = isTopicSelectable(topic);
                            return (
                                <button
                                    type="button"
                                    className={`individual-topic${String(topic.topic_id) === String(selectedTopicId) ? " is-selected" : ""}${selectableTopic ? "" : " is-inactive"}`}
                                    key={topic.topic_id}
                                    onClick={() => {
                                        if (selectableTopic) setSelectedTopicId(String(topic.topic_id));
                                    }}
                                    disabled={!selectableTopic}
                                >
                                    <div className="individual-topic__heading">
                                        <strong>{topic.topic_name}</strong>
                                        {!selectableTopic && <span className="topic-inactive-badge">Tidak aktif</span>}
                                    </div>
                                    <div className="individual-topic-assessments">
                                        {["pre_test", "post_test"].map((type) => (
                                            <div className="individual-topic-assessment" key={type}>
                                                <span className={`individual-topic-assessment__badge is-${assessmentStatusKind(topic, type)}`}>
                                                    {assessmentShortStatus(topic, type)}
                                                </span>
                                                <div>
                                                    <b>{activityTitle(type, "multiple_choice")}</b>
                                                    <small>{assessmentStatusText(topic, type)}</small>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                </div>

                <div className="individual-panel individual-setup">
                    <div className="individual-section-title">
                        <h2>Activity</h2>
                        {showComputerLabel && <span>Computer {objectId}</span>}
                    </div>

                    <div className="individual-choice-helper" role="note">
                        <strong>Pilih jenis aktivitas</strong>
                        <span>Klik salah satu pilihan di bawah ini.</span>
                    </div>

                    <div className="individual-segment" role="group" aria-label="Pilih jenis aktivitas individual">
                        {availableActivityTypes.map((type) => {
                            const completed = isAssessmentCompleted(selectedTopic, type);
                            return (
                                <button
                                    key={type}
                                    className={`${activityType === type ? "is-selected" : ""}${completed ? " is-completed" : ""}${!completed && !isAssessmentOpen(selectedTopic, type) ? " is-unavailable" : ""}`}
                                    type="button"
                                    aria-pressed={activityType === type}
                                    disabled={completed}
                                    onClick={() => {
                                        setActivityType(type);
                                        if (type !== "exercise") setQuestionKind("multiple_choice");
                                    }}
                                >
                                    {activityTitle(type, "multiple_choice")}
                                    {completed && <span>Selesai</span>}
                                </button>
                            );
                        })}
                    </div>

                    {activityType === "exercise" && (
                        <div className="individual-choice-subgroup">
                            <span>Pilih bentuk soal untuk Individual Exercise:</span>
                            <div className="individual-segment individual-segment--secondary" role="group" aria-label="Pilih bentuk soal individual exercise">
                                <button
                                    className={questionKind === "multiple_choice" ? "is-selected" : ""}
                                    type="button"
                                    aria-pressed={questionKind === "multiple_choice"}
                                    onClick={() => setQuestionKind("multiple_choice")}
                                >
                                    Multiple Choice
                                </button>
                                <button
                                    className={questionKind === "case_study" ? "is-selected" : ""}
                                    type="button"
                                    aria-pressed={questionKind === "case_study"}
                                    onClick={() => setQuestionKind("case_study")}
                                >
                                    Case Study
                                </button>
                            </div>
                        </div>
                    )}

                    <p>
                        {selectedTopic
                            ? `${activityTitle(activityType, questionKind)} for ${selectedTopic.topic_name}.`
                            : "Select a topic before starting."}
                    </p>
                    {selectedAssessmentUnavailable ? (
                        <p className="individual-message">{assessmentStatusText(selectedTopic, activityType)}</p>
                    ) : (
                        <button className="individual-button individual-button--primary" onClick={requestStart} disabled={!canStart || busy}>
                            Start Activity
                        </button>
                    )}
                    {message && <p className="individual-message">{message}</p>}
                </div>
            </section>

            {confirmStartOpen && (
                <div className="activity-exit-confirm" role="dialog" aria-modal="true" aria-labelledby="individual-start-confirm-title">
                    <section className="activity-exit-confirm__panel activity-start-confirm">
                        <div className="activity-start-confirm__heading">
                            <span className="activity-start-confirm__icon" aria-hidden="true">!</span>
                            <div>
                                <h2 id="individual-start-confirm-title">{startConfirmation.title}</h2>
                                <p>{startConfirmation.intro}</p>
                            </div>
                        </div>
                        <div className="activity-start-confirm__facts" aria-label="Informasi aktivitas">
                            {startConfirmation.facts.map((fact) => (
                                <article key={`${fact.title}-${fact.badge}`}>
                                    <span>{fact.badge}</span>
                                    <strong>{fact.title}</strong>
                                    <p>{fact.text}</p>
                                </article>
                            ))}
                        </div>
                        <p className="activity-start-confirm__note">{startConfirmation.note}</p>
                        <div className="activity-exit-confirm__actions">
                            <button type="button" onClick={() => setConfirmStartOpen(false)}>
                                Batal
                            </button>
                            <button className="is-danger" type="button" onClick={handleStart} disabled={busy}>
                                Mulai Sekarang
                            </button>
                        </div>
                    </section>
                </div>
            )}

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
