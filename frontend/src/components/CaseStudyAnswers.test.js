import React from "react";
import {render, screen} from "@testing-library/react";
import CaseStudyAnswers from "./CaseStudyAnswers";

test("shows every participant's saved answer, including inactive members, without requiring avatars", () => {
    const {container} = render(<CaseStudyAnswers
        members={[{user_id: 1, name: "Current Student"}, {user_id: 2, name: "Classmate", is_active: false}]}
        answers={[{user_id: 1, answer_text: "My saved response"}, {user_id: "2", answer_text: "My classmate's response"}]}
    />);
    expect(screen.getByText("Current Student")).toBeInTheDocument();
    expect(screen.getByText("Classmate")).toBeInTheDocument();
    expect(screen.getByText("My saved response")).toBeInTheDocument();
    expect(screen.getByText("My classmate's response")).toBeInTheDocument();
    expect(container.querySelectorAll("article")).toHaveLength(2);
    expect(container.querySelector("img")).not.toBeInTheDocument();
});

test("shows the individual's own answer and preserves multiline fenced code", () => {
    const code = "int main(void) {\n    return 0;\n}";
    const {container} = render(<CaseStudyAnswers individual
        members={[{user_id: 1, name: "Student"}]}
        answers={[{user_id: 1, answer_text: `My explanation\n\n\`\`\`c\n${code}\n\`\`\``}]}
    />);
    expect(screen.getByRole("heading", {name: "Your Answer"})).toBeInTheDocument();
    expect(screen.getByText("My explanation")).toBeInTheDocument();
    expect(container.querySelector("pre code").textContent).toBe(code);
    expect(container.querySelectorAll("article")).toHaveLength(1);
});

test("distinguishes missing saved answers and includes answers whose author is no longer in the roster", () => {
    render(<CaseStudyAnswers members={[{user_id: 1, name: "No saved answer"}]}
        answers={[{user_id: 2, name: "Former member", answer_text: "Preserved history"}]} />);
    expect(screen.getByText("Belum ada jawaban yang tersimpan.")).toBeInTheDocument();
    expect(screen.getByText("Former member")).toBeInTheDocument();
    expect(screen.getByText("Preserved history")).toBeInTheDocument();
});

test("shows a clear empty state and renders answer markup as text rather than HTML", () => {
    const {rerender, container} = render(<CaseStudyAnswers />);
    expect(screen.getByText("Belum ada jawaban yang tersimpan.")).toBeInTheDocument();
    rerender(<CaseStudyAnswers individual answers={[{user_id: 1, answer_text: '<script>alert("test")</script>'}]} />);
    expect(container.querySelector("script")).not.toBeInTheDocument();
    expect(screen.getByText('<script>alert("test")</script>')).toBeInTheDocument();
});
