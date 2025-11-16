// src/pages/VirtualSpacePage.js
import React, {useEffect, useState} from "react";
import {useNavigate} from "react-router-dom";
import {apiGet, apiPost} from "../api/apiClient";
import VirtualSpace from "../components/VirtualSpace";
import VirtualSpacePixi from "../components/VirtualSpacePixi";
import UserHUD from "../components/UserHUD";

const VirtualSpacePage = ({ user, setLoggedIn, setUser }) => {
    const [currentUser, setCurrentUser] = useState(user);
    const navigate = useNavigate();

    useEffect(() => {
        if (!user) {
            apiGet("/session").then((res) => {
                if (res.loggedIn) {
                    setCurrentUser(res.user);
                }
                else navigate("/");
            });
        } else {
            setCurrentUser(user);
        }
    }, [user, navigate]);

    const handleLogout = async () => {
        // kirim event ke server agar broadcast "user_left"
        if (window.socket) {
            window.socket.emit("logout");
            console.log("📤 Logout event emitted to server");
        }

        // logout dari API session
        const res = await apiPost("/logout", {});
        if (res.message === "Logout berhasil") {
            setLoggedIn(false);
            setUser(null);
            localStorage.clear(); // ✅ clear saved room or session data

            // beri sedikit jeda agar server sempat broadcast event
            setTimeout(() => {
                if (window.socket) window.socket.disconnect();
                navigate("/");
            }, 300);
        } else {
            alert("Gagal logout. Coba lagi.");
        }
    };

    if (!currentUser) return <p style={{textAlign: "center"}}>Memuat ruang...</p>;

    return (
        <div style={{ position: "relative", width: "100%", height: "100vh", overflow: "hidden" }}>
            <VirtualSpacePixi user={currentUser} />
            <UserHUD currentUser={currentUser} handleLogout={handleLogout} />
        </div>
    );
};

const btnLogout = {
    background: "#d9534f",
    color: "#fff",
    border: "none",
    padding: "8px 16px",
    borderRadius: "8px",
    cursor: "pointer",
    marginBottom: "20px",
};

export default VirtualSpacePage;