// src/utils/validate.js
export function validateLogin({ course_id, user_id, avatar_id }) {
    if (!course_id || !user_id || !avatar_id) {
        return "Harap isi semua kolom wajib!";
    }
    return null;
}