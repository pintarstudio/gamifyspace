const BASELINE = {individual_mc: 2, individual_case: 1, group: 2, quiz: 4};
const ACTIVITY_NAMES = {individual_mc: "Individual MC", individual_case: "Individual Case", group: "Group Activity", quiz: "Fun Quiz"};
const number = (value) => Number(value) || 0;
const rounded = (value) => Math.round(value * 100) / 100;
const header = (values) => values.map((value) => ({value, style: "header"}));

export function buildTopicSummary({course, topic, groups, students, individual, submissions, contributions, quizzes, levels}) {
    const metadata = [
        ["Course", course.course_name],
        ["Topic", topic.topic_name],
        ["Generated at (UTC)", new Date().toISOString()],
    ];
    const buckets = groups.map((group) => ({
        ...group,
        students: students.filter((student) => Number(student.course_group_id) === Number(group.course_group_id)),
        scores: new Map(),
        counts: {...Object.fromEntries(Object.keys(BASELINE).map((key) => [key, 0]))},
        sharedXp: 0,
        submissions: [],
        individualSessions: 0,
        quizResults: 0,
    }));
    const byGroup = new Map(buckets.map((group) => [Number(group.course_group_id), group]));
    const byStudent = new Map(students.map((student) => [Number(student.user_id), student]));
    const scoreFor = (group, userId) => {
        const student = byStudent.get(Number(userId));
        if (!group || !student) return null;
        if (!group.scores.has(Number(userId))) {
            group.scores.set(Number(userId), {
                ...student,
                individualXp: 0, groupXp: 0, quizPoints: 0,
                counts: Object.fromEntries(Object.keys(BASELINE).map((key) => [key, 0])),
            });
        }
        return group.scores.get(Number(userId));
    };
    for (const group of buckets) for (const student of group.students) scoreFor(group, student.user_id);

    for (const row of individual) {
        const student = byStudent.get(Number(row.user_id));
        const group = byGroup.get(Number(student?.course_group_id));
        const score = scoreFor(group, row.user_id);
        if (!score) continue;
        group.individualSessions += 1;
        score.individualXp += number(row.xp_earned);
        if (row.activity_type !== "exercise") continue;
        const kind = row.question_kind === "case_study" ? "individual_case" : "individual_mc";
        score.counts[kind] += 1;
        group.counts[kind] += 1;
    }
    for (const row of submissions) {
        const group = byGroup.get(Number(row.course_group_id));
        if (!group) continue;
        group.sharedXp += number(row.group_xp);
        group.counts.group += 1;
        group.submissions.push(row);
        for (const userId of new Set((row.members || []).map((member) => Number(member.user_id)))) {
            const score = scoreFor(group, userId);
            if (score) score.counts.group += 1;
        }
    }
    for (const row of contributions) {
        const score = scoreFor(byGroup.get(Number(row.course_group_id)), row.user_id);
        if (score) score.groupXp += number(row.xp_earned);
    }
    for (const row of quizzes) {
        const group = byGroup.get(Number(row.course_group_id));
        if (!group) continue;
        group.counts.quiz += 1;
        const scoreboard = Array.isArray(row.results_json?.scoreboard) ? row.results_json.scoreboard : [];
        if (scoreboard.length) group.quizResults += 1;
        const points = new Map(scoreboard.map((entry) => [Number(entry.user_id), number(entry.total_score)]));
        const userIds = new Set((row.members || []).map((member) => Number(member.user_id)));
        for (const userId of points.keys()) userIds.add(userId);
        for (const userId of userIds) {
            const score = scoreFor(group, userId);
            if (!score) continue;
            score.counts.quiz += 1;
            score.quizPoints += points.get(userId) || 0;
        }
    }

    const comparison = [];
    const contributorRows = [];
    const submissionRows = [];
    const distributionRows = [];
    const highestRows = [];
    const studentLevelRows = [];
    const progressRows = [];
    for (const group of buckets) {
        const scores = [...group.scores.values()];
        const rosterScores = group.students.map((student) => group.scores.get(Number(student.user_id)));
        const count = rosterScores.length;
        const participated = rosterScores.filter((student) => Object.values(student.counts).some((value) => value > 0)).length;
        const baselineMet = rosterScores.filter((student) => Object.entries(BASELINE).every(([key, required]) => student.counts[key] >= required)).length;
        const sum = (key) => scores.reduce((total, student) => total + student[key], 0);
        group.metrics = {
            count,
            individualXp: sum("individualXp"), sharedXp: group.sharedXp, groupXp: sum("groupXp"), quizPoints: sum("quizPoints"),
            individualAverage: count ? sum("individualXp") / count : null,
            sharedAverage: count ? group.sharedXp / count : null,
            groupAverage: count ? sum("groupXp") / count : null,
            quizAverage: count ? sum("quizPoints") / count : null,
            participation: count ? participated / count * 100 : null,
            baseline: count ? baselineMet / count * 100 : null,
            highest: group.students.some((student) => student.level_id != null)
                ? Math.max(...group.students.filter((student) => student.level_id != null).map((student) => number(student.level_id))) : null,
        };
        comparison.push([
            group.group_name, count, sum("individualXp"), count ? rounded(group.metrics.individualAverage) : "",
            group.sharedXp, count ? rounded(group.metrics.sharedAverage) : "", sum("groupXp"), count ? rounded(group.metrics.groupAverage) : "",
            sum("quizPoints"), count ? rounded(group.metrics.quizAverage) : "",
            ...Object.keys(BASELINE).map((key) => group.counts[key]),
            participated, count ? rounded(group.metrics.participation) : "", baselineMet, count - baselineMet,
            count ? rounded(group.metrics.baseline) : "", group.metrics.highest ?? "",
        ]);
        for (const [key, label] of [["individualXp", "Individual XP"], ["groupXp", "Students Group XP"], ["quizPoints", "Quiz Points"]]) {
            const ranked = scores.filter((student) => student[key] > 0)
                .sort((a, b) => b[key] - a[key] || a.name.localeCompare(b.name) || Number(a.user_id) - Number(b.user_id)).slice(0, 10);
            ranked.forEach((student, index) => contributorRows.push([group.group_name, label, index + 1, student.name, student.email, student[key]]));
        }
        [...group.submissions].sort((a, b) => number(b.group_xp) - number(a.group_xp) || number(a.session_id) - number(b.session_id))
            .slice(0, 10).forEach((row, index) => submissionRows.push([
                group.group_name, index + 1, row.session_id, row.activity_title, number(row.group_xp),
                (row.members || []).map((member) => member.name).join("; "),
                row.submitted_at ? new Date(row.submitted_at).toISOString() : "",
            ]));
        const knownLevels = [...levels];
        if (group.students.some((student) => !student.level_id)) knownLevels.push({level_id: null, level_name: "Unclassified"});
        for (const level of knownLevels) {
            const members = group.students.filter((student) => student.level_id === level.level_id);
            distributionRows.push([group.group_name, level.level_id ?? "", level.level_name, members.length, count ? rounded(members.length / count * 100) : ""]);
        }
        const highest = group.students.filter((student) => group.metrics.highest !== null && number(student.level_id) === group.metrics.highest);
        if (!highest.length) highestRows.push([group.group_name, "", "", "No students", ""]);
        for (const student of highest) highestRows.push([group.group_name, student.level_id ?? "", student.level_name || "Unclassified", student.name, student.email]);
        for (const student of group.students) studentLevelRows.push([group.group_name, student.name, student.email, number(student.total_xp), student.level_id ?? "", student.level_name || "Unclassified"]);
        for (const student of rosterScores) {
            const met = Object.entries(BASELINE).every(([key, required]) => student.counts[key] >= required);
            progressRows.push([group.group_name, student.name, student.email, {value: met ? "sudah memenuhi" : "belum memenuhi", style: met ? "" : "danger"}, ...Object.keys(BASELINE).map((key) => student.counts[key])]);
        }
    }

    const conclusions = [];
    const b = buckets.find((group) => /^(group\s+)?b$/i.test(group.group_name.trim()));
    const c = buckets.find((group) => /^(group\s+)?c$/i.test(group.group_name.trim()));
    for (const [key, label, unit] of [
        ["individualAverage", "Individual XP per student", "XP"],
        ["sharedAverage", "Shared Group XP per student", "XP"],
        ["groupAverage", "Students Group XP per student", "XP"],
        ["quizAverage", "Quiz points per student", "points"],
        ["participation", "Participation rate", "percentage points"],
        ["baseline", "Baseline met rate", "percentage points"],
        ["highest", "Highest current overall level", "levels"],
    ]) {
        const left = b?.metrics[key];
        const right = c?.metrics[key];
        const hasObservations = (group) => {
            if (key === "individualAverage") return group?.individualSessions > 0;
            if (key === "sharedAverage" || key === "groupAverage") return group?.submissions.length > 0;
            if (key === "quizAverage") return group?.quizResults > 0;
            return true;
        };
        const insufficient = left == null || right == null || !hasObservations(b) || !hasObservations(c);
        const gap = insufficient ? null : rounded(Math.abs(left - right));
        const tied = !insufficient && gap === 0;
        const winner = !insufficient && !tied ? left > right ? b : c : null;
        const conclusion = insufficient ? "Insufficient data: both groups need students and relevant activity/level records for this comparison."
            : tied ? `Groups B and C are tied on ${label.toLowerCase()} at the displayed precision.`
            : `${winner.group_name} has higher ${label.toLowerCase()} (${rounded(left)} vs ${rounded(right)}; B vs C), a gap of ${gap} ${unit}.`;
        conclusions.push([label, left == null ? "" : rounded(left), right == null ? "" : rounded(right), gap ?? "", unit, conclusion]);
    }
    const sheet = (name, rows) => ({name, rows: [...metadata, [], ...rows]});
    return {
        sheets: [
            sheet("Comparison Summary", [
                header(["Measure", "Group B", "Group C", "Gap", "Unit", "Conclusion"]), ...conclusions,
                [], ["Scope", "Selected topic only; current levels use cumulative course XP at download time."],
                ["Individual XP", "Includes completed individual exercise, pre-test, and post-test XP, matching the dashboard."],
                ["Shared XP", "One reward per group submission; it is separate from student contribution XP."],
                ["Attribution", "Individual activity and levels use current student groups. Group and quiz sessions use their recorded course group (creator/host group for legacy sessions)."],
                ["Denominator", "Per-student averages use all current students in each group, including inactive students. Participation and baseline percentages use current roster students only."],
                ["Participation", "At least one completed/saved Individual MC, Individual Case, Group Activity, or Fun Quiz; excludes pre/post tests."],
                ["Baseline", Object.entries(BASELINE).map(([key, value]) => `${ACTIVITY_NAMES[key]} >= ${value}`).join("; ")],
                ["Rankings", "Up to 10 students with positive scores per category per group; ties ordered by name then user ID. Shared submissions ranked separately."],
                ["Interpretation", "Higher XP/points can reflect more attempts. These comparisons do not establish better learning or an overall winner."],
            ]),
            sheet("Group Comparison", [header([
                "Group", "Students", "Individual XP", "Individual XP / Student", "Shared Group XP", "Shared XP / Student",
                "Students Group XP", "Students Group XP / Student", "Quiz Points", "Quiz Points / Student",
                "Individual MC Sessions", "Individual Case Sessions", "Group Submissions", "Saved Quiz Sessions",
                "Participating Students", "Participation %", "Sudah Memenuhi", "Belum Memenuhi", "Baseline Met %", "Highest Current Level",
            ]), ...comparison]),
            sheet("Top Contributors", [header(["Group", "Category", "Rank", "Student", "Email", "XP / Points"]), ...contributorRows]),
            sheet("Shared Group Submissions", [header(["Group", "Rank", "Session ID", "Case", "Shared XP", "Participants", "Submitted at (UTC)"]), ...submissionRows]),
            sheet("Current Level Distribution", [header(["Group", "Current Overall Level", "Level Name", "Students", "Percentage %"]), ...distributionRows, [], header(["Group", "Highest Level", "Level Name", "Student", "Email"]), ...highestRows]),
            sheet("Current Student Levels", [header(["Group", "Student", "Email", "Current Course XP", "Current Overall Level", "Level Name"]), ...studentLevelRows]),
            sheet("Participation and Progress", [header(["Group", "Student", "Email", "Status", ...Object.values(ACTIVITY_NAMES)]), ...progressRows]),
        ],
    };
}
