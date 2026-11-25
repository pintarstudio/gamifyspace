import React from "react";
import AvatarIcon from "./AvatarIcon";
import MarkdownText from "./MarkdownText";

const CaseStudyAnswers = ({answers = [], members = [], individual = false, showAvatars = false}) => {
    const entries = new Map();
    for (const member of members) {
        if (member.user_id == null) continue;
        entries.set(String(member.user_id), {...member, answer_text: ""});
    }
    for (const answer of answers) {
        const key = String(answer.user_id ?? "individual");
        const member = entries.get(key) || {};
        entries.set(key, {...member, ...answer, name: answer.name || member.name,
            avatar_public_path: answer.avatar_public_path || member.avatar_public_path});
    }
    return (
        <section className="activity-detail-section">
            <h2>{individual ? "Your Answer" : "Group Answers"}</h2>
            <div className="history-answer-list">
                {[...entries.entries()].map(([key, answer]) => (
                    <article key={key}>
                        {!individual && (
                            <div className="history-answer-author">
                                {showAvatars && <AvatarIcon path={answer.avatar_public_path} alt={answer.name || "Student"} />}
                                <strong>{answer.name || "Student"}</strong>
                            </div>
                        )}
                        {String(answer.answer_text || "").trim()
                            ? <MarkdownText>{answer.answer_text}</MarkdownText>
                            : <p>Belum ada jawaban yang tersimpan.</p>}
                    </article>
                ))}
                {entries.size === 0 && <p>Belum ada jawaban yang tersimpan.</p>}
            </div>
        </section>
    );
};

export default CaseStudyAnswers;
