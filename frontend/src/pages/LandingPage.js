import React from "react";
import "./LandingPage.css";

const components = [
    {
        icon: "2.5D",
        title: "2.5D Virtual Space",
        description: "Students move through a shared classroom map, meet near learning objects, and begin activities in context.",
    },
    {
        icon: "XP",
        title: "Gamification",
        description: "Progress, levels, and leaderboards make practice visible while keeping individual and group growth distinct.",
    },
    {
        icon: "AI",
        title: "AI Feedback",
        description: "Learners receive focused feedback for quiz mistakes, case studies, and reflection after activities.",
    },
];

const LandingPage = () => (
    <main
        className="landing-page"
        style={{"--landing-bg": `url(${process.env.PUBLIC_URL}/tiles/Room_Builder_Floors_16x16.png)`}}
    >
        <section className="landing-hero">
            <div className="landing-hero__content">
                <img src="/logo192.png" alt="GamifyIt" className="landing-logo" />
                <span>Interactive Learning Space</span>
                <h1>GamifyIt</h1>
                <p>
                    A virtual classroom experience for collaborative learning, individual practice,
                    game-based progress, and AI-supported feedback.
                </p>
            </div>
        </section>

        <section className="landing-components" aria-label="Core components">
            {components.map((item) => (
                <article key={item.title}>
                    <div className="landing-component-icon">{item.icon}</div>
                    <h2>{item.title}</h2>
                    <p>{item.description}</p>
                </article>
            ))}
        </section>
    </main>
);

export default LandingPage;
