'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {parse, layout, getRows, tokenSignature} = require('../cst-layout');
const {formatAsync} = require('../cst-editor');
const {loadFormatter, formatFile, main} = require('../format-cli');
const fixture = path.join(__dirname, 'fixtures/formatter/declarations.sv');
const expected = fs.readFileSync(path.join(__dirname, 'fixtures/formatter/declarations.expected.sv'), 'utf8');
const formatter = loadFormatter();
const fmt = text => {
    const lines = text.split(/\r?\n/);
    return formatter.formatLineRange(lines, 4, 0, lines.length - 1);
};

test('CST 固定样本：跨声明类型、范围冒号、genvar、数组、中文和作用域', () => {
    const input = parse(fixture), result = layout(input);
    assert.equal(result.output.toString().replace(/\r\n/g, '\n'), expected.replace(/\r\n/g, '\n'));
    const checked = parse(result.output);
    assert.deepEqual(tokenSignature(checked), tokenSignature(input));
    assert.ok(layout(checked).output.equals(result.output));
    const lines = result.output.toString().split(/\r?\n/);
    const row = name => lines.find(l => l.includes(name));
    for (const name of ['P_ST_IDLE', 'r_st_current', 'w_data', 'g_outer', 'g_x']) {
        assert.equal(row(name).indexOf(name), row('P_DW ').indexOf('P_DW'));
    }
    assert.equal(row('w_data').indexOf('['), row('r_st_current').indexOf('['));
    assert.equal(row('w_data').indexOf(':0]'), row('r_st_current').indexOf(':0]'));
    assert.equal(row('g_inner').indexOf('g_inner'), row('r_local').indexOf('r_local'));
    assert.ok(row('r_small').length < 40);
    assert.ok(row('r_local').length < 70);
    for (const line of input.source.toString().split(/\r?\n/).filter(l => /for \(genvar|^\/\//.test(l))) {
        assert.ok(lines.includes(line));
    }
    assert.deepEqual(result.output.toString().match(/\r\n|\n/g), input.source.toString().match(/\r\n|\n/g));
});

test('带位宽的 wire 从数据类型节点取维度，与 reg 对齐并保留 unpacked 数组', () => {
    const text = "module m;\nreg signed [15:0] r_data;\nwire signed [7:0] w_data [0:2];\nwire w_valid;\nendmodule";
    const rows = getRows(parse(Buffer.from(text))).rows;
    assert.deepEqual(rows.map(r => [r.qualifiers, r.packed, r.unpacked]), [
        ['signed', '[15:0]', ''], ['signed', '[7:0]', '[0:2]'], ['', '', '']
    ]);
    const result = fmt(text);
    assert.equal(result.lines[1].indexOf('['), result.lines[2].indexOf('['));
    assert.deepEqual(fmt(result.lines.join('\n')).lines, result.lines);
});

test('超长初值只延伸本行，字符串和多维数组 token 保持不变', () => {
    const value = 'P_WIDTH + '.repeat(30) + '1';
    const short = 'module m;\nlocalparam integer P_A = 1;\nlocalparam integer P_B = 2;\n';
    const text = short + `localparam integer P_L = ${value};\n` +
        'localparam string P_TEXT = "keep  two // spaces";\n' +
        "reg [3:0][7:0] r_array [0:2] = '{default:'0};\nendmodule";
    const result = fmt(text);
    assert.equal(result.lines[1].indexOf(';'), result.lines[2].indexOf(';'));
    assert.equal(result.lines[1].indexOf('='), result.lines[3].indexOf('='));
    assert.ok(result.lines[1].length < 100);
    assert.ok(result.lines[3].includes(value + ' ;'));
    assert.ok(result.lines[4].includes('"keep  two // spaces"'));
    assert.deepEqual(tokenSignature(parse(Buffer.from(result.lines.join('\n')))), tokenSignature(parse(Buffer.from(text))));
});

test('多变量、跨行和块注释声明保留并报告，过程块不参与列宽', () => {
    const text = 'module m;\nwire w_a, w_b;\nlocalparam integer P_A =\n  1;\n' +
        'reg /* comment */ r_a;\nreg r_short;\n' +
        'always @* begin : p\n    reg [1023:0] r_very_long_local_signal;\nend\nendmodule';
    const lines = text.split('\n'), result = fmt(text);
    assert.equal(result.skipped.length, 3);
    for (const i of [1, 2, 3, 4, 6, 7, 8]) assert.equal(result.lines[i], lines[i]);
    assert.ok(result.lines[5].length < 30);
});

test('CLI、worker 共用引擎；范围只写选中行，保留 BOM 和混合换行', async t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'otter-cst-'));
    t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
    const file = path.join(dir, 'sample.sv');
    const text = fs.readFileSync(fixture, 'utf8').replace(/\r\n/g, '\n');
    const lines = text.split('\n');
    const full = fmt(text);
    assert.deepEqual((await formatAsync(lines, 4, 0, lines.length - 1)).lines, full.lines);
    const index = lines.findIndex(l => l.includes('genvar g_outer'));
    const selection = await formatAsync(lines, 4, index, index);
    assert.equal(selection.lines[index], full.lines[index]);
    assert.ok(selection.changes.every(e => e.line === index));
    const original = '\uFEFF' + lines.map((l, i) => l + (i < lines.length - 1 ? (i % 2 ? '\n' : '\r\n') : '')).join('');
    fs.writeFileSync(file, original);
    const options = {mode: 'check', tabSize: 4, startLine: null, endLine: null};
    assert.equal(formatFile(file, options).changed, true);
    assert.equal(fs.readFileSync(file, 'utf8'), original);
    const result = formatFile(file, {...options, mode: 'write'});
    assert.ok(result.skipped.length > 0);
    const actual = fs.readFileSync(file, 'utf8');
    assert.equal(actual.slice(1).split(/\r?\n/).join('\n'), full.lines.join('\n'));
    assert.equal(actual[0], '\uFEFF');
    assert.deepEqual(actual.match(/\r\n|\n/g), original.match(/\r\n|\n/g));
    assert.equal(formatFile(file, options).changed, false);
});

test('非法输入 CLI 返回 error 且不写入，worker 拒绝修改', async t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'otter-cst-invalid-'));
    t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
    const file = path.join(dir, 'broken.sv'), original = 'module broken(input ;\n';
    fs.writeFileSync(file, original);
    let output = '';
    const code = main(['--write', '--json', file], {stdout: {write(s) {output += s;}}, stderr: {write() {}}});
    assert.equal(code, 2);
    assert.equal(JSON.parse(output).status, 'error');
    assert.equal(fs.readFileSync(file, 'utf8'), original);
    await assert.rejects(formatAsync(original.split('\n'), 4, 0, 0), /解析失败/);
});
