import React, {useEffect, useState} from "react";
import {BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate} from "react-router-dom";
import LandingPage from "./pages/LandingPage";
import LoginPage from "./pages/LoginPage";
import VirtualSpacePage from "./pages/VirtualSpacePage";
import NoVirtualSpacePage from "./pages/NoVirtualSpacePage";
import TableActivityPage from "./pages/TableActivityPage";
import QuizActivityPage from "./pages/QuizActivityPage";
import IndividualActivityPage from "./pages/IndividualActivityPage";
import NotFoundPage from "./pages/NotFoundPage";
import AdminPage from "./pages/AdminPage";
import InstructorLoginPage from "./pages/InstructorLoginPage";
import {apiGet, apiPost} from "./api/apiClient";
import socket from "./utils/socketClient";

const defaultStudentPath = (user) => user?.use_no_virtual_space ? "/novirtualspace" : "/virtualspace";

function HomeRoute({loggedIn, user, setLoggedIn, setUser}) {
    const location = useLocation();
    const params = new URLSearchParams(location.search);
    const isStudentAccess =
        params.has("coursename") ||
        params.has("studentname") ||
        params.has("studentemail") ||
        params.get("loggedout") === "student";

    if (loggedIn) return <Navigate to={defaultStudentPath(user)}/>;
    if (isStudentAccess) return <LoginPage setLoggedIn={setLoggedIn} setUser={setUser}/>;
    return <LandingPage/>;
}

function MaintenanceListener({loggedIn, user, setLoggedIn, setUser}) {
    const navigate = useNavigate();
    const isStudent = String(user?.role_name || "").toLowerCase() === "student"
        || String(user?.role_id || "") === "1";

    useEffect(() => {
        const handleMaintenance = async () => {
            if (!loggedIn || !isStudent) return;
            if (window.socket) window.socket.emit("logout");
            await apiPost("/logout", {}).catch(() => null);
            setLoggedIn(false);
            setUser(null);
            localStorage.clear();
            navigate("/demo?maintenance=1");
        };

        socket.on("maintenance:active", handleMaintenance);
        return () => socket.off("maintenance:active", handleMaintenance);
    }, [loggedIn, isStudent, navigate, setLoggedIn, setUser]);

    return null;
}

function App() {
    const [loggedIn, setLoggedIn] = useState(false);
    const [user, setUser] = useState(null);
    const [authChecked, setAuthChecked] = useState(false);

    useEffect(() => {
        apiGet("/session")
            .then((res) => {
                setLoggedIn(res.loggedIn);
                if (res.loggedIn) setUser(res.user);
                console.log(res);
            })
            .finally(() => setAuthChecked(true));
    }, []);

    if (!authChecked) {
        return <p style={{textAlign: "center", marginTop: 40}}>Memuat sesi...</p>;
    }

    return (
        <BrowserRouter>
            <MaintenanceListener loggedIn={loggedIn} user={user} setLoggedIn={setLoggedIn} setUser={setUser}/>
            <Routes>
                <Route
                    path="/"
                    element={<HomeRoute loggedIn={loggedIn} user={user} setLoggedIn={setLoggedIn} setUser={setUser}/>}
                />
                <Route
                    path="/demo"
                    element={
                        loggedIn
                            ? <Navigate to={defaultStudentPath(user)}/>
                            : <LoginPage setLoggedIn={setLoggedIn} setUser={setUser}/>
                    }
                />
                <Route
                    path="/instructor"
                    element={
                        loggedIn
                            ? <Navigate to="/virtualspace"/>
                            : <InstructorLoginPage setLoggedIn={setLoggedIn} setUser={setUser}/>
                    }
                />
                <Route
                    path="/virtualspace"
                    element={
                        loggedIn && user?.use_no_virtual_space ? (
                            <Navigate to="/novirtualspace"/>
                        ) : loggedIn ? (
                            <VirtualSpacePage user={user}
                                              setLoggedIn={setLoggedIn}   // ✅ dikirim ke VirtualSpacePage
                                              setUser={setUser}           // ✅ dikirim ke VirtualSpacePage
                            />
                        ) : (
                            <Navigate to="/"/>
                        )
                    }
                />
                <Route
                    path="/novirtualspace"
                    element={
                        loggedIn && !user?.use_no_virtual_space ? (
                            <Navigate to="/virtualspace"/>
                        ) : loggedIn ? (
                            <NoVirtualSpacePage
                                user={user}
                                setLoggedIn={setLoggedIn}
                                setUser={setUser}
                            />
                        ) : (
                            <Navigate to="/"/>
                        )
                    }
                />
                <Route
                    path="/table"
                    element={
                        loggedIn ? (
                            <TableActivityPage/>
                        ) : (
                            <Navigate to="/"/>
                        )
                    }
                />
                <Route
                    path="/quiz"
                    element={
                        loggedIn ? (
                            <QuizActivityPage/>
                        ) : (
                            <Navigate to="/"/>
                        )
                    }
                />
                <Route
                    path="/individual"
                    element={
                        loggedIn ? (
                            <IndividualActivityPage/>
                        ) : (
                            <Navigate to="/"/>
                        )
                    }
                />
                <Route path="/gamifyitadmin" element={<AdminPage/>}/>
                <Route path="/leveladmin" element={<AdminPage/>}/>
                <Route path="/avataradmin" element={<AdminPage/>}/>
                <Route path="/roleadmin" element={<AdminPage/>}/>
                <Route path="/settingsadmin" element={<AdminPage/>}/>
                <Route path="/courseadmin" element={<AdminPage/>}/>
                <Route path="/topicadmin" element={<AdminPage/>}/>
                <Route path="/coursegroupadmin" element={<AdminPage/>}/>
                <Route path="/studentadmin" element={<AdminPage/>}/>
                <Route path="/useradmin" element={<AdminPage/>}/>
                <Route path="/adminpassword" element={<AdminPage/>}/>
                <Route path="/questionbankadmin" element={<AdminPage/>}/>
                <Route path="/quizbankadmin" element={<AdminPage/>}/>
                <Route path="/individualbankadmin" element={<AdminPage/>}/>
                <Route path="/groupcasebankadmin" element={<AdminPage/>}/>
                <Route path="*" element={<NotFoundPage/>}/>
            </Routes>
        </BrowserRouter>
    );
}

export default App;
