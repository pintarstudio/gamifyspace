import React, {useEffect, useMemo, useState} from "react";
import {useLocation, useNavigate} from "react-router-dom";
import {apiDelete, apiGet, apiPatch, apiPost} from "../api/apiClient";
import "./AdminPage.css";

const DASHBOARD_COURSE_SESSION_KEY = "gamifyit:selectedInstructorDashboardCourseId";

function readDashboardCourseSession() {
    if (typeof window === "undefined") return "";
    try {
        return window.sessionStorage.getItem(DASHBOARD_COURSE_SESSION_KEY) || "";
    } catch {
        return "";
    }
}

function writeDashboardCourseSession(courseId) {
    if (typeof window === "undefined") return;
    try {
        if (courseId) window.sessionStorage.setItem(DASHBOARD_COURSE_SESSION_KEY, String(courseId));
        else window.sessionStorage.removeItem(DASHBOARD_COURSE_SESSION_KEY);
    } catch {
        // Ignore storage failures so dashboard selection still works normally.
    }
}

const COURSE_ITEM = {
    label: "Course",
    path: "/courseadmin",
    resource: "courses",
    idKey: "course_id",
    canAdd: true,
    canDelete: true,
    description: "Create, update, or soft-delete course records.",
    tableColumns: [
        {key: "course_code", label: "Code"},
        {key: "course_name", label: "Course Name"},
        {key: "instructor_names", label: "Instructors"},
        {key: "semester", label: "Semester"},
        {key: "location", label: "Location"},
    ],
    fields: [
        {key: "course_code", label: "Course Code", required: true},
        {key: "course_name", label: "Course Name", required: true},
        {key: "instructor_id", label: "Instructor 1", type: "select", reference: "instructors"},
        {key: "instructor2_id", label: "Instructor 2", type: "select", reference: "instructors"},
        {key: "semester", label: "Semester", type: "number"},
        {key: "location", label: "Location"},
    ],
};

const TOPIC_ITEM = {
    label: "Topics",
    path: "/topicadmin",
    resource: "topics",
    idKey: "topic_id",
    canAdd: true,
    canDelete: true,
    description: "Create, update, or soft-delete topics for each active course.",
    tableColumns: [
        {key: "course_name", label: "Course"},
        {key: "week", label: "Week"},
        {key: "topic_name", label: "Topic Name"},
        {key: "show_topic", label: "Visible", type: "boolean"},
        {key: "is_active", label: "Active Dashboard Topic", type: "boolean"},
        {key: "pre_test_start_at", label: "Pre-test Start", type: "datetime"},
        {key: "pre_test_end_at", label: "Pre-test End", type: "datetime"},
        {key: "post_test_start_at", label: "Post-test Start", type: "datetime"},
        {key: "post_test_end_at", label: "Post-test End", type: "datetime"},
    ],
    fields: [
        {key: "course_id", label: "Course", type: "select", reference: "courses", required: true},
        {key: "week", label: "Week", type: "number", placeholder: "1"},
        {key: "topic_name", label: "Topic Name", required: true},
        {key: "show_topic", label: "Show Topic", type: "checkbox"},
        {key: "is_active", label: "Use for Student Dashboard", type: "checkbox", defaultValue: true, trueLabel: "Dashboard active", falseLabel: "Not active for dashboard"},
        {key: "pre_test_start_at", label: "Pre-test Start", type: "datetime-local"},
        {key: "pre_test_end_at", label: "Pre-test End", type: "datetime-local"},
        {key: "post_test_start_at", label: "Post-test Start", type: "datetime-local"},
        {key: "post_test_end_at", label: "Post-test End", type: "datetime-local"},
    ],
};

const STUDENT_INSTRUCTOR_ITEM = {
    label: "Student & Instructor",
    path: "/studentadmin",
    resource: "students",
    idKey: "user_id",
    canAdd: true,
    canDelete: false,
    description: "Assign students and instructors to courses, course groups, and roles.",
    tableColumns: [
        {key: "course_name", label: "Course"},
        {key: "name", label: "Name"},
        {key: "email", label: "Email"},
        {key: "role_name", label: "Role"},
        {key: "course_group_name", label: "Course Group"},
        {
            key: "virtual_space_enabled",
            label: "Virtual Space",
            type: "boolean",
            trueLabel: "Enabled",
            falseLabel: "Disabled",
        },
        {
            key: "gamification_enabled",
            label: "Gamification",
            type: "boolean",
            trueLabel: "Enabled",
            falseLabel: "Disabled",
        },
    ],
    fields: [
        {key: "course_id", label: "Course", type: "select", reference: "courses", required: true},
        {key: "name", label: "User Name", required: true},
        {key: "email", label: "Email", required: true},
        {key: "role_id", label: "Role", type: "select", reference: "roles", valueKey: "role_id", labelKey: "role_name", required: true},
        {key: "course_group_id", label: "Course Group", type: "select", reference: "course_groups", dependsOn: "course_id", valueKey: "course_group_id", labelKey: "group_name", required: true},
    ],
};

const USER_ADMIN_ITEM = {
    label: "User Admin",
    path: "/useradmin",
    resource: "useradmins",
    idKey: "useradmin_id",
    canAdd: true,
    canDelete: true,
    description: "Manage accounts that can sign in to the GamifyIt admin backend.",
    tableColumns: [
        {key: "username", label: "Username"},
        {key: "role", label: "Admin Role"},
        {key: "user_name", label: "Linked User"},
        {key: "user_email", label: "Email"},
        {key: "is_disabled", label: "Status", type: "boolean", trueLabel: "Disabled", falseLabel: "Active"},
        {key: "last_login", label: "Last Login"},
    ],
    fields: [
        {key: "username", label: "Username", required: true},
        {key: "password", label: "Password", type: "password", requiredOnCreate: true, placeholder: "Leave blank to keep current password"},
        {
            key: "role",
            label: "Admin Role",
            type: "select",
            required: true,
            defaultValue: "instructor",
            options: [
                {value: "admin", label: "Admin"},
                {value: "instructor", label: "Instructor"},
            ],
        },
        {key: "user_id", label: "Linked App User", type: "select", reference: "useradmin_users", valueKey: "user_id", labelKey: "name"},
        {key: "is_disabled", label: "Disable Login", type: "checkbox", defaultValue: false, trueLabel: "Login disabled", falseLabel: "Login active"},
    ],
};

const MENU_GROUPS = [
    {
        label: "Admin Config",
        key: "admin-config",
        items: [
            {
                label: "Gamification Level",
                path: "/leveladmin",
                resource: "levels",
                idKey: "level_id",
                canAdd: false,
                canDelete: false,
                description: "Edit the XP range, level name, and color used for individual progress.",
                tableColumns: [
                    {key: "level_id", label: "Level"},
                    {key: "level_name", label: "Name"},
                    {key: "min_xp", label: "Min XP"},
                    {key: "max_xp", label: "Max XP"},
                    {key: "color_hex", label: "Color", type: "color"},
                ],
                fields: [
                    {key: "level_name", label: "Level Name", required: true},
                    {key: "min_xp", label: "Min XP", type: "number", required: true},
                    {key: "max_xp", label: "Max XP", type: "number", placeholder: "Empty for no maximum"},
                    {key: "color_hex", label: "Color", type: "color", required: true},
                ],
            },
            {
                label: "Avatar",
                path: "/avataradmin",
                resource: "avatars",
                idKey: "avatar_id",
                canAdd: true,
                canDelete: false,
                description: "Add or edit avatar display data used in the student login form.",
                tableColumns: [
                    {key: "avatar_name", label: "Avatar Name"},
                    {key: "avatar_public_path", label: "Public Path"},
                ],
                fields: [
                    {key: "avatar_name", label: "Avatar Name", required: true},
                    {key: "avatar_public_path", label: "Public Path", required: true, placeholder: "/student21/student21.png"},
                ],
            },
            {
                label: "Role",
                path: "/roleadmin",
                resource: "roles",
                idKey: "role_id",
                canAdd: false,
                canDelete: false,
                description: "Manage the student and instructor roles assigned to users.",
                tableColumns: [
                    {key: "role_id", label: "ID"},
                    {key: "role_name", label: "Role"},
                ],
                fields: [
                    {key: "role_name", label: "Role Name", required: true},
                ],
            },
            {
                label: "Settings",
                path: "/settingsadmin",
                resource: "settings",
                idKey: "setting_id",
                canAdd: false,
                canDelete: false,
                description: "Manage small system settings for access and behavior.",
                tableColumns: [
                    {key: "setting_name", label: "Setting"},
                    {key: "setting_description", label: "Description"},
                    {key: "setting_value", label: "Value", type: "setting_value"},
                ],
                fields: [
                    {key: "boolean_value", label: "Setting is active", type: "checkbox", trueLabel: "On", falseLabel: "Off", visibleForSettingTypes: ["boolean"]},
                    {key: "datetime_value", label: "Datetime", type: "datetime-local", visibleForSettingTypes: ["datetime"]},
                ],
            },
            COURSE_ITEM,
            TOPIC_ITEM,
            STUDENT_INSTRUCTOR_ITEM,
            USER_ADMIN_ITEM,
        ],
    },
    {
        label: "Course Master",
        key: "course-master",
        items: [
            {
                label: "Course Groups",
                path: "/coursegroupadmin",
                resource: "course-groups",
                idKey: "course_group_id",
                canAdd: true,
                canDelete: true,
                description: "Create course groups and control access mode plus gamification for each group.",
                tableColumns: [
                    {key: "course_name", label: "Course"},
                    {key: "group_name", label: "Group"},
                    {key: "virtual_space_enabled", label: "Virtual Space", type: "boolean", trueLabel: "Enabled", falseLabel: "Disabled"},
                    {key: "gamification_enabled", label: "Gamification", type: "boolean", trueLabel: "Enabled", falseLabel: "Disabled"},
                    {key: "student_count", label: "Students"},
                ],
                fields: [
                    {key: "course_id", label: "Course", type: "select", reference: "courses", required: true},
                    {key: "group_name", label: "Group Name", required: true},
                    {
                        key: "virtual_space_enabled",
                        label: "Enable Virtual Space",
                        type: "checkbox",
                        defaultValue: false,
                        trueLabel: "Students enter the virtual map",
                        falseLabel: "Students enter the no-map menu",
                    },
                    {
                        key: "gamification_enabled",
                        label: "Enable Gamification",
                        type: "checkbox",
                        defaultValue: false,
                        trueLabel: "XP and game layer enabled",
                        falseLabel: "XP and game layer disabled",
                    },
                ],
            },
            {
                label: "Material & Question Bank",
                path: "/questionbankadmin",
                custom: "questionBank",
                description: "Upload topic material, create a compact digest, generate AI question drafts, review them, and save to the selected bank.",
            },
        ],
    },
    {
        label: "Question Bank",
        key: "question-bank",
        items: [
            {
                label: "Quiz Question Bank",
                path: "/quizbankadmin",
                custom: "bankManager",
                bankType: "quiz_question_bank",
                description: "Display, add, and edit multiple choice questions for Kahoot-style quiz activity.",
            },
            {
                label: "Individual Question Bank",
                path: "/individualbankadmin",
                custom: "bankManager",
                bankType: "individual_questions",
                description: "Display, add, and edit individual exercise, pre-test, and post-test questions.",
            },
            {
                label: "Group Case Studies",
                path: "/groupcasebankadmin",
                custom: "bankManager",
                bankType: "topic_cases",
                description: "Display, add, and edit group case studies used by group activities.",
            },
        ],
    },
];

const DEFAULT_PATH = "/gamifyitadmin";
const BANK_PAGE_SIZE = 15;
const OPENAI_MODEL_OPTIONS = [
    {value: "gpt-5.4-mini", label: "GPT-5.4 Mini - balanced"},
    {value: "gpt-5.4-nano", label: "GPT-5.4 Nano - fastest/cheapest"},
    {value: "gpt-5.4", label: "GPT-5.4 - higher quality"},
    {value: "gpt-5.5", label: "GPT-5.5 - best quality"},
];
const STANDALONE_ITEMS = [
    {
        label: "Change Password",
        path: "/adminpassword",
        custom: "changePassword",
        description: "Change the password for your current admin backend account.",
    },
];
const RESOURCE_ITEMS = [...MENU_GROUPS.flatMap((group) => group.items), ...STANDALONE_ITEMS];

function getConfig(pathname) {
    return RESOURCE_ITEMS.find((item) => item.path === pathname) || null;
}

function emptyForm(config) {
    if (!config) return {};
    return config.fields.reduce((acc, field) => {
        acc[field.key] = field.type === "checkbox" ? field.defaultValue ?? true : field.defaultValue ?? "";
        return acc;
    }, {});
}

function toDateTimeLocalValue(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const parts = new Intl.DateTimeFormat("en-CA", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZone: "Asia/Jakarta",
    }).formatToParts(date).reduce((acc, part) => {
        acc[part.type] = part.value;
        return acc;
    }, {});
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

function buildForm(config, row) {
    if (!config || !row) return emptyForm(config);
    return config.fields.reduce((acc, field) => {
        const value = row[field.key];
        acc[field.key] = field.type === "checkbox"
            ? value !== false
            : field.type === "datetime-local"
                ? toDateTimeLocalValue(value)
                : value ?? "";
        return acc;
    }, {});
}

function formatValue(column, value) {
    if (column.type === "boolean") return value ? column.trueLabel || "Shown" : column.falseLabel || "Hidden";
    if (column.type === "setting_value") {
        if (value?.setting_type === "boolean") return value.boolean_value ? "On" : "Off";
        if (value?.setting_type === "datetime") return formatValue({type: "datetime"}, value.datetime_value);
        return value?.text_value || value?.number_value || "-";
    }
    if (column.type === "datetime") {
        if (!value) return "Belum dijadwalkan";
        const formatted = new Date(value).toLocaleString("id-ID", {
            dateStyle: "medium",
            timeStyle: "short",
            timeZone: "Asia/Jakarta",
        });
        return `${formatted} WIB`;
    }
    if (value === null || value === undefined || value === "") return "-";
    return value;
}

const BANK_CONFIGS = {
    quiz_question_bank: {
        title: "Quiz Question Bank",
        idKey: "question_id",
        questionType: "multiple_choice",
        columns: [
            {key: "course_name", label: "Course"},
            {key: "topic_name", label: "Topic"},
            {key: "question_number", label: "No."},
            {key: "question_text", label: "Question"},
            {key: "question_type", label: "Type"},
        ],
    },
    individual_questions: {
        title: "Individual Question Bank",
        idKey: "question_id",
        columns: [
            {key: "course_name", label: "Course"},
            {key: "topic_name", label: "Topic"},
            {key: "activity_type", label: "Activity"},
            {key: "question_kind", label: "Type"},
            {key: "question_number", label: "No."},
            {key: "question_text", label: "Question / Case"},
        ],
    },
    topic_cases: {
        title: "Group Case Studies",
        idKey: "case_id",
        questionType: "case_study",
        columns: [
            {key: "course_name", label: "Course"},
            {key: "topic_name", label: "Topic"},
            {key: "case_number", label: "Case No."},
            {key: "case_title", label: "Case Title"},
            {key: "question_type", label: "Type"},
        ],
    },
};

function getQuestionKindFromType(type) {
    return type === "exercise_case_study" ? "case_study" : "multiple_choice";
}

function getActivityFromType(type) {
    if (type === "pre_test_multiple_choice") return "pre_test";
    if (type === "post_test_multiple_choice") return "post_test";
    return "exercise";
}

function getIndividualTypeFromRow(row) {
    if (row?.activity_type === "pre_test") return "pre_test_multiple_choice";
    if (row?.activity_type === "post_test") return "post_test_multiple_choice";
    if (row?.question_kind === "case_study") return "exercise_case_study";
    return "exercise_multiple_choice";
}

function formatAdminNumber(value) {
    return new Intl.NumberFormat("en-US").format(Number(value || 0));
}

function formatAdminDate(value) {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "-";
    return date.toLocaleDateString(undefined, {month: "short", day: "numeric", hour: "2-digit", minute: "2-digit"});
}

function scoreWidth(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 0;
    return Math.max(0, Math.min(100, parsed));
}

function activityClass(type) {
    if (type === "pre_test") return "pre";
    if (type === "post_test") return "post";
    if (type === "group") return "group";
    if (type === "quiz") return "quiz";
    return "individual";
}

const WEEKLY_BASELINE = {
    individual_mc: 2,
    individual_case: 1,
    group: 2,
    quiz: 4,
};
const TOPIC_PROGRESS_TAB_KEY = "__topic_progress__";

function emptyWeeklyCounts() {
    return {
        individual_mc: 0,
        individual_case: 0,
        group: 0,
        quiz: 0,
    };
}

function emptyWeeklySessionBuckets() {
    return Object.keys(WEEKLY_BASELINE).reduce((buckets, kind) => {
        buckets[kind] = new Set();
        return buckets;
    }, {});
}

function weeklyActivityKind(activity) {
    if (activity.type === "group") return "group";
    if (activity.type === "quiz") return "quiz";
    if (activity.type === "individual" && activity.activity_type === "exercise") {
        return activity.question_kind === "case_study" ? "individual_case" : "individual_mc";
    }
    return null;
}

function weeklyKindLabel(kind) {
    if (kind === "individual_mc") return "Individual MC";
    if (kind === "individual_case") return "Individual Case";
    if (kind === "group") return "Group Activity";
    if (kind === "quiz") return "Fun Quiz";
    return kind;
}

function formatWeekDate(date) {
    return date.toLocaleDateString(undefined, {month: "short", day: "numeric"});
}

function localDateKey(date) {
    return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, "0"),
        String(date.getDate()).padStart(2, "0"),
    ].join("-");
}

function weekPeriodForDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    const day = start.getDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    start.setDate(start.getDate() + mondayOffset);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    const key = localDateKey(start);
    const sameYear = start.getFullYear() === end.getFullYear();
    const label = sameYear
        ? `${formatWeekDate(start)} - ${formatWeekDate(end)}, ${end.getFullYear()}`
        : `${formatWeekDate(start)}, ${start.getFullYear()} - ${formatWeekDate(end)}, ${end.getFullYear()}`;
    return {key, label, start_time: start.getTime()};
}

function weeklyActivitySessionKey(activity, topic, kind) {
    return [
        kind,
        activity.activity_id || activity.id || activity.session_id || activity.quiz_session_id || "activity",
        topic?.topic_id || "topic",
        activity.user_id || "",
        activity.submitted_at || "",
    ].join(":");
}

function createStudentBaseline(student) {
    return {
        user_id: student.user_id,
        name: student.name,
        email: student.email,
        counts: emptyWeeklyCounts(),
    };
}

function createProgressBucket(seedStudents, bucketData) {
    return {
        ...bucketData,
        topics: new Map(),
        totals: emptyWeeklyCounts(),
        session_keys: emptyWeeklySessionBuckets(),
        students: new Map(seedStudents.map((student) => [String(student.user_id), createStudentBaseline(student)])),
    };
}

function addActivityToProgressBucket(bucket, activity, topic, kind) {
    const sessionKey = weeklyActivitySessionKey(activity, topic, kind);
    if (!bucket.session_keys[kind].has(sessionKey)) {
        bucket.session_keys[kind].add(sessionKey);
        bucket.totals[kind] += 1;
    }
    bucket.topics.set(String(topic.topic_id), topic.topic_name);
    for (const participant of activity.participants || []) {
        if (!participant.user_id) continue;
        const studentKey = String(participant.user_id);
        if (!bucket.students.has(studentKey)) {
            bucket.students.set(studentKey, createStudentBaseline({
                user_id: participant.user_id,
                name: participant.name || activity.student_name || "Student",
                email: participant.email || "",
            }));
        }
        bucket.students.get(studentKey).counts[kind] += 1;
    }
}

function finalizeProgressBuckets(progressBuckets) {
    return progressBuckets
        .map((bucket) => {
            const students = [...bucket.students.values()].sort((a, b) => a.name.localeCompare(b.name));
            const withStatus = students.map((student) => ({
                ...student,
                baseline_met: Object.entries(WEEKLY_BASELINE).every(([kind, required]) => student.counts[kind] >= required),
            }));
            return {
                ...bucket,
                topic_names: [...bucket.topics.values()].sort((a, b) => a.localeCompare(b)),
                students_met: withStatus.filter((student) => student.baseline_met),
                students_pending: withStatus.filter((student) => !student.baseline_met),
            };
        });
}

function weeklyProgressForGroup(course, selectedGroup) {
    const weekMap = new Map();

    for (const topic of course?.topics || []) {
        const topicGroup = (topic.groups || []).find((group) => String(group.course_group_id) === String(selectedGroup.course_group_id));
        if (!topicGroup) continue;

        for (const activity of topicGroup.activities || []) {
            const kind = weeklyActivityKind(activity);
            if (!kind) continue;
            const period = weekPeriodForDate(activity.submitted_at);
            if (!period) continue;

            const key = period.key;
            const week = weekMap.get(key) || createProgressBucket(selectedGroup.students || topicGroup.students || [], {
                key,
                label: period.label,
                start_time: period.start_time,
            });

            addActivityToProgressBucket(week, activity, topic, kind);
            weekMap.set(key, week);
        }
    }

    return finalizeProgressBuckets([...weekMap.values()])
        .sort((a, b) => a.start_time - b.start_time);
}

function topicProgressForGroup(course, selectedGroup) {
    const topicBuckets = [];

    for (const topic of course?.topics || []) {
        const topicGroup = (topic.groups || []).find((group) => String(group.course_group_id) === String(selectedGroup.course_group_id));
        if (!topicGroup) continue;

        const topicBucket = createProgressBucket(selectedGroup.students || topicGroup.students || [], {
            key: `topic:${topic.topic_id}`,
            label: topic.topic_name,
            sub_label: topic.week ? `Week ${topic.week}` : "Topic",
            start_time: Number(topic.week || 0),
        });

        for (const activity of topicGroup.activities || []) {
            const kind = weeklyActivityKind(activity);
            if (!kind || !activity.submitted_at) continue;
            addActivityToProgressBucket(topicBucket, activity, topic, kind);
        }
        if (Object.values(topicBucket.totals).some((total) => total > 0)) {
            topicBuckets.push(topicBucket);
        }
    }

    return finalizeProgressBuckets(topicBuckets)
        .sort((a, b) => a.start_time - b.start_time || a.label.localeCompare(b.label));
}

function studentsByXp(group) {
    const byStudent = new Map((group.students || []).map((student) => [
        String(student.user_id),
        {
            user_id: student.user_id,
            name: student.name,
            total_xp: 0,
            activities: 0,
            latest_reason: "",
            level_name: student.level_name,
            level_color: student.level_color,
        },
    ]));

    for (const item of group.xp_contributions || []) {
        const key = String(item.user_id);
        const current = byStudent.get(key) || {
            user_id: item.user_id,
            name: item.student_name,
            total_xp: 0,
            activities: 0,
            latest_reason: "",
        };
        current.total_xp += Number(item.xp_earned || 0);
        current.activities += 1;
        if (item.reason) current.latest_reason = item.reason;
        byStudent.set(key, current);
    }

    return [...byStudent.values()].sort((a, b) => b.total_xp - a.total_xp || a.name.localeCompare(b.name));
}

function missingAssessmentStudents(group) {
    const assessmentByUserId = new Map((group.assessment_comparison || []).map((student) => [String(student.user_id), student]));
    const students = [...(group.students || [])].sort((a, b) => a.name.localeCompare(b.name));
    return {
        preTest: students.filter((student) => {
            const assessment = assessmentByUserId.get(String(student.user_id));
            return assessment?.pre_score === null || assessment?.pre_score === undefined;
        }),
        postTest: students.filter((student) => {
            const assessment = assessmentByUserId.get(String(student.user_id));
            return assessment?.post_score === null || assessment?.post_score === undefined;
        }),
    };
}

function escapeXml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function slugifyFilePart(value) {
    return String(value || "topic")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "topic";
}

function percentage(value, total) {
    if (!total) return 0;
    return Math.round((Number(value || 0) / Number(total || 0)) * 100);
}

function barWidth(value, max) {
    if (!max || !Number(value || 0)) return 0;
    return Math.max(4, Math.min(100, Math.round((Number(value || 0) / Number(max || 0)) * 100)));
}

function isIndividualCaseActivity(activity) {
    return /case/i.test(`${activity.label || ""} ${activity.title || ""}`);
}

function groupActivityComparison(group) {
    const activities = group.activities || [];
    return {
        individual_mc: activities.filter((activity) => activity.type === "individual" && !isIndividualCaseActivity(activity)).length,
        individual_case: activities.filter((activity) => activity.type === "individual" && isIndividualCaseActivity(activity)).length,
        group: activities.filter((activity) => activity.type === "group").length,
        quiz: activities.filter((activity) => activity.type === "quiz").length,
    };
}

function topicComparisonRows(groups = []) {
    const rows = groups.map((group) => {
        const activityCounts = groupActivityComparison(group);
        return {
            group,
            groupName: group.group_name || "Ungrouped",
            individualXp: Number(group.total_individual_xp || 0),
            groupXp: Number(group.total_group_xp || 0),
            totalXp: Number(group.total_individual_xp || 0) + Number(group.total_group_xp || 0),
            totalActivities: Object.values(activityCounts).reduce((total, value) => total + value, 0),
            activityCounts,
        };
    });
    const maxXp = Math.max(0, ...rows.map((row) => row.totalXp));
    const maxActivities = Math.max(0, ...rows.map((row) => row.totalActivities));
    const leaderXp = maxXp;
    return rows.map((row) => ({
        ...row,
        maxXp,
        maxActivities,
        xpPercent: percentage(row.totalXp, maxXp),
        xpDifference: row.totalXp - leaderXp,
    }));
}

function columnName(index) {
    let name = "";
    let current = index + 1;
    while (current > 0) {
        const remainder = (current - 1) % 26;
        name = String.fromCharCode(65 + remainder) + name;
        current = Math.floor((current - 1) / 26);
    }
    return name;
}

const crcTable = (() => {
    const table = [];
    for (let n = 0; n < 256; n += 1) {
        let c = n;
        for (let k = 0; k < 8; k += 1) {
            c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
        }
        table[n] = c >>> 0;
    }
    return table;
})();

function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) {
        crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function writeUint16(bytes, value) {
    bytes.push(value & 0xff, (value >>> 8) & 0xff);
}

function writeUint32(bytes, value) {
    bytes.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
}

function concatBytes(parts) {
    const totalLength = parts.reduce((total, part) => total + part.length, 0);
    const output = new Uint8Array(totalLength);
    let offset = 0;
    for (const part of parts) {
        output.set(part, offset);
        offset += part.length;
    }
    return output;
}

function createStoredZip(entries) {
    const encoder = new TextEncoder();
    const localParts = [];
    const centralParts = [];
    let offset = 0;

    for (const entry of entries) {
        const nameBytes = encoder.encode(entry.name);
        const dataBytes = encoder.encode(entry.content);
        const crc = crc32(dataBytes);
        const local = [];
        writeUint32(local, 0x04034b50);
        writeUint16(local, 20);
        writeUint16(local, 0);
        writeUint16(local, 0);
        writeUint16(local, 0);
        writeUint16(local, 0);
        writeUint32(local, crc);
        writeUint32(local, dataBytes.length);
        writeUint32(local, dataBytes.length);
        writeUint16(local, nameBytes.length);
        writeUint16(local, 0);
        const localBytes = concatBytes([new Uint8Array(local), nameBytes, dataBytes]);
        localParts.push(localBytes);

        const central = [];
        writeUint32(central, 0x02014b50);
        writeUint16(central, 20);
        writeUint16(central, 20);
        writeUint16(central, 0);
        writeUint16(central, 0);
        writeUint16(central, 0);
        writeUint16(central, 0);
        writeUint32(central, crc);
        writeUint32(central, dataBytes.length);
        writeUint32(central, dataBytes.length);
        writeUint16(central, nameBytes.length);
        writeUint16(central, 0);
        writeUint16(central, 0);
        writeUint16(central, 0);
        writeUint16(central, 0);
        writeUint32(central, 0);
        writeUint32(central, offset);
        centralParts.push(concatBytes([new Uint8Array(central), nameBytes]));
        offset += localBytes.length;
    }

    const centralDirectory = concatBytes(centralParts);
    const end = [];
    writeUint32(end, 0x06054b50);
    writeUint16(end, 0);
    writeUint16(end, 0);
    writeUint16(end, entries.length);
    writeUint16(end, entries.length);
    writeUint32(end, centralDirectory.length);
    writeUint32(end, offset);
    writeUint16(end, 0);

    return concatBytes([...localParts, centralDirectory, new Uint8Array(end)]);
}

function worksheetCell(rowIndex, colIndex, value) {
    const ref = `${columnName(colIndex)}${rowIndex + 1}`;
    if (typeof value === "number" && Number.isFinite(value)) {
        return `<c r="${ref}"><v>${value}</v></c>`;
    }
    return `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`;
}

function createXlsxBlob(rows) {
    const sheetRows = rows.map((row, rowIndex) => (
        `<row r="${rowIndex + 1}">${row.map((cell, colIndex) => worksheetCell(rowIndex, colIndex, cell)).join("")}</row>`
    )).join("");
    const entries = [
        {
            name: "[Content_Types].xml",
            content: `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`,
        },
        {
            name: "_rels/.rels",
            content: `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
        },
        {
            name: "xl/workbook.xml",
            content: `<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="Pre Post Scores" sheetId="1" r:id="rId1"/></sheets>
</workbook>`,
        },
        {
            name: "xl/_rels/workbook.xml.rels",
            content: `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`,
        },
        {
            name: "xl/worksheets/sheet1.xml",
            content: `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetData>${sheetRows}</sheetData>
</worksheet>`,
        },
    ];

    return new Blob([createStoredZip(entries)], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
}

const QUESTION_BANK_TARGETS = [
    {
        value: "quiz_question_bank",
        label: "Quiz Question Bank",
        bank_type: "quiz_question_bank",
        count: 5,
    },
    {
        value: "exercise_multiple_choice",
        label: "Individual Exercise Question Bank",
        bank_type: "individual_questions",
        individual_question_type: "exercise_multiple_choice",
        count: 5,
    },
    {
        value: "pre_test_multiple_choice",
        label: "Pre-test Question Bank",
        bank_type: "individual_questions",
        individual_question_type: "pre_test_multiple_choice",
        count: 20,
    },
    {
        value: "post_test_multiple_choice",
        label: "Post-test Question Bank",
        bank_type: "individual_questions",
        individual_question_type: "post_test_multiple_choice",
        count: 20,
    },
    {
        value: "exercise_case_study",
        label: "Individual Case Study Bank",
        bank_type: "individual_questions",
        individual_question_type: "exercise_case_study",
        count: 15,
    },
    {
        value: "topic_cases",
        label: "Group Case Studies",
        bank_type: "topic_cases",
        count: 15,
    },
];

function getQuestionBankTarget(settings) {
    if (settings.bank_type === "individual_questions") {
        return settings.individual_question_type || "exercise_multiple_choice";
    }
    return settings.bank_type || "quiz_question_bank";
}

const AdminPage = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const activeConfig = useMemo(() => getConfig(location.pathname), [location.pathname]);
    const [admin, setAdmin] = useState(null);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState("");
    const [rows, setRows] = useState([]);
    const [references, setReferences] = useState({instructors: [], courses: [], course_groups: [], roles: [], useradmin_users: [], students: []});
    const [editingRow, setEditingRow] = useState(null);
    const [formData, setFormData] = useState({});
    const [openMenus, setOpenMenus] = useState({
        "admin-config": true,
        "course-master": true,
        "question-bank": true,
    });
    const [loginForm, setLoginForm] = useState({
        username: "",
        password: "",
    });
    const [passwordForm, setPasswordForm] = useState({
        current_password: "",
        new_password: "",
        confirm_password: "",
    });
    const [materials, setMaterials] = useState([]);
    const [materialForm, setMaterialForm] = useState({
        topic_id: "",
        title: "",
        content_text: "",
    });
    const [editingMaterial, setEditingMaterial] = useState(null);
    const [questionSettings, setQuestionSettings] = useState({
        topic_id: "",
        material_ids: [],
        bank_type: "quiz_question_bank",
        activity_type: "exercise",
        question_kind: "multiple_choice",
        individual_question_type: "exercise_multiple_choice",
        openai_model: "gpt-5.4-mini",
        count: 5,
    });
    const [drafts, setDrafts] = useState([]);
    const [draftMeta, setDraftMeta] = useState(null);
    const [bankRows, setBankRows] = useState([]);
    const [bankPage, setBankPage] = useState(1);
    const [bankForm, setBankForm] = useState({});
    const [editingBankRow, setEditingBankRow] = useState(null);
    const [bankFilters, setBankFilters] = useState({activity_type: "", question_kind: ""});
    const [showScrollTop, setShowScrollTop] = useState(false);
    const [selectedStudentIds, setSelectedStudentIds] = useState([]);
    const [selectedBankIds, setSelectedBankIds] = useState([]);
    const [topicReset, setTopicReset] = useState({
        topic_id: "",
        course_id: "",
        course_group_id: "",
        search: "",
        activity_types: ["pre_test"],
        user_ids: [],
    });
    const [studentBulk, setStudentBulk] = useState({
        course_id: "",
        course_group_id: "",
        search: "",
        target_course_group_id: "",
    });
    const [instructorDashboard, setInstructorDashboard] = useState(null);
    const [selectedDashboardCourseId, setSelectedDashboardCourseId] = useState(() => readDashboardCourseSession());
    const [selectedDashboardTopicId, setSelectedDashboardTopicId] = useState("");
    const [activeWeeklyPeriodByGroup, setActiveWeeklyPeriodByGroup] = useState({});

    const displayedRows = useMemo(() => {
        if (activeConfig?.resource !== "students") return rows;
        const search = studentBulk.search.trim().toLowerCase();
        return rows.filter((row) => {
            if (studentBulk.course_id && String(row.course_id) !== String(studentBulk.course_id)) return false;
            if (studentBulk.course_group_id && String(row.course_group_id) !== String(studentBulk.course_group_id)) return false;
            if (!search) return true;
            return [row.name, row.email, row.course_name, row.course_group_name, row.role_name]
                .some((value) => String(value || "").toLowerCase().includes(search));
        });
    }, [activeConfig, rows, studentBulk]);
    const topicResetStudents = useMemo(() => {
        const search = topicReset.search.trim().toLowerCase();
        return (references.students || []).filter((student) => {
            if (topicReset.course_id && String(student.course_id) !== String(topicReset.course_id)) return false;
            if (topicReset.course_group_id && String(student.course_group_id) !== String(topicReset.course_group_id)) return false;
            if (!search) return true;
            return [student.name, student.email, student.course_name, student.course_group_name]
                .some((value) => String(value || "").toLowerCase().includes(search));
        });
    }, [references.students, topicReset]);
    const visibleMenuGroups = useMemo(() => {
        const isAdmin = String(admin?.role || "").toLowerCase() === "admin";
        return MENU_GROUPS.filter((group) => isAdmin || group.key !== "admin-config");
    }, [admin?.role]);
    const dashboardCourses = useMemo(() => instructorDashboard?.courses || [], [instructorDashboard]);
    const selectedDashboardCourse = useMemo(() => {
        if (!dashboardCourses.length) return null;
        return dashboardCourses.find((course) => String(course.course_id) === String(selectedDashboardCourseId)) || dashboardCourses[0];
    }, [dashboardCourses, selectedDashboardCourseId]);
    const selectedDashboardTopic = useMemo(() => {
        const topics = selectedDashboardCourse?.topics || [];
        if (!topics.length) return null;
        return topics.find((topic) => String(topic.topic_id) === String(selectedDashboardTopicId)) || topics[0];
    }, [selectedDashboardCourse, selectedDashboardTopicId]);

    useEffect(() => {
        if (!dashboardCourses.length) return;
        const selectedExists = dashboardCourses.some((course) => String(course.course_id) === String(selectedDashboardCourseId));
        if (selectedExists) {
            writeDashboardCourseSession(selectedDashboardCourseId);
            return;
        }

        const storedCourseId = readDashboardCourseSession();
        const storedCourse = dashboardCourses.find((course) => String(course.course_id) === String(storedCourseId));
        const nextCourseId = storedCourse?.course_id || dashboardCourses[0]?.course_id || "";
        if (nextCourseId) {
            setSelectedDashboardCourseId(nextCourseId);
            writeDashboardCourseSession(nextCourseId);
        }
    }, [dashboardCourses, selectedDashboardCourseId]);

    useEffect(() => {
        let active = true;
        apiGet("/admin/session")
            .then((data) => {
                if (!active) return;
                if (data.loggedIn) setAdmin(data.admin);
            })
            .finally(() => {
                if (active) setLoading(false);
            });
        return () => {
            active = false;
        };
    }, []);

    useEffect(() => {
        if (!admin) return;
        apiGet("/admin/references").then((data) => {
            if (!data.message) setReferences(data);
        });
    }, [admin]);

    useEffect(() => {
        if (!admin || activeConfig) return undefined;
        let active = true;
        setBusy(true);
        apiGet("/instructor/dashboard")
            .then((data) => {
                if (!active) return;
                if (data.message && !data.courses) {
                    setMessage(data.message);
                    setInstructorDashboard(null);
                    return;
                }
                setInstructorDashboard(data);
                const firstCourse = data.courses?.[0];
                setSelectedDashboardCourseId((current) => current || firstCourse?.course_id || "");
                setSelectedDashboardTopicId((current) => current || firstCourse?.topics?.[0]?.topic_id || "");
            })
            .finally(() => {
                if (active) setBusy(false);
            });
        return () => {
            active = false;
        };
    }, [admin, activeConfig]);

    useEffect(() => {
        if (!selectedDashboardCourse) return;
        const topicExists = selectedDashboardCourse.topics?.some((topic) => String(topic.topic_id) === String(selectedDashboardTopicId));
        if (!topicExists) {
            setSelectedDashboardTopicId(selectedDashboardCourse.topics?.[0]?.topic_id || "");
        }
    }, [selectedDashboardCourse, selectedDashboardTopicId]);

    useEffect(() => {
        const handleScroll = () => {
            setShowScrollTop(window.scrollY > 650);
        };
        handleScroll();
        window.addEventListener("scroll", handleScroll, {passive: true});
        return () => window.removeEventListener("scroll", handleScroll);
    }, []);

    useEffect(() => {
        setEditingRow(null);
        setFormData({});
        setEditingBankRow(null);
        setBankForm({});
        setBankPage(1);
        setBankFilters({activity_type: "", question_kind: ""});
        setSelectedStudentIds([]);
        setSelectedBankIds([]);
        setStudentBulk({course_id: "", course_group_id: "", search: "", target_course_group_id: ""});
        setTopicReset({topic_id: "", course_id: "", course_group_id: "", search: "", activity_types: ["pre_test"], user_ids: []});
        setMessage("");
        if (admin && activeConfig?.resource) {
            setBusy(true);
            apiGet(`/admin/resources/${activeConfig.resource}`)
                .then((data) => {
                    setRows(data.rows || []);
                    if (data.message) setMessage(data.message);
                })
                .finally(() => setBusy(false));
        }
        if (admin && activeConfig?.custom === "questionBank") {
            loadMaterials();
        }
        if (admin && activeConfig?.custom === "bankManager") {
            setBusy(true);
            apiGet(`/admin/question-bank/${activeConfig.bankType}`)
                .then((data) => {
                    setBankRows(data.rows || []);
                    setBankPage(1);
                    if (data.message) setMessage(data.message);
                })
                .finally(() => setBusy(false));
        }
    }, [admin, activeConfig]);

    const loadRows = async (config = activeConfig) => {
        if (!config) return;
        setBusy(true);
        const data = await apiGet(`/admin/resources/${config.resource}`);
        setRows(data.rows || []);
        if (data.message) setMessage(data.message);
        setBusy(false);
    };

    const refreshReferences = async () => {
        const data = await apiGet("/admin/references");
        if (!data.message) setReferences(data);
    };

    const loadMaterials = async (topicId = "") => {
        const query = topicId ? `?topic_id=${topicId}` : "";
        const data = await apiGet(`/admin/materials${query}`);
        setMaterials(data.materials || []);
    };

    const loadBankRows = async (bankType = activeConfig?.bankType) => {
        if (!bankType) return;
        setBusy(true);
        const data = await apiGet(`/admin/question-bank/${bankType}`);
        setBankRows(data.rows || []);
        setBankPage(1);
        setSelectedBankIds([]);
        if (data.message) setMessage(data.message);
        setBusy(false);
    };

    const handleLoginChange = (event) => {
        setLoginForm({...loginForm, [event.target.name]: event.target.value});
    };

    const handleLogin = async (event) => {
        event.preventDefault();
        setBusy(true);
        setMessage("");
        const data = await apiPost("/admin/login", loginForm);
        if (data.admin) {
            setAdmin(data.admin);
            setLoginForm({username: "", password: ""});
        } else {
            setMessage(data.message || "Login admin gagal.");
        }
        setBusy(false);
    };

    const handleLogout = async () => {
        setBusy(true);
        await apiPost("/admin/logout", {});
        setAdmin(null);
        setRows([]);
        setEditingRow(null);
        setBusy(false);
        navigate(DEFAULT_PATH);
    };

    const handlePasswordChange = (event) => {
        setPasswordForm({...passwordForm, [event.target.name]: event.target.value});
    };

    const handleChangePassword = async (event) => {
        event.preventDefault();
        setMessage("");
        if (passwordForm.new_password !== passwordForm.confirm_password) {
            setMessage("New password dan confirmation password tidak sama.");
            return;
        }
        setBusy(true);
        const data = await apiPost("/admin/change-password", {
            current_password: passwordForm.current_password,
            new_password: passwordForm.new_password,
        });
        if (data.message) setMessage(data.message);
        if (data.loggedOut) {
            setAdmin(null);
            setRows([]);
            setPasswordForm({current_password: "", new_password: "", confirm_password: ""});
            navigate(DEFAULT_PATH);
        }
        setBusy(false);
    };

    const toggleMenu = (key) => {
        setOpenMenus((current) => ({...current, [key]: !current[key]}));
    };

    const scrollToTop = () => {
        window.scrollTo({top: 0, behavior: "smooth"});
    };

    const openAddForm = () => {
        setEditingRow(null);
        setFormData(emptyForm(activeConfig));
        setMessage("");
    };

    const openEditForm = (row) => {
        setEditingRow(row);
        setFormData(buildForm(activeConfig, row));
        setMessage("");
    };

    const updateForm = (field, value) => {
        setFormData((current) => {
            const next = {...current, [field]: value};
            if (field === "course_id" && next.course_group_id) {
                const groupStillValid = (references.course_groups || []).some((group) => (
                    String(group.course_group_id) === String(next.course_group_id)
                    && String(group.course_id) === String(value)
                ));
                if (!groupStillValid) next.course_group_id = "";
            }
            if (activeConfig?.resource === "useradmins" && field === "role" && value === "admin") {
                next.user_id = "";
            }
            return next;
        });
    };

    const handleSave = async (event) => {
        event.preventDefault();
        if (!activeConfig) return;

        setBusy(true);
        setMessage("");
        const id = editingRow?.[activeConfig.idKey];
        const data = id
            ? await apiPatch(`/admin/resources/${activeConfig.resource}/${id}`, formData)
            : await apiPost(`/admin/resources/${activeConfig.resource}`, formData);

        if (data.message) setMessage(data.message);
        if (data.data) {
            setEditingRow(null);
            setFormData({});
            await Promise.all([loadRows(activeConfig), refreshReferences()]);
        }
        setBusy(false);
    };

    const handleDelete = async (row) => {
        if (!activeConfig || !activeConfig.canDelete) return;
        if (activeConfig.resource === "useradmins" && String(row.username || "").toLowerCase() === "admin") {
            setMessage("Default admin user tidak bisa dihapus.");
            return;
        }
        const label = row.username || row.group_name || row.course_name || row.topic_name || "data ini";
        if (!window.confirm(`Hapus ${label}? Data akan dihapus secara soft-delete.`)) return;

        setBusy(true);
        const data = await apiDelete(`/admin/resources/${activeConfig.resource}/${row[activeConfig.idKey]}`);
        if (data.message) setMessage(data.message);
        await Promise.all([loadRows(activeConfig), refreshReferences()]);
        setBusy(false);
    };

    const courseGroupOptions = (courseId = "") => (
        (references.course_groups || [])
            .filter((group) => !courseId || String(group.course_id) === String(courseId))
    );

    const updateStudentBulk = (key, value) => {
        setStudentBulk((current) => {
            const next = {...current, [key]: value};
            if (key === "course_id") {
                next.course_group_id = "";
                next.target_course_group_id = "";
            }
            return next;
        });
        setSelectedStudentIds([]);
    };

    const toggleStudentSelection = (userId) => {
        setSelectedStudentIds((current) => (
            current.map(String).includes(String(userId))
                ? current.filter((id) => String(id) !== String(userId))
                : [...current, userId]
        ));
    };

    const setAllDisplayedStudentsSelected = (checked) => {
        setSelectedStudentIds(checked ? displayedRows.map((row) => row.user_id) : []);
    };

    const openTopicAssessmentReset = (topic) => {
        setTopicReset({
            topic_id: topic.topic_id,
            course_id: topic.course_id,
            course_group_id: "",
            search: "",
            activity_types: ["pre_test"],
            user_ids: [],
        });
        setMessage("");
    };

    const updateTopicReset = (key, value) => {
        setTopicReset((current) => ({
            ...current,
            [key]: value,
            user_ids: key === "course_group_id" || key === "search" ? current.user_ids : current.user_ids,
        }));
    };

    const toggleTopicResetActivity = (activityType) => {
        setTopicReset((current) => {
            const exists = current.activity_types.includes(activityType);
            const nextTypes = exists
                ? current.activity_types.filter((type) => type !== activityType)
                : [...current.activity_types, activityType];
            return {...current, activity_types: nextTypes};
        });
    };

    const toggleTopicResetStudent = (userId) => {
        setTopicReset((current) => {
            const selected = current.user_ids.map(String).includes(String(userId));
            return {
                ...current,
                user_ids: selected
                    ? current.user_ids.filter((id) => String(id) !== String(userId))
                    : [...current.user_ids, userId],
            };
        });
    };

    const setAllTopicResetStudentsSelected = (checked) => {
        setTopicReset((current) => ({
            ...current,
            user_ids: checked ? topicResetStudents.map((student) => student.user_id) : [],
        }));
    };

    const resetTopicAssessmentAttempts = async () => {
        if (!topicReset.topic_id || topicReset.user_ids.length === 0 || topicReset.activity_types.length === 0) {
            setMessage("Pilih assessment dan student terlebih dahulu.");
            return;
        }
        const typeLabel = topicReset.activity_types
            .map((type) => type === "pre_test" ? "Pre-test" : "Post-test")
            .join(" dan ");
        if (!window.confirm(`Hapus hasil ${typeLabel} untuk ${topicReset.user_ids.length} student terpilih? Data hasil yang dihapus tidak bisa dikembalikan.`)) return;

        setBusy(true);
        const data = await apiPost(`/admin/topics/${topicReset.topic_id}/reset-assessments`, {
            user_ids: topicReset.user_ids,
            activity_types: topicReset.activity_types,
        });
        if (data.message) setMessage(data.message);
        if (data.data) {
            setTopicReset((current) => ({...current, user_ids: []}));
        }
        setBusy(false);
    };

    const toggleBankSelection = (id) => {
        setSelectedBankIds((current) => (
            current.map(String).includes(String(id))
                ? current.filter((selectedId) => String(selectedId) !== String(id))
                : [...current, id]
        ));
    };

    const setAllPageBankSelected = (checked, ids) => {
        setSelectedBankIds((current) => {
            const pageIdStrings = ids.map(String);
            if (!checked) return current.filter((id) => !pageIdStrings.includes(String(id)));
            const merged = new Set([...current.map(String), ...pageIdStrings]);
            return Array.from(merged);
        });
    };

    const bulkDeleteBankItems = async (ids = selectedBankIds) => {
        if (!activeConfig?.bankType || ids.length === 0) return;
        if (!window.confirm(`Hapus ${ids.length} item question bank terpilih? Item akan dinonaktifkan dan tidak dipakai untuk aktivitas baru.`)) return;

        setBusy(true);
        const data = await apiPost(`/admin/question-bank/${activeConfig.bankType}/bulk-delete`, {ids});
        if (data.message) setMessage(data.message);
        if (data.data) {
            setSelectedBankIds([]);
            await loadBankRows(activeConfig.bankType);
        }
        setBusy(false);
    };

    const assignStudentsToGroup = async (userIds) => {
        if (!studentBulk.target_course_group_id || userIds.length === 0) return;
        setBusy(true);
        setMessage("");
        const data = await apiPatch("/admin/course-groups/students", {
            course_group_id: studentBulk.target_course_group_id,
            user_ids: userIds,
        });
        if (data.message) setMessage(data.message);
        if (data.data) {
            setSelectedStudentIds([]);
            await Promise.all([loadRows(activeConfig), refreshReferences()]);
        }
        setBusy(false);
    };

    const renderReferenceOptions = (field) => {
        let options = references[field.reference] || [];
        if (field.dependsOn && formData[field.dependsOn]) {
            options = options.filter((option) => String(option[field.dependsOn]) === String(formData[field.dependsOn]));
        }
        if (field.reference === "useradmin_users" && formData.role === "instructor") {
            options = options.filter((option) => String(option.role_name || "").toLowerCase() === "instructor");
        }
        return options.map((option) => {
            const value = field.valueKey ? option[field.valueKey] : option.instructor_id ?? option.course_id;
            const label = field.labelKey
                ? option[field.labelKey]
                : option.instructor_name || option.course_name;
            return (
                <option key={value} value={value}>
                    {field.reference === "course_groups"
                        ? `${option.course_name} - ${label}`
                        : field.reference === "useradmin_users"
                            ? `${label}${option.email ? ` (${option.email})` : ""}`
                            : label}
                </option>
            );
        });
    };

    const renderTopicOptions = () => (
        (references.topics || []).map((topic) => (
            <option key={topic.topic_id} value={topic.topic_id}>
                {topic.course_name} - {topic.topic_name}
            </option>
        ))
    );

    const renderField = (field) => {
        const value = formData[field.key];
        const selectedRole = (references.roles || []).find((role) => String(role.role_id) === String(formData.role_id));
        const isInstructorSelected = String(selectedRole?.role_name || "").toLowerCase() === "instructor";
        const isOptionalInstructorGroup = activeConfig?.resource === "students"
            && field.key === "course_group_id"
            && isInstructorSelected;

        if (field.type === "select") {
            const options = field.options || null;
            return (
                <select
                    value={value}
                    onChange={(event) => updateForm(field.key, event.target.value)}
                    required={isOptionalInstructorGroup ? false : field.required}
                >
                    <option value="">Choose {field.label}</option>
                    {options
                        ? options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)
                        : renderReferenceOptions(field)}
                </select>
            );
        }

        if (field.type === "checkbox") {
            return (
                <label className="admin-checkbox">
                    <input
                        type="checkbox"
                        checked={value !== false}
                        onChange={(event) => updateForm(field.key, event.target.checked)}
                    />
                    <span>{value !== false
                        ? field.trueLabel || "Shown to students"
                        : field.falseLabel || "Hidden from students"}</span>
                </label>
            );
        }

        return (
            <input
                type={field.type || "text"}
                value={value ?? ""}
                placeholder={field.placeholder || ""}
                onChange={(event) => updateForm(field.key, event.target.value)}
                required={field.required || (field.requiredOnCreate && !editingRow)}
            />
        );
    };

    const isFormFieldVisible = (field) => {
        if (!field.visibleForSettingTypes) return true;
        const settingType = editingRow?.setting_type || formData.setting_type;
        return field.visibleForSettingTypes.includes(settingType);
    };

    const saveMaterial = async (event) => {
        event.preventDefault();
        setBusy(true);
        setMessage("");
        const data = editingMaterial
            ? await apiPatch(`/admin/materials/${editingMaterial.material_id}`, materialForm)
            : await apiPost("/admin/materials", materialForm);
        if (data.message) setMessage(data.message);
        if (data.data) {
            setEditingMaterial(null);
            setMaterialForm({topic_id: "", title: "", content_text: ""});
            await loadMaterials(questionSettings.topic_id);
        }
        setBusy(false);
    };

    const editMaterial = (material) => {
        setEditingMaterial(material);
        setMaterialForm({
            topic_id: material.topic_id,
            title: material.title,
            content_text: material.content_text,
        });
    };

    const removeMaterial = async (material) => {
        if (!window.confirm(`Hapus materi "${material.title}"?`)) return;
        setBusy(true);
        const data = await apiDelete(`/admin/materials/${material.material_id}`);
        if (data.message) setMessage(data.message);
        await loadMaterials(questionSettings.topic_id);
        setBusy(false);
    };

    const generateDigest = async (material) => {
        setBusy(true);
        setMessage("Generating compact digest from material...");
        const data = await apiPost(`/admin/materials/${material.material_id}/digest`, {});
        if (data.message) setMessage(data.message);
        await loadMaterials(questionSettings.topic_id);
        setBusy(false);
    };

    const updateQuestionSettings = async (key, value) => {
        const next = {...questionSettings, [key]: value};
        if (key === "topic_id") {
            next.material_ids = [];
            await loadMaterials(value);
        }
        if (key === "bank_type" && value === "quiz_question_bank") {
            next.activity_type = "exercise";
            next.question_kind = "multiple_choice";
            next.individual_question_type = "exercise_multiple_choice";
            next.count = 5;
        }
        if (key === "bank_type" && value === "topic_cases") {
            next.activity_type = "exercise";
            next.question_kind = "case_study";
            next.individual_question_type = "exercise_case_study";
            next.count = 1;
        }
        if (key === "bank_type" && value === "individual_questions") {
            const type = next.individual_question_type || "exercise_multiple_choice";
            next.activity_type = getActivityFromType(type);
            next.question_kind = getQuestionKindFromType(type);
            next.count = getQuestionKindFromType(type) === "case_study" ? 1 : 5;
        }
        if (key === "individual_question_type") {
            next.activity_type = getActivityFromType(value);
            next.question_kind = getQuestionKindFromType(value);
            next.count = getQuestionKindFromType(value) === "case_study" ? Math.min(Number(next.count) || 1, 15) : next.count;
        }
        setQuestionSettings(next);
        setDrafts([]);
        setDraftMeta(null);
    };

    const updateQuestionBankTarget = (value) => {
        const target = QUESTION_BANK_TARGETS.find((item) => item.value === value) || QUESTION_BANK_TARGETS[0];
        const next = {
            ...questionSettings,
            bank_type: target.bank_type,
            count: target.count,
        };

        if (target.bank_type === "individual_questions") {
            next.individual_question_type = target.individual_question_type;
            next.activity_type = getActivityFromType(target.individual_question_type);
            next.question_kind = getQuestionKindFromType(target.individual_question_type);
        } else if (target.bank_type === "topic_cases") {
            next.activity_type = "exercise";
            next.question_kind = "case_study";
            next.individual_question_type = "exercise_case_study";
        } else {
            next.activity_type = "exercise";
            next.question_kind = "multiple_choice";
            next.individual_question_type = "exercise_multiple_choice";
        }

        setQuestionSettings(next);
        setDrafts([]);
        setDraftMeta(null);
    };

    const toggleMaterialSelection = (materialId) => {
        setQuestionSettings((current) => {
            const currentIds = current.material_ids || [];
            const id = String(materialId);
            const nextIds = currentIds.map(String).includes(id)
                ? currentIds.filter((item) => String(item) !== id)
                : [...currentIds, id];
            return {...current, material_ids: nextIds};
        });
        setDrafts([]);
        setDraftMeta(null);
    };

    const generateDrafts = async (event) => {
        event.preventDefault();
        setBusy(true);
        setMessage("Generating question drafts from saved digest/material...");
        const data = await apiPost("/admin/question-bank/generate", questionSettings);
        if (data.message) setMessage(data.message);
        setDrafts(data.items || []);
        setDraftMeta(data.items ? data : null);
        setBusy(false);
    };

    const getBankQuestionType = () => {
        if (questionSettings.bank_type === "topic_cases") return "case_study";
        if (questionSettings.bank_type === "individual_questions") {
            return getQuestionKindFromType(questionSettings.individual_question_type);
        }
        return "multiple_choice";
    };

    const updateDraft = (index, key, value) => {
        setDrafts((current) => current.map((item, itemIndex) => (
            itemIndex === index ? {...item, [key]: value} : item
        )));
    };

    const updateDraftChoice = (index, choiceIndex, value) => {
        setDrafts((current) => current.map((item, itemIndex) => {
            if (itemIndex !== index) return item;
            const choices = [...(item.choices || [])];
            choices[choiceIndex] = value;
            return {...item, choices};
        }));
    };

    const removeDraft = (index) => {
        setDrafts((current) => current.filter((_, itemIndex) => itemIndex !== index));
    };

    const saveDrafts = async () => {
        setBusy(true);
        const data = await apiPost("/admin/question-bank/save", {
            ...questionSettings,
            items: drafts,
        });
        if (data.message) setMessage(data.message);
        setDrafts([]);
        setDraftMeta(null);
        setBusy(false);
    };

    const emptyBankForm = (bankType) => {
        if (bankType === "quiz_question_bank") {
            return {
                topic_id: "",
                question_number: "",
                question_text: "",
                choices_text: "",
                correct_answer_index: 0,
                explanation: "",
            };
        }
        if (bankType === "individual_questions") {
            return {
                topic_id: "",
                individual_question_type: "exercise_multiple_choice",
                activity_type: "exercise",
                question_kind: "multiple_choice",
                question_number: "",
                question_text: "",
                choices_text: "",
                correct_answer_index: 0,
                explanation: "",
                case_title: "",
                case_prompt: "",
            };
        }
        return {
            topic_id: "",
            case_number: 1,
            case_title: "",
            case_prompt: "",
        };
    };

    const buildBankForm = (bankType, row) => {
        if (bankType === "quiz_question_bank") {
            return {
                topic_id: row.topic_id,
                question_number: row.question_number,
                question_text: row.question_text || "",
                choices_text: (row.choices || []).join("\n"),
                correct_answer_index: row.correct_answer_index ?? 0,
                explanation: row.explanation || "",
            };
        }
        if (bankType === "individual_questions") {
            const type = getIndividualTypeFromRow(row);
            return {
                topic_id: row.topic_id,
                individual_question_type: type,
                activity_type: getActivityFromType(type),
                question_kind: getQuestionKindFromType(type),
                question_number: row.question_number,
                question_text: row.question_text || "",
                choices_text: (row.choices || []).join("\n"),
                correct_answer_index: row.correct_answer_index ?? 0,
                explanation: row.explanation || "",
                case_title: row.case_title || "",
                case_prompt: row.case_prompt || "",
            };
        }
        return {
            topic_id: row.topic_id,
            case_number: row.case_number,
            case_title: row.case_title || "",
            case_prompt: row.case_prompt || "",
        };
    };

    const openBankAddForm = () => {
        setEditingBankRow(null);
        setBankForm(emptyBankForm(activeConfig.bankType));
        setMessage("");
    };

    const openBankEditForm = (row) => {
        setEditingBankRow(row);
        setBankForm(buildBankForm(activeConfig.bankType, row));
        setMessage("");
    };

    const updateBankForm = (key, value) => {
        setBankForm((current) => {
            const next = {...current, [key]: value};
            if (key === "individual_question_type") {
                next.activity_type = getActivityFromType(value);
                next.question_kind = getQuestionKindFromType(value);
            }
            return next;
        });
    };

    const saveBankItem = async (event) => {
        event.preventDefault();
        const bankType = activeConfig.bankType;
        const config = BANK_CONFIGS[bankType];
        const id = editingBankRow?.[config.idKey];
        const payload = {
            ...bankForm,
            activity_type: bankType === "individual_questions"
                ? getActivityFromType(bankForm.individual_question_type)
                : bankForm.activity_type,
            question_kind: bankType === "individual_questions"
                ? getQuestionKindFromType(bankForm.individual_question_type)
                : bankType === "topic_cases" ? "case_study" : "multiple_choice",
        };
        setBusy(true);
        setMessage("");
        const data = id
            ? await apiPatch(`/admin/question-bank/${bankType}/${id}`, payload)
            : await apiPost(`/admin/question-bank/${bankType}`, payload);
        if (data.message) setMessage(data.message);
        if (data.data) {
            setBankForm({});
            setEditingBankRow(null);
            await loadBankRows(bankType);
        }
        setBusy(false);
    };

    const renderChoicesPreview = (choices = [], correctAnswerIndex = null) => (
        <ol className="admin-choice-preview">
            {(choices || []).map((choice, index) => {
                const isCorrect = Number(correctAnswerIndex) === index;
                return (
                    <li className={isCorrect ? "is-correct" : ""} key={index}>
                        <span>{choice}</span>
                        {isCorrect && <b>Correct</b>}
                    </li>
                );
            })}
        </ol>
    );

    const exportSelectedTopicAssessments = () => {
        const rows = (selectedDashboardTopic?.groups || []).flatMap((group) => (
            (group.assessment_comparison || []).map((student) => {
                const groupStudent = (group.students || []).find((item) => String(item.user_id) === String(student.user_id));
                return {
                    group_name: group.group_name || "Ungrouped",
                    student_email: groupStudent?.email || "",
                    student_name: student.student_name,
                    pre_score: student.pre_score ?? "",
                    post_score: student.post_score ?? "",
                    improvement: student.improvement ?? "",
                };
            })
        ));

        if (!rows.length) {
            setMessage("No pre-test and post-test data available for this topic.");
            return;
        }

        const workbookRows = [
            ["Course", "Topic", "Group", "Student Email", "Student", "Pre-test Score", "Post-test Score", "Improvement"],
            ...rows.map((row) => [
                selectedDashboardCourse?.course_name || "",
                selectedDashboardTopic?.topic_name || "",
                row.group_name,
                row.student_email,
                row.student_name,
                row.pre_score === "" ? "" : Number(row.pre_score),
                row.post_score === "" ? "" : Number(row.post_score),
                row.improvement === "" ? "" : Number(row.improvement),
            ]),
        ];
        const blob = createXlsxBlob(workbookRows);
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `${slugifyFilePart(selectedDashboardCourse?.course_name)}-${slugifyFilePart(selectedDashboardTopic?.topic_name)}-pre-post.xlsx`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };

    const renderBaselineStudent = (student) => (
        <article key={student.user_id}>
            <div className="student-identity">
                <b>{student.name}</b>
                <small>{student.email || "No email"}</small>
            </div>
            <div className="weekly-baseline-counts">
                {Object.entries(WEEKLY_BASELINE).map(([kind, required]) => {
                    const value = student.counts[kind] || 0;
                    return (
                        <span className={value >= required ? "is-met" : "is-pending"} key={kind}>
                            {weeklyKindLabel(kind)} {value}/{required}
                        </span>
                    );
                })}
            </div>
        </article>
    );

    const renderWeeklyActivityProgress = (group) => {
        const weeks = weeklyProgressForGroup(selectedDashboardCourse, group);
        const topicProgress = topicProgressForGroup(selectedDashboardCourse, group);
        const periodGroupKey = `${selectedDashboardCourse?.course_id || "course"}:${group.course_group_id || "ungrouped"}`;
        const activeWeekKey = activeWeeklyPeriodByGroup[periodGroupKey];
        const topicSessionTotal = topicProgress.reduce((total, topic) => (
            total + Object.values(topic.totals).reduce((sum, value) => sum + value, 0)
        ), 0);
        const showTopicProgress = activeWeekKey === TOPIC_PROGRESS_TAB_KEY;
        const activeWeek = weeks.find((week) => week.key === activeWeekKey) || weeks[0];
        const renderProgressCard = (progress, label, note) => (
            <section className="weekly-progress-card" key={progress.key}>
                <header>
                    <div>
                        <span>{label}</span>
                        <h4>{progress.label}</h4>
                        {progress.sub_label && <p>{progress.sub_label}</p>}
                        {!progress.sub_label && progress.topic_names.length > 0 && <p>{progress.topic_names.join(", ")}</p>}
                    </div>
                    <small>{note}</small>
                </header>
                <div className="weekly-session-totals">
                    {Object.entries(WEEKLY_BASELINE).map(([kind]) => (
                        <article key={kind}>
                            <span>{weeklyKindLabel(kind)}</span>
                            <strong>{formatAdminNumber(progress.totals[kind])}</strong>
                            <small>sessions</small>
                        </article>
                    ))}
                </div>
                <div className="weekly-student-grid">
                    <section className="weekly-student-list weekly-student-list--met">
                        <header>
                            <strong>Baseline met</strong>
                            <span>{formatAdminNumber(progress.students_met.length)} students</span>
                        </header>
                        <div>
                            {progress.students_met.map(renderBaselineStudent)}
                            {progress.students_met.length === 0 && <p>No students have met all baseline criteria yet.</p>}
                        </div>
                    </section>
                    <section className="weekly-student-list weekly-student-list--pending">
                        <header>
                            <strong>Needs progress</strong>
                            <span>{formatAdminNumber(progress.students_pending.length)} students</span>
                        </header>
                        <div>
                            {progress.students_pending.map(renderBaselineStudent)}
                            {progress.students_pending.length === 0 && <p>Every student has met the baseline.</p>}
                        </div>
                    </section>
                </div>
            </section>
        );

        return (
            <div className="weekly-progress">
                <div className="weekly-progress-note">
                    Activity totals are counted by completed/saved sessions. Student baseline status is counted by each student's participation.
                </div>
                <div className="weekly-baseline-rules">
                    {Object.entries(WEEKLY_BASELINE).map(([kind, required]) => (
                        <span key={kind}>{weeklyKindLabel(kind)} min {required}</span>
                    ))}
                </div>
                {(weeks.length > 0 || topicProgress.length > 0) && (
                    <div className="weekly-period-tabs" aria-label="Weekly period filter">
                        <button
                            type="button"
                            className={showTopicProgress ? "is-active" : ""}
                            onClick={() => setActiveWeeklyPeriodByGroup((current) => ({...current, [periodGroupKey]: TOPIC_PROGRESS_TAB_KEY}))}
                        >
                            <span>View mode</span>
                            <strong>By Topic</strong>
                            <small>{formatAdminNumber(topicSessionTotal)} sessions</small>
                        </button>
                        {weeks.map((week) => (
                            <button
                                key={week.key}
                                type="button"
                                className={!showTopicProgress && week.key === activeWeek.key ? "is-active" : ""}
                                onClick={() => setActiveWeeklyPeriodByGroup((current) => ({...current, [periodGroupKey]: week.key}))}
                            >
                                <span>Weekly period</span>
                                <strong>{week.label}</strong>
                                <small>{formatAdminNumber(Object.values(week.totals).reduce((total, value) => total + value, 0))} sessions</small>
                            </button>
                        ))}
                    </div>
                )}
                {showTopicProgress && (
                    <div className="topic-progress-list">
                        {topicProgress.map((topic) => renderProgressCard(topic, "Topic progress", "All submitted/saved activity data in this topic"))}
                        {topicProgress.length === 0 && <p>No topic activity data available for this group yet.</p>}
                    </div>
                )}
                {!showTopicProgress && activeWeek && (
                    renderProgressCard(activeWeek, "Weekly period", "Available submitted/saved activity data only")
                )}
                {weeks.length === 0 && <p>No weekly activity data available for this group yet.</p>}
            </div>
        );
    };

    const renderStudentsByXp = (group) => {
        const rankedStudents = studentsByXp(group);
        return (
            <div className="instructor-student-xp-list">
                {rankedStudents.map((student, index) => (
                    <div key={student.user_id || student.name}>
                        <b>{index + 1}</b>
                        <span>{student.name}</span>
                        <strong>{formatAdminNumber(student.total_xp)} XP</strong>
                        <small>{student.activities ? `${student.activities} XP activities` : "No XP activity yet"}</small>
                    </div>
                ))}
                {rankedStudents.length === 0 && <p>No student XP recorded yet.</p>}
            </div>
        );
    };

    const renderMissingAssessmentList = (title, students) => (
        <section className="missing-assessment-section">
            <header>
                <strong>{title}</strong>
                <span>{formatAdminNumber(students.length)} students</span>
            </header>
            <div>
                {students.map((student) => (
                    <article key={student.user_id}>
                        <div className="student-identity">
                            <b>{student.name}</b>
                            <small>{student.email || "No email"}</small>
                        </div>
                    </article>
                ))}
                {students.length === 0 && <p>All students have completed this assessment.</p>}
            </div>
        </section>
    );

    const renderGroupComparison = (groups) => {
        const rows = topicComparisonRows(groups);
        const maxIndividualXp = Math.max(0, ...rows.map((row) => row.individualXp));
        const maxGroupXp = Math.max(0, ...rows.map((row) => row.groupXp));
        const maxStudents = Math.max(0, ...groups.map((group) => Number(group.student_count || group.students?.length || 0)));

        return (
            <section className="instructor-comparison">
                <div className="instructor-comparison-header">
                    <div>
                        <span>Between Groups</span>
                        <h3>Topic comparison</h3>
                    </div>
                    <small>Group and quiz activity counts are counted by saved session.</small>
                </div>

                <div className="instructor-comparison-grid">
                    <article className="comparison-panel">
                        <h4>XP difference</h4>
                        <div className="comparison-bars">
                            {rows.map((row) => (
                                <div className="comparison-xp-group" key={`xp-${row.group.course_group_id}`}>
                                    <header>
                                        <strong>{row.groupName}</strong>
                                        <span>{formatAdminNumber(row.totalXp)} total XP · {row.xpPercent}% of leader</span>
                                    </header>
                                    <div className="comparison-xp-row">
                                        <span>Individual XP</span>
                                        <div className="comparison-bar-track">
                                            <i className="comparison-bar comparison-bar--individual" style={{width: `${barWidth(row.individualXp, maxIndividualXp)}%`}}/>
                                        </div>
                                        <b>{formatAdminNumber(row.individualXp)} XP</b>
                                    </div>
                                    <div className="comparison-xp-row">
                                        <span>Group XP</span>
                                        <div className="comparison-bar-track">
                                            <i className="comparison-bar comparison-bar--group" style={{width: `${barWidth(row.groupXp, maxGroupXp)}%`}}/>
                                        </div>
                                        <b>{formatAdminNumber(row.groupXp)} XP</b>
                                    </div>
                                    {row.xpDifference < 0 && <small>{formatAdminNumber(Math.abs(row.xpDifference))} XP behind leader</small>}
                                </div>
                            ))}
                        </div>
                    </article>

                    <article className="comparison-panel">
                        <h4>Activities done</h4>
                        <div className="comparison-activity-list">
                            {rows.map((row) => (
                                <div className="comparison-activity-row" key={`activity-${row.group.course_group_id}`}>
                                    <strong>{row.groupName}</strong>
                                    {[
                                        ["Individual MC", row.activityCounts.individual_mc, "individual"],
                                        ["Individual Case", row.activityCounts.individual_case, "case"],
                                        ["Group", row.activityCounts.group, "group"],
                                        ["Quiz", row.activityCounts.quiz, "quiz"],
                                    ].map(([label, value, className]) => (
                                        <div key={label}>
                                            <span>{label}</span>
                                            <i className={`comparison-mini-bar comparison-mini-bar--${className}`} style={{width: `${barWidth(value, row.totalActivities)}%`}}/>
                                            <b>{percentage(value, row.totalActivities)}%</b>
                                            <small>{formatAdminNumber(value)} of {formatAdminNumber(row.totalActivities)}</small>
                                        </div>
                                    ))}
                                </div>
                            ))}
                        </div>
                    </article>

                    <article className="comparison-panel comparison-panel--wide">
                        <h4>Students by level</h4>
                        <div className="comparison-levels">
                            {groups.map((group) => {
                                const groupTotal = Number(group.student_count || group.students?.length || 0);
                                return (
                                    <div className="comparison-level-group" key={`level-${group.course_group_id}`}>
                                        <header>
                                            <strong>{group.group_name || "Ungrouped"}</strong>
                                            <span>{formatAdminNumber(groupTotal)} students</span>
                                        </header>
                                        {(group.level_distribution || []).map((level) => {
                                            const count = level.students?.length || 0;
                                            const percent = percentage(count, groupTotal || maxStudents);
                                            return (
                                                <div className="comparison-level-row" key={`${group.course_group_id}-${level.level_id}`}>
                                                    <span>{level.level_name}</span>
                                                    <div>
                                                        <i style={{width: `${barWidth(count, groupTotal || maxStudents)}%`, background: level.color_hex}}/>
                                                    </div>
                                                    <b>{percent}%</b>
                                                    <small>{level.students.map((student) => student.name).join(", ")}</small>
                                                </div>
                                            );
                                        })}
                                        {(!group.level_distribution || group.level_distribution.length === 0) && (
                                            <p>No level data yet.</p>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </article>
                </div>
            </section>
        );
    };

    const renderInstructorDashboard = () => {
        const summary = instructorDashboard?.summary || {};
        if (!instructorDashboard && busy) {
            return <div className="admin-empty-dashboard"><h1>Loading dashboard...</h1></div>;
        }
        if (!dashboardCourses.length) {
            return (
                <div className="instructor-analytics">
                    <section className="instructor-analytics-hero">
                        <div>
                            <span>Instructor Dashboard</span>
                            <h1>No managed course found</h1>
                            <p>Courses will appear here when this instructor account is assigned as Instructor 1 or Instructor 2.</p>
                        </div>
                    </section>
                </div>
            );
        }

        const topicGroups = selectedDashboardTopic?.groups || [];
        const selectedAssessmentCount = topicGroups.reduce((total, group) => total + (group.assessment_comparison?.length || 0), 0);
        const changedCourse = (courseId) => {
            const nextCourse = dashboardCourses.find((course) => String(course.course_id) === String(courseId));
            setSelectedDashboardCourseId(courseId);
            writeDashboardCourseSession(courseId);
            setSelectedDashboardTopicId(nextCourse?.topics?.[0]?.topic_id || "");
        };

        return (
            <div className="instructor-analytics">
                <section className="instructor-analytics-hero">
                    <div>
                        <span>Instructor Dashboard</span>
                        <h1>{selectedDashboardCourse?.course_name || "Course Activity"}</h1>
                        <p>
                            Saved learning activity, XP contribution, level progress, and assessment improvement by topic and group.
                        </p>
                    </div>
                    <div className="instructor-dashboard-controls">
                        <label>
                            Course
                            <select
                                value={selectedDashboardCourse?.course_id || ""}
                                onChange={(event) => changedCourse(event.target.value)}
                            >
                                {dashboardCourses.map((course) => (
                                    <option key={course.course_id} value={course.course_id}>
                                        {course.course_name}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <small>Updated {formatAdminDate(instructorDashboard?.generated_at)}</small>
                    </div>
                </section>

                <section className="instructor-metric-grid">
                    <article><span>Courses</span><strong>{formatAdminNumber(summary.managed_courses)}</strong></article>
                    <article><span>Topics</span><strong>{formatAdminNumber(summary.total_topics)}</strong></article>
                    <article><span>Groups</span><strong>{formatAdminNumber(summary.total_groups)}</strong></article>
                    <article><span>Students</span><strong>{formatAdminNumber(summary.total_students)}</strong></article>
                    <article><span>Activities</span><strong>{formatAdminNumber(summary.total_activities)}</strong></article>
                    <article><span>Group XP</span><strong>{formatAdminNumber(summary.total_group_xp)}</strong></article>
                    <article><span>Individual XP</span><strong>{formatAdminNumber(summary.total_individual_xp)}</strong></article>
                    <article><span>Score Lift</span><strong>{summary.average_score_improvement > 0 ? "+" : ""}{summary.average_score_improvement || 0}</strong></article>
                </section>

                <section className="instructor-topic-tabs" aria-label="Topic filter">
                    {(selectedDashboardCourse?.topics || []).map((topic) => (
                        <button
                            key={topic.topic_id}
                            type="button"
                            className={String(selectedDashboardTopic?.topic_id) === String(topic.topic_id) ? "is-active" : ""}
                            onClick={() => setSelectedDashboardTopicId(topic.topic_id)}
                        >
                            <span>{topic.week ? `Week ${topic.week}` : "Topic"}</span>
                            <strong>{topic.topic_name}</strong>
                            <small>{formatAdminNumber(topic.summary?.total_activities)} activities</small>
                        </button>
                    ))}
                </section>

                <section className="instructor-topic-panel">
                    <div className="instructor-topic-header">
                        <div>
                            <span>{selectedDashboardTopic?.week ? `Week ${selectedDashboardTopic.week}` : "Selected Topic"}</span>
                            <h2>{selectedDashboardTopic?.topic_name || "Topic"}</h2>
                        </div>
                        <div className="instructor-topic-stats">
                            <b>{formatAdminNumber(selectedDashboardTopic?.summary?.total_activities)} activities</b>
                            <b>{formatAdminNumber(selectedDashboardTopic?.summary?.total_group_xp)} group XP</b>
                            <b>{formatAdminNumber(selectedDashboardTopic?.summary?.total_individual_xp)} individual XP</b>
                        </div>
                    </div>

                    <div className="instructor-topic-actions">
                        <div>
                            <strong>Pre-test & post-test export</strong>
                            <span>{formatAdminNumber(selectedAssessmentCount)} student comparisons in this topic</span>
                        </div>
                        <button type="button" onClick={exportSelectedTopicAssessments}>
                            Export Excel
                        </button>
                    </div>
                    {message && <div className="admin-inline-message">{message}</div>}

                    {renderGroupComparison(topicGroups)}

                    <div className="instructor-group-list">
                        {topicGroups.map((group) => (
                            <article
                                className={`instructor-group-detail ${group.gamification_enabled ? "has-game" : ""}`}
                                key={`${group.topic_id}-${group.course_group_id}`}
                            >
                                <header>
                                    <div>
                                        <span>{group.gamification_enabled ? "Gamification enabled" : "Gamification disabled"}</span>
                                        <h3>{group.group_name || "Ungrouped"}</h3>
                                    </div>
                                    <div className="instructor-group-kpis">
                                        <b>{formatAdminNumber(group.activity_counts?.total)} activities</b>
                                        <b>{formatAdminNumber(group.student_count)} students</b>
                                        {group.gamification_enabled && <b>{formatAdminNumber(group.total_group_xp)} group XP</b>}
                                    </div>
                                </header>

                                <div className="activity-type-strip">
                                    {["individual", "pre_test", "post_test", "group", "quiz"].map((type) => (
                                        <span className={`activity-pill activity-pill--${activityClass(type)}`} key={type}>
                                            {type.replace("_", " ")}: {formatAdminNumber(group.activity_counts?.[type] || 0)} done
                                        </span>
                                    ))}
                                </div>

                                <details open>
                                    <summary>Activity detail</summary>
                                    {renderWeeklyActivityProgress(group)}
                                </details>

                                {group.gamification_enabled && (
                                    <>
                                        <details>
                                            <summary>Students by XP</summary>
                                            {renderStudentsByXp(group)}
                                        </details>

                                        <details>
                                            <summary>Students by level</summary>
                                            <div className="instructor-levels">
                                                {(group.level_distribution || []).map((level) => (
                                                    <div key={level.level_id}>
                                                        <b style={{borderColor: level.color_hex}}>{level.level_name}</b>
                                                        <strong>{formatAdminNumber(level.students.length)} students</strong>
                                                        <span>{level.students.map((student) => student.name).join(", ")}</span>
                                                    </div>
                                                ))}
                                                {(!group.level_distribution || group.level_distribution.length === 0) && <p>No level data yet.</p>}
                                            </div>
                                        </details>
                                    </>
                                )}

                                <details>
                                    <summary>Pre-test vs post-test</summary>
                                    <div className="score-chart">
                                        {(group.assessment_comparison || []).map((student) => (
                                            <div className="score-chart-row" key={student.user_id}>
                                                <span>{student.student_name}</span>
                                                <div>
                                                    <i className="score-pre" style={{width: `${scoreWidth(student.pre_score)}%`}}/>
                                                    <i className="score-post" style={{width: `${scoreWidth(student.post_score)}%`}}/>
                                                </div>
                                                <b>{student.pre_score ?? "-"} / {student.post_score ?? "-"}</b>
                                                <small>{student.improvement > 0 ? "+" : ""}{student.improvement ?? "-"}</small>
                                            </div>
                                        ))}
                                        {(!group.assessment_comparison || group.assessment_comparison.length === 0) && <p>No pre/post score pair recorded yet.</p>}
                                    </div>
                                    <div className="missing-assessment-grid">
                                        {renderMissingAssessmentList("Not yet done pre-test", missingAssessmentStudents(group).preTest)}
                                        {renderMissingAssessmentList("Not yet done post-test", missingAssessmentStudents(group).postTest)}
                                    </div>
                                </details>
                            </article>
                        ))}
                    </div>
                </section>
            </div>
        );
    };

    const renderStudentBulkPanel = () => {
        if (activeConfig?.resource !== "students") return null;
        const targetGroups = courseGroupOptions(studentBulk.course_id);
        const selectedCount = selectedStudentIds.length;
        return (
            <section className="admin-bulk-panel">
                <div>
                    <h2>Bulk Group Assignment</h2>
                    <p>Filter students, select rows, then move them to a course group in one action.</p>
                </div>
                <div className="admin-bulk-grid">
                    <label>
                        Course Filter
                        <select
                            value={studentBulk.course_id}
                            onChange={(event) => updateStudentBulk("course_id", event.target.value)}
                        >
                            <option value="">All courses</option>
                            {(references.courses || []).map((course) => (
                                <option key={course.course_id} value={course.course_id}>
                                    {course.course_name}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label>
                        Current Group
                        <select
                            value={studentBulk.course_group_id}
                            onChange={(event) => updateStudentBulk("course_group_id", event.target.value)}
                        >
                            <option value="">Any group</option>
                            {courseGroupOptions(studentBulk.course_id).map((group) => (
                                <option key={group.course_group_id} value={group.course_group_id}>
                                    {group.course_name} - {group.group_name}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label>
                        Search
                        <input
                            value={studentBulk.search}
                            onChange={(event) => updateStudentBulk("search", event.target.value)}
                            placeholder="Name or email"
                        />
                    </label>
                    <label>
                        Target Group
                        <select
                            value={studentBulk.target_course_group_id}
                            onChange={(event) => updateStudentBulk("target_course_group_id", event.target.value)}
                        >
                            <option value="">Choose target group</option>
                            {targetGroups.map((group) => (
                                <option key={group.course_group_id} value={group.course_group_id}>
                                    {group.course_name} - {group.group_name}
                                </option>
                            ))}
                        </select>
                    </label>
                </div>
                <div className="admin-bulk-actions">
                    <span>{displayedRows.length} shown, {selectedCount} selected</span>
                    <button
                        type="button"
                        disabled={busy || !studentBulk.target_course_group_id || selectedCount === 0}
                        onClick={() => assignStudentsToGroup(selectedStudentIds)}
                    >
                        Assign Selected
                    </button>
                    <button
                        type="button"
                        disabled={busy || !studentBulk.target_course_group_id || displayedRows.length === 0}
                        onClick={() => assignStudentsToGroup(displayedRows.map((row) => row.user_id))}
                    >
                        Assign All Shown
                    </button>
                </div>
            </section>
        );
    };

    const renderTopicResetPanel = () => {
        if (activeConfig?.resource !== "topics" || !topicReset.topic_id) return null;
        const topic = rows.find((row) => String(row.topic_id) === String(topicReset.topic_id));
        const groups = courseGroupOptions(topicReset.course_id);
        const selectedCount = topicReset.user_ids.length;
        const allShownSelected = topicResetStudents.length > 0
            && topicResetStudents.every((student) => topicReset.user_ids.map(String).includes(String(student.user_id)));

        return (
            <section className="admin-bulk-panel admin-reset-panel">
                <div>
                    <h2>Reset Pre-test / Post-test</h2>
                    <p>
                        Topic: <strong>{topic?.topic_name || "-"}</strong>. Reset akan menghapus sesi dan hasil assessment student yang dipilih.
                    </p>
                </div>
                <div className="admin-bulk-grid admin-bulk-grid--compact">
                    <div className="admin-bulk-field">
                        <span>Assessment</span>
                        <div className="admin-check-list">
                            <label>
                                <input
                                    type="checkbox"
                                    checked={topicReset.activity_types.includes("pre_test")}
                                    onChange={() => toggleTopicResetActivity("pre_test")}
                                />
                                <span>Pre-test</span>
                            </label>
                            <label>
                                <input
                                    type="checkbox"
                                    checked={topicReset.activity_types.includes("post_test")}
                                    onChange={() => toggleTopicResetActivity("post_test")}
                                />
                                <span>Post-test</span>
                            </label>
                        </div>
                    </div>
                    <label>
                        Course Group
                        <select
                            value={topicReset.course_group_id}
                            onChange={(event) => updateTopicReset("course_group_id", event.target.value)}
                        >
                            <option value="">Semua group</option>
                            {groups.map((group) => (
                                <option key={group.course_group_id} value={group.course_group_id}>
                                    {group.group_name}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label>
                        Search Student
                        <input
                            value={topicReset.search}
                            onChange={(event) => updateTopicReset("search", event.target.value)}
                            placeholder="Nama atau email"
                        />
                    </label>
                </div>
                <div className="admin-bulk-actions">
                    <span>{topicResetStudents.length} shown, {selectedCount} selected</span>
                    <button
                        type="button"
                        disabled={busy || topicResetStudents.length === 0}
                        onClick={() => setAllTopicResetStudentsSelected(!allShownSelected)}
                    >
                        {allShownSelected ? "Clear Shown" : "Select All Shown"}
                    </button>
                    <button
                        className="is-danger"
                        type="button"
                        disabled={busy || selectedCount === 0 || topicReset.activity_types.length === 0}
                        onClick={resetTopicAssessmentAttempts}
                    >
                        Reset Selected
                    </button>
                    <button
                        type="button"
                        disabled={busy}
                        onClick={() => setTopicReset({topic_id: "", course_id: "", course_group_id: "", search: "", activity_types: ["pre_test"], user_ids: []})}
                    >
                        Close
                    </button>
                </div>
                <div className="admin-mini-table">
                    {topicResetStudents.map((student) => (
                        <label key={student.user_id}>
                            <input
                                type="checkbox"
                                checked={topicReset.user_ids.map(String).includes(String(student.user_id))}
                                onChange={() => toggleTopicResetStudent(student.user_id)}
                            />
                            <span>{student.name}</span>
                            <small>{student.email}</small>
                            <b>{student.course_group_name || "No group"}</b>
                        </label>
                    ))}
                    {topicResetStudents.length === 0 && <p>Tidak ada student sesuai filter.</p>}
                </div>
            </section>
        );
    };

    const renderChangePassword = () => (
        <>
            <div className="admin-page-header">
                <div>
                    <h1>Change Password</h1>
                    <p>Update the password for the account currently signed in.</p>
                </div>
            </div>
            {message && <div className="admin-inline-message">{message}</div>}
            <form className="admin-data-form" onSubmit={handleChangePassword}>
                <div className="admin-form-grid">
                    <label>
                        Current Password
                        <input
                            name="current_password"
                            type="password"
                            value={passwordForm.current_password}
                            onChange={handlePasswordChange}
                            autoComplete="current-password"
                            required
                        />
                    </label>
                    <label>
                        New Password
                        <input
                            name="new_password"
                            type="password"
                            minLength={8}
                            value={passwordForm.new_password}
                            onChange={handlePasswordChange}
                            autoComplete="new-password"
                            required
                        />
                    </label>
                    <label>
                        Confirm New Password
                        <input
                            name="confirm_password"
                            type="password"
                            minLength={8}
                            value={passwordForm.confirm_password}
                            onChange={handlePasswordChange}
                            autoComplete="new-password"
                            required
                        />
                    </label>
                </div>
                <button type="submit" disabled={busy}>
                    Change Password
                </button>
            </form>
        </>
    );

    const renderBankForm = () => {
        if (!activeConfig?.bankType || Object.keys(bankForm).length === 0) return null;
        const bankType = activeConfig.bankType;
        const isIndividual = bankType === "individual_questions";
        const isCase = bankType === "topic_cases" || (isIndividual && getQuestionKindFromType(bankForm.individual_question_type) === "case_study");
        return (
            <form className="admin-data-form admin-bank-form" onSubmit={saveBankItem}>
                <div>
                    <h2>{editingBankRow ? "Edit Question Bank Item" : "Add Question Bank Item"}</h2>
                    <button type="button" onClick={() => {
                        setBankForm({});
                        setEditingBankRow(null);
                    }}>
                        Cancel
                    </button>
                </div>
                <div className="admin-form-grid">
                    <label>
                        Topic
                        <select
                            value={bankForm.topic_id}
                            onChange={(event) => updateBankForm("topic_id", event.target.value)}
                            required
                        >
                            <option value="">Choose Topic</option>
                            {renderTopicOptions()}
                        </select>
                    </label>
                    {isIndividual && (
                        <label>
                            Individual Question Type
                            <select
                                value={bankForm.individual_question_type}
                                onChange={(event) => updateBankForm("individual_question_type", event.target.value)}
                            >
                                <option value="exercise_multiple_choice">Exercise - Multiple Choice</option>
                                <option value="exercise_case_study">Exercise - Case Study</option>
                                <option value="pre_test_multiple_choice">Pre-test - Multiple Choice</option>
                                <option value="post_test_multiple_choice">Post-test - Multiple Choice</option>
                            </select>
                        </label>
                    )}
                    <label>
                        Question Type
                        <input value={isCase ? "Case Study" : "Multiple Choice"} readOnly />
                    </label>
                    {isCase ? (
                        <>
                            <label>
                                {bankType === "topic_cases" ? "Case Number" : "Question Number"}
                                <input
                                    type="number"
                                    min="1"
                                    max={bankType === "topic_cases" ? 15 : undefined}
                                    value={bankType === "topic_cases" ? bankForm.case_number : bankForm.question_number}
                                    onChange={(event) => updateBankForm(bankType === "topic_cases" ? "case_number" : "question_number", event.target.value)}
                                    required
                                />
                            </label>
                            <label>
                                Case Title
                                <input
                                    value={bankForm.case_title}
                                    onChange={(event) => updateBankForm("case_title", event.target.value)}
                                    required
                                />
                            </label>
                            <label className="admin-form-wide">
                                Case Prompt
                                <textarea
                                    value={bankForm.case_prompt}
                                    onChange={(event) => updateBankForm("case_prompt", event.target.value)}
                                    rows={5}
                                    required
                                />
                            </label>
                        </>
                    ) : (
                        <>
                            <label>
                                Question Number
                                <input
                                    type="number"
                                    min="1"
                                    value={bankForm.question_number}
                                    onChange={(event) => updateBankForm("question_number", event.target.value)}
                                    required
                                />
                            </label>
                            <label className="admin-form-wide">
                                Question
                                <textarea
                                    value={bankForm.question_text}
                                    onChange={(event) => updateBankForm("question_text", event.target.value)}
                                    rows={3}
                                    required
                                />
                            </label>
                            <label className="admin-form-wide">
                                Choices (one per line, exactly 4)
                                <textarea
                                    value={bankForm.choices_text}
                                    onChange={(event) => updateBankForm("choices_text", event.target.value)}
                                    rows={4}
                                    required
                                />
                            </label>
                            <label>
                                Correct Answer
                                <select
                                    value={bankForm.correct_answer_index}
                                    onChange={(event) => updateBankForm("correct_answer_index", event.target.value)}
                                >
                                    <option value={0}>Choice 1</option>
                                    <option value={1}>Choice 2</option>
                                    <option value={2}>Choice 3</option>
                                    <option value={3}>Choice 4</option>
                                </select>
                            </label>
                            <label className="admin-form-wide">
                                Explanation
                                <textarea
                                    value={bankForm.explanation}
                                    onChange={(event) => updateBankForm("explanation", event.target.value)}
                                    rows={3}
                                />
                            </label>
                        </>
                    )}
                </div>
                <button type="submit" disabled={busy}>Save Question Bank Item</button>
            </form>
        );
    };

    const renderBankManager = () => {
        const config = BANK_CONFIGS[activeConfig.bankType];
        const isIndividualBank = activeConfig.bankType === "individual_questions";
        const filteredBankRows = isIndividualBank
            ? bankRows.filter((row) => (
                (!bankFilters.activity_type || row.activity_type === bankFilters.activity_type)
                && (!bankFilters.question_kind || row.question_kind === bankFilters.question_kind)
            ))
            : bankRows;
        const totalPages = Math.max(1, Math.ceil(filteredBankRows.length / BANK_PAGE_SIZE));
        const safePage = Math.min(bankPage, totalPages);
        const pageStart = (safePage - 1) * BANK_PAGE_SIZE;
        const pageRows = filteredBankRows.slice(pageStart, pageStart + BANK_PAGE_SIZE);
        const pageIds = pageRows.map((row) => row[config.idKey]);
        const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selectedBankIds.map(String).includes(String(id)));
        return (
            <>
                <div className="admin-page-header">
                    <div>
                        <h1>{config.title}</h1>
                        <p>{activeConfig.description}</p>
                    </div>
                    <button type="button" onClick={openBankAddForm}>Add New Data</button>
                </div>
                {message && <div className="admin-inline-message">{message}</div>}
                {renderBankForm()}
                {isIndividualBank && (
                    <div className="admin-bank-filters">
                        <label>
                            Activity
                            <select
                                value={bankFilters.activity_type}
                                onChange={(event) => {
                                    setBankFilters((current) => ({...current, activity_type: event.target.value}));
                                    setBankPage(1);
                                }}
                            >
                                <option value="">All Activities</option>
                                <option value="exercise">Exercise</option>
                                <option value="pre_test">Pre-test</option>
                                <option value="post_test">Post-test</option>
                            </select>
                        </label>
                        <label>
                            Type
                            <select
                                value={bankFilters.question_kind}
                                onChange={(event) => {
                                    setBankFilters((current) => ({...current, question_kind: event.target.value}));
                                    setBankPage(1);
                                }}
                            >
                                <option value="">All Types</option>
                                <option value="multiple_choice">Multiple Choice</option>
                                <option value="case_study">Case Study</option>
                            </select>
                        </label>
                    </div>
                )}
                <div className="admin-bulk-actions admin-bank-bulk-actions">
                    <span>{selectedBankIds.length} selected</span>
                    <button
                        type="button"
                        disabled={busy || pageIds.length === 0}
                        onClick={() => setAllPageBankSelected(!allPageSelected, pageIds)}
                    >
                        {allPageSelected ? "Clear Page" : "Select Page"}
                    </button>
                    <button
                        className="is-danger"
                        type="button"
                        disabled={busy || selectedBankIds.length === 0}
                        onClick={() => bulkDeleteBankItems()}
                    >
                        Delete Selected
                    </button>
                </div>
                <div className="admin-pagination">
                    <span>
                        Showing {filteredBankRows.length === 0 ? 0 : pageStart + 1}-{Math.min(pageStart + BANK_PAGE_SIZE, filteredBankRows.length)} of {filteredBankRows.length}
                    </span>
                    <div>
                        <button
                            type="button"
                            onClick={() => setBankPage((current) => Math.max(1, current - 1))}
                            disabled={safePage <= 1}
                        >
                            Previous
                        </button>
                        <b>Page {safePage} of {totalPages}</b>
                        <button
                            type="button"
                            onClick={() => setBankPage((current) => Math.min(totalPages, current + 1))}
                            disabled={safePage >= totalPages}
                        >
                            Next
                        </button>
                    </div>
                </div>
                <div className="admin-table-wrap">
                    <table className="admin-data-table">
                        <thead>
                        <tr>
                            <th>
                                <input
                                    type="checkbox"
                                    checked={allPageSelected}
                                    onChange={(event) => setAllPageBankSelected(event.target.checked, pageIds)}
                                    aria-label="Select all question bank rows on this page"
                                />
                            </th>
                            {config.columns.map((column) => <th key={column.key}>{column.label}</th>)}
                            <th>Detail</th>
                            <th>Action</th>
                        </tr>
                        </thead>
                        <tbody>
                        {pageRows.map((row) => (
                            <tr key={row[config.idKey]}>
                                <td>
                                    <input
                                        type="checkbox"
                                        checked={selectedBankIds.map(String).includes(String(row[config.idKey]))}
                                        onChange={() => toggleBankSelection(row[config.idKey])}
                                        aria-label={`Select ${row.question_text || row.case_title || "question bank item"}`}
                                    />
                                </td>
                                {config.columns.map((column) => (
                                    <td key={column.key}>
                                        {formatValue(column, column.key === "question_text" ? row.question_text || row.case_title : row[column.key])}
                                    </td>
                                ))}
                                <td>
                                    {row.choices?.length ? renderChoicesPreview(row.choices, row.correct_answer_index) : (row.case_prompt || row.explanation || "-")}
                                </td>
                                <td>
                                    <div className="admin-row-actions">
                                        <button type="button" onClick={() => openBankEditForm(row)}>Edit</button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                        {filteredBankRows.length === 0 && (
                            <tr>
                                <td colSpan={config.columns.length + 3}>
                                    {busy ? "Loading data..." : "No data found."}
                                </td>
                            </tr>
                        )}
                        </tbody>
                    </table>
                </div>
            </>
        );
    };

    const renderQuestionBank = () => {
        const selectedTopicMaterials = questionSettings.topic_id
            ? materials.filter((material) => String(material.topic_id) === String(questionSettings.topic_id))
            : [];
        const questionType = getBankQuestionType();
        const isCaseBank = questionType === "case_study";

        return (
            <div className="admin-question-bank">
                <div className="admin-page-header">
                    <div>
                        <h1>Material & Question Bank</h1>
                        <p>Upload text material once, cache a digest, generate drafts from that digest, then review before saving.</p>
                    </div>
                </div>

                {message && <div className="admin-inline-message">{message}</div>}

                <section className="admin-qb-grid">
                    <form className="admin-data-form" onSubmit={saveMaterial}>
                        <div>
                            <h2>{editingMaterial ? "Edit Course Material" : "Add Course Material"}</h2>
                            {editingMaterial && (
                                <button type="button" onClick={() => {
                                    setEditingMaterial(null);
                                    setMaterialForm({topic_id: "", title: "", content_text: ""});
                                }}>
                                    Cancel
                                </button>
                            )}
                        </div>
                        <label>
                            Topic
                            <select
                                value={materialForm.topic_id}
                                onChange={(event) => setMaterialForm({...materialForm, topic_id: event.target.value})}
                                required
                            >
                                <option value="">Choose Topic</option>
                                {renderTopicOptions()}
                            </select>
                        </label>
                        <label>
                            Material Title
                            <input
                                value={materialForm.title}
                                onChange={(event) => setMaterialForm({...materialForm, title: event.target.value})}
                                required
                            />
                        </label>
                        <label>
                            Text Material
                            <textarea
                                value={materialForm.content_text}
                                onChange={(event) => setMaterialForm({...materialForm, content_text: event.target.value})}
                                required
                                rows={10}
                            />
                        </label>
                        <button type="submit" disabled={busy}>Save Material</button>
                    </form>

                    <section className="admin-material-list">
                        <h2>Saved Materials</h2>
                        {materials.length === 0 && <p>No material found yet.</p>}
                        {materials.map((material) => (
                            <article key={material.material_id}>
                                <div>
                                    <strong>{material.title}</strong>
                                    <span>{material.course_name} / {material.topic_name}</span>
                                    <small>{material.content_token_estimate} estimated tokens</small>
                                    <b className={`admin-digest admin-digest--${material.digest_status}`}>
                                        Digest: {material.digest_status}
                                    </b>
                                </div>
                                <div>
                                    <button type="button" onClick={() => editMaterial(material)}>Edit</button>
                                    <button type="button" onClick={() => generateDigest(material)} disabled={busy}>
                                        Generate Digest
                                    </button>
                                    <button type="button" onClick={() => removeMaterial(material)}>Delete</button>
                                </div>
                            </article>
                        ))}
                    </section>
                </section>

                <form className="admin-data-form" onSubmit={generateDrafts}>
                    <div>
                        <h2>Generate Question Drafts</h2>
                    </div>
                    <div className="admin-form-grid">
                        <label>
                            Topic
                            <select
                                value={questionSettings.topic_id}
                                onChange={(event) => updateQuestionSettings("topic_id", event.target.value)}
                                required
                            >
                                <option value="">Choose Topic</option>
                                {renderTopicOptions()}
                            </select>
                        </label>
                        <div className="admin-material-picker">
                            <strong>Materials</strong>
                            {!questionSettings.topic_id && <span>Choose topic first.</span>}
                            {questionSettings.topic_id && selectedTopicMaterials.length === 0 && <span>No material found for this topic.</span>}
                            {selectedTopicMaterials.map((material) => (
                                <label key={material.material_id}>
                                    <input
                                        type="checkbox"
                                        checked={(questionSettings.material_ids || []).map(String).includes(String(material.material_id))}
                                        onChange={() => toggleMaterialSelection(material.material_id)}
                                    />
                                    <span>{material.title} ({material.digest_status})</span>
                                </label>
                            ))}
                        </div>
                        <label>
                            Bank
                            <select
                                value={getQuestionBankTarget(questionSettings)}
                                onChange={(event) => updateQuestionBankTarget(event.target.value)}
                            >
                                {QUESTION_BANK_TARGETS.map((target) => (
                                    <option key={target.value} value={target.value}>
                                        {target.label}
                                    </option>
                                ))}
                            </select>
                        </label>
                        {questionSettings.bank_type === "individual_questions" && (
                            <label>
                                Saved As
                                <input
                                    value={`${getActivityFromType(questionSettings.individual_question_type)} / ${getQuestionKindFromType(questionSettings.individual_question_type)}`}
                                    readOnly
                                />
                            </label>
                        )}
                        <label>
                            Generated Question Type
                            <input value={questionType === "case_study" ? "Case Study" : "Multiple Choice"} readOnly />
                        </label>
                        <label>
                            OpenAI Model
                            <select
                                value={questionSettings.openai_model}
                                onChange={(event) => updateQuestionSettings("openai_model", event.target.value)}
                            >
                                {OPENAI_MODEL_OPTIONS.map((model) => (
                                    <option key={model.value} value={model.value}>
                                        {model.label}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <label>
                            Count
                            <input
                                type="number"
                                min="1"
                                max={isCaseBank ? 15 : 20}
                                value={questionSettings.count}
                                onChange={(event) => updateQuestionSettings("count", event.target.value)}
                            />
                        </label>
                    </div>
                    <button type="submit" disabled={busy || !questionSettings.topic_id || !questionSettings.material_ids?.length}>
                        Generate Drafts
                    </button>
                    {draftMeta && (
                        <p className="admin-qb-note">
                            Model: {draftMeta.model}. Source: {draftMeta.used_digest ? "cached digest/material mix" : "raw material excerpts"}. Materials: {draftMeta.material_count}.
                        </p>
                    )}
                </form>

                {drafts.length > 0 && (
                    <section className="admin-draft-review">
                        <div className="admin-page-header">
                            <div>
                                <h1>Review Drafts</h1>
                                <p>Edit before saving. AI source excerpts are shown to help validate grounding.</p>
                            </div>
                            <button type="button" onClick={saveDrafts} disabled={busy}>Save Reviewed Drafts</button>
                        </div>
                        {drafts.map((draft, index) => (
                            <article key={index} className="admin-draft-card">
                                <header>
                                    <div>
                                        <span>Draft {index + 1}</span>
                                        <b>{draft.question_type === "case_study" ? "Case Study" : "Multiple Choice"}</b>
                                    </div>
                                    <button
                                        className="admin-draft-remove"
                                        type="button"
                                        onClick={() => removeDraft(index)}
                                        disabled={busy}
                                    >
                                        Remove Draft
                                    </button>
                                </header>
                                {isCaseBank ? (
                                    <>
                                        <label>
                                            Case Number
                                            <input
                                                type="number"
                                                min="1"
                                                max="15"
                                                value={draft.case_number}
                                                onChange={(event) => updateDraft(index, "case_number", event.target.value)}
                                            />
                                        </label>
                                        <label>
                                            Case Title
                                            <input
                                                value={draft.case_title}
                                                onChange={(event) => updateDraft(index, "case_title", event.target.value)}
                                            />
                                        </label>
                                        <label>
                                            Case Prompt
                                            <textarea
                                                value={draft.case_prompt}
                                                onChange={(event) => updateDraft(index, "case_prompt", event.target.value)}
                                                rows={5}
                                            />
                                        </label>
                                    </>
                                ) : (
                                    <>
                                        <label>
                                            Question Number
                                            <input
                                                type="number"
                                                value={draft.question_number}
                                                onChange={(event) => updateDraft(index, "question_number", event.target.value)}
                                            />
                                        </label>
                                        <label>
                                            Question
                                            <textarea
                                                value={draft.question_text}
                                                onChange={(event) => updateDraft(index, "question_text", event.target.value)}
                                                rows={3}
                                            />
                                        </label>
                                        <div className="admin-choice-grid">
                                            {(draft.choices || []).map((choice, choiceIndex) => (
                                                <label key={choiceIndex}>
                                                    Choice {choiceIndex + 1}
                                                    <input
                                                        value={choice}
                                                        onChange={(event) => updateDraftChoice(index, choiceIndex, event.target.value)}
                                                    />
                                                </label>
                                            ))}
                                        </div>
                                        <label>
                                            Correct Answer
                                            <select
                                                value={draft.correct_answer_index}
                                                onChange={(event) => updateDraft(index, "correct_answer_index", event.target.value)}
                                            >
                                                <option value={0}>Choice 1</option>
                                                <option value={1}>Choice 2</option>
                                                <option value={2}>Choice 3</option>
                                                <option value={3}>Choice 4</option>
                                            </select>
                                        </label>
                                        <label>
                                            Explanation
                                            <textarea
                                                value={draft.explanation}
                                                onChange={(event) => updateDraft(index, "explanation", event.target.value)}
                                                rows={3}
                                            />
                                        </label>
                                    </>
                                )}
                                <label>
                                    Source Excerpt for Validation
                                    <textarea
                                        value={draft.source_excerpt}
                                        onChange={(event) => updateDraft(index, "source_excerpt", event.target.value)}
                                        rows={2}
                                    />
                                </label>
                            </article>
                        ))}
                    </section>
                )}
            </div>
        );
    };

    if (loading) {
        return <main className="admin-login-page"><div className="admin-login-card">Loading admin...</div></main>;
    }

    if (!admin) {
        return (
            <main className="admin-login-page">
                <section className="admin-login-card">
                    <span>GamifyIt Admin</span>
                    <h1>Sign in</h1>
                    <p>Use an admin or instructor account to manage GamifyIt.</p>
                    {message && <div className="admin-alert">{message}</div>}
                    <form onSubmit={handleLogin}>
                        <label>
                            Username
                            <input
                                name="username"
                                value={loginForm.username}
                                onChange={handleLoginChange}
                                autoComplete="username"
                                required
                            />
                        </label>
                        <label>
                            Password
                            <input
                                name="password"
                                type="password"
                                value={loginForm.password}
                                onChange={handleLoginChange}
                                autoComplete="current-password"
                                required
                            />
                        </label>
                        <button type="submit" disabled={busy || !loginForm.username || !loginForm.password}>
                            Login
                        </button>
                    </form>
                </section>
            </main>
        );
    }

    return (
        <main className="admin-shell">
            <aside className="admin-sidebar">
                <div className="admin-brand">
                    <strong>GamifyIt</strong>
                    <span>Admin Console</span>
                </div>
                <nav>
                    {visibleMenuGroups.map((group) => (
                        <section key={group.key}>
                            <button
                                className="admin-menu-parent"
                                type="button"
                                onClick={() => toggleMenu(group.key)}
                            >
                                <span>{group.label}</span>
                                <b>{openMenus[group.key] ? "-" : "+"}</b>
                            </button>
                            {openMenus[group.key] && group.items.map((item) => (
                                <button
                                    className={`admin-menu-child ${location.pathname === item.path ? "is-active" : ""}`}
                                    key={item.path}
                                    type="button"
                                    onClick={() => navigate(item.path)}
                                >
                                    {item.label}
                                </button>
                            ))}
                        </section>
                    ))}
                </nav>
            </aside>

            <section className="admin-main">
                <header className="admin-topbar">
                    <div className="admin-quick-actions">
                        <button type="button" onClick={() => navigate(DEFAULT_PATH)}>Dashboard</button>
                        <button type="button" onClick={() => navigate("/courseadmin")}>Course Master</button>
                    </div>
                    <div className="admin-account">
                        <span>{admin.username}</span>
                        <strong>{admin.role}</strong>
                        <button type="button" onClick={() => navigate("/adminpassword")} disabled={busy}>
                            Change Password
                        </button>
                        <button type="button" onClick={handleLogout} disabled={busy}>
                            Logout
                        </button>
                    </div>
                </header>

                <div className="admin-breadcrumb">
                    Admin / {activeConfig ? activeConfig.label : "Dashboard"}
                </div>

                <section className="admin-page-container">
                    {!activeConfig ? (
                        renderInstructorDashboard()
                    ) : activeConfig.custom === "questionBank" ? (
                        renderQuestionBank()
                    ) : activeConfig.custom === "bankManager" ? (
                        renderBankManager()
                    ) : activeConfig.custom === "changePassword" ? (
                        renderChangePassword()
                    ) : (
                        <>
                            <div className="admin-page-header">
                                <div>
                                    <h1>{activeConfig.label}</h1>
                                    <p>{activeConfig.description}</p>
                                </div>
                                {activeConfig.canAdd && (
                                    <button type="button" onClick={openAddForm}>
                                        Add New Data
                                    </button>
                                )}
                            </div>

                            {message && <div className="admin-inline-message">{message}</div>}

                            {renderStudentBulkPanel()}
                            {renderTopicResetPanel()}

                            {(Object.keys(formData).length > 0 || editingRow) && (
                                <form className="admin-data-form" onSubmit={handleSave}>
                                    <div>
                                        <h2>{editingRow ? "Edit Data" : "Add New Data"}</h2>
                                        <button type="button" onClick={() => {
                                            setEditingRow(null);
                                            setFormData({});
                                        }}>
                                            Cancel
                                        </button>
                                    </div>
                                    <div className="admin-form-grid">
                                        {activeConfig.fields.filter(isFormFieldVisible).map((field) => (
                                            <label key={field.key}>
                                                {field.label}
                                                {renderField(field)}
                                            </label>
                                        ))}
                                    </div>
                                    <button type="submit" disabled={busy}>
                                        Save Data
                                    </button>
                                </form>
                            )}

                            <div className="admin-table-wrap">
                                <table className="admin-data-table">
                                    <thead>
                                    <tr>
                                        {activeConfig.resource === "students" && (
                                            <th>
                                                <input
                                                    type="checkbox"
                                                    checked={displayedRows.length > 0 && selectedStudentIds.length === displayedRows.length}
                                                    onChange={(event) => setAllDisplayedStudentsSelected(event.target.checked)}
                                                    aria-label="Select all shown students"
                                                />
                                            </th>
                                        )}
                                        {activeConfig.tableColumns.map((column) => (
                                            <th key={column.key}>{column.label}</th>
                                        ))}
                                        <th>Action</th>
                                    </tr>
                                    </thead>
                                    <tbody>
                                    {displayedRows.map((row) => (
                                        <tr key={row[activeConfig.idKey]}>
                                            {activeConfig.resource === "students" && (
                                                <td>
                                                    <input
                                                        type="checkbox"
                                                        checked={selectedStudentIds.map(String).includes(String(row.user_id))}
                                                        onChange={() => toggleStudentSelection(row.user_id)}
                                                        aria-label={`Select ${row.name}`}
                                                    />
                                                </td>
                                            )}
                                            {activeConfig.tableColumns.map((column) => (
                                                <td key={column.key}>
                                                    {column.type === "color" ? (
                                                        <span className="admin-color-cell">
                                                            <i style={{background: row[column.key]}} />
                                                            {row[column.key]}
                                                        </span>
                                                    ) : formatValue(column, column.type === "setting_value" ? row : row[column.key])}
                                                </td>
                                            ))}
                                            <td>
                                                <div className="admin-row-actions">
                                                    <button type="button" onClick={() => openEditForm(row)}>
                                                        Edit
                                                    </button>
                                                    {activeConfig.resource === "topics" && (
                                                        <button type="button" onClick={() => openTopicAssessmentReset(row)}>
                                                            Reset Test
                                                        </button>
                                                    )}
                                                    {activeConfig.canDelete && !(activeConfig.resource === "useradmins" && String(row.username || "").toLowerCase() === "admin") && (
                                                        <button type="button" onClick={() => handleDelete(row)}>
                                                            Delete
                                                        </button>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                    {displayedRows.length === 0 && (
                                        <tr>
                                            <td colSpan={activeConfig.tableColumns.length + 1 + (activeConfig.resource === "students" ? 1 : 0)}>
                                                {busy ? "Loading data..." : "No data found."}
                                            </td>
                                        </tr>
                                    )}
                                    </tbody>
                                </table>
                            </div>
                        </>
                    )}
                </section>
            </section>
            {showScrollTop && (
                <button
                    className="admin-scroll-top"
                    type="button"
                    onClick={scrollToTop}
                    aria-label="Scroll to top"
                >
                    ↑ Top
                </button>
            )}
        </main>
    );
};

export default AdminPage;
