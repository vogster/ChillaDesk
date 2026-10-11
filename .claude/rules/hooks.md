# Hooks System

## Hook Types

- **PreToolUse**: Before tool execution (validation, parameter modification)
- **PostToolUse**: After tool execution (auto-format, checks)
- **Stop**: When session ends (final verification)

## Current Hooks

### Project (.claude/settings.json)
- **PostToolUse Edit|Write** (`.claude/hooks/post-edit.js`): formats JS/TS with local Prettier; type-checks TS with local tsc and reports errors back

### Plugin (everything-claude-code)
- **SessionStart**: loads previous session context, detects package manager
- **PreCompact**: logs compaction into session state
- **Stop**: warns about console.log in modified JS/TS files
- **SessionEnd**: persists session state, evaluates session for learnable patterns
- Plugin PreToolUse/PostToolUse hooks use expression matchers that Claude Code does not support, so they never fire

## Auto-Accept Permissions

Use with caution:
- Enable for trusted, well-defined plans
- Disable for exploratory work
- Never use dangerously-skip-permissions flag
- Configure `allowedTools` in `~/.claude.json` instead

## TodoWrite Best Practices

Use TodoWrite tool to:
- Track progress on multi-step tasks
- Verify understanding of instructions
- Enable real-time steering
- Show granular implementation steps

Todo list reveals:
- Out of order steps
- Missing items
- Extra unnecessary items
- Wrong granularity
- Misinterpreted requirements
