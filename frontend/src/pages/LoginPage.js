import React from "react";
import {useNavigate} from "react-router-dom";
import LoginForm from "../components/LoginForm";

const LoginPage = ({ setLoggedIn, setUser }) => {
    const navigate = useNavigate();

    const handleLoginSuccess = (user) => {
        console.log("Login berhasil:", user);
        setUser(user);
        setLoggedIn(true);
        navigate("/virtualspace");
    };

    return <LoginForm onLoginSuccess={handleLoginSuccess}/>;
};

export default LoginPage;