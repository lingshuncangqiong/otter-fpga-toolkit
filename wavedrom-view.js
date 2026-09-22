'use strict';

const crypto = require('node:crypto');

function fitScale(width, height, viewportWidth, viewportHeight, mode = 'width') {
    if (width <= 0 || height <= 0 || viewportWidth <= 40 || viewportHeight <= 40) return null;
    return Math.min(1, (viewportWidth - 40) / width,
        mode === 'all' ? (viewportHeight - 40) / height : 1);
}

function zoomScroll(oldScale, newScale, scroll, coordinate) {
    return (scroll + coordinate - 20) * newScale / oldScale + 20 - coordinate;
}

function getWebviewHtml(svg, block, error, revision = 0) {
    const nonce = crypto.randomBytes(18).toString('base64');
    const initial = JSON.stringify({svg: svg || '', error: error || '', revision,
        lineInfo: block ? `Line ${block.startLine + 1} - ${block.endLine + 1}` : '', resetTransform: true})
        .replace(/</g, '\\u003c');
    return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>WaveDrom 时序图</title>
<style>
*{box-sizing:border-box} body{margin:0;height:100vh;display:flex;flex-direction:column;overflow:hidden;background:var(--vscode-editor-background,#1e1e1e);color:var(--vscode-editor-foreground,#ddd);font:13px var(--vscode-font-family,system-ui)}
.toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid var(--vscode-panel-border,#444);flex-shrink:0}
.toolbar strong{margin-right:6px} .spacer{flex:1} #lineBadge,#scaleLabel{font-size:12px;white-space:nowrap;color:var(--vscode-descriptionForeground,#999)}
button{font:inherit;cursor:pointer;padding:5px 9px;border-radius:4px;border:1px solid var(--vscode-button-border,transparent);background:var(--vscode-button-secondaryBackground,#383b40);color:var(--vscode-button-secondaryForeground,#fff)}
button:hover{background:var(--vscode-button-secondaryHoverBackground,#494d53)} button:disabled{opacity:.45;cursor:default} button:focus-visible,#viewer:focus-visible{outline:1px solid var(--vscode-focusBorder,#007acc);outline-offset:-1px}
.hint{margin:0;padding:6px 12px;line-height:1.5;color:var(--vscode-descriptionForeground,#aaa);font-size:12px;flex-shrink:0}
#viewer{flex:1;min-height:0;overflow:auto;position:relative;overscroll-behavior:contain;scrollbar-gutter:stable;background:var(--vscode-editor-background,#1e1e1e);cursor:grab}
#viewer.dragging{cursor:grabbing;user-select:none} #canvasLayer{position:relative;margin:20px;width:max-content}
#svgCard{position:absolute;left:0;top:0;width:max-content;padding:16px;background:#fff;border:1px solid #d6dce2;border-radius:6px;transform-origin:0 0;box-shadow:0 2px 10px #0002}
#error{margin:20px;padding:14px;border:1px solid var(--vscode-inputValidation-errorBorder,#c55);background:var(--vscode-inputValidation-errorBackground,#522);color:var(--vscode-editor-foreground,#eee);white-space:pre-wrap;overflow-wrap:anywhere}
[hidden]{display:none!important}
</style></head><body>
<div class="toolbar"><strong>时序图</strong><span id="lineBadge"></span><span class="spacer"></span>
<button id="btnSide" title="源码与波形并排查看">并排查看</button>
<button id="btnStandalone" title="移回源码所在编辑区，以独立页签查看更大的波形">独立查看</button>
<button id="btnFit">适应宽度</button><button id="btnFitAll">查看全图</button><button id="btnReset">1:1</button>
<button id="btnZoomOut" aria-label="缩小">−</button><span id="scaleLabel">100%</span><button id="btnZoomIn" aria-label="放大">＋</button>
<button id="btnCopy">复制 SVG</button><button id="btnExport">导出 SVG</button></div>
<p class="hint">滚动查看完整波形 · Ctrl/Cmd + 滚轮缩放 · 拖动平移 · 点击信号名定位源码。图形保留 WaveDrom 原始配色。</p>
<div id="viewer" tabindex="0" aria-label="波形画布"><div id="error" role="status" hidden></div><div id="canvasLayer"><div id="svgCard"></div></div></div>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const fitScale = ${fitScale.toString()};
const zoomScroll = ${zoomScroll.toString()};
const viewer = document.getElementById('viewer');
const layer = document.getElementById('canvasLayer');
const card = document.getElementById('svgCard');
const root = card.attachShadow({mode:'open'});
const errorBox = document.getElementById('error');
let scale=1, mode='width', revision=0, hasDiagram=false, drag=null, resizeFrame=0;
function post(command, extra={}) { vscode.postMessage({command,revision,...extra}); }
function applyScale(next) {
    if (!hasDiagram || !Number.isFinite(next) || next<=0) return;
    scale=next;
    card.style.transform='scale('+scale+')';
    layer.style.width=(card.offsetWidth*scale)+'px';
    layer.style.height=(card.offsetHeight*scale)+'px';
    document.getElementById('scaleLabel').textContent=(scale<.01?'<1':Math.round(scale*100))+'%';
}
function fit(nextMode, reset=true) {
    mode=nextMode;
    const next=fitScale(card.offsetWidth,card.offsetHeight,viewer.clientWidth,viewer.clientHeight,mode);
    if(next===null || !hasDiagram)return;
    const previous=scale, oldTop=viewer.scrollTop;
    applyScale(next); viewer.scrollLeft=0; viewer.scrollTop=reset?0:oldTop*next/previous;
}
function zoom(next,x=viewer.clientWidth/2,y=viewer.clientHeight/2) {
    if(!hasDiagram)return;
    next=Math.min(8,Math.max(.05,next));
    const left=zoomScroll(scale,next,viewer.scrollLeft,x),top=zoomScroll(scale,next,viewer.scrollTop,y);
    mode='manual';applyScale(next);viewer.scrollLeft=left;viewer.scrollTop=top;
}
function parseSvg(source) {
    const parsed=new DOMParser().parseFromString(source,'image/svg+xml');
    if(parsed.querySelector('parsererror')||parsed.documentElement.localName!=='svg')throw new Error('SVG内容无法解析');
    const allowed=new Set(['svg','g','defs','path','rect','line','circle','ellipse','polygon','polyline','text','tspan','title','desc','use','marker','pattern','clippath','mask','lineargradient','radialgradient','stop','style']);
    for(const element of [parsed.documentElement,...parsed.documentElement.querySelectorAll('*')]) {
        if(!allowed.has(element.localName.toLowerCase())) {element.remove();continue;}
        for(const attr of [...element.attributes]) {
            if(/^on/i.test(attr.name)||((attr.localName==='href'||attr.name==='src')&&!attr.value.startsWith('#')))element.removeAttributeNode(attr);
        }
    }
    return document.importNode(parsed.documentElement,true);
}
function update(msg) {
    revision=msg.revision;
    const badge=document.getElementById('lineBadge');badge.textContent=msg.lineInfo||'';
    root.replaceChildren();hasDiagram=false;
    try {
        if(msg.error||!msg.svg)throw new Error(msg.error||'没有可显示的波形');
        const svg=parseSvg(msg.svg);
        const style=document.createElement('style');
        style.textContent='svg{display:block} text.clickable-signal{cursor:pointer} text.clickable-signal:hover{fill:#0067b8;text-decoration:underline}';
        root.append(style,svg);
        for(const label of svg.querySelectorAll('g[id^="wavelane_"] > g > text.info, g[id^="wavelane_"] > text.info')) {
            if(!/[A-Za-z_]/.test(label.textContent))continue;
            label.classList.add('clickable-signal');
            label.addEventListener('click',event=>{event.stopPropagation();post('jumpToSignal',{signalName:label.textContent.trim()});});
        }
        hasDiagram=true;errorBox.hidden=true;layer.hidden=false;
        if(msg.resetTransform)fit('width');else if(mode==='manual')applyScale(scale);else fit(mode,false);
    } catch(error) {
        root.replaceChildren();layer.hidden=true;errorBox.textContent=error.message;errorBox.hidden=false;
    }
    for(const id of ['btnFit','btnFitAll','btnReset','btnZoomOut','btnZoomIn','btnCopy','btnExport'])document.getElementById(id).disabled=!hasDiagram;
}
document.getElementById('btnFit').onclick=()=>fit('width');
document.getElementById('btnFitAll').onclick=()=>fit('all');
document.getElementById('btnReset').onclick=()=>{mode='manual';applyScale(1);viewer.scrollLeft=0;viewer.scrollTop=0;};
document.getElementById('btnZoomIn').onclick=()=>zoom(scale*1.2);
document.getElementById('btnZoomOut').onclick=()=>zoom(scale/1.2);
document.getElementById('btnCopy').onclick=()=>post('copySvg');
document.getElementById('btnExport').onclick=()=>post('exportSvg');
document.getElementById('btnSide').onclick=()=>post('showBeside');
document.getElementById('btnStandalone').onclick=()=>post('showStandalone');
viewer.addEventListener('wheel',event=>{
    if(!event.ctrlKey&&!event.metaKey)return;
    event.preventDefault();const rect=viewer.getBoundingClientRect();
    zoom(scale*(event.deltaY<0?1.15:1/1.15),event.clientX-rect.left,event.clientY-rect.top);
},{passive:false});
viewer.addEventListener('pointerdown',event=>{
    if(event.button!==0||!hasDiagram||event.composedPath().some(el=>el.classList&&el.classList.contains('clickable-signal')))return;
    // Keep native scrollbar interaction intact.
    const bounds=viewer.getBoundingClientRect();
    if(event.clientX-bounds.left>=viewer.clientWidth||event.clientY-bounds.top>=viewer.clientHeight)return;
    drag={x:event.clientX,y:event.clientY,left:viewer.scrollLeft,top:viewer.scrollTop};viewer.classList.add('dragging');viewer.setPointerCapture(event.pointerId);
});
viewer.addEventListener('pointermove',event=>{if(drag){viewer.scrollLeft=drag.left+drag.x-event.clientX;viewer.scrollTop=drag.top+drag.y-event.clientY;}});
function endDrag(){drag=null;viewer.classList.remove('dragging');}
viewer.addEventListener('pointerup',endDrag);viewer.addEventListener('pointercancel',endDrag);viewer.addEventListener('lostpointercapture',endDrag);
new ResizeObserver(()=>{cancelAnimationFrame(resizeFrame);resizeFrame=requestAnimationFrame(()=>{if(mode!=='manual')fit(mode,false);});}).observe(viewer);
window.addEventListener('message',event=>{if(event.data&&event.data.command==='updateWaveform')update(event.data);});
update(${initial});
vscode.postMessage({command:'ready'});
</script></body></html>`;
}

module.exports = {getWebviewHtml, fitScale, zoomScroll};
