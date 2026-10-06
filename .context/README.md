# Context (`.context/`)

Reference docs for building, modifying, and operating each subsystem: what each one does and guarantees, and how it is built.

## Purpose

Context files hold what is **currently true** about a subsystem -- its behavioral rules (status transitions, invariants, guards, defaults), file locations, API endpoints, configuration, workflows, troubleshooting, and modification guides. They are the practical companion to the codebase.

A context file answers: "What does this do, and how do I work with this?"

## Boundary Rules

- **Include:** Behavioral rules and invariants a change must preserve, file paths, API endpoints, environment variables, CLI commands, database schema details, framework patterns, UI component structure, modification guides, operational runbooks
- **Exclude:** Why a hard-to-reverse choice was made. That goes in the ADR log -- the index `decisions.md`, one file per decision in `decisions/` -- which, unlike the rest of this folder, is a historical record: entries are added, never rewritten.

When the code changes behavior, correct the affected passage in the same change; don't add a correction note above stale text.

## Conventions

- Filename matches the subsystem: `authentication.md`, `story-pipeline.md`
- State rules as they hold in the code, with the function or file that enforces them
- "Key Files" or "File Locations" table at the end
- "Modifying" section when the subsystem has non-obvious change points
