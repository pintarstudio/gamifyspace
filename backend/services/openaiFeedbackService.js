const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const DEFAULT_FEEDBACK_MODEL = "gpt-5.4-nano";

const feedbackSchema = {
    type: "object",
    additionalProperties: false,
    required: ["combined_feedback", "student_feedback_groups", "xp_awards"],
    properties: {
        combined_feedback: {
            type: "object",
            additionalProperties: false,
            required: ["www", "ebi"],
            properties: {
                www: {type: "string"},
                ebi: {type: "string"},
            },
        },
        student_feedback_groups: {
            type: "array",
            items: {
                type: "object",
                additionalProperties: false,
                required: ["student_ids", "student_names", "www", "ebi"],
                properties: {
                    student_ids: {
                        type: "array",
                        items: {type: "integer"},
                    },
                    student_names: {
                        type: "array",
                        items: {type: "string"},
                    },
                    www: {type: "string"},
                    ebi: {type: "string"},
                },
            },
        },
        xp_awards: {
            type: "object",
            additionalProperties: false,
            required: ["group_xp", "group_xp_reason", "student_xp_awards"],
            properties: {
                group_xp: {
                    type: "integer",
                },
                group_xp_reason: {type: "string"},
                student_xp_awards: {
                    type: "array",
                    items: {
                        type: "object",
                        additionalProperties: false,
                        required: ["student_id", "xp", "reason"],
                        properties: {
                            student_id: {type: "integer"},
                            xp: {
                                type: "integer",
                            },
                            reason: {type: "string"},
                        },
                    },
                },
            },
        },
    },
};

const quizWrongAnswerFeedbackSchema = {
    type: "object",
    additionalProperties: false,
    required: ["items"],
    properties: {
        items: {
            type: "array",
            items: {
                type: "object",
                additionalProperties: false,
                required: ["user_id", "question_id", "feedback"],
                properties: {
                    user_id: {type: "integer"},
                    question_id: {type: "integer"},
                    feedback: {type: "string"},
                },
            },
        },
    },
};

const individualCaseFeedbackSchema = {
    type: "object",
    additionalProperties: false,
    required: ["www", "ebi", "xp", "xp_reason"],
    properties: {
        www: {type: "string"},
        ebi: {type: "string"},
        xp: {type: "integer"},
        xp_reason: {type: "string"},
    },
};

function wordLimit(text, maxWords) {
    const words = String(text || "").trim().split(/\s+/).filter(Boolean);
    if (words.length <= maxWords) return words.join(" ");
    return `${words.slice(0, maxWords).join(" ")}...`;
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

function normalizeFeedback(feedback, answers) {
    const answerMap = new Map(answers.map((answer) => [Number(answer.user_id), answer.name]));
    const seenStudentIds = new Set();

    const studentFeedbackGroups = (feedback.student_feedback_groups || [])
        .map((group) => {
            const studentIds = (group.student_ids || [])
                .map((studentId) => Number(studentId))
                .filter((studentId) => Number.isInteger(studentId) && answerMap.has(studentId));
            const uniqueStudentIds = [...new Set(studentIds)];

            uniqueStudentIds.forEach((studentId) => seenStudentIds.add(studentId));

            return {
                student_ids: uniqueStudentIds,
                student_names: uniqueStudentIds.map((studentId) => answerMap.get(studentId)),
                www: wordLimit(group.www, 75),
                ebi: wordLimit(group.ebi, 75),
            };
        })
        .filter((group) => group.student_ids.length > 0);

    for (const answer of answers) {
        const studentId = Number(answer.user_id);
        if (!seenStudentIds.has(studentId)) {
            studentFeedbackGroups.push({
                student_ids: [studentId],
                student_names: [answer.name],
                www: "WWW: Your response was included in the group submission and shows an effort to engage with the case.",
                ebi: "EBI: Add clearer reasoning, direct links to the case details, and a specific recommendation supported by evidence.",
            });
        }
    }

    const xpAwardMap = new Map();
    for (const award of feedback.xp_awards?.student_xp_awards || []) {
        const studentId = Number(award.student_id);
        if (!answerMap.has(studentId)) continue;
        xpAwardMap.set(studentId, {
            student_id: studentId,
            xp: Math.max(0, Math.min(100, Number.parseInt(award.xp, 10) || 0)),
            reason: wordLimit(award.reason, 40),
        });
    }

    for (const studentId of answerMap.keys()) {
        if (!xpAwardMap.has(studentId)) {
            xpAwardMap.set(studentId, {
                student_id: studentId,
                xp: 0,
                reason: "No XP awarded because the answer was not evaluated.",
            });
        }
    }

    return {
        combined_feedback: {
            www: wordLimit(feedback.combined_feedback?.www, 150),
            ebi: wordLimit(feedback.combined_feedback?.ebi, 150),
        },
        student_feedback_groups: studentFeedbackGroups,
        xp_awards: {
            group_xp: Math.max(0, Math.min(100, Number.parseInt(feedback.xp_awards?.group_xp, 10) || 0)),
            group_xp_reason: wordLimit(feedback.xp_awards?.group_xp_reason, 40),
            student_xp_awards: [...xpAwardMap.values()],
        },
    };
}

export function getOpenAiFeedbackModel() {
    return process.env.OPENAI_FEEDBACK_MODEL || DEFAULT_FEEDBACK_MODEL;
}

export async function generateCognitiveFeedback({caseTitle, casePrompt, answers}) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        const error = new Error("OPENAI_API_KEY is not configured");
        error.code = "OPENAI_API_KEY_MISSING";
        throw error;
    }

    const model = getOpenAiFeedbackModel();
    const feedbackInput = {
        case_title: caseTitle,
        case_prompt: casePrompt,
        answers: answers.map((answer) => ({
            student_id: Number(answer.user_id),
            student_name: answer.name,
            answer_text: answer.answer_text,
        })),
    };

    const response = await fetch(OPENAI_RESPONSES_URL, {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            model,
            input: [
                {
                    role: "system",
                    content: [
                        "You are an educational cognitive-evaluation assistant for collaborative case study answers.",
                        "Return only JSON that matches the schema.",
                        "Evaluate reasoning, problem identification, use of evidence, conceptual understanding, and quality of recommendations.",
                        "Group students with substantially similar answers into the same student_feedback_groups item to reduce repeated feedback.",
                        "Award group_xp from 0 to 100 based on the overall quality of the combined submitted answers.",
                        "Award each submitted student one individual xp from 0 to 100 based on that student's answer quality.",
                        "Use 0 for answers with no relation to the case, around 10 for minimal but relevant effort, around 50 for partially correct reasoning, and 100 for excellent case-grounded reasoning.",
                        "For combined_feedback, keep WWW within 150 words and EBI within 150 words.",
                        "For each student feedback group, keep WWW plus EBI within 150 words total.",
                        "Keep XP reasons concise and explain why that score was earned.",
                        "Do not invent students. Every submitted student_id must appear exactly once across student_feedback_groups.",
                        "Every submitted student_id must appear exactly once in xp_awards.student_xp_awards.",
                    ].join(" "),
                },
                {
                    role: "user",
                    content: `Generate cognitive evaluation feedback for this JSON input:\n${JSON.stringify(feedbackInput)}`,
                },
            ],
            text: {
                format: {
                    type: "json_schema",
                    name: "table_activity_cognitive_feedback",
                    schema: feedbackSchema,
                    strict: true,
                },
            },
            max_output_tokens: 1200,
        }),
    });

    const responseBody = await response.json().catch(() => ({}));
    if (!response.ok) {
        const error = new Error(responseBody?.error?.message || "OpenAI feedback request failed");
        error.code = "OPENAI_FEEDBACK_FAILED";
        error.status = response.status;
        throw error;
    }

    const outputText = extractResponseText(responseBody);
    if (!outputText) {
        const error = new Error("OpenAI feedback response did not include output text");
        error.code = "OPENAI_FEEDBACK_EMPTY";
        throw error;
    }

    let parsed;
    try {
        parsed = JSON.parse(outputText);
    } catch (error) {
        error.code = "OPENAI_FEEDBACK_PARSE_FAILED";
        throw error;
    }

    return {
        feedback: normalizeFeedback(parsed, answers),
        model,
    };
}

export async function generateQuizWrongAnswerFeedback({items}) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        const error = new Error("OPENAI_API_KEY is not configured");
        error.code = "OPENAI_API_KEY_MISSING";
        throw error;
    }

    const safeItems = (items || []).map((item) => ({
        user_id: Number(item.user_id),
        student_name: item.student_name,
        question_id: Number(item.question_id),
        question_text: item.question_text,
        chosen_answer: item.chosen_answer,
        correct_answer: item.correct_answer,
    }));

    if (safeItems.length === 0) {
        return {feedback: [], model: getOpenAiFeedbackModel()};
    }

    const model = getOpenAiFeedbackModel();
    const response = await fetch(OPENAI_RESPONSES_URL, {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            model,
            input: [
                {
                    role: "system",
                    content: [
                        "You are a concise quiz tutor.",
                        "Return only JSON that matches the schema.",
                        "For each item, explain why the chosen answer is wrong and why the correct answer fits the question context.",
                        "Do not mention scoring, timing, or unrelated alternatives.",
                        "Keep each feedback under 100 words.",
                        "Return exactly one feedback item for each input item, preserving user_id and question_id.",
                    ].join(" "),
                },
                {
                    role: "user",
                    content: `Generate wrong-answer feedback for this JSON input:\n${JSON.stringify({items: safeItems})}`,
                },
            ],
            text: {
                format: {
                    type: "json_schema",
                    name: "quiz_wrong_answer_feedback",
                    schema: quizWrongAnswerFeedbackSchema,
                    strict: true,
                },
            },
            max_output_tokens: Math.min(2000, 180 + safeItems.length * 130),
        }),
    });

    const responseBody = await response.json().catch(() => ({}));
    if (!response.ok) {
        const error = new Error(responseBody?.error?.message || "OpenAI feedback request failed");
        error.code = "OPENAI_FEEDBACK_FAILED";
        error.status = response.status;
        throw error;
    }

    const outputText = extractResponseText(responseBody);
    if (!outputText) {
        const error = new Error("OpenAI feedback response did not include output text");
        error.code = "OPENAI_FEEDBACK_EMPTY";
        throw error;
    }

    let parsed;
    try {
        parsed = JSON.parse(outputText);
    } catch (error) {
        error.code = "OPENAI_FEEDBACK_PARSE_FAILED";
        throw error;
    }

    const expectedKeys = new Set(safeItems.map((item) => `${item.user_id}:${item.question_id}`));
    const feedback = (parsed.items || [])
        .map((item) => ({
            user_id: Number(item.user_id),
            question_id: Number(item.question_id),
            feedback: wordLimit(item.feedback, 100),
        }))
        .filter((item) => expectedKeys.has(`${item.user_id}:${item.question_id}`));

    return {feedback, model};
}

export async function generateIndividualCaseFeedback({caseTitle, casePrompt, answerText}) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        const error = new Error("OPENAI_API_KEY is not configured");
        error.code = "OPENAI_API_KEY_MISSING";
        throw error;
    }

    const model = getOpenAiFeedbackModel();
    const response = await fetch(OPENAI_RESPONSES_URL, {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            model,
            input: [
                {
                    role: "system",
                    content: [
                        "You are an educational evaluator for an individual case-study answer.",
                        "Return only JSON that matches the schema.",
                        "Evaluate conceptual understanding, case relevance, reasoning quality, and practicality of the recommendation.",
                        "WWW explains what the student did well.",
                        "EBI explains how the answer can be improved.",
                        "Award XP from 0 to 100. Use 0 for answers with no relation to the case, around 10 for minimal but relevant effort, around 50 for partially correct reasoning, and 100 for excellent case-grounded reasoning.",
                        "Keep WWW under 100 words, EBI under 100 words, and xp_reason under 40 words.",
                    ].join(" "),
                },
                {
                    role: "user",
                    content: `Evaluate this individual case-study response:\n${JSON.stringify({
                        case_title: caseTitle,
                        case_prompt: casePrompt,
                        answer_text: answerText,
                    })}`,
                },
            ],
            text: {
                format: {
                    type: "json_schema",
                    name: "individual_case_feedback",
                    schema: individualCaseFeedbackSchema,
                    strict: true,
                },
            },
            max_output_tokens: 700,
        }),
    });

    const responseBody = await response.json().catch(() => ({}));
    if (!response.ok) {
        const error = new Error(responseBody?.error?.message || "OpenAI feedback request failed");
        error.code = "OPENAI_FEEDBACK_FAILED";
        error.status = response.status;
        throw error;
    }

    const outputText = extractResponseText(responseBody);
    if (!outputText) {
        const error = new Error("OpenAI feedback response did not include output text");
        error.code = "OPENAI_FEEDBACK_EMPTY";
        throw error;
    }

    let parsed;
    try {
        parsed = JSON.parse(outputText);
    } catch (error) {
        error.code = "OPENAI_FEEDBACK_PARSE_FAILED";
        throw error;
    }

    return {
        feedback: {
            www: wordLimit(parsed.www, 100),
            ebi: wordLimit(parsed.ebi, 100),
            xp: Math.max(0, Math.min(100, Number.parseInt(parsed.xp, 10) || 0)),
            xp_reason: wordLimit(parsed.xp_reason, 40),
        },
        model,
    };
}
