import express from "express";
import {login, logout, resolveDemoLogin} from "../controllers/authController.js";

const router = express.Router();

router.get("/demo-login", resolveDemoLogin);
router.post("/login", login);
router.post("/logout", logout);

export default router;
