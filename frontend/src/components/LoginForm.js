import React, {useEffect, useState} from "react";
import {apiGet, apiPost} from "../api/apiClient";
import {validateLogin} from "../utils/validate";

const LoginForm = ({onLoginSuccess}) => {
    const [courses, setCourses] = useState([]);
    const [users, setUsers] = useState([]);
    const [avatars, setAvatars] = useState([]);
    const [form, setForm] = useState({
        course_id: "",
        user_id: "",
        avatar_id: "",
    });

    useEffect(() => {
        apiGet("/courses").then(setCourses);
    }, []);

    useEffect(() => {
        if (form.course_id) {
            apiGet("/users?course_id=" + form.course_id).then(setUsers);
        } else {
            setUsers([]);
        }
    }, [form.course_id]);

    useEffect(() => {
        apiGet("/avatars").then((data) => {
            setAvatars(data);
            if (data.length > 0 && !form.avatar_id) {
                setForm((prev) => ({ ...prev, avatar_id: data[0].avatar_id }));
            }
        });
    }, []);

    const handleChange = (e) => {
        setForm({...form, [e.target.name]: e.target.value});
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        const error = validateLogin(form);
        if (error) return alert(error);
        // console.log(form);
        const selectedAvatar = avatars.find(a => a.avatar_id === parseInt(form.avatar_id));
        const res = await apiPost("/login", {
            user_id: form.user_id,
            course_id: form.course_id,
            avatar_id: form.avatar_id,
            avatar_public_path: selectedAvatar ? selectedAvatar.avatar_public_path : null
        });
        if (res.user) {
            onLoginSuccess(res.user);
        } else {
            alert("Login gagal. Silakan coba lagi.");
        }
    };

    return (
        <div className="login-container">
            <div className="login-box">
                <img src="/logo192.png" alt="Logo" className="login-logo"/>
                <h2 className="login-title">Login GamifySpace</h2>
                <form onSubmit={handleSubmit}>
                    <select
                        name="course_id"
                        value={form.course_id}
                        onChange={handleChange}
                        required
                    >
                        <option value="">Pilih Course</option>
                        {courses.map((c) => (
                            <option key={c.course_id} value={c.course_id}>
                                {c.course_name}
                            </option>
                        ))}
                    </select>

                    <select
                        name="user_id"
                        value={form.user_id}
                        onChange={handleChange}
                        required
                        disabled={!form.course_id}
                    >
                        <option value="">Pilih Nama Pengguna</option>
                        {form.course_id && users.map((u) => (
                            <option key={u.user_id} value={u.user_id}>
                                {u.name}
                            </option>
                        ))}
                    </select>

                    <div className="avatar-grid" style={{ display: "flex", flexWrap: "nowrap", overflowX: "auto", gap: "10px" }}>
                        {avatars.map((a) => (
                            <div
                                key={a.avatar_id}
                                className={`avatar-item${form.avatar_id === a.avatar_id ? " selected" : ""}`}
                                onClick={() => setForm({...form, avatar_id: a.avatar_id})}
                                style={{cursor: "pointer", textAlign: "center"}}
                            >
                                <img
                                    src={`/avatars${a.avatar_public_path}/thumbnail.png`}
                                    alt={a.avatar_name}
                                    style={{
                                        width: 50,
                                        height: 50,
                                        objectFit: "cover",
                                        border: form.avatar_id === a.avatar_id ? "2px solid blue" : "2px solid transparent"
                                    }}
                                />
                                <div style={{fontSize: 12, marginTop: 2}}>{a.avatar_name}</div>
                            </div>
                        ))}
                    </div>

                    <button type="submit" disabled={!form.course_id || !form.user_id || !form.avatar_id} style={{marginTop:20}}>Masuk</button>
                </form>
            </div>
        </div>
    );
};

export default LoginForm;