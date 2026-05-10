// src/utils/validate.js
export function validateLogin({ course_id, user_id, avatar_id, password }, options = {}) {
    const requireAvatar = options.requireAvatar !== false;
    if (!course_id || !user_id || (requireAvatar && !avatar_id) || !password) {
        return "Harap isi semua kolom wajib!";
    }
    if (password !== "adminadmin") {
        return "Password demo tidak sesuai.";
    }
    return null;
}
