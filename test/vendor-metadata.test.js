'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const {
    findVivadoPrimitiveSource,
    parseXilinxBd,
    parseXilinxXci
} = require('../vendor-metadata.js');

test('Xilinx XCI boundary.ports 转换为 IP module 端口方向', () => {
    const text = JSON.stringify({
        ip_inst: {
            xci_name: 'clk_wiz_0',
            boundary: {
                ports: {
                    clk_in1_p: [{direction: 'in'}],
                    clk_in1_n: [{direction: 'in'}],
                    clk_50m: [{direction: 'out'}],
                    locked: [{direction: 'out'}]
                }
            }
        }
    }, null, 2);
    const definition = parseXilinxXci(text);
    assert.equal(definition.name, 'clk_wiz_0');
    assert.equal(definition.sourceKind, 'xilinx-xci');
    assert.deepEqual(
        definition.ports.map(port => [port.name, port.direction]),
        [
            ['clk_in1_p', 'input'],
            ['clk_in1_n', 'input'],
            ['clk_50m', 'output'],
            ['locked', 'output']
        ]
    );
});

test('Xilinx BD 顶层 scalar/interface 端口转换为 wrapper 方向', () => {
    const text = JSON.stringify({
        design: {
            design_info: {name: 'video_pcie_subsystem'},
            ports: {
                vid_pclk: {direction: 'I'},
                capture_overflow: {direction: 'O'}
            },
            interface_ports: {
                pcie_mgt: {
                    port_maps: {
                        rxn: {physical_name: 'pcie_mgt_rxn', direction: 'I'},
                        txn: {physical_name: 'pcie_mgt_txn', direction: 'O'}
                    }
                }
            }
        }
    }, null, 2);
    const definition = parseXilinxBd(text, 'C:/project/video_pcie_subsystem.bd');
    assert.equal(definition.name, 'video_pcie_subsystem_wrapper');
    assert.equal(definition.sourceKind, 'xilinx-bd');
    assert.deepEqual(
        new Map(definition.ports.map(port => [port.name, port.direction])),
        new Map([
            ['vid_pclk', 'input'],
            ['capture_overflow', 'output'],
            ['pcie_mgt_rxn', 'input'],
            ['pcie_mgt_txn', 'output']
        ])
    );
});

test('Vivado 原语路径只接受合法 module 名并定位 unisims 源码', () => {
    const xvlogPath = path.join('C:', 'Xilinx', 'Vivado', '2024.2', 'bin', 'xvlog.bat');
    const expected = path.join('C:', 'Xilinx', 'Vivado', '2024.2', 'data', 'verilog', 'src', 'unisims', 'IOBUF.v');
    assert.equal(
        findVivadoPrimitiveSource('IOBUF', xvlogPath, candidate => candidate === expected),
        expected
    );
    assert.equal(findVivadoPrimitiveSource('../IOBUF', xvlogPath, () => true), null);
});
