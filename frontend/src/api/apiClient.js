// src/api/apiClient.js
const API_URL = process.env.REACT_APP_API_URL;

export async function apiGet(path) {
    const res = await fetch(`${API_URL}${path}`, {
        method: "GET",
        credentials: "include",
    });
    return res.json();
}

export async function apiPost(path, data) {
    const res = await fetch(`${API_URL}${path}`, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        credentials: "include",
        body: JSON.stringify(data),
    });
    return res.json();
}