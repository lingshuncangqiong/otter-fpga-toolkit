'use strict';

const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const {getWebviewHtml} = require('./wavedrom-view');
const {maskNonCode, parseRtlDocument} = require('./rtl-parser');
const { findAllWaveDromBlocks, findWaveDromAtLine, parseWaveDromSource } = require('./wavedrom-parser');
const { renderFromText } = require('./wavedrom-service');

let currentPanel = null;
let lastRenderedBlock = null;
let previewDocument = null;
let updateDebounceTimer = null;
let isJumpingToSignal = false;
let jumpSuppressTimer = null;
let sourceColumn = null;
let panelReady = false;
let pendingUpdate = null;
let revision = 0;
let previewLine = 0;

async function resolveDocument(ref) {
    if (!ref) return (vscode.window && vscode.window.activeTextEditor && vscode.window.activeTextEditor.document) || null;
    if (typeof ref === 'string') {
        try {
            return await vscode.workspace.openTextDocument(vscode.Uri.parse(ref));
        } catch {
            vscode.window.showWarningMessage('无法打开波形所属文件，不会改用其它活动文件');
            return null;
        }
    }
    return ref;
}

function commandLink(command, document, block) {
    const uriStr = document && document.uri ? document.uri.toString() : '';
    const startLine = block ? block.startLine : 0;
    return 'command:' + command + '?' + encodeURIComponent(JSON.stringify([uriStr, startLine]));
}

/**
 * 在 RTL 代码中定位波形信号对应的端口或信号声明
 * @param {string} content RTL 源码内容
 * @param {string} signalNameText 波形中的信号名标签 (例如 "PCLK (100MHz)", "PADDR / PWDATA", "i_pixel_sof (SOF)")
 * @returns {{ line: number, character: number, token: string, kind: string, text: string } | null}
 */
function findSignalInDocument(content, signalNameText) {
    if (!content || !signalNameText) return null;
    const originalLines = content.split(/\r?\n/);
    const masked = maskNonCode(content);
    const lines = masked.split(/\r?\n/);
    const tokens = signalNameText.match(/[a-zA-Z_][a-zA-Z0-9_]*/g) || [];
    if (tokens.length === 0) return null;

    const isPrefix = signalNameText.includes('*');
    const ignoreWords = new Set(['MHz', 'KHz', 'Hz', 'Active', 'Shadow', 'OLD', 'NEW', 'FRAME', 'CFG', 'clk', 'CLK']);
    const candidateTokens = tokens.filter(t => !ignoreWords.has(t) && t.length > 1);
    if (candidateTokens.length === 0 && tokens.length > 0) {
        candidateTokens.push(tokens[0]);
    }

    // Reuse the RTL parser for multiline ANSI ports and exact declaration offsets.
    const ports = parseRtlDocument(content).modules.flatMap(mod => mod.ports);
    for (const token of candidateTokens) {
        const port = ports.find(item => item.name === token);
        if (port) {
            const before = content.slice(0, port.nameOffset);
            const line = before.split('\n').length - 1;
            return {line, character:port.nameOffset - before.lastIndexOf('\n') - 1, token:port.name,
                kind:'port', text:originalLines[line].trim()};
        }
    }
    // 2. 匹配寄存器 / 连线声明 (reg / wire / logic)
    for (const token of candidateTokens) {
        const declRegex = new RegExp(`\\b(reg|wire|logic)\\b[^;\\/]*?\\b(${token})\\b`);
        for (let i = 0; i < lines.length; i++) {
            const match = lines[i].match(declRegex);
            if (match) {
                const col = lines[i].indexOf(match[2]);
                return { line: i, character: col >= 0 ? col : 0, token: match[2], kind: 'decl', text: originalLines[i].trim() };
            }
        }
    }

    // 3. 通配符或前缀匹配 (例如 r_cfg_* 或 ro_pipe_*)
    if (isPrefix) {
        for (const token of candidateTokens) {
            const prefixRegex = new RegExp(`\\b(input|output|inout|reg|wire|logic)\\b[^;\\/]*?\\b(${token}\\w*)\\b`);
            for (let i = 0; i < lines.length; i++) {
                const match = lines[i].match(prefixRegex);
                if (match) {
                    const col = lines[i].indexOf(match[2]);
                    return { line: i, character: col >= 0 ? col : 0, token: match[2], kind: 'prefix', text: originalLines[i].trim() };
                }
            }
        }
    }

    // 4. 兜底匹配任意标识符声明或赋值行
    for (const token of candidateTokens) {
        const anyRegex = new RegExp(`\\b(${token})\\b`);
        for (let i = 0; i < lines.length; i++) {
            const match = lines[i].match(anyRegex);
            if (match && !lines[i].trim().startsWith('//')) {
                const col = lines[i].indexOf(match[1]);
                return { line: i, character: col >= 0 ? col : 0, token: match[1], kind: 'any', text: originalLines[i].trim() };
            }
        }
    }

    return null;
}

/**
 * 跳转并高亮左侧 RTL 编辑器中的对应信号行
 * @param {vscode.TextDocument|string} document
 * @param {string} signalName
 */
async function jumpToSignalInEditor(document, signalName) {
    if (!document || !signalName) return null;
    const doc = await resolveDocument(document);
    if (!doc) return null;

    const content = typeof doc.getText === 'function' ? doc.getText() : '';
    const result = findSignalInDocument(content, signalName);
    if (!result) {
        if (vscode.window && vscode.window.setStatusBarMessage && /[a-zA-Z_]{2,}/.test(signalName)) {
            vscode.window.setStatusBarMessage(`$(info) 未在 RTL 源码中找到与 "${signalName}" 匹配的端口或信号`, 2500);
        }
        return null;
    }

    // 查找包含该文档的可见编辑器
    const visibleEditors = (vscode.window && vscode.window.visibleTextEditors) || [];
    let targetEditor = visibleEditors.find(ed =>
        ed.document && doc.uri && ed.document.uri.toString() === doc.uri.toString()
    ) || null;

    if (!targetEditor && vscode.window && vscode.window.showTextDocument) {
        targetEditor = await vscode.window.showTextDocument(doc, {
            viewColumn: sourceColumn || vscode.ViewColumn.One,
            preserveFocus: true
        });
    }

    if (targetEditor) {
        const pos = new vscode.Position(result.line, result.character);
        const endPos = new vscode.Position(result.line, result.character + result.token.length);
        targetEditor.selection = new vscode.Selection(pos, endPos);
        if (typeof targetEditor.revealRange === 'function') {
            targetEditor.revealRange(
                new vscode.Range(pos, endPos),
                (vscode.TextEditorRevealType && vscode.TextEditorRevealType.InCenter) || 2
            );
        }
        if (vscode.window && vscode.window.setStatusBarMessage) {
            const label = result.kind === 'port' ? '端口' : '定义';
            vscode.window.setStatusBarMessage(`$(arrow-right) 已定位至 RTL ${label}: ${result.token} (Line ${result.line + 1})`, 3500);
        }
    }

    return result;
}

/**
 * 纯内存的紧凑悬停入口，不在悬停时渲染大图
 * @param {vscode.TextDocument} document
 * @param {object} block
 * @returns {vscode.Hover}
 */
function createWaveformHover(document, block) {
    const parsed = parseWaveDromSource(block.rawContent);
    const md = new vscode.MarkdownString();
    if (!parsed.ok) md.appendText('WaveDrom 解析提示：' + parsed.error);
    else {
        md.isTrusted = {enabledCommands:['otter-fpga-toolkit.previewWaveform','otter-fpga-toolkit.previewWaveformPanel','otter-fpga-toolkit.exportWaveformSvg']};
        md.appendMarkdown(`**WaveDrom 时序波形** · Line ${block.startLine + 1} - ${block.endLine + 1}\n\n`);
        md.appendMarkdown(`[查看波形 (Alt+W)](${commandLink('otter-fpga-toolkit.previewWaveform',document,block)}) · ` +
            `[并排查看](${commandLink('otter-fpga-toolkit.previewWaveformPanel',document,block)}) · ` +
            `[导出 SVG](${commandLink('otter-fpga-toolkit.exportWaveformSvg',document,block)})`);
    }
    return new vscode.Hover(md,new vscode.Range(block.startLine,0,block.endLine,document.lineAt(block.endLine).text.length));
}

/**
 * 更新 Webview 内容
 * @param {vscode.TextDocument} document
 * @param {number} [lineIndex]
 */
function updatePreviewContent(document, lineIndex, options = {}) {
    if (!currentPanel || !document) return;
    currentPanel.title = '时序图 · ' + path.basename(document.fileName || document.uri.fsPath || 'WaveDrom');
    const line = typeof lineIndex === 'number' ? lineIndex : previewLine;
    const sameDocument = previewDocument && previewDocument.uri.toString() === document.uri.toString();
    const blocks = findAllWaveDromBlocks(document);
    let target = blocks.find(block => line >= block.startLine && line <= block.endLine);
    if (!target && sameDocument && lastRenderedBlock && !options.exactLine) {
        target = blocks.find(block => block.rawContent === lastRenderedBlock.rawContent)
            || blocks.find(block => block.startLine === lastRenderedBlock.startLine);
    }
    if (!target && !sameDocument && !options.exactLine) target = blocks[0];
    previewDocument = document;
    previewLine = target ? target.startLine : line;
    if (sameDocument && target && lastRenderedBlock && target.startLine === lastRenderedBlock.startLine
        && target.endLine === lastRenderedBlock.endLine && target.rawContent === lastRenderedBlock.rawContent) return;
    const reset = !sameDocument || !lastRenderedBlock ||
        (target && target.startLine !== lastRenderedBlock.startLine && !options.preserveView);
    lastRenderedBlock = target || null;
    const result = target ? renderFromText(target.rawContent) : {ok:false,error:'当前波形块已移除或围栏尚未闭合。'};
    const frame = {command:'updateWaveform', revision:++revision, svg:result.ok ? result.svg : '',
        lineInfo:target ? `Line ${target.startLine + 1} - ${target.endLine + 1}` : '',
        error:result.ok ? null : result.error, resetTransform:reset};
    if (!currentPanel.__isInitialized) {
        currentPanel.__isInitialized = true;
        panelReady = false;
        pendingUpdate = null;
        currentPanel.webview.html = getWebviewHtml(frame.svg, target, frame.error, revision);
    } else if (panelReady) {
        currentPanel.webview.postMessage(frame);
    } else {
        pendingUpdate = frame;
    }
}

/**
 * 打开或唤起侧边栏实时波形预览面板 (默认打开至右侧分栏 ViewColumn.Beside)
 * @param {vscode.ExtensionContext} context
 * @param {vscode.TextDocument} [doc]
 * @param {number} [line]
 */
async function openWaveformPanel(context, doc, line, beside = true) {
    const editor = vscode.window.activeTextEditor;
    const document = await resolveDocument(doc);
    if (!document) {
        if (vscode.window.showWarningMessage) {
            vscode.window.showWarningMessage('请先打开包含 WaveDrom 注释的文件');
        }
        return;
    }

    const currentLine = (typeof line === 'number') ? line :
        (editor && editor.document.uri.toString() === document.uri.toString() ? editor.selection.active.line : 0);
    const matchingEditor = (vscode.window.visibleTextEditors || []).find(ed => ed.document.uri.toString() === document.uri.toString());
    sourceColumn = (matchingEditor && matchingEditor.viewColumn) || sourceColumn || vscode.ViewColumn.One;

    if (currentPanel) {
        currentPanel.reveal(beside ? vscode.ViewColumn.Beside : (currentPanel.viewColumn || sourceColumn));
        updatePreviewContent(document, currentLine);
        return;
    }

    currentPanel = vscode.window.createWebviewPanel(
        'otterWaveformPreview',
        '时序波形 (WaveDrom)',
        beside ? vscode.ViewColumn.Beside : sourceColumn,
        {
            enableScripts: true,
            retainContextWhenHidden: true
        }
    );

    currentPanel.onDidDispose(() => {
        currentPanel = null;
        lastRenderedBlock = null;
        previewDocument = null;
        panelReady = false;
        pendingUpdate = null;
        isJumpingToSignal = false;
        clearTimeout(updateDebounceTimer);
        if (jumpSuppressTimer) clearTimeout(jumpSuppressTimer);
    }, null, context.subscriptions);

    const panel = currentPanel;
    currentPanel.webview.onDidReceiveMessage(async (msg) => {
        if (currentPanel !== panel) return;
        if (msg.command === 'ready') {
            panelReady = true;
            if (pendingUpdate) { panel.webview.postMessage(pendingUpdate); pendingUpdate = null; }
            return;
        }
        if (msg.revision !== revision) return;
        if (msg.command === 'showBeside') {
            if (panel.viewColumn === sourceColumn || !panel.viewColumn) panel.reveal(vscode.ViewColumn.Beside);
            if (previewDocument) await vscode.window.showTextDocument(previewDocument, {viewColumn:sourceColumn,preserveFocus:true});
            return;
        }
        if (msg.command === 'copySvg') {
            if (lastRenderedBlock) {
                const res = renderFromText(lastRenderedBlock.rawContent);
                if (res.ok) {
                    await vscode.env.clipboard.writeText(res.svg);
                    if (vscode.window.showInformationMessage) {
                        vscode.window.showInformationMessage('SVG 源码已复制到剪贴板！');
                    }
                }
            }
        } else if (msg.command === 'exportSvg') {
            if (previewDocument && lastRenderedBlock) {
                await exportCurrentWaveformSvg(previewDocument, lastRenderedBlock.startLine);
            }
        } else if (msg.command === 'jumpToSignal') {
            if (previewDocument && msg.signalName) {
                isJumpingToSignal = true;
                if (jumpSuppressTimer) clearTimeout(jumpSuppressTimer);
                jumpSuppressTimer = setTimeout(() => {
                    isJumpingToSignal = false;
                }, 600);
                try {
                    await jumpToSignalInEditor(previewDocument, msg.signalName);
                } finally {
                    if (jumpSuppressTimer) clearTimeout(jumpSuppressTimer);
                    jumpSuppressTimer = setTimeout(() => {
                        isJumpingToSignal = false;
                    }, 600);
                }
            }
        }
    }, null, context.subscriptions);

    updatePreviewContent(document, currentLine);
}

/**
 * 默认在当前编辑区域打开波形页签；并排查看是独立选择
 * @param {vscode.ExtensionContext} context
 * @param {vscode.TextDocument} [ref]
 * @param {number} [line]
 */
async function openWaveformPreview(context, ref, line) {
    return openWaveformPanel(context, ref, line, false);
}

/**
 * 导出当前波形为 SVG 文件
 * @param {vscode.TextDocument} document
 * @param {number} [line]
 */
async function exportCurrentWaveformSvg(document, line) {
    const editor = vscode.window.activeTextEditor;
    const doc = await resolveDocument(document);
    if (!doc) return;

    const currentLine = (typeof line === 'number') ? line : (editor ? editor.selection.active.line : 0);
    const targetBlock = findWaveDromAtLine(doc, currentLine) || (findAllWaveDromBlocks(doc)[0]);
    if (!targetBlock) {
        if (vscode.window.showWarningMessage) {
            vscode.window.showWarningMessage('未找到可导出的 WaveDrom 时序块');
        }
        return;
    }

    const res = renderFromText(targetBlock.rawContent);
    if (!res.ok) {
        if (vscode.window.showErrorMessage) {
            vscode.window.showErrorMessage('WaveDrom 解析失败，无法导出: ' + res.error);
        }
        return;
    }

    const baseName = doc.uri ? path.parse(doc.uri.fsPath).name : 'waveform';
    const defaultUri = doc.uri ? vscode.Uri.file(path.join(path.dirname(doc.uri.fsPath), `${baseName}_wave.svg`)) : undefined;

    const targetUri = await vscode.window.showSaveDialog({
        defaultUri: defaultUri,
        filters: { 'SVG 矢量图形': ['svg'] }
    });

    if (targetUri) {
        fs.writeFileSync(targetUri.fsPath, res.svg, 'utf8');
        if (vscode.window.showInformationMessage) {
            vscode.window.showInformationMessage(`已成功导出 SVG 至: ${path.basename(targetUri.fsPath)}`);
        }
    }
}

/**
 * 在扩展激活时注册所有 WaveDrom 相关的提供者与命令
 * @param {vscode.ExtensionContext} context
 */
function registerWaveDromFeatures(context) {
    const supportedLangs = ['verilog', 'systemverilog', 'markdown'];
    context.subscriptions.push({
        dispose() {
            clearTimeout(updateDebounceTimer);
            if (jumpSuppressTimer) clearTimeout(jumpSuppressTimer);
        }
    });

    // 1. 悬停提示：纯内存无落盘、轻量非打扰
    context.subscriptions.push(vscode.languages.registerHoverProvider(supportedLangs, {
        provideHover(document, position) {
            const block = findWaveDromAtLine(document, position.line);
            if (!block) return null;
            return createWaveformHover(document, block);
        }
    }));

    // 2. CodeLens：默认当前编辑区域打开，保留可选并排命令
    context.subscriptions.push(vscode.languages.registerCodeLensProvider(supportedLangs, {
        provideCodeLenses(document) {
            const blocks = findAllWaveDromBlocks(document);
            const lenses = [];
            for (const block of blocks) {
                const range = new vscode.Range(block.startLine, 0, block.startLine, 0);
                lenses.push(new vscode.CodeLens(range, {
                    title: '$(graph) 查看时序图 (Alt+W)',
                    command: 'otter-fpga-toolkit.previewWaveform',
                    arguments: [document.uri.toString(), block.startLine]
                }));
                lenses.push(new vscode.CodeLens(range, {
                    title: '⬇ 导出 SVG',
                    command: 'otter-fpga-toolkit.exportWaveformSvg',
                    arguments: [document.uri.toString(), block.startLine]
                }));
            }
            return lenses;
        }
    }));

    // 3. 默认同区域；显式panel命令并排打开
    context.subscriptions.push(vscode.commands.registerCommand('otter-fpga-toolkit.previewWaveform', (doc, line) => {
        return openWaveformPanel(context, doc, line, false);
    }));

    context.subscriptions.push(vscode.commands.registerCommand('otter-fpga-toolkit.previewWaveformPanel', (doc, line) => {
        return openWaveformPanel(context, doc, line);
    }));

    context.subscriptions.push(vscode.commands.registerCommand('otter-fpga-toolkit.exportWaveformSvg', (doc, line) => {
        return exportCurrentWaveformSvg(doc, line);
    }));

    // 4. 实时热重载：监听编辑器光标变动与文本变动
    context.subscriptions.push(vscode.window.onDidChangeTextEditorSelection((event) => {
        if (!currentPanel) return;
        if (isJumpingToSignal) return; // 抑制由点击信号跳转产生的光标变化事件，避免波形跳动与重载
        if (!supportedLangs.includes(event.textEditor.document.languageId)) return;
        if (previewDocument && event.textEditor.document.uri.toString() !== previewDocument.uri.toString()
            && !findWaveDromAtLine(event.textEditor.document, event.selections[0].active.line)) return;

        if (updateDebounceTimer) clearTimeout(updateDebounceTimer);
        updateDebounceTimer = setTimeout(() => {
            if (isJumpingToSignal) return;
            updatePreviewContent(event.textEditor.document, event.selections[0].active.line);
        }, 120);
    }));

    context.subscriptions.push(vscode.workspace.onDidChangeTextDocument((event) => {
        if (!currentPanel) return;
        if (!supportedLangs.includes(event.document.languageId)) return;
        if (!previewDocument || event.document.uri.toString() !== previewDocument.uri.toString()) return;

        if (updateDebounceTimer) clearTimeout(updateDebounceTimer);
        const oldLine = previewLine;
        previewLine += (event.contentChanges || []).reduce((delta, change) =>
            change.range.end.line <= oldLine ? delta + change.text.split(/\r?\n/).length - 1
                - (change.range.end.line - change.range.start.line) : delta, 0);
        updateDebounceTimer = setTimeout(() => {
            updatePreviewContent(event.document, previewLine, {exactLine:true, preserveView:true});
        }, 150);
    }));
}

module.exports = {
    registerWaveDromFeatures,
    openWaveformPreview,
    openWaveformPanel,
    createWaveformHover,
    exportCurrentWaveformSvg,
    getWebviewHtml,
    findSignalInDocument,
    jumpToSignalInEditor,
    __test: {
        getWebviewHtml,
        findSignalInDocument,
        jumpToSignalInEditor,
        updatePreviewContent,
        currentRevision: () => revision,
        panelReady: () => panelReady,
        isJumpingToSignal: () => isJumpingToSignal
    }
};
