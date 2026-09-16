'use strict';
const {parentPort,workerData}=require('node:worker_threads');
const Module=require('node:module');
const load=Module._load;
try {
    // 复用与现有 CLI 相同的无 VS Code 运行时加载方式。
    Module._load=function(name,...args){return name==='vscode'?{}:load.call(this,name,...args);};
    const formatter=require('./extension').__test;
    Module._load=load;
    parentPort.postMessage({result:formatter.formatLineRange(
        workerData.lines,workerData.tabSize,workerData.first,workerData.last
    )});
}catch(error){
    Module._load=load;
    parentPort.postMessage({error:error.message});
}
