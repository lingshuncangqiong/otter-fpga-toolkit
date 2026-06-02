# Otter FPGA Toolkit 🦦 水獭FPGA工具集

> 小水獭的 FPGA/Verilog 开发利器，集成语法检查、一键例化、代码排版、高亮、补全、跳转

## 功能一览

| 功能 | 快捷键/触发 | 说明 |
|------|-----------|------|
| 🔧 **一键例化** | `Ctrl+1` | 选中 module 声明，自动生成带注释对齐的例化模板 |
| 📐 **代码排版** | `Ctrl+L` | 信号声明/例化端口自动对齐，统一注释格式 `,// 注释` |
| 🔍 **语法检查** | 保存自动 | 支持 iverilog / Vivado xvlog / ModelSim vlog 三选一 |
| 🎨 **语法高亮** | 自动 | 模块名、实例名、`.端口`、信号名、系统函数分色 |
| 🔗 **定义跳转** | `F12` | 跳转到信号/参数声明处 |
| 💬 **悬停提示** | 鼠标悬停 | 显示定义行号 + 原代码 |
| ✏️ **代码补全** | 输入提示 | 25+ 模板 (module/always/case/fsm) + 当前文件信号名 |

## 安装方法

### 从 VSIX 安装

1. 下载 `otter-fpga-toolkit-x.x.x.vsix`
2. VSCode/CodeBuddy → `Ctrl+Shift+X` → `...` → `Install from VSIX...`
3. 选择 vsix 文件
4. `Ctrl+Shift+P` → `Developer: Reload Window`

### 从源码运行

```bash
cd vscode-verilog-instantiate
# 按 F5 启动调试模式，或:
npm install -g @vscode/vsce
vsce package
# 然后安装生成的 vsix
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

### 代码补全

输入关键字自动提示模板，带 `[Otter]` 标识：
- `module` / `always @*` / `case` / `if` / `for` / `fsm` 等 25+ 模板
- 文件中已定义的信号名（含行号）

## 设置项

| 设置 | 默认值 | 说明 |
|------|--------|------|
| `verilogInstantiate.tabSize` | `4` | 缩进空格数 |
| `verilogInstantiate.lintTool` | `auto` | 语法检查工具 |
| `verilogInstantiate.xvlogPath` | `"xvlog"` | xvlog 路径 |
| `verilogInstantiate.autoLintOnSave` | `true` | 保存时自动检查 |
| `verilogInstantiate.enableCompletion` | `true` | 启用代码补全 |

## 项目结构

```
vscode-verilog-instantiate/
├── extension.js                # 主逻辑 (例化/排版/检查/跳转/补全)
├── package.json                # 扩展配置
├── icon.png                    # 水獭图标
├── language-configuration.json # 括号/注释自动补全
├── syntaxes/
│   ├── verilog.tmLanguage.json
│   └── systemverilog.tmLanguage.json
└── readme.md
```

## 许可

MIT License - 水獭出品 🦦
