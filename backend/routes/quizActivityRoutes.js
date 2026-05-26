import express from "express";
import {
    answerQuizQuestion,
    beginQuiz,
    exitQuizSession,
    getQuizContext,
    getQuizSession,
    heartbeatQuizSession,
    joinQuizSession,
    retryQuizFeedback,
    saveQuizSessionResult,
    startQuizLobby,
} from "../controllers/quizActivityController.js";

const router = express.Router();

router.get("/context", getQuizContext);
router.post("/sessions", startQuizLobby);
router.get("/sessions/:sessionId", getQuizSession);
router.post("/sessions/:sessionId/join", joinQuizSession);
router.post("/sessions/:sessionId/heartbeat", heartbeatQuizSession);
router.post("/sessions/:sessionId/exit", exitQuizSession);
router.post("/sessions/:sessionId/start", beginQuiz);
router.post("/sessions/:sessionId/answer", answerQuizQuestion);
router.post("/sessions/:sessionId/save", saveQuizSessionResult);
router.post("/sessions/:sessionId/retry-feedback", retryQuizFeedback);

export default router;
