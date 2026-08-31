'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

function loadFormatter() {
    const originalLoad = Module._load;
    Module._load = function(request, parent, isMain) {
        if (request === 'vscode') return {};
        return originalLoad.call(this, request, parent, isMain);
    };
    try {
        return require('./extension.js').__test;
    } finally {
        Module._load = originalLoad;
    }
}

function usage() {
    return [
        'Usage:',
        '  node format-cli.js --check [--tab-size N] [--start-line N --end-line N] <file>',
        '  node format-cli.js --write [--tab-size N] [--start-line N --end-line N] <file>',
        '',
        'Line numbers are 1-based and inclusive. Column alignment is computed from the full file.'
    ].join('\n');
}

function parseArgs(argv) {
    const options = {mode: null, tabSize: 4, startLine: null, endLine: null, file: null};
    for (let index = 0; index < argv.length; index++) {
        const arg = argv[index];
        if (arg === '--check' || arg === '--write') {
            const mode = arg.slice(2);
            if (options.mode && options.mode !== mode) throw new Error('--check and --write are mutually exclusive');
            options.mode = mode;
        } else if (arg === '--tab-size' || arg === '--start-line' || arg === '--end-line') {
            const value = argv[++index];
            if (value === undefined || !/^\d+$/.test(value)) throw new Error(`${arg} requires a positive integer`);
            const number = Number(value);
            if (arg === '--tab-size') options.tabSize = number;
            if (arg === '--start-line') options.startLine = number;
            if (arg === '--end-line') options.endLine = number;
        } else if (arg === '--help' || arg === '-h') {
            options.help = true;
        } else if (arg.startsWith('-')) {
            throw new Error(`unknown option: ${arg}`);
        } else if (options.file) {
            throw new Error('only one RTL file can be formatted per invocation');
        } else {
            options.file = arg;
        }
    }
    if (options.help) return options;
    if (!options.mode) throw new Error('choose exactly one mode: --check or --write');
    if (!options.file) throw new Error('missing RTL file path');
    if (options.tabSize < 1 || options.tabSize > 16) throw new Error('--tab-size must be within 1..16');
    if (options.startLine !== null && options.startLine < 1) throw new Error('--start-line must be at least 1');
    if (options.endLine !== null && options.endLine < 1) throw new Error('--end-line must be at least 1');
    if (options.startLine !== null && options.endLine !== null && options.startLine > options.endLine) {
        throw new Error('--start-line cannot be greater than --end-line');
    }
    return options;
}

function splitText(text) {
    const lines = [];
    const endings = [];
    const newline = /\r\n|\n|\r/g;
    let start = 0;
    let match;
    while ((match = newline.exec(text)) !== null) {
        lines.push(text.slice(start, match.index));
        endings.push(match[0]);
        start = match.index + match[0].length;
    }
    lines.push(text.slice(start));
    return {lines, endings};
}

function joinText(lines, endings) {
    let text = '';
    for (let index = 0; index < lines.length; index++) {
        text += lines[index];
        if (index < endings.length) text += endings[index];
    }
    return text;
}

function formatFile(filePath, options, formatter = loadFormatter()) {
    const absolutePath = path.resolve(filePath);
    if (!/\.(v|sv|vh|svh)$/i.test(absolutePath)) throw new Error('only .v/.sv/.vh/.svh files are supported');
    if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) throw new Error(`file not found: ${absolutePath}`);

    const original = fs.readFileSync(absolutePath, 'utf8');
    const {lines, endings} = splitText(original);
    const first = options.startLine === null ? 0 : options.startLine - 1;
    const last = options.endLine === null ? lines.length - 1 : options.endLine - 1;
    if (first >= lines.length || last >= lines.length) throw new Error(`line range exceeds file length ${lines.length}`);

    const result = formatter.formatLineRange(lines, options.tabSize, first, last);
    const formatted = joinText(result.lines, endings);
    if (options.mode === 'write' && formatted !== original) fs.writeFileSync(absolutePath, formatted, 'utf8');
    return {absolutePath, changedLines: result.changes.map(change => change.line + 1), changed: formatted !== original};
}

function main(argv = process.argv.slice(2)) {
    try {
        const options = parseArgs(argv);
        if (options.help) {
            process.stdout.write(`${usage()}\n`);
            return 0;
        }
        const result = formatFile(options.file, options);
        if (options.mode === 'check' && result.changed) {
            process.stderr.write(`FAIL formatting required: ${result.absolutePath} (${result.changedLines.length} lines)\n`);
            return 1;
        }
        const action = options.mode === 'write' && result.changed ? 'formatted' : 'unchanged';
        process.stdout.write(`PASS ${action}: ${result.absolutePath}\n`);
        return 0;
    } catch (error) {
        process.stderr.write(`ERROR ${error.message}\n${usage()}\n`);
        return 2;
    }
}

if (require.main === module) process.exitCode = main();

module.exports = {formatFile, joinText, loadFormatter, main, parseArgs, splitText, usage};
