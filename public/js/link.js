import { API } from './routes.js';

// The one WebSocket connection helper (station and board both use it). Reconnects by itself.
// Any message that carries tasks is re-announced as an `orbit:tasks` window event for the nav badge.
export const HOST = location.protocol.startsWith('http') ? location.host : 'localhost:4111';

export function connectLink({ onMessage, onStatus, onSocket }) {
  function open() {
    const ws = new WebSocket(`ws://${HOST}${API.ws}`);
    onSocket?.(ws);
    ws.onopen = () => onStatus?.(true);
    ws.onmessage = m => {
      let msg;
      try { msg = JSON.parse(m.data); } catch { return; }
      if (msg.tasks) window.dispatchEvent(new CustomEvent('orbit:tasks', { detail: msg }));
      onMessage?.(msg);
    };
    ws.onclose = () => { onStatus?.(false); setTimeout(open, 2000); };
    ws.onerror = () => ws.close();
  }
  open();
}
