'use strict';

const wavedrom = require('./vendor/wavedrom/wavedrom');
const { parseWaveDromSource, findAllWaveDromBlocks } = require('./wavedrom-parser');

/**
 * 渲染 WaveDrom 对象为 SVG 文本
 * @param {object} doc
 * @param {object} [options]
 * @param {boolean} [options.dark]
 * @returns {string} SVG 文本
 */
function renderSvg(doc, options = {}) {
    if (!doc || typeof doc !== 'object') {
        throw new Error('Invalid WaveDrom document object');
    }
    const skin = wavedrom.waveSkin;
    const tree = wavedrom.renderAny(0, doc, skin);
    let svg = wavedrom.onml.stringify(tree);

    // 默认皮肤使用黑色线条，独立SVG和深色编辑器浮层都需要完整白底。
    svg = svg.replace(/(<svg\b[^>]*>)/, '$1<rect width="100%" height="100%" fill="#ffffff"/>');

    return svg;
}

/**
 * 将 SVG 转换为可在 VS Code Markdown 中直接内嵌展示的 Data URI
 * @param {string} svg
 * @returns {string}
 */
function svgToDataUri(svg) {
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

/**
 * 从原始文本解析并渲染为 SVG 与 Data URI
 * @param {string} text
 * @param {object} [options]
 * @returns {{ ok: boolean, svg?: string, dataUri?: string, doc?: object, error?: string }}
 */
function renderFromText(text, options = {}) {
    let source = text;
    if (typeof text === 'string' && (text.includes('```') || text.includes('//') || text.includes('/*'))) {
        const blocks = findAllWaveDromBlocks(text);
        if (blocks.length > 0 && blocks[0].rawContent) {
            source = blocks[0].rawContent;
        }
    }
    const parsedRes = parseWaveDromSource(source);
    if (!parsedRes.ok) {
        return { ok: false, error: parsedRes.error };
    }
    try {
        const svg = renderSvg(parsedRes.data, options);
        const dataUri = svgToDataUri(svg);
        return {
            ok: true,
            svg: svg,
            dataUri: dataUri,
            doc: parsedRes.data
        };
    } catch (err) {
        return { ok: false, error: err.message };
    }
}

module.exports = {
    renderSvg,
    svgToDataUri,
    renderFromText
};
