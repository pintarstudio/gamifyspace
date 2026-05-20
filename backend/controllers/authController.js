// backend/controllers/authController.js
import {findActiveCourseById, findCourseByName} from "../models/courseModel.js";
import {createDemoUser, findUserByCourseNameEmail, findUserById, updateUserRole} from "../models/userModel.js";
import {createSession, deactivateSession} from "../models/sessionModel.js";
import {getDefaultAvatar} from "../models/avatarModel.js";
import {findRoleById, STUDENT_ROLE_ID} from "../models/roleModel.js";
import {v4 as uuidv4} from "uuid";

const normalizeLookupText = (value) =>
    String(value || "")
        .replace(/&amp;/gi, "&")
        .replace(/\s+/g, " ")
        .trim();

export async function login(req, res) {
    try {
        const { user_id, course_id, avatar_id, avatar_public_path, password, role_id } = req.body;

        if (!user_id) {
            return res.status(400).json({ message: "User wajib dipilih" });
        }
        if (password !== "adminadmin") {
            return res.status(401).json({ message: "Password demo tidak sesuai" });
        }

        let user = await findUserById(user_id);
        if (!user) {
            return res.status(404).json({ message: "User tidak ditemukan" });
        }
        if (role_id) {
            const role = await findRoleById(role_id);
            if (!role) {
                return res.status(400).json({message: "Role tidak ditemukan"});
            }
            user = await updateUserRole(user.user_id, role.role_id);
        }
        const course = await findActiveCourseById(course_id || user.course_id);
        if (!course || String(user.course_id) !== String(course.course_id)) {
            return res.status(404).json({message: "Course tidak ditemukan. Silakan hubungi administrator."});
        }

        let sessionAvatarId = avatar_id;
        let sessionAvatarPath = avatar_public_path;
        if (!sessionAvatarId && user.use_no_virtual_space) {
            const defaultAvatar = await getDefaultAvatar();
            sessionAvatarId = defaultAvatar?.avatar_id;
            sessionAvatarPath = defaultAvatar?.avatar_public_path || null;
        }
        if (!sessionAvatarId) {
            return res.status(400).json({message: "Avatar wajib dipilih"});
        }

        const session_id = uuidv4();
        await createSession(session_id, user.user_id, course.course_id, sessionAvatarId);

        req.session.session_id = session_id;
        req.session.user = { ...user, avatar_public_path: sessionAvatarPath };

        res.json({
            message: "Login berhasil",
            user: {
                ...user,
                course_id: course.course_id,
                course_name: course.course_name,
                course_group_id: user.course_group_id,
                course_group_name: user.course_group_name,
                role_id: user.role_id,
                role_name: user.role_name,
                gamification_enabled: !!user.gamification_enabled,
                use_no_virtual_space: !!user.use_no_virtual_space,
                virtual_space_enabled: !!user.virtual_space_enabled,
                avatar_id: sessionAvatarId,
                avatar_public_path: sessionAvatarPath
            }
        });
    } catch (error) {
        console.error("Login error:", error);
        res.status(500).json({ message: "Terjadi kesalahan server" });
    }
}

export async function resolveDemoLogin(req, res) {
    try {
        const courseName = normalizeLookupText(req.query.coursename);
        const studentName = normalizeLookupText(req.query.studentname);
        const studentEmail = normalizeLookupText(req.query.studentemail).toLowerCase();

        if (!courseName || !studentName || !studentEmail) {
            return res.status(400).json({message: "Course, student name, dan student email wajib diisi"});
        }

        const course = await findCourseByName(courseName);
        if (!course) {
            return res.status(404).json({message: "Course tidak ditemukan. Silakan hubungi administrator."});
        }

        let user = await findUserByCourseNameEmail({
            course_id: course.course_id,
            name: studentName,
            email: studentEmail,
        });
        let created = false;

        if (!user) {
            user = await createDemoUser({
                name: studentName,
                email: studentEmail,
                course_id: course.course_id,
            });
            created = true;
        } else if (String(user.role_id) !== String(STUDENT_ROLE_ID)) {
            user = await updateUserRole(user.user_id, STUDENT_ROLE_ID);
        }

        res.json({
            course: {
                course_id: course.course_id,
                course_name: course.course_name,
            },
            user: {
                ...user,
                role_id: user.role_id,
                role_name: user.role_name,
                gamification_enabled: !!user.gamification_enabled,
                use_no_virtual_space: !!user.use_no_virtual_space,
                virtual_space_enabled: !!user.virtual_space_enabled,
            },
            created,
        });
    } catch (error) {
        console.error("Resolve demo login error:", error);
        res.status(500).json({message: "Gagal memuat data demo login"});
    }
}

export async function logout(req, res) {
    try {
        if (req.session.session_id) {
            await deactivateSession(req.session.session_id);
            req.session.destroy(() => {
            });
        }
        res.json({message: "Logout berhasil"});
    } catch (error) {
        res.status(500).json({message: "Gagal logout"});
    }
}
