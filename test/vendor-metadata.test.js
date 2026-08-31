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

test('Xilinx BD I/O/T 三态端口合成为 wrapper inout', () => {
    const text = JSON.stringify({
        design: {
            design_info: {name: 'otter_zu7ev_lab'},
            interface_ports: {
                sensor_iic: {
                    port_maps: {
                        SCL_I: {physical_name: 'sensor_iic_scl_i', direction: 'I'},
                        SCL_O: {physical_name: 'sensor_iic_scl_o', direction: 'O'},
                        SCL_T: {physical_name: 'sensor_iic_scl_t', direction: 'O'},
                        SDA_I: {physical_name: 'sensor_iic_sda_i', direction: 'I'},
                        SDA_O: {physical_name: 'sensor_iic_sda_o', direction: 'O'},
                        SDA_T: {physical_name: 'sensor_iic_sda_t', direction: 'O'}
                    }
                },
                sensor_gpio: {
                    port_maps: {
                        TRI_I: {physical_name: 'sensor_gpio_tri_i', direction: 'I', left: '1', right: '0'},
                        TRI_O: {physical_name: 'sensor_gpio_tri_o', direction: 'O', left: '1', right: '0'},
                        TRI_T: {physical_name: 'sensor_gpio_tri_t', direction: 'O', left: '1', right: '0'}
                    }
                }
            }
        }
    }, null, 2);
    const definition = parseXilinxBd(text, 'C:/project/otter_zu7ev_lab.bd');
    const directions = new Map(definition.ports.map(port => [port.name, port.direction]));
    assert.equal(directions.get('sensor_iic_scl_io'), 'inout');
    assert.equal(directions.get('sensor_iic_sda_io'), 'inout');
    assert.equal(directions.get('sensor_gpio_tri_io'), 'inout');
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
