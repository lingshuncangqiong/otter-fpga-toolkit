'use strict';

// Run explicitly with VS Code --extensionTestsPath; not part of plain Node tests.
const vscode = require('vscode');
const assert = require('node:assert/strict');

exports.run = async function() {
    const extension = vscode.extensions.getExtension('Otter-xiaoxiaoxuwang.otter-fpga-toolkit');
    assert.ok(extension, 'development extension must be available');
    await extension.activate();
    const source = [
        '// ```wavedrom',
        '// {signal:[{name:"clk",wave:"p..."},{name:"valid",wave:"010."}]}',
        '// ```',
        'module wave_preview_host; endmodule'
    ].join('\n');
    const doc = await vscode.workspace.openTextDocument({language: 'systemverilog', content: source});
    await vscode.window.showTextDocument(doc);
    const groupsBefore = vscode.window.tabGroups.all.length;
    await vscode.commands.executeCommand('otter-fpga-toolkit.previewWaveform', doc.uri.toString(), 1);
    assert.equal(vscode.window.tabGroups.all.length, groupsBefore, 'local preview must not create another editor group');
    const hovers = await vscode.commands.executeCommand('vscode.executeHoverProvider', doc.uri, new vscode.Position(1, 3));
    const contents = hovers.flatMap(hover => hover.contents.map(item => item.value || ''));
    assert.ok(contents.some(text => text.includes('WaveDrom 时序图') && text.includes('otter-waveform-')));
    assert.equal(doc.getText(), source, 'preview must never edit the source');
    await vscode.commands.executeCommand('editor.action.hideHover');
    console.log('WAVEDROM_EXTENSION_HOST=PASS');
};
