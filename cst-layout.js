'use strict';

// 模块体声明：从 Verible CST 提取字段，按语法作用域计算布局。
const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const profile = require('./layout-profile.json');
const parser = path.join(__dirname, './vendor/verible/verible-verilog-syntax.exe');

function parse(file) {
    const source = Buffer.isBuffer(file) ? file : fs.readFileSync(file);
    const process = spawnSync(parser, ['--export_json', '--printtree', '--printtokens', Buffer.isBuffer(file) ? '-' : file], {
        input: Buffer.isBuffer(file) ? file : undefined, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 20000, windowsHide: true
    });
    if (process.error || process.status !== 0) {
        throw new Error(`Verible 解析失败，输入未写入：${process.error?.message || process.stderr || process.stdout.slice(0, 800)}`);
    }
    const tree = Object.values(JSON.parse(process.stdout))[0];
    if (!tree?.tree || !tree.tokens) throw new Error('缺少 CST/token 输出');
    return {source, tree: tree.tree, tokens: tree.tokens};
}

function leaves(node) {
    if (!node) return [];
    if (Number.isInteger(node.start) && Number.isInteger(node.end)) return [node];
    return (node.children || []).flatMap(leaves);
}

function span(node) {
    const tokens = leaves(node);
    return tokens.length ? {start: tokens[0].start, end: tokens.at(-1).end} : null;
}

function nodes(node, tag) {
    if (!node) return [];
    return [...(node.tag === tag ? [node] : []), ...(node.children || []).flatMap(n => nodes(n, tag))];
}

function raw(source, node) {
    const range = span(node);
    return range ? source.subarray(range.start, range.end).toString('utf8') : '';
}

function getRows(parsed) {
    const rows = [], skipped = [];
    const {source} = parsed;
    const supported = new Set(['parameter', 'localparam', 'reg', 'logic', 'bit', 'integer', 'int', 'wire', 'tri', 'genvar']);

    function visit(node, scope = null, excluded = false) {
        if (!node) return;
        const range = span(node);
        if (node.tag === 'kModuleDeclaration' || node.tag === 'kGenerateBlock') {
            scope = `${node.tag}:${range?.start}`;
        }
        // 这版不整理接口表、过程块、函数或任务；保持字节原文，不伪称完整 formatter。
        if (['kModuleHeader', 'kAlwaysStatement', 'kInitialStatement',
            'kFunctionDeclaration', 'kTaskDeclaration'].includes(node.tag)) excluded = true;
        if (!excluded && scope && ['kParamDeclaration', 'kDataDeclaration', 'kNetDeclaration', 'kGenvarDeclaration'].includes(node.tag)) {
            extract(node, scope);
            return;
        }
        for (const child of node.children || []) visit(child, scope, excluded);
    }

    function extract(node, scope) {
        const tokens = leaves(node), range = span(node);
        const skip = reason => skipped.push({start: range?.start, tag: node.tag, reason});
        if (!range || !supported.has(tokens[0].tag)) return skip('未覆盖的类型/属性声明');
        if (tokens.at(-1).tag !== ';') return skip('不是完整模块体声明');
        const lineStart = source.lastIndexOf(10, range.start - 1) + 1;
        let lineEnd = source.indexOf(10, range.end);
        if (lineEnd < 0) lineEnd = source.length;
        if (source[lineEnd - 1] === 13) lineEnd--;
        const indent = source.subarray(lineStart, range.start).toString('utf8');
        const statement = source.subarray(range.start, range.end).toString('utf8');
        const suffix = source.subarray(range.end, lineEnd).toString('utf8').trim();
        if (indent.trim() || /[\r\n]/.test(statement)) return skip('跨行或同行多语句，保留原文');
        if (suffix && !suffix.startsWith('//')) return skip('复杂行尾注释/后续代码，保留原文');
        if (statement.includes('/*')) return skip('声明内块注释，保留原文');

        if (node.tag === 'kGenvarDeclaration') {
            const identifiers = nodes(node, 'kIdentifierList')[0];
            if (!identifiers) return skip('未覆盖的 genvar 声明结构');
            // 名称列表整体保留，既支持 g_ch，也不拆开 g_x, g_y。
            // for(genvar ...) 是 kForInitialization，不会进入独立声明路径。
            rows.push({scope, family: node.tag, start: lineStart, end: lineEnd, indent,
                keyword: 'genvar', qualifiers: '', packed: '', left: null, right: null,
                name: raw(source, identifiers), unpacked: '', value: null, comment: suffix});
            return;
        }

        let type, variable, name;
        if (node.tag === 'kParamDeclaration') {
            type = nodes(node, 'kParamType')[0];
            name = (type?.children || []).find(n => n?.tag === 'SymbolIdentifier');
            variable = node;
        } else if (node.tag === 'kDataDeclaration') {
            const variables = nodes(node, 'kRegisterVariable');
            if (variables.length !== 1) return skip('多变量声明，保留原文');
            variable = variables[0];
            name = (variable.children || []).find(n => n?.tag === 'SymbolIdentifier');
            type = nodes(node, 'kDataType')[0];
        } else {
            const variables = nodes(node, 'kNetVariable');
            if (variables.length !== 1) return skip('多网络声明，保留原文');
            variable = nodes(node, 'kNetVariableDeclarationAssign')[0];
            name = variables[0].children?.find(n => n?.tag === 'SymbolIdentifier');
            // wire 关键字和实际数据类型各有一个 kDataType；维度在后者中。
            type = nodes(node, 'kDataTypeImplicitIdDimensions')[0] || nodes(node, 'kDataType')[0];
        }
        if (!name || !type) return skip('未覆盖的 CST 声明结构');
        const packedNode = nodes(type, 'kPackedDimensions')[0];
        const packedSpan = span(packedNode);
        const qualifierEnd = packedSpan?.start ?? name.start;
        const qualifiers = source.subarray(tokens[0].end, qualifierEnd).toString('utf8').trim();
        const unpackedNode = node.tag === 'kParamDeclaration'
            ? nodes(type, 'kUnpackedDimensions')[0] : nodes(variable, 'kUnpackedDimensions')[0];
        const assignment = nodes(variable, 'kTrailingAssign')[0];
        const expression = assignment?.children?.[1];
        let packed = raw(source, packedNode), left = null, right = null;
        const dimension = nodes(packedNode, 'kDimensionRange')[0];
        const dimensionSpan = span(dimension);
        if (profile.alignPackedRangeColon && packedSpan && dimensionSpan &&
            dimensionSpan.start === packedSpan.start && dimensionSpan.end === packedSpan.end &&
            dimension.children?.[2]?.tag === ':') {
            // 冒号是 CST 范围节点的子项，不会误认三目、package:: 或嵌套索引。
            left = raw(source, dimension.children[1]);
            right = raw(source, dimension.children[3]);
            packed = `[${left}:${right}]`;
        }
        rows.push({scope, family: node.tag, start: lineStart, end: lineEnd, indent,
            keyword: tokens[0].tag, qualifiers, packed, left, right,
            name: raw(source, name), unpacked: raw(source, unpackedNode),
            value: expression ? raw(source, expression) : null, comment: suffix});
    }
    visit(parsed.tree);
    return {rows, skipped};
}

function layout(parsed, options={}) {
    const {rows, skipped} = getRows(parsed);
    const groups = new Map();
    for (const row of rows) {
        const key = row.scope;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(row);
    }
    const edits = [];
    for (const group of groups.values()) {
        const scopeIndent = group[0].indent.replace(/\t/g,' '.repeat(options.tabSize || 4));
        const max = field => Math.max(0, ...group.map(row => field(row)));
        const keywordWidth = max(r => r.keyword.length);
        const qualifierWidth = max(r => r.qualifiers.length);
        const rangeLeftWidth = max(r => r.left?.length || 0);
        const packed = r => r.left === null ? r.packed : `[${r.left.padEnd(rangeLeftWidth)}:${r.right}]`;
        const packedWidth = max(r => packed(r).length);
        const fullName = r => r.name + (r.unpacked ? ` ${r.unpacked}` : '');
        const nameWidth = max(r => fullName(r).length);
        const tails = new Map();
        for (const row of group) {
            if (row.value !== null && row.value.length <= profile.initializerAlignmentLimit) {
                tails.set(row.family, Math.max(tails.get(row.family) || 0, row.value.length));
            }
        }
        for (const row of group) {
            const gap = ' '.repeat(profile.fieldGap);
            let line = scopeIndent + row.keyword.padEnd(keywordWidth) + gap;
            if (qualifierWidth) line += row.qualifiers.padEnd(qualifierWidth) + gap;
            if (packedWidth) line += packed(row).padEnd(packedWidth) + gap;
            line += fullName(row).padEnd(nameWidth);
            const valueWidth = tails.get(row.family) || 0;
            if (row.value !== null) {
                line += gap + '=' + ' '.repeat(profile.initializerGap);
                line += row.value.padEnd(valueWidth);
            } else if (tails.has(row.family)) {
                line += ' '.repeat(profile.fieldGap + 1 + profile.initializerGap + valueWidth);
            }
            line += ' ;' + (row.comment ? row.comment : '');
            edits.push({start: row.start, end: row.end, text: line});
        }
    }
    let output = parsed.source;
    for (const edit of edits.sort((a,b) => b.start-a.start)) {
        output = Buffer.concat([output.subarray(0,edit.start), Buffer.from(edit.text), output.subarray(edit.end)]);
    }
    return {output, rows, skipped, edits};
}

function tokenSignature(parsed) {
    return parsed.tokens.map(t => [t.tag, parsed.source.subarray(t.start,t.end).toString('utf8')]);
}

module.exports = {parse, layout, tokenSignature, getRows};
