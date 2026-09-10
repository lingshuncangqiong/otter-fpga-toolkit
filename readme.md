# Otter FPGA Toolkit - 水獭FPGA工具集

> 小水獭的 FPGA/Verilog 开发利器，集成语法检查、一键例化、代码排版、高亮、端口方向提示、跨文件跳转和模块层次树

## 功能一览

| 功能 | 快捷键/触发 | 说明 |
|------|-----------|------|
| 一键例化 | `Ctrl+1` | 选中 module 声明，自动生成带注释对齐的例化模板 |
| 代码排版 | `Ctrl+L` | 信号声明/例化端口按实际缩进自动对齐，统一注释格式 `,// 注释` |
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
npx.cmd -y @vscode/vsce package --out otter-fpga-toolkit-<version>-test-<commit>.vsix
```

## 使用说明

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

- 自动对齐信号声明和例化端口
- 同组没有位宽或初始化时，不为缺失字段预留空列；已有字段仍按局部列宽与 tabSize 对齐。分号/逗号在边界长度下也保持同列。
- 字符串内容（包括 `//`、连续空格和转义字符）原样保留；代码与块注释混写或跨行字符串等未支持行保持原样，不用普通注释正则改写。
- 数组声明分别识别名称前后的多组维度及初始化表达式；支持维度内的索引，不在位宽内部补齐空格。声明列宽按局部分组计算，位宽、名称与数组维度、初值对公共列宽的贡献分别最多为 32、40、24 字符；超长内容原样保留，后续字段就近排布，不撑宽整组，也不强制换行。
- 参数、模块端口、内部信号和不同例化分别计算对齐列；同类同缩进的连续声明为一组，空行、分区标题及其它代码划分组。普通注释不拆组，长参数不会再撑宽其它区域。
- 多行 `localparam/parameter/wire` 声明的续行会对齐到首行 value 列，并保留续行间相对缩进；首行只有 `=` 的写法同样支持
- 统一注释格式为 `,// 注释`

同一套排版逻辑也可以在编辑器外调用，便于自动化任务复用 `Ctrl+L` 的实际实现：

```powershell
node .\format-cli.js --check E:\path\to\module.sv
node .\format-cli.js --write E:\path\to\module.sv
node .\format-cli.js --write --start-line 20 --end-line 80 E:\path\to\module.sv
node .\format-cli.js --check --json E:\path\to\module.sv
```

`--check` 只检查且不写文件；需要排版时退出码为 `1`。`--write` 才会原位修改文件。
行号从 `1` 开始并包含首尾行；只处理一个范围时，对齐列仍参考完整的所属声明组，选区外行不写入，
与编辑器选区执行 `Ctrl+L` 的行为一致。命令保留原文件的 `CRLF/LF` 和 UTF-8 BOM。

#### 智能体/自动化接口

智能体优先调用 `--check --json`：退出码 `0` 表示无需修改，`1` 表示需要格式化，`2` 表示调用错误；JSON 返回 `status`、`changedLines`、`wrote` 和绝对文件路径。只有获得写入授权后才调用 `--write --json`。Node 调用方也可以直接引用 `format-cli.js` 导出的 `formatFile()`；`package.json` 同时声明可执行入口 `otter-fpga-format`。

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

MIT License - 水獭出品
