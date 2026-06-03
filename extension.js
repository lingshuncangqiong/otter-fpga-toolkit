const vscode = require('vscode');
const cp = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

function padToTab(c,t){return Math.ceil(c/t)*t;}

function activate(context) {
    const diagColl = vscode.languages.createDiagnosticCollection('verilog-xvlog');
    context.subscriptions.push(diagColl);

    //===== 例化 =====
    context.subscriptions.push(vscode.commands.registerCommand('verilog-instantiate.generateInstance', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor || !['verilog','systemverilog'].includes(editor.document.languageId)) return;
        const tb = vscode.workspace.getConfiguration('verilogInstantiate').get('tabSize',4);
        const ind=' '.repeat(tb);
        let text='';const sel=editor.selection;
        if(!sel.isEmpty)text=editor.document.getText(sel);else text=editor.document.getText();
        const mod=parseModule(text);
        if(!mod){vscode.window.showWarningMessage('未找到 module');return;}
        // 提取原始模块中的注释 //----- 和端口声明行
        mod.comments=extractComments(text,mod);
        const code=genInst(mod,ind);
        await editor.edit(eb=>{if(sel.isEmpty)eb.insert(sel.active,code);else eb.replace(sel,code);});
        vscode.window.showInformationMessage(`已生成 "${mod.name}"`);
    }));

    //===== 排版 =====
    context.subscriptions.push(vscode.commands.registerCommand('verilog-instantiate.alignCode', async () => {
        const editor = vscode.window.activeTextEditor;
        if(!editor||!['verilog','systemverilog'].includes(editor.document.languageId))return;
        const tab = vscode.workspace.getConfiguration('verilogInstantiate').get('tabSize',4);
        const sel = editor.selection;
        let s=sel.isEmpty?sel.active.line:sel.start.line, e=sel.isEmpty?sel.active.line:sel.end.line;
        const doc = editor.document;

        // 解析 — v2.0.2 fix3: function/task/tab
        let mt=0,mn=0,me=0,mcl=0,he=0;
        let ipMaxN=0, ipMaxC=0;
        const all=[];
        for(let i=0;i<doc.lineCount;i++){
            const p=parseLine(doc.lineAt(i).text, tab);
            if(!p)continue;
            all.push({i,...p});
            if(p.tag==='inst_port'||p.tag==='inst_port_multi'){if(p.port.length>ipMaxN)ipMaxN=p.port.length;if(p.tag==='inst_port'&&p.conn.length>ipMaxC)ipMaxC=p.conn.length;continue;}
            if(p.type.length>mt)mt=p.type.length;
            if(p.name.length>mn)mn=p.name.length;
            if(p.eq){he=1;if(p.eq.length>me)me=p.eq.length;}
            if(p.cl&&p.cl.length>mcl)mcl=p.cl.length;
        }
        if(!all.length)return;

        // 信号列
        const bc=padToTab(mt+1,tab)+tab;
        const cp=mcl?padToTab(bc+mcl+2,tab)-bc-2:0;
        let mb=0;
        for(const p of all){if(p.tag==='inst_port'||p.tag==='inst_port_multi')continue;let w=0;if(p.cl){w=p.cl.length+Math.max(0,cp-p.cl.length)+1+(p.rr?p.rr.length:1)+2;}if(w>mb)mb=w;}
        const nc=padToTab(bc+mb+1,tab);
        const ec=padToTab(nc+mn+1,tab);
        const vc=padToTab(ec+(he?1:0),tab);
        const cc=padToTab(vc+me+1,tab)-1;
        const sigCols={bc,cp,nc,ec,vc,cc};

        // 例化列: .port (conn),   — conn内部对齐, ), 上下列齐
        const ipCol=padToTab(ipMaxN+2,tab)+tab;  // ( 起始列
        const cpCol=padToTab(ipCol+ipMaxC+2,tab); // ) 对齐列，+2确保至少1空格

        const edits=[];
        for(let i=s;i<=e;i++){
            const orig=doc.lineAt(i).text;
            const entry=all.find(x=>x.i===i);
            if(!entry)continue;
            const cols=(entry.tag==='inst_port'||entry.tag==='inst_port_multi')?{ipCol,cpCol}:sigCols;
            const fmt=doFmt(entry, cols, orig);
            if(fmt!==orig)edits.push(vscode.TextEdit.replace(new vscode.Range(i,0,i,orig.length),fmt));
        }
        if(edits.length)await editor.edit(eb=>edits.forEach(x=>eb.replace(x.range,x.newText)));
    }));

    //===== xvlog =====
    context.subscriptions.push(vscode.commands.registerCommand('verilog-instantiate.xvlogLint', async () => {
        const ed=vscode.window.activeTextEditor;if(!ed)return;await ed.document.save();doLint(ed.document.uri,diagColl,true);
    }));
    const saveSub=vscode.workspace.onDidSaveTextDocument(d=>{if(isV(d))doLint(d.uri,diagColl);});
    context.subscriptions.push(saveSub);
    const openSub=vscode.workspace.onDidOpenTextDocument(d=>{if(isV(d))setTimeout(()=>doLint(d.uri,diagColl),400);});
    context.subscriptions.push(openSub);
    const changeSub=vscode.window.onDidChangeActiveTextEditor(ed=>{if(ed&&isV(ed.document))setTimeout(()=>doLint(ed.document.uri,diagColl),400);});
    context.subscriptions.push(changeSub);
    const closeSub=vscode.workspace.onDidCloseTextDocument(d=>{if(isV(d))diagColl.delete(d.uri);});
    context.subscriptions.push(closeSub);
    const ae=vscode.window.activeTextEditor;if(ae&&isV(ae.document))setTimeout(()=>doLint(ae.document.uri,diagColl),500);

    //===== 跳转/悬停 =====
    context.subscriptions.push(vscode.languages.registerDefinitionProvider(['verilog','systemverilog'],{provideDefinition(doc,pos){return findDecl(doc,pos);}}));
    context.subscriptions.push(vscode.languages.registerHoverProvider(['verilog','systemverilog'],{provideHover(doc,pos){
        const w=doc.getWordRangeAtPosition(pos,/[\w`]+/);if(!w)return null;
        const loc=findDecl(doc,pos);if(loc){const ln=loc.range.start.line+1;const md=new vscode.MarkdownString();md.appendMarkdown('*Line '+ln+'*  \n');md.appendCodeblock(doc.lineAt(loc.range.start.line).text.trim(),'verilog');return new vscode.Hover(md,w);}
        return null;
    }}));

    //===== 补全 =====
    context.subscriptions.push(vscode.languages.registerCompletionItemProvider(['verilog','systemverilog'],{
        provideCompletionItems(doc,pos){
            if(!vscode.workspace.getConfiguration('verilogInstantiate').get('enableCompletion',true))return [];
            const list=[],t='    ';
            const add=(lbl,txt,det,kind)=>{
                const ci=new vscode.CompletionItem(lbl,kind||vscode.CompletionItemKind.Snippet);
                ci.insertText=new vscode.SnippetString(txt);ci.detail='[Otter] '+(det||'');list.push(ci);
            };
            // 基本模块结构
            add('module','module ${1:name} (\n    ${2:ports}\n);\n\n${3}\n\nendmodule //${1}','module..endmodule');
            add('input','input ${1:signal},','input 端口声明',vscode.CompletionItemKind.Keyword);
            add('output','output ${1:signal},','output 端口声明',vscode.CompletionItemKind.Keyword);
            add('inout','inout ${1:signal},','inout 端口声明',vscode.CompletionItemKind.Keyword);
            add('wire','wire ${1:signal};','wire 声明',vscode.CompletionItemKind.Keyword);
            add('reg','reg ${1:signal};','reg 声明',vscode.CompletionItemKind.Keyword);
            add('parameter','parameter ${1:NAME} = ${2:value};','parameter 声明',vscode.CompletionItemKind.Keyword);
            add('localparam','localparam ${1:NAME} = ${2:value};','localparam 声明',vscode.CompletionItemKind.Keyword);
            add('assign','assign ${1:target} = ${2:expr};','assign 连续赋值',vscode.CompletionItemKind.Keyword);
            // always 块
            add('always @*','always @(*) begin\n${t}${1}\nend','组合逻辑 always @*');
            add('always @posedge','always @(posedge ${1:clk}) begin\n${t}${2}\nend','时序逻辑 posedge');
            add('always @posedge+negedge','always @(posedge ${1:clk} or negedge ${2:rst_n}) begin\n${t}${3}\nend','带异步复位');
            // 条件/分支
            add('if','if (${1:cond}) begin\n${t}${2}\nend','if 语句');
            add('if else','if (${1:cond}) begin\n${t}${2}\nend else begin\n${t}${3}\nend','if..else 语句');
            add('case','case (${1:sel})\n${t}${2:val1}: ${3:stmt};\n${t}default: ${4:stmt};\nendcase','case 语句');
            add('for','for (${1:i}=0;${1} < ${2:N};${1}=${1}+1) begin\n${t}${3}\nend','for 循环');
            // generate
            add('generate for','generate\n${t}for (${1:i}=0;${1} < ${2:N};${1}=${1}+1) begin: ${3:gen_label}\n${t}${t}${4}\n${t}end\nendgenerate','generate for 循环');
            add('generate if','generate\n${t}if (${1:cond}) begin: ${2:label}\n${t}${t}${3}\n${t}end else begin: ${4:label_else}\n${t}${t}${5}\n${t}end\nendgenerate','generate if');
            // 状态机
            add('fsm','// FSM states\nlocalparam ${1:IDLE} = ${2:0},\n${t}${t} ${3:S1}   = ${4:1},\n${t}${t} ${5:S2}   = ${6:2};\nreg [${7:1}:0] state, next_state;\n\nalways @(posedge ${8:clk} or negedge ${9:rst_n}) begin\n${t}if (!${9}) state <= ${1};\n${t}else state <= next_state;\nend\n\nalways @(*) begin\n${t}next_state = state;\n${t}case (state)\n${t}${t}${1}: begin\n${t}${t}${t}${10}\n${t}${t}${t}next_state = ${3};\n${t}${t}end\n${t}${t}default: next_state = ${1};\n${t}endcase\nend','三段式状态机');
            // SystemVerilog 额外
            add('logic','logic ${1:signal};','logic 声明 (SV)',vscode.CompletionItemKind.Keyword);
            add('always_comb','always_comb begin\n${t}${1}\nend','always_comb (SV)');
            add('always_ff','always_ff @(posedge ${1:clk}) begin\n${t}${2}\nend','always_ff (SV)');
            add('typedef enum','typedef enum {${1:IDLE}, ${2:S1}, ${3:S2}} ${4:state_t};','typedef enum (SV)');
            add('typedef struct','typedef struct {\n${t}${1}\n} ${2:name_t};','typedef struct (SV)');
            add('initial','initial begin\n${t}${1}\nend','initial 块');
            add('task','task ${1:name}(${2:ports});\n${t}${3}\nendtask','task 任务');
            add('function','function ${1:type} ${2:name}(${3:ports});\n${t}${4}\nendfunction','function 函数');
            add('//---','//---------------------- ${1:section} ----------------------','分隔注释');
            // 扫描当前文档中已定义的信号/变量
            var seen={};
            for(var i=0;i<doc.lineCount;i++){
                var line=doc.lineAt(i).text.replace(/\/\/.*$/,'').trim();
                var dm=line.match(/^\s*(input|output|inout|wire|reg|parameter|localparam|integer|genvar|logic|bit|int|tri|wand|wor)\s+(?:signed\s+)?(?:\[[^\]]*\]\s*)?(\w+)/);
                if(dm&&dm[2]&&dm[2].length>1&&!seen[dm[2]]){
                    seen[dm[2]]=true;
                    var ci=new vscode.CompletionItem(dm[2],vscode.CompletionItemKind.Variable);
                    ci.detail='[Otter] '+dm[1]+' (line '+(i+1)+')';
                    ci.sortText='2_'+dm[2];
                    list.push(ci);
                }
            }
            return list;
        }
    }));
}

function isV(d){return ['verilog','systemverilog'].includes(d.languageId);}

function parseLine(line, tab){
    if(!line)return null;
    tab=tab||4;
    const rawInd=line.match(/^(\s*)/)[1];
    const ind=rawInd.replace(/\t/g,' '.repeat(tab));
    let body=line.replace(/^\s*/,'').replace(/\s*\/\/.*$/,'').replace(/\s+$/,'');
    if(!body)return null;

    // 提取原始宽度文本(不压缩空格), 用于保留 [EXPR     - 1  :0] 中的原有间距
    let rawCL='', rawRR='';
    {
        const tmp=body.replace(/\t/g,' ');
        const wm=tmp.match(/\[([^\]]*)\]/);
        if(wm){
            const inner=wm[1];
            const cm=inner.match(/^(.+?)\s*:\s*(\S+)$/);
            if(cm){rawCL=cm[1]; rawRR=cm[2];}
        }
    }

    body=body.replace(/\t/g,' ').replace(/ {2,}/g,' ').replace(/\s+;/g,';').replace(/\s+,/g,',');
    if(/^(assign|always|if|else|case|endcase|begin|end|function|endfunction|task|endtask|generate|endgenerate|endmodule|module|initial|forever|while|for|@|#)\b/.test(body))return null;
    if(/^\w+\s+#\s*\($/.test(body)||/^\).+\s*\($/.test(body)||/^\);?\s*$/.test(body))return null;

    // 跨行端口首行: .port ({expr... (无闭合)) — 端口名参与对齐，内容留原样
    if(/^\.(\w+)\s*\(/.test(body)&&!/\)\s*,?\s*$/.test(body)){
        const mm=body.match(/^\.(\w+)\s*\(\s*(.+)$/);
        if(mm)return {ind,tag:'inst_port_multi',port:mm[1],conn:mm[2].trim()};
    }
    // 例化端口: .port (conn),  或 .port(conn), — 允许空连接
    const im=body.match(/^\.(\w+)\s*\(\s*(.*?)\s*\)\s*,?\s*$/);
    if(im){
        return {ind,tag:'inst_port',port:im[1],conn:(im[2]||'').trim()};
    }
    // 信号声明
    const m=body.match(/^(input|output|inout|wire|reg|parameter|localparam|integer|genvar|logic|bit|int|tri|wand|wor)\b\s*(?:signed\s+)?(?:(\[[^\]]*\])\s*)?(\w+)\s*(.*)$/);
    if(!m)return null;
    let rest=m[4]||'';
    const tail=rest.match(/[,;]\s*$/)?rest.match(/[,;]\s*$/)[0].trim():'';
    rest=rest.replace(/[,;]\s*$/,'').trim();
    let eq='';const em=rest.match(/^\s*=\s*(.+)$/);if(em)eq=em[1].trim();
    return {ind,type:m[1],name:m[3],eq,tail,cl:rawCL,rr:rawRR};
}

function doFmt(entry, cols, orig){
    const cmt=orig.match(/(\/\/.*$)/);const cmPort=cmt?cmt[1].replace(/^\/\/(?!\s)/,'// '):'';const cmSig=cmPort;
    let body=orig.replace(/^\s*/,'').replace(/\s*\/\/.*$/,'').replace(/\s+$/,'');
    if(!body||/^(assign|always|if|else|case|endcase|begin|end|function|endfunction|task|endtask|generate|endgenerate|endmodule|module|initial|forever|while|for|@|#)\b/.test(body))return orig;
    if(/^\w+\s+#\s*\($/.test(body)||/^\).+\s*\($/.test(body)||/^\);?\s*$/.test(body))return orig;

    // 跨行端口首行: .port (expr... — 对齐端口名和(，末尾不加)
    if(entry.tag==='inst_port_multi'){
        const {ipCol}=cols;
        let r=entry.ind+'.'+entry.port;
        r+=' '.repeat(Math.max(1,ipCol-r.length));
        r+='('+entry.conn;
        return r+(cmPort?' '+cmPort:'');
    }
    // 例化端口: .port (conn),  — 保留原始逗号有无
    if(entry.tag==='inst_port'){
        const {ipCol,cpCol}=cols;
        const hasComma=/\)\s*,/.test(body);
        let r=entry.ind+'.'+entry.port;
        r+=' '.repeat(Math.max(1,ipCol-r.length));
        r+='('+entry.conn;
        r+=' '.repeat(Math.max(1,cpCol-r.length));
        r+=hasComma?'),':') ';
        return r+cmPort;
    }
    // 信号声明
    const {bc,cp,nc,ec,vc,cc}=cols;
    const m=body.match(/^(input|output|inout|wire|reg|parameter|localparam|integer|genvar|logic|bit|int|tri|wand|wor)\b\s*(?:signed\s+)?(?:(\[[^\]]*\])\s*)?(\w+)\s*(.*)$/);
    if(!m)return entry.ind+body.replace(/(\w)\s*=\s*(\d)/g,'$1 = $2')+cmSig;
    let rest=(m[4]||'').trim();
    const tail=rest.match(/[,;]\s*$/)?rest.match(/[,;]\s*$/)[0].trim():'';
    rest=rest.replace(/[,;]\s*$/,'').trim();
    let eq='';const em=rest.match(/^\s*=\s*(.+)$/);if(em)eq=em[1].trim();
    let width='';
    if(entry.cl)width='['+entry.cl+' '.repeat(Math.max(0,cp-entry.cl.length))+':'+entry.rr+']';
    let r=entry.ind+entry.type;
    r+=' '.repeat(Math.max(1,bc-r.length));
    if(width)r+=width;
    r+=' '.repeat(Math.max(1,nc-r.length));
    r+=entry.name;
    if(eq){r+=' '.repeat(Math.max(1,ec-r.length));r+='=';r+=' '.repeat(Math.max(1,vc-r.length));r+=eq;if(tail){r+=' '.repeat(Math.max(0,cc-r.length));r+=' '+tail;}}
    else if(rest||tail){r+=' '.repeat(Math.max(1,cc-r.length));r+=rest+(tail?' '+tail:'');}
    else{r+=' '.repeat(Math.max(1,cc-r.length));r+='  ';}
    return r+cmSig;
}

let _cachedXvlogPath=null;
function findXvlog(){
    const cfg=vscode.workspace.getConfiguration('verilogInstantiate');
    let xvl=cfg.get('xvlogPath','xvlog');
    if(xvl!=='xvlog' && fs.existsSync(xvl))return xvl;
    if(_cachedXvlogPath)return _cachedXvlogPath;
    const candidates=[];
    const roots=['C:/Xilinx/Vivado','D:/Xilinx/Vivado'];
    for(const r of roots){try{const vs=fs.readdirSync(r);for(const v of vs){if(/^\d/.test(v))candidates.push({ver:v,dir:path.join(r,v)});}}catch(e){}}
    for(const r of ['C:/Xilinx','D:/Xilinx']){try{const vs=fs.readdirSync(r);for(const v of vs){const vd=path.join(r,v);if(/^\d/.test(v)){try{fs.accessSync(path.join(vd,'bin','xvlog.bat'));candidates.push({ver:v,dir:vd});}catch(e){}}}}catch(e){}}
    candidates.sort((a,b)=>b.ver.localeCompare(a.ver,void 0,{numeric:true}));
    for(const c of candidates){const p=path.join(c.dir,'bin','xvlog.bat');if(fs.existsSync(p)){_cachedXvlogPath=p; return p;}}
    try{const r=cp.execSync('where xvlog.bat 2>nul',{encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim().split(/\r?\n/);if(r[0]&&fs.existsSync(r[0].trim())){_cachedXvlogPath=r[0].trim();return _cachedXvlogPath;}}catch(e){}
    _cachedXvlogPath='xvlog'; return 'xvlog';
}

function findIverilog(){
    var paths=['C:/iverilog/bin/iverilog.exe','C:/Program Files/iverilog/bin/iverilog.exe','D:/iverilog/bin/iverilog.exe'];
    for(var i=0;i<paths.length;i++){if(fs.existsSync(paths[i]))return 'iverilog';}
    try{var r=cp.execSync('where iverilog',{encoding:'utf8',timeout:2000,stdio:['pipe','pipe','pipe']});if(r&&r.trim())return 'iverilog';}catch(e){}
    return null;
}

function findModelsim(){
    // 搜索 C:/ D:/ 下的 model 相关目录
    for(var k=0;k<2;k++){
        var root=(k===0?'C:/':'D:/');
        try{var items=fs.readdirSync(root);for(var l=0;l<items.length;l++){
            if(!/model/i.test(items[l]))continue;
            var vlog=p.join(root,items[l],'win64','vlog.exe');
            if(fs.existsSync(vlog))return vlog;
        }}catch(e){}
    }
    try{var r=cp.execSync('where vlog',{encoding:'utf8',timeout:2000,stdio:['pipe','pipe','pipe']});if(r&&r.trim())return 'vlog';}catch(e){}
    return null;
}

function runIverilog(uri,diagColl,fp,fd){
    var child=cp.spawn('iverilog',['-g2012','-Wall','-t','null',fp],{cwd:fd});
    var out='';
    child.stderr.on('data',function(d){out+=d.toString();});
    child.stdout.on('data',function(d){out+=d.toString();});
    child.on('close',function(code){
        if(!out){diagColl.delete(uri);return;}
        var ignoreMissing=vscode.workspace.getConfiguration('verilogInstantiate').get('iverilogIgnoreMissingModule',true);
        var ps=[];
        var lines=out.split(/\r?\n/);
        for(var i=0;i<lines.length;i++){
            var m=lines[i].match(/^(.+):(\d+):\s+(.+)$/);
            if(m){
                var ln=parseInt(m[2])-1,msg=m[3].trim();
                if(ln<0||!msg)continue;
                // 过滤找不到例化模块的错误 (单体文件开发场景)
                if(ignoreMissing&&/Unknown module( type)?|module\b.*\bnot found|Module\b.*\bnot found/i.test(msg))continue;
                var sev=/error/i.test(msg)?vscode.DiagnosticSeverity.Error:vscode.DiagnosticSeverity.Warning;
                ps.push(new vscode.Diagnostic(new vscode.Range(ln,0,ln,9999),msg,sev));
            }
        }
        diagColl.set(uri,ps);
        try{fs.unlinkSync(path.join(fd,'a.out'));}catch(e){}
    });
}
function runModelsim(uri,diagColl,fp,fd){
    var vlog=findModelsim();
    if(!vlog)return;
    var child=cp.spawn('cmd',['/c',vlog,'-sv',fp],{cwd:fd});
    var out='';
    child.stdout.on('data',function(d){out+=d.toString();});
    child.stderr.on('data',function(d){out+=d.toString();});
    child.on('close',function(code){
        if(!out){diagColl.delete(uri);return;}
        var ps=[];
        // Modelsim/Questa 输出: ** Error: file.v(34): message
        // 或 ** Warning: file.v(34): message
        var lines=out.split(/\r?\n/);
        for(var j=0;j<lines.length;j++){
            var m=lines[j].match(/\*\*\s+(Error|Warning):\s+.+?\((\d+)\)\s*:\s*(.+)$/);
            if(m){
                var ln=parseInt(m[2])-1,msg=m[3].trim();
                if(ln>=0)ps.push(new vscode.Diagnostic(new vscode.Range(ln,0,ln,9999),msg,m[1]==='Warning'?vscode.DiagnosticSeverity.Warning:vscode.DiagnosticSeverity.Error));
            }
        }
        diagColl.set(uri,ps);
    });
}
function runXvlog(uri,diagColl,fp,fd){
    var xvl=findXvlog();
    if(!xvl||xvl==='xvlog')return;
    var child=cp.spawn('cmd',['/c',xvl,'-sv',fp],{cwd:fd});
    var out='';
    child.stdout.on('data',function(d){out+=d.toString();});
    child.stderr.on('data',function(d){out+=d.toString();});
    child.on('close',function(code){
        for(var f=0;f<4;f++){var ff=['xvlog.log','xvlog.pb','webtalk.log','webtalk.pb'][f];try{fs.unlinkSync(path.join(fd,ff));}catch(e){}}
        if(!out){diagColl.delete(uri);return;}
        var ps=[];
        var lines=out.split(/\r?\n/);
        for(var j=0;j<lines.length;j++){
            var m=lines[j].match(/(ERROR|WARNING|CRITICAL WARNING):\s*\[[^\]]+\]\s+(.+?)\s*\[.+?(\d+)\]$/);
            if(m&&m[1]!=='INFO'){
                var ln=parseInt(m[3])-1,msg=m[2].trim();
                var isWarn=m[1]==='WARNING'||m[1]==='CRITICAL WARNING';
                if(ln>=0)ps.push(new vscode.Diagnostic(new vscode.Range(ln,0,ln,9999),msg,isWarn?vscode.DiagnosticSeverity.Warning:vscode.DiagnosticSeverity.Error));
            }
        }
        diagColl.set(uri,ps);
    });
}
function doLint(uri,diagColl,force){
    try {
        var cfg=vscode.workspace.getConfiguration('verilogInstantiate');
        if(!force && !cfg.get('autoLintOnSave',true))return;
        var fp=uri.fsPath.replace(/\\/g,'/'),fd=path.dirname(fp);
        var tool=cfg.get('lintTool','auto');
        if(tool==='iverilog')runIverilog(uri,diagColl,fp,fd);
        else if(tool==='xvlog')runXvlog(uri,diagColl,fp,fd);
        else if(tool==='modelsim')runModelsim(uri,diagColl,fp,fd);
        else{
            if(findIverilog())runIverilog(uri,diagColl,fp,fd);
            else runXvlog(uri,diagColl,fp,fd);
        }
    } catch(e) { console.error('doLint:',e.message); }
}

function findDecl(doc,pos){
    const wr=doc.getWordRangeAtPosition(pos,/[\w`]+/);if(!wr)return null;
    const w=doc.getText(wr);if(!w||w.length<2)return null;
    for(let i=0;i<doc.lineCount;i++){
        const l=doc.lineAt(i).text.replace(/\/\/.*$/,'');
        if(new RegExp(`(?:input|output|inout|wire|reg|parameter|localparam|integer|genvar|logic|bit|int|tri|wand|wor|assign|function|task|module|event|time|real)\\s+(?:signed\\s+)?(?:\\[[^\\]]*\\]\\s*)?${escapeReg(w)}(?![\\w])`).test(l)){const ch=l.indexOf(w);if(ch>=0)return new vscode.Location(doc.uri,new vscode.Position(i,ch));}
    }return null;
}
function escapeReg(s){return s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');}

function parseModule(text){
    text=text.replace(/\/\*[\s\S]*?\*\//g,' ').replace(/\/\/.*/g,' ');
    text=text.replace(/\r?\n/g,' ').replace(/\s+/g,' ');
    const m=text.match(/module\s+(\w+)\s*(?:#\s*\(\s*([\s\S]*?)\s*\)\s*)?\(\s*([\s\S]*?)\s*\)\s*;/);
    if(!m)return null;
    return {name:m[1],params:parseParams(m[2]||''),ports:parsePorts(m[3]||'')};
}
function parseParams(s){if(!s.trim())return[];const r=[];for(const x of spComma(s)){const t=x.trim();if(!t)continue;const m1=t.match(/parameter\s+(?:signed\s+)?(?:(\[[^\]]*\])\s*)?(\w+)\s*(?:=\s*(.+?))?\s*$/);if(m1)r.push({width:(m1[1]||'').trim(),name:m1[2],value:(m1[3]||'').trim()});else{const m2=t.match(/^\s*(\w+)\s*(?:=\s*(.+?))?\s*$/);if(m2)r.push({width:'',name:m2[1],value:(m2[2]||'').trim()});}}return r;}
function parsePorts(s){if(!s.trim())return[];const r=[];let d='',t='',w='';for(const x of spComma(s)){const v=x.trim();if(!v)continue;const m=v.match(/^(input|output|inout)\s+(wire\s+|reg\s+|logic\s+)?(?:signed\s+)?(?:(\[[^\]]*\])\s*)?(.*)/);if(m){d=m[1];t=(m[2]||'').trim();w=(m[3]||'').trim();if(m[4].trim())r.push({dir:d,type:t||(d==='output'?'wire':''),width:w,name:m[4].trim().replace(/[,;]$/,'')});}else if(d)r.push({dir:d,type:t||(d==='output'?'wire':''),width:w,name:v.replace(/[,;]$/,'')});}return r;}
function spComma(s){const r=[];let d=0,c='';for(const ch of s){if(ch==='('||ch==='[')d++;else if(ch===')'||ch===']')d--;if(ch===','&&d===0){r.push(c);c='';}else c+=ch;}if(c.trim())r.push(c);return r;}

// 从原始文本提取 section注释/参数/端口声明行原文
function extractComments(text,mod){
    const lines=text.split(/\r?\n/);
    const result={ports:{}};
    let pendingSection=null, inParams=false, inPorts=false;
    for(const line of lines){
        const t=line.trim();
        if(!t)continue;
        // # 或 #( → 参数列表开始 (#和(可能在不同行, #可能在行尾)
        if(/^:?\s*#\s*$/.test(t)||/#\s*$/.test(t)||/#\s*:?\s*\($/.test(t)||/#\s*\($/.test(t)){inParams=true;continue;}
        // :( 或单独的 ( — 紧跟 # 之后, 仍在参数区
        if(inParams&&/^:?\s*\($/.test(t))continue;
        // ) → 参数列表结束
        if(inParams&&/^\s*\)\s*$/.test(t)){inParams=false;continue;}
        // module NAME( → 无参数模块, 端口列表开始
        if(!inParams&&!inPorts&&/^module\s+\w+\s*:?\s*\(/.test(t)){inPorts=true;continue;}
        // ( → 端口列表开始 (在 params 刚结束后)
        if(!inParams&&!inPorts&&/^:?\s*\($/.test(t)){inPorts=true;continue;}
        // ) ( 或 ) → 合并行
        if(inParams&&/^\s*\)\s*:?\s*\(?\s*$/.test(t)){inParams=false;inPorts=true;continue;}
        if(inPorts&&/^\s*\)\s*;/.test(t)){inPorts=false;continue;}

        if(inParams){
            if(/^\/\//.test(t)){pendingSection=line;continue;}
            const pm=t.match(/^\s*parameter\s+(?:signed\s+)?(?:\[[^\]]*\]\s*)?(\w+)/);
            if(pm){
                if(!result.ports[pm[1]])result.ports[pm[1]]={};
                if(pendingSection){result.ports[pm[1]].section=pendingSection;pendingSection=null;}
                result.ports[pm[1]].decl=line;
            }
            continue;
        }
        if(!inPorts)continue;
        if(/^\/\//.test(t)){pendingSection=line;continue;}
        const m=t.match(/^(input|output|inout)\s+(?:wire\s+|reg\s+)?(?:signed\s+)?(?:(\[[^\]]*\])\s*)?(\w+)/);
        if(m){
            const pn=m[3].replace(/[,;]$/,'');
            if(!result.ports[pn])result.ports[pn]={};
            if(pendingSection){result.ports[pn].section=pendingSection;pendingSection=null;}
            result.ports[pn].decl=line;
        }
    }
    return result;
}

function genInst(mod,indent){
    const tab=indent.length||4;
    const comments=mod.comments||{ports:{}};
    let mp=0,mv=0;
    mod.params.forEach(p=>{if(p.name.length>mp)mp=p.name.length;if(p.name.length>mv)mv=p.name.length;});
    mod.ports.forEach(p=>{if(p.name.length>mp)mp=p.name.length;if(p.name.length>mv)mv=p.name.length;});
    const pCol=padToTab(mp+2,tab)+tab;
    const cpCol=padToTab(pCol+mv+1,tab);
    const name=mod.name,iname=name+'_U0';
    const ls=[];ls.push(name+' #(');
    // 参数 — 从原文提取注释
    mod.params.forEach((p,i)=>{
        const ci=comments.ports[p.name]||{};
        if(ci.section)ls.push(ci.section);
        let comment='';
        if(ci&&ci.decl)comment=ci.decl.replace(/^\s+/,'');else comment='parameter '+p.name+' = '+(p.value||'');
        let l=indent+'.'+p.name;l+=' '.repeat(Math.max(1,pCol-l.length));
        l+='('+p.name;l+=' '.repeat(Math.max(1,cpCol-l.length));
        l+=(i===mod.params.length-1)?') ':'),';
        l+='// '+comment;
        ls.push(l);
    });
    ls.push(') '+iname+' (');
    // 端口
    mod.ports.forEach((p,i)=>{
        const ci=comments.ports[p.name]||{};
        if(ci.section)ls.push(ci.section);
        let l=indent+'.'+p.name;l+=' '.repeat(Math.max(1,pCol-l.length));
        l+='('+p.name;l+=' '.repeat(Math.max(1,cpCol-l.length));
        if(i===mod.ports.length-1)l+=') ';
        else l+='),';
        l+='// '+((ci.decl||'').replace(/^\s+/,'')); // 原文声明作注释
        ls.push(l);
    });
    ls.push(');');
    return '\n'+ls.join('\n')+'\n';
}

function deactivate(){}
module.exports={activate,deactivate};
