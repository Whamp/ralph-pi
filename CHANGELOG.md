# Changelog

All notable changes to this project will be documented in this file.

## [1.0.0] - 2026-01-02

### Added
- Initial implementation of Ralph Wiggum technique for Pi Coding Agent
- Three commands: `/ralph-loop`, `/cancel-ralph`, `/ralph-help`
- Iteration loop with `--max-iterations` limit
- Completion promise detection via `<promise>TAG</promise>` tags
- Iteration counter displayed in status bar
- Status preservation across sessions
- Strict validation (requires prompt + either max-iterations or completion-promise)
- Optional subagent mode flag (reserved for future use)
- Detailed completion summaries with iteration count and duration
- Error recovery (continues loop on errors)
- New message rejection when loop is active (requires `/cancel-ralph`)
- Automated test script (`test.sh`)

### Fixed (from code review)
- Critical: Argument parsing now handles quoted and unquoted arguments correctly
- Critical: Fixed duplicate YAML condition for null handling
- Critical: Added proper loop re-injection detection to prevent infinite confirmations
- Important: Duration tracking now persists across session restarts
- Important: Added state file validation to catch corrupted files
- Important: Message content filtering now handles images correctly
- Minor: Renamed status key for clarity
- Minor: Added error handling in cancel command

### Architecture
- Single hook file (`ralph.ts`) that registers all commands
- State file (`.pi/ralph-loop.local.md`) persists across sessions
- Uses Pi's `agent_end` event to detect completion and re-inject prompts
- Uses Pi's `agent_start` event to update status line and detect new user input
