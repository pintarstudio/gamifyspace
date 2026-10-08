import express from "express";
import {getInstructorDashboard, getTopicSummaryExport} from "../controllers/instructorDashboardController.js";

const router = express.Router();

router.get("/dashboard", getInstructorDashboard);
router.get("/courses/:courseId/topics/:topicId/summary-export", getTopicSummaryExport);

export default router;
