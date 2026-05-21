import React, {useEffect, useState} from "react";
import {useNavigate} from "react-router-dom";
import {apiGet, apiPost} from "../api/apiClient";
import AvatarIcon from "../components/AvatarIcon";

const InstructorLoginPage = ({setLoggedIn, setUser}) => {
    const navigate = useNavigate();
    const [avatars, setAvatars] = useState([]);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState("");
    const [form, setForm] = useState({
        username: "",
        password: "",
        avatar_id: "",
    });

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

    const updateForm = (event) => {
        setForm({...form, [event.target.name]: event.target.value});
    };

    const handleSubmit = async (event) => {
        event.preventDefault();
        setBusy(true);
        setMessage("");

        const data = await apiPost("/instructor-login", form);
        if (data.user) {
            localStorage.removeItem("studentAccessLogin");
            setUser(data.user);
            setLoggedIn(true);
            navigate("/virtualspace");
        } else {
            setMessage(data.message || "Login instructor gagal.");
        }
        setBusy(false);
    };

    const selectedAvatar = avatars.find((avatar) => String(avatar.avatar_id) === String(form.avatar_id));

    return (
        <div className="login-container">
            <div className="login-box instructor-login-box">
                <div className="login-hero">
                    <img src="/logo192.png" alt="GamifyIt" className="login-logo"/>
                    <div>
                        <span className="login-eyebrow">Instructor Access</span>
                        <h1 className="login-title">GamifyIt Instructor</h1>
                        <p className="login-subtitle">
                            Sign in with your instructor account and choose an avatar for the virtual classroom.
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
                        disabled={busy || !form.username || !form.password || !form.avatar_id}
                    >
                        Login Instructor
                    </button>
                </form>
            </div>
        </div>
    );
};

export default InstructorLoginPage;
