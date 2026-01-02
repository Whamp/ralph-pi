# Ralph Wiggum → Pi Porting Plan

## Research Findings

### 1. Pi's Hook System (vs Claude Code's Stop Hook)

**Claude Code:**
- Has a dedicated "Stop" hook that intercepts session exit
- Returns JSON with `decision: "block"` and `reason` (prompt to feed back)
- Directly blocks the exit and feeds output back as new input

**Pi:**
- No "Stop" hook, but has lifecycle events
- Key event: `agent_end` - fires after each user prompt completes
- Hooks can inject messages via `pi.sendMessage()` to trigger new turns
- Solution: Use `agent_end` to inject the same prompt back for next iteration

### 2. Command System

**Claude Code:**
- Commands are markdown files with YAML frontmatter
- `allowed-tools` field specifies which tools can be used
- `hide-from-slash-command-tool` controls visibility

**Pi:**
- Commands are simple markdown files with a `description` in frontmatter
- Use `$@` placeholder for command arguments
- Commands just describe what to do - no tool restrictions
- Commands typically delegate to hooks or custom tools

### 3. State Management

| System | Location | Format |
|--------|----------|--------|
| Claude Code | `.claude/ralph-loop.local.md` | YAML frontmatter + prompt |
| Pi | `.pi/ralph-loop.local.md` | Same format |

### 4. Subagent System

**Claude Code:**
- Subagents spawned via subagent tool
- Can be chain, parallel, or single mode
- Context isolation per subagent

**Pi:**
- Subagents run in separate `pi` processes
- Full streaming output, parallel execution
- User-level agents in `~/.pi/agent/agents/*.md`
- Project-local agents in `.pi/agents/*.md` (require trust)
- Can pass `{previous}` placeholder between chain steps

### 5. Completion Detection

**Claude Code:**
- Parses transcript JSONL to find last assistant message
- Uses Perl regex to extract `<promise>text</promise>` tags
- Exact string matching against completion_promise

**Pi:**
- Can access session entries via `ctx.sessionManager.getEntries()`
- Find last assistant message similarly
- Parse for `<promise>` tags
- Can also use `agent_end` event which receives the messages

## Porting Architecture

### Single Hook: `ralph.ts`

The hook will handle:
1. Registering commands: `/ralph-loop`, `/cancel-ralph`, `/ralph-help`
2. Managing state in `.pi/ralph-loop.local.md`
3. Iteration loop via `agent_end` event
4. Completion promise detection
5. Max iteration enforcement

### Commands

| Command | Description | Implementation |
|---------|-------------|----------------|
| `/ralph-loop <prompt> [options]` | Start Ralph loop | Creates state file, displays instructions |
| `/cancel-ralph` | Cancel active loop | Deletes state file |
| `/ralph-help` | Show Ralph help | Displays documentation |

### State File Format (`.pi/ralph-loop.local.md`)

```yaml
---
active: true
iteration: 1
max_iterations: 50
completion_promise: "DONE"
started_at: "2026-01-02T17:35:07Z"
---

<prompt text goes here>
```

### Iteration Flow

```
User runs: /ralph-loop "Build a REST API" --completion-promise "DONE"
  ↓
Command creates .pi/ralph-loop.local.md with iteration: 1
  ↓
Command displays initial prompt (sets editor text)
  ↓
User submits (or agent auto-starts)
  ↓
Agent works on task (modifies files, runs tests, etc.)
  ↓
Agent completes turn → agent_end event fires
  ↓
Hook checks:
  - Is ralph-loop.local.md active?
  - Is iteration >= max_iterations? → Remove state file, exit
  - Does last assistant message contain <promise>DONE</promise>? → Remove state file, exit
  ↓
If neither condition met:
  - Increment iteration counter
  - Inject original prompt via pi.sendMessage(prompt, true)
  - Process repeats
```

## Key Implementation Details

### 1. Command Registration (in hook)

```typescript
pi.registerCommand("ralph-loop", {
  description: "Start Ralph Wiggum iterative loop",
  handler: async (args, ctx) => {
    // Parse args for --max-iterations and --completion-promise
    // Create state file
    // Set editor text with prompt
    // Display iteration info
  }
});

pi.registerCommand("cancel-ralph", {
  description: "Cancel active Ralph loop",
  handler: async (args, ctx) => {
    // Check for state file
    // Delete if exists
    // Report status
  }
});

pi.registerCommand("ralph-help", {
  description: "Show Ralph Wiggum documentation",
  handler: async (args, ctx) => {
    // Display help text
  }
});
```

### 2. Agent End Handler (in hook)

```typescript
pi.on("agent_end", async (event, ctx) => {
  const stateFile = path.join(ctx.cwd, ".pi", "ralph-loop.local.md");

  // Check if loop is active
  if (!fs.existsSync(stateFile)) return;

  // Parse state file
  const state = parseStateFile(stateFile);

  // Check max iterations
  if (state.max_iterations > 0 && state.iteration >= state.max_iterations) {
    ctx.ui.notify(`Ralph: Max iterations (${state.max_iterations}) reached`, "info");
    fs.unlinkSync(stateFile);
    return;
  }

  // Check for completion promise in last assistant message
  const lastAssistant = findLastAssistantMessage(event.messages);
  const promiseMatch = extractPromise(lastAssistant);

  if (state.completion_promise && promiseMatch === state.completion_promise) {
    ctx.ui.notify(`Ralph: Completion detected: <promise>${promiseMatch}</promise>`, "success");
    fs.unlinkSync(stateFile);
    return;
  }

  // Not complete - increment and continue
  const nextIteration = state.iteration + 1;
  updateIteration(stateFile, nextIteration);

  // Extract original prompt and inject
  const prompt = extractPromptFromStateFile(stateFile);
  pi.sendMessage({
    customType: "ralph-loop",
    content: prompt,
    display: true,
  }, true); // true = trigger new agent turn
});
```

### 3. Promise Extraction

```typescript
function extractPromise(messageText: string): string | null {
  // Use regex to find <promise>...</promise> tags
  // Normalize whitespace for comparison
  const match = messageText.match(/<promise>(.*?)<\/promise>/s);
  if (match) {
    return match[1].trim().replace(/\s+/g, ' ');
  }
  return null;
}
```

### 4. Finding Last Assistant Message

```typescript
function findLastAssistantMessage(messages: Message[]): Message | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === "assistant") {
      return msg;
    }
  }
  return null;
}
```

## Pi-Specific Enhancements

Based on your request to leverage pi's capabilities:

1. **Status Line Display**: Use `ctx.ui.setStatus()` to show iteration count in footer
2. **Custom Message Renderer**: Register a renderer for "ralph-loop" messages to distinguish iterations
3. **Subagent Integration**: Optional mode where each iteration uses a dedicated subagent
4. **TUI Progress**: Could show a custom TUI component during long iterations

### Example: Status Line

```typescript
pi.on("agent_start", async (_event, ctx) => {
  const stateFile = path.join(ctx.cwd, ".pi", "ralph-loop.local.md");
  if (fs.existsSync(stateFile)) {
    const state = parseStateFile(stateFile);
    const max = state.max_iterations > 0 ? `/${state.max_iterations}` : "";
    ctx.ui.setStatus("ralph", `Ralph iteration: ${state.iteration}${max}`);
  }
});

pi.on("agent_end", async (_event, ctx) => {
  ctx.ui.setStatus("ralph", undefined); // Clear status
});
```

## Testing Strategy

1. **Unit Tests**: Test state file parsing, promise extraction, iteration logic
2. **Integration Tests**: Test full loop with simple task
3. **Edge Cases**:
   - Max iterations = 0 (unlimited)
   - No completion promise set
   - Corrupted state file
   - Multiple promises in output (should use first)
   - User manually deletes state file

## Questions to Resolve

1. **Command vs Hook Placement**:
   - Should commands be simple markdown that delegates to hook?
   - Or should hook directly handle everything?

   **Recommendation**: Hook-only approach for simplicity. Commands are registered by the hook.

2. **Promise Detection**:
   - Parse from `event.messages` in `agent_end`?
   - Or parse from session entries like Claude Code?

   **Recommendation**: Use `event.messages` from `agent_end` - simpler and more direct.

3. **Loop Termination**:
   - What happens if user sends a new message while Ralph is active?
   - Should we interrupt the loop?

   **Recommendation**: Allow interruption. If user sends a new prompt, cancel Ralph loop and switch to normal mode. Add confirmation: "Ralph loop active. Cancel to start new task?"

4. **Error Handling**:
   - What if agent errors during a Ralph iteration?
   - Should the loop continue?

   **Recommendation**: Yes, continue the loop. Ralph is about iteration and self-correction. Errors are part of the process.

## File Structure

```
.pi/
├── hooks/
│   └── ralph.ts              # Main hook implementation
├── commands/                  # Optional: simple command files
│   ├── ralph-loop.md
│   ├── cancel-ralph.md
│   └── ralph-help.md
└── ralph-loop.local.md       # Runtime state (not committed)
```

## Implementation Priority

1. ✅ Research pi architecture (COMPLETE)
2. ⏳ Create hook skeleton with command registration
3. ⏳ Implement state file I/O
4. ⏳ Implement `/ralph-loop` command
5. ⏳ Implement `agent_end` handler for iteration loop
6. ⏳ Implement completion promise detection
7. ⏳ Implement `/cancel-ralph` command
8. ⏳ Add status line display
9. ⏳ Add error handling and edge cases
10. ⏳ Test with simple tasks
11. ⏳ Add `/ralph-help` documentation

## Next Steps

1. Review this plan with you
2. Approve architecture and any design decisions
3. Begin implementation starting with hook skeleton
4. Test incrementally with simple examples
