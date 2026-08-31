# Otter FPGA Toolkit — 项目总览

> **给 AI 看的上下文文件**，便于接手项目时快速理解。

---

## 基本信息

| 项目 | 详情 |
|------|------|
| **名称** | Otter FPGA Toolkit (水獭FPGA工具集) |
| **扩展名** | `otter-fpga-toolkit` |
| **Publisher** | `Otter-xiaoxiaoxuwang` |
| **版本** | `2.1.14` |
| **GitHub** | `https://github.com/lingshuncangqiong/otter-fpga-toolkit` |
| **VSCode 引擎** | `^1.75.0` |
| **许可** | MIT |
| **作者** | 小水獭 |
| **CodeBuddy 用户ID** | `8dbf1979-aa19-45d1-857e-64dfcbbda535` |

---

## 文件夹结构

```
Otter-FPGA-Toolkit/
├── .git/                       ← GitHub 仓库元数据
├── AGENTS.md                   ← 智能体开发与发布约束
├── PROJECT.md                  ← 本文件（项目上下文与历史）
├── extension.js                ← 扩展主逻辑
├── rtl-parser.js               ← module/port/instance 纯解析层
├── vendor-metadata.js          ← Vivado XCI/BD 端口元数据与原语源码定位
├── workspace-features.js       ← 工作区索引、Inlay Hints、F12 和层次树
├── package.json                ← VS Code 扩展清单
├── icon.png
├── readme.md
├── LICENSE
├── .gitignore
├── .vscodeignore
├── language-configuration.json
├── syntaxes/
│   ├── verilog.tmLanguage.json
│   ├── systemverilog.tmLanguage.json
│   ├── sdc.tmLanguage.json
│   ├── xdc.tmLanguage.json
│   └── cst.tmLanguage.json
├── test/
│   ├── extension.test.js       ← 原有命令/格式化/manifest 回归
│   ├── rtl-parser.test.js      ← ANSI/非 ANSI module、实例和 grammar 回归
│   ├── vendor-metadata.test.js ← XCI/BD 端口方向与 Vivado 原语定位回归
│   └── workspace-features.test.js ← Inlay/F12/层次树 provider 回归
└── otter-fpga-toolkit-2.1.14.vsix  ← 当前本地发布包，Git 忽略
```

> **唯一入口**：自 2026-08-21 起，本仓库根目录同时承担开发、测试、GitHub 推送和 VSIX 发布，不再维护 `2-dev` / `1-release` 双副本。
> **私密隔离**：凭据、SSH 私钥、迁移备份和测试 VSIX 不得放入本 Git 仓库。

---

## 功能列表

| # | 功能 | 触发方式 | 实现位置 |
|---|------|---------|----------------------|
| 1 | 一键例化 | `Ctrl+1` | `generateInstance` 命令 → `genInst()` |
| 2 | 代码排版 | `Ctrl+L` | `alignCode` 命令 → `doFmt()` |
| 3 | 语法检查(iverilog) | 保存时自动 | `runIverilog()` — spawn `iverilog` |
| 4 | 语法检查(xvlog) | 保存时自动 | `runXvlog()` — spawn `cmd /c xvlog.bat` |
| 5 | 语法检查(ModelSim) | 保存时自动 | `runModelsim()` — spawn `cmd /c vlog.exe` |
| 6 | Verilog 语法高亮 | 自动 | `syntaxes/verilog.tmLanguage.json`, `systemverilog.tmLanguage.json` |
| 7 | 约束文件语法高亮 | 自动 | `syntaxes/sdc.tmLanguage.json`, `xdc.tmLanguage.json`, `cst.tmLanguage.json` |
| 8 | 定义跳转 | `F12` | `registerDefinitionProvider` → `findDecl()` |
| 9 | 悬停提示 | 鼠标悬停 | `registerHoverProvider` → `findDecl()` + 行号 |
| 10 | 代码补全 | 输入提示 | `registerCompletionItemProvider` — 25+模板 + 文件信号名 |
| 11 | 端口方向提示 | 自动 | `PortDirectionInlayProvider` — 纯显示 input/output/inout |
| 12 | 跨文件模块跳转 | `F12` / `Ctrl+Click` | `WorkspaceModuleIndex` + `provideWorkspaceDefinition()` |
| 13 | 模块层次树 | Explorer | `ModuleHierarchyProvider` — 顶层 module → instances |

---

## extension.js 核心架构

```
activate()
├── 语言注册: verilog/systemverilog (.v/.sv/.vh/.svh)  +  package.json 注册 sdc/xdc/cst
├── 例化命令: generateInstance → genInst()
│   ├── parseModule()     — 解析 module 声明
│   └── extractComments() — 提取注释中的 section/端口声明行 (v2.1: 支持普通//注释+无参数模块)
├── 排版命令: alignCode → doFmt()
│   ├── entry.tag === 'inst_port' → 例化端口对齐 (v2.1: 允许空连接)
│   ├── entry.tag === 'inst_port_multi' → 跨行端口首行对齐 (v2.1 新增)
│   └── 信号声明 → 关键字/位宽/信号名/注释对齐
├── 本地跳转/悬停: findDecl()
│   └── 查找 input/output/wire/reg/parameter 声明位置
├── 工作区语义: registerWorkspaceFeatures()
│   ├── rtl-parser.js — module、ANSI/非 ANSI port direction、instance、named connections
│   ├── WorkspaceModuleIndex — 惰性索引工作区 RTL，跳过生成目录/超大文件
│   ├── PortDirectionInlayProvider — 端口方向纯显示提示
│   └── ModuleHierarchyProvider — Explorer 模块层次树和刷新
├── 补全: 25+ 模板 + 扫描当前文件信号名
├── 语法检查:
│   ├── findIverilog()     — 自动查找 iverilog 路径
│   ├── findXvlog()        — 自动查找 Vivado xvlog
│   ├── findModelsim()     — 自动查找 ModelSim vlog
│   ├── runIverilog()      — cp.spawn('iverilog', ...) (v2.1: 支持过滤找不到模块错误)
│   ├── runXvlog()         — cp.spawn('cmd', ['/c', xvlog, '-sv', file])，在系统临时目录运行并清理 Vivado 产物
│   ├── runModelsim()      — cp.spawn('cmd', ['/c', vlog, '-sv', file])
│   └── doLint()           — 路由，根据 lintTool 设置选择
└── 保存监听: onDidSaveTextDocument → doLint()
```

### 关键逻辑说明

1. **iverilog 解析** — 用 `spawn` 直接启动，捕获 stderr/stdout，按行正则匹配 `文件:行号: 消息`
2. **iverilog 过滤** (v2.1) — 可配置忽略 `Unknown module` / `module not found` 类错误，适合单文件开发
3. **xvlog 解析** — 用 `spawn('cmd', ['/c', xvlog, '-sv', file])`，正则匹配 `ERROR/WARNING/CRITICAL WARNING: [CODE] message [file:line]`
4. **ModelSim 解析** — 正则匹配 `** Error/Warning: file(line): message`
5. **排版注释格式** — 例化端口 `),// 注释`，信号声明 `,// 注释`（统一 `//` 后跟空格）
6. **诊断写入** — `diagColl.set(uri, ps)` 直接写入 VSCode 诊断集

---

## 设置项

| 设置 | 默认值 | 说明 |
|------|--------|------|
| `verilogInstantiate.tabSize` | `4` | 缩进 |
| `verilogInstantiate.lintTool` | `auto` | auto/iverilog/xvlog/modelsim |
| `verilogInstantiate.xvlogPath` | `"xvlog"` | xvlog.bat 路径 |
| `verilogInstantiate.autoLintOnSave` | `true` | 保存自动检查 |
| `verilogInstantiate.lintOnOpen` | `false` | 打开 Verilog/SystemVerilog 文件时自动检查 |
| `verilogInstantiate.lintOnActiveEditorChange` | `false` | 切换到 Verilog/SystemVerilog 编辑器时自动检查 |
| `verilogInstantiate.enableCompletion` | `true` | 补全开关 |
| `verilogInstantiate.iverilogIgnoreMissingModule` | `true` | iverilog 忽略找不到例化模块的错误 |

---

## 语法高亮 Scope 映射

### Verilog/SystemVerilog

| 内容 | Scope | 颜色 | 示例 |
|------|-------|------|------|
| 模块声明名 | `entity.name.type` | 默认 | `module test_module` |
| 实例化原模块名 | `entity.name.tag.instance` | 🔵蓝 | `my_fifo` in `my_fifo u_inst (` |
| 实例名称 | `entity.name.type.instance` | 🟢青绿 | `u_inst` in `my_fifo u_inst (` |
| assign/always信号 | `variable.other.readwrite` | 🩷淡粉 | `signal` in `assign signal =` |
| `.端口名` | `entity.name.function` | 默认 | `.i_clk` |
| `(信号名)` | `variable.other.port` | 默认 | `(i_clk)` |
| 声明关键字 | `storage.type` | 默认 | `input/output/wire/reg` |
| 控制关键字 | `keyword.control` | 默认 | `module/always/if/case` |
| 系统函数 | `support.function` | 默认 | `$display/$finish/$fatal` |

> Verilog 颜色由 `package.json` 中 `configurationDefaults.editor.tokenColorCustomizations.textMateRules` 控制

### 约束文件 (SDC/XDC/CST) — v2.1 新增

| 内容 | Scope | 颜色 | 示例 |
|------|-------|------|------|
| 命令 | `entity.name.tag` | 🔵蓝 | `create_clock`, `set_property`, `IO_LOC` |
| 参数 `-xxx` | `variable.parameter` | 🔷浅蓝 | `-name`, `-period`, `-dict` |
| 点分隔属性 | `variable.other.member` | 🟡淡黄 | `BITSTREAM.GENERAL.COMPRESS` |
| IO标准值 / 布尔 | `string.unquoted` | 🟠橙 | `LVDS`, `LVCMOS18`, `TRUE`, `FALSE` |
| XDC 属性关键字 | `support.type` | 🟢绿 | `PACKAGE_PIN`, `IOSTANDARD` |
| CST 属性关键字 | `variable.parameter` | 🔷浅蓝 | `IO_TYPE`, `PULL_MODE`, `DRIVE` |
| 数字 | `constant.numeric` | 🟢淡绿 | `8`, `3.3` |
| CST 引脚号 | `constant.numeric` | 🟢淡绿 | `M2`, `N13` |
| 注释 `#` | `comment.line.number-sign` | 🟢绿灰 | `# section` |
| 注释 `//` | `comment.line.double-slash` | 🟢绿灰 | `//Copyright` |

> 约束文件使用主题原生 scope，无需 `configurationDefaults` 额外配色

---

## 当前发布状态 / 接手重点

- 当前最新版本：`2.1.14`
- 当前 GitHub main 发布提交：以 `git log` 中最新的 `v2.1.14` 提交为准
- 本仓库以 `main` 跟踪 `origin/main`；开始修改前检查 `git status --short --branch` 和当前 diff
- `origin` 必须保持 SSH：`git@github.com:lingshuncangqiong/otter-fpga-toolkit.git`
- GitHub SSH key 名称：`Codex Windows`
- GitHub 发布已经可以走 SSH，不再依赖 HTTPS token / PAT URL
- VS Code Marketplace 暂不走自动 `vsce publish`：用户创建 Azure DevOps organization 会卡银行卡/订阅；采用手动上传 VSIX
- Marketplace 手动上传页面：`https://marketplace.visualstudio.com/manage/publishers/otter-xiaoxiaoxuwang`
- 当前手动上传文件：仓库根目录的 `otter-fpga-toolkit-2.1.14.vsix`
- 发布后仓库根目录只保留当前最终 VSIX；测试包输出到仓库外的临时路径
- 旧目录中的迁移备份与凭据继续留在仓库外，不作为当前开发入口

---

## 凭据与密钥边界

- GitHub 账号为 `lingshuncangqiong`，`origin` 使用 `git@github.com:lingshuncangqiong/otter-fpga-toolkit.git`。
- 当前 SSH 私钥保留在仓库外的 `C:\Users\15617\.ssh\id_ed25519`。这里只记录定位信息；普通开发、打包和发布流程不得读取、复制、打印、修改、重新生成或打包私钥内容。
- 获得用户 push 授权后，先核对 SSH remote，再用有超时、无交互的 `git ls-remote origin HEAD` 做只读认证检查。
- 如果密钥缺失或 SSH 认证失败，立即停止并报告；不得自动回退到 HTTPS/PAT，不得使用旧目录中的 PAT，不得擅自修改 SSH service/config 或创建替代密钥。
- `.gitignore` 防止常见凭据进入 Git，`.vscodeignore` 防止它们进入 VSIX；两层忽略规则不能替代 commit diff 和 VSIX 内容审查。

---

## 发布流程

```powershell
# 1. 在仓库根目录开发并执行内置检查
npm run check

# 2. 需要用户安装验证时，输出到仓库外的临时测试包，避免覆盖当前发布包
npx.cmd -y @vscode/vsce package --out <temporary-test.vsix>

# 3. 用户确认并授权发布后，更新 package.json 版本并生成最终发布包
npx.cmd -y @vscode/vsce package

# 4. 检查并提交明确的源码/元数据文件，然后通过 SSH 推送
git status --short --branch
git remote -v
git add <明确文件列表>
git commit -m "vX.Y.Z: 描述"
git push origin main

# 5. VS Code Marketplace
# 默认不自动发布；手动上传仓库根目录的最终 VSIX：
# https://marketplace.visualstudio.com/manage/publishers/otter-xiaoxiaoxuwang
```

**GitHub remote**: `origin → git@github.com:lingshuncangqiong/otter-fpga-toolkit.git`
**GitHub 凭据规则**: 只使用现有 SSH 认证；不得把 PAT、token 或私钥放入 remote URL、命令行、仓库或日志。
**Marketplace 规则**: 不要默认执行 `vsce publish`；除非用户明确提供可用 `VSCE_PAT` 并要求自动发布，否则只生成 VSIX 给用户手动上传。

---

## 依赖

- **运行时**: 零依赖，纯 VSCode API + Node.js 内置模块
- **测试**: Node.js 内置 `node:test`，入口为 `npm test` / `npm run check`
- **打包**: `@vscode/vsce` (全局安装)
- **图标**: `jimp` (devDependency，仅生成 icon 时使用)

---

## 开发强制规则 🚨

1. **单一真源** — 所有开发、测试和发布都在本 Git 仓库完成，不再创建开发版/发布版源码镜像
2. **风险匹配验证** — 修改 `extension.js` 后至少执行 `node --check extension.js`；修改 JSON 后解析对应文件；需要安装验证时把测试 VSIX 输出到仓库外
3. **版本号等用户确认** — 用户确认测试效果并授权发布后，才更新版本号、生成最终 VSIX、commit、push 或上传 Marketplace
4. **scope 配色** — `entity.name.tag.instance`=蓝色(模块名), `entity.name.type.instance`=青绿色(实例名), `variable.other.readwrite`=淡粉色(assign/always信号)
5. **约束文件 scope** — 全部使用主题原生 scope (`entity.name.tag`, `variable.parameter`, `string.unquoted`, `support.type`, `constant.numeric`)，不依赖 `configurationDefaults`
6. **发布前检查** — 发布前复核工作树、diff、版本号、VSIX 内容和 GitHub 远端；额外备份应放在仓库外
7. **GitHub 不用 HTTPS token remote** — remote 里不能出现 PAT；必须保持 SSH URL
8. **Marketplace 手动上传** — 当前用户无法走 Azure DevOps PAT 自动发布，除非用户以后明确说已准备好 Marketplace PAT
9. **中间文件清理** — 每次发布后仓库根目录只保留当前 `otter-fpga-toolkit-X.Y.Z.vsix`，测试包和旧版本包不进入 Git
10. **迁移遗留隔离** — 旧位置保留的未受 Git 管理副本、备份和凭据不是开发入口，未经用户明确授权不得删除或重新并入本仓库

---

## 当前开发改动（未发布）

- 版本号保持 `2.1.14`，正式 VSIX 不覆盖。
- Vivado BD 元数据解析新增 wrapper 三态端口合成：同组 `*_I / *_O / *_T` 且方向为 input/output/output、位宽一致时，生成对应 `*_io : inout`。
- 用 `otter_zu7ev_lab.bd` 和 `otter_zu7ev_lab_top.v` 验证 `sensor_gpio_tri_io`、`sensor_iic_scl_io`、`sensor_iic_sda_io` 的实际方向来源。
- 多行端口连接的 Inlay Hint 会在后续有表达式内容的行重复显示同一方向，修复 `{io_sensor_pwdn, io_sensor_rst_n}` 因首行 `inout` 提示产生的视觉错位；不再使用会触发 VS Code 标签复用异常的纯空白 hint，也不修改 RTL 文本。
- Ctrl+L 例化列改为按实际缩进宽度分组计算，修复 `tabSize` 与源码缩进不一致时最长参数名的左括号偏移；无逗号末行不再添加尾随空格。
- 实例解析保留 `#(...)` 内的 named parameter connections，Inlay Hint 在参数表达式前显示与方向标签同宽的 `param`，消除参数区与端口区的视觉不对称；沿用现有总开关且不修改 RTL 文本。
- 当前验证：`npm run check` 30/30 PASS；参数 `param` 与 `input/output/inout` 标签同为6字符宽且按源码顺序生成；真实 BD/顶层的三个目标端口均解析为 `inout`；多行与单行 Inlay Hint 回归 PASS；Ctrl+L 在 `tabSize=2`、源码缩进4空格的实例中左右括号列一致且无尾随空格；仓库外测试 VSIX 打包与内容审查 PASS。VS Code 实际显示和 Ctrl+L 编辑效果等待用户安装验证。

---

## v2.1.14 改动记录

- 用户已完成候选包安装验证并授权发布；版本号更新为 `2.1.14`。
- 修复 TextMate grammar 的跨行 named connection：`.P_DEBUG_TELEMETRY_ENABLE` 独占一行、下一行 `(P_DEBUG_TELEMETRY_ENABLE)` 时，参数名和连接表达式均可高亮。
- 同一行 `.P_NAME(value)` 继续使用原有递归连接表达式规则，优先级和已有高亮行为不变。
- 发布验证：8 个 JS 文件 `node --check` PASS；`npm run check` 26/26 PASS；7 个 JSON 解析 PASS；`hdmi_rx_amd_7series.v` 第 165–166 行的跨行 begin/end 匹配 PASS；最终 `otter-fpga-toolkit-2.1.14.vsix` 的版本、16 项内容、grammar 哈希和凭据排除审查 PASS；用户已确认 VS Code 实际着色效果。

---

## v2.1.13 改动记录

- 用户已完成候选包安装验证并授权发布；版本号更新为 `2.1.13`。
- 工作区索引新增 Vivado `.xci` / `.bd` JSON 元数据：从 `boundary.ports`、BD scalar ports 和 interface `port_maps` 获取真实方向。
- 对仍未解析的例化类型，按现有 `xvlogPath` / Vivado 自动发现结果读取对应版本的官方 `data/verilog/src/unisims` / `unimacro` 原语声明；不运行 Vivado、不生成 output products。
- 普通 RTL `module` 定义优先于同名 XCI/BD/原语元数据，保持既有多工程路径亲和选择行为。
- 修复 Vivado 原语 module header 中条件编译指令遮断 ANSI 端口解析的问题。
- Verilog/SystemVerilog grammar 的普通十进制/实数支持下划线分隔符，`.P_CLK_HZ(50_000_000)` 可完整高亮。
- `XCZU7EV_TOP.v` 只读验证：`clk_wiz_0` 4/4、`user_ms72xx_control` 38/38、两个 `IOBUF` 各 4/4、`BUFG` 2/2、`video_pcie_subsystem_wrapper` 15/15 连接均匹配到真实方向。
- 发布验证：8 个 JS 文件 `node --check` PASS；`npm run check` 26/26 PASS；7 个 JSON 解析与 `git diff --check` PASS；最终 `otter-fpga-toolkit-2.1.13.vsix` 的版本、16 项内容、运行时哈希和凭据排除审查 PASS；用户已确认 VS Code 中的最终显示效果。

---

## v2.1.12 改动记录

- 用户已确认候选功能并授权发布；版本号更新为 `2.1.12`。
- 修复 `verilog-instantiate.xvlogLint`：手动命令现在固定路由到 xvlog，不再被默认 `lintTool=auto` 改成 iverilog。
- 三个命令增加 Verilog/SystemVerilog enablement；删除无效的 `ctrl+numpad_l`，保留其余既有快捷键。
- `tabSize` 限制为 `1`–`16` 的整数，运行时继续做防御性归一化；补全缩进与例化/格式化共用该设置。
- 选区结束在下一行第 0 列时，不再误格式化下一行；格式化行查询由重复线性查找改为 `Map`。
- 指定 lint 工具不可用时清除过期诊断；手动检查会给出缺失工具提示。
- 修复实例连接 grammar：`~signal`、`!signal`、切片、拼接、常量和嵌套括号中的标识符使用递归连接表达式高亮；`assign`/非阻塞赋值移除可变长度 lookbehind。
- 新增 `rtl-parser.js` 和 `workspace-features.js`：支持 ANSI/非 ANSI port direction、input/output/inout Inlay Hints、模块类型/实例名跨文件 F12，以及 Explorer 模块层次树。
- 工作区索引默认跳过 Git/Node/Vivado 生成目录和大于 2 MB 的未打开文件；真实工作区只读验证从 1160 文件、约 10.7 秒收敛到 383 文件、约 191 ms，解析 753 个 module、1269 个可解析层次实例，0 失败。
- 多工程工作区存在同名 module 时，F12 返回全部定义；Inlay Hints 和层次树按路径公共前缀优先选择与当前文件最近的定义。
- 根据用户视觉反馈，Inlay Hint 从 `.port` 前移动到连接括号内部、表达式之前；模块层次树从“全工作区顶层列表”收敛为只显示当前编辑器光标所在 module 及其子实例。
- 第二轮视觉反馈：方向标签统一为 6 个显示字符，保证提示后的连接名称对齐；模块层次视图从左侧 Explorer 移到 VS Code 底部 `Otter FPGA` Panel。
- 层次入口反馈：新增 `editor/title` 右上角 `$(type-hierarchy)` 图标，点击后通过 `TreeView.reveal()` 自动打开、聚焦并展开当前 module 根节点，无需手动寻找底部 Panel。
- `r5` 现场缺陷：`TreeView.reveal()` 要求 TreeDataProvider 实现 `getParent()`；已为根节点返回 `undefined`、实例节点保存真实父引用，并把右上角命令实际执行 `reveal()` 纳入回归。
- lint 临时目录清理增加所有权边界：只允许系统临时目录直属 `otter-iverilog-*`、`otter-xvlog-*`、`otter-modelsim-*` 普通目录，拒绝源码路径和 symlink/junction。
- 新增 `test/*.test.js` 和 `npm test` / `npm run check`，覆盖原有行为、parser、grammar、Inlay Hints、跨文件跳转、层次树和临时目录边界。
- 发布验证：3 个运行时 JS 与 3 个测试 JS 的 `node --check` PASS；`npm run check` 21/21 PASS；7 个 JSON 解析 PASS；最终 `otter-fpga-toolkit-2.1.12.vsix` 打包、版本/内容/运行时哈希和凭据排除审查 PASS。用户已完成候选包安装与交互验证并授权发布；`r5` 的 `TreeView.reveal()` 缺陷已加入回归。外部 lint 工具实测尚未运行。

---

## v2.1.9 改动记录

> 以下历史记录中出现的 `2-dev`、`1-release` 和 `_backups` 是 2026-08-21 迁移前的旧目录名称，仅用于追溯，不再表示当前工作流。

## v2.1.11 改动记录

### 背景
- 目标：提升开源用户机器上的 lint 稳定性，降低误删/污染源码目录/并发诊断覆盖风险
- 修改前备份：`_backups/2-dev-before-2.1.11-quality-fix-20260621-165714.zip`
- 发布前备份：`_backups/1-release-before-2.1.11-publish-20260621-171528.zip`

### 修复/优化
- `runIverilog()` 不再在源码目录运行，也不再删除源码目录下的 `a.out`
- `runIverilog()` 改用 `fs.mkdtempSync(path.join(os.tmpdir(), 'otter-iverilog-'))` 创建临时目录，并通过 `-o lint.out` 指定输出到临时目录
- `findIverilog()` 找到固定安装路径时返回真实 exe 路径，避免用户未配置 PATH 时 `spawn('iverilog')` 失败
- `runModelsim()` 从直接使用 `os.tmpdir()` 改为独立 `otter-modelsim-*` 临时目录，结束后清理
- `runXvlog()`、`runIverilog()`、`runModelsim()` 都加入 `error` 事件兜底清理，防止 spawn 失败时扩展宿主抛未处理错误
- 新增 lint 防抖和序号机制：连续保存/切换时旧诊断结果不会覆盖新结果
- `autoLintOnSave` 现在只表示保存自动 lint；新增 `lintOnOpen=false`、`lintOnActiveEditorChange=false`，默认不在打开文件/切换编辑器时运行外部 lint 工具
- README 更新：源码目录名、约束文件高亮、includePaths/iverilogIgnoreMissingModule、新 lint 行为说明

### 测试状态
- 迁移前已执行：`node --check 2-dev/extension.js`
- 迁移前已执行：`npx.cmd -y @vscode/vsce package` 生成测试 VSIX
- 用户已确认测试通过；旧流程曾将 `2-dev` 同步到 `1-release` 后生成发布 VSIX、commit 并通过 SSH push

---

### 修复：ModelSim 自动查找路径失效
- `findModelsim()` 中 `p.join(...)` 拼写修正为 `path.join(...)`
- 修复选择 ModelSim lint 时自动搜索安装目录可能直接异常的问题

### 修复：声明解析对常见 SV 写法不完整
- 新增统一声明解析逻辑，覆盖 `output wire`、`input logic signed`、`parameter integer`、`localparam logic` 等常见写法
- `Ctrl+L`、补全、F12 跳转、悬停提示、例化注释提取共享该解析逻辑
- 修复 `output wire data` 被误识别为信号 `wire`、带类型参数例化注释丢失、多信号声明补全/跳转不完整等问题

---

## v2.1.10 改动记录

### 背景
- 现象：用户在 `E:\WorkBuddy\ISP_Dev\03_hardware\rtl\apb\` 发现非手动生成的 `xsim.dir`
- 现场检查：`xsim.dir` 创建于 `2026-06-17 16:16:50`，目录为空；同目录未发现其他明确手工仿真脚本产物
- 判断：Otter 不会显式创建 `xsim.dir`，但旧逻辑在 `runXvlog()` 中用源文件目录作为 `xvlog` 的 `cwd`，Vivado/XSim 工具链可能会在该目录留下 `xsim.dir`
- 限定：默认 `auto` 模式会优先用 `iverilog`；在用户机器上 `C:\iverilog\bin\iverilog.exe` 存在，所以普通 auto 保存检查通常不会触发该问题。若手动运行 `xvlogLint` 或设置 `lintTool=xvlog`，则旧逻辑有污染风险

### 修复
- `2-dev/extension.js` 已将 `runXvlog()` 的工作目录改为 `fs.mkdtempSync(path.join(os.tmpdir(), 'otter-xvlog-'))`
- `xvlog` 结束后通过 `fs.rmSync(workDir, { recursive: true, force: true })` 清理临时目录
- 目的：避免在 RTL 源码目录留下 `xsim.dir`、`xvlog.log`、`webtalk.*` 等 Vivado 伴生产物

### 状态
- 已执行 `node --check 2-dev/extension.js` 和 `node --check 1-release/extension.js`
- 已打包发布 VSIX：`1-release/otter-fpga-toolkit-2.1.10.vsix`
- GitHub 发布走 SSH remote：`git@github.com:lingshuncangqiong/otter-fpga-toolkit.git`

---

## v2.1.2 改动记录

### 修复：Ctrl+L 最长连接名 `),` 错位
- `cpCol = padToTab(ipCol + ipMaxC + 1, tab)` → `+2`，当最长 conn 名恰好占满 tab 边界时 `Math.max(1, 0)` 推偏了 `)` 的位置
- 典型案例：`w_sgdma_write_start`(19字符) 使 `ipCol + ipMaxC + 1 = 48` 恰好落在 tab=4 边界

### 修复：`<=` 比较运算误高亮
- `signal_assignments` 正则 `(?<=^|\\s)\\w+(?=\\s*<=)` → `(?<=^\\s*)\\w+(?=\\s*<=)`，从「行首或空格后」收紧为「仅行首(含缩进)」
- 防止 `if (r_st_cnt <= 2)` 中的 `r_st_cnt` 被错误标记为淡粉色

---

## v2.1.8 改动记录

### 修复：Ctrl+L 无尾逗号信号注释不对齐
- `doFmt()` eq 分支内新增 `else`，处理有 `=` 值但无 `,` / `;` 尾部时的注释间距补齐
- 修复参数列表末行（如 `$clog2(...)` 无逗号）的 `//` 注释偏移问题

---

## v2.1.7 改动记录

### 修复：ModelSim 语法检查污染 `work` 文件夹
- `runModelsim()` 工作目录 `cwd` 从源文件目录改为 `os.tmpdir()`
- `vlog.exe` 不再在用户项目目录中自动创建 `work` 库文件夹

---

## v2.1.6 改动记录

### 新增：include 路径支持，修复独立文件语法检查误报
- 新增设置项 `verilogInstantiate.includePaths`（数组，默认 `[]`）
- 新增 `findIncludePaths()` 函数：自动向上搜索 3 层找 inc/rtl/src/include/hdl 目录中是否有 .vh/.svh 文件
- `runIverilog()` 添加 `-I` 参数传递 include 路径
- `runXvlog()` 添加 `-i` 参数传递 include 路径
- `runModelsim()` 添加 `+incdir+` 参数传递 include 路径
- 解决独立文件夹打开 .v/.sv 文件时，因头文件缺失导致宏定义未展开、连锁假错误的问题

---

## v2.1.5 改动记录

### 修复：iverilog 误报 "Verilog Compiler exiting" 为错误
- `runIverilog()` 诊断过滤新增 `/Verilog Compiler exiting/i` 匹配
- iverilog 正常退出时输出的 `file:line: Verilog Compiler exiting` 不再显示为红波浪线错误

---

## v2.1.4 改动记录

### 修复：`parameter integer` 等带类型参数例化丢失
- `parseParams()` 正则新增 `(?:integer\s+|real\s+|realtime\s+|time\s+)?` 可选类型匹配
- 修复 `parameter integer DEST_SYNC_FF = 4` 等声明被错误解析，参数全部丢失的问题

### 优化：无参数模块例化紧凑格式
- `genInst()` 判断 `mod.params.length`，无参数时跳过 `#()` 块
- 例化首行变为 `module_name module_name_U0 (` 而非 `module_name #(\n) module_name_U0 (`

---

## v2.1.3 改动记录

### 修复：无尺寸字面量 `'d0`/`'hFF` 无高亮
- `verilog.tmLanguage.json` / `systemverilog.tmLanguage.json` 的 `constants` 中新增 unsized literal 正则：`('[bBoOdDhH]\\s*[0-9a-fA-FxXzZ?_]+)\\b`
- 无宽度前缀的基于基数字面量（`'d0`, `'hFF`, `'b1010`）正确高亮为 `constant.numeric`
- 2026-06-03 发现并修复

### 修复：Ctrl+L 排版尾部对齐（补 v2.1.1 漏同步）
- `doFmt()` eq 分支 `Math.max(1, cc-r.length)` → `Math.max(0, ...)`，防止长 eq 值 `'d0` 推偏 `;`
- 无等号/无尾部内容的信号声明新增 `else` 分支补 2 空格占位

---

## v2.1.1 改动记录

### 修复：Ctrl+L 最后端口无逗号注释间距
- 无逗号/分号/等号的信号行（如端口列表末行）注释前缺少间距，`else` 分支补 2 空格占位

### 修复：Ctrl+L reg 与 localparam 混排 ; 不对齐
- eq 分支 tail 对齐用 `Math.max(0, cc-r.length)` 替代 `Math.max(1,...)`，防止长 eq 值 (`'d0`) 推偏 `;` 位置

### 修复：无尺寸字面量 (`'d0`, `'hFF`) 无高亮
- 新增 unsized literal 正则 `('[bBoOdDhH]\s*...)`，去掉前导 `\b`（因 `'` 前为空格非单词字符）

---

## v2.1.0 改动记录

### 新增：约束文件语法高亮
- `.sdc` — SDC 时序约束 (高云 `//` 注释 + 易灵思 `#` 注释)
- `.xdc` — Xilinx XDC 约束 (`#` 注释)
- `.cst` — 高云物理约束 (`//` 注释)
- 语言注册在 `package.json`：`sdc`/`xdc`/`cst` 三个 language id
- 命令用 `entity.name.tag`（蓝色），参数用 `variable.parameter`（浅蓝），IO标准用 `string.unquoted`（橙色）
- 支持 `BITSTREAM.GENERAL.COMPRESS` 点分隔属性（淡黄）、`current_design` 等 TCL 命令

### 新增：iverilog 过滤找不到模块
- 新增设置项 `verilogInstantiate.iverilogIgnoreMissingModule`（默认 `true`）
- `runIverilog()` 中过滤 `Unknown module` / `module not found` 错误
- 适合单文件开发场景（例化的外部模块必然找不到）

### 修复：例化 (Ctrl+1) 注释丢失
- `extractComments` 注释匹配从 `/^\/\/[-=]{3,}/` 改为 `/^\/\//`，支持普通 `//` 注释
- 新增 `module NAME(` 无参数模块入口检测，端口注释不再丢失

### 修复：排版 (Ctrl+L) 空连接/跨行端口
- `parseLine` inst_port 正则 `\S.*?` → `.*?`，允许 `( )` 空连接
- 新增 `inst_port_multi` 标签：跨行端口首行 `.port ({expr...` 参与端口名对齐，中间行不动
- `doFmt` 新增 `inst_port_multi` 格式化处理

---

## v2.0.3 改动记录

### 语法高亮
- 实例化原模块名 → `entity.name.tag.instance` → 🔵蓝 (#569CD6 bold)
- 实例名称 → `entity.name.type.instance` → 🟢青绿 (#6A9955)
- assign/always块内<=信号 → `variable.other.readwrite` → 🩷淡粉 (#D8A0D8)
- 颜色通过 `configurationDefaults.editor.tokenColorCustomizations.textMateRules` 控制
- 只用单行 `match`，避免 `begin/end` 跨行匹配导致 scope 泄漏

### 例化 (Ctrl+1) 修复
- `extractComments` 支持 `#` 和 `(` 分行的模块声明 (`module NAME #\n:(`)
- `extractComments` 支持 `#` 在行尾单独一行 (`module NAME #`)
- `extractComments` 参数区也支持 `//---` section 注释
- `parsePorts` 端口名去尾逗号，与 `extractComments` 键名一致

### 排版 (Ctrl+L) 修复
- `parseLine` 跳过多加 `function/endfunction/task/endtask`
- 信号声明正则加 `\b` 词边界，防 `bit_depth` 被误匹配为 `bit` + `_depth`
- `parseLine` 接收 `tab` 参数，缩进 tab→空格归一化 (`r.length` = 视觉列宽)
- 宽度内容(`[CL :RR]`)从原始body提取，保留原有间距不被压缩
- `cp` 减2让 `:` 落在 tab 边界，`cc` 减1让 `,` 落在 tab 边界

## 已知问题 / 注意事项

1. **xvlog 必须用 `cmd /c` 启动** — 直接 spawn xvlog.bat 可能不触发回调
2. **iverilog 比 xvlog 快 ~10倍** — auto 模式优先用 iverilog
3. **排版正则** — `wire` 和 `[` 之间允许零空格 (`\s*`) 以兼容紧贴写法
4. **补全标识** — 统一用 `[Otter]` 前缀区分来源
5. **端口注释格式** — `),// 注释`（接口）和 `,// 注释`（信号）无空格在逗号后
6. **xvlog 2024.2** — 隐式声明报 `ERROR` 而非 `WARNING`
7. **排版安全** — `function`/`endfunction`/`task`/`endtask` 内容不会被 Ctrl+L 修改
8. **排版 tab** — `parseLine` 内部已将 tab 转空格再计算宽度
9. **排版跨行** — `{...}` 多行拼接的端口，首行端口名参与对齐，中间行/末行不动
10. **VSIX 打包** — 发布用 `npx.cmd -y @vscode/vsce package`，手动上传到 https://marketplace.visualstudio.com/manage/publishers/otter-xiaoxiaoxuwang
11. **GitHub** — repo: `lingshuncangqiong/otter-fpga-toolkit`，`origin` 是 SSH：`git@github.com:lingshuncangqiong/otter-fpga-toolkit.git`
12. **activationEvents 警告** — VSCode 提示可删除，但 `vsce` 打包仍需保留，忽略即可
13. **凭据** — GitHub 推送只使用现有 SSH 认证；不得使用旧 PAT 或把凭据写入 remote URL
14. **当前发布包** — 仓库根目录保留 `otter-fpga-toolkit-2.1.14.vsix`
15. **清理状态** — 当前仓库采用单一真源；测试 VSIX 放在仓库外，根目录只保留最终发布包
