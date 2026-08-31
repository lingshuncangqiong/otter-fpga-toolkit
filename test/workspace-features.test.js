'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const Module = require('node:module');

class Position {
    constructor(line, character) {
        this.line = line;
        this.character = character;
    }
}

class Range {
    constructor(start, end) {
        this.start = start;
        this.end = end;
    }

    contains(position) {
        const afterStart = position.line > this.start.line
            || (position.line === this.start.line && position.character >= this.start.character);
        const beforeEnd = position.line < this.end.line
            || (position.line === this.end.line && position.character <= this.end.character);
        return afterStart && beforeEnd;
    }
}

class Location {
    constructor(uri, rangeOrPosition) {
        this.uri = uri;
        this.range = rangeOrPosition;
    }
}

class InlayHint {
    constructor(position, label, kind) {
        this.position = position;
        this.label = label;
        this.kind = kind;
    }
}

class EventEmitter {
    constructor() {
        this.event = () => ({dispose() {}});
    }
    fire() {}
    dispose() {}
}

class TreeItem {
    constructor(label, collapsibleState) {
        this.label = label;
        this.collapsibleState = collapsibleState;
    }
}

class ThemeIcon {
    constructor(id) {
        this.id = id;
    }
}

const registeredCommands = new Map();
const revealedElements = [];

const vscodeMock = {
    commands: {
        registerCommand(id, handler) {
            registeredCommands.set(id, handler);
            return {dispose() { registeredCommands.delete(id); }};
        }
    },
    EventEmitter,
    InlayHint,
    InlayHintKind: {Type: 1},
    Location,
    Position,
    Range,
    ThemeIcon,
    TreeItem,
    TreeItemCollapsibleState: {None: 0, Collapsed: 1},
    languages: {
        registerDefinitionProvider() { return {dispose() {}}; },
        registerInlayHintsProvider() { return {dispose() {}}; }
    },
    window: {
        activeTextEditor: null,
        createTreeView(_id, options) {
            assert.equal(typeof options.treeDataProvider.getParent, 'function');
            return {
                dispose() {},
                async reveal(element, revealOptions) {
                    revealedElements.push({element, options: revealOptions});
                }
            };
        },
        showInformationMessage() {},
        onDidChangeActiveTextEditor() { return {dispose() {}}; },
        onDidChangeTextEditorSelection() { return {dispose() {}}; }
    },
    workspace: {
        getConfiguration() {
            return {get(_key, fallback) { return fallback; }};
        },
        createFileSystemWatcher() {
            return {
                dispose() {},
                onDidCreate() { return {dispose() {}}; },
                onDidChange() { return {dispose() {}}; },
                onDidDelete() { return {dispose() {}}; }
            };
        },
        onDidSaveTextDocument() { return {dispose() {}}; },
        onDidChangeWorkspaceFolders() { return {dispose() {}}; },
        onDidChangeConfiguration() { return {dispose() {}}; },
        textDocuments: []
    }
};

const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
    if (request === 'vscode') return vscodeMock;
    return originalLoad.call(this, request, parent, isMain);
};

let features;
try {
    features = require('../workspace-features.js');
} finally {
    Module._load = originalLoad;
}

function positionAt(text, offset) {
    const before = text.slice(0, offset);
    const lines = before.split('\n');
    return new Position(lines.length - 1, lines[lines.length - 1].length);
}

function offsetAt(text, position) {
    const lines = text.split('\n');
    let offset = 0;
    for (let line = 0; line < position.line; line++) offset += lines[line].length + 1;
    return offset + position.character;
}

function createDocument(text, path = 'C:/rtl/top.sv') {
    const uri = {fsPath: path, path, toString() { return `file:///${path}`; }};
    const lines = text.split('\n');
    return {
        languageId: 'systemverilog',
        uri,
        getText(range) {
            if (!range) return text;
            return text.slice(offsetAt(text, range.start), offsetAt(text, range.end));
        },
        getWordRangeAtPosition(position) {
            const offset = offsetAt(text, position);
            let start = offset;
            let end = offset;
            while (start > 0 && /[A-Za-z0-9_$]/.test(text[start - 1])) start--;
            while (end < text.length && /[A-Za-z0-9_$]/.test(text[end])) end++;
            return new Range(positionAt(text, start), positionAt(text, end));
        },
        lineAt(line) { return {text: lines[line] || ''}; },
        offsetAt(position) { return offsetAt(text, position); },
        positionAt(offset) { return positionAt(text, offset); }
    };
}

const TOP_SOURCE = `
module top;
    child U0 (
        .i_clk (clk),
        .i_rst (~locked),
        .o_data(data)
    );
endmodule
`;

function createIndex() {
    const childUri = {fsPath: 'C:/rtl/child.sv', path: 'C:/rtl/child.sv', toString() { return 'file:///C:/rtl/child.sv'; }};
    const child = {
        name: 'child',
        uri: childUri,
        namePosition: new Position(0, 7),
        ports: [
            {name: 'i_clk', direction: 'input', position: new Position(1, 10)},
            {name: 'i_rst', direction: 'input', position: new Position(2, 10)},
            {name: 'o_data', direction: 'output', position: new Position(3, 11)}
        ],
        instances: []
    };
    const topUri = {fsPath: 'C:/rtl/top.sv', path: 'C:/rtl/top.sv', toString() { return 'file:///C:/rtl/top.sv'; }};
    const top = {
        name: 'top',
        uri: topUri,
        namePosition: new Position(0, 7),
        ports: [],
        instances: [{typeName: 'child', instanceName: 'U0'}]
    };
    const index = {definitions: [child, top], byName: new Map([['child', [child]], ['top', [top]]])};
    return {child, index, top};
}

test('Inlay Hints 在 named connection 括号内显示 input/output', async () => {
    const document = createDocument(TOP_SOURCE);
    const {index} = createIndex();
    const provider = new features.PortDirectionInlayProvider({async get() { return index; }});
    const hints = await provider.provideInlayHints(
        document,
        new Range(new Position(0, 0), new Position(99, 0)),
        {isCancellationRequested: false}
    );
    assert.deepEqual(hints.map(hint => hint.label), ['input\u00a0', 'input\u00a0', 'output']);
    assert.ok(hints.every(hint => hint.label.length === 6));
    assert.ok(hints.every(hint => hint.paddingRight));
    assert.match(hints[1].tooltip, /child\.i_rst/);
    const firstConnection = TOP_SOURCE.indexOf('(', TOP_SOURCE.indexOf('.i_clk')) + 1;
    assert.deepEqual(hints[0].position, positionAt(TOP_SOURCE, firstConnection));
    provider.dispose();
});

test('参数和端口 Inlay Hints 使用相同宽度并保持上下对称', async () => {
    const source = `
module top;
    child #(
        .P_WIDTH (8),
        .P_MODE  ("FAST")
    ) U0 (
        .i_clk (clk),
        .o_data(data)
    );
endmodule
`;
    const document = createDocument(source);
    const {child, index} = createIndex();
    child.ports = [
        {name: 'i_clk', direction: 'input'},
        {name: 'o_data', direction: 'output'}
    ];
    const provider = new features.PortDirectionInlayProvider({async get() { return index; }});
    const hints = await provider.provideInlayHints(
        document,
        new Range(new Position(0, 0), new Position(99, 0)),
        {isCancellationRequested: false}
    );
    assert.deepEqual(
        hints.map(hint => hint.label),
        ['param\u00a0', 'param\u00a0', 'input\u00a0', 'output']
    );
    assert.ok(hints.every(hint => hint.label.length === 6));
    assert.match(hints[0].tooltip, /parameter/);
    provider.dispose();
});

test('多行 inout 连接在后续内容行重复方向以保持对齐', async () => {
    const source = `
module top;
    wrapper U0 (
        .sensor_gpio_tri_io ({io_sensor_pwdn,
                              io_sensor_rst_n})
    );
endmodule
`;
    const document = createDocument(source);
    const definition = {
        name: 'wrapper',
        uri: {fsPath: 'C:/rtl/wrapper.bd'},
        ports: [{name: 'sensor_gpio_tri_io', direction: 'inout'}],
        instances: []
    };
    const index = {definitions: [definition], byName: new Map([['wrapper', [definition]]])};
    const provider = new features.PortDirectionInlayProvider({async get() { return index; }});
    const hints = await provider.provideInlayHints(
        document,
        new Range(new Position(0, 0), new Position(99, 0)),
        {isCancellationRequested: false}
    );
    assert.deepEqual(hints.map(hint => hint.label), ['inout\u00a0', 'inout\u00a0']);
    assert.deepEqual(
        hints[1].position,
        positionAt(source, source.indexOf('io_sensor_rst_n'))
    );
    assert.ok(hints.every(hint => hint.paddingRight));
    assert.match(hints[1].tooltip, /多行连接续行/);
    provider.dispose();
});

test('F12 在模块类型和实例名上都返回子模块定义', async () => {
    const document = createDocument(TOP_SOURCE);
    const {child, index} = createIndex();
    for (const needle of ['child', 'U0']) {
        const offset = TOP_SOURCE.indexOf(needle) + 1;
        const result = await features.provideWorkspaceDefinition(
            document,
            positionAt(TOP_SOURCE, offset),
            {async get() { return index; }},
            () => null
        );
        assert.equal(result.length, 1);
        assert.equal(result[0].uri, child.uri);
    }
});

test('层次树只显示当前编辑器所在 module 并展开实例', async () => {
    const {index} = createIndex();
    const document = createDocument(TOP_SOURCE);
    vscodeMock.window.activeTextEditor = {
        document,
        selection: {active: positionAt(TOP_SOURCE, TOP_SOURCE.indexOf('module top') + 10)}
    };
    const provider = new features.ModuleHierarchyProvider({async get() { return index; }});
    const roots = await provider.getChildren();
    assert.deepEqual(roots.map(item => item.definition.name), ['top']);
    assert.equal(provider.getParent(roots[0]), undefined);
    const children = await provider.getChildren(roots[0]);
    assert.equal(children.length, 1);
    assert.equal(children[0].instance.instanceName, 'U0');
    assert.equal(provider.getParent(children[0]), roots[0]);
    const treeItem = provider.getTreeItem(children[0]);
    assert.equal(treeItem.label, 'U0 : child');
    assert.equal(treeItem.command.command, 'vscode.open');
    provider.dispose();
    vscodeMock.window.activeTextEditor = null;
});

test('同一文件包含多个 module 时按光标位置选择当前根节点', async () => {
    const source = 'module first; endmodule\nmodule second; endmodule\n';
    const document = createDocument(source);
    vscodeMock.window.activeTextEditor = {
        document,
        selection: {active: positionAt(source, source.indexOf('second') + 2)}
    };
    const emptyIndex = {definitions: [], byName: new Map()};
    const provider = new features.ModuleHierarchyProvider({async get() { return emptyIndex; }});
    const roots = await provider.getChildren();
    assert.deepEqual(roots.map(item => item.definition.name), ['second']);
    provider.dispose();
    vscodeMock.window.activeTextEditor = null;
});

test('工作区索引通过 workspace.fs 读取文件并跳过超大未打开文件', async () => {
    const smallUri = {fsPath: 'C:/rtl/small.sv', path: 'C:/rtl/small.sv', toString() { return 'file:///C:/rtl/small.sv'; }};
    const largeUri = {fsPath: 'C:/rtl/large.sv', path: 'C:/rtl/large.sv', toString() { return 'file:///C:/rtl/large.sv'; }};
    const xciUri = {fsPath: 'C:/rtl/ip/clk_wiz_0.xci', path: 'C:/rtl/ip/clk_wiz_0.xci', toString() { return 'file:///C:/rtl/ip/clk_wiz_0.xci'; }};
    const smallText = Buffer.from('module small(input i_clk); endmodule', 'utf8');
    const xciText = Buffer.from(JSON.stringify({
        ip_inst: {
            xci_name: 'clk_wiz_0',
            boundary: {ports: {clk_in1: [{direction: 'in'}], clk_out1: [{direction: 'out'}]}}
        }
    }), 'utf8');
    const originalFindFiles = vscodeMock.workspace.findFiles;
    const originalFs = vscodeMock.workspace.fs;
    vscodeMock.workspace.findFiles = async include => include.includes('xci') ? [xciUri] : [smallUri, largeUri];
    vscodeMock.workspace.fs = {
        async stat(uri) {
            if (uri === largeUri) return {size: 3 * 1024 * 1024};
            return {size: uri === xciUri ? xciText.length : smallText.length};
        },
        async readFile(uri) {
            if (uri === smallUri) return smallText;
            if (uri === xciUri) return xciText;
            assert.fail(`unexpected read: ${uri.fsPath}`);
        }
    };
    try {
        const index = await new features.WorkspaceModuleIndex().get();
        assert.equal(index.fileCount, 3);
        assert.equal(index.skippedLargeFileCount, 1);
        assert.deepEqual(index.definitions.map(item => item.name), ['clk_wiz_0', 'small']);
        assert.deepEqual(
            index.byName.get('clk_wiz_0')[0].ports.map(port => [port.name, port.direction]),
            [['clk_in1', 'input'], ['clk_out1', 'output']]
        );
    } finally {
        vscodeMock.workspace.findFiles = originalFindFiles;
        vscodeMock.workspace.fs = originalFs;
    }
});

test('工作区功能注册后右上角命令可以 reveal 当前根节点', async () => {
    const context = {subscriptions: []};
    const services = features.registerWorkspaceFeatures(context, () => null);
    assert.ok(services.moduleIndex);
    assert.ok(services.inlayProvider);
    assert.ok(services.hierarchyProvider);
    assert.ok(services.hierarchyView);
    assert.ok(registeredCommands.has('verilog-instantiate.showHierarchy'));
    assert.ok(context.subscriptions.length >= 12);
    const {index} = createIndex();
    const document = createDocument(TOP_SOURCE);
    services.moduleIndex.cache = index;
    vscodeMock.window.activeTextEditor = {
        document,
        selection: {active: positionAt(TOP_SOURCE, TOP_SOURCE.indexOf('module top') + 10)}
    };
    revealedElements.length = 0;
    await registeredCommands.get('verilog-instantiate.showHierarchy')();
    assert.equal(revealedElements.length, 1);
    assert.equal(revealedElements[0].element.definition.name, 'top');
    assert.deepEqual(revealedElements[0].options, {select: true, focus: true, expand: 1});
    vscodeMock.window.activeTextEditor = null;
    for (const disposable of context.subscriptions) {
        if (disposable && typeof disposable.dispose === 'function') disposable.dispose();
    }
});

test('同名 module 优先选择与当前文件路径最接近的定义', () => {
    const sourceUri = {fsPath: 'C:/workspace/project_b/rtl/top.sv'};
    const projectA = {name: 'child', uri: {fsPath: 'C:/workspace/project_a/rtl/child.sv'}};
    const projectB = {name: 'child', uri: {fsPath: 'C:/workspace/project_b/rtl/child.sv'}};
    assert.equal(features.selectClosestDefinition([projectA, projectB], sourceUri), projectB);
});

test('普通 RTL 定义优先于同名 XCI/BD 元数据', () => {
    const sourceUri = {fsPath: 'C:/workspace/top.sv'};
    const rtl = {name: 'clk_wiz_0', sourceKind: 'rtl', uri: {fsPath: 'C:/workspace/rtl/clk_wiz_0.v'}};
    const xci = {name: 'clk_wiz_0', sourceKind: 'xilinx-xci', uri: {fsPath: 'C:/workspace/clk_wiz_0.xci'}};
    assert.equal(features.selectClosestDefinition([xci, rtl], sourceUri), rtl);
});

test('input/output/inout 方向提示使用相同显示宽度', () => {
    const labels = ['input', 'output', 'inout'].map(features.formatDirectionHint);
    assert.deepEqual(labels, ['input\u00a0', 'output', 'inout\u00a0']);
    assert.ok(labels.every(label => label.length === 6));
    assert.equal(features.formatParameterHint(), 'param\u00a0');
});
