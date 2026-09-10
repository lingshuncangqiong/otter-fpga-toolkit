'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Module = require('node:module');

const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
    if (request === 'vscode') return {};
    return originalLoad.call(this, request, parent, isMain);
};

let extension;
try {
    extension = require('../extension.js');
} finally {
    Module._load = originalLoad;
}

const {
    normalizeTabSize,
    selectionEndLine,
    resolveLintToolName,
    missingLintToolMessage,
    isOwnedLintTempDir,
    computeInstanceColumns,
    formatterInterface,
    expressionContinues,
    parseLine,
    doFmt,
    formatLineRange,
    parseModule,
    genInst
} = extension.__test;

test('tabSize 会回退、取整并限制在 1..16', () => {
    assert.equal(normalizeTabSize(undefined), 4);
    assert.equal(normalizeTabSize(Number.NaN), 4);
    assert.equal(normalizeTabSize(0), 1);
    assert.equal(normalizeTabSize(2.9), 2);
    assert.equal(normalizeTabSize(99), 16);
});

test('选区在下一行第 0 列结束时不误格式化下一行', () => {
    assert.equal(selectionEndLine({isEmpty: true, active: {line: 7}}), 7);
    assert.equal(selectionEndLine({isEmpty: false, start: {line: 2}, end: {line: 4, character: 0}}), 3);
    assert.equal(selectionEndLine({isEmpty: false, start: {line: 2}, end: {line: 4, character: 3}}), 4);
});

test('手动 lint 工具覆盖优先于用户默认设置', () => {
    assert.equal(resolveLintToolName('auto', 'xvlog'), 'xvlog');
    assert.equal(resolveLintToolName('modelsim'), 'modelsim');
    assert.equal(resolveLintToolName('unsupported'), 'auto');
    assert.match(missingLintToolMessage('xvlog'), /xvlogPath/);
});

test('自动 lint 按文件语言选择工具，显式设置不受影响', () => {
    assert.deepEqual(extension.__test.autoLintToolOrder('design.sv'), ['xvlog', 'iverilog']);
    assert.deepEqual(extension.__test.autoLintToolOrder('header.SVH'), ['xvlog', 'iverilog']);
    assert.deepEqual(extension.__test.autoLintToolOrder('design.v'), ['iverilog', 'xvlog']);
    assert.equal(resolveLintToolName('iverilog'), 'iverilog');
});

test('lint 清理边界只接受系统临时目录下的 Otter 自有目录', () => {
    assert.equal(isOwnedLintTempDir(path.join(os.tmpdir(), 'otter-iverilog-abc123')), true);
    assert.equal(isOwnedLintTempDir(path.join(os.tmpdir(), 'otter-xvlog-abc123')), true);
    assert.equal(isOwnedLintTempDir(path.join(os.tmpdir(), 'otter-modelsim-abc123')), true);
    assert.equal(isOwnedLintTempDir(path.join(os.tmpdir(), 'xsim.dir')), false);
    assert.equal(isOwnedLintTempDir('C:/rtl/source'), false);
});

test('ANSI module 参数和端口解析后仍能生成例化模板', () => {
    const source = `
module demo #(
    parameter integer WIDTH = 16,
    parameter DEPTH = $clog2(WIDTH)
)(
    input  logic             clk,
    output logic [WIDTH-1:0] data
);
`;
    const mod = parseModule(source);
    assert.ok(mod);
    assert.equal(mod.name, 'demo');
    assert.deepEqual(mod.params.map(item => item.name), ['WIDTH', 'DEPTH']);
    assert.deepEqual(mod.ports.map(item => item.name), ['clk', 'data']);

    const instance = genInst(mod, '    ');
    assert.match(instance, /demo #\(/);
    assert.match(instance, /\.WIDTH\s+\(WIDTH/);
    assert.match(instance, /\.data\s+\(data/);
    assert.match(instance, /\n\);\n$/);
});

test('例化端口格式化保留逗号和注释', () => {
    const original = '    .data(payload),// payload';
    const entry = parseLine(original, 4);
    assert.equal(entry.tag, 'inst_port');
    const formatted = doFmt(entry, {ipCol: 16, cpCol: 28}, original);
    assert.match(formatted, /^\s+\.data\s+\(payload\s+\),\/\/ payload$/);
});

test('例化参数按实际缩进对齐且末行没有尾随空格', () => {
    const lines = [
        '    .P_DEST_SYNC_FF     (2                              ),',
        '    .P_RST_ACTIVE_HIGH  (1                              ),',
        '    .P_ASYNC_ASSERT     (1                              ) ',
        '    .i_src_rst          (i_video_rst                     ),',
        '    .i_dest_clk         (i_memory_clk                    ),',
        '    .o_dest_rst         (w_video_rst_memory_cdc          ) '
    ];
    const entries = lines.map(line => parseLine(line, 2));
    const columns = computeInstanceColumns(entries, 2);
    const formatted = entries.map((entry, index) => (
        doFmt(entry, columns.get(entry.ind.length), lines[index])
    ));
    assert.equal(new Set(formatted.map(line => line.indexOf('('))).size, 1);
    assert.equal(new Set(formatted.map(line => line.lastIndexOf(')'))).size, 1);
    assert.ok(formatted.every(line => !/\s+$/.test(line)));
    assert.equal(formatted[1].indexOf('('), 24);
});

test('多行声明续行对齐到首行 value 列并保留相对缩进', () => {
    const lines = [
        'localparam integer P_SHORT = 1;',
        'localparam integer P_ALIGNED_PROFILE = ((P_OPERATION_DW % P_MEMORY_GROUP_DW) == 0) &&',
        '                                                ((P_ALIGNED_RATIO == 1) || (P_ALIGNED_RATIO == 2) ||',
        '                                                 (P_ALIGNED_RATIO == 4) || (P_ALIGNED_RATIO == 8));'
    ];
    const result = formatLineRange(lines, 4, 0, lines.length - 1);
    const formatted = result.lines;
    const equals = formatted[1].indexOf('=');
    const valueColumn = formatted[1].indexOf('((', equals);
    const firstContinuation = formatted[2].search(/\S/);
    const secondContinuation = formatted[3].search(/\S/);
    assert.equal(firstContinuation, valueColumn);
    assert.equal(secondContinuation, valueColumn + 1);
    assert.ok(!/\s+$/.test(formatted[1]));
    assert.match(formatted[3], /;$/);
});

test('无逗号的完整末参数不误判为续行，注释与同组声明对齐', () => {
    const lines = [
        '    parameter integer P_WIDTH = 16,// width',
        "    parameter [P_PPC*P_DW-1:0] P_FILL_DATA = {P_PPC*P_DW{1'b0}}// fill"
    ];
    const result = formatLineRange(lines, 4, 0, lines.length - 1);
    const formatted = result.lines;
    assert.equal(parseLine(lines[1], 4).continues, false);
    assert.equal(formatted[0].indexOf('//'), formatted[1].indexOf('//'));
    assert.match(formatted[1], /\}\s{2,}\/\/ fill$/);
});

test('续行判断覆盖未闭合括号、逻辑运算符和三目冒号', () => {
    assert.equal(expressionContinues('((P_A == 1) ||'), true);
    assert.equal(expressionContinues('(P_A <= 1) ? 1 :'), true);
    assert.equal(expressionContinues("{P_PPC*P_DW{1'b0}}"), false);
    assert.equal(expressionContinues('"string with ( delimiter"'), false);
});

test('首行只有等号的多行 localparam 对齐等号与续行 value 列', () => {
    const lines = [
        'localparam integer P_APP_ADDR_UNITS = (P_APP_DW < 64) ? 1 : (P_APP_DW / 64);',
        'localparam integer P_WIDTH_RATIO =',
        '    (P_OPERATION_DW >= P_APP_DW) ?',
        '    (P_OPERATION_DW / P_APP_DW) :',
        '    (P_APP_DW / P_OPERATION_DW);',
        'localparam integer P_WIDTH_RATIO_SHIFT = $clog2(P_WIDTH_RATIO);'
    ];
    const parsed = parseLine(lines[1], 4);
    assert.equal(parsed.hasEq, true);
    assert.equal(parsed.eq, '');
    assert.equal(parsed.continues, true);

    const formatted = formatLineRange(lines, 4, 0, lines.length - 1).lines;
    const equalsColumn = formatted[0].indexOf('=');
    const valueColumn = formatted[0].indexOf('(', equalsColumn);
    assert.equal(formatted[1].indexOf('='), equalsColumn);
    assert.ok(!/\s+$/.test(formatted[1]));
    assert.deepEqual(formatted.slice(2, 5).map(line => line.search(/\S/)), [valueColumn, valueColumn, valueColumn]);
});

test('SystemVerilog typed parameter 保留类型并与 integer 参数对齐', () => {
    const supportedTypes = ['string', 'byte', 'shortint', 'longint', 'shortreal', 'chandle', 'type'];
    for(const type of supportedTypes){
        const parsed = parseLine(`parameter ${type} P_VALUE = DEFAULT;`, 4);
        assert.equal(parsed.type, `parameter ${type}`);
        assert.equal(parsed.name, 'P_VALUE');
        assert.equal(parsed.eq, 'DEFAULT');
    }

    const lines = [
        '    parameter integer P_FRAME_BUFFER_NUM = 4,// count',
        '    parameter string P_PAYLOAD_FIFO_MODE = "STD"// mode'
    ];
    const formatted = formatLineRange(lines, 4, 0, lines.length - 1).lines;
    const mode = parseLine(formatted[1], 4);
    assert.equal(mode.type, 'parameter string');
    assert.equal(mode.name, 'P_PAYLOAD_FIFO_MODE');
    assert.equal(formatted[0].indexOf('='), formatted[1].indexOf('='));
    assert.equal(formatted[0].indexOf('//'), formatted[1].indexOf('//'));
});

test('标量声明不为缺失的位宽和初值预留空列', () => {
    const source = ['wire a;', 'wire longer_name;'];
    const result = formatLineRange(source, 4, 0, 1).lines;
    assert.equal(result[0], 'wire    a           ;');
    assert.equal(result[1], 'wire    longer_name ;');
    assert.deepEqual(formatLineRange(result, 4, 0, 1).lines, result);

    const mixed = ['reg [7:0] r_data = 0;', 'reg r_valid = 0;'];
    const aligned = formatLineRange(mixed, 4, 0, 1).lines;
    assert.equal(aligned[0].indexOf('r_data'), aligned[1].indexOf('r_valid'));
    assert.equal(aligned[0].indexOf('='), aligned[1].indexOf('='));
    for(const pair of [
        ['input abc, // a', 'input def // b'],
        ['parameter P_A = 1234567, // a', 'parameter P_B = 1234567 // b']
    ]) {
        const tail = formatLineRange(pair, 4, 0, 1).lines;
        assert.equal(tail[0].indexOf('//'), tail[1].indexOf('//'));
        assert.deepEqual(formatLineRange(tail, 4, 0, 1).lines, tail);
    }
});

test('格式化保留字符串中的注释标记、空格、制表符与转义引号', () => {
    const value = '"https://host/a  b\\\"c\tend"';
    const source = [
        `parameter string P_PATH = ${value}; // 地址`,
        '',
        `    .P_TEXT(${value}), // 文本`,
        '    .P_OTHER("/* content */")'
    ];
    const result = formatLineRange(source, 4, 0, source.length - 1).lines;
    assert.equal(parseLine(result[0], 4).eq, value);
    assert.equal(parseLine(result[2], 4).conn, value);
    assert.equal(parseLine(result[3], 4).conn, '"/* content */"');
    assert.ok(result[0].endsWith('// 地址'));
    assert.ok(result[2].endsWith('// 文本'));
    assert.deepEqual(formatLineRange(result, 4, 0, result.length - 1).lines, result);
    const withBlockComment = ['wire a /* 保留内联注释 */;'];
    assert.deepEqual(formatLineRange(withBlockComment, 4, 0, 0).lines, withBlockComment);
    const escaped = ['    .DATA(\\signal//name ), // 标识符'];
    const escapedResult = formatLineRange(escaped, 4, 0, 0).lines;
    assert.equal(parseLine(escapedResult[0], 4).conn, '\\signal//name');
    assert.ok(escapedResult[0].endsWith('// 标识符'));
});

test('数组声明区分 packed/unpacked 维度与初值，支持多维及维度中的索引', () => {
    const source = [
        "reg [P_PPC*24-1:0] r_rgb_dly_array [0:20] = '{default:'0}; // delay",
        "reg [P_PPC*24-1:0] r_other [0:20] = '{default:'0}; // other",
        "logic unsigned [1:0][P_WIDTHS[0]-1:0] r_matrix [0:2][0:3] = '{default:'0};",
        'logic [7:0] r_dynamic [];',
        'logic [7:0] r_queue [$];'
    ];
    const parsed = parseLine(source[2], 4);
    assert.equal(parsed.width, '[1:0][P_WIDTHS[0]-1:0]');
    assert.equal(parsed.unpacked, '[0:2][0:3]');
    assert.equal(parsed.eq, "'{default:'0}");
    const fmt = lines => formatLineRange(lines, 4, 0, lines.length - 1).lines;
    const formatted = fmt(source);
    assert.equal(formatted[0].indexOf('='), formatted[1].indexOf('='));
    assert.match(formatted[0], /r_rgb_dly_array \[0:20\]\s+=/);
    assert.deepEqual(fmt(formatted), formatted);
    assert.equal(formatted.join('').replace(/\s/g, ''), source.join('').replace(/\s/g, ''));
    assert.equal(formatLineRange(source, 4, 1, 1).lines[1], formatted[1]);
});

test('长维度、名称和初值不会无上限撑宽同组短声明', () => {
    const source = [
        'reg r_valid = 0; // valid',
        `reg [P_${'WIDTH_'.repeat(20)}-1:0] r_${'data_'.repeat(20)} [0:20] = {${'P_DATA, '.repeat(30)}P_DATA}; // wide`
    ];
    const fmt = lines => formatLineRange(lines, 4, 0, lines.length - 1).lines;
    const formatted = fmt(source);
    assert.ok(formatted[0].indexOf('//') < 140);
    assert.deepEqual(fmt(formatted), formatted);
    assert.equal(formatted.join('').replace(/\s/g, ''), source.join('').replace(/\s/g, ''));
});

test('长参数不撑宽端口和寄存器，完整模块格式化保持幂等', () => {
    const source = [
        'module demo #(',
        '    parameter integer P_WORD_DW = 32,',
        '    localparam integer P_LONG = (P_WORD_DW > 8) ? P_WORD_DW * P_WORD_DW + P_WORD_DW : P_WORD_DW',
        ')(',
        '    input i_clk,',
        '    input [P_WORD_DW-1:0] i_data,',
        '    output o_valid',
        ');',
        'reg [7:0] r_data = 0;',
        'reg r_valid = 0;',
        'assign o_valid = r_valid;',
        'endmodule'
    ];
    const fmt = lines => formatLineRange(lines, 4, 0, lines.length - 1).lines;
    const result = fmt(source);
    const shortParameter = source.map(line => line.includes('localparam') ? '    localparam integer P_LONG = 1' : line);
    assert.deepEqual(result.slice(4), fmt(shortParameter).slice(4));
    assert.equal(result[4].indexOf('i_clk'), result[5].indexOf('i_data'));
    assert.equal(result[8].indexOf('='), result[9].indexOf('='));
    assert.ok(result[4].length < 60);
    assert.ok(result.every(line => !/\s+$/.test(line)));
    assert.deepEqual(fmt(result), result);
    assert.equal(result.join('').replace(/\s/g, ''), source.join('').replace(/\s/g, ''));
});

test('空行、分区与缩进隔离声明组，普通注释不破坏组内对齐', () => {
    const source = [
        'reg short_name;',
        '// 同组状态说明',
        'reg [7:0] medium_name;',
        '',
        'reg an_extremely_long_name_in_another_group;',
        '/***************wire******************/',
        'wire w_a;',
        '    reg deeply_nested_and_very_long_name;',
        'wire w_b;'
    ];
    const result = formatLineRange(source, 4, 0, source.length - 1).lines;
    assert.equal(result[0].indexOf('short_name'), result[2].indexOf('medium_name'));
    assert.equal(result[6].indexOf('w_a'), result[8].indexOf('w_b'));
    assert.ok(result[6].length < 30);
    for(const index of [1, 3, 5]) assert.equal(result[index], source[index]);
    assert.deepEqual(formatLineRange(result, 4, 0, result.length - 1).lines, result);
});

test('多模块和同缩进的不同实例分别对齐，不改注释内的伪声明', () => {
    const source = [
        'module a;',
        'wire x;',
        'child first (',
        '    .short(x),',
        '    .other(x)',
        ');',
        'child second (',
        '    .a_much_longer_port_name(a_very_long_connection)',
        ');',
        'endmodule',
        'module b;',
        'wire a_long_name_in_a_different_module;',
        '/*',
        'wire DO_NOT_FORMAT_THIS_COMMENT;',
        '*/',
        'endmodule'
    ];
    const result = formatLineRange(source, 4, 0, source.length - 1).lines;
    assert.equal(result[1], formatLineRange(['wire x;'], 4, 0, 0).lines[0]);
    assert.ok(result[3].indexOf('(') < result[7].indexOf('('));
    assert.equal(result[3].indexOf('('), result[4].indexOf('('));
    assert.equal(result[13], source[13]);
    assert.deepEqual(formatLineRange(result, 4, 0, result.length - 1).lines, result);
});

test('范围格式化复用所属组与多行声明的列宽，结果与整文件对应行一致', () => {
    const source = [
        'localparam integer P_WIDTH = 32;',
        'localparam integer P_MULTI =',
        '    (P_WIDTH > 16) ?',
        '        P_WIDTH : 16;',
        'localparam integer P_OTHER = 1;',
        '',
        'reg r_valid = 0;'
    ];
    const full = formatLineRange(source, 4, 0, source.length - 1).lines;
    const selected = formatLineRange(source, 4, 2, 3).lines;
    assert.deepEqual(selected.slice(2, 4), full.slice(2, 4));
    assert.equal(full[2].search(/\S/), full[0].indexOf('32'));
    assert.equal(full[3].search(/\S/), full[2].search(/\S/) + 4);
    for(const index of [0, 1, 4, 5, 6]) assert.equal(selected[index], source[index]);
});

test('VS Code 智能体接口默认只检查，显式 write 才写入', t => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'otter-vscode-api-'));
    t.after(() => fs.rmSync(tempDir, {recursive: true, force: true}));
    const filePath = path.join(tempDir, 'agent.sv');
    fs.writeFileSync(filePath, 'wire a;// agent\n', 'utf8');

    const check = formatterInterface({file: filePath, tabSize: 4});
    assert.equal(check.status, 'formatting-required');
    assert.equal(check.exitCode, 1);
    assert.equal(check.wrote, false);
    assert.equal(fs.readFileSync(filePath, 'utf8'), 'wire a;// agent\n');

    const write = formatterInterface({mode: 'write', file: filePath, tabSize: 4});
    assert.equal(write.status, 'formatted');
    assert.equal(write.exitCode, 0);
    assert.equal(write.wrote, true);
    assert.notEqual(fs.readFileSync(filePath, 'utf8'), 'wire a;// agent\n');

    const invalid = formatterInterface({mode: 'write', file: filePath, tabSize: 4, startLine: 2, endLine: 1});
    assert.equal(invalid.status, 'error');
    assert.equal(invalid.exitCode, 2);
});

test('manifest 保留命令和快捷键，并贡献层次树及提示设置', () => {
    const root = path.resolve(__dirname, '..');
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    assert.match(manifest.version, /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/);
    assert.ok(manifest.activationEvents.includes('onCommand:otter-fpga-toolkit.formatFile'));
    assert.deepEqual(
        manifest.contributes.commands.map(item => item.command),
        [
            'verilog-instantiate.generateInstance',
            'verilog-instantiate.xvlogLint',
            'verilog-instantiate.alignCode',
            'verilog-instantiate.showHierarchy',
            'verilog-instantiate.refreshHierarchy'
        ]
    );
    assert.ok(manifest.contributes.commands.slice(0, 4).every(item => item.enablement));
    assert.equal(manifest.contributes.commands[3].icon, '$(type-hierarchy)');
    assert.equal(manifest.contributes.commands[4].icon, '$(refresh)');
    assert.deepEqual(
        manifest.contributes.keybindings.map(item => item.key),
        ['ctrl+shift+i', 'ctrl+1', 'ctrl+numpad1', 'ctrl+l']
    );
    assert.deepEqual(
        manifest.contributes.configuration.properties['verilogInstantiate.tabSize'],
        {
            type: 'integer',
            minimum: 1,
            maximum: 16,
            default: 4,
            description: '缩进空格数 (例化模板 / 排版共用)'
        }
    );
    assert.equal(
        manifest.contributes.configuration.properties['verilogInstantiate.enablePortDirectionHints'].default,
        true
    );
    assert.equal(
        manifest.contributes.configuration.properties['verilogInstantiate.workspaceIndexMaxFiles'].default,
        5000
    );
    assert.equal(
        manifest.contributes.configuration.properties['verilogInstantiate.workspaceIndexMaxFileSizeKB'].default,
        2048
    );
    assert.match(
        manifest.contributes.configuration.properties['verilogInstantiate.workspaceIndexExclude'].default,
        /\\?\*\.gen/
    );
    assert.equal(manifest.contributes.viewsContainers.panel[0].id, 'otterFpgaPanel');
    assert.equal(manifest.contributes.viewsContainers.panel[0].icon, 'icon.png');
    assert.equal(manifest.contributes.views.otterFpgaPanel[0].id, 'otterFpgaHierarchy');
    assert.equal(
        manifest.contributes.menus['editor/title'][0].command,
        'verilog-instantiate.showHierarchy'
    );
    assert.equal(manifest.contributes.menus['editor/title'][0].group, 'navigation@9');
    assert.equal(manifest.contributes.menus['view/title'][0].when, 'view == otterFpgaHierarchy');
});

test('manifest 引用的所有 grammar 都存在且 scopeName 一致', () => {
    const root = path.resolve(__dirname, '..');
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    for (const item of manifest.contributes.grammars) {
        const grammarPath = path.resolve(root, item.path);
        const grammar = JSON.parse(fs.readFileSync(grammarPath, 'utf8'));
        assert.equal(grammar.scopeName, item.scopeName, item.path);
    }
});
