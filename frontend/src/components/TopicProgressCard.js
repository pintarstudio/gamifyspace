import React from "react";

const TopicProgressCard = ({activeTopic, topics = [], selectedTopicId, onChange, courseName = "Course"}) => (
    <div className="dashboard-active-topic">
        <span className="dashboard-active-topic__mark">TOPIK</span>
        <div className="dashboard-active-topic__body">
            <span className="dashboard-active-topic__course">{courseName}</span>
            <label htmlFor="dashboard-topic-select">Progress yang ditampilkan</label>
            <select
                id="dashboard-topic-select"
                value={selectedTopicId || activeTopic?.topic_id || ""}
                onChange={(event) => onChange(event.target.value)}
                disabled={!topics.length}
            >
                {topics.length ? topics.map((topic) => (
                    <option key={topic.topic_id} value={topic.topic_id}>
                        {topic.week ? `Week ${topic.week} - ` : ""}{topic.topic_name}{topic.is_active ? " (Aktif)" : ""}
                    </option>
                )) : (
                    <option value="">Belum ada topik</option>
                )}
            </select>
            <p>
                {activeTopic
                    ? `${activeTopic.is_active ? "Topik aktif" : "Topik sebelumnya"} untuk XP, level, leaderboard, dan riwayat aktivitas kamu.`
                    : "Belum ada topik yang bisa digunakan untuk menghitung progress aktivitas."}
            </p>
        </div>
    </div>
);

export default TopicProgressCard;
