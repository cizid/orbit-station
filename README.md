# Orbit Station

Ein Pixel-Art-Büro auf einer Raumstation, in dem jede Claude-Code-Session ein kleiner Astronaut (schwebende
Mondsprünge) oder ein Roboter im R2-Stil ist. Sechs Räume (Gate, Archive, Coding, Workbench, Comms, Lounge) liegen an
einem Flur; die Figuren laufen je nach Tool zum passenden Raum (Edit → Coding, Read → Archive, Bash → Workbench,
WebSearch/WebFetch → Comms, Stop/Idle → Lounge, Start/Ende → Gate). Ein rotes `!` zeigt, dass Claude auf eine
Erlaubnis wartet, ein `✓`, dass die Figur fertig ist.

Agents lassen sich direkt im Spiel einstellen, per Klick öffnen (Live-Terminal) und mit einem Klick freigeben (Allow / Deny).

**Steuerung:** Ziehen verschiebt die Karte, Mausrad zoomt. Klick auf einen Raum zoomt hin und markiert die
Agenten dort. Klick auf eine Figur öffnet ihre Konsole, die Kamera folgt ihr. Klick auf leeren Raum oder Esc zoomt
zurück.

Die frühere 3D-Planeten-Version liegt auf dem Git-Branch `planet-3d`.

## Starten

Voraussetzung: Node.js 20+, ein Browser und (zum Einstellen von Agents im Spiel) das `claude` CLI im PATH.

```bash
npm install
npm start
```

Dann `http://localhost:4111` öffnen. „Spawn Demo Agents" zeigt drei Fake-Agents ohne echte Terminals.

## Externe Terminals anzeigen

Claude Code muss seine Events an den Server schicken. In `~/.claude/settings.json`:

```json
{
  "hooks": {
    "SessionStart":     [{ "hooks": [{ "type": "command", "command": "curl -s -m 1 -X POST -H 'content-type: application/json' --data-binary @- http://localhost:4111/event || true" }] }],
    "SessionEnd":       [{ "hooks": [{ "type": "command", "command": "curl -s -m 1 -X POST -H 'content-type: application/json' --data-binary @- http://localhost:4111/event || true" }] }],
    "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "curl -s -m 1 -X POST -H 'content-type: application/json' --data-binary @- http://localhost:4111/event || true" }] }],
    "PreToolUse":       [{ "hooks": [{ "type": "command", "command": "curl -s -m 1 -X POST -H 'content-type: application/json' --data-binary @- http://localhost:4111/event || true" }] }],
    "Notification":     [{ "hooks": [{ "type": "command", "command": "curl -s -m 1 -X POST -H 'content-type: application/json' --data-binary @- http://localhost:4111/event || true" }] }],
    "Stop":             [{ "hooks": [{ "type": "command", "command": "curl -s -m 1 -X POST -H 'content-type: application/json' --data-binary @- http://localhost:4111/event || true" }] }]
  }
}
```

Externe Sessions sind im Spiel nur zum Ansehen. Eingreifen (Terminal, Allow/Deny) geht nur bei Agents, die im Spiel gestartet wurden.

## Sicherheit

Der Server startet auf Wunsch `claude`-Prozesse und schreibt in deren Terminal. Deshalb:

- Er lauscht nur auf `127.0.0.1`, nicht im Netzwerk.
- WebSocket-Verbindungen von fremden Webseiten werden abgelehnt.
- Nicht hinter einen Proxy oder ins Internet stellen.

## Konfiguration

| Variable     | Bedeutung                                   |
| ------------ | ------------------------------------------- |
| `CLAUDE_BIN` | Programm, das für neue Agents gestartet wird (Standard: `claude`) |

Die Tasten für Allow/Deny stehen oben in `public/ui.js` (`ALLOW_KEYS` = `1`, `DENY_KEYS` = Esc). Gegen die echte Claude-Code-CLI geprüft: `n` + Enter würde das vorausgewählte „1. Yes" bestätigen und den Befehl erlauben.
Falls dein Claude-Code-Berechtigungsmenü andere Eingaben erwartet, dort anpassen.

## Mission Board (`/board`)

Cards come from Claude's own todo list (`TodoWrite`, or `TaskCreate`/`TaskUpdate` as in current Claude Code — verified against real hook payloads) and move by themselves. Sessions without a todo tool (checked with a real interactive session) get one card per prompt instead (`UserPromptSubmit`); a real todo list replaces that stand-in card:

| Todo / event | Column |
|---|---|
| `pending` | Backlog |
| `in_progress` | In Progress (the agent becomes the card's *handler*) |
| `completed`, or the agent stops (`Stop`) | Review |
| you click **Accept** | Done (**Reject** sends it back to Backlog and counts against the agent) |
| session ends mid-task | Backlog |

Per handler the board counts time, tool calls, subagent handoffs, permission questions (and the time spent waiting), and errors (`PostToolUseFailure`). The **Crew performance** table sums that up per agent. Tasks are kept in `data/tasks.json` (git-ignored). Click an agent chip to jump to it in the station.

Code map: agent states and colours `public/js/states.js` (used by server and browser), pages and API paths `public/js/routes.js`, WebSocket `public/js/link.js`, nav `public/js/shell.js`, meeting-table choreography `public/js/meetings.js`, board logic `server/tasks.js` (tests: `npm test`).


The server listens on both loopback addresses (`127.0.0.1` and `::1`) so `http://localhost:4111` works whichever one your browser picks; it is never reachable from the network.

## Trace, Metrics, Guardrails (`/trace`, `/metrics`)

Built from the same hook events plus the transcript files they point to (`transcript_path`, `agent_transcript_path`).
Hooks to enable on top of the basic ones: `PostToolUse`, `PostToolUseFailure`, `SubagentStart`, `SubagentStop`.

- **Trace:** per session a timeline (one row per agent, one bar per tool call, `duration_ms` from the hook), a graph of who prompted / delegated to / got results from whom, and an event log. Subagents are told apart by `agent_id`.
- **Metrics:** tokens (incl. cache), response time per request, tool time, time waiting for you, failed calls, and cost. **Cost is an estimate** from token counts and model family; put exact prices in `data/prices.json` (`{"claude-sonnet-5-5": {"in": 3, "out": 15}}`). Unknown models show "n/a", never an invented number.
- **Bottlenecks:** tools ranked by total time. The station map tints the room where the most tool time went in the last 10 minutes.
- **Guardrails** (rules, no model calls, thresholds in `server/guardrails.js`): same tool + same input 3× in a row (loop), 3 failed calls in a row (cascade), same task handed to a subagent 3×, over 60 calls/min, a tool running > 2 min, estimated session cost over $5 / $15. An alert shows on the agent's name tag in the station and on both pages.
- **Evidence checks** (also free: no model, no network; `server/evidence.js`, `server/verifier.js`). They compare what an agent says or writes with things we can look up:
  - *Claim without proof:* the final message says tests pass / build ok / lint clean / committed / pushed (English or German), but no matching command ran in that turn (warn) or the last one failed (critical).
  - *Missing file:* the message names a file inside the project that does not exist.
  - *Unknown import:* an edit imports a package that is not in `package.json` and not installed.
  - *Weakened tests:* an edit to a test file removes assertions or test cases, skips tests or silences checks; `rm` of test files.
  - *Regression:* tests that were green and fail after edits; a turn needing far more tool calls or time than this project's usual (baseline in `data/baseline.json`).
  These find provable problems, not everything: no alert is not proof that an answer is right.
- **AI judge (optional, OFF by default).** Switch in the header of every page: *Off* / *On request* / *Auto*.
  - *On request:* a "Check with AI" button under each finished answer on the Trace page.
  - *Auto:* checks only answers that make claims (tests pass, build ok, committed…) or already tripped a check. Quiet answers cost nothing.
  - It reads one turn (your prompt, the agent's tool log with short result excerpts, its final message) and rates each claim (supported / unsupported / contradicted / unclear), hallucination risk, consistency and toxicity. A serious finding raises a `JUDGE` alert like the other checks.
  - It runs `claude -p` with a small model (`haiku`), **no tools, no saved session, none of your settings or hooks**, in a temp folder. It uses your Claude subscription, not an API key: about $0.001 at list price and 5-10 s per check. A daily limit (default 20) and a usage counter next to the switch keep it in check. Settings live in `data/settings.json`.
  - The text it reads is untrusted: it is fenced so the agent cannot instruct the judge, and the answer is accepted only if it is valid JSON with known values.
  - It is a model's opinion, not proof. The evidence checks above are the ones to trust first.
- Not built: a free local model for semantic hallucination. Options exist (e.g. an entailment model like HHEM via ONNX, ~400 MB, CPU) but they only judge whether text follows from a given source, not whether it is true.
- Trace data lives in memory (gone after a restart). Prompts and tool inputs are kept truncated, for the local pages only; transcripts are only read from `~/.claude/projects`.
