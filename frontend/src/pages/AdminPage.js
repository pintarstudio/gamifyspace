import React, {useEffect, useMemo, useState} from "react";
import {useLocation, useNavigate} from "react-router-dom";
import {apiDelete, apiGet, apiPatch, apiPost} from "../api/apiClient";
import "./AdminPage.css";

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
    ],
    fields: [
        {key: "course_id", label: "Course", type: "select", reference: "courses", required: true},
        {key: "week", label: "Week", type: "number", placeholder: "1"},
        {key: "topic_name", label: "Topic Name", required: true},
        {key: "show_topic", label: "Show Topic", type: "checkbox"},
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

function buildForm(config, row) {
    if (!config || !row) return emptyForm(config);
    return config.fields.reduce((acc, field) => {
        const value = row[field.key];
        acc[field.key] = field.type === "checkbox" ? value !== false : value ?? "";
        return acc;
    }, {});
}

function formatValue(column, value) {
    if (column.type === "boolean") return value ? column.trueLabel || "Shown" : column.falseLabel || "Hidden";
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
    const [references, setReferences] = useState({instructors: [], courses: [], course_groups: [], roles: [], useradmin_users: []});
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
    const [studentBulk, setStudentBulk] = useState({
        course_id: "",
        course_group_id: "",
        search: "",
        target_course_group_id: "",
    });

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
    const visibleMenuGroups = useMemo(() => {
        const isAdmin = String(admin?.role || "").toLowerCase() === "admin";
        return MENU_GROUPS.filter((group) => isAdmin || group.key !== "admin-config");
    }, [admin?.role]);

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
        setStudentBulk({course_id: "", course_group_id: "", search: "", target_course_group_id: ""});
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
        const label = row.username || row.group_name || row.course_name || row.topic_name || "this data";
        if (!window.confirm(`Delete ${label}? This will soft-delete the data.`)) return;

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
        if (!window.confirm(`Delete material "${material.title}"?`)) return;
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
                            {config.columns.map((column) => <th key={column.key}>{column.label}</th>)}
                            <th>Detail</th>
                            <th>Action</th>
                        </tr>
                        </thead>
                        <tbody>
                        {pageRows.map((row) => (
                            <tr key={row[config.idKey]}>
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
                                <td colSpan={config.columns.length + 2}>
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
                        <div className="admin-empty-dashboard">
                            <h1>Dashboard</h1>
                        </div>
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
                                        {activeConfig.fields.map((field) => (
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
                                                    ) : formatValue(column, row[column.key])}
                                                </td>
                                            ))}
                                            <td>
                                                <div className="admin-row-actions">
                                                    <button type="button" onClick={() => openEditForm(row)}>
                                                        Edit
                                                    </button>
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
