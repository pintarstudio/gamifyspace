import React from "react";

function topicStatusLabel(topic) {
    if (topic?.is_activity_available) return "Aktif";
    if (topic?.has_history) return "Riwayat saja";
    return "Tidak aktif";
}

function topicDescription(topic) {
    if (!topic) {
        return "Belum ada topik yang bisa digunakan untuk menghitung progress aktivitas.";
    }
    if (topic.is_activity_available) {
        return "Topik aktif untuk aktivitas saat ini. XP, level, leaderboard, dan riwayat di bawah mengikuti topik ini.";
    }
    return "Topik ini sudah tidak aktif untuk aktivitas baru, tetapi riwayat dan progress kamu tetap bisa ditinjau.";
}

const TopicProgressCard = ({activeTopic, topics = [], selectedTopicId, onChange, courseName = "Course"}) => (
    <div className="dashboard-active-topic">
        <span className="dashboard-active-topic__mark">TOPIK</span>
        <div className="dashboard-active-topic__body">
            <span className="dashboard-active-topic__course">{courseName}</span>
            <div className="dashboard-active-topic__heading">
                <label htmlFor="dashboard-topic-select">Progress yang ditampilkan</label>
                {activeTopic && (
                    <span className={`dashboard-active-topic__status ${activeTopic.is_activity_available ? "is-active" : "is-history"}`}>
                        {topicStatusLabel(activeTopic)}
                    </span>
                )}
            </div>
            <select
                id="dashboard-topic-select"
                value={selectedTopicId || activeTopic?.topic_id || ""}
                onChange={(event) => onChange(event.target.value)}
                disabled={!topics.length}
            >
                {topics.length ? topics.map((topic) => (
                    <option key={topic.topic_id} value={topic.topic_id}>
                        {topic.week ? `Week ${topic.week} - ` : ""}{topic.topic_name} ({topicStatusLabel(topic)})
                    </option>
                )) : (
                    <option value="">Belum ada topik</option>
                )}
            </select>
            <p>{topicDescription(activeTopic)}</p>
        </div>
    </div>
);

export default TopicProgressCard;
