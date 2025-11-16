// backend/controllers/courseController.js
import {getAllCourses} from "../models/courseModel.js";

export async function getCourses(req, res) {
    try {
        const courses = await getAllCourses();
        res.json(courses);
    } catch (error) {
        console.error(error);
        res.status(500).json({message: "Gagal mengambil data course"});
    }
}