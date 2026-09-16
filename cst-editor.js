'use strict';
const {Worker} = require('node:worker_threads');
const path = require('node:path');

function formatAsync(lines,tabSize,first,last) {
    return new Promise((resolve,reject)=>{
        const worker=new Worker(path.join(__dirname,'cst-worker.js'),{
            workerData:{lines,tabSize,first,last}
        });
        worker.once('message',message=>message.error?reject(new Error(message.error)):resolve(message.result));
        worker.once('error',reject);
        worker.once('exit',code=>{if(code!==0)reject(new Error(`排版线程退出: ${code}`));});
    });
}
module.exports={formatAsync};
