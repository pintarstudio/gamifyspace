import React, {useEffect, useMemo, useState} from "react";
import {useNavigate} from "react-router-dom";
import {apiGet, apiPost} from "../api/apiClient";
import AvatarIcon from "../components/AvatarIcon";
import ChatLauncher from "../components/ChatLauncher";
import UserHUD from "../components/UserHUD";
import IndividualActivityPage from "./IndividualActivityPage";
import TableActivityPage from "./TableActivityPage";
import QuizActivityPage from "./QuizActivityPage";
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
        title: "Competition Quiz",
        label: "Compete",
        description: "Host or join a live quiz match with a code from 101 to 150.",
    },
];

const choiceLabel = (index) => ["A", "B", "C", "D"][index] || String(index + 1);

const activityPrompt = (activity) => activity?.case_prompt || activity?.question_text || "Saved activity details are available below.";

const rankToneClass = (index) => {
    if (index === 0) return "course-leaderboard__rank--first";
    if (index === 1) return "course-leaderboard__rank--second";
    if (index === 2) return "course-leaderboard__rank--third";
    return index < 10 ? "course-leaderboard__rank--top-ten" : "";
};

const NoVirtualSpacePage = ({user, setLoggedIn, setUser}) => {
    const [currentUser, setCurrentUser] = useState(user);
    const [dashboard, setDashboard] = useState(null);
    const [course, setCourse] = useState(null);
    const [activeDashboardTab, setActiveDashboardTab] = useState(null);
    const [activeActivity, setActiveActivity] = useState(null);
    const [selectedActivity, setSelectedActivity] = useState(null);
    const [detailLoading, setDetailLoading] = useState(false);
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
    const groupLeaderboard = dashboard?.leaderboard || [];
    const quizLeaderboard = dashboard?.quiz_leaderboard || [];
    const individualActivities = dashboard?.individual_activities || [];
    const groupActivities = dashboard?.group_activities || [];

    const visibleTabs = useMemo(() => [
        ...(showGameLayer ? [{id: "leaderboard", label: "Leaderboard"}] : []),
        {id: "individual", label: "Individual Activity"},
        {id: "group", label: "Group Activity"},
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
        </div>
    );

    const renderActivityList = (activities, emptyText) => (
        <div className="activity-list">
            {activities.length > 0 ? activities.map((activity) => (
                <button
                    className="activity-card no-virtual-history-card"
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
                                    <h2>{selectedActivity.activity_type === "quiz" ? "Quiz" : "Activity"}</h2>
                                    <p>{activityPrompt(selectedActivity)}</p>
                                </section>

                                <section>
                                    <h2>{selectedActivity.activity_type === "individual" ? "Student" : "Members"}</h2>
                                    <div className="activity-member-list no-virtual-member-list">
                                        {(selectedActivity.members || []).map((member) => (
                                            <article key={member.user_id || member.name}>
                                                <div>
                                                    <strong>{member.name}</strong>
                                                    {showGameLayer && <span>{member.xp_earned || 0} XP</span>}
                                                </div>
                                            </article>
                                        ))}
                                    </div>
                                </section>
                            </div>

                            {selectedActivity.activity_type === "individual" && (
                                <section className="activity-detail-section">
                                    <h2>Result</h2>
                                    <div className="no-virtual-result-grid">
                                        <article>
                                            <strong>Score</strong>
                                            <span>{selectedActivity.results?.score_total ?? selectedActivity.results?.correct_count ?? 0}</span>
                                        </article>
                                        <article>
                                            <strong>Questions</strong>
                                            <span>{selectedActivity.results?.question_count || selectedActivity.questions?.length || 1}</span>
                                        </article>
                                    </div>
                                </section>
                            )}

                            {selectedActivity.activity_type === "quiz" && selectedActivity.results?.scoreboard?.length > 0 && (
                                <section className="activity-detail-section">
                                    <h2>Scoreboard</h2>
                                    <div className="quiz-history-scoreboard">
                                        {selectedActivity.results.scoreboard.map((item, index) => (
                                            <article className="no-virtual-score-row" key={item.user_id}>
                                                <div className="quiz-history-rank">{index + 1}</div>
                                                <div>
                                                    <strong>{item.name}</strong>
                                                    <span>{item.correct_count}/{item.question_count} correct</span>
                                                </div>
                                                <b>{item.total_score} pts</b>
                                            </article>
                                        ))}
                                    </div>
                                </section>
                            )}

                            {selectedActivity.answers?.length > 0 && selectedActivity.activity_type !== "quiz" && (
                                <section className="activity-detail-section">
                                    <h2>Answers</h2>
                                    <div className="history-answer-list">
                                        {selectedActivity.answers.map((answer) => (
                                            <article key={answer.answer_id || answer.user_id || answer.question_id}>
                                                <div className="history-answer-author">
                                                    <strong>{answer.name || "My Answer"}</strong>
                                                </div>
                                                <p>
                                                    {answer.answer_text
                                                        || (answer.answer_index !== undefined && answer.answer_index !== null
                                                            ? `${choiceLabel(answer.answer_index)}`
                                                            : "No answer")}
                                                </p>
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
                                    <h2>AI Feedback for Students</h2>
                                    <div className="history-student-feedback">
                                        {selectedActivity.feedback_groups.map((feedbackGroup) => (
                                            <article key={feedbackGroup.feedback_group_id}>
                                                <div className="history-student-feedback__students">
                                                    {(feedbackGroup.students?.length > 0
                                                        ? feedbackGroup.students
                                                        : (feedbackGroup.student_names || []).map((name) => ({name}))
                                                    ).map((student, index) => (
                                                        <span key={`${student.user_id || student.name}-${index}`}>
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
                <span>No Map Mode</span>
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
        const activityProps = {
            embedded: true,
            noVirtual: true,
            onBack: () => setActiveActivity(null),
        };

        if (activeActivity === "individual") return <IndividualActivityPage {...activityProps} />;
        if (activeActivity === "group") return <TableActivityPage {...activityProps} />;
        if (activeActivity === "quiz") return <QuizActivityPage {...activityProps} />;
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
                                <span>{groupActivities.length}</span>
                            </div>
                            {renderActivityList(groupActivities, "No group activities yet.")}
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
