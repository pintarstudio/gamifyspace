import express from "express";
import {listRoles} from "../models/roleModel.js";

const router = express.Router();

router.get("/", async (req, res) => {
    try {
        const roles = await listRoles();
        res.json(roles);
    } catch (error) {
        console.error("Role list error:", error);
        res.status(500).json({message: "Gagal mengambil data role"});
    }
});

export default router;
