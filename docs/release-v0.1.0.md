# DeepSeek监控助手 v0.1.0

第一版桌面成品发布，重点解决 Claude Code + DeepSeek 用户看不清 Token 消耗和缓存命中状态的问题。

## 下载

- macOS Apple Silicon：`DeepSeek-Monitor-0.1.0-mac-arm64.dmg`
- Windows x64：`DeepSeek-Monitor-0.1.0-win-x64.exe`

## 本次更新

- 新增 macOS 桌面应用打包，菜单栏可显示 `DS` 图标。
- 新增 Windows x64 单文件 exe，可直接运行。
- 新增应用图标资源，桌面端不再显示默认 Electron 图标。
- 新增 electron-builder 打包配置，后续可持续生成安装包。
- 修复受限环境下系统状态扫描失败导致测试失败的问题。
- 保留原有核心能力：DeepSeek 余额、今日 Token、V4 Flash / V4 Pro 消耗、缓存命中率、一键体检和安全修复建议。

## 注意

- macOS 版本当前未做 Apple notarization，首次打开可能需要右键选择“打开”。
- Windows 当前为便携版 exe，不需要安装器；如果安全软件提醒，请选择信任后运行。
- 本工具不会保存 prompt 或模型回复，只保存 Token、命中率、状态码、延迟等用量元数据。
