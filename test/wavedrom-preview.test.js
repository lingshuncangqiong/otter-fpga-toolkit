'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const Module = require('node:module');
const {pathToFileURL, fileURLToPath} = require('node:url');
const {findAllWaveDromBlocks} = require('../wavedrom-parser');
const commands = new Map();
const documents = new Map();
const calls = [];
let hoverProvider;
let lensProvider;
let receiver;
let saveDefault;
let panelCount = 0;
let lastPanel;
let closePanel;
const updates = [];
class Position { constructor(line, character) { this.line = line; this.character = character; } }
class Range { constructor(...args) { this.args = args; } }
class Selection { constructor(anchor, active) { this.anchor = anchor; this.active = active; } }
class MarkdownString {
    constructor() { this.value = ''; }
    appendMarkdown(value) { this.value += value; }
    appendText(value) { this.value += value; }
}
const disposable = {dispose() {}};
const vscode = {
    Position, Range, Selection, MarkdownString,
    Hover: class { constructor(contents, range) { this.contents = contents; this.range = range; } },
    CodeLens: class { constructor(range, command) { this.range = range; this.command = command; } },
    Uri: {file: pathToFileURL, parse: value => new URL(value)},
    TextEditorRevealType: {InCenterIfOutsideViewport: 2, InCenter: 1},
    ViewColumn: {Beside: 2, One: 1},
    workspace: {
        openTextDocument: async uri => documents.get(uri.toString()),
        onDidChangeTextDocument: () => disposable
    },
    languages: {
        registerHoverProvider: (_, p) => { hoverProvider = p; return disposable; },
        registerCodeLensProvider: (_, p) => { lensProvider = p; return disposable; }
    },
    commands: {registerCommand: (name, fn) => { commands.set(name, fn); return disposable; },
        executeCommand: async (...args) => calls.push(args)},
    window: {
        activeTextEditor: null,
        visibleTextEditors: [],
        showWarningMessage: value => calls.push(['warning', value]),
        showErrorMessage: value => calls.push(['error', value]),
        showInformationMessage: () => {},
        setStatusBarMessage: msg => calls.push(['status', msg]),
        onDidChangeTextEditorSelection: () => disposable,
        showTextDocument: async document => editor(document),
        showSaveDialog: async options => { saveDefault = options.defaultUri; return undefined; },
        createWebviewPanel: (_type, _title, column) => {
            panelCount++;
            lastPanel = {viewColumn:column, reveal(column) { this.viewColumn = column; }, onDidDispose: fn => {closePanel=fn;return disposable;},
                webview: {html: '', postMessage: msg => { updates.push(msg); return Promise.resolve(true); },
                    onDidReceiveMessage: fn => { receiver = fn; return disposable; }}};
            return lastPanel;
        }
    },
    env: {clipboard: {writeText: async text => calls.push(['clipboard', text])}}
};
function document(name, waves) {
    const uri = pathToFileURL(require('node:path').join(require('node:os').tmpdir(), name));
    uri.fsPath = fileURLToPath(uri);
    const lines = waves.flatMap(signal => ['// ```wavedrom', '// {signal:[{name:"'+signal+'",wave:"p..."}]}', '// ```']);
    const doc = {uri, languageId: 'systemverilog', lineCount: lines.length,
        lineAt: line => ({text: lines[line] || '', firstNonWhitespaceCharacterIndex: 0}),
        getText: () => lines.join('\n')};
    documents.set(uri.toString(), doc);
    return doc;
}
function editor(document) {
    const value = {document, viewColumn:1, selection: {active: new Position(0, 0)}, revealRange() {}};
    vscode.window.activeTextEditor = value;
    vscode.window.visibleTextEditors = [value];
    return value;
}
const originalLoad = Module._load;
let preview;
try {
    Module._load = function(request, parent, isMain) {
        return request === 'vscode' ? vscode : originalLoad.call(this, request, parent, isMain);
    };
    preview = require('../wavedrom-webview');
} finally { Module._load = originalLoad; }
const context = {subscriptions: []};
preview.registerWaveDromFeatures(context);
test.after(() => context.subscriptions.forEach(item => item.dispose()));

test('CodeLens opens in the source group, with explicit side-by-side available', async () => {
    const doc = document('wave-a.sv', ['first', 'second']);
    editor(doc);
    const lens = lensProvider.provideCodeLenses(doc)[2];
    assert.deepEqual(lens.command.arguments, [doc.uri.toString(), 3]);
    await commands.get(lens.command.command)(...lens.command.arguments);
    assert.equal(panelCount, 1);
    assert.equal(lastPanel.viewColumn, 1);
    await receiver({command:'ready'});
    await receiver({command:'showBeside', revision:preview.__test.currentRevision()});
    assert.equal(lastPanel.viewColumn, vscode.ViewColumn.Beside);
});

test('hover preview uses pure in-memory data and commands keep the hovered document and block', () => {
    const doc = document('wave-links.sv', ['first', 'second']);
    const hover = hoverProvider.provideHover(doc, new Position(4, 0));
    const value = hover.contents.value;
    assert.ok(value.includes('WaveDrom 时序波形'));
    const payload = value.match(/command:otter-fpga-toolkit.exportWaveformSvg\?([^)]*)/)[1];
    assert.deepEqual(JSON.parse(decodeURIComponent(payload)), [doc.uri.toString(), 3]);
    assert.ok(hover.contents.isTrusted.enabledCommands.includes('otter-fpga-toolkit.exportWaveformSvg'));
});

test('side-panel export follows the currently displayed document', async () => {
    const a = document('wave-a.sv', ['a']);
    const b = document('wave-b.sv', ['b']);
    editor(a);
    await preview.openWaveformPanel(context, a, 0);
    await preview.openWaveformPanel(context, b, 0);
    await receiver({command: 'exportSvg', revision:preview.__test.currentRevision()});
    assert.match(fileURLToPath(saveDefault), /wave-b_wave\.svg$/);
});

test('missing waveform clears the old copy and export target', async () => {
    const empty = document('empty.sv', []);
    await preview.openWaveformPanel(context, empty, 0);
    saveDefault = null;
    const before = calls.length;
    await receiver({command: 'exportSvg', revision:preview.__test.currentRevision()});
    await receiver({command: 'copySvg', revision:preview.__test.currentRevision()});
    assert.equal(saveDefault, null);
    assert.equal(calls.length, before);
});

test('jumpToSignal resolves port in RTL document and focuses editor line', async () => {
    const doc = document('wave-jump.sv', ['clk', 'data']);
    doc.lineCount = 10;
    doc.getText = () => 'module test;\n    input clk,\n    input [7:0] data;\nendmodule\n';
    const view = editor(doc);
    await preview.openWaveformPanel(context, doc, 0);
    const res = preview.findSignalInDocument(doc.getText(), 'clk');
    assert.ok(res);
    assert.equal(res.token, 'clk');
    assert.equal(res.kind, 'port');
    assert.equal(res.line, 1);
    await receiver({ command: 'jumpToSignal', signalName: 'clk', revision:preview.__test.currentRevision() });
    assert.equal(view.selection.active.line, 1);
});

test('webview errors are escaped and SVG is isolated from scripts', () => {
    const html = preview.getWebviewHtml('<svg><script>bad()</script></svg>', null, '<img src=x onerror=bad()>');
    assert.ok(!html.includes('<img src=x'));
    assert.match(html, /\\u003cimg/);
    assert.match(html, /Content-Security-Policy/);
    assert.match(html, /<script nonce=/);
});

test('webview HTML removes transition transform and avoids font-weight bold jitter', () => {
    const html = preview.getWebviewHtml('<svg><text class="clickable-signal">clk</text></svg>', { startLine: 0, endLine: 2 }, null);
    // 确保移除了导致缩放弹跳和鼠标拖动延迟的 CSS transition: transform
    assert.ok(!html.includes('transition: transform'));
    // 确保移除了导致文本排版抖动的 font-weight: bold
    assert.ok(!html.includes('font-weight: bold'));
    // 确保包含 lineBadge ID 便于增量更新
    assert.match(html, /id="lineBadge"/);
});

test('unchanged selection does not replace the diagram and stale actions are ignored', async () => {
    const doc = document('wave-jump-suppress.sv', ['clk', 'rst_n']);
    doc.lineCount = 10;
    doc.getText = () => 'module test;\n    input clk,\n    input rst_n;\nendmodule\n';
    editor(doc);
    await preview.openWaveformPanel(context, doc, 0);

    // 触发信号跳转
    await receiver({ command: 'jumpToSignal', signalName: 'rst_n', revision:preview.__test.currentRevision() });
    assert.equal(preview.__test.isJumpingToSignal(), true);

    // 光标跳转至第 2 行（端口定义处，不在波形注释内）
    // 验证调用 updatePreviewContent 不会重新生成或覆盖原有内容
    const count=updates.length;
    const html=lastPanel.webview.html;
    preview.__test.updatePreviewContent(doc, 100);
    assert.equal(updates.length,count);
    assert.equal(lastPanel.webview.html,html);
    const before=calls.length;
    await receiver({command:'copySvg',revision:preview.__test.currentRevision()-1});
    assert.equal(calls.length,before);
});

test('deleting the displayed block clears the diagram and export target', async () => {
    const doc=document('wave-delete.sv',['delete_me']);
    editor(doc);await preview.openWaveformPanel(context,doc,0);
    await receiver({command:'ready'});
    doc.lineCount=1;doc.lineAt=()=>({text:'module empty; endmodule'});
    preview.__test.updatePreviewContent(doc,0,{exactLine:true});
    assert.equal(updates.at(-1).svg,'');
    assert.ok(updates.at(-1).error);
    saveDefault=null;
    await receiver({command:'exportSvg',revision:preview.__test.currentRevision()});
    assert.equal(saveDefault,null);
});

test('signal jump opens its own source instead of selecting in another active file', async () => {
    const source=document('signal-source.sv',['clk']);
    source.getText=()=> 'module source(\n input clk\n); endmodule';
    const other=document('other.sv',['other']);const otherEditor=editor(other);
    await preview.jumpToSignalInEditor(source,'clk');
    assert.equal(vscode.window.activeTextEditor.document,source);
    assert.equal(vscode.window.activeTextEditor.selection.active.line,1);
    assert.equal(otherEditor.selection.active.line,0);
    assert.equal(preview.findSignalInDocument('// input fake;\nmodule source(input real_pin); endmodule','fake'),null);
});

test('updates made before the webview is ready are delivered as the latest snapshot', async () => {
    closePanel();
    const a=document('pending-a.sv',['old_clock']);
    const b=document('pending-b.sv',['new_clock']);
    editor(a);await preview.openWaveformPanel(context,a,0);
    const count=updates.length;
    await preview.openWaveformPanel(context,b,0);
    assert.equal(updates.length,count);
    await receiver({command:'ready'});
    assert.equal(updates.length,count+1);
    assert.match(updates.at(-1).svg,/new_clock/);
    assert.equal(updates.at(-1).revision,preview.__test.currentRevision());
});

test('preview does not write images; only explicit export writes SVG', async t => {
    const writes=[];
    t.mock.method(require('node:fs'),'writeFileSync',(...args)=>writes.push(args));
    const doc=document('memory-only.sv',['clock']);
    editor(doc);
    hoverProvider.provideHover(doc,new Position(1,0));
    await preview.openWaveformPanel(context,doc,0);
    assert.equal(writes.length,0);
    const previous=vscode.window.showSaveDialog;
    const dest={fsPath:'explicit-user-export.svg'};
    try {
        vscode.window.showSaveDialog=async()=>dest;
        await receiver({command:'exportSvg',revision:preview.__test.currentRevision()});
        assert.equal(writes.length,1);
        assert.equal(writes[0][0],dest.fsPath);
        assert.match(writes[0][1],/^<svg/);
    } finally {vscode.window.showSaveDialog=previous;}
});
