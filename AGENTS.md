# Otter FPGA Toolkit Agent Notes

This repository is the public release checkout for Otter FPGA Toolkit.

## Source Of Truth

- Develop and test changes in `../2-dev/`.
- Sync into this `1-release/` repository only after the user confirms the test build works.
- Do not edit stale duplicate files from the parent project root if they exist.
- Current release: `2.1.9`.
- Current GitHub release commit: `e5ab9d671309372654e83b624561f5680ad799a1`.

## Release Rules

1. Back up changed release files or the whole `1-release/` folder before publishing.
2. Package the test build from `../2-dev/` with:
   `npx.cmd -y @vscode/vsce package`
3. After user confirmation, copy the intended files into `1-release/`:
   `extension.js`, `package.json`, `README.md` as `readme.md`, `language-configuration.json`, `LICENSE`, `icon.png`, and `syntaxes/*.json`.
4. Bump `package.json` only when the user confirms a release.
5. Package the release VSIX from `1-release/` with:
   `npx.cmd -y @vscode/vsce package`
6. Commit only intended source/release metadata files. VSIX files are ignored by Git.
7. Push GitHub through SSH only:
   `git@github.com:lingshuncangqiong/otter-fpga-toolkit.git`

## GitHub

- `origin` should be `git@github.com:lingshuncangqiong/otter-fpga-toolkit.git`.
- Do not put a PAT/token in the remote URL.
- The old PAT in `../secrets/token.txt` is invalid and must not be used.
- SSH key name on GitHub: `Codex Windows`.

## Marketplace

- Do not assume `vsce publish` works.
- The user cannot currently create the Azure DevOps publisher PAT flow because Azure asks for a subscription/card.
- Marketplace publishing is manual unless the user explicitly provides a valid `VSCE_PAT`.
- Manual upload URL:
  `https://marketplace.visualstudio.com/manage/publishers/otter-xiaoxiaoxuwang`
- Upload the final release VSIX from `1-release/`, currently:
  `otter-fpga-toolkit-2.1.9.vsix`

## Cleanup

- After each release, keep only the final `1-release/otter-fpga-toolkit-X.Y.Z.vsix`.
- Delete `../2-dev/*.vsix` test packages and old release VSIX files after the final package is available.
- Keep `_backups/` in the parent project unless the user explicitly asks to remove backups.
