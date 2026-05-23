import React, {useEffect, useState} from "react";
import {useNavigate} from "react-router-dom";
import {apiGet, apiPost} from "../api/apiClient";
import AvatarIcon from "../components/AvatarIcon";

const InstructorLoginPage = ({setLoggedIn, setUser}) => {
    const navigate = useNavigate();
    const [avatars, setAvatars] = useState([]);
    const [courses, setCourses] = useState([]);
    const [coursesLoading, setCoursesLoading] = useState(false);
    const [courseMessage, setCourseMessage] = useState("");
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState("");
    const [form, setForm] = useState({
        username: "",
        password: "",
        course_id: "",
        avatar_id: "",
    });
    const instructorUsername = form.username;
    const instructorPassword = form.password;

    useEffect(() => {
        apiGet("/avatars").then((data) => {
            const avatarRows = Array.isArray(data) ? data : [];
            setAvatars(avatarRows);
            setForm((current) => current.avatar_id || avatarRows.length === 0
                ? current
                : {...current, avatar_id: avatarRows[0].avatar_id}
            );
        });
    }, []);

    useEffect(() => {
        const username = instructorUsername.trim();
        const password = instructorPassword;
        let active = true;

        setCourses([]);
        setCourseMessage("");
        setForm((current) => current.course_id ? {...current, course_id: ""} : current);

        if (!username || !password) {
            setCoursesLoading(false);
            return undefined;
        }

        const timeoutId = window.setTimeout(() => {
            setCoursesLoading(true);
            apiPost("/instructor-login/courses", {username, password})
                .then((data) => {
                    if (!active) return;
                    const courseRows = Array.isArray(data.courses) ? data.courses : [];
                    setCourses(courseRows);
                    setForm((current) => {
                        if (current.username.trim() !== username || current.password !== password) return current;
                        if (courseRows.some((course) => String(course.course_id) === String(current.course_id))) {
                            return current;
                        }
                        return {...current, course_id: courseRows[0]?.course_id || ""};
                    });
                    if (username && password && courseRows.length === 0) {
                        setCourseMessage(data.message || "No active course found for this instructor.");
                    }
                })
                .catch(() => {
                    if (active) setCourseMessage("Unable to load instructor courses.");
                })
                .finally(() => {
                    if (active) setCoursesLoading(false);
                });
        }, 450);

        return () => {
            active = false;
            window.clearTimeout(timeoutId);
        };
    }, [instructorUsername, instructorPassword]);

    const updateForm = (event) => {
        setForm({...form, [event.target.name]: event.target.value});
    };

    const handleSubmit = async (event) => {
        event.preventDefault();
        setBusy(true);
        setMessage("");

        try {
            const data = await apiPost("/instructor-login", form);
            if (data.user) {
                localStorage.removeItem("studentAccessLogin");
                setUser(data.user);
                setLoggedIn(true);
                navigate("/virtualspace");
            } else {
                setMessage(data.message || "Login instructor gagal.");
                if (Array.isArray(data.courses)) setCourses(data.courses);
            }
        } catch (error) {
            setMessage("Login instructor gagal.");
        } finally {
            setBusy(false);
        }
    };

    const selectedAvatar = avatars.find((avatar) => String(avatar.avatar_id) === String(form.avatar_id));
    const selectedCourse = courses.find((course) => String(course.course_id) === String(form.course_id));

    return (
        <div className="login-container">
            <div className="login-box instructor-login-box">
                <div className="login-hero">
                    <img src="/logo192.png" alt="GamifyIt" className="login-logo"/>
                    <div>
                        <span className="login-eyebrow">Instructor Access</span>
                        <h1 className="login-title">GamifyIt Instructor</h1>
                        <p className="login-subtitle">
                            Sign in with your instructor account, choose the course session, and enter the virtual classroom.
                        </p>
                    </div>
                </div>

                {message && <div className="login-alert login-alert--error">{message}</div>}

                <form className="login-form" onSubmit={handleSubmit}>
                    <div className="login-field-grid">
                        <label className="login-field">
                            <span>Username</span>
                            <input
                                name="username"
                                value={form.username}
                                onChange={updateForm}
                                autoComplete="username"
                                required
                            />
                        </label>

                        <label className="login-field">
                            <span>Password</span>
                            <input
                                name="password"
                                type="password"
                                value={form.password}
                                onChange={updateForm}
                                autoComplete="current-password"
                                required
                            />
                        </label>

                        <label className="login-field login-field--full">
                            <span>Course</span>
                            <select
                                name="course_id"
                                value={form.course_id}
                                onChange={updateForm}
                                required
                                disabled={coursesLoading || courses.length === 0}
                            >
                                <option value="">
                                    {coursesLoading
                                        ? "Loading courses..."
                                        : courses.length > 0
                                            ? "Choose course"
                                            : "Enter valid instructor credentials"}
                                </option>
                                {courses.map((course) => (
                                    <option key={course.course_id} value={course.course_id}>
                                        {course.course_code ? `${course.course_code} - ${course.course_name}` : course.course_name}
                                    </option>
                                ))}
                            </select>
                            {(courseMessage || selectedCourse) && (
                                <small className="login-field-help">
                                    {courseMessage || `Session course: ${selectedCourse.course_name}`}
                                </small>
                            )}
                        </label>
                    </div>

                    <section className="login-avatar-panel">
                        <div className="login-avatar-header">
                            <div>
                                <span>Avatar</span>
                                <strong>{selectedAvatar?.avatar_name || "Choose avatar"}</strong>
                                <small className="login-avatar-role">Role: Instructor</small>
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
                            {avatars.map((avatar) => (
                                <button
                                    key={avatar.avatar_id}
                                    className={`avatar-item${String(form.avatar_id) === String(avatar.avatar_id) ? " selected" : ""}`}
                                    onClick={() => setForm({...form, avatar_id: avatar.avatar_id})}
                                    type="button"
                                    aria-pressed={String(form.avatar_id) === String(avatar.avatar_id)}
                                >
                                    <AvatarIcon
                                        path={avatar.avatar_public_path}
                                        alt={avatar.avatar_name}
                                        className="avatar-item__icon"
                                    />
                                    <span>{avatar.avatar_name}</span>
                                </button>
                            ))}
                        </div>
                    </section>

                    <button
                        className="login-submit"
                        type="submit"
                        disabled={busy || coursesLoading || !form.username || !form.password || !form.course_id || !form.avatar_id}
                    >
                        Login Instructor
                    </button>
                </form>
            </div>
        </div>
    );
};

export default InstructorLoginPage;
