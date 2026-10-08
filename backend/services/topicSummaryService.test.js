import test from "node:test";
import assert from "node:assert/strict";
import {buildTopicSummary} from "./topicSummaryService.js";

function fixture() {
    return {
        course: {course_name: "Test Course"}, topic: {topic_name: "Test Topic"},
        groups: [{course_group_id: 2, group_name: "Group B"}, {course_group_id: 3, group_name: "Group C"}],
        students: [
            {user_id: 1, name: "One", email: "one@example.test", course_group_id: 2, total_xp: 300, level_id: 3, level_name: "Achiever"},
            {user_id: 2, name: "Two", email: "two@example.test", course_group_id: 2, total_xp: 0, level_id: 1, level_name: "Rookie"},
            {user_id: 3, name: "Three", email: "three@example.test", course_group_id: 3, total_xp: 150, level_id: 2, level_name: "Explorer"},
        ],
        levels: [{level_id: 1, level_name: "Rookie"}, {level_id: 2, level_name: "Explorer"}, {level_id: 3, level_name: "Achiever"}],
        individual: [
            {user_id: 1, activity_type: "exercise", question_kind: "multiple_choice", xp_earned: 20},
            {user_id: 1, activity_type: "exercise", question_kind: "multiple_choice", xp_earned: 20},
            {user_id: 1, activity_type: "exercise", question_kind: "case_study", xp_earned: 20},
            {user_id: 3, activity_type: "exercise", question_kind: "multiple_choice", xp_earned: 40},
        ],
        submissions: [1, 2].map((session_id) => ({session_id, course_group_id: 2, group_xp: 100, members: [{user_id: 1, name: "One"}, {user_id: 1, name: "One"}]})),
        contributions: [{course_group_id: 2, user_id: 1, xp_earned: 25}],
        quizzes: [1, 2, 3, 4].map((quiz_session_id) => ({quiz_session_id, course_group_id: 2, members: [{user_id: 1}], results_json: {scoreboard: [{user_id: 1, total_score: 50}]}})),
    };
}

const rows = (report, name) => report.sheets.find((sheet) => sheet.name === name).rows.slice(5);

test("separates shared XP and student awards, counts sessions once, and uses the full roster denominator", () => {
    const report = buildTopicSummary(fixture());
    const b = rows(report, "Group Comparison")[0];
    assert.deepEqual(b.slice(0, 10), ["Group B", 2, 60, 30, 200, 100, 25, 12.5, 200, 100]);
    assert.deepEqual(b.slice(10), [2, 1, 2, 4, 1, 50, 1, 1, 50, 3]);
    assert.equal(rows(report, "Participation and Progress")[0][3].value, "sudah memenuhi");
    assert.equal(rows(report, "Participation and Progress")[1][3].style, "danger");
    const summary = rows(report, "Comparison Summary");
    assert.match(summary[0][5], /Group C has higher/);
    assert.match(summary[3][5], /Insufficient data/);
    const levels = rows(report, "Current Level Distribution");
    assert.deepEqual(levels[0], ["Group B", 1, "Rookie", 1, 50]);
    assert.deepEqual(levels[2], ["Group B", 3, "Achiever", 1, 50]);
});

test("ranks aggregated positive student scores, limits each group/category to 10, and resolves ties consistently", () => {
    const input = fixture();
    input.students = Array.from({length: 12}, (_, index) => ({user_id: index + 1, name: `Student ${String(index + 1).padStart(2, "0")}`, email: "", course_group_id: 2, total_xp: 0, level_id: 1}));
    input.individual = input.students.flatMap((student) => [10, 10].map((xp_earned) => ({user_id: student.user_id, activity_type: "exercise", question_kind: "multiple_choice", xp_earned})));
    input.submissions = []; input.contributions = []; input.quizzes = [];
    const ranked = rows(buildTopicSummary(input), "Top Contributors");
    assert.equal(ranked.length, 10);
    assert.equal(ranked[0][3], "Student 01");
    assert.equal(ranked[9][3], "Student 10");
    assert.equal(ranked[0][5], 20);
});

test("handles missing groups, empty rosters, zero scores, and ties without non-finite numbers", () => {
    const input = fixture();
    input.groups = [input.groups[1]];
    input.students = []; input.individual = []; input.submissions = []; input.contributions = []; input.quizzes = [];
    const report = buildTopicSummary(input);
    for (const row of rows(report, "Comparison Summary").slice(0, 7)) assert.match(row[5], /Insufficient data/);
    assert.doesNotMatch(JSON.stringify(report), /NaN|Infinity/);
    const tied = fixture();
    tied.individual = [{user_id: 1, xp_earned: 80}, {user_id: 3, xp_earned: 40}];
    assert.match(rows(buildTopicSummary(tied), "Comparison Summary")[0][5], /tied/);
});

test("pre/post XP matches dashboard totals but assessments do not satisfy the activity baseline", () => {
    const input = fixture();
    input.individual = [{user_id: 2, activity_type: "pre_test", xp_earned: 80}];
    const report = buildTopicSummary(input);
    const b = rows(report, "Group Comparison")[0];
    assert.equal(b[2], 80);
    assert.equal(b[10], 0);
    assert.equal(b[16], 0);
});
