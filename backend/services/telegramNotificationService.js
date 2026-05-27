const TELEGRAM_API_URL = "https://api.telegram.org";

function formatLoginTime(date = new Date()) {
    return new Intl.DateTimeFormat("en-GB", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: process.env.LOGIN_NOTIFICATION_TIME_ZONE || "Asia/Jakarta",
    }).format(date);
}

export async function notifyStudentLogin({user, course}) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_LOGIN_CHAT_ID;

    if (!token || !chatId) return;

    const text = [
        "Student logged in",
        `Name: ${user.name || "-"}`,
        `Email: ${user.email || "-"}`,
        `Course: ${course.course_name || "-"}`,
        `Time: ${formatLoginTime()}`,
    ].join("\n");

    const response = await fetch(`${TELEGRAM_API_URL}/bot${token}/sendMessage`, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
            chat_id: chatId,
            text,
            disable_web_page_preview: true,
        }),
    });

    if (!response.ok) {
        const body = await response.text();
        throw new Error(`Telegram notification failed: ${response.status} ${body}`);
    }
}
