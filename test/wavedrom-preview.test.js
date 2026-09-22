'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const Module = require('node:module');
const fs = require('node:fs');
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
    TextEditorRevealType: {InCenterIfOutsideViewport: 2},
    ViewColumn: {Beside: 2},
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
        showWarningMessage: value => calls.push(['warning', value]),
        showErrorMessage: value => calls.push(['error', value]),
        showInformationMessage: () => {},
        onDidChangeTextEditorSelection: () => disposable,
        showTextDocument: async document => editor(document),
        showSaveDialog: async options => { saveDefault = options.defaultUri; return undefined; },
        createWebviewPanel: () => {
            panelCount++;
            return {reveal() {}, onDidDispose: () => disposable,
                webview: {html: '', onDidReceiveMessage: fn => { receiver = fn; return disposable; }}};
        }
    },
    env: {clipboard: {writeText: async text => calls.push(['clipboard', text])}}
};
function document(name, waves) {
    const uri = pathToFileURL(require('node:path').join(require('node:os').tmpdir(), name));
    uri.fsPath = fileURLToPath(uri);
    const lines = waves.flatMap(signal => ['// ```wavedrom', '// {signal:[{name:"'+signal+'",wave:"p..."}]}', '// ```']);
    const doc = {uri, languageId: 'systemverilog', lineCount: lines.length,
        lineAt: line => ({text: lines[line], firstNonWhitespaceCharacterIndex: 0})};
    documents.set(uri.toString(), doc);
    return doc;
}
function editor(document) {
    const value = {document, selection: {active: new Position(0, 0)}, revealRange() {}};
    vscode.window.activeTextEditor = value;
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

test('CodeLens click shows native hover at the requested block without a side panel', async () => {
    const doc = document('wave-a.sv', ['first', 'second']);
    const view = editor(doc);
    const lens = lensProvider.provideCodeLenses(doc)[2];
    assert.deepEqual(lens.command.arguments, [doc.uri.toString(), 3]);
    await commands.get(lens.command.command)(...lens.command.arguments);
    assert.equal(panelCount, 0);
    assert.equal(view.selection.active.line, 3);
    assert.deepEqual(calls.at(-1), ['editor.action.showHover', {focus: true}]);
});

test('hover image uses a short URI and commands keep the hovered document and block', () => {
    const doc = document('wave-links.sv', ['first', 'second']);
    const hover = hoverProvider.provideHover(doc, new Position(4, 0));
    const value = hover.contents.value;
    const uri = value.match(/!\[时序波形\]\(([^)]+)\)/)[1];
    assert.ok(fs.readFileSync(fileURLToPath(uri), 'utf8').includes('<svg'));
    assert.ok(value.length < 3000);
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
    await receiver({command: 'exportSvg'});
    assert.match(fileURLToPath(saveDefault), /wave-b_wave\.svg$/);
});

test('missing waveform clears the old copy and export target', async () => {
    const empty = document('empty.sv', []);
    await preview.openWaveformPanel(context, empty, 0);
    saveDefault = null;
    const before = calls.length;
    await receiver({command: 'exportSvg'});
    await receiver({command: 'copySvg'});
    assert.equal(saveDefault, null);
    assert.equal(calls.length, before);
});

test('webview errors are escaped and SVG is isolated from scripts', () => {
    const html = preview.getWebviewHtml('<svg><script>bad()</script></svg>', null, '<img src=x onerror=bad()>');
    assert.ok(!html.includes('<img src=x'));
    assert.match(html, /&lt;img/);
    assert.match(html, /Content-Security-Policy/);
    assert.match(html, /<script nonce=/);
});
