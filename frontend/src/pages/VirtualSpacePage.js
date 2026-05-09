// src/pages/VirtualSpacePage.js
import React, {useEffect, useMemo, useState} from "react";
import {useNavigate} from "react-router-dom";
import {apiGet, apiPost} from "../api/apiClient";
import VirtualSpacePixi from "../components/VirtualSpacePixi";
import UserHUD from "../components/UserHUD";
import "./VirtualSpacePage.css";

const avatarSrc = (path) => {
    if (!path) return "/avatars/default.png";
    const normalized = path.startsWith("/") ? path : `/${path}`;
    return `/avatars${normalized}/thumbnail.png`;
};

const VirtualSpacePage = ({ user, setLoggedIn, setUser }) => {
    const [currentUser, setCurrentUser] = useState(user);
    const [dashboard, setDashboard] = useState(null);
    const [selectedActivity, setSelectedActivity] = useState(null);
    const [detailLoading, setDetailLoading] = useState(false);
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
            setLoggedIn(false);
            setUser(null);
            localStorage.clear(); // ✅ clear saved room or session data

            // beri sedikit jeda agar server sempat broadcast event
            setTimeout(() => {
                if (window.socket) window.socket.disconnect();
                navigate("/");
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
        room: currentUser?.room,
    }), [
        currentUser?.user_id,
        currentUser?.id,
        currentUser?.avatar_public_path,
        currentUser?.avatar,
        currentUser?.name,
        currentUser?.email,
        currentUser?.room,
    ]);

    if (!currentUser) return <p style={{textAlign: "center"}}>Memuat ruang...</p>;

    const openActivity = async (activity) => {
        setDetailLoading(true);
        const data = await apiGet(`/virtualspace/activities/${activity.session_id}`);
        setSelectedActivity(data.activity || null);
        setDetailLoading(false);
    };
    const showGameLayer = !!currentUser.gamification_enabled;

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

                <section className="side-panel">
                    <div className="side-panel__title">
                        <h2>Activity History</h2>
                        <span>{dashboard?.activities?.length || 0}</span>
                    </div>

                    <div className="activity-list">
                        {dashboard?.activities?.length > 0 ? (
                            dashboard.activities.map((activity) => (
                                <button
                                    className="activity-card"
                                    key={activity.session_id}
                                    onClick={() => openActivity(activity)}
                                    type="button"
                                >
                                    <strong>{activity.activity_name}</strong>
                                    <span>{activity.topic_name || "Topic"} · {activity.case_title}</span>
                                    {showGameLayer && (
                                        <small>
                                            {activity.group_xp || 0} group XP
                                            {activity.my_xp ? ` · ${activity.my_xp} my XP` : ""}
                                        </small>
                                    )}
                                </button>
                            ))
                        ) : (
                            <p className="panel-empty">No submitted table activities yet.</p>
                        )}
                    </div>
                </section>

                {showGameLayer && (
                    <section className="side-panel">
                        <div className="side-panel__title">
                            <h2>Leaderboard</h2>
                            <span>Course</span>
                        </div>

                        <div className="course-leaderboard">
                            {dashboard?.leaderboard?.length > 0 ? (
                                dashboard.leaderboard.map((item, index) => (
                                    <article className="course-leaderboard__row" key={item.user_id}>
                                        <div className="course-leaderboard__rank">{index + 1}</div>
                                        <img src={avatarSrc(item.avatar_public_path)} alt={item.name} />
                                        <div>
                                            <strong>{item.name}</strong>
                                            <span>{item.activities_count} activities</span>
                                        </div>
                                        <b>{item.total_xp} XP</b>
                                    </article>
                                ))
                            ) : (
                                <p className="panel-empty">No XP records yet.</p>
                            )}
                        </div>
                    </section>
                )}
            </aside>

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
                                        <h2>Case</h2>
                                        <p>{selectedActivity.case_prompt}</p>
                                    </section>

                                    <section>
                                        <h2>Group</h2>
                                        <div className="activity-member-list">
                                            {selectedActivity.members.map((member) => (
                                                <article key={member.user_id}>
                                                    <img src={avatarSrc(member.avatar_public_path)} alt={member.name} />
                                                    <div>
                                                        <strong>{member.name}</strong>
                                                        {showGameLayer && <span>{member.xp_earned || 0} XP</span>}
                                                    </div>
                                                </article>
                                            ))}
                                        </div>
                                    </section>
                                </div>

                                <section className="activity-detail-section">
                                    <h2>Answers</h2>
                                    <div className="history-answer-list">
                                        {selectedActivity.answers.map((answer) => (
                                            <article key={answer.user_id}>
                                                <strong>{answer.name}</strong>
                                                <p>{answer.answer_text}</p>
                                            </article>
                                        ))}
                                    </div>
                                </section>

                                {selectedActivity.combined_feedback && (
                                    <section className="activity-detail-section">
                                        <h2>Group Feedback</h2>
                                        <div className="history-feedback-grid">
                                            <article>
                                                <strong>WWW</strong>
                                                <p>{selectedActivity.combined_feedback.www}</p>
                                            </article>
                                            <article>
                                                <strong>EBI</strong>
                                                <p>{selectedActivity.combined_feedback.ebi}</p>
                                            </article>
                                        </div>
                                    </section>
                                )}

                                {selectedActivity.feedback_groups?.length > 0 && (
                                    <section className="activity-detail-section">
                                        <h2>Student Feedback</h2>
                                        <div className="history-student-feedback">
                                            {selectedActivity.feedback_groups.map((feedbackGroup) => (
                                                <article key={feedbackGroup.feedback_group_id}>
                                                    <div className="history-student-feedback__names">
                                                        {(feedbackGroup.student_names || []).join(", ")}
                                                    </div>
                                                    <div className="history-feedback-grid">
                                                        <div>
                                                            <strong>WWW</strong>
                                                            <p>{feedbackGroup.www}</p>
                                                        </div>
                                                        <div>
                                                            <strong>EBI</strong>
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
