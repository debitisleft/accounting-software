# Bookkeeping App — Claude's Instructions

## PROJECT GOAL
Build a double-entry bookkeeping desktop app.
Stack: Tauri + React + TypeScript + rusqlite (SQLite on disk) + Vitest

## HARD RULES — never break these
- All money is stored as INTEGER CENTS. Never use float for money.
- Every transaction must have SUM(debit) = SUM(credit)
- TypeScript strict mode — no `any` on accounting functions
- Run tests before every commit
- Never commit code that breaks passing tests

## YOUR LOOP — follow this every session
1. Read CLAUDE.md (this file)
2. Read CHANGELOG.md to understand current state and failed approaches
3. Read build-todo.md for current phase and unchecked tasks
4. Work through unchecked tasks in order
5. Run the CHECK command at the end of each phase
6. If check passes → update build-todo.md [x], write CHANGELOG.md entry, git commit
7. If check fails → diagnose, fix, re-run check. Log the failure in CHANGELOG.md
8. Never advance to the next phase until current phase check passes

## ACCOUNTING MODEL
- ASSET: debit increases, credit decreases
- LIABILITY: credit increases, debit decreases
- EQUITY: credit increases, debit decreases
- REVENUE: credit increases, debit decreases
- EXPENSE: debit increases, credit decreases

## GIT RULES
- Commit after every meaningful unit of work
- Commit message format: [PHASE X] description of what was done
- Run `npx vitest run` before every commit

## CONTEXT RULES
- Never print full file contents to terminal unless asked
- When running tests, only show the summary line and any failures
- Store verbose output to .logs/ directory, not terminal
- If context feels cluttered, re-read CLAUDE.md to reorient