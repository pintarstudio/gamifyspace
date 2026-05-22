const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const DEFAULT_QUESTION_MODEL = "gpt-5.4-nano";

const materialDigestSchema = {
    type: "object",
    additionalProperties: false,
    required: ["summary", "key_concepts", "common_misconceptions", "important_excerpts", "question_targets"],
    properties: {
        summary: {type: "string"},
        key_concepts: {
            type: "array",
            maxItems: 15,
            items: {type: "string"},
        },
        common_misconceptions: {
            type: "array",
            maxItems: 10,
            items: {type: "string"},
        },
        important_excerpts: {
            type: "array",
            maxItems: 10,
            items: {type: "string"},
        },
        question_targets: {
            type: "array",
            maxItems: 15,
            items: {type: "string"},
        },
    },
};

const questionDraftSchema = {
    type: "object",
    additionalProperties: false,
    required: ["items"],
    properties: {
        items: {
            type: "array",
            items: {
                type: "object",
                additionalProperties: false,
                required: [
                    "question_number",
                    "question_text",
                    "choices",
                    "correct_answer_index",
                    "explanation",
                    "case_number",
                    "case_title",
                    "case_prompt",
                    "source_excerpt",
                ],
                properties: {
                    question_number: {type: "integer"},
                    question_text: {type: "string"},
                    choices: {
                        type: "array",
                        minItems: 4,
                        maxItems: 4,
                        items: {type: "string"},
                    },
                    correct_answer_index: {type: "integer"},
                    explanation: {type: "string"},
                    case_number: {type: "integer"},
                    case_title: {type: "string"},
                    case_prompt: {type: "string"},
                    source_excerpt: {type: "string"},
                },
            },
        },
    },
};

function getQuestionModel(modelOverride = "") {
    return String(modelOverride || "").trim()
        || process.env.OPENAI_QUESTION_MODEL
        || process.env.OPENAI_FEEDBACK_MODEL
        || DEFAULT_QUESTION_MODEL;
}

function extractResponseText(responseBody) {
    if (responseBody?.output_text) return responseBody.output_text;
    const output = responseBody?.output || [];
    return output
        .flatMap((item) => item.content || [])
        .map((content) => content.text || "")
        .filter(Boolean)
        .join("\n")
        .trim();
}

function requireApiKey() {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        const error = new Error("OPENAI_API_KEY is not configured");
        error.code = "OPENAI_API_KEY_MISSING";
        throw error;
    }
    return apiKey;
}

function trimWords(text, maxWords) {
    const words = String(text || "").trim().split(/\s+/).filter(Boolean);
    if (words.length <= maxWords) return words.join(" ");
    return `${words.slice(0, maxWords).join(" ")}...`;
}

function firstText(...values) {
    for (const value of values) {
        const text = String(value || "").trim();
        if (text) return text;
    }
    return "";
}

function normalizeDigest(digest) {
    return {
        summary: trimWords(digest.summary, 450),
        key_concepts: (digest.key_concepts || []).slice(0, 15).map((item) => trimWords(item, 30)),
        common_misconceptions: (digest.common_misconceptions || []).slice(0, 10).map((item) => trimWords(item, 30)),
        important_excerpts: (digest.important_excerpts || []).slice(0, 10).map((item) => trimWords(item, 45)),
        question_targets: (digest.question_targets || []).slice(0, 15).map((item) => trimWords(item, 30)),
    };
}

function normalizeDrafts(items, bankType, startNumber) {
    const isCaseBank = bankType === "topic_cases" || bankType === "individual_case";
    return (items || []).map((item, index) => {
        const number = Number.parseInt(item.question_number, 10) || startNumber + index;
        const choices = (item.choices || []).map((choice) => trimWords(choice, 32)).slice(0, 4);
        while (choices.length < 4 && !isCaseBank) {
            choices.push(`Option ${choices.length + 1}`);
        }
        let questionText = isCaseBank
            ? ""
            : firstText(
                item.question_text,
                item.question,
                item.question_stem,
                item.prompt,
                item.title,
            );
        if (!isCaseBank && !questionText) {
            questionText = item.source_excerpt
                ? `Which statement is best supported by this material: ${trimWords(item.source_excerpt, 18)}?`
                : "Which statement is best supported by the selected course material?";
        }
        return {
            question_number: number,
            question_text: trimWords(questionText, 80),
            choices,
            correct_answer_index: Math.max(0, Math.min(3, Number.parseInt(item.correct_answer_index, 10) || 0)),
            explanation: trimWords(item.explanation, 80),
            case_number: isCaseBank
                ? Math.max(1, Number.parseInt(startNumber, 10) + index)
                : Math.max(1, Number.parseInt(item.case_number, 10) || index + 1),
            case_title: trimWords(item.case_title, 20),
            case_prompt: trimWords(item.case_prompt, 220),
            source_excerpt: trimWords(item.source_excerpt, 80),
        };
    });
}

async function postStructuredResponse({name, schema, system, user, maxOutputTokens, model}) {
    const selectedModel = getQuestionModel(model);
    const tokenBudgets = [
        maxOutputTokens,
        Math.min(8000, Math.max(maxOutputTokens + 2000, Math.ceil(maxOutputTokens * 2.5))),
    ];
    let lastError = null;

    for (const tokenBudget of tokenBudgets) {
        const response = await fetch(OPENAI_RESPONSES_URL, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${requireApiKey()}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                model: selectedModel,
                input: [
                    {role: "system", content: system},
                    {role: "user", content: user},
                ],
                text: {
                    format: {
                        type: "json_schema",
                        name,
                        schema,
                        strict: true,
                    },
                },
                max_output_tokens: tokenBudget,
            }),
        });

        const responseBody = await response.json().catch(() => ({}));
        if (!response.ok) {
            const error = new Error(responseBody?.error?.message || "OpenAI question bank request failed");
            error.code = "OPENAI_QUESTION_BANK_FAILED";
            error.status = response.status;
            throw error;
        }

        if (responseBody?.status === "incomplete" || responseBody?.incomplete_details) {
            lastError = new Error(
                responseBody?.incomplete_details?.reason === "max_output_tokens"
                    ? "OpenAI question bank response was cut off by max_output_tokens"
                    : "OpenAI question bank response was incomplete"
            );
            lastError.code = "OPENAI_QUESTION_BANK_INCOMPLETE";
            continue;
        }

        const outputText = extractResponseText(responseBody);
        if (!outputText) {
            const error = new Error("OpenAI question bank response did not include output text");
            error.code = "OPENAI_QUESTION_BANK_EMPTY";
            throw error;
        }

        try {
            return JSON.parse(outputText);
        } catch (error) {
            error.code = "OPENAI_QUESTION_BANK_PARSE_FAILED";
            error.outputLength = outputText.length;
            lastError = error;
        }
    }

    throw lastError;
}

export async function generateMaterialDigest({topicName, materialTitle, contentText}) {
    const parsed = await postStructuredResponse({
        name: "topic_material_digest",
        schema: materialDigestSchema,
        system: [
            "You create compact course-material digests for question generation.",
            "Use only the supplied material. Do not add outside knowledge.",
            "Keep the digest concise and grounded in the material.",
            "The question_targets field must describe what instructor-review questions should assess.",
            "Return only JSON matching the schema.",
        ].join(" "),
        user: JSON.stringify({
            topic_name: topicName,
            material_title: materialTitle,
            material_text: contentText,
            digest_limits: {
                summary: "350 to 450 words",
                key_concepts: "maximum 15 items, each item 20 to 30 words",
                common_misconceptions: "maximum 10 items, each item 20 to 30 words",
                important_excerpts: "maximum 10 items, each item 30 to 45 words",
                question_targets: "maximum 15 items, each item 15 to 30 words",
            },
        }),
        maxOutputTokens: 5000,
    });

    return {
        digest: normalizeDigest(parsed),
        model: getQuestionModel(),
    };
}

function buildSourceFromMaterials(materials) {
    const materialList = materials || [];
    const digestMaterials = materialList.filter((material) => material.digest_json);
    if (digestMaterials.length > 0) {
        return {
            materials: digestMaterials.map((material) => ({
                material_title: material.title,
                summary: material.digest_json.summary,
                key_concepts: material.digest_json.key_concepts,
                common_misconceptions: material.digest_json.common_misconceptions,
                important_excerpts: material.digest_json.important_excerpts,
                question_targets: material.digest_json.question_targets || [],
            })),
            raw_excerpts: materialList
                .filter((material) => !material.digest_json)
                .map((material) => ({
                    material_title: material.title,
                    raw_excerpt: trimWords(material.content_text, 450),
                })),
        };
    }

    return {
        raw_excerpts: materialList.map((material) => ({
            material_title: material.title,
            raw_excerpt: trimWords(material.content_text, 450),
        })),
    };
}

export async function generateQuestionDrafts({bankType, topicName, materials, material, count, activityType, questionKind, startNumber, model}) {
    const selectedModel = getQuestionModel(model);
    const isCase = bankType === "topic_cases" || bankType === "individual_case" || questionKind === "case_study";
    const safeCount = isCase ? Math.max(1, Math.min(15, Number.parseInt(count, 10) || 1)) : Math.max(1, Math.min(20, Number.parseInt(count, 10) || 5));
    const materialList = materials?.length ? materials : [material].filter(Boolean);
    const source = buildSourceFromMaterials(materialList);

    const parsed = await postStructuredResponse({
        name: "question_bank_drafts",
        schema: questionDraftSchema,
        system: [
            "You generate instructor-review drafts for a learning question bank.",
            "Write all generated student-facing content in Bahasa Indonesia, including question_text, choices, explanation, case_title, case_prompt, and source_excerpt.",
            "Keep technical terms in their original language when they are standard course terminology, but explain surrounding wording in Bahasa Indonesia.",
            "Use only the provided course material or digest. Do not add outside facts.",
            "Every item must include a source_excerpt copied or closely paraphrased from the provided material.",
            "For multiple-choice items, question_text is mandatory and must contain the full question stem shown to students. Never leave question_text empty for multiple-choice items.",
            "Multiple-choice items must have exactly four choices and one correct_answer_index from 0 to 3.",
            "For multiple-choice items, make distractors plausible for students who partially understand the material; avoid absurd or obviously false options.",
            "Keep all multiple-choice options similar in length, specificity, and grammatical style so the correct answer is not visually obvious.",
            "Avoid using 'all of the above', 'none of the above', or combined options such as 'both A and B' as a default pattern. Use them only when they genuinely improve the question and are strongly supported by the material.",
            "Prefer questions that test understanding, application, or conceptual distinction instead of simple keyword matching.",
            "Before returning JSON, silently check that the correct option is not obviously longer or more detailed, distractors are plausible, and choices are mutually exclusive.",
            "For case-study items, use case_title, case_prompt, and case_number; leave question_text empty only for case-study items.",
            "Return only JSON matching the schema.",
        ].join(" "),
        user: JSON.stringify({
            bank_type: bankType,
            topic_name: topicName,
            activity_type: activityType,
            question_kind: questionKind,
            question_type: isCase ? "case_study" : "multiple_choice",
            requested_count: safeCount,
            start_number: startNumber,
            source,
        }),
        maxOutputTokens: isCase ? Math.min(6200, 700 + safeCount * 320) : Math.min(6200, 700 + safeCount * 260),
        model: selectedModel,
    });

    return {
        items: normalizeDrafts(parsed.items, bankType, startNumber).slice(0, safeCount),
        model: selectedModel,
    };
}
