'use strict';

const path = require('path');
const vscode = require('vscode');
const {findModuleReferenceAtOffset, parseRtlDocument} = require('./rtl-parser');
const {findVivadoPrimitiveSource, parseVendorMetadata} = require('./vendor-metadata');

const RTL_SELECTOR = ['verilog', 'systemverilog'];
const RTL_FILE_GLOB = '**/*.{v,vh,sv,svh}';
const VENDOR_METADATA_GLOB = '**/*.{xci,bd}';
const DEFAULT_RTL_EXCLUDE_GLOB = '**/{.git,node_modules,.Xil,.xil,xsim.dir,work,*.gen,*.cache,*.ip_user_files,*.runs}/**';
const HIERARCHY_VIEW_ID = 'otterFpgaHierarchy';

function isRtlDocument(document) {
    return !!document && RTL_SELECTOR.includes(document.languageId);
}

function isVendorMetadataDocument(document) {
    const filePath = document?.uri?.fsPath || document?.uri?.path || '';
    return ['.xci', '.bd'].includes(path.extname(filePath).toLowerCase());
}

function getIndexLimit() {
    const value = Number(
        vscode.workspace.getConfiguration('verilogInstantiate').get('workspaceIndexMaxFiles', 5000)
    );
    if (!Number.isFinite(value)) return 5000;
    return Math.min(50000, Math.max(100, Math.trunc(value)));
}

function getIndexExcludeGlob() {
    return vscode.workspace.getConfiguration('verilogInstantiate').get(
        'workspaceIndexExclude',
        DEFAULT_RTL_EXCLUDE_GLOB
    );
}

function getIndexMaxFileBytes() {
    const value = Number(
        vscode.workspace.getConfiguration('verilogInstantiate').get('workspaceIndexMaxFileSizeKB', 2048)
    );
    const sizeKB = Number.isFinite(value) ? Math.min(102400, Math.max(64, Math.trunc(value))) : 2048;
    return sizeKB * 1024;
}

function createPositionAt(text) {
    const lineStarts = [0];
    for (let i = 0; i < text.length; i++) {
        if (text[i] === '\n') lineStarts.push(i + 1);
    }
    return offset => {
        let low = 0;
        let high = lineStarts.length - 1;
        while (low <= high) {
            const middle = (low + high) >> 1;
            if (lineStarts[middle] <= offset) low = middle + 1;
            else high = middle - 1;
        }
        const line = Math.max(0, high);
        return new vscode.Position(line, offset - lineStarts[line]);
    };
}

function asDefinition(uri, text, moduleInfo, positionAt = createPositionAt(text)) {
    return {
        name: moduleInfo.name,
        sourceKind: moduleInfo.sourceKind || 'rtl',
        uri,
        nameOffset: moduleInfo.nameOffset,
        endOffset: moduleInfo.endOffset,
        namePosition: positionAt(moduleInfo.nameOffset),
        ports: moduleInfo.ports.map(port => ({
            ...port,
            position: positionAt(port.nameOffset)
        })),
        instances: moduleInfo.instances.map(instance => ({
            ...instance,
            typePosition: positionAt(instance.typeOffset),
            instancePosition: positionAt(instance.instanceNameOffset)
        }))
    };
}

function sortDefinitions(definitions) {
    return definitions.sort((a, b) => {
        const nameOrder = a.name.localeCompare(b.name);
        if (nameOrder) return nameOrder;
        return a.uri.toString().localeCompare(b.uri.toString());
    });
}

function pathAffinity(sourceUri, targetUri) {
    const source = (sourceUri.fsPath || sourceUri.path || '').replace(/\\/g, '/').toLowerCase().split('/');
    const target = (targetUri.fsPath || targetUri.path || '').replace(/\\/g, '/').toLowerCase().split('/');
    let score = 0;
    while (score < source.length && score < target.length && source[score] === target[score]) score++;
    return score;
}

function selectClosestDefinition(definitions, sourceUri) {
    if (!definitions || !definitions.length) return null;
    const rtlDefinitions = definitions.filter(definition => !definition.sourceKind || definition.sourceKind === 'rtl');
    const candidates = rtlDefinitions.length ? rtlDefinitions : definitions;
    let selected = candidates[0];
    let selectedScore = pathAffinity(sourceUri, selected.uri);
    for (let i = 1; i < candidates.length; i++) {
        const score = pathAffinity(sourceUri, candidates[i].uri);
        if (score > selectedScore) {
            selected = candidates[i];
            selectedScore = score;
        }
    }
    return selected;
}

function formatDirectionHint(direction) {
    return direction.padEnd(6, '\u00a0');
}

function formatParameterHint() {
    return formatDirectionHint('param');
}

function continuationHintPositions(document, connection) {
    const start = document.positionAt(connection.expressionStart);
    const end = document.positionAt(connection.expressionEnd);
    const positions = [];
    for (let line = start.line + 1; line <= end.line; line++) {
        const lineText = document.lineAt(line).text;
        const limit = line === end.line ? Math.min(end.character, lineText.length) : lineText.length;
        const candidate = lineText.slice(0, limit);
        const code = candidate.replace(/\/\/.*$/, '');
        if (!/[A-Za-z0-9_$"'~!]/.test(code)) continue;
        const firstToken = /\S/.exec(candidate);
        if (firstToken) positions.push(new vscode.Position(line, firstToken.index));
    }
    return positions;
}

function appendConnectionHints(hints, document, range, connection, label, tooltip) {
    const position = document.positionAt(connection.expressionStart);
    if (range.contains(position)) {
        const hint = new vscode.InlayHint(position, label, vscode.InlayHintKind.Type);
        hint.paddingRight = true;
        hint.tooltip = tooltip;
        hints.push(hint);
    }
    for (const continuation of continuationHintPositions(document, connection)) {
        if (!range.contains(continuation)) continue;
        const continuationHint = new vscode.InlayHint(continuation, label, vscode.InlayHintKind.Type);
        continuationHint.paddingRight = true;
        continuationHint.tooltip = `${tooltip}（多行连接续行）`;
        hints.push(continuationHint);
    }
}

class WorkspaceModuleIndex {
    constructor(findXvlog) {
        this.cache = null;
        this.buildPromise = null;
        this.generation = 0;
        this.findXvlog = findXvlog;
    }

    invalidate() {
        this.cache = null;
        this.generation++;
    }

    async get() {
        if (this.cache) return this.cache;
        if (!this.buildPromise) {
            const generation = this.generation;
            this.buildPromise = this.build().then(index => {
                if (generation === this.generation) this.cache = index;
                return index;
            }).finally(() => {
                this.buildPromise = null;
            });
        }
        return this.buildPromise;
    }

    async build() {
        const uriMap = new Map();
        const files = await vscode.workspace.findFiles(RTL_FILE_GLOB, getIndexExcludeGlob(), getIndexLimit());
        for (const uri of files) uriMap.set(uri.toString(), uri);
        const metadataFiles = await vscode.workspace.findFiles(
            VENDOR_METADATA_GLOB,
            getIndexExcludeGlob(),
            getIndexLimit()
        );
        for (const uri of metadataFiles) uriMap.set(uri.toString(), uri);
        const openDocuments = new Map();
        for (const document of vscode.workspace.textDocuments) {
            if (!isRtlDocument(document)) continue;
            uriMap.set(document.uri.toString(), document.uri);
            openDocuments.set(document.uri.toString(), document);
        }

        const definitions = [];
        let skippedLargeFileCount = 0;
        const uris = [...uriMap.values()].sort((a, b) => a.toString().localeCompare(b.toString()));
        for (const uri of uris) {
            try {
                const document = openDocuments.get(uri.toString());
                if (!document) {
                    const stat = await vscode.workspace.fs.stat(uri);
                    if (stat.size > getIndexMaxFileBytes()) {
                        skippedLargeFileCount++;
                        continue;
                    }
                }
                const text = document
                    ? document.getText()
                    : Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
                const toPosition = document ? offset => document.positionAt(offset) : createPositionAt(text);
                const filePath = uri.fsPath || uri.path || '';
                const metadata = parseVendorMetadata(text, filePath);
                const moduleInfos = metadata ? [metadata] : parseRtlDocument(text).modules;
                for (const moduleInfo of moduleInfos) {
                    definitions.push(asDefinition(uri, text, moduleInfo, toPosition));
                }
            } catch (error) {
                console.warn('Otter workspace index skipped:', uri.toString(), error.message);
            }
        }

        const knownNames = new Set(definitions.map(definition => definition.name));
        if (typeof this.findXvlog === 'function') {
            const unresolvedTypes = new Set();
            for (const definition of definitions) {
                for (const instance of definition.instances) {
                    if (!knownNames.has(instance.typeName)) unresolvedTypes.add(instance.typeName);
                }
            }
            let xvlogPath = null;
            try { xvlogPath = this.findXvlog(); } catch (error) {
                console.warn('Otter Vivado primitive lookup unavailable:', error.message);
            }
            for (const typeName of unresolvedTypes) {
                const sourcePath = findVivadoPrimitiveSource(typeName, xvlogPath);
                if (!sourcePath) continue;
                try {
                    const uri = vscode.Uri.file(sourcePath);
                    const text = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
                    const moduleInfo = parseRtlDocument(text).modules.find(module => module.name === typeName);
                    if (!moduleInfo) continue;
                    definitions.push(asDefinition(uri, text, {
                        ...moduleInfo,
                        sourceKind: 'xilinx-primitive'
                    }));
                    knownNames.add(typeName);
                } catch (error) {
                    console.warn('Otter Vivado primitive skipped:', sourcePath, error.message);
                }
            }
        }

        sortDefinitions(definitions);
        const byName = new Map();
        for (const definition of definitions) {
            const group = byName.get(definition.name) || [];
            group.push(definition);
            byName.set(definition.name, group);
        }
        return {definitions, byName, fileCount: uris.length, skippedLargeFileCount};
    }
}

function definitionLocations(definitions) {
    return definitions.map(definition => new vscode.Location(definition.uri, definition.namePosition));
}

async function provideWorkspaceDefinition(document, position, moduleIndex, findLocalDefinition) {
    const structure = parseRtlDocument(document.getText());
    const reference = findModuleReferenceAtOffset(structure, document.offsetAt(position));
    if (reference) {
        const index = await moduleIndex.get();
        const definitions = index.byName.get(reference.typeName);
        if (definitions && definitions.length) return definitionLocations(definitions);
    }

    const local = findLocalDefinition(document, position);
    if (local) return local;

    const wordRange = document.getWordRangeAtPosition(position, /[A-Za-z_][A-Za-z0-9_$]*/);
    if (!wordRange) return null;
    const word = document.getText(wordRange);
    const index = await moduleIndex.get();
    const definitions = index.byName.get(word);
    return definitions && definitions.length ? definitionLocations(definitions) : null;
}

function localDefinitions(document, structure) {
    const byName = new Map();
    for (const moduleInfo of structure.modules) {
        byName.set(
            moduleInfo.name,
            asDefinition(document.uri, document.getText(), moduleInfo, offset => document.positionAt(offset))
        );
    }
    return byName;
}

class PortDirectionInlayProvider {
    constructor(moduleIndex) {
        this.moduleIndex = moduleIndex;
        this.emitter = new vscode.EventEmitter();
        this.onDidChangeInlayHints = this.emitter.event;
    }

    dispose() {
        this.emitter.dispose();
    }

    refresh() {
        this.emitter.fire();
    }

    async provideInlayHints(document, range, token) {
        const enabled = vscode.workspace.getConfiguration('verilogInstantiate').get('enablePortDirectionHints', true);
        if (!enabled) return [];

        const structure = parseRtlDocument(document.getText());
        const localByName = localDefinitions(document, structure);
        const index = await this.moduleIndex.get();
        if (token.isCancellationRequested) return [];

        const hints = [];
        for (const moduleInfo of structure.modules) {
            for (const instance of moduleInfo.instances) {
                for (const parameter of instance.parameterConnections || []) {
                    appendConnectionHints(
                        hints,
                        document,
                        range,
                        parameter,
                        formatParameterHint(),
                        `${instance.typeName}.${parameter.portName} — parameter`
                    );
                }
                const definition = localByName.get(instance.typeName)
                    || selectClosestDefinition(index.byName.get(instance.typeName), document.uri);
                if (!definition) continue;
                const ports = new Map(definition.ports.map(port => [port.name, port]));
                for (const connection of instance.connections) {
                    const port = ports.get(connection.portName);
                    if (!port) continue;
                    appendConnectionHints(
                        hints,
                        document,
                        range,
                        connection,
                        formatDirectionHint(port.direction),
                        `${instance.typeName}.${connection.portName} — ${port.direction}`
                    );
                }
            }
        }
        return hints;
    }
}

function moduleHasChildren(definition, index) {
    return definition.instances.some(instance => index.byName.has(instance.typeName));
}

function moduleLocationCommand(definition) {
    const selection = new vscode.Range(definition.namePosition, definition.namePosition);
    return {
        command: 'vscode.open',
        title: '打开模块定义',
        arguments: [definition.uri, {selection}]
    };
}

class ModuleHierarchyProvider {
    constructor(moduleIndex) {
        this.moduleIndex = moduleIndex;
        this.emitter = new vscode.EventEmitter();
        this.onDidChangeTreeData = this.emitter.event;
    }

    dispose() {
        this.emitter.dispose();
    }

    refresh() {
        this.emitter.fire();
    }

    getActiveDefinition() {
        const editor = vscode.window.activeTextEditor;
        if (!editor || !isRtlDocument(editor.document)) return null;
        const text = editor.document.getText();
        const structure = parseRtlDocument(text);
        const offset = editor.document.offsetAt(editor.selection.active);
        const moduleInfo = structure.modules.find(module => offset >= module.nameOffset && offset <= module.endOffset)
            || structure.modules[0];
        return moduleInfo
            ? asDefinition(editor.document.uri, text, moduleInfo, value => editor.document.positionAt(value))
            : null;
    }

    getTreeItem(element) {
        const state = element.hasChildren && !element.cycle
            ? vscode.TreeItemCollapsibleState.Collapsed
            : vscode.TreeItemCollapsibleState.None;
        const label = element.kind === 'module'
            ? element.definition.name
            : `${element.instance.instanceName} : ${element.instance.typeName}`;
        const item = new vscode.TreeItem(label, state);
        item.description = path.basename(element.definition.uri.fsPath || element.definition.uri.path);
        item.tooltip = `${label}\n${element.definition.uri.fsPath || element.definition.uri.toString()}`;
        item.command = moduleLocationCommand(element.definition);
        item.contextValue = element.kind === 'module' ? 'otterModule' : 'otterInstance';
        item.iconPath = new vscode.ThemeIcon(element.kind === 'module' ? 'symbol-class' : 'symbol-field');
        return item;
    }

    getParent(element) {
        return element.parent;
    }

    async getChildren(element) {
        const index = await this.moduleIndex.get();
        if (!element) {
            const definition = this.getActiveDefinition();
            if (!definition) return [];
            return [{
                kind: 'module',
                definition,
                ancestry: [definition.name],
                cycle: false,
                hasChildren: moduleHasChildren(definition, index)
            }];
        }

        if (element.cycle) return [];
        const children = [];
        for (const instance of element.definition.instances) {
            const definition = selectClosestDefinition(index.byName.get(instance.typeName), element.definition.uri);
            if (!definition) continue;
            const cycle = element.ancestry.includes(definition.name);
            children.push({
                kind: 'instance',
                definition,
                instance,
                parent: element,
                ancestry: [...element.ancestry, definition.name],
                cycle,
                hasChildren: !cycle && moduleHasChildren(definition, index)
            });
        }
        return children.sort((a, b) => a.instance.instanceName.localeCompare(b.instance.instanceName));
    }
}

function registerWorkspaceFeatures(context, findLocalDefinition, findXvlog) {
    const moduleIndex = new WorkspaceModuleIndex(findXvlog);
    const inlayProvider = new PortDirectionInlayProvider(moduleIndex);
    const hierarchyProvider = new ModuleHierarchyProvider(moduleIndex);
    let hierarchyRefreshTimer = null;
    const scheduleHierarchyRefresh = () => {
        if (hierarchyRefreshTimer) clearTimeout(hierarchyRefreshTimer);
        hierarchyRefreshTimer = setTimeout(() => {
            hierarchyRefreshTimer = null;
            hierarchyProvider.refresh();
        }, 100);
    };
    const refresh = () => {
        moduleIndex.invalidate();
        inlayProvider.refresh();
        hierarchyProvider.refresh();
    };

    context.subscriptions.push(inlayProvider, hierarchyProvider);
    context.subscriptions.push(vscode.languages.registerDefinitionProvider(RTL_SELECTOR, {
        provideDefinition(document, position) {
            return provideWorkspaceDefinition(document, position, moduleIndex, findLocalDefinition);
        }
    }));
    context.subscriptions.push(vscode.languages.registerInlayHintsProvider(RTL_SELECTOR, inlayProvider));
    const hierarchyView = vscode.window.createTreeView(HIERARCHY_VIEW_ID, {
        treeDataProvider: hierarchyProvider,
        showCollapseAll: true
    });
    context.subscriptions.push(hierarchyView);
    context.subscriptions.push(vscode.commands.registerCommand('verilog-instantiate.showHierarchy', async () => {
        const roots = await hierarchyProvider.getChildren();
        if (!roots.length) {
            vscode.window.showInformationMessage('当前编辑器没有可显示的 Verilog/SystemVerilog module');
            return;
        }
        hierarchyProvider.refresh();
        await hierarchyView.reveal(roots[0], {select: true, focus: true, expand: 1});
    }));
    context.subscriptions.push(vscode.commands.registerCommand('verilog-instantiate.refreshHierarchy', refresh));

    const watcher = vscode.workspace.createFileSystemWatcher(RTL_FILE_GLOB);
    const metadataWatcher = vscode.workspace.createFileSystemWatcher(VENDOR_METADATA_GLOB);
    context.subscriptions.push(
        watcher,
        watcher.onDidCreate(refresh),
        watcher.onDidChange(refresh),
        watcher.onDidDelete(refresh),
        metadataWatcher,
        metadataWatcher.onDidCreate(refresh),
        metadataWatcher.onDidChange(refresh),
        metadataWatcher.onDidDelete(refresh),
        vscode.workspace.onDidSaveTextDocument(document => {
            if (isRtlDocument(document) || isVendorMetadataDocument(document)) refresh();
        }),
        vscode.workspace.onDidChangeWorkspaceFolders(refresh),
        vscode.window.onDidChangeActiveTextEditor(scheduleHierarchyRefresh),
        vscode.window.onDidChangeTextEditorSelection(scheduleHierarchyRefresh),
        vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration('verilogInstantiate.enablePortDirectionHints')) inlayProvider.refresh();
            if (event.affectsConfiguration('verilogInstantiate.workspaceIndexMaxFiles')
                || event.affectsConfiguration('verilogInstantiate.workspaceIndexMaxFileSizeKB')
                || event.affectsConfiguration('verilogInstantiate.workspaceIndexExclude')) refresh();
        }),
        {dispose() { if (hierarchyRefreshTimer) clearTimeout(hierarchyRefreshTimer); }}
    );

    return {moduleIndex, inlayProvider, hierarchyProvider, hierarchyView, refresh};
}

module.exports = {
    HIERARCHY_VIEW_ID,
    ModuleHierarchyProvider,
    PortDirectionInlayProvider,
    WorkspaceModuleIndex,
    provideWorkspaceDefinition,
    registerWorkspaceFeatures,
    selectClosestDefinition,
    formatDirectionHint,
    formatParameterHint,
    continuationHintPositions
};
