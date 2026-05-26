import React from "react";

const iconPaths = {
    leaderboard: (
        <>
            <path d="M8 5h8v2.5a4 4 0 0 1-8 0V5Z" />
            <path d="M8 6H5.5a2 2 0 0 0 2 3.5" />
            <path d="M16 6h2.5a2 2 0 0 1-2 3.5" />
            <path d="M12 11.5V16" />
            <path d="M9 19h6" />
            <path d="M10 16h4v3h-4z" />
        </>
    ),
    individual: (
        <>
            <path d="M12 12a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" />
            <path d="M5.5 20a6.5 6.5 0 0 1 13 0" />
        </>
    ),
    group: (
        <>
            <path d="M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
            <path d="M17 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" />
            <path d="M3.5 20a5.5 5.5 0 0 1 11 0" />
            <path d="M14.5 18.5a4.5 4.5 0 0 1 6 1.5" />
        </>
    ),
    quiz: (
        <>
            <path d="M7 4h10a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" />
            <path d="M9 9h6" />
            <path d="M9 13h3" />
            <path d="m14 16 1.5 1.5L19 14" />
        </>
    ),
};

const DashboardTabIcon = ({type}) => (
    <svg
        aria-hidden="true"
        className="dashboard-tab-icon__svg"
        fill="none"
        focusable="false"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.9"
        viewBox="0 0 24 24"
    >
        {iconPaths[type] || iconPaths.individual}
    </svg>
);

export default DashboardTabIcon;
