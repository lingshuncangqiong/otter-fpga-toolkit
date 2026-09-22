'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
    stripCommentPrefix,
    parseWaveDromSource,
    findAllWaveDromBlocks,
    findWaveDromAtLine
} = require('../wavedrom-parser');
const {
    renderSvg,
    svgToDataUri,
    renderFromText
} = require('../wavedrom-service');

test('stripCommentPrefix 能正确剥离多种 Verilog 注释前缀', () => {
    assert.equal(stripCommentPrefix('//   hello world'), '  hello world');
    assert.equal(stripCommentPrefix('  // ```wavedrom'), '```wavedrom');
    assert.equal(stripCommentPrefix('  /* { signal: [] } */'), '{ signal: [] } ');
    assert.equal(stripCommentPrefix('   * { "signal": [] }'), '{ "signal": [] }');
    assert.equal(stripCommentPrefix('module test;'), 'module test;');
});

test('parseWaveDromSource 支持标准 JSON 与宽松 JSON5 语法', () => {
    // 1. 标准 JSON
    const res1 = parseWaveDromSource('{"signal": [{"name": "clk", "wave": "p..."}]}');
    assert.equal(res1.ok, true);
    assert.equal(res1.data.signal.length, 1);
    assert.equal(res1.data.signal[0].name, 'clk');

    // 2. JSON5: 未加引号的键、单引号、尾随逗号
    const json5Sample = `{
        signal: [
            { name: 'clk', wave: 'p.......', },
            { name: 'rst_n', wave: '0.1.....', },
        ],
    }`;
    const res2 = parseWaveDromSource(json5Sample);
    assert.equal(res2.ok, true);
    assert.equal(res2.data.signal.length, 2);
    assert.equal(res2.data.signal[1].name, 'rst_n');

    // 3. 非法格式测试
    const resErr1 = parseWaveDromSource('{"other": 123}');
    assert.equal(resErr1.ok, false);
    assert.match(resErr1.error, /must contain a "signal" array/);

    const resErr2 = parseWaveDromSource('invalid json content');
    assert.equal(resErr2.ok, false);
});

test('findAllWaveDromBlocks 正确识别 Verilog 注释中的 wavedrom 栅格块', () => {
    const verilogSample = [
        '`timescale 1ns/1ps',
        '//---------------------------------------------------------',
        '// 关键时序波形图：',
        '// ```wavedrom',
        '// {',
        '//   signal: [',
        '//     { name: "PCLK", wave: "p......" },',
        '//     { name: "VALID", wave: "010...." }',
        '//   ]',
        '// }',
        '// ```',
        'module sample_fifo (',
        '    input wire clk',
        ');',
        '// { signal: [{ name: "ack", wave: "010" }] }',
        'endmodule'
    ];

    const blocks = findAllWaveDromBlocks(verilogSample);
    assert.equal(blocks.length, 2);

    // 第一个栅格块
    assert.equal(blocks[0].startLine, 3);
    assert.equal(blocks[0].endLine, 10);
    assert.equal(blocks[0].parsed !== null, true);
    assert.equal(blocks[0].parsed.signal.length, 2);

    // 第二个单行隐式 JSON 块
    assert.equal(blocks[1].startLine, 14);
    assert.equal(blocks[1].endLine, 14);
    assert.equal(blocks[1].parsed !== null, true);
    assert.equal(blocks[1].parsed.signal[0].name, 'ack');
});

test('findWaveDromAtLine 按光标位置定位代码块', () => {
    const sample = [
        '// line 0',
        '// ```wavedrom',
        '// { signal: [{ name: "clk", wave: "p." }] }',
        '// ```',
        '// line 4'
    ];

    assert.equal(findWaveDromAtLine(sample, 0), null);
    const hit1 = findWaveDromAtLine(sample, 1);
    assert.notEqual(hit1, null);
    assert.equal(hit1.startLine, 1);

    const hit2 = findWaveDromAtLine(sample, 2);
    assert.notEqual(hit2, null);
    assert.equal(hit2.startLine, 1);

    const hit3 = findWaveDromAtLine(sample, 3);
    assert.notEqual(hit3, null);

    assert.equal(findWaveDromAtLine(sample, 4), null);
});

test('renderSvg 与 renderFromText 生成高质量矢量 SVG 与 Data URI', () => {
    const waveText = `{
        signal: [
            { name: "PCLK (100MHz)", wave: "p....", period: 2 },
            { name: "DATA", wave: "x==.x", period: 2, data: ["D0", "D1"] }
        ]
    }`;

    const res = renderFromText(waveText);
    assert.equal(res.ok, true);
    assert.equal(typeof res.svg, 'string');
    assert.match(res.svg, /<svg\b/);
    assert.match(res.svg, /PCLK \(100MHz\)/);
    assert.match(res.svg, /<\/svg>/);

    // Data URI 校验
    assert.equal(typeof res.dataUri, 'string');
    assert.match(res.dataUri, /^data:image\/svg\+xml;utf8,/);
});
