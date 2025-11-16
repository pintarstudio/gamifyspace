import {getAllUsersByCourseId} from "../models/userModel.js";

export async function getUsers(req, res) {
    try {
        const { course_id } = req.query;
        const users = await getAllUsersByCourseId(course_id);
        res.json(users);
    } catch (error) {
        console.error(error);
        res.status(500).json({message: "Gagal mengambil data user"});
    }
}