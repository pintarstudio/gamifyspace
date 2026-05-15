// backend/controllers/sessionController.js
import {findSession} from "../models/sessionModel.js";

export async function checkSession(req, res) {
    try {
        const session_id = req.session.session_id;
        if (!session_id) return res.json({loggedIn: false});

        const sessionData = await findSession(session_id);
        if (!sessionData) return res.json({loggedIn: false});
        console.log("SessionData: ",sessionData);
        res.json({
            loggedIn: true,
            user: {
                user_id: sessionData.user_id,
                name: sessionData.name,
                email: sessionData.email,
                gender: sessionData.gender,
                course_id: sessionData.course_id,
                course_name: sessionData.course_name,
                course_group_id: sessionData.course_group_id,
                course_group_name: sessionData.course_group_name,
                avatar_public_path: sessionData.avatar_public_path,
                gamification_enabled: !!sessionData.gamification_enabled,
                use_no_virtual_space: !!sessionData.use_no_virtual_space,
                virtual_space_enabled: !!sessionData.virtual_space_enabled,
            },
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({loggedIn: false});
    }
}
