'use strict';

const INSTANCE_KEYWORDS = new Set([
    'always', 'always_comb', 'always_ff', 'always_latch', 'assign', 'begin', 'case',
    'class', 'covergroup', 'else', 'end', 'for', 'foreach', 'function', 'generate',
    'if', 'initial', 'interface', 'module', 'package', 'primitive', 'property',
    'repeat', 'sequence', 'specify', 'task', 'typedef', 'while'
]);

function isIdentifierStart(ch) {
    return !!ch && /[A-Za-z_]/.test(ch);
}

function isIdentifierPart(ch) {
    return !!ch && /[A-Za-z0-9_$]/.test(ch);
}

function skipWhitespace(text, offset, limit = text.length) {
    let cursor = offset;
    while (cursor < limit && /\s/.test(text[cursor])) cursor++;
    return cursor;
}

function readIdentifier(text, offset, limit = text.length) {
    if (offset >= limit || !isIdentifierStart(text[offset])) return null;
    let end = offset + 1;
    while (end < limit && isIdentifierPart(text[end])) end++;
    return {name: text.slice(offset, end), start: offset, end};
}

// 注释和字符串替换为空格，但保留长度及换行，便于把解析 offset 映射回原文。
function maskNonCode(text) {
    const chars = text.split('');
    let state = 'code';
    for (let i = 0; i < chars.length; i++) {
        const ch = chars[i];
        const next = chars[i + 1];
        if (state === 'lineComment') {
            if (ch === '\n') state = 'code';
            else if (ch !== '\r') chars[i] = ' ';
            continue;
        }
        if (state === 'blockComment') {
            if (ch === '*' && next === '/') {
                chars[i] = ' ';
                chars[i + 1] = ' ';
                i++;
                state = 'code';
            } else if (ch !== '\r' && ch !== '\n') {
                chars[i] = ' ';
            }
            continue;
        }
        if (state === 'string') {
            if (ch === '\\' && i + 1 < chars.length) {
                chars[i] = ' ';
                if (chars[i + 1] !== '\r' && chars[i + 1] !== '\n') chars[i + 1] = ' ';
                i++;
            } else if (ch === '"') {
                chars[i] = ' ';
                state = 'code';
            } else if (ch !== '\r' && ch !== '\n') {
                chars[i] = ' ';
            }
            continue;
        }
        if (ch === '/' && next === '/') {
            chars[i] = ' ';
            chars[i + 1] = ' ';
            i++;
            state = 'lineComment';
        } else if (ch === '/' && next === '*') {
            chars[i] = ' ';
            chars[i + 1] = ' ';
            i++;
            state = 'blockComment';
        } else if (ch === '"') {
            chars[i] = ' ';
            state = 'string';
        }
    }
    return chars.join('');
}

function findMatching(text, openOffset, openChar = '(', closeChar = ')', limit = text.length) {
    if (text[openOffset] !== openChar) return -1;
    let depth = 0;
    for (let i = openOffset; i < limit; i++) {
        if (text[i] === openChar) depth++;
        else if (text[i] === closeChar) {
            depth--;
            if (depth === 0) return i;
        }
    }
    return -1;
}

function findStatementEnd(text, start, limit = text.length) {
    let paren = 0;
    let bracket = 0;
    let brace = 0;
    for (let i = start; i < limit; i++) {
        const ch = text[i];
        if (ch === '(') paren++;
        else if (ch === ')') paren = Math.max(0, paren - 1);
        else if (ch === '[') bracket++;
        else if (ch === ']') bracket = Math.max(0, bracket - 1);
        else if (ch === '{') brace++;
        else if (ch === '}') brace = Math.max(0, brace - 1);
        else if (ch === ';' && paren === 0 && bracket === 0 && brace === 0) return i;
    }
    return -1;
}

function splitTopLevelRanges(text, start, end) {
    const ranges = [];
    let segmentStart = start;
    let paren = 0;
    let bracket = 0;
    let brace = 0;
    for (let i = start; i < end; i++) {
        const ch = text[i];
        if (ch === '(') paren++;
        else if (ch === ')') paren--;
        else if (ch === '[') bracket++;
        else if (ch === ']') bracket--;
        else if (ch === '{') brace++;
        else if (ch === '}') brace--;
        else if (ch === ',' && paren === 0 && bracket === 0 && brace === 0) {
            ranges.push({start: segmentStart, end: i});
            segmentStart = i + 1;
        }
    }
    ranges.push({start: segmentStart, end});
    return ranges;
}

function findTopLevelEquals(text, start, end) {
    let paren = 0;
    let bracket = 0;
    let brace = 0;
    for (let i = start; i < end; i++) {
        const ch = text[i];
        if (ch === '(') paren++;
        else if (ch === ')') paren--;
        else if (ch === '[') bracket++;
        else if (ch === ']') bracket--;
        else if (ch === '{') brace++;
        else if (ch === '}') brace--;
        else if (ch === '=' && paren === 0 && bracket === 0 && brace === 0) return i;
    }
    return -1;
}

function trimTrailingDimensions(text, start, end) {
    let cursor = end;
    while (cursor > start && /\s/.test(text[cursor - 1])) cursor--;
    while (cursor > start && text[cursor - 1] === ']') {
        let depth = 1;
        let open = cursor - 2;
        while (open >= start) {
            if (text[open] === ']') depth++;
            else if (text[open] === '[' && --depth === 0) break;
            open--;
        }
        if (open < start) break;
        cursor = open;
        while (cursor > start && /\s/.test(text[cursor - 1])) cursor--;
    }
    return cursor;
}

function lastIdentifier(text, start, end) {
    const equals = findTopLevelEquals(text, start, end);
    let limit = equals >= 0 ? equals : end;
    limit = trimTrailingDimensions(text, start, limit);
    const re = /[A-Za-z_][A-Za-z0-9_$]*/g;
    re.lastIndex = start;
    let match;
    let last = null;
    while ((match = re.exec(text)) && match.index < limit) {
        if (match.index + match[0].length <= limit) {
            last = {name: match[0], start: match.index, end: match.index + match[0].length};
        }
    }
    return last;
}

function parsePortDirections(masked, nameEnd, headerEnd) {
    let cursor = skipWhitespace(masked, nameEnd, headerEnd);
    if (masked[cursor] === '#') {
        cursor = skipWhitespace(masked, cursor + 1, headerEnd);
        if (masked[cursor] !== '(') return [];
        const parameterClose = findMatching(masked, cursor, '(', ')', headerEnd + 1);
        if (parameterClose < 0) return [];
        cursor = skipWhitespace(masked, parameterClose + 1, headerEnd);
    }
    if (masked[cursor] !== '(') return [];
    const portClose = findMatching(masked, cursor, '(', ')', headerEnd + 1);
    if (portClose < 0) return [];

    const ports = [];
    let currentDirection = null;
    for (const range of splitTopLevelRanges(masked, cursor + 1, portClose)) {
        const segment = masked.slice(range.start, range.end);
        const directionMatch = /\b(input|output|inout)\b/.exec(segment);
        if (directionMatch) currentDirection = directionMatch[1];
        if (!currentDirection) continue;
        const name = lastIdentifier(masked, range.start, range.end);
        if (!name || name.name === currentDirection) continue;
        ports.push({name: name.name, direction: currentDirection, nameOffset: name.start});
    }
    return ports;
}

function parseBodyPortDirections(masked, start, end) {
    const stopPattern = /\b(function|task|always|initial|generate)\b/g;
    stopPattern.lastIndex = start;
    const stopMatch = stopPattern.exec(masked);
    const limit = stopMatch && stopMatch.index < end ? stopMatch.index : end;
    const ports = [];
    const declarationPattern = /\b(input|output|inout)\b/g;
    declarationPattern.lastIndex = start;
    let match;
    while ((match = declarationPattern.exec(masked)) && match.index < limit) {
        const statementEnd = findStatementEnd(masked, match.index + match[0].length, limit);
        if (statementEnd < 0) break;
        for (const range of splitTopLevelRanges(masked, match.index + match[0].length, statementEnd)) {
            const name = lastIdentifier(masked, range.start, range.end);
            if (name) ports.push({name: name.name, direction: match[1], nameOffset: name.start});
        }
        declarationPattern.lastIndex = statementEnd + 1;
    }
    return ports;
}

function parseNamedConnections(masked, openOffset, closeOffset) {
    const connections = [];
    let cursor = openOffset + 1;
    while (cursor < closeOffset) {
        cursor = skipWhitespace(masked, cursor, closeOffset);
        if (masked[cursor] !== '.') {
            cursor++;
            continue;
        }
        const dotOffset = cursor;
        const port = readIdentifier(masked, cursor + 1, closeOffset);
        if (!port) {
            cursor++;
            continue;
        }
        cursor = skipWhitespace(masked, port.end, closeOffset);
        if (masked[cursor] !== '(') {
            cursor = port.end;
            continue;
        }
        const expressionClose = findMatching(masked, cursor, '(', ')', closeOffset + 1);
        if (expressionClose < 0) break;
        connections.push({
            portName: port.name,
            dotOffset,
            portNameOffset: port.start,
            expressionStart: cursor + 1,
            expressionEnd: expressionClose
        });
        cursor = expressionClose + 1;
    }
    return connections;
}

function parseInstances(masked, start, end) {
    const instances = [];
    const identifiers = /[A-Za-z_][A-Za-z0-9_$]*/g;
    identifiers.lastIndex = start;
    let match;
    while ((match = identifiers.exec(masked)) && match.index < end) {
        const typeName = match[0];
        const typeOffset = match.index;
        const previous = masked[typeOffset - 1];
        if (INSTANCE_KEYWORDS.has(typeName) || previous === '.' || previous === '$' || previous === '`') continue;

        let cursor = skipWhitespace(masked, typeOffset + typeName.length, end);
        if (masked[cursor] === '#') {
            cursor = skipWhitespace(masked, cursor + 1, end);
            if (masked[cursor] !== '(') continue;
            const parameterClose = findMatching(masked, cursor, '(', ')', end);
            if (parameterClose < 0) continue;
            cursor = skipWhitespace(masked, parameterClose + 1, end);
        }

        const instanceName = readIdentifier(masked, cursor, end);
        if (!instanceName) continue;
        cursor = skipWhitespace(masked, instanceName.end, end);
        while (masked[cursor] === '[') {
            const dimensionClose = findMatching(masked, cursor, '[', ']', end);
            if (dimensionClose < 0) break;
            cursor = skipWhitespace(masked, dimensionClose + 1, end);
        }
        if (masked[cursor] !== '(') continue;
        const connectionClose = findMatching(masked, cursor, '(', ')', end);
        if (connectionClose < 0) continue;

        instances.push({
            typeName,
            typeOffset,
            instanceName: instanceName.name,
            instanceNameOffset: instanceName.start,
            connectionOpen: cursor,
            connectionClose,
            connections: parseNamedConnections(masked, cursor, connectionClose)
        });
        identifiers.lastIndex = connectionClose + 1;
    }
    return instances;
}

function parseRtlDocument(text) {
    const masked = maskNonCode(text);
    const modules = [];
    const modulePattern = /\bmodule\s+(?:(?:automatic|static)\s+)?([A-Za-z_][A-Za-z0-9_$]*)/g;
    let match;
    while ((match = modulePattern.exec(masked))) {
        const name = match[1];
        const nameOffset = match.index + match[0].lastIndexOf(name);
        const headerEnd = findStatementEnd(masked, nameOffset + name.length);
        if (headerEnd < 0) break;
        const endPattern = /\bendmodule\b/g;
        endPattern.lastIndex = headerEnd + 1;
        const endMatch = endPattern.exec(masked);
        const endOffset = endMatch ? endMatch.index + endMatch[0].length : masked.length;
        const bodyEnd = endMatch ? endMatch.index : masked.length;
        const instances = parseInstances(masked, headerEnd + 1, bodyEnd);
        let ports = parsePortDirections(masked, nameOffset + name.length, headerEnd);
        if (!ports.length) ports = parseBodyPortDirections(masked, headerEnd + 1, bodyEnd);
        modules.push({
            name,
            nameOffset,
            headerEnd,
            endOffset,
            ports,
            instances
        });
        modulePattern.lastIndex = endOffset;
    }
    return {modules};
}

function findModuleReferenceAtOffset(structure, offset) {
    for (const moduleInfo of structure.modules) {
        for (const instance of moduleInfo.instances) {
            const inType = offset >= instance.typeOffset && offset <= instance.typeOffset + instance.typeName.length;
            const inInstance = offset >= instance.instanceNameOffset && offset <= instance.instanceNameOffset + instance.instanceName.length;
            if (inType || inInstance) return instance;
        }
    }
    return null;
}

module.exports = {
    findMatching,
    findModuleReferenceAtOffset,
    maskNonCode,
    parseRtlDocument,
    splitTopLevelRanges
};
