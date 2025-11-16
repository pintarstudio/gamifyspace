// backend/controllers/courseController.js
import {getAllAvatars} from "../models/avatarModel.js";

export async function getAvatars(req, res) {
    try {
        const avatars = await getAllAvatars();
        res.json(avatars);
    } catch (error) {
        console.error(error);
        res.status(500).json({message: "Gagal mengambil data avatar"});
    }
}