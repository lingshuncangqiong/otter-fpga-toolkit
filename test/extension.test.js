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
    parseLine,
    doFmt,
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

test('manifest 保留命令和快捷键，并贡献层次树及提示设置', () => {
    const root = path.resolve(__dirname, '..');
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    assert.equal(manifest.version, '2.1.13');
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
