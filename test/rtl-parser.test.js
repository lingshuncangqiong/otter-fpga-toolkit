'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
    findModuleReferenceAtOffset,
    maskNonCode,
    parseRtlDocument
} = require('../rtl-parser.js');

const SAMPLE = `
module i2c_edid_slave #(
    parameter string P_EDID_PROFILE = "1920_1080_30"
)(
    input  logic i_clk,
    input  logic i_rst,
    output logic o_slave_busy,
    output logic o_bus_error
);
endmodule

module hdmi_top;
    i2c_edid_slave #(
        .P_EDID_PROFILE ("1920_1080_30")
    ) i2c_edid_slave_U0 (
        .i_clk        (i_sys_clk),
        .i_rst        (~w_clk_200m_locked),
        .o_slave_busy (w_hdmi_rx_edid_busy),
        .o_bus_error  (select_signal(foo(bar), bus[3:0]))
    );
endmodule
`;

test('maskNonCode 保留长度和换行位置', () => {
    const source = 'wire a; // comment\nstring s = "(text)";\n/* block\ncomment */ wire b;';
    const masked = maskNonCode(source);
    assert.equal(masked.length, source.length);
    assert.equal(masked.split('\n').length, source.split('\n').length);
    assert.equal(masked.indexOf('comment'), -1);
    assert.equal(masked.indexOf('(text)'), -1);
    assert.match(masked, /wire a/);
    assert.match(masked, /wire b/);
});

test('解析 module、ANSI port direction 和参数化实例', () => {
    const structure = parseRtlDocument(SAMPLE);
    assert.deepEqual(structure.modules.map(item => item.name), ['i2c_edid_slave', 'hdmi_top']);

    const child = structure.modules[0];
    assert.deepEqual(
        child.ports.map(item => [item.name, item.direction]),
        [
            ['i_clk', 'input'],
            ['i_rst', 'input'],
            ['o_slave_busy', 'output'],
            ['o_bus_error', 'output']
        ]
    );

    const instance = structure.modules[1].instances[0];
    assert.equal(instance.typeName, 'i2c_edid_slave');
    assert.equal(instance.instanceName, 'i2c_edid_slave_U0');
    assert.deepEqual(
        instance.connections.map(item => item.portName),
        ['i_clk', 'i_rst', 'o_slave_busy', 'o_bus_error']
    );
    const resetConnection = instance.connections.find(item => item.portName === 'i_rst');
    assert.equal(SAMPLE.slice(resetConnection.expressionStart, resetConnection.expressionEnd).trim(), '~w_clk_200m_locked');
    const nestedConnection = instance.connections.find(item => item.portName === 'o_bus_error');
    assert.equal(
        SAMPLE.slice(nestedConnection.expressionStart, nestedConnection.expressionEnd).trim(),
        'select_signal(foo(bar), bus[3:0])'
    );
});

test('模块类型和实例名都能解析为同一跨文件跳转目标', () => {
    const structure = parseRtlDocument(SAMPLE);
    const instance = structure.modules[1].instances[0];
    assert.equal(findModuleReferenceAtOffset(structure, instance.typeOffset + 2), instance);
    assert.equal(findModuleReferenceAtOffset(structure, instance.instanceNameOffset + 2), instance);
});

test('非 ANSI Verilog module 也能解析顶层端口方向', () => {
    const source = `
module legacy(a, b, c);
    input wire a, b;
    output reg c;
    function automatic helper;
        input c;
    endfunction
endmodule
`;
    const structure = parseRtlDocument(source);
    assert.deepEqual(
        structure.modules[0].ports.map(item => [item.name, item.direction]),
        [['a', 'input'], ['b', 'input'], ['c', 'output']]
    );
});

test('Vivado 原语 module header 中的条件编译指令不遮断 ANSI 端口', () => {
    const source = `
module BUFG
\`ifdef XIL_TIMING
#(parameter LOC = "UNPLACED")
\`endif
(
    output O,
    input  I
);
endmodule
`;
    const structure = parseRtlDocument(source);
    assert.deepEqual(
        structure.modules[0].ports.map(item => [item.name, item.direction]),
        [['O', 'output'], ['I', 'input']]
    );
});

test('Verilog/SystemVerilog grammar 使用递归连接表达式且不再依赖端口 lookbehind', () => {
    const root = path.resolve(__dirname, '..');
    for (const name of ['verilog.tmLanguage.json', 'systemverilog.tmLanguage.json']) {
        const grammar = JSON.parse(fs.readFileSync(path.join(root, 'syntaxes', name), 'utf8'));
        const instPort = grammar.repository.inst_ports.patterns[0];
        assert.equal(instPort.name, 'meta.instance.port.connection');
        assert.match(instPort.begin, /A-Za-z_/);
        assert.equal(instPort.patterns[0].include, '#connection_expression');
        assert.ok(
            grammar.repository.connection_expression.patterns.some(
                item => item.name === 'variable.other.port'
            )
        );
        assert.equal(grammar.repository.connection_group.patterns[0].patterns[0].include, '#connection_expression');
        assert.match(new RegExp(instPort.begin).exec('.P_CLK_HZ (')[0], /P_CLK_HZ/);
        const decimalPattern = grammar.repository.constants.patterns.find(
            item => item.match.includes('\\d[\\d_]*')
        );
        assert.equal(new RegExp(decimalPattern.match).exec('50_000_000')[0], '50_000_000');
        assert.doesNotMatch(JSON.stringify(grammar.repository.inst_ports), /\(\?<=/);
        assert.doesNotMatch(JSON.stringify(grammar.repository.signal_assignments), /\(\?<=/);
    }
});
