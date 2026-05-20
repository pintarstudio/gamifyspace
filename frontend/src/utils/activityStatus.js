import socket from "./socketClient";
import {API_URL} from "../api/apiClient";

export const ACTIVITY_STATUS = {
    individual_exercise: {
        type: "individual_exercise",
        label: "Doing exercise",
    },
    individual_pre_test: {
        type: "individual_pre_test",
        label: "Taking pre-test",
    },
    individual_post_test: {
        type: "individual_post_test",
        label: "Taking post-test",
    },
    group_discussion: {
        type: "group_discussion",
        label: "In group discussion",
    },
    quiz: {
        type: "quiz",
        label: "In quiz",
    },
};

const ACK_TIMEOUT_MS = 2500;

export const activityStatusForIndividual = (activityType) => {
    if (activityType === "pre_test") return ACTIVITY_STATUS.individual_pre_test;
    if (activityType === "post_test") return ACTIVITY_STATUS.individual_post_test;
    return ACTIVITY_STATUS.individual_exercise;
};

export const isActivityStatusActive = (status) =>
    !!status?.expires_at && Number(status.expires_at) > Date.now();

export const activeActivityMessage = (status) =>
    status?.label
        ? `You are already in an activity: ${status.label}. Finish or exit it first.`
        : "You are already in an activity. Finish or exit it first.";

const emitWithAck = (eventName, payload) =>
    new Promise((resolve) => {
        let settled = false;
        const timer = window.setTimeout(() => {
            if (!settled) {
                settled = true;
                resolve({ok: false, reason: "SOCKET_TIMEOUT"});
            }
        }, ACK_TIMEOUT_MS);

        socket.emit(eventName, payload, (response) => {
            if (settled) return;
            settled = true;
            window.clearTimeout(timer);
            resolve(response || {ok: true});
        });
    });

export async function setActivityStatus({user, status, activityKey, metadata = {}, isPending = false}) {
    if (!user?.user_id || !user?.course_id || !status?.type) {
        return {ok: false, reason: "MISSING_USER_OR_STATUS"};
    }

    return emitWithAck("activity_status:set", {
        user_id: user.user_id,
        course_id: user.course_id,
        status: {
            ...metadata,
            type: status.type,
            label: status.label,
            activity_key: activityKey,
            is_pending: isPending,
        },
    });
}

export function clearActivityStatus({user, activityKey, keepalive = false}) {
    if (!user?.user_id || !user?.course_id) return;
    const payload = {
        user_id: user.user_id,
        course_id: user.course_id,
        activity_key: activityKey,
    };

    socket.emit("activity_status:clear", payload);

    if (keepalive) {
        fetch(`${API_URL}/activity-status/clear`, {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            credentials: "include",
            body: JSON.stringify(payload),
            keepalive: true,
        }).catch(() => {});
    }
}
