const ACTIVITY_RECOVERY_PREFIX = "gamifyit:activity-recovery";
const RECOVERY_TTL_MS = 60 * 60 * 1000;

const recoveryKey = (user) => {
    if (!user?.user_id || !user?.course_id) return null;
    return `${ACTIVITY_RECOVERY_PREFIX}:${user.course_id}:${user.user_id}`;
};

export function saveActivityRecovery(user, recovery) {
    const key = recoveryKey(user);
    if (!key || !recovery?.type || !recovery?.session_id) return;
    localStorage.setItem(key, JSON.stringify({
        ...recovery,
        session_id: String(recovery.session_id),
        updated_at_ms: Date.now(),
    }));
}

export function getActivityRecovery(user) {
    const key = recoveryKey(user);
    if (!key) return null;

    try {
        const recovery = JSON.parse(localStorage.getItem(key) || "null");
        if (!recovery?.type || !recovery?.session_id) return null;
        if (Date.now() - Number(recovery.updated_at_ms || 0) > RECOVERY_TTL_MS) {
            localStorage.removeItem(key);
            return null;
        }
        return recovery;
    } catch {
        localStorage.removeItem(key);
        return null;
    }
}

export function clearActivityRecovery(user, match = {}) {
    const key = recoveryKey(user);
    if (!key) return;
    const current = getActivityRecovery(user);
    if (!current) {
        localStorage.removeItem(key);
        return;
    }
    if (match.type && current.type !== match.type) return;
    if (match.session_id && String(current.session_id) !== String(match.session_id)) return;
    localStorage.removeItem(key);
}
