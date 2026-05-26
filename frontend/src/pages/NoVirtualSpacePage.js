import React, {useEffect, useMemo, useState} from "react";
import {useNavigate} from "react-router-dom";
import {apiGet, apiPost} from "../api/apiClient";
import AvatarIcon from "../components/AvatarIcon";
import ChatLauncher from "../components/ChatLauncher";
import UserHUD from "../components/UserHUD";
import IndividualActivityPage from "./IndividualActivityPage";
import TableActivityPage from "./TableActivityPage";
import QuizActivityPage from "./QuizActivityPage";
import {isActivityStatusActive} from "../utils/activityStatus";
import "./VirtualSpacePage.css";
import "./NoVirtualSpacePage.css";

const activityCards = [
    {
        id: "individual",
        title: "Individual Practice",
        label: "Practice",
        description: "Work independently through exercises, case studies, pre-tests, or post-tests.",
    },
    {
        id: "group",
        title: "Group Activity",
        label: "Collaborate",
        description: "Host or join a case-study group with a code from 101 to 150.",
    },
    {
        id: "quiz",
        title: "Fun Quiz",
        label: "Compete",
        description: "Host or join a live quiz match with a code from 101 to 150.",
    },
];

const choiceLabel = (index) => ["A", "B", "C", "D"][index] || String(index + 1);

const activityPrompt = (activity) => activity?.case_prompt || activity?.question_text || "Saved activity details are available below.";

const quizAnswerFeedback = (activity, answer, question) =>
    (activity.results?.wrong_answer_feedback || []).find((item) =>
        String(item.user_id) === String(answer.user_id)
        && String(item.question_id) === String(question.question_id)
    );

const quizOutcome = (activity, score) => {
    const winner = activity.results?.winner;
    if (!winner) return "";
    if (winner.is_tie) return "Tie";
    return String(winner.user_id) === String(score.user_id) ? "Winner" : "Lose";
};

const activityQuizOutcomeLabel = (outcome) => {
    if (outcome === "win") return "Win";
    if (outcome === "lose") return "Lose";
    if (outcome === "tie") return "Tie";
    return "";
};

const individualActivityLabel = (activity) => {
    if (activity.individual_activity_type === "pre_test") return "Pre-test";
    if (activity.individual_activity_type === "post_test") return "Post-test";
    return activity.question_kind === "case_study" ? "Individual Case Study" : "Individual Exercise";
};

const individualAnswerFeedback = (activity, answer) =>
    (activity.results?.wrong_answer_feedback || activity.feedback?.wrong_answer_feedback || [])
        .find((item) => String(item.question_id) === String(answer.question_id));

const rankToneClass = (index) => {
    if (index === 0) return "course-leaderboard__rank--first";
    if (index === 1) return "course-leaderboard__rank--second";
    if (index === 2) return "course-leaderboard__rank--third";
    return index < 10 ? "course-leaderboard__rank--top-ten" : "";
};

const formatSeconds = (value) => {
    const total = Math.max(0, Number(value || 0));
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
};

const noVirtualComputerObjectId = (userId) => `novirtual-computer-${userId || "student"}`;

const buildNoVirtualActivityFromStatus = (status, userId) => {
    if (!isActivityStatusActive(status)) return null;

    if (["individual_exercise", "individual_pre_test", "individual_post_test"].includes(status.type)) {
        const objectId = status.object_id || noVirtualComputerObjectId(userId);
        const searchParams = new URLSearchParams({object_id: objectId});
        return {
            type: "individual",
            searchParams: searchParams.toString(),
            restored: true,
        };
    }

    if (status.type === "group_discussion") {
        const groupId = status.group_id || status.object_id || "101";
        const searchParams = new URLSearchParams({group_id: String(groupId)});
        if (status.object_id) searchParams.set("object_id", status.object_id);
        return {
            type: "group",
            searchParams: searchParams.toString(),
            restored: true,
        };
    }

    if (status.type === "quiz") {
        const tableId = status.table_id || status.group_id || status.object_id || "101";
        const groupId = status.group_id || tableId;
        const searchParams = new URLSearchParams({
            table_id: String(tableId),
            group_id: String(groupId),
        });
        if (status.object_id) searchParams.set("object_id", status.object_id);
        return {
            type: "quiz",
            searchParams: searchParams.toString(),
            restored: true,
        };
    }

    return null;
};

const NoVirtualSpacePage = ({user, setLoggedIn, setUser}) => {
    const [currentUser, setCurrentUser] = useState(user);
    const [dashboard, setDashboard] = useState(null);
    const [course, setCourse] = useState(null);
    const [activeDashboardTab, setActiveDashboardTab] = useState(null);
    const [activeActivity, setActiveActivity] = useState(null);
    const [selectedActivity, setSelectedActivity] = useState(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [retryingHistoryFeedback, setRetryingHistoryFeedback] = useState(false);
    const [expandedLeaderboardGroups, setExpandedLeaderboardGroups] = useState({});
    const navigate = useNavigate();
    const currentUserId = currentUser?.user_id;

    useEffect(() => {
        if (!user) {
            apiGet("/session").then((res) => {
                if (res.loggedIn) {
                    setCurrentUser(res.user);
                    setUser(res.user);
                } else {
                    navigate("/");
                }
            });
            return;
        }
        setCurrentUser(user);
    }, [user, navigate, setUser]);

    useEffect(() => {
        if (!currentUser) return undefined;

        let active = true;
        const loadDashboard = () => {
            apiGet("/virtualspace/dashboard").then((data) => {
                if (!active) return;
                setDashboard(data);
                if (data.user) {
                    const nextUser = {...currentUser, ...data.user};
                    setCurrentUser(nextUser);
                    setUser(nextUser);
                }
            });
        };

        loadDashboard();
        const intervalId = window.setInterval(loadDashboard, 30000);

        return () => {
            active = false;
            window.clearInterval(intervalId);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentUser?.user_id]);

    useEffect(() => {
        if (!currentUserId) return;
        apiGet("/table/context?group_id=101").then((data) => {
            if (data.course) setCourse(data.course);
        });
    }, [currentUserId]);

    useEffect(() => {
        if (!currentUserId || activeActivity) return undefined;

        let active = true;
        apiGet("/activity-status/current").then((data) => {
            if (!active || activeActivity) return;
            const restoredActivity = buildNoVirtualActivityFromStatus(data.status, currentUserId);
            if (restoredActivity) setActiveActivity(restoredActivity);
        }).catch(() => {});

        return () => {
            active = false;
        };
    }, [activeActivity, currentUserId]);

    const handleLogout = async () => {
        if (window.socket) window.socket.emit("logout");

        const res = await apiPost("/logout", {});
        if (res.message === "Logout berhasil") {
            const wasStudentAccess = localStorage.getItem("studentAccessLogin") === "1";
            setLoggedIn(false);
            setUser(null);
            localStorage.clear();

            setTimeout(() => {
                if (window.socket) window.socket.disconnect();
                navigate(wasStudentAccess ? "/?loggedout=student" : "/");
            }, 300);
        } else {
            alert("Gagal logout. Coba lagi.");
        }
    };

    const showGameLayer = !!currentUser?.gamification_enabled;
    const showHistoryAvatars = false;
    const groupLeaderboard = dashboard?.leaderboard || [];
    const quizLeaderboard = dashboard?.quiz_leaderboard || [];
    const individualLeaderboard = dashboard?.individual_leaderboard || [];
    const individualActivities = dashboard?.individual_activities || [];
    const groupActivities = dashboard?.group_activities || [];
    const groupCaseActivities = groupActivities.filter((activity) => activity.activity_type !== "quiz");
    const quizActivities = groupActivities.filter((activity) => activity.activity_type === "quiz");

    const visibleTabs = useMemo(() => [
        ...(showGameLayer ? [{id: "leaderboard", label: "Leaderboard"}] : []),
        {id: "individual", label: "Individual"},
        {id: "group", label: "Group"},
        {id: "quiz", label: "Quiz"},
    ], [showGameLayer]);

    const currentDashboardTab = activeDashboardTab && visibleTabs.some((tab) => tab.id === activeDashboardTab)
        ? activeDashboardTab
        : (showGameLayer ? "leaderboard" : "individual");

    const openActivity = async (activity) => {
        setDetailLoading(true);
        const data = await apiGet(`/virtualspace/activities/${activity.activity_key || activity.session_id}`);
        setSelectedActivity(data.activity || null);
        setDetailLoading(false);
    };

    const retryHistoryFeedback = async () => {
        if (!selectedActivity || retryingHistoryFeedback) return;
        const rawSessionId = String(selectedActivity.session_id || "");
        const numericSessionId = rawSessionId.replace(/^individual-/, "").replace(/^quiz-/, "").replace(/^table-/, "");
        const endpoint = selectedActivity.activity_type === "individual"
            ? `/individual/sessions/${numericSessionId}/retry-feedback`
            : selectedActivity.activity_type === "quiz"
                ? `/quiz/sessions/${numericSessionId}/retry-feedback`
                : `/table/sessions/${numericSessionId}/retry-feedback`;

        setRetryingHistoryFeedback(true);
        try {
            await apiPost(endpoint, {});
            await openActivity({activity_key: rawSessionId});
        } catch (error) {
            alert(error.message || "Gagal mencoba ulang AI feedback.");
        } finally {
            setRetryingHistoryFeedback(false);
        }
    };

    const toggleLeaderboardGroup = (courseGroupId) => {
        setExpandedLeaderboardGroups((current) => ({
            ...current,
            [courseGroupId]: !current[courseGroupId],
        }));
    };

    const renderLeaderboards = () => (
        <div className="leaderboard-stack">
            <div className="leaderboard-block">
                <div className="leaderboard-block__title">
                    <h3>Group Activity Leaderboard</h3>
                    <span>XP</span>
                </div>
                <div className="course-leaderboard course-leaderboard--compact course-leaderboard--groups">
                    {groupLeaderboard.length > 0 ? groupLeaderboard.map((item, index) => (
                        <article className="course-leaderboard__group" key={item.course_group_id}>
                            <button
                                className="course-leaderboard__row course-leaderboard__row--button no-virtual-leaderboard-row"
                                type="button"
                                onClick={() => toggleLeaderboardGroup(item.course_group_id)}
                                aria-expanded={!!expandedLeaderboardGroups[item.course_group_id]}
                            >
                                <div className={`course-leaderboard__rank course-leaderboard__rank--group ${rankToneClass(index)}`}>
                                    #{index + 1}
                                </div>
                                <div className="course-leaderboard__group-icon">
                                    {expandedLeaderboardGroups[item.course_group_id] ? "-" : "+"}
                                </div>
                                <div>
                                    <strong>{item.group_name}</strong>
                                    <span>{item.students_count || 0} students · {item.activities_count || 0} activities</span>
                                </div>
                                <b>{item.total_group_xp || 0} XP</b>
                            </button>
                            {expandedLeaderboardGroups[item.course_group_id] && (
                                <div className="course-leaderboard__students">
                                    {(item.students || []).length > 0 ? (
                                        item.students.map((student) => (
                                            <div className="course-leaderboard__student" key={student.user_id}>
                                                <div>
                                                    <strong>{student.name}</strong>
                                                    <span>{student.activities_count || 0} activities</span>
                                                </div>
                                                <b>{student.total_xp || 0} XP</b>
                                            </div>
                                        ))
                                    ) : (
                                        <p className="course-leaderboard__empty">No students assigned.</p>
                                    )}
                                </div>
                            )}
                        </article>
                    )) : <p className="panel-empty">No XP records yet.</p>}
                </div>
            </div>

            <div className="leaderboard-block">
                <div className="leaderboard-block__title">
                    <h3>Quiz Score Leaderboard</h3>
                    <span>Points</span>
                </div>
                <div className="course-leaderboard course-leaderboard--compact course-leaderboard--quiz">
                    {quizLeaderboard.length > 0 ? quizLeaderboard.map((item, index) => (
                        <article className="course-leaderboard__row no-virtual-leaderboard-row" key={item.user_id}>
                            <div className={`course-leaderboard__rank course-leaderboard__rank--quiz ${rankToneClass(index)}`}>
                                {index + 1}
                            </div>
                            <div>
                                <strong>{item.name}</strong>
                                <span>{item.quizzes_count} quizzes</span>
                            </div>
                            <b>{item.total_quiz_score} pts</b>
                        </article>
                    )) : <p className="panel-empty">No quiz scores yet.</p>}
                </div>
            </div>

            <div className="leaderboard-block">
                <div className="leaderboard-block__title">
                    <h3>Individual XP Leaderboard</h3>
                    <span>Level</span>
                </div>
                <div className="course-leaderboard course-leaderboard--compact course-leaderboard--individual">
                    {individualLeaderboard.length > 0 ? individualLeaderboard.map((item, index) => (
                        <article className="course-leaderboard__row no-virtual-leaderboard-row" key={item.user_id}>
                            <div className={`course-leaderboard__rank course-leaderboard__rank--individual ${rankToneClass(index)}`}>
                                {index + 1}
                            </div>
                            <div>
                                <strong>{item.name}</strong>
                                <span>{item.group_name || "Group"} · {item.activities_count || 0} activities</span>
                            </div>
                            <div className="course-leaderboard__score-stack">
                                <b>{item.total_xp || 0} XP</b>
                                <span
                                    className="course-leaderboard__level"
                                    style={{"--level-color": item.color_hex || "#6B7280"}}
                                >
                                    Level {item.level_id || 1} · {item.level_name || "Rookie"}
                                </span>
                            </div>
                        </article>
                    )) : <p className="panel-empty">No individual XP records yet.</p>}
                </div>
            </div>
        </div>
    );

    const renderActivityList = (activities, emptyText) => (
        <div className="activity-list">
            {activities.length > 0 ? activities.map((activity) => (
                <button
                    className={[
                        "activity-card",
                        "no-virtual-history-card",
                        activity.activity_type === "individual"
                            && ["pre_test", "post_test"].includes(activity.individual_activity_type)
                            ? "activity-card--assessment"
                            : "",
                        activity.activity_type === "quiz" && activity.quiz_outcome
                            ? `activity-card--quiz-outcome activity-card--quiz-outcome-${activity.quiz_outcome}`
                            : "",
                    ].filter(Boolean).join(" ")}
                    key={activity.activity_key || activity.session_id}
                    onClick={() => openActivity(activity)}
                    type="button"
                >
                    <strong>{activity.activity_name}</strong>
                    <span>{activity.topic_name || "Topic"} · {activity.case_title}</span>
                    {showGameLayer && (
                        <small>
                            {activity.activity_type === "individual"
                                ? (activity.individual_activity_type === "exercise"
                                    ? `${activity.my_xp || activity.xp_total || 0} individual XP`
                                    : `${activity.score_total || 0}/100 score`)
                                : activity.activity_type === "quiz"
                                    ? `${activity.quiz_points || 0} pts`
                                : `${activity.group_xp || 0} group XP`}
                        </small>
                    )}
                    {activity.activity_type === "individual" && (
                        <small>
                            Waktu digunakan {formatSeconds(activity.seconds_spent)} · Sisa {formatSeconds(activity.seconds_left)}
                        </small>
                    )}
                    {activity.activity_type === "quiz" && activity.quiz_outcome && (
                        <small className={`activity-card__quiz-outcome activity-card__quiz-outcome--${activity.quiz_outcome}`}>
                            vs {activity.quiz_competitor_name || "Competitor"} · {activityQuizOutcomeLabel(activity.quiz_outcome)}
                        </small>
                    )}
                </button>
            )) : <p className="panel-empty">{emptyText}</p>}
        </div>
    );

    const renderHistoryModal = () => {
        if (!selectedActivity && !detailLoading) return null;

        return (
            <div className="activity-modal" role="dialog" aria-modal="true">
                <div className="activity-modal__backdrop" onClick={() => setSelectedActivity(null)} />
                <section className="activity-modal__content no-virtual-history-modal">
                    {detailLoading ? (
                        <div className="activity-modal__header">
                            <p className="panel-empty">Loading activity...</p>
                            <button className="activity-modal__close" onClick={() => setSelectedActivity(null)} type="button">
                                Close
                            </button>
                        </div>
                    ) : (
                        <>
                            <div className="activity-modal__header">
                                <div>
                                    <span className="activity-eyebrow">{selectedActivity.activity_name}</span>
                                    <h1>{selectedActivity.case_title}</h1>
                                    <p className="activity-topic">{selectedActivity.topic_name}</p>
                                </div>
                                <button className="activity-modal__close" onClick={() => setSelectedActivity(null)} type="button">
                                    Close
                                </button>
                            </div>

                            <div className="activity-detail-grid">
                                <section>
                                    <h2>
                                        {selectedActivity.activity_type === "individual"
                                            ? "Activity"
                                            : selectedActivity.activity_type === "quiz" ? "Quiz" : "Case"}
                                    </h2>
                                    <p>{activityPrompt(selectedActivity)}</p>
                                </section>

                                <section>
                                    <h2>{selectedActivity.activity_type === "individual" ? "Student" : "Group"}</h2>
                                    <div className="activity-member-list no-virtual-member-list">
                                        {(selectedActivity.members || []).map((member) => (
                                            <article key={member.user_id || member.name}>
                                                {showHistoryAvatars && <AvatarIcon path={member.avatar_public_path} alt={member.name} />}
                                                <div>
                                                    <strong>{member.name}</strong>
                                                    {showGameLayer
                                                        && (selectedActivity.activity_type !== "individual" || selectedActivity.individual_activity_type === "exercise")
                                                        && <span>{member.xp_earned || 0} XP</span>}
                                                </div>
                                            </article>
                                        ))}
                                    </div>
                                </section>
                            </div>

                            {selectedActivity.activity_type === "individual" && (
                                <>
                                    <section className="activity-detail-section individual-history-result">
                                        <span className="quiz-history-result__label">{individualActivityLabel(selectedActivity)}</span>
                                        <h2>
                                            {selectedActivity.individual_activity_type === "pre_test" || selectedActivity.individual_activity_type === "post_test"
                                                ? `${selectedActivity.results?.score_total || 0}/100`
                                                : selectedActivity.question_kind === "case_study"
                                                    ? "Case study completed"
                                                    : `${selectedActivity.results?.correct_count || 0}/${selectedActivity.results?.question_count || 0} correct`}
                                        </h2>
                                        {showGameLayer && selectedActivity.individual_activity_type === "exercise" && (
                                            <p>{selectedActivity.results?.xp_total || 0} individual XP earned.</p>
                                        )}
                                        <p>
                                            Waktu digunakan: <strong>{formatSeconds(selectedActivity.seconds_spent)}</strong>
                                            {" "}· Sisa waktu: <strong>{formatSeconds(selectedActivity.seconds_left)}</strong>
                                        </p>
                                    </section>

                                    {selectedActivity.question_kind === "case_study" ? (
                                        <section className="activity-detail-section">
                                            <h2>AI Feedback</h2>
                                            {selectedActivity.feedback_status === "error" && (
                                                <div className="history-feedback-retry">
                                                    <strong>AI feedback belum berhasil dibuat.</strong>
                                                    <p>{selectedActivity.feedback_error || "Coba ulang untuk membuat feedback dan memperbarui XP."}</p>
                                                    <button
                                                        className="activity-modal__close history-feedback-retry__button"
                                                        type="button"
                                                        onClick={retryHistoryFeedback}
                                                        disabled={retryingHistoryFeedback}
                                                    >
                                                        {retryingHistoryFeedback ? "Mencoba ulang..." : "Coba Ulang AI Feedback"}
                                                    </button>
                                                </div>
                                            )}
                                            <div className="history-feedback-grid">
                                                <article>
                                                    <strong className="history-feedback-label history-feedback-label--www">What Went Well</strong>
                                                    <p>{selectedActivity.feedback?.www || "Feedback unavailable."}</p>
                                                </article>
                                                <article>
                                                    <strong className="history-feedback-label history-feedback-label--ebi">Even Better If</strong>
                                                    <p>{selectedActivity.feedback?.ebi || "Feedback unavailable."}</p>
                                                </article>
                                            </div>
                                            {showGameLayer && selectedActivity.feedback?.xp_reason && (
                                                <p className="individual-history-xp-reason">{selectedActivity.feedback.xp_reason}</p>
                                            )}
                                        </section>
                                    ) : (
                                        <section className="activity-detail-section">
                                            <h2>Review</h2>
                                            {selectedActivity.feedback_status === "error" && (
                                                <div className="history-feedback-retry">
                                                    <strong>AI feedback untuk jawaban salah belum berhasil dibuat.</strong>
                                                    <p>{selectedActivity.feedback_error || "Jawaban dan skor sudah tersimpan. Coba ulang untuk membuat feedback."}</p>
                                                    <button
                                                        className="activity-modal__close history-feedback-retry__button"
                                                        type="button"
                                                        onClick={retryHistoryFeedback}
                                                        disabled={retryingHistoryFeedback}
                                                    >
                                                        {retryingHistoryFeedback ? "Mencoba ulang..." : "Coba Ulang AI Feedback"}
                                                    </button>
                                                </div>
                                            )}
                                            <div className="individual-history-review">
                                                {(selectedActivity.questions || []).map((question, index) => {
                                                    const answer = (selectedActivity.answers || [])
                                                        .find((item) => String(item.question_id) === String(question.question_id));
                                                    const feedback = answer ? individualAnswerFeedback(selectedActivity, answer) : null;
                                                    const showIndividualXp = showGameLayer && selectedActivity.individual_activity_type === "exercise";
                                                    const showAssessmentScore = selectedActivity.individual_activity_type === "pre_test"
                                                        || selectedActivity.individual_activity_type === "post_test";
                                                    const showCorrectAnswer = selectedActivity.individual_activity_type === "exercise";
                                                    return (
                                                        <article key={question.question_id}>
                                                            <div className="quiz-history-question">
                                                                <span>Question {index + 1}</span>
                                                                <strong>{question.question_text}</strong>
                                                                {showCorrectAnswer && (
                                                                    <p>Correct: {choiceLabel(question.correct_answer_index)}. {question.choices?.[question.correct_answer_index]}</p>
                                                                )}
                                                            </div>
                                                            <div className="individual-history-answer">
                                                                <b className={answer?.is_correct ? "is-correct" : "is-wrong"}>
                                                                    {answer?.is_correct ? "Correct" : "Wrong"}
                                                                </b>
                                                                {!showAssessmentScore && (
                                                                    <span>
                                                                        Your answer: {answer?.answer_index === null || answer?.answer_index === undefined
                                                                            ? "No answer"
                                                                            : `${choiceLabel(answer.answer_index)}. ${question.choices?.[answer.answer_index] || ""}`}
                                                                    </span>
                                                                )}
                                                                {showIndividualXp && <em>{answer?.xp_earned || 0} XP</em>}
                                                                {showAssessmentScore && <em>{answer?.score || 0} pts</em>}
                                                            </div>
                                                            {feedback && (
                                                                <div className="quiz-history-ai individual-history-ai">
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
                                </>
                            )}

                            {selectedActivity.activity_type === "quiz" && (
                                <>
                                    <section className="activity-detail-section quiz-history-result">
                                        <span className="quiz-history-result__label">Outcome</span>
                                        <h2>
                                            {selectedActivity.results?.winner?.is_tie
                                                ? `Tie: ${(selectedActivity.results?.winner?.names || []).join(", ")}`
                                                : `${selectedActivity.results?.winner?.name || "Winner"} wins`}
                                        </h2>
                                        <p>
                                            {showGameLayer
                                                ? "Final score is based on correct answers only."
                                                : "Winner is based on correct answers only."}
                                        </p>
                                    </section>

                                    {showGameLayer && (
                                        <section className="activity-detail-section">
                                            <h2>Scoreboard</h2>
                                            <div className="quiz-history-scoreboard">
                                                {(selectedActivity.results?.scoreboard || []).map((item, index) => (
                                                    <article
                                                        className={showHistoryAvatars ? "" : "quiz-history-scoreboard__row--no-avatar"}
                                                        key={item.user_id}
                                                    >
                                                        <div className="quiz-history-rank">{index + 1}</div>
                                                        {showHistoryAvatars && <AvatarIcon path={item.avatar_public_path} alt={item.name} />}
                                                        <div>
                                                            <strong>{item.name}</strong>
                                                            <span>{item.correct_count}/{item.question_count} correct</span>
                                                        </div>
                                                        <b className={item.total_score > 0 ? "is-correct" : "is-wrong"}>{item.total_score} pts</b>
                                                        <em>{quizOutcome(selectedActivity, item)}</em>
                                                    </article>
                                                ))}
                                            </div>
                                        </section>
                                    )}

                                    <section className="activity-detail-section">
                                        <h2>Quiz Review</h2>
                                        {(selectedActivity.results?.wrong_answer_feedback_error || selectedActivity.wrong_answer_feedback_error) && (
                                            <div className="history-feedback-retry">
                                                <strong>AI feedback untuk jawaban salah belum berhasil dibuat.</strong>
                                                <p>{selectedActivity.results?.wrong_answer_feedback_error || selectedActivity.wrong_answer_feedback_error}</p>
                                                <button
                                                    className="activity-modal__close history-feedback-retry__button"
                                                    type="button"
                                                    onClick={retryHistoryFeedback}
                                                    disabled={retryingHistoryFeedback}
                                                >
                                                    {retryingHistoryFeedback ? "Mencoba ulang..." : "Coba Ulang AI Feedback"}
                                                </button>
                                            </div>
                                        )}
                                        <div className="quiz-history-review">
                                            {(selectedActivity.questions || []).map((question, index) => (
                                                <article key={question.question_id}>
                                                    <div className="quiz-history-question">
                                                        <span>Question {index + 1}</span>
                                                        <strong>{question.question_text}</strong>
                                                        <p>Correct: {choiceLabel(question.correct_answer_index)}. {question.choices?.[question.correct_answer_index]}</p>
                                                    </div>
                                                    {(selectedActivity.answers || [])
                                                        .filter((answer) => String(answer.question_id) === String(question.question_id))
                                                        .map((answer) => {
                                                            const feedback = quizAnswerFeedback(selectedActivity, answer, question);
                                                            return (
                                                                <div
                                                                    className={[
                                                                        "quiz-history-answer",
                                                                        showGameLayer ? "" : "quiz-history-answer--no-score",
                                                                        showHistoryAvatars ? "" : "quiz-history-answer--no-avatar",
                                                                    ].filter(Boolean).join(" ")}
                                                                    key={answer.answer_id}
                                                                >
                                                                    {showHistoryAvatars && <AvatarIcon path={answer.avatar_public_path} alt={answer.name} />}
                                                                    <div>
                                                                        <strong>{answer.name}</strong>
                                                                        <span>
                                                                            {answer.answer_index === null || answer.answer_index === undefined
                                                                                ? "No answer"
                                                                                : `${choiceLabel(answer.answer_index)}. ${question.choices?.[answer.answer_index]}`}
                                                                        </span>
                                                                    </div>
                                                                    {showGameLayer && (
                                                                        <b className={answer.is_correct ? "is-correct" : "is-wrong"}>{answer.score} pts</b>
                                                                    )}
                                                                    {feedback && (
                                                                        <div className="quiz-history-ai">
                                                                            <strong>AI Feedback</strong>
                                                                            <p>{feedback.feedback}</p>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            );
                                                        })}
                                                </article>
                                            ))}
                                        </div>
                                    </section>
                                </>
                            )}

                            {selectedActivity.answers?.length > 0 && selectedActivity.activity_type !== "quiz" && selectedActivity.activity_type !== "individual" && (
                                <section className="activity-detail-section">
                                    <h2>Answers</h2>
                                    <div className="history-answer-list">
                                        {selectedActivity.answers.map((answer) => (
                                            <article key={answer.answer_id || answer.user_id || answer.question_id}>
                                                <div className="history-answer-author">
                                                    {showHistoryAvatars && <AvatarIcon path={answer.avatar_public_path} alt={answer.name} />}
                                                    <strong>{answer.name || "My Answer"}</strong>
                                                </div>
                                                <p>{answer.answer_text}</p>
                                            </article>
                                        ))}
                                    </div>
                                </section>
                            )}

                            {selectedActivity.combined_feedback && (
                                <section className="activity-detail-section">
                                    <h2>AI Feedback for Group</h2>
                                    <div className="history-feedback-grid">
                                        <article>
                                            <strong className="history-feedback-label history-feedback-label--www">What Went Well</strong>
                                            <p>{selectedActivity.combined_feedback.www}</p>
                                        </article>
                                        <article>
                                            <strong className="history-feedback-label history-feedback-label--ebi">Even Better If</strong>
                                            <p>{selectedActivity.combined_feedback.ebi}</p>
                                        </article>
                                    </div>
                                </section>
                            )}

                            {!selectedActivity.combined_feedback
                                && selectedActivity.activity_type !== "individual"
                                && selectedActivity.activity_type !== "quiz"
                                && selectedActivity.feedback_status === "error" && (
                                <section className="activity-detail-section">
                                    <h2>AI Feedback for Group</h2>
                                    <div className="history-feedback-retry">
                                        <strong>AI feedback belum berhasil dibuat.</strong>
                                        <p>{selectedActivity.feedback_error || "Jawaban sudah tersimpan. Coba ulang untuk membuat feedback group dan student."}</p>
                                        <button
                                            className="activity-modal__close history-feedback-retry__button"
                                            type="button"
                                            onClick={retryHistoryFeedback}
                                            disabled={retryingHistoryFeedback}
                                        >
                                            {retryingHistoryFeedback ? "Mencoba ulang..." : "Coba Ulang AI Feedback"}
                                        </button>
                                    </div>
                                </section>
                            )}

                            {selectedActivity.feedback_groups?.length > 0 && (
                                <section className="activity-detail-section">
                                    <h2>AI Feedback for Student</h2>
                                    <div className="history-student-feedback">
                                        {selectedActivity.feedback_groups.map((feedbackGroup) => (
                                            <article key={feedbackGroup.feedback_group_id}>
                                                <div className="history-student-feedback__students">
                                                    {(feedbackGroup.students?.length > 0
                                                        ? feedbackGroup.students
                                                        : (feedbackGroup.student_names || []).map((name) => ({name}))
                                                    ).map((student, index) => (
                                                        <span key={`${student.user_id || student.name}-${index}`}>
                                                            {showHistoryAvatars && student.avatar_public_path && (
                                                                <AvatarIcon path={student.avatar_public_path} alt={student.name} />
                                                            )}
                                                            <strong>{student.name}</strong>
                                                        </span>
                                                    ))}
                                                </div>
                                                <div className="history-feedback-grid">
                                                    <div>
                                                        <strong className="history-feedback-label history-feedback-label--www">What Went Well</strong>
                                                        <p>{feedbackGroup.www}</p>
                                                    </div>
                                                    <div>
                                                        <strong className="history-feedback-label history-feedback-label--ebi">Even Better If</strong>
                                                        <p>{feedbackGroup.ebi}</p>
                                                    </div>
                                                </div>
                                            </article>
                                        ))}
                                    </div>
                                </section>
                            )}

                            <section className="activity-detail-section">
                                <h2>Timeline</h2>
                                <div className="history-timeline">
                                    {selectedActivity.created_at && <span>Started {new Date(selectedActivity.created_at).toLocaleString()}</span>}
                                    {selectedActivity.submitted_at && <span>Submitted {new Date(selectedActivity.submitted_at).toLocaleString()}</span>}
                                    {(selectedActivity.logs || []).map((log, index) => (
                                        <span key={`${log.action_type}-${index}`}>
                                            {log.action_type} · {new Date(log.created_at).toLocaleTimeString([], {hour: "2-digit", minute: "2-digit"})}
                                        </span>
                                    ))}
                                </div>
                            </section>
                        </>
                    )}
                </section>
            </div>
        );
    };

    const renderMainMenu = () => (
        <main className="no-virtual-main" aria-label="No virtual space activity menu">
            <section className="no-virtual-hero">
                <h1>{course?.course_name || currentUser?.course_name || "Course Activity"}</h1>
                <p>Choose an activity from the menu and keep your progress dashboard visible while you work.</p>
            </section>

            <section className="no-virtual-menu" aria-label="Activity choices">
                {activityCards.map((card) => (
                    <button
                        type="button"
                        className={`no-virtual-card no-virtual-card--${card.id}`}
                        key={card.id}
                        onClick={() => setActiveActivity(card.id)}
                    >
                        <span>{card.label}</span>
                        <strong>{card.title}</strong>
                        <small>{card.description}</small>
                    </button>
                ))}
            </section>
        </main>
    );

    const renderActivity = () => {
        const activityType = typeof activeActivity === "string" ? activeActivity : activeActivity?.type;
        const restoredSearchParams = activeActivity && typeof activeActivity === "object"
            ? activeActivity.searchParams
            : null;
        const individualSearchParams = activityType === "individual"
            ? (restoredSearchParams || new URLSearchParams({
                object_id: noVirtualComputerObjectId(currentUserId),
            }).toString())
            : restoredSearchParams;
        const activityProps = {
            embedded: true,
            noVirtual: activityType === "group" || activityType === "quiz",
            activitySearchParams: individualSearchParams,
            exitOnBack: !!activeActivity,
            onBack: () => setActiveActivity(null),
        };

        if (activityType === "individual") return <IndividualActivityPage {...activityProps} />;
        if (activityType === "group") return <TableActivityPage {...activityProps} />;
        if (activityType === "quiz") return <QuizActivityPage {...activityProps} />;
        return renderMainMenu();
    };

    if (!currentUser) return <p style={{textAlign: "center"}}>Memuat ruang...</p>;

    return (
        <div className="no-virtual-shell">
            <section className="no-virtual-activity-panel">
                {renderActivity()}
            </section>

            <aside className="virtual-sidebar" aria-label="Activity dashboard">
                <UserHUD
                    currentUser={currentUser}
                    handleLogout={handleLogout}
                    summary={dashboard?.hud}
                    hideAvatar
                />

                <section className="side-panel dashboard-tabs-panel">
                    <div className="dashboard-tabs" role="tablist" aria-label="Dashboard sections">
                        {visibleTabs.map((tab) => (
                            <button
                                key={tab.id}
                                className={currentDashboardTab === tab.id ? "is-active" : ""}
                                type="button"
                                role="tab"
                                aria-selected={currentDashboardTab === tab.id}
                                onClick={() => setActiveDashboardTab(tab.id)}
                            >
                                {tab.label}
                            </button>
                        ))}
                    </div>

                    {currentDashboardTab === "leaderboard" && showGameLayer && (
                        <div className="dashboard-tab-panel leaderboard-panel">
                            <div className="side-panel__title">
                                <h2>Leaderboards</h2>
                                <span>Course</span>
                            </div>
                            {renderLeaderboards()}
                        </div>
                    )}

                    {currentDashboardTab === "individual" && (
                        <div className="dashboard-tab-panel">
                            <div className="side-panel__title">
                                <h2>Individual Activity</h2>
                                <span>{individualActivities.length}</span>
                            </div>
                            {renderActivityList(individualActivities, "No individual activities yet.")}
                        </div>
                    )}

                    {currentDashboardTab === "group" && (
                        <div className="dashboard-tab-panel">
                            <div className="side-panel__title">
                                <h2>Group Activity</h2>
                                <span>{groupCaseActivities.length}</span>
                            </div>
                            {renderActivityList(groupCaseActivities, "No group activities yet.")}
                        </div>
                    )}

                    {currentDashboardTab === "quiz" && (
                        <div className="dashboard-tab-panel">
                            <div className="side-panel__title">
                                <h2>Big Table Quiz</h2>
                                <span>{quizActivities.length}</span>
                            </div>
                            {renderActivityList(quizActivities, "No quiz activities yet.")}
                        </div>
                    )}
                </section>
            </aside>

            <ChatLauncher currentUser={currentUser}/>

            {renderHistoryModal()}
        </div>
    );
};

export default NoVirtualSpacePage;
