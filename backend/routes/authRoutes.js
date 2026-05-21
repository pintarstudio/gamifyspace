import express from "express";
import {instructorLogin, login, logout, resolveDemoLogin} from "../controllers/authController.js";

const router = express.Router();

router.get("/demo-login", resolveDemoLogin);
router.post("/login", login);
router.post("/instructor-login", instructorLogin);
router.post("/logout", logout);

export default router;
