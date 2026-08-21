# Otter FPGA Toolkit 智能体说明

本 Git 仓库是开发与发布的唯一真源。

## 唯一真源

- 在本仓库根目录完成开发、测试、打包与发布，不得重新创建旧的 `2-dev` / `1-release` 镜像流程。
- 保留用户的无关改动；写入前检查 `git status --short --branch` 和当前 diff。
- 当前发布版本：`2.1.12`。
- 当前 GitHub 发布提交：以 `git log` 中 `main` 的最新发布提交为准。
- 用户确认测试包有效并明确授权发布前，不得修改扩展版本号。

## 验证与发布

1. 每项改动都要执行与风险匹配的检查。修改 JavaScript 后至少运行 `node --check extension.js`；修改 JSON 后解析每个变更文件。
2. 需要测试 VSIX 时，必须输出到明确的临时路径，避免覆盖当前正式发布包：
   `npx.cmd -y @vscode/vsce package --out <temporary-test.vsix>`
3. 用户确认测试包并授权发布后，才可更新 `package.json` 版本、生成最终 `otter-fpga-toolkit-X.Y.Z.vsix`，并核对归档内容。
4. 只提交预期的 tracked files；VSIX 由 Git 忽略。
5. commit、push、版本升级和 Marketplace 发布都必须分别获得用户明确授权。

## GitHub

- `origin` 必须保持为 `git@github.com:lingshuncangqiong/otter-fpga-toolkit.git`。
- 只允许通过 SSH push。不得把 PAT 或 token 写入 remote URL、命令行、仓库或日志。
- GitHub 上登记的 SSH identity 名称为 `Codex Windows`。

## 凭据边界

- GitHub 账号为 `lingshuncangqiong`。当前私钥保留在仓库外的 `C:\Users\15617\.ssh\id_ed25519`；这里只记录定位信息，不代表允许读取、复制、打印、修改、重新生成或打包私钥。
- 获得 push 授权后，先确认 remote 是上述 SSH URL，再执行有超时、只读的 `git ls-remote origin HEAD`。远端读取成功才证明现有 SSH 配置可用。
- 如果密钥缺失或 SSH 认证失败，停止并报告。未经用户明确授权，不得回退到 HTTPS/PAT、使用旧 PAT 文件、修改 SSH service/configuration 或创建替代密钥。
- 旧凭据文件保留在本仓库之外，不是认证来源。普通开发与发布过程不得检查、移动、复制、归档或使用这些文件。
- `.gitignore` 和 `.vscodeignore` 只提供纵深防护；每次 push 或发布前仍须检查 commit 和 VSIX 中是否存在凭据类文件。

## Marketplace

- 不得假设 `vsce publish` 可用。
- 除非用户明确提供有效的 `VSCE_PAT` 并要求自动发布，否则 Marketplace 采用手动上传。
- 手动上传地址：
  `https://marketplace.visualstudio.com/manage/publishers/otter-xiaoxiaoxuwang`
- 当前最终发布包：`otter-fpga-toolkit-2.1.12.vsix`。

## 清理

- 每次发布后，仓库根目录只保留当前最终发布 VSIX。
- 凭据、私钥、迁移备份和临时测试包必须保留在本 Git 仓库之外。
