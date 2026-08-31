'use strict';

const fs = require('fs');
const path = require('path');

function normalizeDirection(value) {
    const direction = String(value || '').toLowerCase();
    if (direction === 'i' || direction === 'in' || direction === 'input' || direction === 'slave') return 'input';
    if (direction === 'o' || direction === 'out' || direction === 'output' || direction === 'master') return 'output';
    if (direction === 'io' || direction === 'inout') return 'inout';
    return null;
}

function quotedValueOffset(text, value) {
    const quoted = JSON.stringify(String(value));
    const offset = text.indexOf(quoted);
    return offset >= 0 ? offset + 1 : 0;
}

function addPort(portMap, text, name, rawDirection) {
    if (!name || portMap.has(name)) return;
    const direction = normalizeDirection(rawDirection);
    if (!direction) return;
    portMap.set(name, {
        name,
        direction,
        nameOffset: quotedValueOffset(text, name)
    });
}

function addTriStateWrapperPorts(portMap, text, interfacePort) {
    const groups = new Map();
    for (const [logicalName, port] of Object.entries(interfacePort?.port_maps || {})) {
        const logicalMatch = /^(.*)_(I|O|T)$/i.exec(logicalName);
        const physicalName = port && port.physical_name;
        if (!logicalMatch || !physicalName) continue;
        const suffix = `_${logicalMatch[2].toLowerCase()}`;
        if (!physicalName.toLowerCase().endsWith(suffix)) continue;
        const physicalBase = physicalName.slice(0, -suffix.length);
        const key = `${logicalMatch[1].toLowerCase()}\u0000${physicalBase.toLowerCase()}`;
        const group = groups.get(key) || {};
        group[logicalMatch[2].toLowerCase()] = port;
        groups.set(key, group);
    }

    for (const group of groups.values()) {
        if (!group.i || !group.o || !group.t) continue;
        if (normalizeDirection(group.i.direction) !== 'input'
            || normalizeDirection(group.o.direction) !== 'output'
            || normalizeDirection(group.t.direction) !== 'output') continue;
        const physicalBase = group.i.physical_name.slice(0, -2);
        if (group.o.physical_name.slice(0, -2) !== physicalBase
            || group.t.physical_name.slice(0, -2) !== physicalBase) continue;
        const widths = [group.i, group.o, group.t].map(port => `${port.left ?? ''}:${port.right ?? ''}`);
        if (!widths.every(width => width === widths[0])) continue;
        const name = `${physicalBase}_io`;
        if (portMap.has(name)) continue;
        portMap.set(name, {
            name,
            direction: 'inout',
            nameOffset: quotedValueOffset(text, group.i.physical_name)
        });
    }
}

function parseXilinxXci(text) {
    const data = JSON.parse(text);
    const instance = data && data.ip_inst;
    if (!instance || !instance.boundary) return null;
    const name = instance.xci_name
        || instance.parameters?.component_parameters?.Component_Name?.[0]?.value;
    if (!name) return null;

    const portMap = new Map();
    for (const [portName, entries] of Object.entries(instance.boundary.ports || {})) {
        const entry = Array.isArray(entries) ? entries.find(item => item && item.direction) : entries;
        addPort(portMap, text, portName, entry && entry.direction);
    }
    return {
        sourceKind: 'xilinx-xci',
        name,
        nameOffset: quotedValueOffset(text, name),
        endOffset: text.length,
        ports: [...portMap.values()],
        instances: []
    };
}

function parseXilinxBd(text, filePath = '') {
    const data = JSON.parse(text);
    const design = data && data.design;
    if (!design) return null;
    const fileName = path.basename(filePath, path.extname(filePath));
    const designName = design.design_info?.name || design.design_info?.design_name || fileName;
    if (!designName) return null;

    const portMap = new Map();
    for (const [portName, port] of Object.entries(design.ports || {})) {
        addPort(portMap, text, portName, port && port.direction);
    }
    for (const interfacePort of Object.values(design.interface_ports || {})) {
        for (const port of Object.values(interfacePort?.port_maps || {})) {
            addPort(portMap, text, port && port.physical_name, port && port.direction);
        }
        addTriStateWrapperPorts(portMap, text, interfacePort);
    }

    return {
        sourceKind: 'xilinx-bd',
        name: designName.endsWith('_wrapper') ? designName : `${designName}_wrapper`,
        nameOffset: quotedValueOffset(text, designName),
        endOffset: text.length,
        ports: [...portMap.values()],
        instances: []
    };
}

function parseVendorMetadata(text, filePath) {
    const extension = path.extname(filePath || '').toLowerCase();
    if (extension === '.xci') return parseXilinxXci(text);
    if (extension === '.bd') return parseXilinxBd(text, filePath);
    return null;
}

function findVivadoPrimitiveSource(typeName, xvlogPath, fileExists = fs.existsSync) {
    if (!/^[A-Za-z_][A-Za-z0-9_$]*$/.test(typeName || '')) return null;
    if (!xvlogPath || xvlogPath === 'xvlog') return null;
    const executable = path.resolve(xvlogPath);
    const vivadoRoot = path.dirname(path.dirname(executable));
    const sourceDirs = [
        path.join(vivadoRoot, 'data', 'verilog', 'src', 'unisims'),
        path.join(vivadoRoot, 'data', 'verilog', 'src', 'unimacro')
    ];
    for (const sourceDir of sourceDirs) {
        for (const extension of ['.v', '.sv']) {
            const candidate = path.join(sourceDir, `${typeName}${extension}`);
            if (fileExists(candidate)) return candidate;
        }
    }
    return null;
}

module.exports = {
    addTriStateWrapperPorts,
    findVivadoPrimitiveSource,
    normalizeDirection,
    parseVendorMetadata,
    parseXilinxBd,
    parseXilinxXci
};
