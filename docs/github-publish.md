# GitHub Publish Notes

## Recommended Repository Name

Use:

```text
deepseek-token-monitor
```

Why:

- `deepseek` matches users searching for DeepSeek tools.
- `claude-code` matches the exact workflow.
- `monitor` is easier to search than "assistant".
- Token/cache keywords are still covered by the repository description, topics, and README title.

Alternative names:

```text
deepseek-claude-token-monitor
deepseek-token-cache-monitor
claude-code-deepseek-monitor
```

The recommended one is still `deepseek-token-monitor` because it is clear, not too long, and contains the most important search terms.

## Repository Description

Use this in the GitHub "About" description:

```text
Claude Code + DeepSeek tray monitor for token usage, cache hit rate, balance, and safe diagnostics.
```

Chinese version for social posts:

```text
Claude Code + DeepSeek 用量监控助手：实时查看 Token、缓存命中率、余额，并提供安全体检与修复建议。
```

## Topics

Add these GitHub topics:

```text
deepseek
claude-code
token-usage
prompt-caching
cache-monitor
anthropic-api
openai-compatible
ccswitch
electron
tray-app
macos
windows
ai-tools
developer-tools
```

GitHub's repository search looks at repository name, description, topics, and README content. Topics also help users browse related repositories by subject.

## Short Launch Copy

```text
DeepSeek监控助手 is a lightweight tray app for Claude Code + DeepSeek users.

It shows token usage, V4 Flash / V4 Pro split, account balance, cache hit rate, and 7-day token trends. The built-in Doctor avoids false alarms from new conversation warmup, detects real long-session cache problems, and only repairs safe local issues with explicit confirmation.
```

## Screenshot

Use:

```text
docs/assets/deepseek-monitor-assistant-preview.png
```

## Upload Checklist

- Repository name: `deepseek-token-monitor`
- Description filled in
- Topics added
- README screenshot renders
- License shows MIT
- `.env` and local data are not committed
- Run `npm test`
- Run `npm audit --omit=dev`
- Verify no real API keys are present
