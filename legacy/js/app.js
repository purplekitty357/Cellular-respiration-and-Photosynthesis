'use strict';
/* =========================================================================
   탄소 추적 실험실 — 세포호흡 · 광합성 탄소 원자 추적 시뮬레이터
   모든 탄소 원자는 고유한 객체이며, 분자는 탄소 원자의 배열(번호 순서)이다.
   반응이 일어날 때 실제 생화학의 원자 배치(어느 탄소가 어디로 가는지)를 따른다.
   ========================================================================= */

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const settings = { colorAll: false, speed: 1 };
const ATOMS = new Map();
let atomSeq = 0, molSeq = 0;
const GOLD = 137.508;

/* ---------- 원자 · 분자 ---------- */
function labeledColor(n, off) { return `hsl(${((n - 1) * GOLD + off) % 360} 74% 45%)`; }
function mutedColor(i) { return `hsl(${(i * GOLD) % 360} 20% 62%)`; }

function newAtom(sim, origin, labeled) {
  const a = { id: 'a' + (++atomSeq), labeled, origin, hist: [], where: '', pos: '', ns: sim.key };
  if (labeled) {
    a.n = ++sim.seq;
    a.color = labeledColor(a.n, sim.hue);
    a.label = String(a.n);
  } else {
    a.alt = mutedColor(atomSeq);
    a.label = '';
  }
  ATOMS.set(a.id, a);
  return a;
}
function atomColor(a) { return a.labeled ? a.color : (settings.colorAll ? a.alt : 'var(--atom-gray)'); }

/* 분자 만들기: 원자의 현재 위치와 이동 경로(hist)를 기록 */
function mk(type, name, atoms, roles) {
  const m = { id: 'm' + (++molSeq), type, name, atoms };
  atoms.forEach((a, i) => {
    a.where = name;
    a.pos = roles ? roles[i] : `C${i + 1}`;
    if (a.hist[a.hist.length - 1] !== name) a.hist.push(name);
  });
  return m;
}
/* 중간 생성물을 거쳐 갔음을 경로에만 기록 */
function pass(atoms, name) { atoms.forEach(a => { if (a.hist[a.hist.length - 1] !== name) a.hist.push(name); }); }

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function atomHTML(a, sim) {
  const hl = sim.hl.has(a.id) ? ' hl' : '';
  return `<button type="button" class="atom${a.labeled ? ' lab' : ''}${hl}" data-aid="${a.id}" style="--c:${atomColor(a)}" aria-label="탄소 ${a.labeled ? a.label + '번' : '(표지 안 됨)'}">${esc(a.label)}</button>`;
}
function molHTML(m, sim, extra = '') {
  return `<div class="mol t-${m.type} ${extra}" data-mid="${m.id}"><span class="mname">${esc(m.name)}</span><span class="chain">${m.atoms.map(a => atomHTML(a, sim)).join('')}</span></div>`;
}
function dots(atoms) {
  return `<span class="inl">${atoms.map(a => `<span class="dot" style="--c:${atomColor(a)}" title="${a.labeled ? a.label + '번 탄소' : '표지 안 된 탄소'}"></span>`).join('')}</span>`;
}
const empty = t => `<span class="empty">${t}</span>`;

/* ---------- 이동 애니메이션 ----------
   반응 전 원자 위치를 기록해 두었다가, 반응 후 새 위치까지 복제본이 곡선 경로를 따라
   한 개씩 날아가게 한다. 지나간 길은 그 탄소의 색으로 선이 그려졌다가 서서히 사라진다.
   ① 집중(옮겨 갈 탄소가 반짝임) → ② 이동(곡선 + 궤적) → ③ 도착(새 분자가 나타남) */
const fxLayer = document.createElement('div');
fxLayer.id = 'fx';
fxLayer.setAttribute('aria-hidden', 'true');
document.body.appendChild(fxLayer);
let fxCleanups = [];

function snap(root) {
  const ox = scrollX, oy = scrollY;
  const box = r => ({ x: r.left + ox, y: r.top + oy, w: r.width, h: r.height });
  const atoms = new Map(), mols = new Map();
  root.querySelectorAll('[data-aid]').forEach(e => {
    const m = e.closest('.mol');
    atoms.set(e.dataset.aid, { b: box(e.getBoundingClientRect()), html: e.outerHTML, mid: m ? m.dataset.mid : null });
  });
  root.querySelectorAll('.mol[data-mid]').forEach(e => mols.set(e.dataset.mid, { b: box(e.getBoundingClientRect()), html: e.outerHTML }));
  return { atoms, mols };
}
function finishFx() {
  const list = fxCleanups; fxCleanups = [];
  list.forEach(fn => fn());
  fxLayer.replaceChildren();
}
function fromHTML(html) { const t = document.createElement('div'); t.innerHTML = html; return t.firstElementChild; }
const easeInOut = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/* 반응 후 화면에서 원자 이동을 보여 주고, 애니메이션 전체 길이(ms)를 돌려준다.
   같은 반응에 참여한 분자들(반응물 → 생성물)을 한 묶음으로 보고, 묶음마다 차례로
   ① 반응물 속 탄소가 반짝임 → ② 반응 장소로 모임 → ③ 생성물 모양으로 재배열 → ④ 생성물 자리로 이동 */
function animateMove(root, before, hubSel, tagText) {
  if (reduceMotion || !before || !root.offsetParent) return 0;
  const sp = settings.speed;
  const focus = 500 / sp, leg1 = 1000 / sp, dwell = 650 / sp, leg2 = 1000 / sp, slide = 450 / sp;
  const total = leg1 + dwell + leg2;
  const ox = scrollX, oy = scrollY;
  const box = e => { const r = e.getBoundingClientRect(); return { x: r.left + ox, y: r.top + oy, w: r.width, h: r.height }; };
  const ctr = b => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });

  const movers = [], slides = [], stays = [], born = [];
  root.querySelectorAll('[data-aid]').forEach(e => {
    const old = before.atoms.get(e.dataset.aid);
    if (!old) { born.push(e); return; }
    const b1 = box(e), m = e.closest('.mol'), dmid = m ? m.dataset.mid : null;
    const dist = Math.hypot(b1.x - old.b.x, b1.y - old.b.y);
    if (m && dmid === old.mid) { if (dist > 1) slides.push({ e, old, b1 }); return; }
    if (dist < 2) { stays.push(e); return; }
    movers.push({ e, old, b1, dmid });
  });

  // 반응 묶음 찾기: 반응물 분자와 생성물 분자를 탄소로 이어서 연결된 덩어리
  const parent = new Map();
  const find = x => { while (parent.get(x) !== x) x = parent.get(x); return x; };
  const add = x => { if (!parent.has(x)) parent.set(x, x); };
  movers.forEach(m => { const a = 's' + m.old.mid, b = 'd' + m.dmid; add(a); add(b); parent.set(find(a), find(b)); });
  const comps = new Map();
  movers.forEach(m => {
    const k = find('d' + m.dmid);
    if (!comps.has(k)) comps.set(k, { movers: [], dests: [], srcs: new Set() });
    const c = comps.get(k);
    c.movers.push(m); c.srcs.add(m.old.mid);
    if (!c.dests.includes(m.dmid)) c.dests.push(m.dmid);
  });
  const list = [...comps.values()];
  const gap = list.length > 1 ? Math.min(total * 0.75, (6500 / sp) / (list.length - 1)) : 0;

  const hubEl = hubSel ? root.querySelector(hubSel) : null;
  const hubFixed = hubEl && hubEl.offsetParent ? ctr(box(hubEl)) : null;
  const srcStart = new Map(), destStart = new Map();
  const svgNS = 'http://www.w3.org/2000/svg';
  const bendCtl = (a, b, k) => {
    const d = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    let nx = -(b.y - a.y) / d, ny = (b.x - a.x) / d;
    if (ny > 0) { nx = -nx; ny = -ny; }
    const bend = Math.min(90, d * k);
    return { x: (a.x + b.x) / 2 + nx * bend, y: (a.y + b.y) / 2 + ny * bend };
  };
  const q = (a, c, b, t) => ({ x: (1 - t) * (1 - t) * a.x + 2 * (1 - t) * t * c.x + t * t * b.x, y: (1 - t) * (1 - t) * a.y + 2 * (1 - t) * t * c.y + t * t * b.y });

  list.forEach((comp, ci) => {
    const t0 = ci * gap;
    comp.srcs.forEach(id => srcStart.set(id, t0));
    comp.dests.forEach(id => destStart.set(id, t0));
    // 반응 장소
    let hub = hubFixed;
    if (!hub) {
      const avg = pts => ({ x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length });
      const a = avg(comp.movers.map(m => ctr(m.old.b))), b = avg(comp.movers.map(m => ctr(m.b1)));
      hub = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    }
    // 반응 장소에서 생성물 모양(분자마다 한 줄)으로 늘어설 자리
    const rows = comp.dests.map(d => comp.movers.filter(m => m.dmid === d));
    const slot = new Map();
    rows.forEach((row, ri) => row.forEach((m, i) => {
      slot.set(m, { x: hub.x + (i - (row.length - 1) / 2) * 27, y: hub.y + (ri - (rows.length - 1) / 2) * 30 });
    }));
    // 반응 이름표
    const tag = document.createElement('div');
    tag.className = 'hubtag';
    tag.textContent = tagText || '반응';
    fxLayer.appendChild(tag);
    Object.assign(tag.style, { left: hub.x + 'px', top: (hub.y - rows.length * 15 - 30) + 'px' });
    tag.animate([{ opacity: 0, transform: 'translate(-50%, 6px)' }, { opacity: 1, transform: 'translate(-50%, 0)', offset: 0.2 }, { opacity: 1, transform: 'translate(-50%, 0)', offset: 0.8 }, { opacity: 0, transform: 'translate(-50%, 0)' }],
      { duration: leg1 * 0.6 + dwell + leg2 * 0.4, delay: t0 + focus + leg1 * 0.5, fill: 'both' }).onfinish = () => tag.remove();
    // 반응 장소 표시 원
    const ring = document.createElement('div');
    ring.className = 'hubring';
    const rw = Math.max(...rows.map(r => r.length)) * 27 + 26, rh = rows.length * 30 + 18;
    Object.assign(ring.style, { left: (hub.x - rw / 2) + 'px', top: (hub.y - rh / 2) + 'px', width: rw + 'px', height: rh + 'px' });
    fxLayer.appendChild(ring);
    ring.animate([{ opacity: 0, transform: 'scale(.6)' }, { opacity: 1, transform: 'scale(1)', offset: 0.3 }, { opacity: 1, offset: 0.75 }, { opacity: 0, transform: 'scale(1.1)' }],
      { duration: leg1 * 0.5 + dwell + leg2 * 0.3, delay: t0 + focus + leg1 * 0.6, fill: 'both' }).onfinish = () => ring.remove();

    comp.movers.forEach(m => {
      const { e, old, b1 } = m;
      const half = old.b.w / 2;
      const p0 = ctr(old.b), h = slot.get(m), p1 = ctr(b1);
      const c1 = bendCtl(p0, h, 0.3), c2 = bendCtl(h, p1, 0.3);
      const color = getComputedStyle(e).getPropertyValue('--c').trim() || 'gray';
      const delay = t0 + focus;

      // 궤적
      const xs = [p0.x, h.x, p1.x, c1.x, c2.x], ys = [p0.y, h.y, p1.y, c1.y, c2.y];
      const minX = Math.min(...xs) - 6, minY = Math.min(...ys) - 6;
      const svg = document.createElementNS(svgNS, 'svg');
      svg.setAttribute('class', 'trail');
      svg.setAttribute('width', Math.max(...xs) - minX + 12); svg.setAttribute('height', Math.max(...ys) - minY + 12);
      Object.assign(svg.style, { left: minX + 'px', top: minY + 'px' });
      const L = p => `${(p.x - minX).toFixed(1)} ${(p.y - minY).toFixed(1)}`;
      const path = document.createElementNS(svgNS, 'path');
      path.setAttribute('d', `M ${L(p0)} Q ${L(c1)} ${L(h)} Q ${L(c2)} ${L(p1)}`);
      path.setAttribute('pathLength', '1');
      path.setAttribute('stroke', color);
      svg.appendChild(path);
      fxLayer.appendChild(svg);
      const d1 = Math.hypot(h.x - p0.x, h.y - p0.y), d2 = Math.hypot(p1.x - h.x, p1.y - h.y);
      const f1 = d1 / ((d1 + d2) || 1);
      path.animate([
        { strokeDashoffset: 1, offset: 0 }, { strokeDashoffset: 1 - f1, offset: leg1 / total },
        { strokeDashoffset: 1 - f1, offset: (leg1 + dwell) / total }, { strokeDashoffset: 0, offset: 1 }],
        { duration: total, delay, fill: 'both' });
      svg.animate([{ opacity: 0.9 }, { opacity: 0 }], { duration: 1400 / sp, delay: delay + total + 300 / sp, fill: 'forwards' }).onfinish = () => svg.remove();

      // 날아가는 탄소
      const fly = fromHTML(old.html);
      fly.removeAttribute('data-aid');
      fly.classList.add('fly');
      fly.classList.remove('hl');
      Object.assign(fly.style, { left: old.b.x + 'px', top: old.b.y + 'px' });
      fxLayer.appendChild(fly);
      const at = p => `translate(${(p.x - p0.x).toFixed(1)}px, ${(p.y - p0.y).toFixed(1)}px)`;
      const frames = [];
      const N = 18;
      for (let k = 0; k <= N; k++) { const t = easeInOut(k / N); frames.push({ offset: (k / N) * leg1 / total, transform: `${at(q(p0, c1, h, t))} scale(${(1 + 0.3 * Math.sin(Math.PI * t)).toFixed(3)})` }); }
      frames.push({ offset: (leg1 + dwell * 0.5) / total, transform: `${at(h)} scale(1.12)` });
      for (let k = 0; k <= N; k++) { const t = easeInOut(k / N); frames.push({ offset: (leg1 + dwell + (k / N) * leg2) / total, transform: `${at(q(h, c2, p1, t))} scale(${(1 + 0.3 * Math.sin(Math.PI * t)).toFixed(3)})` }); }
      // 출발 전 반짝임 (그림자만 바꿔서 이동과 겹치지 않게)
      fly.animate([{ boxShadow: `0 0 0 0 ${color}` }, { boxShadow: `0 0 0 8px transparent` }], { duration: focus, delay: t0, iterations: 1 });
      const an = fly.animate(frames, { duration: total, delay, easing: 'linear', fill: 'both' });
      e.style.visibility = 'hidden';
      const land = () => { e.style.visibility = ''; fly.remove(); };
      an.onfinish = () => {
        land();
        if (!reduceMotion) e.animate([{ transform: 'scale(1.45)' }, { transform: 'scale(1)' }], { duration: 380 / sp, easing: 'ease-out' });
      };
      fxCleanups.push(() => { an.cancel(); land(); });
    });
  });
  const lastEnd = list.length ? (list.length - 1) * gap + focus + total : 0;

  // 사라지는 반응물 분자: 탄소가 떠날 때까지 잔상으로 남음
  const nowMols = new Set([...root.querySelectorAll('.mol[data-mid]')].map(e => e.dataset.mid));
  for (const [id, m] of before.mols) {
    if (nowMols.has(id)) continue;
    const g = fromHTML(m.html);
    g.classList.add('ghost');
    g.querySelectorAll('[data-aid]').forEach(a => { a.removeAttribute('data-aid'); a.style.visibility = 'hidden'; });
    Object.assign(g.style, { left: m.b.x + 'px', top: m.b.y + 'px', width: m.b.w + 'px', height: m.b.h + 'px' });
    fxLayer.appendChild(g);
    const t0 = srcStart.has(id) ? srcStart.get(id) : 0;
    g.animate([{ opacity: 1 }, { opacity: 0 }], { duration: leg1 * 0.8, delay: t0 + focus + leg1 * 0.2, fill: 'both' }).onfinish = () => g.remove();
  }
  // 새로 생긴 생성물 분자: 탄소가 도착할 때 나타남
  root.querySelectorAll('.mol[data-mid]').forEach(e => {
    if (before.mols.has(e.dataset.mid)) return;
    const t0 = destStart.get(e.dataset.mid);
    const delay = t0 === undefined ? 0 : t0 + focus + leg1 + dwell;
    const an = e.animate([{ opacity: 0 }, { opacity: 1 }], { duration: t0 === undefined ? 500 / sp : leg2, delay, fill: 'backwards', easing: 'ease-in' });
    fxCleanups.push(() => an.finish());
  });

  slides.forEach(({ e, old, b1 }) => {
    const an = e.animate([{ transform: `translate(${old.b.x - b1.x}px, ${old.b.y - b1.y}px)` }, { transform: 'none' }], { duration: slide, easing: 'ease-in-out' });
    fxCleanups.push(() => an.finish());
  });
  // 제자리에서 다른 분자로 바뀐 탄소 (예: 포도당 → 과당 1,6-이인산): 고리 모양으로 반짝임
  stays.forEach(e => {
    const color = getComputedStyle(e).getPropertyValue('--c').trim();
    const an = e.animate([{ boxShadow: `0 0 0 0 ${color}`, transform: 'scale(1)' }, { boxShadow: `0 0 0 8px transparent`, transform: 'scale(1.25)', offset: 0.5 }, { boxShadow: `0 0 0 0 transparent`, transform: 'scale(1)' }], { duration: 1000 / sp, delay: focus * 0.5, iterations: 2 });
    fxCleanups.push(() => an.cancel());
  });
  born.forEach((e, i) => {
    const an = e.animate([{ transform: 'translateY(-34px) scale(0)', opacity: 0 }, { transform: 'translateY(4px) scale(1.2)', opacity: 1, offset: 0.7 }, { transform: 'none', opacity: 1 }],
      { duration: 800 / sp, delay: i * 180 / sp, fill: 'backwards', easing: 'ease-out' });
    fxCleanups.push(() => an.finish());
  });
  const bornEnd = born.length ? (born.length - 1) * 180 / sp + 800 / sp : 0;
  return Math.max(lastEnd, slides.length ? slide : 0, stays.length ? focus * 0.5 + 2000 / sp : 0, bornEnd);
}

/* 지금 일어나는 반응 설명 (무대 위 고정 안내줄) */
function nowHTML(sim) {
  const n = sim.now;
  if (!n) return `<div class="now"><span class="now-t">버튼을 눌러 반응을 하나씩 진행해 보세요</span><span class="now-d">탄소가 어떤 분자에서 어떤 분자로 옮겨 가는지 경로가 그려져요.</span></div>`;
  return `<div class="now"><span class="now-t">${n.label}</span><span class="now-d">${n.detail}</span></div>`;
}

/* ---------- 공통 시뮬레이터 동작 ---------- */
function addLog(sim, title, html) {
  sim.s.log.unshift({ n: ++sim.s.step, title, html });
  if (sim.s.log.length > 80) sim.s.log.pop();
}
function act(sim, id) {
  const a = sim.actions().find(x => x.id === id);
  if (!a || !a.can()) return false;
  finishFx();
  const before = snap(sim.stage);
  const logLen = sim.s.step;
  a.run();
  const fresh = sim.s.log.filter(l => l.n > logLen);
  sim.now = { label: a.label, detail: fresh.length ? fresh[0].html : (typeof a.sub === 'function' ? a.sub() : a.sub) };
  sim.render();
  return animateMove(sim.stage, before, a.hub, a.tag || a.label.replace(/^[①②③④⑤⑥]\s*/, ''));
}
function rerender(sim) { finishFx(); sim.render(); }

function toggleAuto(sim) {
  if (sim.timer) { stopAuto(sim); return; }
  const tick = () => {
    const id = sim.autoNext();
    if (!id) { stopAuto(sim, (sim.idleMsg && sim.idleMsg()) || '더 진행할 수 있는 반응이 없어서 자동 진행을 멈췄어요.'); return; }
    const dur = act(sim, id) || 0;
    const done = sim.stopAfter && sim.stopAfter(id);
    if (done) { stopAuto(sim, done); return; }
    sim.timer = setTimeout(tick, dur + 900 / settings.speed);
  };
  sim.timer = setTimeout(tick, 10);
  syncAuto(sim);
}
function stopAuto(sim, msg) {
  clearTimeout(sim.timer); sim.timer = null; syncAuto(sim);
  if (msg) toast(msg);
}
function syncAuto(sim) {
  const b = sim.root.querySelector('[data-auto]');
  b.textContent = sim.timer ? '■ 멈춤' : '▶ 자동 진행';
  b.classList.toggle('running', !!sim.timer);
}

function renderActions(sim) {
  const next = sim.autoNext();
  let html = '', g = '';
  for (const a of sim.actions()) {
    if (a.hidden && a.hidden()) continue;
    if (a.group && a.group !== g) { g = a.group; html += `<div class="agroup">${g}</div>`; }
    const ok = a.can();
    html += `<button type="button" class="act${ok && a.id === next ? ' next' : ''}" data-act="${a.id}" ${ok ? '' : 'disabled'}>
      <span class="al">${a.label}</span><span class="as">${typeof a.sub === 'function' ? a.sub() : a.sub}</span></button>`;
  }
  sim.root.querySelector('[data-actions]').innerHTML = html;
}

function meterHTML(sim, items) {
  const prev = sim.prev || {};
  const now = {};
  const out = items.map(([k, label, v, cls]) => {
    now[k] = v;
    const bump = prev[k] !== undefined && prev[k] !== v ? ' bump' : '';
    return `<div class="meter${bump} ${cls || ''}"><span>${label}</span><b>${fmt(v)}</b></div>`;
  }).join('');
  sim.prev = now;
  return `<div class="meters">${out}</div>`;
}
const fmt = v => Number.isInteger(v) ? String(v) : v.toFixed(1);

function labeledAtoms(sim) {
  return sim.allMols().flatMap(m => m.atoms).filter(a => a.labeled).sort((a, b) => (a.ns === b.ns ? a.n - b.n : a.ns < b.ns ? -1 : 1));
}
function pathText(a) {
  const h = a.hist;
  const shown = h.length > 7 ? ['…', ...h.slice(-6)] : h;
  return shown.join(' → ');
}
function trackerHTML(sim) {
  const atoms = labeledAtoms(sim);
  // 분포: 표지 탄소가 지금 어떤 물질 속에 있나
  const groups = new Map();
  atoms.forEach(a => { if (!groups.has(a.where)) groups.set(a.where, []); groups.get(a.where).push(a); });
  const dist = [...groups].map(([w, as]) => `<span class="dchip"><b>${esc(w)}</b>${dots(as)}</span>`).join('') || empty('표지된 탄소가 아직 없어요');
  const rows = atoms.map(a => `<tr data-track="${a.id}" class="${sim.hl.has(a.id) ? 'on' : ''}">
      <td><span class="tchip" style="--c:${a.color}">${esc(a.label)}</span></td>
      <td>${esc(a.origin)}</td>
      <td><b>${esc(a.where)}</b><br><span class="path">${esc(a.pos)}</span></td>
      <td class="path">${esc(pathText(a))}</td></tr>`).join('');
  return `
    <div class="card"><h3>표지 탄소는 지금 어디에? <small>물질별</small></h3><div class="dist">${dist}</div></div>
    <div class="card"><h3>탄소 추적표 <small>행을 누르면 그 탄소가 깜빡여요</small></h3>
      <div class="tracker"><table><thead><tr><th>탄소</th><th>출처</th><th>현재 위치</th><th>지나온 길</th></tr></thead><tbody>${rows || `<tr><td colspan="4">${empty('표지 탄소 없음')}</td></tr>`}</tbody></table></div></div>`;
}
function logHTML(sim) {
  const items = sim.s.log.map(l => `<li><span class="lt">${l.n}. ${l.title}</span><span class="lh">${l.html}</span></li>`).join('');
  return `<div class="card"><h3>실험 기록 <small>최신순</small></h3><ol class="log">${items || `<li>${empty('아직 기록이 없어요')}</li>`}</ol></div>`;
}
function questionsHTML(qs) {
  return `<div class="card"><h3>관찰해 보기</h3><ol class="qs">${qs.map(q => `<li>${q}</li>`).join('')}</ol></div>`;
}

/* =========================================================================
   세포호흡
   ========================================================================= */
const R = { key: 'R', hue: 8, seq: 0, hl: new Set(), timer: null };
const TCA = [
  { node: '옥살아세트산', rx: '시트르산 합성', eq: '아세틸 CoA(2C) + 옥살아세트산(4C) → 시트르산(6C)' },
  { node: '시트르산', rx: '이성질화', eq: '시트르산 → 아이소시트르산' },
  { node: '아이소시트르산', rx: '산화적 탈탄산 ①', eq: '→ α-케토글루타르산(5C) + CO₂, NADH' },
  { node: 'α-케토글루타르산', rx: '산화적 탈탄산 ②', eq: '→ 석시닐 CoA(4C) + CO₂, NADH' },
  { node: '석시닐 CoA', rx: '기질 수준 인산화', eq: '→ 석신산, ATP(GTP)' },
  { node: '석신산', rx: '산화 (FAD)', eq: '→ 푸마르산, FADH₂' },
  { node: '푸마르산', rx: '물 첨가', eq: '→ 말산' },
  { node: '말산', rx: '산화 (NAD⁺)', eq: '→ 옥살아세트산, NADH' },
];
const GAIN = ['NADH', '', '', 'CO₂·NADH', 'CO₂·NADH', 'ATP', 'FADH₂', '']; // 노드에 도착할 때 얻은 것

function rInit() {
  R.seq = 0; R.hl.clear(); R.prev = null;
  const s = R.s = {
    cyto: [], acetyl: [], out: [],
    tca: { stage: 0, oaa: null, cur: null, parts: null, chain: null },
    e: { atpS: 0, atpO: 0, nadh: 0, fadh2: 0, o2: 0, h2o: 0 },
    oxygen: document.getElementById('resp-o2').checked,
    ferment: document.getElementById('resp-ferm').value,
    glc: 0, turns: 0, log: [], step: 0, etcFlash: false, lastEtc: null,
  };
  s.tca.oaa = mk('oaa', '옥살아세트산', [1, 2, 3, 4].map(() => newAtom(R, '미토콘드리아에 원래 있던 옥살아세트산', false)), ['C1', 'C2', 'C3', 'C4']);
  rAddGlucose();
}
function rAddGlucose(fromPhoto) {
  const s = R.s;
  let m;
  if (fromPhoto) {
    m = mk('glucose', '포도당', fromPhoto.atoms);
    addLog(R, '광합성에서 만든 포도당 도착', `탄소 ${dots(m.atoms)} — 광합성에서 고정된 CO₂의 탄소가 그대로 들어 있어요.`);
  } else {
    const k = ++s.glc;
    const atoms = [1, 2, 3, 4, 5, 6].map(i => newAtom(R, `포도당 ${k}의 C${i}`, true));
    m = mk('glucose', '포도당', atoms);
    addLog(R, `포도당 ${k} 투입`, `6개의 탄소 ${dots(atoms)}에 각각 다른 색을 붙였어요 (C1~C6).`);
  }
  s.cyto.push(m);
}
const rHas = t => R.s.cyto.some(m => m.type === t);
function rEach(type, fn) {
  const s = R.s;
  const out = [];
  s.cyto.forEach(m => { if (m.type === type) { const r = fn(m); if (r) out.push(...[].concat(r)); } else out.push(m); });
  s.cyto = out;
}

R.actions = () => {
  const s = R.s, t = s.tca;
  return [
    { id: 'glc', group: '준비', label: '포도당 넣기', sub: '탄소 6개에 서로 다른 색 표지', can: () => true, run: () => rAddGlucose() },
    { id: 'g1', group: '1 해당과정 · 세포질', label: '① 포도당 활성화', sub: '포도당 → 과당 1,6-이인산 · ATP −2',
      can: () => rHas('glucose'),
      run: () => rEach('glucose', m => { s.e.atpS -= 2; pass(m.atoms, '포도당 6-인산'); pass(m.atoms, '과당 6-인산');
        addLog(R, '해당과정 ① 활성화', `ATP 2개를 써서 포도당 ${dots(m.atoms)}을 과당 1,6-이인산으로 바꿨어요. 탄소 배치는 그대로예요.`);
        return mk('fbp', '과당 1,6-이인산', m.atoms); }) },
    { id: 'g2', tag: '알돌레이스: 6탄소 → 3탄소 2개', label: '② 6탄소 → 3탄소 2개', sub: '과당 1,6-이인산 → DHAP + G3P → G3P 2분자',
      can: () => rHas('fbp'),
      run: () => rEach('fbp', m => {
        const c = m.atoms;
        const dhap = [c[2], c[1], c[0]]; pass(c.slice(0, 3), 'DHAP');
        const roles = ['C1 (알데하이드)', 'C2', 'C3 (인산)'];
        addLog(R, '해당과정 ② 분해', `C1~C3 ${dots(c.slice(0, 3))}은 DHAP가 되었다가 G3P로 바뀌면서 순서가 뒤집혀요 (C3가 G3P의 C1). C4~C6 ${dots(c.slice(3))}은 바로 G3P가 돼요.`);
        return [mk('g3p', 'G3P', dhap, roles), mk('g3p', 'G3P', c.slice(3), roles)];
      }) },
    { id: 'g3', tag: 'G3P → 피루브산', label: '③ 에너지 회수', sub: 'G3P → 피루브산 · ATP +4, NADH +2 (포도당당)',
      can: () => rHas('g3p'),
      run: () => {
        let n = 0;
        rEach('g3p', m => { n++; s.e.atpS += 2; s.e.nadh += 1; pass(m.atoms, '1,3-BPG'); pass(m.atoms, '3-PG'); pass(m.atoms, 'PEP');
          return mk('pyr', '피루브산', m.atoms, ['C1 (카복실기)', 'C2 (카보닐기)', 'C3 (메틸기)']); });
        addLog(R, '해당과정 ③ 회수', `G3P ${n}분자 → 피루브산 ${n}분자. ATP +${2 * n}, NADH +${n}. 피루브산의 카복실기(C1)는 포도당의 C3·C4에서 왔어요.`);
      } },
    { id: 'pox', tag: '피루브산 탈수소효소: CO₂ 떨어져 나감', group: '2 미토콘드리아', label: '④ 피루브산 산화', sub: '피루브산 → 아세틸 CoA + CO₂ · NADH +1',
      hidden: () => !s.oxygen,
      can: () => s.oxygen && rHas('pyr'),
      run: () => {
        const rel = [];
        rEach('pyr', m => {
          const [c1, c2, c3] = m.atoms;
          s.out.push(mk('co2', 'CO₂', [c1], ['피루브산 산화에서 방출'])); rel.push(c1);
          s.acetyl.push(mk('acoa', '아세틸 CoA', [c2, c3], ['C1 (카보닐)', 'C2 (메틸)']));
          s.e.nadh += 1;
          return null;
        });
        addLog(R, '피루브산 산화', `피루브산이 미토콘드리아로 들어가 카복실기 탄소 ${dots(rel)}가 CO₂로 빠져나갔어요. 남은 2탄소는 아세틸 CoA가 돼요.`);
      } },
    { id: 'tca', label: '⑤ TCA 회로: ' + (t.stage === 0 ? TCA[0].rx : TCA[t.stage].rx), sub: () => (t.stage === 0 ? TCA[0].eq : TCA[t.stage].eq),
      hidden: () => !s.oxygen && t.stage === 0,
      can: () => t.stage > 0 || (s.oxygen && s.acetyl.length > 0),
      run: tcaStep },
    { id: 'etc', label: '⑥ 전자 전달계 · 산화적 인산화', sub: 'NADH, FADH₂ → ATP · O₂ + H⁺ → H₂O',
      hidden: () => !s.oxygen,
      can: () => s.oxygen && (s.e.nadh > 0 || s.e.fadh2 > 0),
      run: () => {
        const n = s.e.nadh, f = s.e.fadh2, atp = n * 2.5 + f * 1.5;
        s.e.atpO += atp; s.e.o2 += (n + f) / 2; s.e.h2o += n + f; s.e.nadh = 0; s.e.fadh2 = 0;
        s.etcFlash = true; s.lastEtc = { n, f, atp };
        addLog(R, '전자 전달계', `NADH ${n}개와 FADH₂ ${f}개의 전자가 내막을 따라 이동해 ATP 약 ${fmt(atp)}개를 만들고, 마지막에 O₂ ${fmt((n + f) / 2)}분자가 전자를 받아 물이 됐어요. 탄소는 여기 참여하지 않아요.`);
      } },
    { id: 'fer', group: '산소가 없을 때', label: s.ferment === 'alcohol' ? '발효: 알코올 발효' : '발효: 젖산 발효',
      sub: s.ferment === 'alcohol' ? '피루브산 → 아세트알데하이드 + CO₂ → 에탄올' : '피루브산 → 젖산 (CO₂ 없음)',
      hidden: () => s.oxygen,
      can: () => !s.oxygen && rHas('pyr'),
      run: () => {
        const rel = [];
        rEach('pyr', m => {
          const [c1, c2, c3] = m.atoms;
          s.e.nadh = Math.max(0, s.e.nadh - 1);
          if (s.ferment === 'alcohol') {
            s.out.push(mk('co2', 'CO₂', [c1], ['알코올 발효에서 방출'])); rel.push(c1);
            pass([c2, c3], '아세트알데하이드');
            return mk('eth', '에탄올', [c2, c3], ['C1', 'C2']);
          }
          return mk('lac', '젖산', [c1, c2, c3], ['C1', 'C2', 'C3']);
        });
        addLog(R, '발효', s.ferment === 'alcohol'
          ? `피루브산의 카복실기 탄소 ${dots(rel)}가 CO₂로 나가고 나머지는 에탄올이 됐어요. NADH는 NAD⁺로 되돌아가 해당과정이 계속될 수 있어요.`
          : `피루브산이 그대로 젖산이 됐어요. 탄소는 하나도 빠져나가지 않아요. NADH는 NAD⁺로 되돌아가요.`);
      } },
  ];
};

function tcaStep() {
  const s = R.s, t = s.tca;
  const release = (atom, why) => { s.out.push(mk('co2', 'CO₂', [atom], [why])); };
  switch (t.stage) {
    case 0: {
      const ac = s.acetyl.shift();
      const [o1, o2, o3, o4] = t.oaa.atoms, [a1, a2] = ac.atoms;
      t.parts = { o1, o2, o3, o4, a1, a2 };
      t.oaa = null;
      t.cur = mk('cit', '시트르산', [o4, o3, o2, o1, a2, a1], ['C5 (옥살아세트산 유래)', 'C4 (옥살아세트산 유래)', 'C3 중심 (옥살아세트산 유래)', 'C6 중심 카복실기 (옥살아세트산 유래)', 'C2 (아세틸 유래)', 'C1 (아세틸 유래)']);
      t.stage = 1;
      addLog(R, 'TCA ① 시트르산 합성', `아세틸 CoA의 탄소 ${dots([a1, a2])}가 옥살아세트산 ${dots([o1, o2, o3, o4])}과 결합해 6탄소 시트르산이 됐어요.`);
      break;
    }
    case 1: {
      const { o1, o2, o3, o4, a1, a2 } = t.parts;
      t.cur = mk('icit', '아이소시트르산', [o4, o3, o2, o1, a2, a1], ['C1', 'C2 (−OH)', 'C3', 'C6 카복실기', 'C4', 'C5']);
      t.stage = 2;
      addLog(R, 'TCA ② 이성질화', '−OH가 옥살아세트산 쪽 탄소로 옮겨 갔어요. 다음 두 번의 탈탄산은 이쪽에서 일어나요.');
      break;
    }
    case 2: {
      const { o1, o2, o3, o4, a1, a2 } = t.parts;
      release(o1, 'TCA 회로 탈탄산 ①'); s.e.nadh++;
      t.cur = mk('akg', 'α-케토글루타르산', [o4, o3, o2, a2, a1], ['C1', 'C2 (케톤)', 'C3', 'C4', 'C5']);
      t.stage = 3;
      addLog(R, 'TCA ③ 탈탄산 ①', `CO₂ ${dots([o1])} 방출, NADH +1. 빠져나간 탄소는 이번에 들어온 아세틸 CoA가 아니라 <b>원래 있던 옥살아세트산</b>의 탄소예요.`);
      break;
    }
    case 3: {
      const { o2, o3, o4, a1, a2 } = t.parts;
      release(o4, 'TCA 회로 탈탄산 ②'); s.e.nadh++;
      t.cur = mk('scoa', '석시닐 CoA', [o3, o2, a2, a1], ['C1 (티오에스터)', 'C2', 'C3', 'C4']);
      t.stage = 4;
      addLog(R, 'TCA ④ 탈탄산 ②', `CO₂ ${dots([o4])} 방출, NADH +1. 이번 바퀴에 들어온 아세틸 탄소 ${dots([a1, a2])}는 아직 회로 안에 남아 있어요.`);
      break;
    }
    case 4: {
      const { o2, o3, a1, a2 } = t.parts;
      let chain = [o3, o2, a2, a1];
      const flipped = Math.random() < 0.5;
      if (flipped) chain = chain.slice().reverse();
      t.chain = chain; s.e.atpS++;
      t.cur = mk('suc', '석신산', chain, ['C1 (카복실기)', 'C2', 'C3', 'C4 (카복실기)']);
      t.stage = 5;
      addLog(R, 'TCA ⑤ 석신산', `ATP(GTP) +1. 석신산은 <b>좌우 대칭</b>이라 효소가 양 끝을 구별하지 못해요. 그래서 탄소 배치가 무작위로 ${flipped ? '<b>뒤집혔어요</b>' : '그대로 유지됐어요'} (50% 확률).`);
      break;
    }
    case 5: t.cur = mk('fum', '푸마르산', t.chain, ['C1', 'C2', 'C3', 'C4']); t.stage = 6; s.e.fadh2++;
      addLog(R, 'TCA ⑥ 푸마르산', 'FADH₂ +1.'); break;
    case 6: t.cur = mk('mal', '말산', t.chain, ['C1', 'C2 (−OH)', 'C3', 'C4']); t.stage = 7;
      addLog(R, 'TCA ⑦ 말산', '물이 더해졌어요.'); break;
    case 7: {
      t.oaa = mk('oaa', '옥살아세트산', t.chain, ['C1', 'C2', 'C3', 'C4']);
      t.cur = null; t.stage = 0; s.turns++; s.e.nadh++;
      const lab = t.chain.filter(a => a.labeled);
      addLog(R, `TCA ⑧ 옥살아세트산 재생 (${s.turns}바퀴 완료)`, `NADH +1. 새 옥살아세트산 ${dots(t.chain)}${lab.length ? `에는 표지 탄소 ${lab.length}개가 들어 있어요. 이 탄소들은 <b>다음 바퀴 이후</b>에 CO₂로 나가요.` : '이 만들어졌어요.'}`);
      break;
    }
  }
}

R.autoNext = () => {
  for (const id of ['tca', 'pox', 'fer', 'g3', 'g2', 'g1', 'etc']) {
    const a = R.actions().find(x => x.id === id);
    if (!(a.hidden && a.hidden()) && a.can()) return id;
  }
  return null;
};
R.allMols = () => { const s = R.s; return [...s.cyto, ...s.acetyl, ...s.out, s.tca.oaa, s.tca.cur].filter(Boolean); };

R.render = () => {
  const s = R.s, t = s.tca, sim = R;
  const co2 = s.out.filter(m => m.type === 'co2');
  const nodes = TCA.map((x, i) => {
    const ang = (i / 8) * 2 * Math.PI - Math.PI / 2;
    const xx = 50 + 41 * Math.cos(ang), yy = 50 + 41 * Math.sin(ang);
    return `<span class="tnode${t.stage === i && (t.cur || i === 0) ? ' on' : ''}" style="left:${xx.toFixed(1)}%;top:${yy.toFixed(1)}%">${x.node}${GAIN[i] ? `<span class="gain">+${GAIN[i]}</span>` : ''}</span>`;
  }).join('');
  const center = t.cur ? molHTML(t.cur, sim) : (t.oaa ? molHTML(t.oaa, sim) : '');
  const centerNote = t.cur ? `다음: ${TCA[t.stage].rx}` : (s.acetyl.length ? '아세틸 CoA를 기다리는 중' : (s.turns ? `${s.turns}바퀴 돌았어요` : '옥살아세트산이 대기 중'));
  const L = s.lastEtc;
  sim.stage.innerHTML = nowHTML(sim) + `
    <div class="zone z-out"><div class="zlabel"><span>세포 밖 · 방출된 CO₂</span><span>CO₂ <b>${co2.length}</b></span></div>
      <div class="pool">${co2.map(m => molHTML(m, sim)).join('') || empty('아직 빠져나간 탄소가 없어요')}</div></div>
    <div class="zone z-cyto"><div class="zlabel"><span>세포질 (해당과정${s.oxygen ? '' : ' · 발효'})</span></div>
      <div class="pool">${s.cyto.map(m => molHTML(m, sim, m.type === 'eth' || m.type === 'lac' ? 'prod' : '')).join('') || empty('포도당을 넣어 보세요')}</div>
      <div class="zone z-mito${s.oxygen ? '' : ' off'}"><div class="zlabel"><span>미토콘드리아 기질${s.oxygen ? '' : ' · 산소가 없어 멈춤'}</span></div>
        <div class="mito-grid">
          <div><div class="sub-label">아세틸 CoA</div><div class="pool">${s.acetyl.map(m => molHTML(m, sim)).join('') || empty('없음')}</div></div>
          <div class="ring">${nodes}<div class="ring-center">${center}<span class="note">${centerNote}</span></div></div>
        </div>
        <div class="membrane${s.etcFlash ? ' flow' : ''}"><span class="mt">내막 · 전자 전달계</span>
          <span class="cx">Ⅰ</span><span class="cx">Ⅱ</span><span class="cx">Q</span><span class="cx">Ⅲ</span><span class="cx">c</span><span class="cx">Ⅳ</span><span class="cx syn">ATP 합성효소</span>
          <span class="etc-note">대기 중: NADH ${s.e.nadh} · FADH₂ ${s.e.fadh2}${L ? ` | 직전: ATP +${fmt(L.atp)}, O₂ ${fmt((L.n + L.f) / 2)} → H₂O ${L.n + L.f}` : ''}</span>
        </div>
      </div>
    </div>`;
  s.etcFlash = false;

  const atpTotal = s.e.atpS + s.e.atpO;
  sim.panel.innerHTML = `
    <div class="card"><h3>에너지 장부 <small>포도당 1분자 이론값 ≈ ATP 30~32</small></h3>${meterHTML(sim, [
      ['atpS', 'ATP · 기질 수준', s.e.atpS], ['atpO', 'ATP · 산화적 인산화', s.e.atpO],
      ['nadh', 'NADH 보유', s.e.nadh], ['fadh2', 'FADH₂ 보유', s.e.fadh2],
      ['o2', 'O₂ 소비', s.e.o2], ['h2o', 'H₂O 생성', s.e.h2o],
      ['co2', 'CO₂ 방출', co2.length], ['turns', 'TCA 회전', s.turns],
      ['tot', 'ATP 순생산 합계', atpTotal, 'total']])}</div>
    ${trackerHTML(sim)}
    ${questionsHTML([
      '피루브산 산화에서 나간 CO₂는 포도당의 몇 번 탄소인가요?',
      'TCA 회로 <b>첫 바퀴</b>에서 나간 CO₂ 2개는 회색(원래 있던 탄소)인가요, 색깔 탄소인가요?',
      '포도당 하나를 끝까지 분해했을 때 아직 회로에 남아 있는 표지 탄소는 몇 개인가요? 포도당을 하나 더 넣으면 어떻게 될까요?',
      '산소를 끄고 알코올 발효와 젖산 발효를 비교해 보세요. 어떤 탄소가 CO₂로 나가나요?',
    ])}
    ${logHTML(sim)}`;
  renderActions(sim);
};

/* =========================================================================
   광합성
   ========================================================================= */
const P = { key: 'P', hue: 200, seq: 0, hl: new Set(), timer: null };
const G3P_ROLES = ['C1 (알데하이드)', 'C2', 'C3 (인산)'];

function pInit() {
  P.seq = 0; P.hl.clear(); P.prev = null;
  const s = P.s = {
    air: [], rubp: [], pga: [], g3p: [], cyto: [], sugar: [],
    e: { atp: 0, nadph: 0, h2o: 0, o2: 0, fixed: 0, exported: 0, glucose: 0 },
    light: document.getElementById('photo-light').checked,
    intensity: +document.getElementById('photo-int').value,
    sel: null, log: [], step: 0, lightFlash: false,
  };
  for (let i = 0; i < 3; i++) s.rubp.push(mk('rubp', 'RuBP', [1, 2, 3, 4, 5].map(() => newAtom(P, '엽록체에 원래 있던 RuBP', false))));
  pAddCO2(3);
}
function pAddCO2(n) {
  const s = P.s, made = [];
  for (let i = 0; i < n; i++) {
    const a = newAtom(P, '', true);
    a.origin = `대기 중 CO₂ #${a.n}`;
    made.push(a);
    s.air.push(mk('co2', 'CO₂', [a], ['기공으로 들어온 CO₂']));
  }
  addLog(P, `CO₂ ${n}분자 공급`, `새로 들어온 CO₂의 탄소 ${dots(made)}에 각각 다른 색을 붙였어요.`);
}

P.actions = () => {
  const s = P.s, e = s.e;
  return [
    { id: 'co2', group: '재료 공급', label: 'CO₂ 3분자 공급', sub: '탄소마다 서로 다른 색 표지', can: () => true, run: () => pAddCO2(3) },
    { id: 'co2one', label: 'CO₂ 1분자 공급', sub: '하나씩 넣어 자세히 보기', can: () => true, run: () => pAddCO2(1) },
    { id: 'light', group: '1 명반응 · 틸라코이드', label: '① 명반응', sub: s.light ? `H₂O ${2 * s.intensity} → O₂ ${s.intensity} · ATP +${3 * s.intensity}, NADPH +${2 * s.intensity}` : '빛이 꺼져 있어요',
      can: () => s.light,
      run: () => {
        const k = s.intensity;
        e.h2o += 2 * k; e.o2 += k; e.atp += 3 * k; e.nadph += 2 * k; s.lightFlash = true;
        addLog(P, '명반응', `빛 에너지로 물 ${2 * k}분자를 분해해 O₂ ${k}분자를 내보내고 ATP ${3 * k}개, NADPH ${2 * k}개를 만들었어요. O₂의 산소는 CO₂가 아니라 <b>물</b>에서 와요.`);
      } },
    { id: 'fix', hub: '.a-fix', tag: '루비스코: 탄소 고정', group: '2 캘빈 회로 · 스트로마', label: '② 탄소 고정 (루비스코)', sub: 'CO₂ + RuBP(5C) → 3-PGA(3C) 2분자',
      can: () => s.air.length > 0 && s.rubp.length > 0,
      run: () => {
        const k = Math.min(s.air.length, s.rubp.length), fixed = [];
        for (let i = 0; i < k; i++) {
          const c = s.air.shift().atoms[0], r = s.rubp.shift().atoms;
          pass([c, ...r], '6탄소 중간체');
          s.pga.push(mk('pga', '3-PGA', [c, r[1], r[0]], ['C1 (카복실기 · 방금 고정된 탄소)', 'C2', 'C3']));
          s.pga.push(mk('pga', '3-PGA', [r[2], r[3], r[4]], ['C1 (카복실기)', 'C2', 'C3']));
          fixed.push(c); e.fixed++;
        }
        addLog(P, '탄소 고정', `CO₂ ${k}분자 ${dots(fixed)}가 RuBP에 붙어 불안정한 6탄소 화합물이 되고, 곧바로 3-PGA ${2 * k}분자로 쪼개졌어요. 표지 탄소는 3-PGA의 <b>카복실기(C1)</b>에 들어가요. 이것이 캘빈이 찾아낸 최초의 안정한 산물이에요.`);
      } },
    { id: 'red', hub: '.a-red', tag: '환원 (ATP · NADPH)', label: '③ 환원', sub: '3-PGA → G3P · 분자당 ATP 1, NADPH 1',
      can: () => s.pga.length > 0 && e.atp > 0 && e.nadph > 0,
      run: () => {
        const k = Math.min(s.pga.length, e.atp, e.nadph);
        for (let i = 0; i < k; i++) { const m = s.pga.shift(); pass(m.atoms, '1,3-BPG'); s.g3p.push(mk('g3p', 'G3P', m.atoms, G3P_ROLES)); }
        e.atp -= k; e.nadph -= k;
        addLog(P, '환원', `3-PGA ${k}분자가 ATP ${k}개와 NADPH ${k}개를 써서 G3P가 됐어요.${s.pga.length ? ` ATP나 NADPH가 모자라 3-PGA ${s.pga.length}분자가 남았어요.` : ''}`);
      } },
    { id: 'exp', hub: '.a-exp', tag: '엽록체 밖으로', label: '④ G3P 1분자 내보내기', sub: s.sel ? '선택한 G3P를 세포질로' : 'G3P를 눌러 고를 수 있어요 (안 고르면 무작위)',
      can: () => s.g3p.length > 0,
      run: () => {
        let i = s.g3p.findIndex(m => m.id === s.sel);
        if (i < 0) i = Math.floor(Math.random() * s.g3p.length);
        const m = s.g3p.splice(i, 1)[0];
        s.cyto.push(mk('g3p', 'G3P (내보냄)', m.atoms, G3P_ROLES)); s.sel = null; e.exported++;
        const lab = m.atoms.filter(a => a.labeled).length;
        addLog(P, 'G3P 내보내기', `G3P ${dots(m.atoms)}가 엽록체 밖으로 나갔어요. 이 분자에는 표지 탄소가 ${lab}개 있어요. 3CO₂를 고정할 때마다 1분자만 내보내야 RuBP 수가 유지돼요.`);
      } },
    { id: 'regen', hub: '.a-back', tag: 'RuBP 재생: 탄소 재배열', label: '⑤ RuBP 재생', sub: 'G3P 5분자(15C) → RuBP 3분자(15C) · ATP −3',
      can: () => s.g3p.length >= 5 && e.atp >= 3,
      run: () => {
        let made = 0;
        while (s.g3p.length >= 5 && e.atp >= 3) { regenerate(); e.atp -= 3; made += 3; }
        void made;
      } },
    { id: 'glc', group: '3 당 합성 · 세포질', label: '⑥ 포도당 합성', sub: 'G3P 2분자 → 포도당 1분자',
      can: () => s.cyto.filter(m => m.type === 'g3p').length >= 2,
      run: () => {
        const gs = s.cyto.filter(m => m.type === 'g3p').slice(0, 2);
        s.cyto = s.cyto.filter(m => !gs.includes(m));
        const [A, B] = gs.map(m => m.atoms);
        pass(A, 'DHAP'); pass([...A, ...B], '과당 1,6-이인산');
        const glc = mk('glucose', '포도당', [A[2], A[1], A[0], B[0], B[1], B[2]]);
        s.sugar.push(glc); e.glucose++;
        addLog(P, '포도당 합성', `G3P 하나는 DHAP로 바뀐 뒤 다른 G3P와 결합해 포도당 ${dots(glc.atoms)}이 됐어요. 포도당의 C3·C4는 두 G3P의 C1이에요.`);
      } },
    { id: 'send', label: '포도당을 세포호흡으로 보내기', sub: '같은 색 탄소가 호흡에서 어떻게 나가는지 보기',
      can: () => s.sugar.length > 0,
      run: () => {
        const m = s.sugar.shift();
        m.atoms.forEach(a => { if (a.labeled && !a.label.startsWith('P')) a.label = 'P' + a.n; a.origin = a.labeled ? `광합성 ${a.origin}` : a.origin; });
        addLog(P, '세포호흡으로 이동', `포도당 ${dots(m.atoms)}을 세포호흡 시뮬레이터로 보냈어요. 표지 번호 앞에 P가 붙어요.`);
        rAddGlucose(m); R.render();
        toast('포도당을 세포호흡 탭으로 보냈어요. 표지 탄소 번호 앞에 P가 붙어 있어요.');
      } },
  ];
};

/* RuBP 재생: 알돌레이스 · 트랜스케톨레이스 반응의 실제 탄소 재배치 */
function regenerate() {
  const s = P.s;
  const sel = s.g3p.splice(0, 5);
  const [g1, g2, g3, g4, g5] = sel.map(m => m.atoms);
  pass([...g1, ...g2], 'DHAP');
  const F = [g1[2], g1[1], g1[0], g3[0], g3[1], g3[2]]; pass(F, '과당 6-인산');           // DHAP + G3P → F6P
  const Xu1 = [F[0], F[1], g4[0], g4[1], g4[2]]; const E = [F[2], F[3], F[4], F[5]];        // 트랜스케톨레이스
  pass(E, '에리트로스 4-인산'); pass(Xu1, '자일룰로스 5-인산');
  const S = [g2[2], g2[1], g2[0], E[0], E[1], E[2], E[3]]; pass(S, '세도헵툴로스 7-인산'); // DHAP + E4P → S7P
  const Xu2 = [S[0], S[1], g5[0], g5[1], g5[2]]; const R5 = S.slice(2);                     // 트랜스케톨레이스
  pass(Xu2, '자일룰로스 5-인산'); pass(R5, '리보스 5-인산');
  [Xu1, Xu2, R5].forEach(c => { pass(c, '리불로스 5-인산'); s.rubp.push(mk('rubp', 'RuBP', c)); });
  addLog(P, 'RuBP 재생', `G3P 5분자가 과당 6-인산(6C), 에리트로스 4-인산(4C), 세도헵툴로스 7-인산(7C)을 거쳐 탄소가 다시 짜 맞춰져 RuBP 3분자 ${dots(Xu1)} ${dots(Xu2)} ${dots(R5)}가 됐어요. ATP −3. 표지 탄소가 RuBP 안으로 퍼져 들어가요.`);
}

P.autoNext = () => {
  const s = P.s, e = s.e;
  const can = id => P.actions().find(a => a.id === id).can();
  if (s.pga.length === 0 && s.g3p.length > 0 && e.fixed - 3 * e.exported >= 3) return 'exp';
  if (s.pga.length === 0 && can('regen')) return 'regen';
  if (can('glc') && !(s.g3p.length >= 5)) return 'glc';
  if (can('red')) return 'red';
  if (can('fix')) return 'fix';
  if (s.light && (s.pga.length > 0 || (s.g3p.length >= 5 && e.atp < 3))) return 'light';
  if (s.air.length === 0 && s.rubp.length >= 3 && s.pga.length === 0 && s.g3p.length < 5) return 'co2';
  return null;
};
P.stopAfter = id => (id === 'glc' ? '포도당 1분자가 완성되어 자동 진행을 멈췄어요.' : null);
P.idleMsg = () => (!P.s.light ? '빛이 없어 ATP·NADPH를 만들 수 없어요. 3-PGA가 쌓이고 RuBP가 줄어든 것을 확인해 보세요.' : null);
P.allMols = () => { const s = P.s; return [...s.air, ...s.rubp, ...s.pga, ...s.g3p, ...s.cyto, ...s.sugar]; };

P.render = () => {
  const s = P.s, e = s.e, sim = P;
  const pick = m => molHTML(m, sim, 'pick' + (s.sel === m.id ? ' sel' : ''));
  const k = s.intensity;
  sim.stage.innerHTML = nowHTML(sim) + `
    <div class="zone z-air"><div class="zlabel"><span>대기 · 잎의 기공</span><span>O₂ 배출 <b>${e.o2}</b></span></div>
      <div class="pool">${s.air.map(m => molHTML(m, sim)).join('') || empty('CO₂가 없어요. 왼쪽에서 공급해 보세요')}</div></div>
    <div class="zone z-chloro${s.light ? '' : ' dark'}"><div class="zlabel"><span>엽록체</span><span>${s.light ? `빛 세기 ${'●'.repeat(k)}${'○'.repeat(3 - k)}` : '빛 꺼짐'}</span></div>
      <div class="thylakoid${s.lightFlash ? ' flash' : ''}${s.light ? '' : ' off'}">
        <span class="mt">틸라코이드 막 · 명반응</span>
        <span class="lr-arrow">H₂O →</span><span class="ps">광계 Ⅱ</span><span class="lr-arrow">e⁻ →</span><span class="ps">광계 Ⅰ</span><span class="lr-arrow">→ NADPH</span>
        <span class="ps">ATP 합성효소</span>
        <span class="water-note">ATP <b>${e.atp}</b> · NADPH <b>${e.nadph}</b> 보유 — 캘빈 회로의 환원·재생 단계에 쓰여요</span>
      </div>
      <div class="calvin">
        <div class="cbox c-rubp"><h4>RuBP (5탄소) <b>${s.rubp.length}</b></h4><div class="pool">${s.rubp.map(m => molHTML(m, sim)).join('') || empty('RuBP가 바닥났어요')}</div></div>
        <div class="carrow a-fix"><span><b>→</b>② 탄소 고정<br>+CO₂</span></div>
        <div class="cbox c-pga"><h4>3-PGA (3탄소) <b>${s.pga.length}</b></h4><div class="pool">${s.pga.map(m => molHTML(m, sim)).join('') || empty('없음')}</div></div>
        <div class="carrow a-red"><span><b>↓</b>③ 환원<br>ATP · NADPH</span></div>
        <div class="carrow a-mid">캘빈 회로</div>
        <div class="carrow a-regen"><span><b>↑</b>⑤ 재생<br>ATP</span></div>
        <div class="cbox c-g3p"><h4>G3P (3탄소) <b>${s.g3p.length}</b></h4><div class="pool">${s.g3p.map(pick).join('') || empty('없음')}</div></div>
        <div class="carrow a-back"><span><b>←</b>G3P 5분자</span></div>
        <div class="carrow a-exp"><span><b>↙</b>④ G3P 1분자는<br>세포질로</span></div>
      </div>
    </div>
    <div class="zone z-sugar"><div class="zlabel"><span>세포질 · 합성된 당</span><span>포도당 <b>${e.glucose}</b></span></div>
      <div class="pool">${[...s.cyto, ...s.sugar].map(m => molHTML(m, sim)).join('') || empty('캘빈 회로에서 나온 G3P가 여기로 와요')}</div></div>`;
  s.lightFlash = false;

  sim.panel.innerHTML = `
    <div class="card"><h3>물질 장부 <small>포도당 1분자 = CO₂ 6 · ATP 18 · NADPH 12</small></h3>${meterHTML(sim, [
      ['atp', 'ATP 보유', e.atp], ['nadph', 'NADPH 보유', e.nadph],
      ['h2o', 'H₂O 분해', e.h2o], ['o2', 'O₂ 발생', e.o2],
      ['fixed', '고정한 CO₂', e.fixed], ['exported', '내보낸 G3P', e.exported],
      ['rubp', 'RuBP', s.rubp.length], ['pga', '3-PGA', s.pga.length],
      ['glucose', '만든 포도당', e.glucose, 'total']])}</div>
    ${trackerHTML(sim)}
    ${questionsHTML([
      '탄소 고정 직후, 색깔 탄소는 3-PGA의 몇 번 탄소에 있나요? (캘빈의 <sup>14</sup>C 실험)',
      '처음 6개의 G3P 중 표지 탄소가 없는 것은 몇 개인가요? 어떤 G3P를 내보내는지에 따라 무엇이 달라지나요?',
      'RuBP 재생 후 표지 탄소가 RuBP의 몇 번 탄소에 들어갔는지 추적표에서 찾아보세요.',
      '빛을 끄고 진행해 보세요. RuBP와 3-PGA의 양은 각각 어떻게 변하나요? 왜 그럴까요?',
    ])}
    ${logHTML(sim)}`;
  renderActions(sim);
};

/* =========================================================================
   화면 연결
   ========================================================================= */
const tip = document.getElementById('tip');
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast.h); toast.h = setTimeout(() => { t.hidden = true; }, 3800);
}
function simOf(el) { const r = el.closest('[data-sim]'); return r ? (r.dataset.sim === 'R' ? R : P) : null; }

function showTip(el, x, y) {
  const a = ATOMS.get(el.dataset.aid);
  if (!a) return;
  tip.innerHTML = a.labeled
    ? `<b>탄소 ${esc(a.label)}</b> · ${esc(a.origin)}<br>현재: ${esc(a.where)} (${esc(a.pos)})<br>경로: ${esc(a.hist.join(' → '))}`
    : `표지되지 않은 탄소<br>${esc(a.origin)}<br>현재: ${esc(a.where)} (${esc(a.pos)})`;
  tip.hidden = false;
  const w = tip.offsetWidth, h = tip.offsetHeight;
  tip.style.left = Math.max(8, Math.min(innerWidth - w - 8, x + 14)) + 'px';
  tip.style.top = (y + h + 24 > innerHeight ? y - h - 12 : y + 16) + 'px';
}

function setup(sim, rootId, init) {
  sim.root = document.getElementById(rootId);
  sim.stage = sim.root.querySelector('[data-stage]');
  sim.panel = sim.root.querySelector('[data-panel]');
  sim.init = init;
  init(); sim.render();

  sim.root.addEventListener('click', ev => {
    const actBtn = ev.target.closest('[data-act]');
    if (actBtn) { act(sim, actBtn.dataset.act); return; }
    if (ev.target.closest('[data-auto]')) { toggleAuto(sim); return; }
    if (ev.target.closest('[data-reset]')) { stopAuto(sim); finishFx(); sim.now = null; sim.init(); sim.render(); return; }
    const atom = ev.target.closest('[data-aid]');
    if (atom) {
      const id = atom.dataset.aid, a = ATOMS.get(id);
      if (a && a.labeled) { sim.hl.has(id) ? sim.hl.delete(id) : sim.hl.add(id); rerender(sim); }
      const r = atom.getBoundingClientRect();
      const again = sim.stage.querySelector(`[data-aid="${id}"]`);
      if (again) showTip(again, r.left, r.top);
      return;
    }
    const row = ev.target.closest('[data-track]');
    if (row) { const id = row.dataset.track; sim.hl.has(id) ? sim.hl.delete(id) : sim.hl.add(id); rerender(sim); return; }
    const mol = ev.target.closest('.mol.pick');
    if (mol && sim === P) { P.s.sel = P.s.sel === mol.dataset.mid ? null : mol.dataset.mid; rerender(P); }
  });
  sim.stage.addEventListener('pointerover', ev => {
    const el = ev.target.closest('[data-aid]');
    if (el && ev.pointerType === 'mouse') showTip(el, ev.clientX, ev.clientY);
  });
  sim.stage.addEventListener('pointermove', ev => {
    const el = ev.target.closest('[data-aid]');
    if (el && ev.pointerType === 'mouse') showTip(el, ev.clientX, ev.clientY);
  });
  sim.stage.addEventListener('pointerout', ev => { if (ev.target.closest('[data-aid]')) tip.hidden = true; });
}

document.addEventListener('scroll', () => { tip.hidden = true; }, { passive: true });
document.addEventListener('click', ev => { if (!ev.target.closest('[data-aid]')) tip.hidden = true; });

document.getElementById('resp-o2').addEventListener('change', ev => {
  R.s.oxygen = ev.target.checked;
  document.getElementById('resp-ferm-wrap').hidden = R.s.oxygen;
  addLog(R, ev.target.checked ? '산소 공급' : '산소 차단', ev.target.checked
    ? '산소가 있으면 피루브산이 미토콘드리아로 들어가 완전히 분해돼요.'
    : '산소가 없으면 전자 전달계가 멈추고 NADH가 쌓여요. 세포질에서 발효로 NAD⁺를 되살려요.');
  finishFx(); R.render();
});
document.getElementById('resp-ferm').addEventListener('change', ev => { R.s.ferment = ev.target.value; rerender(R); });
document.getElementById('photo-light').addEventListener('change', ev => {
  P.s.light = ev.target.checked;
  addLog(P, ev.target.checked ? '빛 켜기' : '빛 끄기', ev.target.checked ? '명반응이 다시 ATP와 NADPH를 만들 수 있어요.' : '명반응이 멈췄어요. 남은 ATP·NADPH가 떨어지면 캘빈 회로의 환원 단계가 멈춰요.');
  finishFx(); P.render();
});
document.getElementById('photo-int').addEventListener('input', ev => { P.s.intensity = +ev.target.value; rerender(P); });
document.getElementById('opt-colorall').addEventListener('change', ev => { settings.colorAll = ev.target.checked; finishFx(); R.render(); P.render(); });
document.getElementById('opt-speed').addEventListener('input', ev => { settings.speed = +ev.target.value; });

/* 탭 (주소의 #respiration / #photosynthesis 와 연동) */
function showTab(name) {
  if (name !== 'photosynthesis') name = 'respiration';
  document.querySelectorAll('.tab').forEach(t => t.setAttribute('aria-selected', String(t.dataset.tab === name)));
  document.getElementById('sim-respiration').hidden = name !== 'respiration';
  document.getElementById('sim-photosynthesis').hidden = name !== 'photosynthesis';
  tip.hidden = true;
  finishFx();
}
document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => {
  if (location.hash !== '#' + t.dataset.tab) location.hash = t.dataset.tab;
  showTab(t.dataset.tab);
}));
addEventListener('hashchange', () => showTab(location.hash.slice(1)));

setup(R, 'sim-respiration', rInit);
setup(P, 'sim-photosynthesis', pInit);
document.getElementById('resp-ferm-wrap').hidden = R.s.oxygen;
showTab(location.hash.slice(1));
