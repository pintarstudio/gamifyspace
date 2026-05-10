import express from "express";
import {
    createAdminResourceData,
    createQuestionBankItem,
    createTopicMaterialData,
    deleteAdminResourceData,
    deleteTopicMaterialData,
    generateQuestionBankDrafts,
    generateTopicMaterialDigest,
    getAdminReferenceData,
    getAdminResource,
    getAdminSession,
    getQuestionBankItems,
    getTopicMaterials,
    loginAdmin,
    logoutAdmin,
    saveQuestionBankDrafts,
    updateQuestionBankItem,
    updateTopicMaterialData,
    updateAdminResourceData,
} from "../controllers/adminController.js";

const router = express.Router();

router.get("/session", getAdminSession);
router.post("/login", loginAdmin);
router.post("/logout", logoutAdmin);
router.get("/references", getAdminReferenceData);
router.get("/resources/:resource", getAdminResource);
router.post("/resources/:resource", createAdminResourceData);
router.patch("/resources/:resource/:id", updateAdminResourceData);
router.delete("/resources/:resource/:id", deleteAdminResourceData);
router.get("/materials", getTopicMaterials);
router.post("/materials", createTopicMaterialData);
router.patch("/materials/:materialId", updateTopicMaterialData);
router.delete("/materials/:materialId", deleteTopicMaterialData);
router.post("/materials/:materialId/digest", generateTopicMaterialDigest);
router.post("/question-bank/generate", generateQuestionBankDrafts);
router.post("/question-bank/save", saveQuestionBankDrafts);
router.get("/question-bank/:bankType", getQuestionBankItems);
router.post("/question-bank/:bankType", createQuestionBankItem);
router.patch("/question-bank/:bankType/:id", updateQuestionBankItem);

export default router;
