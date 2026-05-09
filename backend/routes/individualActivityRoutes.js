import express from "express";
import {
    answerIndividualQuestion,
    exitIndividualSession,
    getIndividualContext,
    getIndividualSession,
    startIndividualSession,
    submitIndividualCase,
    updateIndividualSettings,
} from "../controllers/individualActivityController.js";

const router = express.Router();

router.get("/context", getIndividualContext);
router.post("/sessions", startIndividualSession);
router.get("/sessions/:sessionId", getIndividualSession);
router.post("/sessions/:sessionId/answer", answerIndividualQuestion);
router.post("/sessions/:sessionId/case-submit", submitIndividualCase);
router.post("/sessions/:sessionId/exit", exitIndividualSession);
router.patch("/settings/:topicId", updateIndividualSettings);

export default router;
