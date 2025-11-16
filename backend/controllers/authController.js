// backend/controllers/authController.js
import {findUserById} from "../models/userModel.js";
import {createSession, deactivateSession} from "../models/sessionModel.js";
import {v4 as uuidv4} from "uuid";

export async function login(req, res) {
    try {
        const { user_id, course_id, avatar_id, avatar_public_path } = req.body;

        if (!user_id) {
            return res.status(400).json({ message: "User wajib dipilih" });
        }

        const user = await findUserById(user_id);
        if (!user) {
            return res.status(404).json({ message: "User tidak ditemukan" });
        }

        const session_id = uuidv4();
        await createSession(session_id, user.user_id, course_id, avatar_id);

        req.session.session_id = session_id;
        req.session.user = { ...user, avatar_public_path };

        res.json({
            message: "Login berhasil",
            user: {
                ...user,
                course_id,
                avatar_id,
                avatar_public_path
            }
        });
    } catch (error) {
        console.error("Login error:", error);
        res.status(500).json({ message: "Terjadi kesalahan server" });
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