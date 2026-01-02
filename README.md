# Ralph Wiggum for Pi Coding Agent

> "Ralph is deterministically bad in an undeterministic world."

Implementation of the Ralph Wiggum technique for iterative AI development loops in the [Pi Coding Agent](https://github.com/badlogic/pi-mono).

## What is Ralph?

Ralph is a development technique for autonomous iterative AI loops. At its core:

> **Original article:** [https://ghuntley.com/ralph/](https://ghuntley.com/ralph/) by Geoffrey Huntley

```bash
while :; do cat PROMPT.md | pi ; done
```

The same prompt is fed repeatedly to an AI agent. The "self-referential" aspect comes from the AI seeing its own previous work in files and git history - not from feeding output back as input.

## Features

- ✅ Iteration loop with `--max-iterations` limit
- ✅ Completion promise detection via `<promise>TAG</promise>` tags
- ✅ Iteration counter displayed in status bar
- ✅ Status preservation across sessions
- ✅ Strict validation (requires prompt + either max-iterations or completion-promise)
- ✅ Optional subagent mode flag (reserved for future use)
- ✅ Detailed completion summaries with iteration count and duration
- ✅ Error recovery (continues loop on errors - errors are part of iteration)
- ✅ New message rejection when loop is active (requires `/cancel-ralph`)

## Quick Start

### Installation

The hook file is `ralph.ts`. Install it to your hooks directory:

```bash
# Option 1: Copy to global hooks
cp ralph.ts ~/.pi/agent/hooks/ralph.ts

# Option 2: Load with --hook flag
pi --hook ./ralph.ts

# Option 3: Symlink for development
ln -s $(pwd)/ralph.ts ~/.pi/agent/hooks/ralph.ts
```

### Usage

```bash
# Start a Ralph loop
/ralph-loop "Build a REST API" --max-iterations 50 --completion-promise "DONE"

# Cancel active loop
/cancel-ralph

# Get help
/ralph-help
```

### Completion

To signal completion, output:

```xml
<promise>DONE</promise>
```

When detected (exact string match), the loop terminates with a summary.

## Examples

### Basic Loop

```bash
/ralph-loop "Build a todo REST API" --max-iterations 50 --completion-promise "DONE"
```

### With Quoted Prompt

```bash
/ralph-loop "Fix the authentication bug" --completion-promise "FIXED" --max-iterations 10
```

### Debugging Mode (Infinite with manual stop)

```bash
/ralph-loop "Try to implement feature X" --max-iterations 20
```

## Philosophy

Ralph is based on principles:

1. **Iteration > Perfection** - Let the loop refine work
2. **One item per loop** - Focus on single task per iteration
3. **Errors are data** - Failures inform prompt tuning
4. **Eventual consistency** - Trust the loop to converge
5. **Backpressure is everything** - Tests and validation reject bad code

## Architecture

**Single Hook:** `ralph.ts`
- Registers three commands: `/ralph-loop`, `/cancel-ralph`, `/ralph-help`
- Manages loop state in `.pi/ralph-loop.local.md`
- Uses `agent_end` event to detect completion and re-inject prompts
- Uses `agent_start` event to update status line

**State File:** `.pi/ralph-loop.local.md`
- YAML frontmatter with loop metadata
- Original prompt after `---` separator
- Persists across sessions

## When to Use Ralph

**Good for:**
- Well-defined tasks with clear success criteria
- Greenfield projects
- Tasks requiring iteration (getting tests to pass)
- Tasks with automatic verification

**Not good for:**
- Existing codebases
- Tasks requiring human judgment
- One-shot operations
- Unclear success criteria

## Testing

Run the test script:

```bash
./test.sh
```

Expected output:

```
=== Ralph Wiggum Hook - Quick Tests ===

✅ PASSED: Hook compiles without errors
✅ PASSED: State file format looks correct
✅ PASSED: Hook file exists
✅ PASSED: README exists

=== All basic tests passed! ===
```

## Code Review

All code was reviewed with fresh eyes. See `docs/code-review-fixes.md` for details on issues found and fixed.

## Credits

- **Original technique:** Geoffrey Huntley - [https://ghuntley.com/ralph/](https://ghuntley.com/ralph/)
- **Claude Code plugin:** [Anthropic](https://github.com/anthropics/claude-code)
- **Pi port:** Adapted for Pi Coding Agent architecture

## Documentation

| Document | Description |
|----------|-------------|
| [Porting Plan](docs/porting-plan.md) | Detailed architecture comparison |

## License

MIT - See [LICENSE](LICENSE) file for details.
