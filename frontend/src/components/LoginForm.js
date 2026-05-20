import React, {useEffect, useState} from "react";
import {apiGet, apiPost} from "../api/apiClient";
import {validateLogin} from "../utils/validate";
import AvatarIcon from "./AvatarIcon";

const LoginForm = ({onLoginSuccess}) => {
    const [courses, setCourses] = useState([]);
    const [users, setUsers] = useState([]);
    const [avatars, setAvatars] = useState([]);
    const [roles, setRoles] = useState([]);
    const [demoLogin, setDemoLogin] = useState(null);
    const [demoError, setDemoError] = useState("");
    const [demoLoading, setDemoLoading] = useState(false);
    const [studentUrlMode, setStudentUrlMode] = useState(false);
    const [form, setForm] = useState({
        course_id: "",
        user_id: "",
        role_id: "",
        avatar_id: "",
        password: "",
    });

    useEffect(() => {
        apiGet("/courses").then(setCourses);
    }, []);

    useEffect(() => {
        apiGet("/roles").then((data) => {
            const roleRows = Array.isArray(data) ? data : [];
            const studentRole = roleRows.find((role) => String(role.role_name).toLowerCase() === "student");
            setRoles(roleRows);
            setForm((prev) => prev.role_id
                ? prev
                : {...prev, role_id: studentRole?.role_id || roleRows[0]?.role_id || ""}
            );
        });
    }, []);

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const coursename = params.get("coursename");
        const studentname = params.get("studentname");
        const studentemail = params.get("studentemail");

        if (!coursename && !studentname && !studentemail) return;
        window.history.replaceState({}, "", window.location.pathname);
        setStudentUrlMode(true);
        if (!coursename || !studentname || !studentemail) {
            setDemoError("Data login tidak lengkap. Silakan hubungi administrator.");
            return;
        }

        const query = new URLSearchParams({coursename, studentname, studentemail});
        setDemoLoading(true);
        setDemoError("");
        apiGet(`/demo-login?${query.toString()}`)
            .then((data) => {
                if (!data.course || !data.user) {
                    setDemoError(data.message || "Course tidak ditemukan. Silakan hubungi administrator.");
                    return;
                }

                setDemoLogin(data);
                setForm((prev) => ({
                    ...prev,
                    course_id: data.course.course_id,
                    user_id: data.user.user_id,
                    role_id: data.user.role_id || 1,
                    password: "adminadmin",
                }));
            })
            .catch(() => setDemoError("Course tidak ditemukan. Silakan hubungi administrator."))
            .finally(() => setDemoLoading(false));
    }, []);

    useEffect(() => {
        if (form.course_id && !demoLogin) {
            apiGet("/users?course_id=" + form.course_id).then(setUsers);
        } else {
            setUsers([]);
        }
    }, [form.course_id, demoLogin]);

    useEffect(() => {
        apiGet("/avatars").then((data) => {
            setAvatars(data);
            setForm((prev) => prev.avatar_id || data.length === 0
                ? prev
                : {...prev, avatar_id: data[0].avatar_id}
            );
        });
    }, []);

    const handleChange = (e) => {
        setForm({...form, [e.target.name]: e.target.value});
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        const noAvatarStudentAccess = studentUrlMode
            && demoLogin?.user?.use_no_virtual_space;
        const error = validateLogin(form, {requireAvatar: !noAvatarStudentAccess});
        if (error) return alert(error);
        // console.log(form);
        const selectedAvatar = avatars.find(a => a.avatar_id === parseInt(form.avatar_id));
        const res = await apiPost("/login", {
            user_id: form.user_id,
            course_id: form.course_id,
            role_id: studentUrlMode ? 1 : form.role_id,
            avatar_id: noAvatarStudentAccess ? null : form.avatar_id,
            password: form.password,
            avatar_public_path: noAvatarStudentAccess ? null : selectedAvatar ? selectedAvatar.avatar_public_path : null
        });
        if (res.user) {
            if (studentUrlMode) {
                localStorage.setItem("studentAccessLogin", "1");
            } else {
                localStorage.removeItem("studentAccessLogin");
            }
            onLoginSuccess(res.user);
        } else {
            alert(res.message || "Login gagal. Silakan coba lagi.");
        }
    };

    const selectedAvatar = avatars.find(a => String(a.avatar_id) === String(form.avatar_id));
    const selectedRole = roles.find((role) => String(role.role_id) === String(form.role_id));
    const isDemoResolved = !!demoLogin?.course && !!demoLogin?.user;
    const noAvatarStudentAccess = studentUrlMode
        && !!demoLogin?.user?.use_no_virtual_space;
    const shouldBlockStudentUrl = studentUrlMode && !demoLoading && !isDemoResolved && !!demoError;
    const postStudentLogout = new URLSearchParams(window.location.search).get("loggedout") === "student";
    const isStudentAccessView = studentUrlMode || postStudentLogout;

    return (
        <div className="login-container">
            <div className="login-box">
                <div className="login-hero">
                    <img src="/logo192.png" alt="GamifyIt" className="login-logo"/>
                    <div>
                        <span className="login-eyebrow">{isStudentAccessView ? "Student Access" : "Demo Access"}</span>
                        <h1 className="login-title">GamifyIt</h1>
                        <p className="login-subtitle">
                            {postStudentLogout
                                ? "Use the provided link to start login."
                                : noAvatarStudentAccess
                                    ? "Continue to the no-map activity menu."
                                    : isStudentAccessView
                                        ? "Choose avatar to enter the virtual classroom."
                                        : "Choose a course, student, and avatar to enter the virtual classroom."}
                        </p>
                    </div>
                </div>

                {postStudentLogout && (
                    <div className="login-alert">
                        Silakan gunakan link yang diberikan untuk mulai login.
                    </div>
                )}
                {demoLoading && <div className="login-alert">Preparing demo login...</div>}
                {demoError && <div className="login-alert login-alert--error">{demoError}</div>}
                {shouldBlockStudentUrl && (
                    <p className="login-block-note">
                        This student access link cannot continue until the course is available.
                    </p>
                )}
                {isDemoResolved && (
                    <section className="login-demo-card">
                        <span>Resolved from demo URL</span>
                        <strong>{demoLogin.course.course_name}</strong>
                        <div>
                            <b>{demoLogin.user.name}</b>
                            <small>{demoLogin.user.email}</small>
                            <em className="login-role-chip">{demoLogin.user.role_name || "Student"}</em>
                        </div>
                        {demoLogin.created && <em className="login-created-note">New student profile created.</em>}
                    </section>
                )}

                {!shouldBlockStudentUrl && !postStudentLogout && (
                <form className="login-form" onSubmit={handleSubmit}>
                    {!isDemoResolved && (
                        <div className="login-field-grid">
                            <label className="login-field">
                                <span>Course</span>
                                <select
                                    name="course_id"
                                    value={form.course_id}
                                    onChange={handleChange}
                                    required
                                >
                                    <option value="">Choose course</option>
                                    {courses.map((c) => (
                                        <option key={c.course_id} value={c.course_id}>
                                            {c.course_name}
                                        </option>
                                    ))}
                                </select>
                            </label>

                            <label className="login-field">
                                <span>Student</span>
                                <select
                                    name="user_id"
                                    value={form.user_id}
                                    onChange={handleChange}
                                    required
                                    disabled={!form.course_id}
                                >
                                    <option value="">Choose student</option>
                                    {form.course_id && users.map((u) => (
                                        <option key={u.user_id} value={u.user_id}>
                                            {u.name}
                                        </option>
                                    ))}
                                </select>
                            </label>

                            <label className="login-field">
                                <span>Role</span>
                                <select
                                    name="role_id"
                                    value={form.role_id}
                                    onChange={handleChange}
                                    required
                                >
                                    <option value="">Choose role</option>
                                    {roles.map((role) => (
                                        <option key={role.role_id} value={role.role_id}>
                                            {role.role_name}
                                        </option>
                                    ))}
                                </select>
                            </label>

                            <label className="login-field login-field--full">
                                <span>Password</span>
                                <input
                                    name="password"
                                    type="password"
                                    value={form.password}
                                    onChange={handleChange}
                                    required
                                    autoComplete="current-password"
                                />
                            </label>
                        </div>
                    )}

                    {!noAvatarStudentAccess && (
                    <section className="login-avatar-panel">
                        <div className="login-avatar-header">
                            <div>
                                <span>Avatar</span>
                                <strong>{selectedAvatar?.avatar_name || "Choose avatar"}</strong>
                                {selectedRole && <small className="login-avatar-role">Role: {selectedRole.role_name}</small>}
                            </div>
                            {selectedAvatar && (
                                <AvatarIcon
                                    path={selectedAvatar.avatar_public_path}
                                    alt={selectedAvatar.avatar_name}
                                    className="login-avatar-preview"
                                />
                            )}
                        </div>

                        <div className="avatar-grid">
                            {avatars.map((a) => (
                                <button
                                    key={a.avatar_id}
                                    className={`avatar-item${String(form.avatar_id) === String(a.avatar_id) ? " selected" : ""}`}
                                    onClick={() => setForm({...form, avatar_id: a.avatar_id})}
                                    type="button"
                                    aria-pressed={String(form.avatar_id) === String(a.avatar_id)}
                                >
                                    <AvatarIcon path={a.avatar_public_path} alt={a.avatar_name} className="avatar-item__icon" />
                                    <span>{a.avatar_name}</span>
                                </button>
                            ))}
                        </div>
                    </section>
                    )}

                    <button
                        className="login-submit"
                        type="submit"
                        disabled={demoLoading || !form.course_id || !form.user_id || !form.role_id || (!noAvatarStudentAccess && !form.avatar_id) || !form.password}
                    >
                        Masuk
                    </button>
                </form>
                )}
            </div>
        </div>
    );
};

export default LoginForm;
