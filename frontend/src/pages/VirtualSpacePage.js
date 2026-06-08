// src/pages/VirtualSpacePage.js
import React, {useCallback, useEffect, useMemo, useState} from "react";
import {useNavigate} from "react-router-dom";
import {apiGet, apiPost} from "../api/apiClient";
import ActivityBaselineCard from "../components/ActivityBaselineCard";
import ActivityHistoryList from "../components/ActivityHistoryList";
import AvatarIcon from "../components/AvatarIcon";
import ChatLauncher from "../components/ChatLauncher";
import DashboardTabIcon from "../components/DashboardTabIcon";
import TopicProgressCard from "../components/TopicProgressCard";
import VirtualSpacePixi from "../components/VirtualSpacePixi";
import UserHUD from "../components/UserHUD";
import IndividualActivityPage from "./IndividualActivityPage";
import TableActivityPage from "./TableActivityPage";
import QuizActivityPage from "./QuizActivityPage";
import {ACTIVITY_STATUS, clearActivityStatus, isActivityStatusActive, setActivityStatus} from "../utils/activityStatus";
import {getActivityRecovery} from "../utils/activityRecovery";
import socket from "../utils/socketClient";
import "./VirtualSpacePage.css";

const VIRTUALSPACE_TUTORIAL_KEY = "gamifyit:virtualspace:tutorial:v1";

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

const dashboardTabCopy = {
    leaderboard: "Lihat peringkat XP group, skor quiz, dan progres individual di kelas.",
    individual: "Riwayat latihan individual, pre-test, post-test, dan case study kamu ada di sini.",
    group: "Riwayat diskusi group dan feedback case study tersimpan di sini.",
    quiz: "Riwayat pertandingan quiz, skor, dan hasil menang/kalah dapat dicek di sini.",
};

const rankToneClass = (index) => {
    if (index === 0) return "course-leaderboard__rank--first";
    if (index === 1) return "course-leaderboard__rank--second";
    if (index === 2) return "course-leaderboard__rank--third";
    return index < 10 ? "course-leaderboard__rank--top-ten" : "";
};

const formatMonitorTime = (dateValue) => {
    if (!dateValue) return "";
    return new Intl.DateTimeFormat("en", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
    }).format(new Date(dateValue));
};

const formatSeconds = (value) => {
    const total = Math.max(0, Number(value || 0));
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
};

function historySessionId(activity) {
    return String(activity?.session_id || activity?.activity_key || "")
        .replace(/^(individual|quiz|table)-/, "")
        .replace(/^group_discussion[:-]/, "")
        .replace(/^(individual_exercise|individual_pre_test|individual_post_test|quiz):/, "");
}

const VirtualSpacePage = ({ user, setLoggedIn, setUser }) => {
    const [currentUser, setCurrentUser] = useState(user);
    const [dashboard, setDashboard] = useState(null);
    const [instructorDashboard, setInstructorDashboard] = useState(null);
    const [selectedActivity, setSelectedActivity] = useState(null);
    const [activeMapActivity, setActiveMapActivity] = useState(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [retryingHistoryFeedback, setRetryingHistoryFeedback] = useState(false);
    const [activeDashboardTab, setActiveDashboardTab] = useState(null);
    const [selectedDashboardTopicId, setSelectedDashboardTopicId] = useState("");
    const [expandedLeaderboardGroups, setExpandedLeaderboardGroups] = useState({});
    const [showOrientationTutorial, setShowOrientationTutorial] = useState(false);
    const [orientationTutorialStep, setOrientationTutorialStep] = useState(0);
    const navigate = useNavigate();
    const isInstructor = String(currentUser?.role_name || "").toLowerCase() === "instructor"
        || String(currentUser?.role_id || "") === "2";
    const currentUserCourseId = currentUser?.course_id;
    const currentUserId = currentUser?.user_id;

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
        if (!currentUser || isInstructor) return undefined;

        let active = true;
        const loadDashboard = () => {
            const query = selectedDashboardTopicId ? `?topic_id=${encodeURIComponent(selectedDashboardTopicId)}` : "";
            apiGet(`/virtualspace/dashboard${query}`).then((data) => {
                if (!active) return;
                setDashboard(data);
                if (!selectedDashboardTopicId && data.active_topic?.topic_id) {
                    setSelectedDashboardTopicId(String(data.active_topic.topic_id));
                }
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
    }, [currentUser?.user_id, isInstructor, selectedDashboardTopicId]);

    useEffect(() => {
        if (!currentUser || isInstructor) return;
        if (localStorage.getItem(VIRTUALSPACE_TUTORIAL_KEY) !== "1") {
            setShowOrientationTutorial(true);
        }
    }, [currentUser, isInstructor]);

    useEffect(() => {
        if (!currentUserId || !isInstructor) return undefined;

        let active = true;
        let refreshTimeoutId = null;
        const loadInstructorDashboard = () => {
            apiGet("/instructor/dashboard").then((data) => {
                if (!active) return;
                setInstructorDashboard(data);
            }).catch((error) => {
                console.error("Unable to load instructor dashboard:", error);
            });
        };
        const scheduleDashboardRefresh = () => {
            if (refreshTimeoutId) window.clearTimeout(refreshTimeoutId);
            refreshTimeoutId = window.setTimeout(loadInstructorDashboard, 150);
        };
        const joinMonitor = () => {
            if (currentUserCourseId) {
                socket.emit("instructor:monitor:join", {course_id: currentUserCourseId});
            }
        };
        const handleSocketConnect = () => {
            joinMonitor();
            loadInstructorDashboard();
        };

        loadInstructorDashboard();
        joinMonitor();
        socket.on("connect", handleSocketConnect);
        socket.on("instructor:monitor:update", scheduleDashboardRefresh);

        return () => {
            active = false;
            if (refreshTimeoutId) window.clearTimeout(refreshTimeoutId);
            if (currentUserCourseId) {
                socket.emit("instructor:monitor:leave", {course_id: currentUserCourseId});
            }
            socket.off("connect", handleSocketConnect);
            socket.off("instructor:monitor:update", scheduleDashboardRefresh);
        };
    }, [currentUserCourseId, currentUserId, isInstructor]);

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
            const tutorialSeen = localStorage.getItem(VIRTUALSPACE_TUTORIAL_KEY) === "1";
            setLoggedIn(false);
            setUser(null);
            localStorage.clear(); // ✅ clear saved room or session data
            if (tutorialSeen) localStorage.setItem(VIRTUALSPACE_TUTORIAL_KEY, "1");

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

    const openOrientationTutorial = useCallback(() => {
        setOrientationTutorialStep(0);
        setShowOrientationTutorial(true);
    }, []);

    const closeOrientationTutorial = useCallback(() => {
        localStorage.setItem(VIRTUALSPACE_TUTORIAL_KEY, "1");
        setOrientationTutorialStep(0);
        setShowOrientationTutorial(false);
    }, []);

    const openActivity = async (activity) => {
        setDetailLoading(true);
        const data = await apiGet(`/virtualspace/activities/${activity.activity_key || activity.session_id}`);
        setSelectedActivity(data.activity || null);
        setDetailLoading(false);
    };

    const retryHistoryFeedback = async () => {
        if (!selectedActivity || retryingHistoryFeedback) return;
        const rawSessionId = String(selectedActivity.session_id || selectedActivity.activity_key || "");
        const numericSessionId = historySessionId(selectedActivity);
        const endpoint = selectedActivity.activity_type === "individual"
            ? `/individual/sessions/${numericSessionId}/retry-feedback`
            : selectedActivity.activity_type === "quiz"
                ? `/quiz/sessions/${numericSessionId}/retry-feedback`
                : `/table/sessions/${numericSessionId}/retry-feedback`;

        setRetryingHistoryFeedback(true);
        try {
            const data = await apiPost(endpoint, {});
            await openActivity({activity_key: rawSessionId});
            if (data.session?.feedback_status === "error") {
                alert(data.session.feedback_error || data.message || "Feedback AI masih gagal dibuat.");
            } else if (data.message) {
                alert(data.message);
            }
        } catch (error) {
            alert(error.message || "Gagal mencoba ulang AI feedback.");
        } finally {
            setRetryingHistoryFeedback(false);
        }
    };

    const buildActivityLaunchFromStatus = useCallback((status) => {
        if (!isActivityStatusActive(status)) return null;

        if (["individual_exercise", "individual_pre_test", "individual_post_test"].includes(status.type)) {
            const objectId = status.object_id || "computer";
            const searchParams = new URLSearchParams({object_id: objectId});
            const sessionId = String(status.activity_key || "").split(":").pop();
            if (sessionId && sessionId !== "pending") searchParams.set("session_id", sessionId);
            return {
                key: status.activity_key || `${status.type}:${objectId}`,
                objectName: status.object_name || "computer",
                objectId,
                activityType: "individual",
                searchParams: searchParams.toString(),
                restored: true,
            };
        }

        if (status.type === "quiz") {
            const tableId = status.table_id || status.group_id || status.object_id || "1";
            const groupId = status.group_id || tableId;
            const searchParams = new URLSearchParams({
                table_id: String(tableId),
                group_id: String(groupId),
            });
            const sessionId = String(status.activity_key || "").split(":").pop();
            if (sessionId && sessionId !== "pending") searchParams.set("session_id", sessionId);
            if (status.object_id) searchParams.set("object_id", status.object_id);
            return {
                key: status.activity_key || `quiz:${tableId}`,
                objectName: status.object_name || "bigtable",
                objectId: status.object_id || tableId,
                groupId,
                tableId,
                activityType: "quiz",
                searchParams: searchParams.toString(),
                restored: true,
            };
        }

        if (status.type === "group_discussion") {
            const groupId = status.group_id || status.object_id || "1";
            const searchParams = new URLSearchParams({group_id: String(groupId)});
            if (status.object_id) searchParams.set("object_id", status.object_id);
            return {
                key: status.activity_key || `group_discussion:${groupId}`,
                objectName: status.object_name || "table",
                objectId: status.object_id || groupId,
                groupId,
                activityType: "table",
                searchParams: searchParams.toString(),
                restored: true,
            };
        }

        return null;
    }, []);

    const buildActivityLaunchFromRecovery = useCallback((recovery) => {
        if (!recovery?.type || !recovery?.session_id) return null;
        if (recovery.type === "individual") {
            const objectId = recovery.object_id || "computer";
            const searchParams = new URLSearchParams({
                object_id: String(objectId),
                session_id: String(recovery.session_id),
            });
            return {
                key: `individual-recovery:${recovery.session_id}`,
                objectName: "computer",
                objectId,
                activityType: "individual",
                searchParams: searchParams.toString(),
                restored: true,
            };
        }
        if (recovery.type === "quiz") {
            const tableId = recovery.table_id || recovery.group_id || recovery.object_id || "1";
            const groupId = recovery.group_id || tableId;
            const searchParams = new URLSearchParams({
                table_id: String(tableId),
                group_id: String(groupId),
                session_id: String(recovery.session_id),
            });
            if (recovery.object_id) searchParams.set("object_id", recovery.object_id);
            return {
                key: `quiz-recovery:${recovery.session_id}`,
                objectName: "bigtable",
                objectId: recovery.object_id || tableId,
                groupId,
                tableId,
                activityType: "quiz",
                searchParams: searchParams.toString(),
                restored: true,
            };
        }
        return null;
    }, []);

    useEffect(() => {
        if (!currentUser || isInstructor || activeMapActivity) return undefined;

        let active = true;
        apiGet("/activity-status/current").then((data) => {
            if (!active || activeMapActivity) return;
            const launch = buildActivityLaunchFromStatus(data.status);
            if (launch) {
                setActiveMapActivity(launch);
                return;
            }
            const recoveryLaunch = buildActivityLaunchFromRecovery(getActivityRecovery(currentUser));
            if (recoveryLaunch) setActiveMapActivity(recoveryLaunch);
        }).catch(() => {});

        return () => {
            active = false;
        };
    }, [activeMapActivity, buildActivityLaunchFromRecovery, buildActivityLaunchFromStatus, currentUser, isInstructor]);

    const openMapActivity = useCallback((launch) => {
        if (activeMapActivity) return false;

        try {
            const url = new URL(launch.url, window.location.origin);
            const path = url.pathname.replace(/\/$/, "");
            const activityTypeByPath = {
                "/individual": "individual",
                "/table": "table",
                "/quiz": "quiz",
            };
            const activityType = activityTypeByPath[path];
            if (!activityType) return false;

            const pendingStatus = activityType === "table"
                ? ACTIVITY_STATUS.group_discussion
                : activityType === "quiz" ? ACTIVITY_STATUS.quiz : null;
            const pendingGroupKey = launch.groupId || url.searchParams.get("group_id") || launch.objectId || "map";
            const pendingActivityKey = pendingStatus ? `${pendingStatus.type}:pending:${pendingGroupKey}` : null;

            setActiveMapActivity({
                ...launch,
                activityType,
                pendingActivityKey,
                searchParams: url.searchParams.toString(),
            });

            if (pendingStatus && currentUser) {
                setActivityStatus({
                    user: currentUser,
                    status: pendingStatus,
                    activityKey: pendingActivityKey,
                    metadata: {
                        object_id: launch.objectId,
                        object_name: launch.objectName,
                        group_id: launch.groupId,
                        table_id: launch.tableId,
                    },
                    isPending: true,
                });
            }
            return true;
        } catch (error) {
            console.error("Unable to open activity in modal:", error);
            return false;
        }
    }, [activeMapActivity, currentUser]);

    const closeMapActivity = useCallback(() => {
        setActiveMapActivity((current) => {
            if (current?.pendingActivityKey && currentUser) {
                clearActivityStatus({
                    user: currentUser,
                    activityKey: current.pendingActivityKey,
                });
            }
            return null;
        });
    }, [currentUser]);

    const renderMapActivity = () => {
        if (!activeMapActivity) return null;

        const activityProps = {
            embedded: true,
            activitySearchParams: activeMapActivity.searchParams,
            exitOnBack: true,
            onBack: closeMapActivity,
        };

        if (activeMapActivity.activityType === "individual") {
            return <IndividualActivityPage {...activityProps} />;
        }
        if (activeMapActivity.activityType === "table") {
            return <TableActivityPage {...activityProps} />;
        }
        if (activeMapActivity.activityType === "quiz") {
            return <QuizActivityPage {...activityProps} />;
        }
        return null;
    };

    if (!currentUser) return <p style={{textAlign: "center"}}>Memuat ruang...</p>;
    const showGameLayer = !!currentUser.gamification_enabled;
    const groupLeaderboard = dashboard?.leaderboard || [];
    const quizLeaderboard = dashboard?.quiz_leaderboard || [];
    const individualLeaderboard = dashboard?.individual_leaderboard || [];
    const individualActivities = dashboard?.individual_activities || [];
    const sortedIndividualActivities = [...individualActivities].sort((a, b) => {
        const rank = (activity) => {
            if (activity.individual_activity_type === "pre_test") return 0;
            if (activity.individual_activity_type === "post_test") return 1;
            return 2;
        };
        const rankDiff = rank(a) - rank(b);
        if (rankDiff !== 0) return rankDiff;
        return new Date(b.submitted_at || 0) - new Date(a.submitted_at || 0);
    });
    const groupActivities = dashboard?.group_activities || [];
    const groupCaseActivities = groupActivities.filter((activity) => activity.activity_type !== "quiz");
    const quizActivities = dashboard?.quiz_activities || groupActivities.filter((activity) => activity.activity_type === "quiz");
    const activeDashboardTopic = dashboard?.active_topic || null;
    const dashboardTopics = dashboard?.dashboard_topics || [];
    const visibleTabs = [
        ...(showGameLayer ? [{id: "leaderboard", label: "Leaderboard", caption: "Peringkat"}] : []),
        {id: "individual", label: "Individual", caption: "Riwayat pribadi"},
        {id: "group", label: "Group", caption: "Riwayat kolaborasi"},
        {id: "quiz", label: "Quiz", caption: "Riwayat skor"},
    ];
    const currentDashboardTab = activeDashboardTab && visibleTabs.some((tab) => tab.id === activeDashboardTab)
        ? activeDashboardTab
        : (showGameLayer ? "leaderboard" : "individual");
    const dashboardHistoryIntro = showGameLayer
        ? "Data di bawah hanya berlaku untuk topik yang sedang dipilih. Buka tab untuk melihat leaderboard dan riwayat aktivitas pada topik ini."
        : "Data di bawah hanya berlaku untuk topik yang sedang dipilih. Buka tab untuk melihat riwayat aktivitas pada topik ini.";
    const instructorMonitor = instructorDashboard?.monitor || {};
    const instructorSummary = instructorMonitor.summary || instructorDashboard?.summary || {};
    const instructorGroups = instructorMonitor.groups || instructorDashboard?.groups || [];
    const instructorStudents = instructorMonitor.students || instructorDashboard?.students || [];
    const activeInstructorStudents = instructorStudents.filter((student) => student.status === "active");
    const individualActivityStudents = activeInstructorStudents.filter((student) =>
        ["individual", "individual_exercise", "individual_pre_test", "individual_post_test"].includes(student.activity?.type)
    );
    const groupActivityStudents = activeInstructorStudents.filter((student) =>
        ["table", "group_discussion"].includes(student.activity?.type)
    );
    const quizActivityStudents = activeInstructorStudents.filter((student) => student.activity?.type === "quiz");
    const idleInstructorStudents = instructorStudents.filter((student) => student.status === "idle");
    const offlineInstructorStudents = instructorStudents.filter((student) => student.status === "offline");

    const renderInstructorStudentRows = (students) => (
        <div className="instructor-student-list">
            {students.length > 0 ? (
                students.map((student) => (
                    <article
                        className={`instructor-student-row ${student.virtual_space_enabled === false ? "instructor-student-row--no-avatar" : ""}`}
                        key={student.user_id}
                    >
                        {student.virtual_space_enabled !== false && (
                            <AvatarIcon path={student.avatar_public_path} alt={student.name} />
                        )}
                        <div className="instructor-student-row__main">
                            <strong>{student.name}</strong>
                            <span>{student.course_group_name || "No group"} · {student.room || "No room"}</span>
                            <small>
                                {student.activity_label || "Idle"}
                                {student.activity?.detail ? ` · ${student.activity.detail}` : ""}
                            </small>
                        </div>
                        <span className={`instructor-status instructor-status--${student.status}`}>
                            {student.status}
                        </span>
                    </article>
                ))
            ) : (
                <p className="panel-empty">No students here yet.</p>
            )}
        </div>
    );

    const renderInstructorDashboard = () => (
        <section className="side-panel instructor-dashboard-panel">
            <div className="instructor-dashboard-header">
                <div>
                    <h2>Instructor Monitor</h2>
                    <span>{instructorDashboard?.course?.course_name || currentUser?.course_name || "Course"}</span>
                </div>
                <small>{instructorDashboard?.generated_at ? `Updated ${formatMonitorTime(instructorDashboard.generated_at)}` : "Loading..."}</small>
            </div>

            <div className="instructor-summary-grid">
                <article>
                    <strong>{instructorSummary.total_students || 0}</strong>
                    <span>Students</span>
                </article>
                <article>
                    <strong>{instructorSummary.online_students || 0}</strong>
                    <span>Online</span>
                </article>
                <article>
                    <strong>{instructorSummary.active_students || 0}</strong>
                    <span>Active</span>
                </article>
                <article>
                    <strong>{instructorSummary.idle_students || 0}</strong>
                    <span>Idle</span>
                </article>
            </div>

            <section className="instructor-monitor-section">
                <div className="side-panel__title">
                    <h2>Groups</h2>
                    <span>{instructorSummary.active_sessions || 0} live</span>
                </div>
                <div className="instructor-group-grid">
                    {instructorGroups.length > 0 ? (
                        instructorGroups.map((group) => (
                            <article className="instructor-group-card" key={group.course_group_id}>
                                <div>
                                    <strong>Group {group.group_name}</strong>
                                    <span>{group.student_count || 0} students</span>
                                </div>
                                <dl>
                                    <div><dt>Online</dt><dd>{group.online_count || 0}</dd></div>
                                    <div><dt>Active</dt><dd>{group.active_count || 0}</dd></div>
                                    <div><dt>Idle</dt><dd>{group.idle_count || 0}</dd></div>
                                    <div><dt>Sessions</dt><dd>{group.active_sessions_count || 0}</dd></div>
                                </dl>
                                <small>
                                    {group.virtual_space_enabled ? "Virtualspace on" : "No virtualspace"}
                                    {" · "}
                                    {group.gamification_enabled ? "Gamification on" : "Gamification off"}
                                </small>
                            </article>
                        ))
                    ) : (
                        <p className="panel-empty">No course groups configured.</p>
                    )}
                </div>
            </section>

            <section className="instructor-monitor-section">
                <div className="side-panel__title">
                    <h2>Individual Activity</h2>
                    <span>{individualActivityStudents.length}</span>
                </div>
                {renderInstructorStudentRows(individualActivityStudents)}
            </section>

            <section className="instructor-monitor-section">
                <div className="side-panel__title">
                    <h2>Group Activity</h2>
                    <span>{groupActivityStudents.length}</span>
                </div>
                {renderInstructorStudentRows(groupActivityStudents)}
            </section>

            <section className="instructor-monitor-section">
                <div className="side-panel__title">
                    <h2>Quiz Activity</h2>
                    <span>{quizActivityStudents.length}</span>
                </div>
                {renderInstructorStudentRows(quizActivityStudents)}
            </section>

            <section className="instructor-monitor-section">
                <div className="side-panel__title">
                    <h2>Online Idle</h2>
                    <span>{idleInstructorStudents.length}</span>
                </div>
                {renderInstructorStudentRows(idleInstructorStudents)}
            </section>

            <section className="instructor-monitor-section">
                <div className="side-panel__title">
                    <h2>Offline</h2>
                    <span>{offlineInstructorStudents.length}</span>
                </div>
                {renderInstructorStudentRows(offlineInstructorStudents)}
            </section>

        </section>
    );

    const renderActivityList = (activities, emptyText) => (
        <ActivityHistoryList
            activities={activities}
            emptyText={emptyText}
            showGameLayer={showGameLayer}
            onOpen={openActivity}
        />
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
                                    <span>{item.group_name || "No group"} · {item.quizzes_count} quizzes</span>
                                </div>
                                <b>{item.total_quiz_score} pts</b>
                            </article>
                        ))
                    ) : (
                        <p className="panel-empty">No quiz scores yet.</p>
                    )}
                </div>
            </div>

            <div className="leaderboard-block">
                <div className="leaderboard-block__title">
                    <h3>Individual XP Leaderboard</h3>
                    <span>Level</span>
                </div>
                <div className="course-leaderboard course-leaderboard--compact course-leaderboard--individual">
                    {individualLeaderboard.length > 0 ? (
                        individualLeaderboard.map((item, index) => (
                            <article className="course-leaderboard__row" key={item.user_id}>
                                <div className={`course-leaderboard__rank course-leaderboard__rank--individual ${rankToneClass(index)}`}>
                                    {index + 1}
                                </div>
                                <AvatarIcon path={item.avatar_public_path} alt={item.name} />
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
                        ))
                    ) : (
                        <p className="panel-empty">No individual XP records yet.</p>
                    )}
                </div>
            </div>
        </div>
    );

    return (
        <div className="virtual-shell">
            <main className="virtual-map-panel" aria-label="Virtual space map">
                <VirtualSpacePixi
                    user={pixiUser}
                    onOpenActivity={openMapActivity}
                    activityPanelOpen={!!activeMapActivity}
                />
            </main>

            <aside className="virtual-sidebar" aria-label="Activity dashboard">
                {!isInstructor && (
                    <TopicProgressCard
                        activeTopic={activeDashboardTopic}
                        topics={dashboardTopics}
                        selectedTopicId={selectedDashboardTopicId}
                        onChange={setSelectedDashboardTopicId}
                        courseName={currentUser.course_name || "Course"}
                    />
                )}
                <UserHUD
                    currentUser={currentUser}
                    handleLogout={handleLogout}
                    summary={dashboard?.hud}
                    onOpenHelp={isInstructor ? null : openOrientationTutorial}
                />

                {isInstructor ? renderInstructorDashboard() : (
                <section className="side-panel dashboard-tabs-panel">
                    <div className="dashboard-history-note">
                        <strong>Riwayat aktivitas kamu</strong>
                        <span>{dashboardHistoryIntro}</span>
                    </div>
                    <ActivityBaselineCard
                        individualActivities={individualActivities}
                        groupActivities={groupCaseActivities}
                        quizActivities={quizActivities}
                    />
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
                                <span className="dashboard-tab-icon">
                                    <DashboardTabIcon type={tab.id} />
                                </span>
                                <span className="dashboard-tab-text">
                                    <strong>{tab.label}</strong>
                                    <small>{tab.caption}</small>
                                </span>
                            </button>
                        ))}
                    </div>

                    {currentDashboardTab === "leaderboard" && showGameLayer && (
                        <div className="dashboard-tab-panel leaderboard-panel">
                            <div className="side-panel__title">
                                <h2>Leaderboards</h2>
                                <span>Course</span>
                            </div>
                            <p className="dashboard-tab-copy">{dashboardTabCopy.leaderboard}</p>
                            {renderLeaderboards()}
                        </div>
                    )}

                    {currentDashboardTab === "individual" && (
                        <div className="dashboard-tab-panel">
                            <div className="side-panel__title">
                                <h2>Individual Activity</h2>
                                <span>{individualActivities.length}</span>
                            </div>
                            <p className="dashboard-tab-copy">{dashboardTabCopy.individual}</p>
                            {renderActivityList(sortedIndividualActivities, "No individual activities yet.")}
                        </div>
                    )}

                    {currentDashboardTab === "group" && (
                        <div className="dashboard-tab-panel">
                            <div className="side-panel__title">
                                <h2>Group Activity</h2>
                                <span>{groupCaseActivities.length}</span>
                            </div>
                            <p className="dashboard-tab-copy">{dashboardTabCopy.group}</p>
                            {renderActivityList(groupCaseActivities, "No group activities yet.")}
                        </div>
                    )}

                    {currentDashboardTab === "quiz" && (
                        <div className="dashboard-tab-panel">
                            <div className="side-panel__title">
                                <h2>Big Table Quiz</h2>
                                <span>{quizActivities.length}</span>
                            </div>
                            <p className="dashboard-tab-copy">{dashboardTabCopy.quiz}</p>
                            {renderActivityList(quizActivities, "No quiz activities yet.")}
                        </div>
                    )}
                </section>
                )}
            </aside>

            <ChatLauncher currentUser={currentUser}/>

            {activeMapActivity && (
                <div className="virtual-activity-modal" role="dialog" aria-modal="false" aria-label="Activity">
                    <div className="virtual-activity-modal__backdrop" />
                    <section className="virtual-activity-modal__panel">
                        {renderMapActivity()}
                    </section>
                </div>
            )}

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

            {!isInstructor && showOrientationTutorial && (
                <div className="virtual-tutorial" role="dialog" aria-modal="true" aria-labelledby="virtual-tutorial-title">
                    <div className="virtual-tutorial__backdrop" />
                    <section className="virtual-tutorial__panel">
                        <div className="virtual-tutorial__topline">
                            <span className="virtual-tutorial__eyebrow">Panduan Singkat</span>
                            <span className="virtual-tutorial__progress">{orientationTutorialStep + 1}/5</span>
                        </div>

                        {orientationTutorialStep === 0 ? (
                            <>
                                <h2 id="virtual-tutorial-title">Interaksi di Ruang Virtual</h2>
                                <div className="virtual-tutorial__movement">
                                    <span>↑↓←→</span>
                                    <div>
                                        <strong>Gerakkan avatar dengan tombol panah</strong>
                                        <p>Dekati objek aktivitas di ruang virtual, lalu tekan Space saat instruksi interaksi muncul.</p>
                                    </div>
                                </div>
                                <div className="virtual-tutorial__steps">
                                    <article className="virtual-tutorial__step virtual-tutorial__step--individual">
                                        <div className="virtual-tutorial__image">
                                            <img src="/objects/computer.png" alt="Computer object" />
                                        </div>
                                        <div>
                                            <strong>Latihan Mandiri</strong>
                                            <p>Gunakan komputer untuk latihan mandiri, pre-test, dan post-test. Satu komputer untuk 1 orang.</p>
                                        </div>
                                    </article>
                                    <article className="virtual-tutorial__step virtual-tutorial__step--group">
                                        <div className="virtual-tutorial__image">
                                            <img src="/objects/tablebook_r.png" alt="Group table object" />
                                        </div>
                                        <div>
                                            <strong>Diskusi Kelompok</strong>
                                            <p>Gunakan meja ini untuk mengerjakan studi kasus bersama teman dalam kelompok. Maksimal 4 orang dalam 1 kelompok. 1 meja untuk 1 orang.</p>
                                        </div>
                                    </article>
                                    <article className="virtual-tutorial__step virtual-tutorial__step--quiz">
                                        <div className="virtual-tutorial__image">
                                            <img src="/objects/bigtable.png" alt="Big table quiz object" />
                                        </div>
                                        <div>
                                            <strong>Fun Quiz 1 vs 1</strong>
                                            <p>Gunakan meja ini untuk mulai duel quiz 1 lawan 1 dengan satu teman. 1 meja untuk 2 orang.</p>
                                        </div>
                                    </article>
                                </div>
                                <div className="virtual-tutorial__hint">
                                    <span>!</span>
                                    <p>Ikuti papan pixel di map. Saat instruksi muncul di dekat objek, tekan Space untuk berinteraksi.</p>
                                </div>
                            </>
                        ) : orientationTutorialStep === 1 ? (
                            <>
                                <h2 id="virtual-tutorial-title">Feedback dan Riwayat Aktivitas</h2>
                                <div className="virtual-tutorial__ai-card">
                                    <span>AI</span>
                                    <div>
                                        <strong>AI Feedback tersedia di setiap aktivitas</strong>
                                        <p>Feedback akan ditampilkan di akhir aktivitas atau pada halaman hasil. Jika proses feedback membutuhkan waktu, tunggu sampai hasil muncul.</p>
                                    </div>
                                </div>
                                <div className="virtual-tutorial__dashboard-guide">
                                    <div>
                                        <strong>Pantau progres dari dashboard</strong>
                                        <p>Riwayat dan perkembangan aktivitas bisa kamu lihat dari tab dashboard di sisi kanan layar.</p>
                                    </div>
                                    <div className="virtual-tutorial__dashboard-icons" aria-label="Dashboard icons">
                                        {[
                                            {id: "leaderboard", label: "Leaderboard"},
                                            {id: "individual", label: "Individual"},
                                            {id: "group", label: "Group"},
                                            {id: "quiz", label: "Quiz"},
                                        ].map((item) => (
                                            <article key={item.id} className={`virtual-tutorial__dashboard-icon virtual-tutorial__dashboard-icon--${item.id}`}>
                                                <span>
                                                    <DashboardTabIcon type={item.id} />
                                                </span>
                                                <strong>{item.label}</strong>
                                            </article>
                                        ))}
                                    </div>
                                </div>
                            </>
                        ) : orientationTutorialStep === 2 ? (
                            <>
                                <h2 id="virtual-tutorial-title">Gamifikasi dan Leaderboard</h2>
                                <div className="virtual-tutorial__gamify-hero">
                                    <span>XP</span>
                                    <span>LV</span>
                                    <span>PTS</span>
                                    <div>
                                        <strong>Belajar mandiri, berkontribusi bersama</strong>
                                        <p>Setiap aktivitas membantu kamu membangun progres belajar pribadi dan kontribusi untuk kelompok.</p>
                                    </div>
                                </div>
                                <div className="virtual-tutorial__gamify-grid">
                                    <article>
                                        <span>IXP</span>
                                        <strong>Individual XP</strong>
                                        <p>Didapat setelah menyelesaikan aktivitas individual, seperti latihan multiple choice atau case study.</p>
                                    </article>
                                    <article>
                                        <span>LV</span>
                                        <strong>Level Siswa</strong>
                                        <p>Level menunjukkan perkembangan Individual XP kamu di course ini. Semakin banyak XP, semakin tinggi levelmu.</p>
                                    </article>
                                    <article>
                                        <span>GXP</span>
                                        <strong>Group XP</strong>
                                        <p>Kamu bisa berkontribusi untuk Group XP saat mengerjakan aktivitas kelompok. Individual XP juga diberikan sesuai kualitas jawabanmu.</p>
                                    </article>
                                    <article>
                                        <span>PTS</span>
                                        <strong>Quiz Points</strong>
                                        <p>Pada quiz, kamu mendapatkan points, bukan XP. Points berasal dari jawaban benar saat duel quiz.</p>
                                    </article>
                                </div>
                                <div className="virtual-tutorial__leaderboard-card">
                                    <span className="virtual-tutorial__leaderboard-icon">
                                        <DashboardTabIcon type="leaderboard" />
                                    </span>
                                    <div>
                                        <strong>Cara membaca leaderboard</strong>
                                        <p>Leaderboard group menampilkan peringkat berdasarkan Group XP, leaderboard quiz berdasarkan points, dan leaderboard individual berdasarkan Individual XP.</p>
                                        <em>Terus belajar mandiri untuk naik level, dan tetap bekerja sama agar kelompokmu makin kuat.</em>
                                    </div>
                                </div>
                            </>
                        ) : orientationTutorialStep === 3 ? (
                            <>
                                <h2 id="virtual-tutorial-title">Fitur Chat Kelas</h2>
                                <div className="virtual-tutorial__chat-hero">
                                    <span>Chat</span>
                                    <div>
                                        <strong>Akses chat dari tombol Chat</strong>
                                        <p>Gunakan tombol Chat di layar untuk membuka pesan kelas, broadcast dari instructor, dan group chat.</p>
                                    </div>
                                </div>
                                <div className="virtual-tutorial__chat-grid">
                                    <article>
                                        <span>BC</span>
                                        <strong>Broadcast instructor</strong>
                                        <p>Instructor dapat mengirim pengumuman atau arahan penting. Kamu juga bisa memberi reaction pada pesan broadcast tersebut.</p>
                                    </article>
                                    <article>
                                        <span>GC</span>
                                        <strong>Group chat</strong>
                                        <p>Kamu dapat membuat group chat dengan siswa yang berada dalam group yang sama.</p>
                                    </article>
                                    <article>
                                        <span>EX</span>
                                        <strong>Keluar mandiri</strong>
                                        <p>Setelah selesai bekerja dalam group activity, kamu boleh keluar dari group chat secara mandiri.</p>
                                    </article>
                                </div>
                            </>
                        ) : (
                            <>
                                <h2 id="virtual-tutorial-title">Pengingat Belajar</h2>
                                <div className="virtual-tutorial__reminder-card">
                                    <span>!</span>
                                    <div>
                                        <strong>Gunakan AI dengan bijak</strong>
                                        <p>Ruang belajar interaktif ini sudah dirancang dengan AI untuk membantu kamu belajar mandiri dan beraktivitas bersama teman.</p>
                                    </div>
                                </div>
                                <div className="virtual-tutorial__learning-note">
                                    <strong>Jangan langsung memakai AI untuk mengerjakan aktivitas.</strong>
                                    <p>Cobalah membaca materi, berdiskusi, mencari referensi secara manual, dan memahami prosesnya terlebih dahulu. AI feedback akan membantu setelah kamu berusaha menjawab.</p>
                                    <em>Yang paling penting bukan hanya mendapatkan jawaban, tetapi memahami alasan di balik jawaban itu.</em>
                                </div>
                            </>
                        )}

                        <div className="virtual-tutorial__actions">
                            {orientationTutorialStep > 0 && (
                                <button
                                    type="button"
                                    className="virtual-tutorial__button virtual-tutorial__button--secondary"
                                    onClick={() => setOrientationTutorialStep((step) => Math.max(0, step - 1))}
                                >
                                    Kembali
                                </button>
                            )}
                            {orientationTutorialStep < 4 ? (
                                <button type="button" className="virtual-tutorial__button" onClick={() => setOrientationTutorialStep((step) => Math.min(4, step + 1))}>
                                    Lanjut
                                </button>
                            ) : (
                                <button type="button" className="virtual-tutorial__button" onClick={closeOrientationTutorial}>
                                    Mengerti
                                </button>
                            )}
                        </div>
                    </section>
                </div>
            )}
        </div>
    );
};

export default VirtualSpacePage;
