# 排版引擎维护

## 架构与范围

2026-09-16 用户确认 CST 测试版（含 genvar）效果后，将源码、合成用例和解析器纳入本仓库；不再维护实验镜像。VS Code 与 CLI 使用同一实现。

- `cst-layout.js`：Verible 输出 CST 与 token，按 UTF-8 字节位置提取字段，由 module/generate 作用域计算声明列宽。
- `cst-runtime.js`：组合声明布局与 `extension.js` 中的模块头/例化 renderer，限制选区，重新解析输出并比较 token。
- `cst-editor.js`、`cst-worker.js`：编辑器后台排版；编辑器命令检查文档版本后应用编辑。
- `format-cli.js`：复用相同入口，保留 BOM 和逐行换行符；解析失败不写入。JSON 的 `skipped` 列出保留的未覆盖声明，空白检查通过不等于完整语言覆盖。
- `layout-profile.json`：声明列间隔、范围冒号及初值尾列上限。现行用户行为以主 README 为准。

模块体不再用空行、标题名称或输入缩进猜分组；旧模块体布局代码已移除。模块头/例化的既有 renderer 仍保留，不宣称整份文件均由 CST 布局。函数、任务、过程块及不支持的声明原样保留；不要为了让解析通过而猜改 RTL，或失败后静默换回旧排版器。

## 验证与打包

在仓库根运行 `npm run check`。`test/cst-formatter.test.js` 覆盖跨声明类型对齐、wire 类型节点、genvar、数组、长表达式、中文、作用域、幂等、选区、CLI/worker 一致性以及解析失败；现有端口/例化和其它功能回归仍保留。

`test/fixtures/formatter/declarations.sv` 及 `.expected.sv` 是合成输入和可审阅的版式对照，不依赖个人工程。调整布局时先检查差异与预期，不把新生成结果直接当作已接受基准。临时的真实工程副本、HTML 对照和旧验证报告不进入仓库或 VSIX。

打包命令见仓库 `AGENTS.md`。使用 `--target win32-x64`，测试包与正式包放根目录并由 Git 忽略。版本号仅在用户授权发布时更新。包内保留解析器和许可，不包含测试样本、维护文档或实验目录。

## Verible 来源与更新

解析器来自 [chipsalliance/verible](https://github.com/chipsalliance/verible)，随仓库存放于 `vendor/verible/`。下载资产 URL、ZIP SHA256、实际二进制版本和 EXE SHA256 记录在 `SOURCE.json`，完整许可保留在 `LICENSE.txt`。

当前资产标签为 `v0.0-4214-gce503962`，二进制自报 `v0.0-4192-g682a1d50`，两者存在上游标记差异；实际采用的文件以 EXE SHA256 为准。当前只带 Windows x64 二进制，不在运行时下载工具。

升级时核对官方资产摘要、实际 `--version` 与许可证，更新 `SOURCE.json`，再运行排版回归。CST 节点结构可能变化，尤其 net declaration 与 data declaration 的类型节点并不相同；不能只替换 EXE 而不检查字段提取与输出差异。版本变更通过 Git 记录，不保留平行的新旧工具目录。
