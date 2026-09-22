'use strict';

const JSON5 = require('./vendor/wavedrom/json5');

/**
 * 剥离注释前缀（如 // 或 * 或 /*）
 * @param {string} line
 * @returns {string}
 */
function stripCommentPrefix(line) {
    if (typeof line !== 'string') return '';
    const trimmed = line.trim();
    // 匹配 // 前缀
    const slashMatch = line.match(/^(\s*)\/\/\s?(.*)$/);
    if (slashMatch) return slashMatch[2];

    // 匹配 /* 前缀
    const blockStartMatch = line.match(/^(\s*)\/\*\s?(.*)$/);
    if (blockStartMatch) {
        let rest = blockStartMatch[2];
        if (rest.endsWith('*/')) rest = rest.slice(0, -2);
        return rest;
    }

    // 匹配 * 中间注释行
    const starMatch = line.match(/^(\s*)\*\s?(.*)$/);
    if (starMatch) {
        let rest = starMatch[2];
        if (rest.endsWith('*/')) rest = rest.slice(0, -2);
        return rest;
    }

    return line;
}

/**
 * 使用 JSON5 宽容解析 WaveDrom 源码
 * @param {string} text
 * @returns {{ ok: boolean, data?: object, error?: string }}
 */
function parseWaveDromSource(text) {
    if (!text || typeof text !== 'string') {
        return { ok: false, error: 'Empty WaveDrom source' };
    }
    try {
        const doc = JSON5.parse(text);
        if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
            return { ok: false, error: 'WaveDrom root must be a JSON object' };
        }
        if (!Array.isArray(doc.signal) && !doc.reg && !doc.assign) {
            return { ok: false, error: 'WaveDrom must contain a "signal" array, "reg", or "assign"' };
        }
        return { ok: true, data: doc };
    } catch (err) {
        return { ok: false, error: err.message };
    }
}

/**
 * 获取文档行数组（兼容 VS Code TextDocument 与纯字符串数组）
 * @param {object|string[]} document
 * @returns {string[]}
 */
function getDocumentLines(document) {
    if (Array.isArray(document)) return document;
    if (document && typeof document.lineCount === 'number' && typeof document.lineAt === 'function') {
        const lines = [];
        for (let i = 0; i < document.lineCount; i++) {
            lines.push(document.lineAt(i).text);
        }
        return lines;
    }
    if (typeof document === 'string') {
        return document.split(/\r?\n/);
    }
    return [];
}

/**
 * 扫描文档中所有的 WaveDrom 代码块
 * @param {object|string[]} document
 * @returns {Array<{ startLine: number, endLine: number, rawContent: string, parsed: object|null, error: string|null }>}
 */
function findAllWaveDromBlocks(document) {
    const lines = getDocumentLines(document);
    const blocks = [];
    let inFence = false;
    let fenceStartLine = -1;
    let fenceLines = [];

    for (let i = 0; i < lines.length; i++) {
        const rawLine = lines[i];
        const stripped = stripCommentPrefix(rawLine).trim();

        // 判定进入 ```wavedrom 栅格
        if (!inFence) {
            if (/^```\s*wavedrom\b/i.test(stripped) || /^```\s*wavedown\b/i.test(stripped)) {
                inFence = true;
                fenceStartLine = i;
                fenceLines = [];
                continue;
            }

            // 单行隐式 JSON 识别: // { signal: [...] } 或 // { "signal": [...] }
            if (stripped.startsWith('{') && (stripped.includes('signal') || stripped.includes('reg') || stripped.includes('assign'))) {
                // 尝试收集可能的单行或紧凑多行 JSON
                let candidateLines = [stripped];
                let endIdx = i;
                let braceBalance = (stripped.match(/\{/g) || []).length - (stripped.match(/\}/g) || []).length;

                while (braceBalance > 0 && endIdx + 1 < lines.length) {
                    const nextStripped = stripCommentPrefix(lines[endIdx + 1]).trim();
                    if (!nextStripped) break;
                    candidateLines.push(nextStripped);
                    braceBalance += (nextStripped.match(/\{/g) || []).length - (nextStripped.match(/\}/g) || []).length;
                    endIdx++;
                }

                if (braceBalance === 0) {
                    const candidateText = candidateLines.join('\n');
                    const res = parseWaveDromSource(candidateText);
                    if (res.ok) {
                        blocks.push({
                            startLine: i,
                            endLine: endIdx,
                            rawContent: candidateText,
                            parsed: res.data,
                            error: null
                        });
                        i = endIdx;
                        continue;
                    }
                }
            }
        } else {
            // 判定退出 ``` 栅格
            if (/^```\s*$/i.test(stripped) || stripped.endsWith('```')) {
                inFence = false;
                const rawContent = fenceLines.join('\n');
                const parseRes = parseWaveDromSource(rawContent);
                blocks.push({
                    startLine: fenceStartLine,
                    endLine: i,
                    rawContent: rawContent,
                    parsed: parseRes.ok ? parseRes.data : null,
                    error: parseRes.ok ? null : parseRes.error
                });
                fenceLines = [];
                continue;
            }
            fenceLines.push(stripCommentPrefix(rawLine));
        }
    }

    return blocks;
}

/**
 * 定位指定行所在的 WaveDrom 块
 * @param {object|string[]} document
 * @param {number} lineIndex 0-indexed
 * @returns {object|null}
 */
function findWaveDromAtLine(document, lineIndex) {
    const blocks = findAllWaveDromBlocks(document);
    for (const block of blocks) {
        if (lineIndex >= block.startLine && lineIndex <= block.endLine) {
            return block;
        }
    }
    return null;
}

module.exports = {
    stripCommentPrefix,
    parseWaveDromSource,
    findAllWaveDromBlocks,
    findWaveDromAtLine
};
