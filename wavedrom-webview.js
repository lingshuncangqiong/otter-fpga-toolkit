'use strict';

const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { findAllWaveDromBlocks, findWaveDromAtLine } = require('./wavedrom-parser');
const { renderFromText } = require('./wavedrom-service');

let currentPanel = null;
let lastRenderedBlock = null;
let previewDocument = null;
let updateDebounceTimer = null;
let hoverDirectory = null;
const hoverImages = new Map();

function hoverImageUri(svg) {
    // MarkdownString truncates large embedded data URLs. Keep generated images
    // outside the source workspace and give the native hover a short local URI.
    if (!hoverDirectory) hoverDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'otter-waveform-'));
    const key = crypto.createHash('sha256').update(svg).digest('hex');
    let filename = hoverImages.get(key);
    if (!filename) {
        filename = path.join(hoverDirectory, key + '.svg');
        fs.writeFileSync(filename, svg, 'utf8');
        hoverImages.set(key, filename);
        if (hoverImages.size > 32) {
            const [oldKey, oldFile] = hoverImages.entries().next().value;
            fs.unlinkSync(oldFile);
            hoverImages.delete(oldKey);
        }
    }
    return vscode.Uri.file(filename).toString();
}

function disposeHoverImages() {
    for (const filename of hoverImages.values()) {
        try { fs.unlinkSync(filename); } catch { /* image may already be gone */ }
    }
    hoverImages.clear();
    if (hoverDirectory) {
        try { fs.rmdirSync(hoverDirectory); } catch { /* never recursively remove unknown files */ }
        hoverDirectory = null;
    }
}

function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, ch => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[ch]));
}

async function resolveDocument(ref) {
    if (typeof ref === 'string') return vscode.workspace.openTextDocument(vscode.Uri.parse(ref));
    return ref || (vscode.window.activeTextEditor && vscode.window.activeTextEditor.document);
}

function commandLink(command, document, block) {
    return 'command:' + command + '?' + encodeURIComponent(JSON.stringify([document.uri.toString(), block.startLine]));
}

function createWaveformHover(document, block) {
    const result = renderFromText(block.rawContent);
    const md = new vscode.MarkdownString();
    if (!result.ok) {
        md.appendText('WaveDrom 解析失败：' + result.error);
    } else {
        md.supportHtml = true;
        md.isTrusted = {enabledCommands: ['otter-fpga-toolkit.previewWaveformPanel', 'otter-fpga-toolkit.exportWaveformSvg']};
        md.appendMarkdown('**WaveDrom 时序图** · Esc 关闭\n\n');
        md.appendMarkdown('![时序波形](' + hoverImageUri(result.svg) + ')\n\n');
        md.appendMarkdown('[打开大图](' + commandLink('otter-fpga-toolkit.previewWaveformPanel', document, block) + ') · ' +
            '[导出 SVG](' + commandLink('otter-fpga-toolkit.exportWaveformSvg', document, block) + ')');
    }
    return new vscode.Hover(md, new vscode.Range(block.startLine, 0, block.endLine, document.lineAt(block.endLine).text.length));
}

async function openWaveformPreview(ref, line) {
    const document = await resolveDocument(ref);
    if (!document) {
        vscode.window.showWarningMessage('请先打开包含 WaveDrom 注释的文件');
        return;
    }
    let editor = vscode.window.activeTextEditor;
    const selected = typeof line === 'number' ? line :
        (editor && editor.document.uri.toString() === document.uri.toString() ? editor.selection.active.line : 0);
    const block = findWaveDromAtLine(document, selected) || findAllWaveDromBlocks(document)[0];
    if (!block) {
        vscode.window.showWarningMessage('当前文档未找到 WaveDrom 时序块');
        return;
    }
    if (!editor || editor.document.uri.toString() !== document.uri.toString()) {
        editor = await vscode.window.showTextDocument(document, {preview: false});
    }
    const position = new vscode.Position(block.startLine, document.lineAt(block.startLine).firstNonWhitespaceCharacterIndex || 0);
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    await vscode.commands.executeCommand('editor.action.showHover', {focus: true});
}

/**
 * 生成 Webview 的完整 HTML
 * @param {string} svg
 * @param {object|null} block
 * @param {string|null} error
 * @returns {string}
 */
function getWebviewHtml(svg, block, error) {
    const nonce = crypto.randomBytes(18).toString('base64');
    const lineInfo = block ? `Line ${block.startLine + 1} - ${block.endLine + 1}` : '';
    const safeSvg = svg ? `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}` : '';
    const errorHtml = error ? `
        <div class="error-container">
            <div class="error-title">⚠️ WaveDrom 语法解析提示</div>
            <div class="error-msg">${escapeHtml(error)}</div>
        </div>
    ` : '';

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>WaveDrom 时序波形实时预览</title>
    <style>
        :root {
            --bg-color: var(--vscode-editor-background, #1e1e1e);
            --fg-color: var(--vscode-editor-foreground, #cccccc);
            --border-color: var(--vscode-panel-border, #333333);
            --btn-bg: var(--vscode-button-secondaryBackground, #3a3d41);
            --btn-fg: var(--vscode-button-secondaryForeground, #ffffff);
            --btn-hover: var(--vscode-button-secondaryHoverBackground, #45494e);
        }
        body {
            margin: 0;
            padding: 0;
            background-color: var(--bg-color);
            color: var(--fg-color);
            font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif);
            display: flex;
            flex-direction: column;
            height: 100vh;
            overflow: hidden;
        }
        .toolbar {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 8px 16px;
            background: rgba(128, 128, 128, 0.08);
            border-bottom: 1px solid var(--border-color);
            user-select: none;
        }
        .toolbar-left {
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .title-badge {
            font-weight: 600;
            font-size: 13px;
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .line-badge {
            font-size: 11px;
            padding: 2px 8px;
            border-radius: 10px;
            background: rgba(128, 128, 128, 0.2);
            color: var(--fg-color);
        }
        .toolbar-right {
            display: flex;
            align-items: center;
            gap: 8px;
        }
        button {
            background: var(--btn-bg);
            color: var(--btn-fg);
            border: none;
            padding: 4px 10px;
            border-radius: 3px;
            cursor: pointer;
            font-size: 12px;
            display: inline-flex;
            align-items: center;
            gap: 4px;
        }
        button:hover {
            background: var(--btn-hover);
        }
        .viewer-container {
            flex: 1;
            overflow: auto;
            display: flex;
            align-items: flex-start;
            justify-content: flex-start;
            padding: 24px;
            background-image: radial-gradient(rgba(128, 128, 128, 0.15) 1px, transparent 0);
            background-size: 16px 16px;
        }
        .svg-wrapper {
            transition: transform 0.15s ease-out;
            transform-origin: center center;
            background: #ffffff;
            padding: 16px 24px;
            border-radius: 6px;
            box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
            flex-shrink: 0;
            overflow: visible;
        }
        .error-container {
            padding: 16px 20px;
            background: rgba(235, 87, 87, 0.12);
            border: 1px solid rgba(235, 87, 87, 0.4);
            border-radius: 6px;
            max-width: 80%;
        }
        .error-title {
            color: #eb5757;
            font-weight: 600;
            margin-bottom: 6px;
            font-size: 13px;
        }
        .error-msg {
            font-family: var(--vscode-editor-font-family, monospace);
            font-size: 12px;
            white-space: pre-wrap;
        }
    </style>
</head>
<body>
    <div class="toolbar">
        <div class="toolbar-left">
            <span class="title-badge">🌊 WaveDrom 时序波形</span>
            ${lineInfo ? `<span class="line-badge">${lineInfo}</span>` : ''}
        </div>
        <div class="toolbar-right">
            <button id="zoomIn">放大 (+)</button>
            <button id="zoomOut">缩小 (-)</button>
            <button id="zoomReset">100%</button>
            <button id="copySvg">复制 SVG</button>
            <button id="exportSvg">导出文件</button>
        </div>
    </div>
    <div class="viewer-container" id="viewer">
        ${error ? errorHtml : `<div class="svg-wrapper" id="svgTarget"><img src="${safeSvg}" alt="WaveDrom 时序图"></div>`}
    </div>

    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();
        let scale = 1.0;
        const svgTarget = document.getElementById('svgTarget');

        function updateTransform() {
            if (svgTarget) {
                svgTarget.style.zoom = scale;
            }
        }

        document.getElementById('zoomIn')?.addEventListener('click', () => {
            scale = Math.min(scale + 0.15, 3.0);
            updateTransform();
        });
        document.getElementById('zoomOut')?.addEventListener('click', () => {
            scale = Math.max(scale - 0.15, 0.4);
            updateTransform();
        });
        document.getElementById('zoomReset')?.addEventListener('click', () => {
            scale = 1.0;
            updateTransform();
        });
        document.getElementById('copySvg')?.addEventListener('click', () => {
            vscode.postMessage({ command: 'copySvg' });
        });
        document.getElementById('exportSvg')?.addEventListener('click', () => {
            vscode.postMessage({ command: 'exportSvg' });
        });
    </script>
</body>
</html>`;
}

/**
 * 更新 Webview 内容
 * @param {vscode.TextDocument} document
 * @param {number} [lineIndex]
 */
function updatePreviewContent(document, lineIndex) {
    if (!currentPanel || !document) return;

    const line = (typeof lineIndex === 'number')
        ? lineIndex
        : (vscode.window.activeTextEditor && vscode.window.activeTextEditor.selection.active.line) || 0;

    previewDocument = document;
    lastRenderedBlock = null;
    let targetBlock = findWaveDromAtLine(document, line);

    // 如果光标不在块内，取全文档第一个块
    if (!targetBlock) {
        const allBlocks = findAllWaveDromBlocks(document);
        if (allBlocks.length > 0) {
            targetBlock = allBlocks[0];
        }
    }

    if (!targetBlock) {
        currentPanel.webview.html = getWebviewHtml('', null, '当前文档未检测到 WaveDrom 时序代码块。\n在注释中加入 // ```wavedrom ... // ``` 即可实时呈现。');
        return;
    }

    lastRenderedBlock = targetBlock;
    const res = renderFromText(targetBlock.rawContent);
    if (res.ok) {
        currentPanel.webview.html = getWebviewHtml(res.svg, targetBlock, null);
    } else {
        currentPanel.webview.html = getWebviewHtml('', targetBlock, res.error);
    }
}

/**
 * 打开或唤起侧边栏实时波形预览
 * @param {vscode.ExtensionContext} context
 * @param {vscode.TextDocument} [doc]
 * @param {number} [line]
 */
async function openWaveformPanel(context, doc, line) {
    const editor = vscode.window.activeTextEditor;
    const document = await resolveDocument(doc);
    if (!document) {
        vscode.window.showWarningMessage('请先打开一个包含 WaveDrom 的 Verilog/SystemVerilog 或 Markdown 文件');
        return;
    }

    const currentLine = (typeof line === 'number') ? line : (editor ? editor.selection.active.line : 0);

    if (currentPanel) {
        currentPanel.reveal(vscode.ViewColumn.Beside);
        updatePreviewContent(document, currentLine);
        return;
    }

    currentPanel = vscode.window.createWebviewPanel(
        'otterWaveformPreview',
        '时序波形 (WaveDrom)',
        vscode.ViewColumn.Beside,
        {
            enableScripts: true,
            retainContextWhenHidden: true
        }
    );

    currentPanel.onDidDispose(() => {
        currentPanel = null;
        lastRenderedBlock = null;
        previewDocument = null;
        clearTimeout(updateDebounceTimer);
    }, null, context.subscriptions);

    currentPanel.webview.onDidReceiveMessage(async (msg) => {
        if (msg.command === 'copySvg') {
            if (lastRenderedBlock) {
                const res = renderFromText(lastRenderedBlock.rawContent);
                if (res.ok) {
                    await vscode.env.clipboard.writeText(res.svg);
                    vscode.window.showInformationMessage('SVG 源码已复制到剪贴板！');
                }
            }
        } else if (msg.command === 'exportSvg') {
            if (previewDocument && lastRenderedBlock) await exportCurrentWaveformSvg(previewDocument, lastRenderedBlock.startLine);
        }
    }, null, context.subscriptions);

    updatePreviewContent(document, currentLine);
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
        vscode.window.showWarningMessage('未找到可导出的 WaveDrom 时序块');
        return;
    }

    const res = renderFromText(targetBlock.rawContent);
    if (!res.ok) {
        vscode.window.showErrorMessage('WaveDrom 解析失败，无法导出: ' + res.error);
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
        vscode.window.showInformationMessage(`已成功导出 SVG 至: ${path.basename(targetUri.fsPath)}`);
    }
}

/**
 * 在扩展激活时注册所有 WaveDrom 相关的提供者与命令
 * @param {vscode.ExtensionContext} context
 */
function registerWaveDromFeatures(context) {
    const supportedLangs = ['verilog', 'systemverilog', 'markdown'];
    context.subscriptions.push({dispose() { clearTimeout(updateDebounceTimer); disposeHoverImages(); }});

    // 1. Hover Provider
    context.subscriptions.push(vscode.languages.registerHoverProvider(supportedLangs, {
        provideHover(document, position) {
            const block = findWaveDromAtLine(document, position.line);
            if (!block) return null;

            return createWaveformHover(document, block);
        }
    }));

    // 2. CodeLens Provider
    context.subscriptions.push(vscode.languages.registerCodeLensProvider(supportedLangs, {
        provideCodeLenses(document) {
            const blocks = findAllWaveDromBlocks(document);
            const lenses = [];
            for (const block of blocks) {
                const range = new vscode.Range(block.startLine, 0, block.startLine, 0);
                lenses.push(new vscode.CodeLens(range, {
                    title: '$(graph) 查看波形（就地浮层）',
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

    // 3. 命令注册
    context.subscriptions.push(vscode.commands.registerCommand('otter-fpga-toolkit.previewWaveform', (doc, line) => {
        return openWaveformPreview(doc, line);
    }));

    context.subscriptions.push(vscode.commands.registerCommand('otter-fpga-toolkit.previewWaveformPanel', (doc, line) => openWaveformPanel(context, doc, line)));

    context.subscriptions.push(vscode.commands.registerCommand('otter-fpga-toolkit.exportWaveformSvg', (doc, line) => {
        return exportCurrentWaveformSvg(doc, line);
    }));

    // 4. 实时热重载：监听编辑器光标变动与文本变动
    context.subscriptions.push(vscode.window.onDidChangeTextEditorSelection((event) => {
        if (!currentPanel) return;
        if (!supportedLangs.includes(event.textEditor.document.languageId)) return;

        if (updateDebounceTimer) clearTimeout(updateDebounceTimer);
        updateDebounceTimer = setTimeout(() => {
            updatePreviewContent(event.textEditor.document, event.selections[0].active.line);
        }, 120);
    }));

    context.subscriptions.push(vscode.workspace.onDidChangeTextDocument((event) => {
        if (!currentPanel) return;
        if (!supportedLangs.includes(event.document.languageId)) return;
        if (!previewDocument || event.document.uri.toString() !== previewDocument.uri.toString()) return;

        if (updateDebounceTimer) clearTimeout(updateDebounceTimer);
        updateDebounceTimer = setTimeout(() => {
            updatePreviewContent(event.document, lastRenderedBlock ? lastRenderedBlock.startLine : 0);
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
    __test: {
        getWebviewHtml,
        disposeHoverImages
    }
};
