import React from "react";
import "./MarkdownText.css";

function renderInlineCode(text, keyPrefix) {
    const parts = String(text || "").split(/(`[^`]+`)/g);
    return parts.map((part, index) => {
        if (part.startsWith("`") && part.endsWith("`") && part.length > 1) {
            return <code key={`${keyPrefix}-code-${index}`}>{part.slice(1, -1)}</code>;
        }
        return <React.Fragment key={`${keyPrefix}-text-${index}`}>{part}</React.Fragment>;
    });
}

function renderTextBlock(text, keyPrefix) {
    const blocks = String(text || "")
        .split(/\n{2,}/)
        .map((block) => block.trim())
        .filter(Boolean);

    return blocks.map((block, index) => {
        const lines = block.split("\n");
        const isList = lines.every((line) => /^\s*[-*]\s+/.test(line));
        if (isList) {
            return (
                <ul key={`${keyPrefix}-list-${index}`}>
                    {lines.map((line, lineIndex) => (
                        <li key={`${keyPrefix}-list-${index}-${lineIndex}`}>
                            {renderInlineCode(line.replace(/^\s*[-*]\s+/, ""), `${keyPrefix}-${index}-${lineIndex}`)}
                        </li>
                    ))}
                </ul>
            );
        }

        return (
            <p key={`${keyPrefix}-p-${index}`}>
                {lines.map((line, lineIndex) => (
                    <React.Fragment key={`${keyPrefix}-line-${index}-${lineIndex}`}>
                        {lineIndex > 0 && <br />}
                        {renderInlineCode(line, `${keyPrefix}-${index}-${lineIndex}`)}
                    </React.Fragment>
                ))}
            </p>
        );
    });
}

function normalizeCodeText(value) {
    let code = String(value || "")
        .replace(/^\s*\n/, "")
        .replace(/\n\s*$/, "")
        .replace(/\\n/g, "\n")
        .replace(/\r\n?/g, "\n");

    if (!code.includes("\n") && code.length > 90 && /[;{}]/.test(code)) {
        code = code
            .replace(/\s*{\s*/g, " {\n")
            .replace(/;\s*/g, ";\n")
            .replace(/\s*}\s*/g, "\n}\n")
            .replace(/\n{3,}/g, "\n\n")
            .trim();
    }

    return code;
}

const MarkdownText = ({children, className = ""}) => {
    const text = String(children || "").replace(/\r\n?/g, "\n");
    if (!text.trim()) return null;

    const parts = [];
    const fencePattern = /```([a-zA-Z0-9_+-]*)[ \t]*(?:\n)?([\s\S]*?)```/g;
    let lastIndex = 0;
    let match;

    while ((match = fencePattern.exec(text)) !== null) {
        if (match.index > lastIndex) {
            parts.push({type: "text", value: text.slice(lastIndex, match.index)});
        }
        parts.push({
            type: "code",
            language: match[1] || "",
            value: normalizeCodeText(match[2]),
        });
        lastIndex = fencePattern.lastIndex;
    }

    if (lastIndex < text.length) {
        parts.push({type: "text", value: text.slice(lastIndex)});
    }

    return (
        <div className={`markdown-text ${className}`.trim()}>
            {parts.map((part, index) => {
                if (part.type === "code") {
                    return (
                        <div className="markdown-code-block" key={`code-${index}`}>
                            {part.language && <span>{part.language}</span>}
                            <pre><code>{part.value}</code></pre>
                        </div>
                    );
                }
                return renderTextBlock(part.value, `text-${index}`);
            })}
        </div>
    );
};

export default MarkdownText;
