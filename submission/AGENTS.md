<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-10-09 | Updated: 2026-10-11 -->

# submission

## Purpose

Holds the candidate's delivery materials. This folder ships inside the single project ZIP described in `docs/challenge.md`. It is documentation and evidence, not application code.

## Key Files

| Path                                                     | Description                                                                                                      |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `README.md`                                              | Evaluator entry point: Part 1 fixes and verification, Part 2 idea and how to try it, status, contents, packaging |
| `AGENTS.md`                                              | This file                                                                                                        |
| `production-readiness.md`                                | Part 1 review: what was checked, prioritised findings (P0/P1/P2), what is fixed                                  |
| `part1-evidence.md`                                      | Part 1 before/after evidence (starter `726b592` against `main` at `dc39816`) with the exact commands             |
| `architecture-decoupling.md`                             | Plan and record of the architecture refactor (Phases 1 to 7)                                                     |
| `part2-design.md`                                        | Part 2 design, decisions log, test plan and implementation plan                                                  |
| `video-script.md`                                        | Demo video script with exact screens, URLs and clicks (Spanish)                                                  |
| `ai-sessions.md`                                         | How AI was used, and a guide to the session files                                                                |
| `ai-sessions/e72ad6d8-ffa0-4812-8d4f-841becac3b3e.jsonl` | Main Claude Code session export (the `Claude-Session` trailer on the commits)                                    |
| `ai-sessions/35663121-c5c3-4670-b08e-f541bb74e9ed.jsonl` | Short `claude -p` probe session (Haiku)                                                                          |
| `ai-sessions/7ca132fc-07c4-4d26-bc93-278238e5f185.jsonl` | Short `claude -p` probe session (Haiku)                                                                          |
| `ai-sessions.zip`                                        | Subagent transcripts; added at packaging, not tracked                                                            |
| `demo.mp4`                                               | Demo video recorded from `video-script.md`; added at packaging, not tracked                                      |
| Case-brief eval report                                   | Landing with Part 2 commit 7                                                                                     |

Every included file must be listed with its relative path in `README.md`.

## For AI Agents

### Working In This Directory

- Write the write-up in `README.md`: Part 1 (problems chosen, why, changes, how verified, ideally reproducible before/after) and Part 2 (idea, value, how to try it).
- Do not fabricate or summarize in place of session exports; retrospective summaries and external links do not replace `ai-sessions/`.
- Never place credentials, `.env*` files, or `node_modules/` here.
- State honestly what is finished, what was verified, and what is pending.

### Testing Requirements

- Before delivery: unzip into a fresh folder, follow `README.md` instructions, and confirm every listed path exists and opens.

### Common Patterns

- Reference evidence by relative path (for example `ai-sessions/...`, `demo.mp4`) so reviewers can locate it.

## Dependencies

### Internal

- `../docs/challenge.md` (deliverable rules), `../README.md` (setup instructions the write-up links to)

### External

- None

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
