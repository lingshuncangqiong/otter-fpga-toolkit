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

test('无逗号的完整末参数不误判为续行，注释与同组声明对齐', () => {
    const lines = [
        '    parameter integer P_WIDTH = 16,// width',
        "    parameter [P_PPC*P_DW-1:0] P_FILL_DATA = {P_PPC*P_DW{1'b0}}// fill"
    ];
    const result = formatLineRange(['module demo #(', ...lines, ')();', 'endmodule'], 4, 0, lines.length + 3);
    const formatted = result.lines.slice(1,-2);
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
    const formatted = formatLineRange(['module demo #(', ...lines, ')();', 'endmodule'], 4, 0, lines.length + 3).lines.slice(1,-2);
    const mode = parseLine(formatted[1], 4);
    assert.equal(mode.type, 'parameter string');
    assert.equal(mode.name, 'P_PAYLOAD_FIFO_MODE');
    assert.equal(formatted[0].indexOf('='), formatted[1].indexOf('='));
    assert.equal(formatted[0].indexOf('//'), formatted[1].indexOf('//'));
});

test('长表达式端口按实际列宽对齐，超过旧上限仍保留单行', () => {
    const lines = [
        'module scaler (',
        '    input i_clk, // clock',
        '    input [$clog2(P_MAX_SOURCE_WIDTH + 1) - 1 : 0] i_cfg_source_width, // width',
        '    input [$clog2(P_MAX_SOURCE_HEIGHT + 1) - 1 : 0] i_cfg_source_height, // height',
        '',
        '    // packed pixel data',
        '    input [((P_PPC * P_VI_DW * P_COMP_NUM + 7) / 8) * 8 - 1 : 0] s_axis_tdata, // data',
        `    output [P_DW - 1 : 0] o_${'long_name_'.repeat(6)}, // long name`,
        '    output o_valid // valid',
        ');',
        'endmodule'
    ];
    const format = source => formatLineRange(source, 4, 0, source.length - 1).lines;
    const result = format(lines);
    const ports = [1, 2, 3, 6, 7, 8];
    assert.equal(new Set(ports.map(i => result[i].indexOf(parseLine(result[i], 4).name))).size, 1);
    assert.equal(new Set(ports.map(i => result[i].indexOf('//'))).size, 1);
    assert.match(result[2], /\[\$clog2\(P_MAX_SOURCE_WIDTH\+1\)-1\s*:0\]/);
    assert.match(result[6], /\[\(\(P_PPC\*P_VI_DW\*P_COMP_NUM\+7\)\/8\)\*8-1:0\]/);
    assert.equal(result.length, lines.length);
    assert.deepEqual(format(result), result);
    const partial = formatLineRange(lines, 4, 2, 3).lines;
    assert.deepEqual(partial.slice(2, 4), result.slice(2, 4));
    assert.deepEqual(partial.slice(4), lines.slice(4));
    assert.equal(result.join('').replace(/\s/g, ''), lines.join('').replace(/\s/g, ''));
});

test('单维端口的范围冒号对齐，表达式靠左，名称与注释仍同列', () => {
    const lines = [
        'module ports (',
        '    input [7 : 0] i_byte, // byte',
        '    input [$clog2(P_WIDTH + 1) - 1 : 0] i_count, // count',
        '    output [P_LONG_DATA_DW - 1 : 0] o_data, // data',
        '    input [15:8] i_high, // nonzero bound',
        '    input i_valid // valid',
        ');',
        'endmodule'
    ];
    const fmt = a => formatLineRange(a, 4, 0, a.length - 1).lines;
    const result = fmt(lines);
    assert.equal(new Set(result.slice(1, 5).map(l => l.indexOf(':'))).size, 1);
    assert.match(result[1], /\[7\s+:0\]/);
    assert.match(result[4], /\[15\s+:8\]/);
    assert.equal(new Set(result.slice(1, 6).map(l => l.indexOf(parseLine(l, 4).name))).size, 1);
    assert.equal(new Set(result.slice(1, 6).map(l => l.indexOf('//'))).size, 1);
    assert.deepEqual(fmt(result), result);
    assert.equal(formatLineRange(lines, 4, 1, 1).lines[1], result[1]);
    assert.equal(result.join('').replace(/\s/g, ''), lines.join('').replace(/\s/g, ''));
});

test('范围解析区分三目、嵌套索引、作用域符号与多维数组', () => {
    for (const [width, left, right] of [
        ['[P_SEL?P_A:P_B:0]', 'P_SEL?P_A:P_B', '0'],
        ['[(P_SEL?P_A:P_B)-1:0]', '(P_SEL?P_A:P_B)-1', '0'],
        ['[pkg::P_WIDTH-1:0]', 'pkg::P_WIDTH-1', '0'],
        ['[P_WIDTHS[0]-1:P_SEL?1:0]', 'P_WIDTHS[0]-1', 'P_SEL?1:0'],
        ['[3:0][7:0]', '', ''],
        ['[P_BASE+:P_WIDTH]', '', ''],
    ]) {
        const parsed = parseLine(`input ${width} i_data,`, 4);
        assert.equal(parsed.cl, left);
        assert.equal(parsed.rr, right);
    }
});

test('多维数组压缩空白，但不合并单词、操作符或改写宏和字符串', () => {
    const line = "reg [ 1 : 0 ] [ P_WIDTHS[ 0 ] - 1 : 0 ] r_mem [ 0 : P_DEPTH - 1 ] = '{default:'0};";
    const parsed = parseLine(line, 4);
    assert.equal(parsed.width, '[1:0][P_WIDTHS[0]-1:0]');
    assert.equal(parsed.unpacked, '[0:P_DEPTH-1]');
    for (const [input, expected] of [
        ['[P_DW + + P_PAD - 1 : 0]', '[P_DW+ +P_PAD-1:0]'],
        ['[P_DW - - P_PAD - 1 : 0]', '[P_DW- -P_PAD-1:0]'],
        ['[$bits( int unsigned ) - 1 : 0]', '[$bits(int unsigned)-1:0]'],
        ['[P_DW > > 1 : 0]', '[P_DW> >1:0]'],
        ['[ `WIDTH( a + b ) - 1 : 0 ]', '[ `WIDTH( a + b ) - 1 : 0 ]'],
        ['[ $bits("a ]  b") - 1 : 0 ]', '[ $bits("a ]  b") - 1 : 0 ]'],
        [String.raw`[ \width[0]  - 1 : 0 ]`, String.raw`[ \width[0]  - 1 : 0 ]`],
    ]) {
        assert.equal(parseLine(`logic ${input} r_value;`, 4).width, expected);
    }
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

test('module接口跨空行和分组标题对齐，参数、内部声明和其它module互不撑宽', () => {
    const source = [
        'module demo #(',
        '    parameter integer P_WIDTH = 32, // width',
        '',
        '    // 参数说明',
        '    parameter integer P_MODE = 1 // mode',
        ')(',
        '    input i_clk, // clock',
        '    input i_rst, // reset',
        '',
        '    //---------------- 请求 ----------------',
        '        input [P_WIDTH-1:0] i_req_data, // data',
        '    output o_req_ready, // ready',
        '',
        '    // 响应',
        '    output [P_WIDTH-1:0] o_response_data, // response',
        '    input i_response_ready // ready',
        ');',
        'localparam integer P_INTERNAL = A_VERY_LONG_INTERNAL_EXPRESSION;',
        'endmodule',
        'module other (',
        '    input i_clk,',
        '    output o_short',
        ');',
        'endmodule'
    ];
    const result = formatLineRange(source, 4, 0, source.length - 1).lines;
    const portLines = [6, 7, 10, 11, 14, 15];
    const names = portLines.map(i => result[i].indexOf(parseLine(source[i], 4).name));
    assert.equal(new Set(names).size, 1);
    assert.equal(new Set(portLines.map(i => result[i].search(/\S/))).size, 1);
    assert.equal(new Set(portLines.map(i => result[i].indexOf('//'))).size, 1);
    assert.equal(result[1].indexOf('='), result[4].indexOf('='));
    assert.equal(result[1].indexOf('//'), result[4].indexOf('//'));
    assert.ok(result[20].indexOf('i_clk') < result[6].indexOf('i_clk'));
    const longerParameter = source.map((line, i) => i === 4
        ? '    parameter integer P_A_VERY_LONG_PARAMETER_NAME = REALLY_LONG_VALUE + ANOTHER_VALUE'
        : line);
    assert.deepEqual(formatLineRange(longerParameter, 4, 0, source.length - 1).lines.slice(5), result.slice(5));
    const selected = formatLineRange(source, 4, 6, 7).lines;
    assert.deepEqual(selected.slice(6, 8), result.slice(6, 8));
    assert.deepEqual(selected.slice(8), source.slice(8));
    assert.deepEqual(formatLineRange(result, 4, 0, result.length - 1).lines, result);
    assert.equal(result.join('').replace(/\s/g, ''), source.join('').replace(/\s/g, ''));
});

test('显式 reg/wire 分区跨空行和注释统一列宽，保留分组与选区边界', () => {
    const source = [
        'module demo;',
        '/***************reg*******************/',
        '// 序列推进状态',
        "reg [P_ADDR_AW-1:0] r_addr = {P_ADDR_AW{1'b0}}; // 地址",
        "reg [P_SEQ_LEN_DW-1:0] r_remain = {P_SEQ_LEN_DW{1'b0}}; // 剩余数",
        '',
        '// 命令配置锁存',
        "reg [P_ADDR_AW-1:0] r_addr_step = {P_ADDR_AW{1'b0}}; // 步长",
        '',
        '// 控制状态',
        "reg r_seq_run = 1'b0; // 运行",
        "reg r_done_pulse = 1'b0; // 完成",
        '/***************wire******************/',
        'wire w_cmd_active; // 命令握手',
        '',
        'wire w_addr_active; // 地址握手',
        '/***************always****************/',
        'endmodule'
    ];
    const fmt = lines => formatLineRange(lines, 4, 0, lines.length - 1).lines;
    const result = fmt(source);
    const regs = [3, 4, 7, 10, 11];
    for(const column of [l=>l.indexOf(parseLine(l, 4).name),l=>l.indexOf('='),l=>l.indexOf('//')]){
        assert.equal(new Set(regs.map(i=>column(result[i]))).size, 1);
    }
    assert.equal(result[3].indexOf(':0]'), result[7].indexOf(':0]'));
    assert.equal(result[13].indexOf('w_cmd_active'),result[10].indexOf('r_seq_run'));
    for(let i=0;i<source.length;i++)if(!parseLine(source[i],4))assert.equal(result[i],source[i]);
    assert.deepEqual(fmt(result),result);
    assert.equal(result.join('').replace(/\s/g,''),source.join('').replace(/\s/g,''));
    const partial=formatLineRange(source,4,7,7).lines;
    assert.equal(partial[7],result[7]);
    assert.deepEqual(partial.slice(0,7),source.slice(0,7));
    assert.deepEqual(partial.slice(8),source.slice(8));
});

test('显式参数区跨说明分组对齐中等长度表达式与有符号常量', () => {
    const source = [
        'module pixel;',
        '/***************parameter*************/',
        'localparam integer P_TOTAL_DATA_DW = P_CH_NUM * P_DATA_DW; // data',
        'localparam integer P_TOTAL_GAIN_DW = P_CH_NUM * P_GAIN_DW; // gain',
        '',
        '// 运算位宽与裁剪边界',
        'localparam integer P_SUM_DW = P_MULT_DW - P_GAIN_FRAC_DW + P_OFFSET_DW + 2; // sum',
        "localparam [P_DATA_DW-1:0] P_DATA_MAX = {P_DATA_DW{1'b1}}; // maximum",
        "localparam signed [P_SUM_DW-1:0] P_CLAMP_MAX = $signed({{(P_SUM_DW-P_DATA_DW){1'b0}}, P_DATA_MAX}); // clamp",
        '/***************reg*******************/',
        'reg r_valid = 0;',
        'endmodule'
    ];
    const fmt = lines => formatLineRange(lines,4,0,lines.length-1).lines;
    const result=fmt(source), declarations=[2,3,6,7,8];
    for(const col of [l=>l.indexOf('='),l=>l.indexOf(';'),l=>l.indexOf('//')]){
        assert.equal(new Set(declarations.map(i=>col(result[i]))).size,1);
    }
    assert.equal(result[4],source[4]);
    assert.equal(result[5],source[5]);
    assert.equal(formatLineRange(source,4,6,6).lines[6],result[6]);
    assert.deepEqual(fmt(result),result);
    assert.equal(result.join('').replace(/\s/g,''),source.join('').replace(/\s/g,''));
});

test('跨 parameter/reg/wire 共用声明头列，修饰符单独对齐，尾列仍按区计算', () => {
    const source = [
        'module demo (input i_clk);',
        '/***************parameter*************/',
        'localparam integer P_LIMIT = P_A + P_B + P_C + P_D; // limit',
        "localparam signed [P_DW-1:0] P_MAX = '0; // max",
        '/***************port******************/',
        '/***************mechine***************/',
        '/***************reg*******************/',
        "reg signed [P_DATA_DW-1:0] r_data = '0; // data",
        '',
        "reg r_valid = 1'b0; // valid",
        'genvar g_ch;',
        '/***************wire******************/',
        'wire [P_OTHER_DW-1:0] w_data; // wire',
        'wire w_enable; // enable',
        '/***************component*************/',
        'endmodule'
    ];
    const fmt=lines=>formatLineRange(lines,4,0,lines.length-1).lines;
    const result=fmt(source),decls=[2,3,7,9,12,13];
    assert.equal(new Set(decls.map(i=>result[i].indexOf(parseLine(result[i],4).name))).size,1);
    assert.equal(new Set([2,3,7,9].map(i=>result[i].indexOf('='))).size,1);
    assert.equal(new Set([3,7,12].map(i=>result[i].indexOf('['))).size,1);
    assert.equal(new Set([3,7,12].map(i=>result[i].indexOf(':0]'))).size,1);
    assert.equal(result[2].indexOf('integer'),result[7].indexOf('signed'));
    assert.ok(result[12].indexOf(';')<result[7].indexOf(';'));
    const longer=source.map((l,i)=>i===2?'localparam integer P_LIMIT = P_A + P_B + P_C + P_D + P_E + P_F; // limit':l);
    assert.deepEqual(fmt(longer).slice(4),result.slice(4));
    assert.deepEqual(fmt(result),result);
    const partial=formatLineRange(source,4,7,9).lines;
    assert.deepEqual(partial.slice(7,10),result.slice(7,10));
    assert.deepEqual(partial.slice(10),source.slice(10));
    assert.equal(result.join('').replace(/\s/g,''),source.join('').replace(/\s/g,''));
});

test('有内容的 mechine 和其它星号分区不隔断状态常量与 reg 的对齐', () => {
    const source = [
        'module demo;',
        '/***************mechine***************/',
        "localparam [1:0] P_ST_IDLE = 2'd0; // idle",
        "localparam [1:0] P_ST_WORK = 2'd1; // work",
        '/***************reg*******************/',
        '// 状态机状态寄存器',
        'reg [1:0] r_st_current = P_ST_IDLE; // current',
        'reg [1:0] r_st_next; // next',
        '/***************custom_state*********/',
        "reg [P_COUNT_DW-1:0] r_count = '0; // count",
        '/***************wire******************/',
        'wire w_active;',
        '/***************always****************/',
        'always @(posedge i_clk) begin',
        '    reg [63:0] r_local;',
        'end',
        'endmodule'
    ];
    const fmt=lines=>formatLineRange(lines,4,0,lines.length-1).lines;
    const result=fmt(source), rows=[2,3,6,7,9,11];
    assert.equal(new Set(rows.map(i=>result[i].indexOf(parseLine(result[i],4).name))).size,1);
    assert.equal(new Set([2,3,6,7,9].map(i=>result[i].indexOf('['))).size,1);
    assert.equal(new Set([2,3,6,7,9].map(i=>result[i].indexOf(':0]'))).size,1);
    assert.equal(new Set([2,3,6,9].map(i=>result[i].indexOf('='))).size,1);
    const changed=source.map((l,i)=>i===14?'    reg [1023:0] r_very_long_local_signal;':l);
    assert.deepEqual(fmt(changed).slice(0,14),result.slice(0,14));
    assert.equal(formatLineRange(source,4,6,6).lines[6],result[6]);
    assert.deepEqual(fmt(result),result);
    assert.equal(result.join('').replace(/\s/g,''),source.join('').replace(/\s/g,''));
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
    assert.equal(result[1], formatLineRange(['module isolated;', 'wire x;', 'endmodule'], 4, 1, 1).lines[1]);
    assert.ok(result[3].indexOf('(') < result[7].indexOf('('));
    assert.equal(result[3].indexOf('('), result[4].indexOf('('));
    assert.equal(result[13], source[13]);
    assert.deepEqual(formatLineRange(result, 4, 0, result.length - 1).lines, result);
});

test('VS Code 智能体接口默认只检查，显式 write 才写入', t => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'otter-vscode-api-'));
    t.after(() => fs.rmSync(tempDir, {recursive: true, force: true}));
    const filePath = path.join(tempDir, 'agent.sv');
    fs.writeFileSync(filePath, 'module agent;\nwire a;// agent\nendmodule\n', 'utf8');

    const check = formatterInterface({file: filePath, tabSize: 4});
    assert.equal(check.status, 'formatting-required');
    assert.equal(check.exitCode, 1);
    assert.equal(check.wrote, false);
    assert.equal(fs.readFileSync(filePath, 'utf8'), 'module agent;\nwire a;// agent\nendmodule\n');

    const write = formatterInterface({mode: 'write', file: filePath, tabSize: 4});
    assert.equal(write.status, 'formatted');
    assert.equal(write.exitCode, 0);
    assert.equal(write.wrote, true);
    assert.notEqual(fs.readFileSync(filePath, 'utf8'), 'module agent;\nwire a;// agent\nendmodule\n');

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
