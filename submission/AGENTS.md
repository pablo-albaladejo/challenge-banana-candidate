<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-10-09 | Updated: 2026-10-09 -->

# submission

## Purpose
Holds the candidate's delivery materials. This folder ships inside the single project ZIP described in `docs/challenge.md`. It is documentation and evidence, not application code.

## Key Files
| File | Description |
|------|-------------|
| `README.md` | Template to fill: version/date, setup and demo instructions, Part 1 fixes, Part 2 feature, supporting materials, finished vs pending |

## Expected contents (added by the candidate)
| Path | Description |
|------|-------------|
| `ai-sessions/` | Complete original AI session exports from the first prompt, including intermediate steps, tool calls, and results where the tool supports it. May be replaced by `ai-sessions.zip` stored here |
| `demo.mp4` | Recommended 5-10 minute video covering both parts (camera optional) |
| `presentation.pdf` | Alternative to the video, with screenshots and steps to try the work |
| `transcript.vtt` | Optional video transcript |

Names are examples from the brief. Every included file must be listed with its relative path in `README.md`.

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
