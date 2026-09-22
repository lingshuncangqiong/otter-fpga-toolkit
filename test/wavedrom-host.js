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
    const preview=require('../wavedrom-webview');
    const timeout=Date.now()+8000;
    while(!preview.__test.panelReady() && Date.now()<timeout) await new Promise(resolve=>setTimeout(resolve,30));
    assert.equal(preview.__test.panelReady(),true,'webview JavaScript must finish initialization');
    assert.ok(vscode.window.tabGroups.all.length>groupsBefore, 'default preview must open beside the source');
    assert.ok(vscode.window.visibleTextEditors.some(editor=>editor.document.uri.toString()===doc.uri.toString()));
    const hovers = await vscode.commands.executeCommand('vscode.executeHoverProvider', doc.uri, new vscode.Position(1, 3));
    const contents = hovers.flatMap(hover => hover.contents.map(item => item.value || ''));
    assert.ok(contents.some(text => text.includes('WaveDrom 时序波形') && text.includes('并排查看')));
    assert.ok(contents.every(text => !text.includes('otter-waveform-') && !text.includes('data:image')));
    assert.equal(doc.getText(), source, 'preview must never edit the source');
    await vscode.commands.executeCommand('otter-fpga-toolkit.previewWaveformStandalone', doc.uri.toString(), 1);
    const groupDeadline=Date.now()+5000;
    while(vscode.window.tabGroups.all.length>groupsBefore && Date.now()<groupDeadline) await new Promise(resolve=>setTimeout(resolve,30));
    assert.equal(vscode.window.tabGroups.all.length,groupsBefore,'standalone preview returns to the source group');
    await vscode.commands.executeCommand('editor.action.hideHover');
    console.log('WAVEDROM_EXTENSION_HOST=PASS');
};
