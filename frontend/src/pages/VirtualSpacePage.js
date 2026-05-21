// src/pages/VirtualSpacePage.js
import React, {useEffect, useMemo, useState} from "react";
import {useNavigate} from "react-router-dom";
import {apiGet, apiPost} from "../api/apiClient";
import AvatarIcon from "../components/AvatarIcon";
import ChatLauncher from "../components/ChatLauncher";
import VirtualSpacePixi from "../components/VirtualSpacePixi";
import UserHUD from "../components/UserHUD";
import "./VirtualSpacePage.css";

const choiceLabel = (index) => ["A", "B", "C", "D"][index] || String(index + 1);

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

const VirtualSpacePage = ({ user, setLoggedIn, setUser }) => {
    const [currentUser, setCurrentUser] = useState(user);
    const [dashboard, setDashboard] = useState(null);
    const [selectedActivity, setSelectedActivity] = useState(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [activeDashboardTab, setActiveDashboardTab] = useState(null);
    const [expandedLeaderboardGroups, setExpandedLeaderboardGroups] = useState({});
    const navigate = useNavigate();

    useEffect(() => {
        if (!user) {
            apiGet("/session").then((res) => {
                if (res.loggedIn) {
                    setCurrentUser(res.user);
                    setUser(res.user);
                }
                else navigate("/");
            });
        } else {
            setCurrentUser(user);
        }
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

    const handleLogout = async () => {
        // kirim event ke server agar broadcast "user_left"
        if (window.socket) {
            window.socket.emit("logout");
            console.log("📤 Logout event emitted to server");
        }

        // logout dari API session
        const res = await apiPost("/logout", {});
        if (res.message === "Logout berhasil") {
            const wasStudentAccess = localStorage.getItem("studentAccessLogin") === "1";
            setLoggedIn(false);
            setUser(null);
            localStorage.clear(); // ✅ clear saved room or session data

            // beri sedikit jeda agar server sempat broadcast event
            setTimeout(() => {
                if (window.socket) window.socket.disconnect();
                navigate(wasStudentAccess ? "/?loggedout=student" : "/");
            }, 300);
        } else {
            alert("Gagal logout. Coba lagi.");
        }
    };

    const pixiUser = useMemo(() => ({
        user_id: currentUser?.user_id,
        id: currentUser?.id,
        avatar_public_path: currentUser?.avatar_public_path,
        avatar: currentUser?.avatar,
        name: currentUser?.name,
        email: currentUser?.email,
        course_id: currentUser?.course_id,
        room: currentUser?.room,
    }), [
        currentUser?.user_id,
        currentUser?.id,
        currentUser?.avatar_public_path,
        currentUser?.avatar,
        currentUser?.name,
        currentUser?.email,
        currentUser?.course_id,
        currentUser?.room,
    ]);

    if (!currentUser) return <p style={{textAlign: "center"}}>Memuat ruang...</p>;

    const openActivity = async (activity) => {
        setDetailLoading(true);
        const data = await apiGet(`/virtualspace/activities/${activity.activity_key || activity.session_id}`);
        setSelectedActivity(data.activity || null);
        setDetailLoading(false);
    };
    const showGameLayer = !!currentUser.gamification_enabled;
    const groupLeaderboard = dashboard?.leaderboard || [];
    const quizLeaderboard = dashboard?.quiz_leaderboard || [];
    const individualActivities = dashboard?.individual_activities || [];
    const groupActivities = dashboard?.group_activities || [];
    const visibleTabs = [
        ...(showGameLayer ? [{id: "leaderboard", label: "Leaderboard"}] : []),
        {id: "individual", label: "Individual Activity"},
        {id: "group", label: "Group Activity"},
    ];
    const currentDashboardTab = activeDashboardTab && visibleTabs.some((tab) => tab.id === activeDashboardTab)
        ? activeDashboardTab
        : (showGameLayer ? "leaderboard" : "individual");

    const renderActivityList = (activities, emptyText) => (
        <div className="activity-list">
            {activities.length > 0 ? (
                activities.map((activity) => (
                    <button
                        className="activity-card"
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
                                    : `${activity.group_xp || 0} group XP`}
                            </small>
                        )}
                    </button>
                ))
            ) : (
                <p className="panel-empty">{emptyText}</p>
            )}
        </div>
    );

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
                    {groupLeaderboard.length > 0 ? (
                        groupLeaderboard.map((item, index) => (
                            <article className="course-leaderboard__group" key={item.course_group_id}>
                                <button
                                    className="course-leaderboard__row course-leaderboard__row--button"
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
                                                    <AvatarIcon path={student.avatar_public_path} alt={student.name} />
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
                        ))
                    ) : (
                        <p className="panel-empty">No XP records yet.</p>
                    )}
                </div>
            </div>

            <div className="leaderboard-block">
                <div className="leaderboard-block__title">
                    <h3>Quiz Score Leaderboard</h3>
                    <span>Points</span>
                </div>
                <div className="course-leaderboard course-leaderboard--compact course-leaderboard--quiz">
                    {quizLeaderboard.length > 0 ? (
                        quizLeaderboard.map((item, index) => (
                            <article className="course-leaderboard__row" key={item.user_id}>
                                <div className={`course-leaderboard__rank course-leaderboard__rank--quiz ${rankToneClass(index)}`}>
                                    {index + 1}
                                </div>
                                <AvatarIcon path={item.avatar_public_path} alt={item.name} />
                                <div>
                                    <strong>{item.name}</strong>
                                    <span>{item.quizzes_count} quizzes</span>
                                </div>
                                <b>{item.total_quiz_score} pts</b>
                            </article>
                        ))
                    ) : (
                        <p className="panel-empty">No quiz scores yet.</p>
                    )}
                </div>
            </div>
        </div>
    );

    return (
        <div className="virtual-shell">
            <main className="virtual-map-panel" aria-label="Virtual space map">
                <VirtualSpacePixi user={pixiUser} />
            </main>

            <aside className="virtual-sidebar" aria-label="Activity dashboard">
                <UserHUD
                    currentUser={currentUser}
                    handleLogout={handleLogout}
                    summary={dashboard?.hud}
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
                                <span>{groupActivities.length}</span>
                            </div>
                            {renderActivityList(groupActivities, "No group activities yet.")}
                        </div>
                    )}
                </section>
            </aside>

            <ChatLauncher currentUser={currentUser}/>

            {(selectedActivity || detailLoading) && (
                <div className="activity-modal" role="dialog" aria-modal="true">
                    <div className="activity-modal__backdrop" onClick={() => setSelectedActivity(null)} />
                    <section className="activity-modal__content">
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
                                        <p>{selectedActivity.case_prompt}</p>
                                    </section>

                                    <section>
                                        <h2>{selectedActivity.activity_type === "individual" ? "Student" : "Group"}</h2>
                                        <div className="activity-member-list">
                                            {selectedActivity.members.map((member) => (
                                                <article key={member.user_id}>
                                                    <AvatarIcon path={member.avatar_public_path} alt={member.name} />
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

                                {selectedActivity.activity_type === "individual" ? (
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
                                        </section>

                                        {selectedActivity.question_kind === "case_study" ? (
                                            <section className="activity-detail-section">
                                                <h2>AI Feedback</h2>
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
                                                <div className="individual-history-review">
                                                    {(selectedActivity.questions || []).map((question, index) => {
                                                        const answer = (selectedActivity.answers || [])
                                                            .find((item) => String(item.question_id) === String(question.question_id));
                                                        const feedback = answer ? individualAnswerFeedback(selectedActivity, answer) : null;
                                                        const showIndividualXp = showGameLayer && selectedActivity.individual_activity_type === "exercise";
                                                        const showAssessmentScore = selectedActivity.individual_activity_type === "pre_test"
                                                            || selectedActivity.individual_activity_type === "post_test";
                                                        return (
                                                            <article key={question.question_id}>
                                                                <div className="quiz-history-question">
                                                                    <span>Question {index + 1}</span>
                                                                    <strong>{question.question_text}</strong>
                                                                    <p>Correct: {choiceLabel(question.correct_answer_index)}. {question.choices?.[question.correct_answer_index]}</p>
                                                                </div>
                                                                <div className="individual-history-answer">
                                                                    <b className={answer?.is_correct ? "is-correct" : "is-wrong"}>
                                                                        {answer?.is_correct ? "Correct" : "Wrong"}
                                                                    </b>
                                                                    <span>
                                                                        Your answer: {answer?.answer_index === null || answer?.answer_index === undefined
                                                                            ? "No answer"
                                                                            : `${choiceLabel(answer.answer_index)}. ${question.choices?.[answer.answer_index] || ""}`}
                                                                    </span>
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
                                ) : selectedActivity.activity_type === "quiz" ? (
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
                                                        <article key={item.user_id}>
                                                            <div className="quiz-history-rank">{index + 1}</div>
                                                            <AvatarIcon path={item.avatar_public_path} alt={item.name} />
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
                                                            .map((answer) => (
                                                                <div
                                                                    className={`quiz-history-answer${showGameLayer ? "" : " quiz-history-answer--no-score"}`}
                                                                    key={answer.answer_id}
                                                                >
                                                                    <AvatarIcon path={answer.avatar_public_path} alt={answer.name} />
                                                                    <div>
                                                                        <strong>{answer.name}</strong>
                                                                        <span>
                                                                            {answer.answer_index === null
                                                                                ? "No answer"
                                                                            : `${choiceLabel(answer.answer_index)}. ${question.choices?.[answer.answer_index]}`}
                                                                        </span>
                                                                    </div>
                                                                    {showGameLayer && (
                                                                        <b className={answer.is_correct ? "is-correct" : "is-wrong"}>{answer.score} pts</b>
                                                                    )}
                                                                    {quizAnswerFeedback(selectedActivity, answer, question) && (
                                                                        <div className="quiz-history-ai">
                                                                            <strong>AI Feedback</strong>
                                                                            <p>{quizAnswerFeedback(selectedActivity, answer, question).feedback}</p>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            ))}
                                                    </article>
                                                ))}
                                            </div>
                                        </section>
                                    </>
                                ) : (
                                    <section className="activity-detail-section">
                                        <h2>Answers</h2>
                                        <div className="history-answer-list">
                                            {selectedActivity.answers.map((answer) => (
                                                <article key={answer.user_id}>
                                                    <div className="history-answer-author">
                                                        <AvatarIcon path={answer.avatar_public_path} alt={answer.name} />
                                                        <strong>{answer.name}</strong>
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
                                                                {student.avatar_public_path && (
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
                                        <span>Started {new Date(selectedActivity.created_at).toLocaleString()}</span>
                                        {selectedActivity.submitted_at && (
                                            <span>Submitted {new Date(selectedActivity.submitted_at).toLocaleString()}</span>
                                        )}
                                        {selectedActivity.logs.map((log, index) => (
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
            )}
        </div>
    );
};

export default VirtualSpacePage;
