import React from "react";

const outcomeLabel = (outcome) => {
    if (outcome === "win") return "Win";
    if (outcome === "lose") return "Lose";
    if (outcome === "tie") return "Tie";
    return "Done";
};

const formatActivityDate = (dateValue) => {
    if (!dateValue) return "";
    return new Intl.DateTimeFormat("id-ID", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    }).format(new Date(dateValue));
};

const individualTitle = (activity) => {
    if (activity.individual_activity_type === "pre_test") return "Pre-test";
    if (activity.individual_activity_type === "post_test") return "Post-test";
    return activity.question_kind === "case_study" ? "Case Study" : "Multiple Choice";
};

const activityScoreLabel = (activity) => {
    if (activity.activity_type === "individual") {
        if (activity.individual_activity_type === "exercise") {
            return `${activity.my_xp || activity.xp_total || 0} XP`;
        }
        return `${activity.score_total || 0}/100`;
    }
    if (activity.activity_type === "quiz") return `${activity.quiz_points || 0} pts`;
    return `${activity.group_xp || 0} XP`;
};

const startedAt = (activity) =>
    activity.work_started_at || activity.created_at || activity.submitted_at;

const ActivityHistoryList = ({activities = [], emptyText, showGameLayer, onOpen, cardClassName = ""}) => (
    <div className="activity-list">
        {activities.length > 0 ? activities.map((activity) => {
            const isAssessment = activity.activity_type === "individual"
                && ["pre_test", "post_test"].includes(activity.individual_activity_type);
            const isQuiz = activity.activity_type === "quiz";
            const scoreLabel = activityScoreLabel(activity);

            return (
                <button
                    className={[
                        "activity-card",
                        cardClassName,
                        isAssessment ? "activity-card--assessment" : "",
                        isQuiz && activity.quiz_outcome
                            ? `activity-card--quiz-outcome activity-card--quiz-outcome-${activity.quiz_outcome}`
                            : "",
                    ].filter(Boolean).join(" ")}
                    key={activity.activity_key || activity.session_id}
                    onClick={() => onOpen(activity)}
                    type="button"
                >
                    {isQuiz ? (
                        <>
                            <div className="activity-card__topline">
                                {activity.quiz_outcome && (
                                    <span className={`activity-card__quiz-outcome activity-card__quiz-outcome--${activity.quiz_outcome}`}>
                                        {outcomeLabel(activity.quiz_outcome)}
                                    </span>
                                )}
                                {showGameLayer && <span className="activity-card__score">{scoreLabel}</span>}
                            </div>
                            <span className="activity-card__quiz-opponent">vs {activity.quiz_competitor_name || "Competitor"}</span>
                        </>
                    ) : (
                        <>
                            <div className="activity-card__topline">
                                <strong>
                                    {activity.activity_type === "individual"
                                        ? individualTitle(activity)
                                        : (activity.case_title || "Case Study")}
                                </strong>
                                {showGameLayer && <span className="activity-card__score">{scoreLabel}</span>}
                            </div>
                        </>
                    )}
                    {startedAt(activity) && (
                        <small className="activity-card__date">Mulai {formatActivityDate(startedAt(activity))}</small>
                    )}
                </button>
            );
        }) : (
            <p className="panel-empty">{emptyText}</p>
        )}
    </div>
);

export default ActivityHistoryList;
