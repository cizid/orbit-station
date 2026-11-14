// "Goals for today": a private list for sorting your own day. Not connected to prompts or agents.
// Kept in this browser, one list per calendar day.
const $ = id => document.getElementById(id);
const dayKey = () => `orbit.goals.${new Date().toLocaleDateString('sv')}`;   // sv = YYYY-MM-DD
const load = () => { try { const v = JSON.parse(localStorage.getItem(dayKey())); return Array.isArray(v) ? v : []; } catch { return []; } };
const save = list => { try { localStorage.setItem(dayKey(), JSON.stringify(list)); } catch { /* private mode: list lives until reload */ } };

export function mountGoals() {
  let goals = load(), day = dayKey();
  const head = $('goals-head'), body = $('goals-body');

  function render() {
    if (day !== dayKey()) { day = dayKey(); goals = load(); }          // a new day starts with a clean list
    const done = goals.filter(g => g.done).length;
    $('goals-count').textContent = goals.length ? `${done}/${goals.length}` : '';
    const ul = $('goals-list');
    ul.textContent = '';
    goals.forEach((g, i) => {
      const li = document.createElement('li');
      li.className = g.done ? 'done' : '';
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = g.done; cb.setAttribute('aria-label', 'Done');
      cb.addEventListener('change', () => { g.done = cb.checked; save(goals); render(); });
      const tx = document.createElement('span'); tx.textContent = g.text;
      const up = document.createElement('button'); up.type = 'button'; up.className = 'mini'; up.textContent = '↑'; up.title = 'Move up'; up.disabled = i === 0;
      up.addEventListener('click', () => { [goals[i - 1], goals[i]] = [goals[i], goals[i - 1]]; save(goals); render(); });
      const rm = document.createElement('button'); rm.type = 'button'; rm.className = 'mini'; rm.textContent = '×'; rm.title = 'Remove';
      rm.addEventListener('click', () => { goals.splice(i, 1); save(goals); render(); });
      li.append(cb, tx, up, rm);
      ul.append(li);
    });
  }

  const setOpen = open => { head.setAttribute('aria-expanded', String(open)); body.hidden = !open; if (open) { render(); $('goals-input').focus(); } };
  head.addEventListener('click', () => setOpen(body.hidden));
  $('goals-form').addEventListener('submit', e => {
    e.preventDefault();
    const text = $('goals-input').value.trim();
    if (!text) return;
    goals.push({ text, done: false }); save(goals); $('goals-input').value = ''; render();
  });
  addEventListener('keydown', e => { if (e.key === 'Escape' && !body.hidden) setOpen(false); });
  document.addEventListener('pointerdown', e => { if (!body.hidden && !e.target.closest('#goals')) setOpen(false); });
  setInterval(render, 60_000);
  render();
}
