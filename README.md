# Orbit Station

Ein kleines Pixel-Art-Spiel, in dem jede Claude-Code-Session ein Roboter in einer Raumstation ist.
Der Roboter läuft je nach Tool zur passenden Station (Edit → Desks, Read → Bibliothek, Bash → Workbench …),
zeigt ein rotes `!`, wenn Claude auf eine Erlaubnis wartet, und ein `✓`, wenn er fertig ist.

Agents lassen sich direkt im Spiel einstellen, per Klick öffnen (Live-Terminal) und mit einem Klick freigeben (Allow / Deny).

## Starten

Voraussetzung: Node.js 20+ und (zum Einstellen von Agents im Spiel) das `claude` CLI im PATH.

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

Die Tasten für Allow/Deny stehen oben in `public/ui.js` (`ALLOW_KEYS`, `DENY_KEYS`).
Falls dein Claude-Code-Berechtigungsmenü andere Eingaben erwartet, dort anpassen.
