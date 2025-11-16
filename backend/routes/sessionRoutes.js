import express from "express";
import {checkSession} from "../controllers/sessionController.js";

const router = express.Router();

router.get("/", checkSession);

export default router;