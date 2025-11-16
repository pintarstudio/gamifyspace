import React, {useEffect, useState} from "react";
import {BrowserRouter, Routes, Route, Navigate} from "react-router-dom";
import LoginPage from "./pages/LoginPage";
import VirtualSpacePage from "./pages/VirtualSpacePage";
import {apiGet} from "./api/apiClient";

function App() {
    const [loggedIn, setLoggedIn] = useState(false);
    const [user, setUser] = useState(null);

    useEffect(() => {
        apiGet("/session").then((res) => {
            setLoggedIn(res.loggedIn);
            if (res.loggedIn) setUser(res.user);
            console.log(res);
        });
    }, []);

    return (
        <BrowserRouter>
            <Routes>
                <Route
                    path="/"
                    element={
                        loggedIn ? (
                            <Navigate to="/virtualspace"/>
                        ) : (
                            <LoginPage setLoggedIn={setLoggedIn} setUser={setUser}/>
                        )
                    }
                />
                <Route
                    path="/virtualspace"
                    element={
                        loggedIn ? (
                            <VirtualSpacePage user={user}
                                              setLoggedIn={setLoggedIn}   // ✅ dikirim ke VirtualSpacePage
                                              setUser={setUser}           // ✅ dikirim ke VirtualSpacePage
                            />
                        ) : (
                            <Navigate to="/"/>
                        )
                    }
                />
            </Routes>
        </BrowserRouter>
    );
}

export default App;