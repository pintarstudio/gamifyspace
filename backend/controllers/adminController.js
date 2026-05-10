import {
    createAdminResource,
    deleteAdminResource,
    ensureAdminTables,
    findAdminById,
    findAdminByUsername,
    getAdminReferences,
    listAdminResource,
    updateAdminLastLogin,
    updateAdminResource,
    verifyAdminPassword,
} from "../models/adminModel.js";
import {
    createTopicMaterial,
    deleteTopicMaterial,
    getNextQuestionNumber,
    getTopicMaterialById,
    getTopicMaterialsByIds,
    listQuestionBankItems,
    listTopicMaterials,
    markMaterialDigestError,
    saveGeneratedQuestions,
    saveMaterialDigest,
    updateTopicMaterial,
    upsertQuestionBankItem,
} from "../models/adminQuestionBankModel.js";
import {
    generateMaterialDigest,
    generateQuestionDrafts,
} from "../services/openaiQuestionBankService.js";

function serializeAdmin(admin) {
    if (!admin) return null;
    return {
        useradmin_id: admin.useradmin_id,
        instructor_id: admin.instructor_id,
        instructor_name: admin.instructor_name,
        username: admin.username,
        role: admin.role,
        last_login: admin.last_login,
    };
}

async function getCurrentAdmin(req) {
    await ensureAdminTables();
    const adminId = req.session?.admin_useradmin_id;
    if (!adminId) return null;

    const admin = await findAdminById(adminId);
    if (!admin || admin.is_disabled) {
        req.session.admin_useradmin_id = null;
        return null;
    }
    return admin;
}

function validatePayload(resource, payload, mode = "create") {
    if (resource === "levels") {
        if (mode !== "update") return "Gamification level can only be edited";
        if (!payload.level_name) return "Level name wajib diisi";
        if (payload.min_xp === "" || payload.min_xp === undefined || payload.min_xp === null) return "Minimum XP wajib diisi";
        if (!payload.color_hex) return "Color wajib diisi";
        return null;
    }

    if (resource === "avatars") {
        if (!payload.avatar_name) return "Avatar name wajib diisi";
        if (!payload.avatar_public_path) return "Avatar public path wajib diisi";
        return null;
    }

    if (resource === "courses") {
        if (!payload.course_code) return "Course code wajib diisi";
        if (!payload.course_name) return "Course name wajib diisi";
        if (!payload.instructor_id) return "Instructor wajib dipilih";
        return null;
    }

    if (resource === "topics") {
        if (!payload.course_id) return "Course wajib dipilih";
        if (!payload.topic_name) return "Topic name wajib diisi";
        return null;
    }

    if (resource === "students") {
        if (mode !== "update") return "Student data can only be edited";
        if (!payload.name) return "Student name wajib diisi";
        if (!payload.email) return "Student email wajib diisi";
        if (!payload.course_id) return "Course wajib dipilih";
        return null;
    }

    return "Resource tidak dikenal";
}

function normalizeQuestionSelection(payload) {
    const bankType = payload.bank_type;
    if (bankType === "quiz_question_bank") {
        return {
            bankType,
            activityType: null,
            questionKind: "multiple_choice",
            questionType: "multiple_choice",
        };
    }
    if (bankType === "topic_cases") {
        return {
            bankType,
            activityType: null,
            questionKind: "case_study",
            questionType: "case_study",
        };
    }

    const option = payload.individual_question_type;
    if (option === "exercise_case_study") {
        return {
            bankType,
            activityType: "exercise",
            questionKind: "case_study",
            questionType: "case_study",
        };
    }

    const activityType = option === "pre_test_multiple_choice"
        ? "pre_test"
        : option === "post_test_multiple_choice"
            ? "post_test"
            : payload.activity_type || "exercise";

    return {
        bankType,
        activityType,
        questionKind: "multiple_choice",
        questionType: "multiple_choice",
    };
}

export async function getAdminSession(req, res) {
    try {
        const admin = await getCurrentAdmin(req);
        if (!admin) return res.json({loggedIn: false});

        res.json({loggedIn: true, admin: serializeAdmin(admin)});
    } catch (error) {
        console.error("Admin session error:", error);
        res.status(500).json({loggedIn: false});
    }
}

export async function loginAdmin(req, res) {
    try {
        await ensureAdminTables();
        const username = String(req.body.username || "").trim();
        const password = String(req.body.password || "");

        if (!username || !password) {
            return res.status(400).json({message: "Username dan password wajib diisi"});
        }

        const admin = await findAdminByUsername(username);
        if (!admin || !verifyAdminPassword(password, admin.password_hash)) {
            return res.status(401).json({message: "Username atau password tidak sesuai"});
        }
        if (admin.is_disabled) {
            return res.status(403).json({message: "Akun admin tidak aktif"});
        }

        const lastLogin = await updateAdminLastLogin(admin.useradmin_id);
        req.session.admin_useradmin_id = admin.useradmin_id;

        res.json({
            message: "Login berhasil",
            admin: serializeAdmin({...admin, last_login: lastLogin}),
        });
    } catch (error) {
        console.error("Admin login error:", error);
        res.status(500).json({message: "Gagal login admin"});
    }
}

export async function logoutAdmin(req, res) {
    try {
        req.session.admin_useradmin_id = null;
        res.json({message: "Logout berhasil"});
    } catch (error) {
        res.status(500).json({message: "Gagal logout admin"});
    }
}

export async function getAdminReferenceData(req, res) {
    try {
        const admin = await getCurrentAdmin(req);
        if (!admin) return res.status(401).json({message: "Admin belum login"});

        const references = await getAdminReferences();
        res.json(references);
    } catch (error) {
        console.error("Admin references error:", error);
        res.status(500).json({message: "Gagal mengambil referensi admin"});
    }
}

export async function getAdminResource(req, res) {
    try {
        const admin = await getCurrentAdmin(req);
        if (!admin) return res.status(401).json({message: "Admin belum login"});

        const rows = await listAdminResource(req.params.resource);
        if (!rows) return res.status(404).json({message: "Resource tidak ditemukan"});
        res.json({rows});
    } catch (error) {
        console.error("Admin resource list error:", error);
        res.status(500).json({message: "Gagal mengambil data admin"});
    }
}

export async function createAdminResourceData(req, res) {
    try {
        const admin = await getCurrentAdmin(req);
        if (!admin) return res.status(401).json({message: "Admin belum login"});

        const message = validatePayload(req.params.resource, req.body, "create");
        if (message) return res.status(400).json({message});

        const created = await createAdminResource(req.params.resource, req.body);
        if (!created) return res.status(404).json({message: "Resource tidak ditemukan"});
        res.status(201).json({message: "Data berhasil ditambahkan", data: created});
    } catch (error) {
        console.error("Admin resource create error:", error);
        res.status(500).json({message: "Gagal menambahkan data"});
    }
}

export async function updateAdminResourceData(req, res) {
    try {
        const admin = await getCurrentAdmin(req);
        if (!admin) return res.status(401).json({message: "Admin belum login"});

        const message = validatePayload(req.params.resource, req.body, "update");
        if (message) return res.status(400).json({message});

        const updated = await updateAdminResource(req.params.resource, req.params.id, req.body);
        if (!updated) return res.status(404).json({message: "Data tidak ditemukan"});
        res.json({message: "Data berhasil diperbarui", data: updated});
    } catch (error) {
        console.error("Admin resource update error:", error);
        res.status(500).json({message: "Gagal memperbarui data"});
    }
}

export async function deleteAdminResourceData(req, res) {
    try {
        const admin = await getCurrentAdmin(req);
        if (!admin) return res.status(401).json({message: "Admin belum login"});

        const deleted = await deleteAdminResource(req.params.resource, req.params.id);
        if (!deleted) return res.status(404).json({message: "Data tidak ditemukan atau tidak bisa dihapus"});
        res.json({message: "Data berhasil dihapus"});
    } catch (error) {
        console.error("Admin resource delete error:", error);
        res.status(500).json({message: "Gagal menghapus data"});
    }
}

export async function getTopicMaterials(req, res) {
    try {
        const admin = await getCurrentAdmin(req);
        if (!admin) return res.status(401).json({message: "Admin belum login"});

        const materials = await listTopicMaterials(req.query.topic_id || null);
        res.json({materials});
    } catch (error) {
        console.error("Admin material list error:", error);
        res.status(500).json({message: "Gagal mengambil course material"});
    }
}

export async function createTopicMaterialData(req, res) {
    try {
        const admin = await getCurrentAdmin(req);
        if (!admin) return res.status(401).json({message: "Admin belum login"});
        if (!req.body.topic_id || !req.body.title || !req.body.content_text) {
            return res.status(400).json({message: "Topic, title, dan material text wajib diisi"});
        }

        const data = await createTopicMaterial({
            topicId: req.body.topic_id,
            title: req.body.title,
            contentText: req.body.content_text,
            createdBy: admin.useradmin_id,
        });
        res.status(201).json({message: "Course material berhasil disimpan", data});
    } catch (error) {
        console.error("Admin material create error:", error);
        res.status(500).json({message: "Gagal menyimpan course material"});
    }
}

export async function updateTopicMaterialData(req, res) {
    try {
        const admin = await getCurrentAdmin(req);
        if (!admin) return res.status(401).json({message: "Admin belum login"});
        if (!req.body.topic_id || !req.body.title || !req.body.content_text) {
            return res.status(400).json({message: "Topic, title, dan material text wajib diisi"});
        }

        const data = await updateTopicMaterial(req.params.materialId, {
            topicId: req.body.topic_id,
            title: req.body.title,
            contentText: req.body.content_text,
        });
        if (!data) return res.status(404).json({message: "Course material tidak ditemukan"});
        res.json({message: "Course material berhasil diperbarui", data});
    } catch (error) {
        console.error("Admin material update error:", error);
        res.status(500).json({message: "Gagal memperbarui course material"});
    }
}

export async function deleteTopicMaterialData(req, res) {
    try {
        const admin = await getCurrentAdmin(req);
        if (!admin) return res.status(401).json({message: "Admin belum login"});

        const data = await deleteTopicMaterial(req.params.materialId);
        if (!data) return res.status(404).json({message: "Course material tidak ditemukan"});
        res.json({message: "Course material berhasil dihapus"});
    } catch (error) {
        console.error("Admin material delete error:", error);
        res.status(500).json({message: "Gagal menghapus course material"});
    }
}

export async function generateTopicMaterialDigest(req, res) {
    try {
        const admin = await getCurrentAdmin(req);
        if (!admin) return res.status(401).json({message: "Admin belum login"});

        const material = await getTopicMaterialById(req.params.materialId);
        if (!material) return res.status(404).json({message: "Course material tidak ditemukan"});

        const result = await generateMaterialDigest({
            topicName: material.topic_name,
            materialTitle: material.title,
            contentText: material.content_text,
        });
        await saveMaterialDigest(material.material_id, result.digest, result.model);
        res.json({message: "Digest material berhasil dibuat", digest: result.digest, model: result.model});
    } catch (error) {
        console.error("Admin material digest error:", error);
        if (req.params.materialId) {
            await markMaterialDigestError(req.params.materialId, error.message || "Gagal membuat digest").catch(() => {});
        }
        if (error.code === "OPENAI_API_KEY_MISSING") {
            return res.status(500).json({message: "OpenAI API key belum dikonfigurasi"});
        }
        res.status(502).json({message: "Gagal membuat digest dari OpenAI"});
    }
}

export async function generateQuestionBankDrafts(req, res) {
    try {
        const admin = await getCurrentAdmin(req);
        if (!admin) return res.status(401).json({message: "Admin belum login"});

        const materialIds = Array.isArray(req.body.material_ids)
            ? req.body.material_ids
            : req.body.material_id ? [req.body.material_id] : [];
        const materials = await getTopicMaterialsByIds(materialIds);
        if (materials.length === 0) return res.status(404).json({message: "Course material tidak ditemukan"});
        if (materials.length !== materialIds.length) {
            return res.status(400).json({message: "Sebagian material tidak ditemukan"});
        }
        if (materials.some((material) => String(material.topic_id) !== String(req.body.topic_id))) {
            return res.status(400).json({message: "Material tidak sesuai dengan topic yang dipilih"});
        }

        const {bankType, activityType, questionKind, questionType} = normalizeQuestionSelection(req.body);
        const startNumber = await getNextQuestionNumber({
            bankType,
            topicId: req.body.topic_id,
            activityType,
            questionKind,
        });

        const result = await generateQuestionDrafts({
            bankType: bankType === "individual_questions" && questionKind === "case_study" ? "individual_case" : bankType,
            topicName: materials[0].topic_name,
            materials,
            count: req.body.count,
            activityType,
            questionKind,
            startNumber,
        });

        res.json({
            message: "Draft question berhasil dibuat",
            model: result.model,
            items: result.items.map((item) => ({...item, question_type: questionType})),
            used_digest: materials.some((material) => !!material.digest_json),
            material_count: materials.length,
            token_estimate: materials.reduce((total, material) => total + Number(material.content_token_estimate || 0), 0),
        });
    } catch (error) {
        console.error("Admin question draft error:", error);
        if (error.code === "OPENAI_API_KEY_MISSING") {
            return res.status(500).json({message: "OpenAI API key belum dikonfigurasi"});
        }
        res.status(502).json({message: "Gagal membuat draft question dari OpenAI"});
    }
}

export async function saveQuestionBankDrafts(req, res) {
    try {
        const admin = await getCurrentAdmin(req);
        if (!admin) return res.status(401).json({message: "Admin belum login"});
        if (!req.body.topic_id || !req.body.bank_type || !Array.isArray(req.body.items) || req.body.items.length === 0) {
            return res.status(400).json({message: "Topic, bank type, dan draft question wajib diisi"});
        }

        const {activityType, questionKind} = normalizeQuestionSelection(req.body);
        const saved = await saveGeneratedQuestions({
            bankType: req.body.bank_type,
            topicId: req.body.topic_id,
            activityType,
            questionKind,
            items: req.body.items,
        });
        res.json({message: `${saved.length} question berhasil disimpan`, saved});
    } catch (error) {
        console.error("Admin question save error:", error);
        res.status(500).json({message: "Gagal menyimpan question bank"});
    }
}

export async function getQuestionBankItems(req, res) {
    try {
        const admin = await getCurrentAdmin(req);
        if (!admin) return res.status(401).json({message: "Admin belum login"});

        const rows = await listQuestionBankItems(req.params.bankType, req.query.topic_id || null);
        if (!rows) return res.status(404).json({message: "Question bank tidak ditemukan"});
        res.json({rows});
    } catch (error) {
        console.error("Admin question bank list error:", error);
        res.status(500).json({message: "Gagal mengambil question bank"});
    }
}

function validateQuestionBankPayload(bankType, payload) {
    if (!payload.topic_id) return "Topic wajib dipilih";
    if (bankType === "quiz_question_bank") {
        if (!payload.question_number || !payload.question_text) return "Question number dan question wajib diisi";
        const choices = Array.isArray(payload.choices)
            ? payload.choices
            : String(payload.choices_text || "").split("\n").filter((item) => item.trim());
        if (choices.length !== 4) return "Multiple choice wajib memiliki 4 pilihan";
    }
    if (bankType === "individual_questions") {
        if (!payload.question_number || !payload.question_kind) return "Question type dan number wajib diisi";
        if (payload.question_kind === "case_study") {
            if (!payload.case_title || !payload.case_prompt) return "Case title dan prompt wajib diisi";
        } else {
            if (!payload.question_text) return "Question wajib diisi";
            const choices = Array.isArray(payload.choices)
                ? payload.choices
                : String(payload.choices_text || "").split("\n").filter((item) => item.trim());
            if (choices.length !== 4) return "Multiple choice wajib memiliki 4 pilihan";
        }
    }
    if (bankType === "topic_cases") {
        if (!payload.case_number || !payload.case_title || !payload.case_prompt) return "Case number, title, dan prompt wajib diisi";
    }
    return null;
}

export async function createQuestionBankItem(req, res) {
    try {
        const admin = await getCurrentAdmin(req);
        if (!admin) return res.status(401).json({message: "Admin belum login"});

        const message = validateQuestionBankPayload(req.params.bankType, req.body);
        if (message) return res.status(400).json({message});

        const data = await upsertQuestionBankItem(req.params.bankType, req.body);
        if (!data) return res.status(404).json({message: "Question bank tidak ditemukan"});
        res.status(201).json({message: "Question bank berhasil ditambahkan", data});
    } catch (error) {
        console.error("Admin question bank create error:", error);
        res.status(500).json({message: "Gagal menambahkan question bank"});
    }
}

export async function updateQuestionBankItem(req, res) {
    try {
        const admin = await getCurrentAdmin(req);
        if (!admin) return res.status(401).json({message: "Admin belum login"});

        const message = validateQuestionBankPayload(req.params.bankType, req.body);
        if (message) return res.status(400).json({message});

        const data = await upsertQuestionBankItem(req.params.bankType, req.body, req.params.id);
        if (!data) return res.status(404).json({message: "Question bank item tidak ditemukan"});
        res.json({message: "Question bank berhasil diperbarui", data});
    } catch (error) {
        console.error("Admin question bank update error:", error);
        res.status(500).json({message: "Gagal memperbarui question bank"});
    }
}
