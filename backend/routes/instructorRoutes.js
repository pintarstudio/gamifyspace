import express from "express";
import {getInstructorDashboard} from "../controllers/instructorDashboardController.js";

const router = express.Router();

router.get("/dashboard", getInstructorDashboard);

export default router;
