import React from "react";

const BASELINE_ITEMS = [
    {key: "individualMc", label: "Individual MC", minimum: 2},
    {key: "individualCase", label: "Individual Case", minimum: 1},
    {key: "group", label: "Group Activity", minimum: 2},
    {key: "quiz", label: "Fun Quiz", minimum: 4},
];

const ActivityBaselineCard = ({individualActivities = [], groupActivities = [], quizActivities = []}) => {
    const counts = {
        individualMc: individualActivities.filter((activity) =>
            activity.activity_type === "individual"
            && activity.individual_activity_type === "exercise"
            && activity.question_kind === "multiple_choice"
        ).length,
        individualCase: individualActivities.filter((activity) =>
            activity.activity_type === "individual"
            && activity.individual_activity_type === "exercise"
            && activity.question_kind === "case_study"
        ).length,
        group: groupActivities.length,
        quiz: quizActivities.length,
    };
    const allMet = BASELINE_ITEMS.every((item) => counts[item.key] >= item.minimum);

    return (
        <div className={`activity-baseline ${allMet ? "activity-baseline--met" : "activity-baseline--pending"}`}>
            <div className="activity-baseline__header">
                <span className="activity-baseline__icon" aria-hidden="true">{allMet ? "OK" : "!"}</span>
                <div>
                    <strong>{allMet ? "Baseline aktivitas sudah terpenuhi" : "Baseline aktivitas belum terpenuhi"}</strong>
                    <p>Minimum aktivitas untuk topik yang sedang dipilih.</p>
                </div>
            </div>
            <div className="activity-baseline__grid">
                {BASELINE_ITEMS.map((item) => {
                    const met = counts[item.key] >= item.minimum;
                    return (
                        <div className={`activity-baseline__item ${met ? "is-met" : "is-pending"}`} key={item.key}>
                            <span>{met ? "OK" : "Need"}</span>
                            <strong>{item.label}</strong>
                            <small>{counts[item.key]}/{item.minimum}</small>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default ActivityBaselineCard;
