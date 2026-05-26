import express from "express";
import {
    getTableContext,
    getTableOccupancy,
    getTableSession,
    beginTableSessionWork,
    exitTableSession,
    heartbeatTableSession,
    joinTableSession,
    retryTableFeedback,
    saveTableAnswer,
    submitTableAnswers,
    startTableSession,
    timeoutTableSession,
} from "../controllers/tableActivityController.js";

const router = express.Router();

router.get("/context", getTableContext);
router.get("/occupancy", getTableOccupancy);
router.post("/sessions", startTableSession);
router.get("/sessions/:sessionId", getTableSession);
router.post("/sessions/:sessionId/join", joinTableSession);
router.post("/sessions/:sessionId/start", beginTableSessionWork);
router.post("/sessions/:sessionId/heartbeat", heartbeatTableSession);
router.post("/sessions/:sessionId/exit", exitTableSession);
router.post("/sessions/:sessionId/submit", submitTableAnswers);
router.post("/sessions/:sessionId/timeout", timeoutTableSession);
router.post("/sessions/:sessionId/retry-feedback", retryTableFeedback);
router.patch("/sessions/:sessionId/answer", saveTableAnswer);

export default router;
