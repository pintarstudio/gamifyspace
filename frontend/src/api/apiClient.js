// src/api/apiClient.js
export const API_URL = process.env.REACT_APP_API_URL;

async function parseApiResponse(res) {
    const text = await res.text();
    const fallbackMessage = res.status === 504
        ? "Server timeout (504). Proses terlalu lama, silakan coba kurangi jumlah/material atau gunakan model yang lebih cepat."
        : `Request gagal (${res.status})`;

    if (!text) {
        return res.ok ? {} : {message: fallbackMessage, status: res.status};
    }

    try {
        return JSON.parse(text);
    } catch (error) {
        return {
            message: res.ok ? text : fallbackMessage,
            status: res.status,
        };
    }
}

export async function apiGet(path) {
    const res = await fetch(`${API_URL}${path}`, {
        method: "GET",
        credentials: "include",
    });
    return parseApiResponse(res);
}

export async function apiPost(path, data) {
    const res = await fetch(`${API_URL}${path}`, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        credentials: "include",
        body: JSON.stringify(data),
    });
    return parseApiResponse(res);
}

export async function apiPatch(path, data) {
    const res = await fetch(`${API_URL}${path}`, {
        method: "PATCH",
        headers: {"Content-Type": "application/json"},
        credentials: "include",
        body: JSON.stringify(data),
    });
    return parseApiResponse(res);
}

export async function apiDelete(path) {
    const res = await fetch(`${API_URL}${path}`, {
        method: "DELETE",
        credentials: "include",
    });
    return parseApiResponse(res);
}
