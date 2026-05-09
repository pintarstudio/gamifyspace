import express from "express";
import {
    getVirtualSpaceActivityDetail,
    getVirtualSpaceDashboard,
} from "../controllers/virtualSpaceDashboardController.js";

const router = express.Router();

router.get("/dashboard", getVirtualSpaceDashboard);
router.get("/activities/:sessionId", getVirtualSpaceActivityDetail);

export default router;
