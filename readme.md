# Otter FPGA Toolkit - 水獭FPGA工具集

> 小水獭的 FPGA/Verilog 开发利器，集成语法检查、一键例化、代码排版、高亮、端口方向提示、跨文件跳转和模块层次树

## 功能一览

| 功能 | 快捷键/触发 | 说明 |
|------|-----------|------|
| 一键例化 | `Ctrl+1` | 选中 module 声明，自动生成带注释对齐的例化模板 |
| 代码排版 | `Ctrl+L` | 信号声明/例化端口按实际缩进自动对齐，统一注释格式 `,// 注释` |
| 语法检查 | 保存自动 | 支持 Icarus Verilog / Vivado xvlog / ModelSim-Questa vlog |
| 语法高亮 | 自动 | Verilog/SystemVerilog + SDC/XDC/CST 约束文件 |
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
# 按 F5 启动调试模式，或把测试 VSIX 输出到仓库外
npx.cmd -y @vscode/vsce package --out <temporary-test.vsix>
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
- 统一注释格式为 `,// 注释`

### 语法检查

设置 → `Otter FPGA Toolkit` → `Lint Tool` 可选：

| 工具 | 速度 | 说明 |
|------|------|------|
| `auto` (默认) | 快 | 优先使用 iverilog |
| `iverilog` | ~400ms | 需安装 Icarus Verilog |
| `xvlog` | 数秒 | 需安装 Vivado，更严格 |
| `modelsim` | 中等 | 需安装 ModelSim/Questa |

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
