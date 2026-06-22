# DeepSeek监控助手 v0.1.2

这个版本继续修复真实用户反馈的桌面端体验问题，重点让 macOS / Windows 上传版都更像一个正常托盘应用。

## 下载

- macOS Apple Silicon：`DeepSeek-Monitor-0.1.2-mac-arm64.dmg`
- Windows x64：`DeepSeek-Monitor-0.1.2-win-x64-Setup.exe`

## 本次更新

- macOS 和 Windows 都改为点击托盘/菜单栏图标打开面板，不再鼠标经过就自动弹出。
- 去掉启动后自动弹窗，避免用户觉得打扰。
- 顶部增加明确的关闭按钮。
- Windows 托盘和窗口图标改为彩色图标，避免深色任务栏里显示发黑。
- CC Switch 导入增加「Claude GUI」入口，并在链接里附带 `target=gui` / `client=gui` 兼容参数。
- 三个核心数据小卡改为暖黄色强调，更接近用户反馈里喜欢的视觉重点。
- 增加测试覆盖：点击打开、关闭桥接、CC Switch GUI 导入入口、Windows 彩色图标。

## 注意

- CC Switch 当前公开可识别的 app 类型仍是 `claude/codex/gemini/opencode/openclaw/hermes`，所以 GUI 入口仍保持 `app=claude`，额外附带 GUI 目标参数以兼容新版本。
- Windows 安装包当前未做代码签名，如果 SmartScreen 提醒，请选择信任后运行。
- 本工具不会保存 prompt 或模型回复，只保存 Token、命中率、状态码、延迟等用量元数据。
