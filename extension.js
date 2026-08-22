const vscode = require('vscode');
const cp = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const {registerWorkspaceFeatures} = require('./workspace-features');

function padToTab(c,t){return Math.ceil(c/t)*t;}
function normalizeTabSize(value){const n=Number(value);if(!Number.isFinite(n))return 4;return Math.min(16,Math.max(1,Math.trunc(n)));}
function getTabSize(){return normalizeTabSize(vscode.workspace.getConfiguration('verilogInstantiate').get('tabSize',4));}
function selectionEndLine(selection){if(selection.isEmpty)return selection.active.line;if(selection.end.character===0&&selection.end.line>selection.start.line)return selection.end.line-1;return selection.end.line;}
function resolveLintToolName(configuredTool,toolOverride){const tool=toolOverride||configuredTool;return ['auto','iverilog','xvlog','modelsim'].includes(tool)?tool:'auto';}

const lintTimers = new Map();
const lintSeq = new Map();

function lintKey(uri){return uri.toString();}
function nextLintSeq(uri){const key=lintKey(uri);const seq=(lintSeq.get(key)||0)+1;lintSeq.set(key,seq);return seq;}
function isCurrentLint(uri,seq){return lintSeq.get(lintKey(uri))===seq;}
function scheduleLint(uri,diagColl,force,delay,toolOverride){
    const key=lintKey(uri);
    const old=lintTimers.get(key);
    if(old)clearTimeout(old);
    nextLintSeq(uri);
    const timer=setTimeout(()=>{lintTimers.delete(key);doLint(uri,diagColl,force,toolOverride);},delay);
    lintTimers.set(key,timer);
}
function cancelLint(uri){
    const key=lintKey(uri);
    const old=lintTimers.get(key);
    if(old)clearTimeout(old);
    lintTimers.delete(key);
    nextLintSeq(uri);
}
function applyLintDiagnostics(uri,diagColl,seq,items){
    if(isCurrentLint(uri,seq))diagColl.set(uri,items);
}
function clearLintDiagnostics(uri,diagColl,seq){
    if(isCurrentLint(uri,seq))diagColl.delete(uri);
}
function isOwnedLintTempDir(dir){
    if(!dir)return false;
    const tempRoot=path.resolve(os.tmpdir());
    const resolved=path.resolve(dir);
    const relative=path.relative(tempRoot,resolved);
    if(!relative||path.isAbsolute(relative)||relative.startsWith('..'+path.sep))return false;
    return /^otter-(iverilog|modelsim|xvlog)-[^\\/]+$/.test(relative);
}
function cleanupDir(dir){
    if(!isOwnedLintTempDir(dir)){
        if(dir)console.warn('Otter refused to clean non-owned lint path:',dir);
        return;
    }
    try{
        if(!fs.existsSync(dir))return;
        const stat=fs.lstatSync(dir);
        if(!stat.isDirectory()||stat.isSymbolicLink()){
            console.warn('Otter refused to clean unexpected lint temp entry:',dir);
            return;
        }
        fs.rmSync(dir,{recursive:true,force:true});
    }
    catch(e){console.warn('Otter lint temp cleanup failed:',dir,e.message);}
}

function activate(context) {
    const diagColl = vscode.languages.createDiagnosticCollection('verilog-xvlog');
    context.subscriptions.push(diagColl);
    registerWorkspaceFeatures(context,findDecl,findXvlog);

    //===== 例化 =====
    context.subscriptions.push(vscode.commands.registerCommand('verilog-instantiate.generateInstance', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor || !['verilog','systemverilog'].includes(editor.document.languageId)) return;
        const tb = getTabSize();
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
        const tab = getTabSize();
        const sel = editor.selection;
        const s=sel.isEmpty?sel.active.line:sel.start.line, e=selectionEndLine(sel);
        const doc = editor.document;

        // 解析 — v2.0.2 fix3: function/task/tab
        let mt=0,mn=0,me=0,mcl=0,he=0;
        let ipMaxN=0, ipMaxC=0;
        const all=[],byLine=new Map();
        for(let i=0;i<doc.lineCount;i++){
            const p=parseLine(doc.lineAt(i).text, tab);
            if(!p)continue;
            const entry={i,...p};all.push(entry);byLine.set(i,entry);
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
            const entry=byLine.get(i);
            if(!entry)continue;
            const cols=(entry.tag==='inst_port'||entry.tag==='inst_port_multi')?{ipCol,cpCol}:sigCols;
            const fmt=doFmt(entry, cols, orig);
            if(fmt!==orig)edits.push(vscode.TextEdit.replace(new vscode.Range(i,0,i,orig.length),fmt));
        }
        if(edits.length)await editor.edit(eb=>edits.forEach(x=>eb.replace(x.range,x.newText)));
    }));

    //===== xvlog =====
    context.subscriptions.push(vscode.commands.registerCommand('verilog-instantiate.xvlogLint', async () => {
        const ed=vscode.window.activeTextEditor;
        if(!ed||!isV(ed.document)){vscode.window.showWarningMessage('请在 Verilog/SystemVerilog 文件中运行 xvlog 检查');return;}
        const saved=await ed.document.save();if(!saved)return;
        scheduleLint(ed.document.uri,diagColl,true,0,'xvlog');
    }));
    const saveSub=vscode.workspace.onDidSaveTextDocument(d=>{if(isV(d))scheduleLint(d.uri,diagColl,false,200);});
    context.subscriptions.push(saveSub);
    const openSub=vscode.workspace.onDidOpenTextDocument(d=>{
        if(isV(d)&&vscode.workspace.getConfiguration('verilogInstantiate').get('lintOnOpen',false))scheduleLint(d.uri,diagColl,false,500);
    });
    context.subscriptions.push(openSub);
    const changeSub=vscode.window.onDidChangeActiveTextEditor(ed=>{
        if(ed&&isV(ed.document)&&vscode.workspace.getConfiguration('verilogInstantiate').get('lintOnActiveEditorChange',false))scheduleLint(ed.document.uri,diagColl,false,500);
    });
    context.subscriptions.push(changeSub);
    const closeSub=vscode.workspace.onDidCloseTextDocument(d=>{if(isV(d)){cancelLint(d.uri);diagColl.delete(d.uri);}});
    context.subscriptions.push(closeSub);
    const ae=vscode.window.activeTextEditor;
    if(ae&&isV(ae.document)&&vscode.workspace.getConfiguration('verilogInstantiate').get('lintOnOpen',false))scheduleLint(ae.document.uri,diagColl,false,500);

    //===== 跳转/悬停 =====
    context.subscriptions.push(vscode.languages.registerHoverProvider(['verilog','systemverilog'],{provideHover(doc,pos){
        const w=doc.getWordRangeAtPosition(pos,/[\w`]+/);if(!w)return null;
        const loc=findDecl(doc,pos);if(loc){const ln=loc.range.start.line+1;const md=new vscode.MarkdownString();md.appendMarkdown('*Line '+ln+'*  \n');md.appendCodeblock(doc.lineAt(loc.range.start.line).text.trim(),'verilog');return new vscode.Hover(md,w);}
        return null;
    }}));

    //===== 补全 =====
    context.subscriptions.push(vscode.languages.registerCompletionItemProvider(['verilog','systemverilog'],{
        provideCompletionItems(doc,pos){
            if(!vscode.workspace.getConfiguration('verilogInstantiate').get('enableCompletion',true))return [];
            const list=[],t=' '.repeat(getTabSize());
            const add=(lbl,txt,det,kind)=>{
                const ci=new vscode.CompletionItem(lbl,kind||vscode.CompletionItemKind.Snippet);
                ci.insertText=new vscode.SnippetString(txt);ci.detail='[Otter] '+(det||'');list.push(ci);
            };
            // 基本模块结构
            add('module',`module \${1:name} (\n${t}\${2:ports}\n);\n\n\${3}\n\nendmodule //\${1}`,'module..endmodule');
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
                var dd=parseDeclBody(line);
                if(dd){
                    var names=declNames(dd);
                    for(var ni=0;ni<names.length;ni++){
                        var dn=names[ni];
                        if(dn&&dn.length>1&&!seen[dn]){
                            seen[dn]=true;
                            var ci2=new vscode.CompletionItem(dn,vscode.CompletionItemKind.Variable);
                            ci2.detail='[Otter] '+dd.type+' (line '+(i+1)+')';
                            ci2.sortText='2_'+dn;
                            list.push(ci2);
                        }
                    }
                }
            }
            return list;
        }
    }));
}

function isV(d){return ['verilog','systemverilog'].includes(d.languageId);}

function parseDeclBody(body){
    if(!body)return null;
    let rest=body.replace(/\t/g,' ').replace(/^\s+/,'').replace(/\s+$/,'');
    const km=rest.match(/^(input|output|inout|wire|reg|parameter|localparam|integer|genvar|logic|bit|int|tri|wand|wor)\b/);
    if(!km)return null;
    const base=km[1];
    let type=base;
    rest=rest.slice(km[0].length).replace(/^\s+/,'');
    if(/^(input|output|inout)$/.test(base)){
        const tm=rest.match(/^(wire|reg|logic)\b/);
        if(tm){type+=' '+tm[1];rest=rest.slice(tm[0].length).replace(/^\s+/,'');}
    }else if(/^(parameter|localparam)$/.test(base)){
        const tm=rest.match(/^(integer|real|realtime|time|logic|bit|int)\b/);
        if(tm){type+=' '+tm[1];rest=rest.slice(tm[0].length).replace(/^\s+/,'');}
    }
    const sm=rest.match(/^signed\b/);
    if(sm){type+=' signed';rest=rest.slice(sm[0].length).replace(/^\s+/,'');}
    let width='',cl='',rr='';
    const wm=rest.match(/^\[([^\]]*)\]\s*/);
    if(wm){
        width='['+wm[1]+']';
        const cm=wm[1].match(/^(.+?)\s*:\s*(\S+)$/);
        if(cm){cl=cm[1];rr=cm[2];}
        rest=rest.slice(wm[0].length).replace(/^\s+/,'');
    }
    const nm=rest.match(/^(\w+)\s*(.*)$/);
    if(!nm)return null;
    return {base,type,width,cl,rr,name:nm[1],rest:nm[2]||''};
}

function declNames(decl){
    const out=[decl.name];
    const rest=(decl.rest||'').replace(/\/\/.*$/,'');
    if(/^\s*=/.test(rest))return out;
    const parts=rest.replace(/;.*/,'').split(',');
    for(let i=0;i<parts.length;i++){
        const m=parts[i].trim().match(/^(\w+)\b/);
        if(m)out.push(m[1]);
    }
    return out;
}

function parseLine(line, tab){
    if(!line)return null;
    tab=tab||4;
    const rawInd=line.match(/^(\s*)/)[1];
    const ind=rawInd.replace(/\t/g,' '.repeat(tab));
    let rawBody=line.replace(/^\s*/,'').replace(/\s*\/\/.*$/,'').replace(/\s+$/,'').replace(/\t/g,' ');
    let body=rawBody;
    if(!body)return null;

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
    const d=parseDeclBody(rawBody);
    if(!d)return null;
    let rest=d.rest||'';
    const tail=rest.match(/[,;]\s*$/)?rest.match(/[,;]\s*$/)[0].trim():'';
    rest=rest.replace(/[,;]\s*$/,'').trim();
    let eq='';const em=rest.match(/^\s*=\s*(.+)$/);if(em)eq=em[1].trim();
    return {ind,type:d.type,name:d.name,eq,tail,rest:eq?'':rest,width:d.width,cl:d.cl,rr:d.rr};
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
    let rest=entry.rest||'', tail=entry.tail||'', eq=entry.eq||'';
    let width='';
    if(entry.cl&&entry.rr)width='['+entry.cl+' '.repeat(Math.max(0,cp-entry.cl.length))+':'+entry.rr+']';
    else if(entry.width)width=entry.width;
    let r=entry.ind+entry.type;
    r+=' '.repeat(Math.max(1,bc-r.length));
    if(width)r+=width;
    r+=' '.repeat(Math.max(1,nc-r.length));
    r+=entry.name;
    if(eq){r+=' '.repeat(Math.max(1,ec-r.length));r+='=';r+=' '.repeat(Math.max(1,vc-r.length));r+=eq;if(tail){r+=' '.repeat(Math.max(0,cc-r.length));r+=' '+tail;}else{r+=' '.repeat(Math.max(1,cc-r.length));r+='  ';}}
    else if(rest||tail){r+=' '.repeat(Math.max(1,cc-r.length));r+=rest+(tail?' '+tail:'');}
    else{r+=' '.repeat(Math.max(1,cc-r.length));r+='  ';}
    return r+cmSig;
}

//===== include 路径自动检测 =====
function findIncludePaths(fp){
    var cfg=vscode.workspace.getConfiguration('verilogInstantiate');
    var customPaths=cfg.get('includePaths',[]);
    var result=[];
    for(var i=0;i<customPaths.length;i++){
        var p=customPaths[i].replace(/\\/g,'/'); if(p&&result.indexOf(p)<0)result.push(p);
    }
    // 未配置时自动向上搜索 3 层找 inc/rtl/src/include/hdl 目录
    if(!result.length){
        var dir=path.dirname(fp);
        var searchDirs=['inc','include','rtl','src','hdl'];
        for(var d=0;d<3;d++){
            if(!fs.existsSync(dir))break;
            for(var s=0;s<searchDirs.length;s++){
                var sd=path.join(dir,searchDirs[s]);
                if(!fs.existsSync(sd))continue;
                try{
                    var items=fs.readdirSync(sd); var found=false;
                    for(var k=0;k<items.length;k++){if(/\.(vh|svh)$/i.test(items[k])){found=true;break;}}
                    if(found){sd=sd.replace(/\\/g,'/');if(result.indexOf(sd)<0)result.push(sd);}
                }catch(e){}
            }
            var parent=path.dirname(dir); if(parent===dir)break; dir=parent;
        }
    }
    return result;
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
    for(var i=0;i<paths.length;i++){if(fs.existsSync(paths[i]))return paths[i];}
    try{var r=cp.execSync('where iverilog',{encoding:'utf8',timeout:2000,stdio:['pipe','pipe','pipe']}).trim().split(/\r?\n/);if(r[0])return r[0].trim();}catch(e){}
    return null;
}

function findModelsim(){
    // 搜索 C:/ D:/ 下的 model 相关目录
    for(var k=0;k<2;k++){
        var root=(k===0?'C:/':'D:/');
        try{var items=fs.readdirSync(root);for(var l=0;l<items.length;l++){
            if(!/model/i.test(items[l]))continue;
            var vlog=path.join(root,items[l],'win64','vlog.exe');
            if(fs.existsSync(vlog))return vlog;
        }}catch(e){}
    }
    try{var r=cp.execSync('where vlog',{encoding:'utf8',timeout:2000,stdio:['pipe','pipe','pipe']});if(r&&r.trim())return 'vlog';}catch(e){}
    return null;
}

function runIverilog(uri,diagColl,fp,seq,exe){
    exe=exe||findIverilog();
    if(!exe)return false;
    var incPaths=findIncludePaths(fp);
    var workDir=fs.mkdtempSync(path.join(os.tmpdir(),'otter-iverilog-'));
    var outFile=path.join(workDir,'lint.out');
    var args=['-g2012','-Wall','-t','null','-o',outFile];
    for(var i=0;i<incPaths.length;i++){args.push('-I');args.push(incPaths[i]);}
    args.push(fp);
    var child=cp.spawn(exe,args,{cwd:workDir});
    var out='';
    child.stderr.on('data',function(d){out+=d.toString();});
    child.stdout.on('data',function(d){out+=d.toString();});
    child.on('error',function(e){clearLintDiagnostics(uri,diagColl,seq);cleanupDir(workDir);});
    child.on('close',function(code){
        try{
            if(!out){clearLintDiagnostics(uri,diagColl,seq);return;}
            var ignoreMissing=vscode.workspace.getConfiguration('verilogInstantiate').get('iverilogIgnoreMissingModule',true);
            var ps=[];
            var lines=out.split(/\r?\n/);
            for(var i=0;i<lines.length;i++){
                var m=lines[i].match(/^(.+):(\d+):\s+(.+)$/);
                if(m){
                    var ln=parseInt(m[2])-1,msg=m[3].trim();
                    if(ln<0||!msg)continue;
                    // 过滤 iverilog 编译器退出信息 (非语法错误)
                    if(/Verilog Compiler exiting/i.test(msg))continue;
                    // 过滤找不到例化模块的错误 (单体文件开发场景)
                    if(ignoreMissing&&/Unknown module( type)?|module\b.*\bnot found|Module\b.*\bnot found/i.test(msg))continue;
                    var sev=/error/i.test(msg)?vscode.DiagnosticSeverity.Error:vscode.DiagnosticSeverity.Warning;
                    ps.push(new vscode.Diagnostic(new vscode.Range(ln,0,ln,9999),msg,sev));
                }
            }
            applyLintDiagnostics(uri,diagColl,seq,ps);
        }finally{
            cleanupDir(workDir);
        }
    });
    return true;
}
function runModelsim(uri,diagColl,fp,seq){
    var vlog=findModelsim();
    if(!vlog)return false;
    var incPaths=findIncludePaths(fp);
    var args=['/c',vlog,'-sv'];
    for(var i=0;i<incPaths.length;i++){args.push('+incdir+'+incPaths[i]);}
    args.push(fp);
    var workDir=fs.mkdtempSync(path.join(os.tmpdir(),'otter-modelsim-'));
    var child=cp.spawn('cmd',args,{cwd:workDir});
    var out='';
    child.stdout.on('data',function(d){out+=d.toString();});
    child.stderr.on('data',function(d){out+=d.toString();});
    child.on('error',function(e){clearLintDiagnostics(uri,diagColl,seq);cleanupDir(workDir);});
    child.on('close',function(code){
        try{
            if(!out){clearLintDiagnostics(uri,diagColl,seq);return;}
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
            applyLintDiagnostics(uri,diagColl,seq,ps);
        }finally{
            cleanupDir(workDir);
        }
    });
    return true;
}
function runXvlog(uri,diagColl,fp,seq){
    var xvl=findXvlog();
    if(!xvl||xvl==='xvlog')return false;
    var incPaths=findIncludePaths(fp);
    var args=['/c',xvl,'-sv'];
    for(var i=0;i<incPaths.length;i++){args.push('-i');args.push(incPaths[i]);}
    args.push(fp);
    var workDir=fs.mkdtempSync(path.join(os.tmpdir(),'otter-xvlog-'));
    var cleanup=function(){cleanupDir(workDir);};
    var child=cp.spawn('cmd',args,{cwd:workDir});
    var out='';
    child.stdout.on('data',function(d){out+=d.toString();});
    child.stderr.on('data',function(d){out+=d.toString();});
    child.on('error',function(e){clearLintDiagnostics(uri,diagColl,seq);cleanup();});
    child.on('close',function(code){
        try{
            if(!out){clearLintDiagnostics(uri,diagColl,seq);return;}
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
            applyLintDiagnostics(uri,diagColl,seq,ps);
        }finally{
            cleanup();
        }
    });
    return true;
}
function missingLintToolMessage(tool){
    if(tool==='iverilog')return '未找到 Icarus Verilog (iverilog)，请安装工具或调整 Lint Tool 设置';
    if(tool==='xvlog')return '未找到 Vivado xvlog，请检查 verilogInstantiate.xvlogPath';
    if(tool==='modelsim')return '未找到 ModelSim/Questa vlog，请检查安装目录或 PATH';
    return '未找到可用的 Verilog 语法检查工具';
}
function doLint(uri,diagColl,force,toolOverride){
    var seq=null;
    try {
        var cfg=vscode.workspace.getConfiguration('verilogInstantiate');
        if(!force && !cfg.get('autoLintOnSave',true))return;
        var fp=uri.fsPath.replace(/\\/g,'/');
        var tool=resolveLintToolName(cfg.get('lintTool','auto'),toolOverride);
        seq=nextLintSeq(uri);
        var started=false;
        if(tool==='iverilog')started=runIverilog(uri,diagColl,fp,seq);
        else if(tool==='xvlog')started=runXvlog(uri,diagColl,fp,seq);
        else if(tool==='modelsim')started=runModelsim(uri,diagColl,fp,seq);
        else{
            var iverilog=findIverilog();
            if(iverilog)started=runIverilog(uri,diagColl,fp,seq,iverilog);
            else started=runXvlog(uri,diagColl,fp,seq);
        }
        if(!started){
            clearLintDiagnostics(uri,diagColl,seq);
            if(force)vscode.window.showWarningMessage(missingLintToolMessage(tool));
        }
    } catch(e) {
        if(seq!==null)clearLintDiagnostics(uri,diagColl,seq);
        console.error('doLint:',e.message);
        if(force)vscode.window.showErrorMessage('语法检查启动失败: '+e.message);
    }
}

function findDecl(doc,pos){
    const wr=doc.getWordRangeAtPosition(pos,/[\w`]+/);if(!wr)return null;
    const w=doc.getText(wr);if(!w||w.length<2)return null;
    for(let i=0;i<doc.lineCount;i++){
        const l=doc.lineAt(i).text.replace(/\/\/.*$/,'');
        const d=parseDeclBody(l);
        if(d){
            const names=declNames(d);
            for(let ni=0;ni<names.length;ni++){
                if(names[ni]===w){
                    const ch=l.indexOf(w,ni===0?0:l.indexOf(d.name)+d.name.length);
                    if(ch>=0)return new vscode.Location(doc.uri,new vscode.Position(i,ch));
                }
            }
        }
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
function parseParams(s){if(!s.trim())return[];const r=[];for(const x of spComma(s)){const t=x.trim();if(!t)continue;const d=parseDeclBody(t);if(d&&/^(parameter|localparam)$/.test(d.base)){const em=(d.rest||'').trim().match(/^=\s*(.+?)\s*$/);r.push({width:d.width,name:d.name,value:(em?em[1]:'').trim()});continue;}const m2=t.match(/^\s*(\w+)\s*(?:=\s*(.+?))?\s*$/);if(m2)r.push({width:'',name:m2[1],value:(m2[2]||'').trim()});}return r;}
function parsePorts(s){if(!s.trim())return[];const r=[];let d='',t='',w='';for(const x of spComma(s)){const v=x.trim();if(!v)continue;const pd=parseDeclBody(v);if(pd&&/^(input|output|inout)$/.test(pd.base)){d=pd.base;t=pd.type.replace(new RegExp('^'+pd.base+'\\s*'),'').trim();w=pd.width;if(pd.name)r.push({dir:d,type:t||(d==='output'?'wire':''),width:w,name:pd.name.replace(/[,;]$/,'')});}else if(d)r.push({dir:d,type:t||(d==='output'?'wire':''),width:w,name:v.replace(/[,;]$/,'')});}return r;}
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
            const pd=parseDeclBody(t);
            if(pd&&/^(parameter|localparam)$/.test(pd.base)){
                if(!result.ports[pd.name])result.ports[pd.name]={};
                if(pendingSection){result.ports[pd.name].section=pendingSection;pendingSection=null;}
                result.ports[pd.name].decl=line;
            }
            continue;
        }
        if(!inPorts)continue;
        if(/^\/\//.test(t)){pendingSection=line;continue;}
        const pd=parseDeclBody(t);
        if(pd&&/^(input|output|inout)$/.test(pd.base)){
            const pn=pd.name.replace(/[,;]$/,'');
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
    const ls=[];
    if(mod.params.length){
        ls.push(name+' #(');
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
    }else{
        ls.push(name+' '+iname+' (');
    }
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
module.exports={
    activate,
    deactivate,
    __test:{normalizeTabSize,selectionEndLine,resolveLintToolName,missingLintToolMessage,isOwnedLintTempDir,parseDeclBody,declNames,parseLine,doFmt,parseModule,spComma,genInst}
};
