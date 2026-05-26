import express from "express";
import {
    answerIndividualQuestion,
    completeIndividualMultipleChoice,
    exitIndividualSession,
    getIndividualContext,
    getIndividualOccupancy,
    getIndividualSession,
    retryIndividualFeedback,
    startIndividualSession,
    submitIndividualCase,
    timeoutIndividualSession,
    updateIndividualSettings,
} from "../controllers/individualActivityController.js";

const router = express.Router();

router.get("/context", getIndividualContext);
router.get("/occupancy", getIndividualOccupancy);
router.post("/sessions", startIndividualSession);
router.get("/sessions/:sessionId", getIndividualSession);
router.post("/sessions/:sessionId/answer", answerIndividualQuestion);
router.post("/sessions/:sessionId/complete-multiple-choice", completeIndividualMultipleChoice);
router.post("/sessions/:sessionId/case-submit", submitIndividualCase);
router.post("/sessions/:sessionId/timeout", timeoutIndividualSession);
router.post("/sessions/:sessionId/exit", exitIndividualSession);
router.post("/sessions/:sessionId/retry-feedback", retryIndividualFeedback);
router.patch("/settings/:topicId", updateIndividualSettings);

export default router;
