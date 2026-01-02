/**
 * Ralph Wiggum Hook - Pi Coding Agent
 *
 * Implementation of Ralph Wiggum technique for iterative AI development loops.
 *
 * Philosophy:
 * - Ralph is a bash loop: while :; do cat PROMPT.md | pi ; done
 * - One item per loop - focus on single task per iteration
 * - Errors are part of iteration - continue to loop
 * - Subagents for expensive operations to keep context clean
 * - Eventual consistency - trust to loop to converge
 *
 * Architecture:
 * - Hook manages loop state in .pi/ralph-loop.local.md
 * - agent_end event checks for completion and re-injects prompt
 * - Commands registered by hook: /ralph-loop, /cancel-ralph, /ralph-help
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { HookAPI, SessionEntry } from "@mariozechner/pi-coding-agent";

// State file structure (YAML frontmatter in markdown)
interface RalphState {
	active: boolean;
	iteration: number;
	max_iterations: number;
	completion_promise: string | null;
	started_at: string;
	subagent_mode: boolean; // Reserved for future: use subagents per iteration
}

const STATE_FILE = ".pi/ralph-loop.local.md";
const RALPH_STATUS_KEY = "ralph-loop-status";

/**
 * Parse command arguments string into tokens
 * Handles both quoted and unquoted arguments
 */
function parseArgs(args: string): string[] {
	const tokens: string[] = [];
	let current = "";
	let inQuotes = false;

	for (let i = 0; i < args.length; i++) {
		const char = args[i];

		if (char === '"' && (i === 0 || args[i - 1] !== '\\')) {
			inQuotes = !inQuotes;
		} else if (char === ' ' && !inQuotes) {
			if (current.trim()) {
				tokens.push(current.trim());
			}
			current = "";
		} else {
			current += char;
		}
	}

	if (current.trim()) {
		tokens.push(current.trim());
	}

	return tokens;
}

/**
 * Parse state file and extract frontmatter + prompt
 */
function parseStateFile(content: string): { state: RalphState; prompt: string } {
	const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
	if (!frontmatterMatch) {
		throw new Error("Invalid state file format");
	}

	const frontmatterText = frontmatterMatch[1];
	const prompt = frontmatterMatch[2];

	// Default state
	const state: RalphState = {
		active: false,
		iteration: 1,
		max_iterations: 0,
		completion_promise: null,
		started_at: "",
		subagent_mode: false,
	};

	// Parse simple YAML key-value pairs
	for (const line of frontmatterText.split("\n")) {
		const parts = line.split(":");
		if (parts.length > 0) {
			const key = parts[0].trim();
			const value = parts.slice(1).join(":").trim();

			if (key === "iteration" || key === "max_iterations") {
				const num = parseInt(value, 10);
				if (isNaN(num)) {
					throw new Error(`Invalid state file: ${key} must be a number (got: ${value})`);
				}
				(state as any)[key] = num;
			} else if (key === "completion_promise") {
				if (value === "null" || value === '""' || value === "null") {
					(state as any)[key] = null;
				} else {
					// Remove surrounding quotes if present
					(state as any)[key] = value.replace(/^"|"$/g, "");
				}
			} else if (key === "active" || key === "subagent_mode") {
				(state as any)[key] = value === "true";
			} else {
				(state as any)[key] = value;
			}
		}
	}

	return { state, prompt };
}

/**
 * Extract <promise>...</promise> tag from text
 */
function extractPromise(text: string): string | null {
	// Use regex to find promise tags - handles multiline content
	const match = text.match(/<promise>([\s\S]*?)<\/promise>/s);
	if (match !== null) {
		// Normalize whitespace
		return match[1].trim().replace(/\s+/g, " ");
	}
	return null;
}

/**
 * Find last assistant message from entries
 */
function findLastAssistantMessage(entries: SessionEntry[]): string | null {
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i];
		if (entry.type === "message" && entry.message.role === "assistant") {
			const content = entry.message.content;
			if (typeof content === "string") {
				return content;
			} else if (Array.isArray(content)) {
				// Filter for text content only (ignore images)
				return content
					.filter((c): c is { type: "text"; text: string } => c.type === "text")
					.map((c) => c.text)
					.join("\n");
			}
		}
	}
	return null;
}

/**
 * Update iteration counter in state file
 */
function updateIteration(stateFilePath: string, newIteration: number): void {
	const content = fs.readFileSync(stateFilePath, "utf-8");
	const updated = content.replace(/^iteration: \d+$/m, `iteration: ${newIteration}`);
	fs.writeFileSync(stateFilePath, updated, "utf-8");
}

/**
 * Calculate duration from started_at timestamp
 */
function calculateDuration(startedAt: string): number {
	if (!startedAt) return 0;
	const startTime = new Date(startedAt).getTime();
	if (isNaN(startTime)) return 0;
	return Math.round((Date.now() - startTime) / 1000);
}

/**
 * Check if entry is a loop re-injection (not user input)
 */
function isLoopReinjection(entry: SessionEntry | null): boolean {
	if (!entry || entry.type !== "message") return false;
	return entry.type === "custom" && (entry as any).customType === "ralph-loop";
}

export default function (pi: HookAPI) {
	// ==================== Commands ====================

	pi.registerCommand("ralph-loop", {
		description: "Start Ralph Wiggum iterative loop",
		handler: async (args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("Ralph requires interactive mode", "error");
				return;
			}

			// Parse args string into tokens
			const tokens = parseArgs(args);
			const argParts: string[] = [];
			let maxIterations = 0;
			let completionPromise: string | null = null;
			let subagentMode = false;

			// Parse options
			let i = 0;
			while (i < tokens.length) {
				const arg = tokens[i];
				if (arg === "--max-iterations" && i + 1 < tokens.length) {
					const val = parseInt(tokens[i + 1], 10);
					if (isNaN(val) || val < 0) {
						ctx.ui.notify("Invalid --max-iterations value", "error");
						return;
					}
					maxIterations = val;
					i += 2;
				} else if (arg === "--completion-promise" && i + 1 < tokens.length) {
					completionPromise = tokens[i + 1];
					i += 2;
				} else if (arg === "--subagent") {
					subagentMode = true;
					i += 1;
				} else {
					argParts.push(arg);
					i += 1;
				}
			}

			const prompt = argParts.join(" ").trim();

			// Strict validation
			if (!prompt) {
				ctx.ui.notify("Error: Prompt is required", "error");
				ctx.ui.notify("Usage: /ralph-loop \"<prompt>\" [--max-iterations N] [--completion-promise TEXT] [--subagent]", "info");
				return;
			}

			if (maxIterations === 0 && !completionPromise) {
				ctx.ui.notify("Error: Must specify either --max-iterations or --completion-promise", "error");
				ctx.ui.notify("Without either, loop will run forever with no way to complete!", "warning");
				return;
			}

			// Check if already active
			const stateFilePath = path.join(ctx.cwd, STATE_FILE);
			if (fs.existsSync(stateFilePath)) {
				const ok = await ctx.ui.confirm(
					"Active loop detected",
					"Cancel existing Ralph loop and start a new one?",
				);
				if (!ok) {
					ctx.ui.notify("Cancelled. Use /cancel-ralph first to clear existing loop.", "info");
					return;
				}
				fs.unlinkSync(stateFilePath);
			}

			// Create .pi directory if needed
			const piDir = path.join(ctx.cwd, ".pi");
			if (!fs.existsSync(piDir)) {
				fs.mkdirSync(piDir, { recursive: true });
			}

			// Create state file
			const now = new Date().toISOString();
			const promiseYaml = completionPromise ? `"${completionPromise}"` : "null";
			const stateContent = `---
active: true
iteration: 1
max_iterations: ${maxIterations}
completion_promise: ${promiseYaml}
started_at: "${now}"
subagent_mode: ${subagentMode}
---

${prompt}`;

			fs.writeFileSync(stateFilePath, stateContent, "utf-8");

			// Display setup message
			const maxText = maxIterations > 0 ? `${maxIterations}` : "unlimited";
			const promiseText = completionPromise
				? `${completionPromise} (ONLY output when TRUE - do not lie!)`
				: "none (infinite loop!)";
			const subagentText = subagentMode ? "\nSubagent mode: ENABLED (reserved for future use)" : "";

			const setupMessage = `🔄 Ralph loop activated in this session!

Iteration: 1
Max iterations: ${maxText}
Completion promise: ${promiseText}${subagentText}

The loop is now active. When the agent completes a turn, the SAME PROMPT
will be fed back for the next iteration. You'll see your previous work
in files and git history, creating a self-referential loop where you
iteratively improve on the same task.

To stop manually: /cancel-ralph
To monitor: head -20 ${STATE_FILE}

⚠️  WARNING: This loop will run until the completion promise is detected
    or max iterations is reached. You cannot interrupt it directly.
`;

			ctx.ui.notify(setupMessage, "info");

			// Set editor text with initial prompt
			ctx.ui.setEditorText(prompt);

			// Show in status line
			const statusText = maxIterations > 0 ? `Ralph: 1/${maxIterations}` : "Ralph: ∞";
			ctx.ui.setStatus(RALPH_STATUS_KEY, statusText);
		},
	});

	pi.registerCommand("cancel-ralph", {
		description: "Cancel active Ralph Wiggum loop",
		handler: async (_args, ctx) => {
			const stateFilePath = path.join(ctx.cwd, STATE_FILE);

			if (!fs.existsSync(stateFilePath)) {
				ctx.ui.notify("No active Ralph loop found", "info");
				return;
			}

			try {
				const content = fs.readFileSync(stateFilePath, "utf-8");
				const { state } = parseStateFile(content);
				const duration = calculateDuration(state.started_at);

				fs.unlinkSync(stateFilePath);
				ctx.ui.setStatus(RALPH_STATUS_KEY, undefined);

				const durationText = duration > 0 ? ` (${duration}s)` : "";
				ctx.ui.notify(`Cancelled Ralph loop (was at iteration ${state.iteration}${durationText})`, "info");
			} catch (error) {
				ctx.ui.notify(`Error cancelling loop: ${error}`, "error");
				// Try to delete state file anyway to prevent stuck loops
				try {
					fs.unlinkSync(stateFilePath);
				} catch {
					// Ignore
				}
			}
		},
	});

	pi.registerCommand("ralph-help", {
		description: "Show Ralph Wiggum documentation",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) {
				console.log(RALPH_HELP_TEXT);
				return;
			}

			// Use editor for interactive viewing
			await ctx.ui.editor("Ralph Wiggum Help", RALPH_HELP_TEXT);
		},
	});

	// ==================== Agent Events ====================

	pi.on("agent_start", async (_event, ctx) => {
		const stateFilePath = path.join(ctx.cwd, STATE_FILE);
		if (!fs.existsSync(stateFilePath)) return;

		try {
			const content = fs.readFileSync(stateFilePath, "utf-8");
			const { state } = parseStateFile(content);

			// Refuse new messages if Ralph is active and this is not a loop re-injection
			if (ctx.hasUI && ctx.sessionManager.getEntries().length > 0) {
				const lastEntry = ctx.sessionManager.getLeafEntry();
				const isUserMessage =
					lastEntry &&
					lastEntry.type === "message" &&
					lastEntry.message.role === "user" &&
					!isLoopReinjection(lastEntry);

				if (isUserMessage) {
					const ok = await ctx.ui.confirm(
						"Ralph loop active",
						"Cancel Ralph and start a new task? (Otherwise current loop continues)",
					);
					if (ok) {
						fs.unlinkSync(stateFilePath);
						ctx.ui.setStatus(RALPH_STATUS_KEY, undefined);
						ctx.ui.notify("Ralph cancelled. Starting new task...", "info");
					} else {
						ctx.ui.notify("Ralph loop continues. Use /cancel-ralph to stop it.", "info");
						throw new Error("Ralph loop active - new prompt refused");
					}
				}
			}

			// Update status line
			if (state.active) {
				const maxText = state.max_iterations > 0 ? `/${state.max_iterations}` : "";
				ctx.ui.setStatus(RALPH_STATUS_KEY, `Ralph: ${state.iteration}${maxText}`);
			}
		} catch (error) {
			ctx.ui.notify(`Ralph error: ${error}`, "error");
		}
	});

	pi.on("agent_end", async (event, ctx) => {
		const stateFilePath = path.join(ctx.cwd, STATE_FILE);
		if (!fs.existsSync(stateFilePath)) return;

		try {
			const content = fs.readFileSync(stateFilePath, "utf-8");
			const { state, prompt } = parseStateFile(content);

			if (!state.active) return;

			// Check max iterations
			if (state.max_iterations > 0 && state.iteration >= state.max_iterations) {
				const duration = calculateDuration(state.started_at);
				const summary = `🛑 Ralph loop: Max iterations (${state.max_iterations}) reached

Summary:
- Iterations: ${state.iteration}
- Duration: ${duration}s
- Reason: Max iterations reached
`;

				ctx.ui.notify(summary, "info");
				fs.unlinkSync(stateFilePath);
				ctx.ui.setStatus(RALPH_STATUS_KEY, undefined);
				return;
			}

			// Check for completion promise in last assistant message
			const lastAssistantText = findLastAssistantMessage(ctx.sessionManager.getEntries());
			const promiseMatch = lastAssistantText ? extractPromise(lastAssistantText) : null;

			if (state.completion_promise && promiseMatch === state.completion_promise) {
				const duration = calculateDuration(state.started_at);
				const summary = `✅ Ralph loop: Completion detected

Summary:
- Iterations: ${state.iteration}
- Duration: ${duration}s
- Reason: Completion promise matched: <promise>${promiseMatch}</promise>
`;

				ctx.ui.notify(summary, "success");
				fs.unlinkSync(stateFilePath);
				ctx.ui.setStatus(RALPH_STATUS_KEY, undefined);
				return;
			}

			// Not complete - increment and continue
			const nextIteration = state.iteration + 1;
			updateIteration(stateFilePath, nextIteration);

			// Build system message
			let systemMsg = "";
			if (state.completion_promise) {
				systemMsg = `🔄 Ralph iteration ${nextIteration} | To stop: output <promise>${state.completion_promise}</promise> (ONLY when TRUE - do not lie!)`;
			} else if (state.max_iterations > 0) {
				systemMsg = `🔄 Ralph iteration ${nextIteration}/${state.max_iterations}`;
			} else {
				systemMsg = `🔄 Ralph iteration ${nextIteration} | Infinite loop`;
			}

			// Inject the same prompt back
			pi.sendMessage(
				{
					customType: "ralph-loop",
					content: prompt,
					display: true,
				},
				true,
			); // true = trigger new turn
		} catch (error) {
			ctx.ui.notify(`Ralph error: ${error}`, "error");
			// Don't delete state file on error - let user decide
		}
	});

	// ==================== Cleanup ====================

	pi.on("session_shutdown", async (_event, ctx) => {
		// Keep state file across sessions - Ralph should persist
	});
}

// ==================== Help Text ====================

const RALPH_HELP_TEXT = `# Ralph Wiggum for Pi Coding Agent

## What is Ralph?

Ralph is a development technique for iterative AI loops. At its core:
\`\`\`bash
while :; do cat PROMPT.md | pi ; done
\`\`\`

The same prompt is fed repeatedly. The "self-referential" aspect comes
from the AI seeing its own previous work in files and git history,
not from feeding output back as input.

## Philosophy

- **Iteration > Perfection**: Let to loop refine work
- **One item per loop**: Focus on single task per iteration
- **Errors are data**: Failures inform prompt tuning
- **Eventual consistency**: Trust to loop to converge
- **Backpressure is everything**: Tests and validation reject bad code

## Commands

### /ralph-loop "<prompt>" [OPTIONS]

Start a Ralph loop.

**Options:**
- \`--max-iterations N\` - Stop after N iterations
- \`--completion-promise TEXT\` - Phrase signaling completion
- \`--subagent\` - Reserved for future subagent integration

**Examples:**
\`\`\`
/ralph-loop "Build a REST API" --max-iterations 50
/ralph-loop "Fix the auth bug" --completion-promise "FIXED" --max-iterations 10
/ralph-loop "Refactor cache layer" --completion-promise "DONE"
\`\`\`

**Completion:**
To signal completion, output:
\`\`\`
<promise>YOUR_PHRASE</promise>
\`\`\`

### /cancel-ralph

Cancel to active Ralph loop.

### /ralph-help

Show this documentation.

## Prompt Best Practices

### 1. Clear Success Criteria
❌ Bad: "Build a todo API and make it good."
✅ Good:
\`\`\`
Build a REST API for todos. When complete:
- All CRUD endpoints working
- Input validation in place
- Tests passing (coverage > 80%)
- Output: <promise>COMPLETE</promise>
\`\`\`

### 2. One Item Per Loop
❌ Bad: "Create entire e-commerce platform"
✅ Good:
\`\`\`
Phase 1: User authentication
Phase 2: Product catalog
Phase 3: Shopping cart

Choose ONE phase to implement this iteration.
Output <promise>COMPLETE</promise> when all phases done.
\`\`\`

### 3. Self-Correction
\`\`\`
Implement feature X following TDD:
1. Write failing tests
2. Implement feature
3. Run tests
4. If any fail, debug and fix
5. Repeat until all green
6. Output: <promise>COMPLETE</promise>
\`\`\`

### 4. Always Use Safety Net
\`\`\`
/ralph-loop "Try to implement feature X" --max-iterations 20

# If stuck after 15 iterations:
- Document what's blocking progress
- List what was attempted
- Suggest alternative approaches
\`\`\`

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

## Learn More

- Original technique: https://ghuntley.com/ralph/
- "We Put a Coding Agent in a While Loop" - YC hackathon report
`;
