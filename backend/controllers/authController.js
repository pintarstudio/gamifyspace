// backend/controllers/authController.js
import {findActiveCourseById, findCourseByName, getManagedCoursesForInstructor} from "../models/courseModel.js";
import {createDemoUser, findUserByCourseNameEmail, findUserByEmail, findUserById} from "../models/userModel.js";
import {createSession, deactivateSession} from "../models/sessionModel.js";
import {findAvatarById, getDefaultAvatar} from "../models/avatarModel.js";
import {INSTRUCTOR_ROLE_ID, STUDENT_ROLE_ID} from "../models/roleModel.js";
import {findAdminByUsername, updateAdminLastLogin, verifyAdminPassword} from "../models/adminModel.js";
import {leaveStudentGroupRoomsForLogout} from "../models/chatModel.js";
import {getBooleanSetting, SETTING_KEYS} from "../models/settingsModel.js";
import {v4 as uuidv4} from "uuid";

const normalizeLookupText = (value) =>
    String(value || "")
        .replace(/&amp;/gi, "&")
        .replace(/\s+/g, " ")
        .trim();

const isSameLookupText = (left, right) =>
    normalizeLookupText(left).toLowerCase() === normalizeLookupText(right).toLowerCase();

const chatCourseRoom = (courseId) => `chat:course:${courseId}`;
const chatUserRoom = (userId) => `chat:user:${userId}`;
const chatRoom = (roomId) => `chat:room:${roomId}`;

const instructorCoursePayload = (course) => ({
    course_id: course.course_id,
    course_code: course.course_code,
    course_name: course.course_name,
    semester: course.semester,
    location: course.location,
    instructor_id: course.instructor_id,
    instructor2_id: course.instructor2_id,
    instructor_name: course.instructor_name,
    instructor2_name: course.instructor2_name,
    instructor_names: course.instructor_names,
});

async function resolveInstructorLoginContext(username, password) {
    if (!username || !password) {
        return {status: 400, message: "Username dan password wajib diisi"};
    }

    const admin = await findAdminByUsername(username);
    if (!admin || admin.role !== "instructor" || !verifyAdminPassword(password, admin.password_hash)) {
        return {status: 401, message: "Username atau password instructor tidak sesuai"};
    }
    if (admin.is_disabled) {
        return {status: 403, message: "Akun instructor tidak aktif"};
    }
    if (!admin.user_id) {
        return {status: 403, message: "Akun instructor belum terhubung dengan data user. Silakan hubungi admin."};
    }

    const user = await findUserById(admin.user_id);
    if (!user || String(user.role_id) !== String(INSTRUCTOR_ROLE_ID)) {
        return {status: 403, message: "Data user bukan instructor atau sudah tidak aktif"};
    }

    const courses = await getManagedCoursesForInstructor(user.user_id, user.course_id);
    if (courses.length === 0) {
        return {status: 404, message: "Tidak ada course aktif yang terhubung dengan instructor ini"};
    }

    return {admin, user, courses};
}

function emitChatLogoutLeaves(req, user, leftRooms) {
    const io = req.app?.get("io");
    if (!io || !user || leftRooms.length === 0) return;

    leftRooms.forEach(({room, member_count}) => {
        const payload = {
            room_id: room.chat_room_id,
            room_name: room.room_name,
            course_id: user.course_id,
            user_id: user.user_id,
            user_name: user.name,
            member_count,
            reason: "logout",
        };
        [chatCourseRoom(user.course_id), chatRoom(room.chat_room_id), chatUserRoom(user.user_id)].forEach((target) => {
            io.to(target).emit("chat:room:left", payload);
        });
    });
}

export async function login(req, res) {
    try {
        const { user_id, course_id, avatar_id, avatar_public_path, password } = req.body;

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
        if (String(user.role_id) !== String(STUDENT_ROLE_ID)) {
            return res.status(403).json({message: "Demo login hanya tersedia untuk student. Gunakan halaman instructor untuk login instructor."});
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
            const existingEmailUser = await findUserByEmail(studentEmail);
            if (existingEmailUser) {
                if (String(existingEmailUser.course_id) !== String(course.course_id)) {
                    return res.status(409).json({
                        message: "Email sudah terdaftar pada course lain. Silakan gunakan email student yang berbeda atau hubungi administrator.",
                    });
                }

                if (!isSameLookupText(existingEmailUser.name, studentName)) {
                    return res.status(409).json({
                        message: "Email sudah terdaftar untuk profil lain pada course ini. Silakan gunakan email student yang berbeda atau hubungi administrator.",
                    });
                }

                if (String(existingEmailUser.role_id) !== String(STUDENT_ROLE_ID)) {
                    return res.status(409).json({
                        message: `Email sudah terdaftar sebagai ${existingEmailUser.role_name || "role lain"}. Silakan gunakan email student yang berbeda atau hubungi administrator.`,
                    });
                }

                user = existingEmailUser;
            } else {
                const allowUrlLoginUserCreation = await getBooleanSetting(
                    SETTING_KEYS.ALLOW_URL_LOGIN_USER_CREATION,
                    true
                );
                if (!allowUrlLoginUserCreation) {
                    return res.status(403).json({
                        message: "Pembuatan akun baru dari link login tidak diizinkan. Silakan hubungi administrator.",
                    });
                }

                user = await createDemoUser({
                    name: studentName,
                    email: studentEmail,
                    course_id: course.course_id,
                });
                created = true;
            }
        } else if (String(user.role_id) !== String(STUDENT_ROLE_ID)) {
            return res.status(409).json({
                message: `Email sudah terdaftar sebagai ${user.role_name || "role lain"}. Silakan gunakan email student yang berbeda atau hubungi administrator.`,
            });
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
        if (error?.code === "23505") {
            return res.status(409).json({
                message: "Email sudah terdaftar. Silakan gunakan email student yang berbeda atau hubungi administrator.",
            });
        }
        res.status(500).json({message: "Gagal memuat data demo login"});
    }
}

export async function instructorLoginCourses(req, res) {
    try {
        const username = String(req.body.username || "").trim();
        const password = String(req.body.password || "");
        const context = await resolveInstructorLoginContext(username, password);

        if (context.status) {
            return res.status(context.status).json({
                message: context.message,
                courses: [],
            });
        }

        res.json({
            courses: context.courses.map(instructorCoursePayload),
            default_course_id: context.courses.some((course) => String(course.course_id) === String(context.user.course_id))
                ? context.user.course_id
                : context.courses[0]?.course_id || null,
        });
    } catch (error) {
        console.error("Instructor course lookup error:", error);
        res.status(500).json({message: "Gagal memuat course instructor", courses: []});
    }
}

export async function instructorLogin(req, res) {
    try {
        const username = String(req.body.username || "").trim();
        const password = String(req.body.password || "");
        const avatarId = req.body.avatar_id;
        const courseId = req.body.course_id;

        if (!avatarId) {
            return res.status(400).json({message: "Avatar wajib dipilih"});
        }

        const context = await resolveInstructorLoginContext(username, password);
        if (context.status) {
            return res.status(context.status).json({message: context.message});
        }

        const {admin, user, courses} = context;
        const avatar = await findAvatarById(avatarId);
        if (!avatar) {
            return res.status(400).json({message: "Avatar tidak ditemukan"});
        }

        const course = courseId
            ? courses.find((item) => String(item.course_id) === String(courseId))
            : courses.length === 1
                ? courses[0]
                : null;
        if (!course) {
            return res.status(400).json({
                message: courseId
                    ? "Instructor tidak terhubung dengan course yang dipilih"
                    : "Course wajib dipilih",
                courses: courses.map(instructorCoursePayload),
            });
        }

        const session_id = uuidv4();
        await createSession(session_id, user.user_id, course.course_id, avatar.avatar_id);
        await updateAdminLastLogin(admin.useradmin_id);

        const sessionUser = {
            ...user,
            course_id: course.course_id,
            course_name: course.course_name,
            use_no_virtual_space: false,
            virtual_space_enabled: true,
            avatar_id: avatar.avatar_id,
            avatar_public_path: avatar.avatar_public_path,
        };

        req.session.session_id = session_id;
        req.session.user = sessionUser;

        res.json({
            message: "Login instructor berhasil",
            user: {
                ...sessionUser,
                course_group_id: user.course_group_id,
                course_group_name: user.course_group_name,
                role_id: user.role_id,
                role_name: user.role_name,
                gamification_enabled: !!user.gamification_enabled,
                use_no_virtual_space: false,
                virtual_space_enabled: true,
            },
        });
    } catch (error) {
        console.error("Instructor login error:", error);
        res.status(500).json({message: "Gagal login instructor"});
    }
}

export async function logout(req, res) {
    try {
        if (req.session.session_id) {
            const user = req.session.user;
            if (String(user?.role_id) === String(STUDENT_ROLE_ID)) {
                const leftRooms = await leaveStudentGroupRoomsForLogout(user);
                emitChatLogoutLeaves(req, user, leftRooms);
            }
            await deactivateSession(req.session.session_id);
            req.session.destroy(() => {
            });
        }
        res.json({message: "Logout berhasil"});
    } catch (error) {
        res.status(500).json({message: "Gagal logout"});
    }
}
