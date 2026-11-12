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
