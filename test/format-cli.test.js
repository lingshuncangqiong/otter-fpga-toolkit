'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {formatFile, parseArgs} = require('../format-cli.js');

test('CLI 参数要求显式选择 check 或 write', () => {
    assert.throws(() => parseArgs(['demo.sv']), /--check or --write/);
    assert.throws(() => parseArgs(['--check', '--write', 'demo.sv']), /mutually exclusive/);
    assert.throws(() => parseArgs(['--write', '--start-line', '3', '--end-line', '2', 'demo.sv']), /greater/);
});

test('check 不改文件，write 与 Ctrl+L 共用格式并保持 CRLF', t => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'otter-format-cli-'));
    t.after(() => fs.rmSync(tempDir, {recursive: true, force: true}));
    const filePath = path.join(tempDir, 'demo.sv');
    const original = '\uFEFF' + [
        'module demo;',
        'wire a;// first',
        'wire [7:0] longer_name;// second',
        'endmodule'
    ].join('\r\n');
    fs.writeFileSync(filePath, original, 'utf8');

    const check = formatFile(filePath, {mode: 'check', tabSize: 4, startLine: null, endLine: null});
    assert.equal(check.changed, true);
    assert.equal(fs.readFileSync(filePath, 'utf8'), original);

    const write = formatFile(filePath, {mode: 'write', tabSize: 4, startLine: null, endLine: null});
    assert.equal(write.changed, true);
    const formatted = fs.readFileSync(filePath, 'utf8');
    assert.match(formatted, /wire\s+a\s+;\/\/ first/);
    assert.match(formatted, /wire\s+\[7\s+:0\]\s+longer_name\s+;\/\/ second/);
    assert.equal(formatted.startsWith('\uFEFF'), true);
    assert.equal((formatted.match(/\r\n/g) || []).length, 3);
    assert.equal(/(^|[^\r])\n/.test(formatted), false);

    const clean = formatFile(filePath, {mode: 'check', tabSize: 4, startLine: null, endLine: null});
    assert.equal(clean.changed, false);
});

test('行范围只改指定行，但列位置仍按完整文件计算', t => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'otter-format-range-'));
    t.after(() => fs.rmSync(tempDir, {recursive: true, force: true}));
    const filePath = path.join(tempDir, 'range.v');
    const original = 'wire a;// first\nwire [31:0] much_longer_name;// second\n';
    fs.writeFileSync(filePath, original, 'utf8');

    const result = formatFile(filePath, {mode: 'write', tabSize: 4, startLine: 1, endLine: 1});
    assert.deepEqual(result.changedLines, [1]);
    const lines = fs.readFileSync(filePath, 'utf8').split('\n');
    assert.notEqual(lines[0], 'wire a;// first');
    assert.equal(lines[1], 'wire [31:0] much_longer_name;// second');
});
