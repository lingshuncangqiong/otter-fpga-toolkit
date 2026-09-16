'use strict';

const {parse, layout, tokenSignature} = require('./cst-layout');

function format(lines, tabSize, first, last, formatInterfaceLines) {
    const text = lines.join('\n');
    const parsed = parse(Buffer.from(text, 'utf8'));
    const result = layout(parsed, {tabSize});
    const begin = Math.max(0, Number.isFinite(first) ? Math.trunc(first) : 0);
    const end = Math.min(lines.length-1, Number.isFinite(last) ? Math.trunc(last) : lines.length-1);
    const formatted = lines.slice();
    const changed = new Map();
    for (const edit of result.edits) {
        const line = parsed.source.subarray(0,edit.start).toString('utf8').split('\n').length-1;
        if (line >= begin && line <= end && edit.text !== lines[line]) changed.set(line,edit.text);
    }

    // 模块头和例化复用既有版式；该路径不再计算模块体声明。
    for (const edit of formatInterfaceLines(lines,tabSize,begin,end).changes) changed.set(edit.line,edit.text);
    const changes=[...changed].sort((a,b)=>a[0]-b[0]).map(([line,text])=>({line,text}));
    for (const edit of changes) formatted[edit.line]=edit.text;
    if (changes.length) {
        const checked=parse(Buffer.from(formatted.join('\n'),'utf8'));
        if (JSON.stringify(tokenSignature(parsed))!==JSON.stringify(tokenSignature(checked))) {
            throw new Error('排版前后 token 不一致，已拒绝修改');
        }
    }
    return {lines:formatted,changes,skipped:result.skipped};
}

module.exports={format};
