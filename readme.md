# Otter FPGA Toolkit - 水獭FPGA工具集

> 小水獭的 FPGA/Verilog 开发利器，集成语法检查、一键例化、代码排版、高亮、端口方向提示、跨文件跳转和模块层次树

## 2.1.19 更新

- 模块体采用CST声明排版，跨分区统一 localparam/reg/wire/genvar 列；数组维度与范围冒号按语法结构处理。
- VS Code和CLI共用引擎，支持中文、BOM、选区与长初值；编辑器后台排版，解析失败不改源码。
- 此版本提供 **Windows x64** 安装包，内置Verible解析器；完整范围与限制见下方“代码排版”。

## 功能一览

| 功能 | 快捷键/触发 | 说明 |
|------|-----------|------|
| 一键例化 | `Ctrl+1` | 选中 module 声明，自动生成带注释对齐的例化模板 |
| 代码排版 | `Ctrl+L` | 同作用域声明统一列宽，保留模块头和例化版式 |
| 语法检查 | 保存自动 | 支持 Icarus Verilog / Vivado xvlog / ModelSim-Questa vlog |
| 语法高亮 | 自动 | Verilog/SystemVerilog 关键字、常量、运算符和过程信号 + SDC/XDC/CST 约束文件 |
| 定义跳转 | `F12` | 跳转到本地信号/参数，或跨文件跳转到例化模块定义 |
| 悬停提示 | 鼠标悬停 | 显示定义行号 + 原代码 |
| 代码补全 | 输入提示 | 25+ 模板 (module/always/case/fsm) + 当前文件信号名 |
| 参数/端口提示 | 自动 | 在 named connection 的括号内显示 `param` / `input` / `output` / `inout`，不修改 RTL 文本 |
| 模块层次树 | 编辑器右上角层次图标 | 点击后自动打开底部 `Otter FPGA` Panel，只展开当前 module |

## 安装方法

### 从 VSIX 安装

1. 下载 `otter-fpga-toolkit-x.x.x.vsix`
2. VSCode/CodeBuddy → `Ctrl+Shift+X` → `...` → `Install from VSIX...`
3. 选择 vsix 文件
4. `Ctrl+Shift+P` → `Developer: Reload Window`

### 从源码运行

```powershell
cd otter-fpga-toolkit
# 先运行内置检查
npm test
# 按 F5 启动调试模式，或把测试 VSIX 输出到仓库根目录
npx.cmd -y @vscode/vsce package --target win32-x64 --out otter-fpga-toolkit-<version>-test-<commit>.vsix
```

## 使用说明

### WaveDrom 注释预览（测试功能）

在Verilog/SystemVerilog注释中使用 `// ```wavedrom` 到 `// ``` ` 围栏，内部为WaveDrom JSON/JSON5；Markdown中的同名围栏也可识别。

- 点击块上方“查看波形（就地浮层）”，或光标位于块内时按`Alt+W`，在源码附近查看；`Esc`关闭，源码和编辑区布局不变。
- 浮层中的“打开大图”是可选独立面板，支持缩放；“导出SVG”始终对应该浮层的文件与波形块。
- 长图使用插件临时图片缓存，避免过长SVG被悬浮提示截断；不在RTL工程内落预览文件，扩展退出时清理缓存。
- 使用普通VS Code Hover API，不是源码行间折叠编辑器；不启用实验API，发布版本号仍为2.1.19。测试包确认后再独立决定正式发布。
- 注释图是设计示意，除非另有真实trace来源，渲染成功不代表仿真或时序验证通过。

### 一键例化 `Ctrl+1`

1. 光标放在 Verilog 文件中（包含 module 声明）
2. 按 `Ctrl+1`
3. 例化模板自动插入：

```verilog
// 输入:
module test_module #(
    parameter P_DATA = 16
)(
    input  clk,
    output data
);

// 按 Ctrl+1 → 生成:
test_module #(
    .P_DATA       (P_DATA       ),// parameter P_DATA = 16
) test_module_U0 (
    .clk          (clk          ),// input  clk
    .data         (data         ) // output data
);
```

### 代码排版 `Ctrl+L`

- 无选区时只整理当前行；整理全文使用 **Ctrl+A → Ctrl+L**。选区外不改，列宽参考完整作用域。
- 模块体声明使用 Verible CST（具体语法树）。同一 module 的 parameter/localparam/reg/logic/wire/独立 genvar 跨空行和分区统一关键字、修饰符、位宽、名称和等号列；generate 块单独计算。无需特定分区标题，同作用域沿用首条声明的缩进。
- 单维 packed 范围的左表达式靠左，补齐空格放在冒号前（如 `[7      :0]`）。三目、嵌套索引、package::name 由语法节点识别。多维、unpacked 数组和表达式内部空白保留，不强制换行。
- 参数、变量、网络各自计算初始化表达式尾列；超过 96 字符的初值就近结束本行，不撑宽其它行的分号。声明头按实际最大长度对齐，允许较长单行。布局参数集中在 `layout-profile.json`。
- 独立 `genvar g_ch;` 或名称列表参与名称列对齐；`for(genvar ...)` 循环头保持原样。
- 模块头参数/端口表、例化连接保留既有版式；assign、always、函数、任务和过程内声明保持原样。多变量 reg/wire、跨行、声明内块注释及其它未覆盖结构保留并报告。
- 输入必须能通过解析器的语法解析。解析失败不修改文件；输出重新解析并核对 token 序列，不改逻辑。编辑器在 worker 中排版，写入前检查文档版本，避免覆盖期间的编辑。

当前随包附带 **Windows x64** Verible 解析器，无需单独安装或联网下载。其它平台尚未提供解析器；`.vh/.svh` 仅在包含可独立解析的完整结构时适用。源码接入不代表 Marketplace 已发布，版本仍以已发布记录为准。解析器来源、许可和维护方法见 [排版引擎维护](docs/formatter.md)。

同一套排版逻辑也可以在编辑器外调用，便于自动化任务复用 `Ctrl+L` 的实际实现：

```powershell
node .\format-cli.js --check E:\path\to\module.sv
node .\format-cli.js --write E:\path\to\module.sv
node .\format-cli.js --write --start-line 20 --end-line 80 E:\path\to\module.sv
node .\format-cli.js --check --json E:\path\to\module.sv
```

`--check` 只检查且不写文件；需要排版时退出码为 `1`。`--write` 才会原位修改文件。
行号从 `1` 开始并包含首尾行；只处理一个范围时，对齐列仍参考完整的所属 module/generate 作用域，选区外行不写入，
与编辑器选区执行 `Ctrl+L` 的行为一致。命令保留原文件的 `CRLF/LF` 和 UTF-8 BOM。

#### 智能体/自动化接口

智能体优先调用 `--check --json`：退出码 `0` 表示无需修改，`1` 表示需要格式化，`2` 表示调用错误；JSON 返回 `status`、`changedLines`、`wrote`、保留声明列表 `skipped` 和绝对文件路径。只有获得写入授权后才调用 `--write --json`。Node 调用方也可以直接引用 `format-cli.js` 导出的 `formatFile()`；`package.json` 同时声明可执行入口 `otter-fpga-format`。

VS Code 内的其他扩展或智能体可以通过稳定命令接口调用已安装的插件：

```javascript
const result = await vscode.commands.executeCommand(
    'otter-fpga-toolkit.formatFile',
    {mode: 'check', file: 'E:\\path\\to\\module.sv'}
);
```

`mode` 默认为 `check`，可选 `tabSize`、`startLine` 和 `endLine`（行号从 `1` 开始且包含首尾）；只有显式传入 `mode: 'write'` 才会写文件。返回值与 JSON CLI 共用 interfaceVersion 1 状态契约。VSIX 安装不会自动把 npm `bin` 加入系统 `PATH`；终端智能体应显式调用仓库或扩展目录中的 `format-cli.js`。

### 语法检查

设置 → `Otter FPGA Toolkit` → `Lint Tool` 可选：

| 工具 | 速度 | 说明 |
|------|------|------|
| `auto` (默认) | 快 | `.sv`/`.svh` 优先 xvlog，其他优先 iverilog；未安装时尝试另一工具 |
| `iverilog` | ~400ms | 需安装 Icarus Verilog |
| `xvlog` | 数秒 | 需安装 Vivado，更严格 |
| `modelsim` | 中等 | 需安装 ModelSim/Questa |

SystemVerilog 的数组赋值模式（如 "'{default:'0}"）在部分 Icarus 版本中不受支持，即使使用 -g2012 也可能报 syntax error。遇到此类情况可显式选择 xvlog；插件保留检查器原始报错，并以 Otter / 工具名标注来源，不屏蔽语法错误。自动模式仅在工具未找到时尝试另一工具，不因编译失败切换。

首次使用需配置路径（如 `xvlogPath`），扩展会自动查找常见安装位置。

命令面板中的 `Verilog: xvlog 检查当前文件` 始终调用 xvlog，不受默认 `Lint Tool` 选择影响；未找到 xvlog 时会清除过期诊断并提示检查 `xvlogPath`。

语法检查会在系统临时目录的 `otter-iverilog-*`、`otter-xvlog-*`、`otter-modelsim-*` 独立目录运行，避免在源码目录留下 `a.out`、`xsim.dir`、`xvlog.log`、`work/` 等工具链中间文件。正常结束或启动失败都会清理；如果 VS Code/外部工具被强制终止，最多可能在系统临时目录残留 Otter 前缀目录，不会在 RTL 源码旁生成。清理逻辑会拒绝源码路径、非 Otter 目录和 symlink/junction。

### 实例连接高亮

named port/parameter connection 会高亮整个表达式，不再只识别左括号后的第一个单词。例如 `.i_rst(~w_clk_200m_locked)`、`.P_CLK_HZ(50_000_000)`、`.data(bus[3:0])`、拼接和嵌套函数表达式都会区分端口名、operator、带下划线数字、常量及信号。端口/参数名独占一行、连接括号和表达式位于下一行的排版也会保持同样高亮。

### 代码补全

输入关键字自动提示模板，带 `[Otter]` 标识：
- `module` / `always @*` / `case` / `if` / `for` / `fsm` 等 25+ 模板
- 文件中已定义的信号名（含行号）

### 端口方向提示（Inlay Hints）

实例参数在 `#(...)` 的连接括号内部显示 `param`，例如 `.P_WIDTH(param 8)`；普通端口则从被例化模块的 ANSI/非 ANSI 声明、Vivado `.xci` 的 `boundary.ports`、Block Design `.bd` 顶层端口以及本机 Vivado `unisims` 原语源码解析 `input`、`output` 或 `inout`。普通 RTL 定义优先于同名厂商元数据。四种标签统一按6个显示字符处理；多行连接会在后续有内容的行重复显示同一标签，使表达式继续对齐，空行和仅有结束括号的行不添加。提示属于 VS Code 编辑器渲染，不写入文件，也不会进入编译、综合或仿真。

Xilinx 原语方向会根据 `verilogInstantiate.xvlogPath` 定位对应 Vivado 版本的官方 `data/verilog/src/unisims` 源码；未显式配置时沿用扩展现有的 Vivado 自动发现逻辑。`.xci` 和 `.bd` 直接读取工程已有 JSON 元数据，不调用 Vivado，也不会生成 output products。对于 BD 中成组的 `*_I / *_O / *_T` 三态接口，扩展会按 Vivado wrapper 规则合成为 `*_io`，并显示为 `inout`。

可通过 `verilogInstantiate.enablePortDirectionHints` 关闭。VS Code 自身的 `Editor › Inlay Hints: Enabled` 也必须开启。

### 跨文件跳转与模块层次树

- 光标放在例化的模块类型名或实例名上按 `F12` / `Ctrl+Click`，可打开工作区中的模块定义；同名 module 存在多份时返回全部候选，端口提示和层次树则优先选择与当前文件路径最接近的定义。
- Verilog/SystemVerilog 编辑器右上角会显示模块层次图标；点击后自动打开并聚焦底部 `Otter FPGA` → `模块层次`，当前 module 作为根节点，向下显示 `实例名 : 模块类型`。切换文件或在同一文件的多个 module 之间移动光标时会自动刷新，不需要手动寻找 Panel，也不占用左侧 Explorer。
- 点击树节点打开对应定义，标题栏刷新按钮可重建索引。
- 默认跳过 `.git`、`node_modules`、Vivado `*.gen/*.cache/*.ip_user_files/*.runs` 等生成目录和大于 2 MB 的未打开文件；可用索引设置调整。

### 约束文件高亮

支持常见 FPGA 约束文件：
- `.sdc`：时序约束
- `.xdc`：Xilinx/Vivado 约束
- `.cst`：Gowin 物理约束

## 设置项

| 设置 | 默认值 | 说明 |
|------|--------|------|
| `verilogInstantiate.tabSize` | `4` | 缩进空格数，允许 `1`–`16` 的整数 |
| `verilogInstantiate.lintTool` | `auto` | 语法检查工具 |
| `verilogInstantiate.xvlogPath` | `"xvlog"` | xvlog 路径 |
| `verilogInstantiate.autoLintOnSave` | `true` | 保存时自动检查 |
| `verilogInstantiate.lintOnOpen` | `false` | 打开文件时自动检查 |
| `verilogInstantiate.lintOnActiveEditorChange` | `false` | 切换到 Verilog/SystemVerilog 编辑器时自动检查 |
| `verilogInstantiate.enableCompletion` | `true` | 启用代码补全 |
| `verilogInstantiate.enablePortDirectionHints` | `true` | 显示实例参数和端口的 param/input/output/inout 内联提示 |
| `verilogInstantiate.workspaceIndexMaxFiles` | `5000` | 工作区最多索引的 RTL 文件数 |
| `verilogInstantiate.workspaceIndexMaxFileSizeKB` | `2048` | 未打开 RTL 文件的索引大小上限（KB） |
| `verilogInstantiate.workspaceIndexExclude` | Vivado/工具生成目录 glob | 工作区索引排除规则 |
| `verilogInstantiate.iverilogIgnoreMissingModule` | `true` | iverilog 忽略找不到例化模块的错误 |
| `verilogInstantiate.includePaths` | `[]` | 头文件搜索路径，留空时自动向上查找常见 include 目录 |

## 项目结构

```
otter-fpga-toolkit/
├── extension.js                # 主逻辑 (例化/排版/检查/跳转/补全)
├── cst-layout.js               # CST声明字段与作用域布局
├── cst-runtime.js              # 合并选区编辑并检查token
├── cst-editor.js / cst-worker.js # 后台排版
├── format-cli.js               # 编辑器外的check/write入口
├── vendor/verible/             # Windows x64解析器、来源和许可证
├── rtl-parser.js               # module/port/instance 纯文本解析
├── vendor-metadata.js          # Vivado XCI/BD 元数据与原语源码定位
├── workspace-features.js       # Inlay Hints、跨文件跳转和模块层次树
├── package.json                # 扩展配置
├── icon.png                    # 水獭图标
├── language-configuration.json # 括号/注释自动补全
├── syntaxes/
│   ├── verilog.tmLanguage.json
│   ├── systemverilog.tmLanguage.json
│   ├── sdc.tmLanguage.json
│   ├── xdc.tmLanguage.json
│   └── cst.tmLanguage.json
├── test/                       # Node 回归测试，不进入 VSIX
└── readme.md
```

## 许可

Otter源码采用MIT License。随包附带的Verible解析器及其第三方组件许可证见 `vendor/verible/LICENSE.txt`，来源与文件摘要见 `vendor/verible/SOURCE.json`。
