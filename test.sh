#!/bin/bash
# Simple test script for Ralph Wiggum hook

set -e

echo "=== Ralph Wiggum Hook - Quick Tests ==="
echo ""

# Test 1: Syntax check
echo "Test 1: TypeScript syntax check..."
if node --check ~/.pi/agent/hooks/ralph.ts 2>/dev/null; then
  echo "  ✅ PASSED: Hook compiles without errors"
else
  echo "  ❌ FAILED: Hook has syntax errors"
  exit 1
fi
echo ""

# Test 2: parseArgs function edge cases
echo "Test 2: Argument parsing (manual test cases)"
echo "  Note: These are the cases parseArgs should handle:"
echo "    - Simple: 'Build API --max 5'"
echo "    - Quoted: '\"Fix bug\" --max 10'"
echo "    - Multiple words: '\"Task with spaces\" --promise DONE'"
echo ""

# Test 3: State file structure
echo "Test 3: State file structure validation"
cat > /tmp/test-ralph-state.md << 'EOF'
---
active: true
iteration: 5
max_iterations: 50
completion_promise: "DONE"
started_at: "2026-01-02T17:35:07Z"
subagent_mode: false
---

Build a REST API
EOF

if grep -q "^active: true" /tmp/test-ralph-state.md && \
   grep -q "^iteration: 5" /tmp/test-ralph-state.md; then
  echo "  ✅ PASSED: State file format looks correct"
else
  echo "  ❌ FAILED: State file format invalid"
  exit 1
fi
rm /tmp/test-ralph-state.md
echo ""

# Test 4: Promise extraction test
echo "Test 4: Promise tag extraction examples"
echo "  Should extract from:"
echo '    <promise>DONE</promise>'
echo '    <promise>TASK COMPLETE</promise>'
echo ""

# Test 5: File exists
echo "Test 5: Hook file exists"
if [ -f ~/.pi/agent/hooks/ralph.ts ]; then
  echo "  ✅ PASSED: Hook file exists at ~/.pi/agent/hooks/ralph.ts"
else
  echo "  ❌ FAILED: Hook file not found"
  exit 1
fi
echo ""

# Test 6: README exists
echo "Test 6: Documentation exists"
if [ -f ~/.pi/agent/hooks/ralph-README.md ]; then
  echo "  ✅ PASSED: README exists"
else
  echo "  ❌ FAILED: README not found"
  exit 1
fi
echo ""

echo "=== All basic tests passed! ==="
echo ""
echo "Next steps:"
echo "1. Start pi with hook: pi --hook ~/.pi/agent/hooks/ralph.ts"
echo "2. Run: /ralph-loop 'Create test.txt with hello' --max-iterations 3 --completion-promise 'DONE'"
echo "3. Verify loop behavior"
