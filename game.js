'use strict';
// 오락실 튜토리얼이 '진짜로 일어난 일'을 알아채는 신호 (튜토리얼이 아니면 아무도 안 듣는다)
const tutorialSignal = (type) => window.dispatchEvent(new CustomEvent('arcade:tutorial', { detail: { type } }));

// 힐 클라이밍: 화면·입력·소리. 규칙은 logic.js (LOGIC_HILL).
const L = LOGIC_HILL;
const P = L.P;
const $ = (id) => document.getElementById(id);
const W = 360, H = 640;
const canvas = $('game'), ctx = canvas.getContext('2d');

const store = {
  get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} },
};

// ---------- 소리 ----------
let audio = null, eng = null;
let muted = store.get('hillclimbMuted') === '1';
function ac() { try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); return audio; } catch (_) { return null; } }
function tone(freq, dur, type = 'triangle', vol = 0.05, slide = 0) {
  if (muted) return;
  const a = ac(); if (!a) return;
  try {
    const t = a.currentTime, o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(a.destination); o.start(t); o.stop(t + dur);
  } catch (_) {}
}
function engine(speed, gas, on) {                          // 엔진 소리: 속도와 가속에 따라 높아지는 낮은 톱니파
  const a = audio;
  if (!a) return;
  if (!on || muted) { if (eng) { try { eng.g.gain.setTargetAtTime(0, a.currentTime, 0.05); } catch (_) {} } return; }
  try {
    if (!eng) { const o = a.createOscillator(), g = a.createGain(); o.type = 'sawtooth'; g.gain.value = 0; o.connect(g).connect(a.destination); o.start(); eng = { o, g }; }
    eng.o.frequency.setTargetAtTime(55 + speed * 0.22 + (gas ? 18 : 0), a.currentTime, 0.06);
    eng.g.gain.setTargetAtTime(gas ? 0.014 : 0.006, a.currentTime, 0.08);
  } catch (_) {}
}
const sfx = {
  coin: () => { tone(988, 0.06, 'square', 0.035); setTimeout(() => tone(1319, 0.1, 'square', 0.035), 55); },
  fuel: () => [523, 659, 784].forEach((f, i) => setTimeout(() => tone(f, 0.12, 'triangle', 0.06), i * 70)),
  land: () => tone(110, 0.1, 'sine', 0.07, -50),
  crash: () => { tone(160, 0.5, 'sawtooth', 0.08, -120); },
  low: () => tone(700, 0.08, 'square', 0.04),
  best: () => [784, 988, 1175, 1568].forEach((f, i) => setTimeout(() => tone(f, 0.14, 'triangle', 0.06), i * 90)),
};

// ---------- 상태 ----------
let G = L.newGame(L.rng(1), { level: 'easy' });
let state = 'title';                    // title · play · paused · over
let level = 'normal', tut = false, newBest = false, clock = 0, cam = { x: 0, y: 0 }, parts = [], floats = [], shake = 0, wheelRot = 0, brakedSig = 0, lowT = 0, driveAcc = 0;
let best = Number(store.get('hillclimbBest')) || 0;
const held = { gas: false, brake: false, kGas: false, kBrake: false };

/* @test-hooks:start */
window.__hc = { get G() { return G; }, get state() { return state; }, L, step: (dt) => update(dt), held };
/* @test-hooks:end */

// ---------- 흐름 ----------
function showOverlay(html) {
  const o = $('overlay'); o.innerHTML = html; o.classList.remove('hidden');
  o.querySelectorAll('button[data-level]').forEach((b) => { b.onclick = () => start(b.dataset.level); });
  o.querySelectorAll('button[data-resume]').forEach((b) => { b.onclick = resume; });
  o.querySelectorAll('button[data-quit]').forEach((b) => { b.onclick = () => { hideOverlay(); showTitle(); }; });
}
function hideOverlay() { $('overlay').classList.add('hidden'); }
const lvButtons = () => `<div class="lv"><button data-level="easy">쉬움<small>완만한 언덕 · 연료 넉넉</small></button><button data-level="normal">보통<small>가파른 언덕 · 기록 저장</small></button></div>`;
function showTitle() {
  state = 'title'; $('ctls').classList.add('hidden'); engine(0, false, false);
  showOverlay(`<h1>힐 클라이밍</h1><p><b>가속</b>과 <b>브레이크</b>만으로<br>울퉁불퉁한 언덕을 달려요!</p>
    <p class="help">⛽ 연료통을 먹어 연료를 채우고, 🪙 코인을 모으세요.<br>공중에서는 <b>가속 = 앞바퀴 들기</b>, <b>브레이크 = 앞바퀴 숙이기</b>.<br>머리가 땅에 닿으면 끝이에요!</p>
    ${best ? `<div class="big">최고 ${best}점</div>` : ''}${lvButtons()}<p class="note"><span class="pc">→ / Space 가속 · ← / ↓ 브레이크</span><span class="touch">오른쪽 가속 · 왼쪽 브레이크 버튼</span></p>`);
}
function start(lv) {
  tut = /[?&]tutorial=1/.test(location.search);
  if (tut) lv = 'easy';
  level = lv === 'easy' ? 'easy' : 'normal';
  G = L.newGame(Math.random, { level, tutorial: tut });
  parts = []; floats = []; shake = 0; newBest = false; wheelRot = 0; brakedSig = 0; lowT = 0; driveAcc = 0;
  Object.keys(held).forEach((k) => { held[k] = false; });
  cam = { x: G.b.x - 110, y: G.b.y - 330 };
  state = 'play'; hideOverlay(); $('ctls').classList.remove('hidden'); ac();
}
function gameOver() {
  state = 'over'; $('ctls').classList.add('hidden'); engine(0, false, false); sfx.crash(); shake = 0.45;
  const sc = L.scoreOf(G);
  newBest = level === 'normal' && !tut && sc > best;
  if (newBest) { best = sc; store.set('hillclimbBest', String(best)); setTimeout(sfx.best, 600); }
  for (let i = 0; i < 16; i++) { const a = -Math.random() * Math.PI, v = 80 + Math.random() * 200; parts.push({ x: G.b.x, y: G.b.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t: 0, life: 0.8, color: i % 2 ? '#ffb02e' : '#fff', r: 3 }); }
  setTimeout(() => {
    if (state !== 'over') return;
    const why = G.why === 'fuel' ? '연료가 떨어졌어요!' : '넘어졌어요!';
    showOverlay(`<h2>${why}</h2><div class="big">${L.meters(G)}m</div><p>코인 ${G.coins}개 · 연료통 ${G.cans}개 · 점수 <b>${sc}</b><br>${newBest ? '🎉 새 최고 기록!' : level === 'normal' ? `최고 ${best}점` : '쉬움에서는 기록이 저장되지 않아요'}</p>${lvButtons()}`);
  }, 1000);
}
function pause() { if (state !== 'play') return; state = 'paused'; engine(0, false, false); showOverlay(`<h2>일시정지</h2><button data-resume="1">계속하기</button><button data-quit="1" style="background:rgba(255,255,255,.14);color:#fff;box-shadow:none;font-size:14px;padding:9px 22px">그만하고 처음으로</button>`); }
function resume() { if (state !== 'paused') return; state = 'play'; hideOverlay(); }
function toggleMute() { muted = !muted; store.set('hillclimbMuted', muted ? '1' : '0'); $('muteBtn').textContent = muted ? '🔇' : '🔊'; if (muted) engine(0, false, false); }

// ---------- 입력 ----------
function bindHold(id, key) {
  const el = $(id);
  const on = (e) => { e.preventDefault(); held[key] = true; el.classList.add('on'); try { el.setPointerCapture(e.pointerId); } catch (_) {} };
  const off = () => { held[key] = false; el.classList.remove('on'); };
  el.addEventListener('pointerdown', on); el.addEventListener('pointerup', off); el.addEventListener('pointercancel', off); el.addEventListener('lostpointercapture', off);
}
bindHold('btnGas', 'gas'); bindHold('btnBrake', 'brake');
addEventListener('keydown', (e) => {
  const c = e.code;
  if (c === 'KeyP') { if (!e.repeat) state === 'paused' ? resume() : pause(); return; }
  if (c === 'KeyM') { if (!e.repeat) toggleMute(); return; }
  let used = true;
  if (c === 'ArrowRight' || c === 'Space' || c === 'KeyD' || c === 'ArrowUp' || c === 'KeyW') held.kGas = true;
  else if (c === 'ArrowLeft' || c === 'ArrowDown' || c === 'KeyA' || c === 'KeyS') held.kBrake = true;
  else used = false;
  if (used && state === 'play') e.preventDefault();
});
addEventListener('keyup', (e) => {
  const c = e.code;
  if (c === 'ArrowRight' || c === 'Space' || c === 'KeyD' || c === 'ArrowUp' || c === 'KeyW') held.kGas = false;
  else if (c === 'ArrowLeft' || c === 'ArrowDown' || c === 'KeyA' || c === 'KeyS') held.kBrake = false;
});
$('muteBtn').onclick = (e) => { e.currentTarget.blur(); toggleMute(); };
$('pauseBtn').onclick = (e) => { e.currentTarget.blur(); state === 'paused' ? resume() : pause(); };
addEventListener('blur', () => { Object.keys(held).forEach((k) => { held[k] = false; }); pause(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
function fit() { const s = Math.min(innerWidth / W, innerHeight / H); canvas.style.width = `${Math.floor(W * s)}px`; canvas.style.height = `${Math.floor(H * s)}px`; $('wrap').style.width = canvas.style.width; $('wrap').style.height = canvas.style.height; }
addEventListener('resize', fit); fit();
$('muteBtn').textContent = muted ? '🔇' : '🔊';

// ---------- 갱신 ----------
function update(dt) {
  clock += dt;
  const b = G.b;
  if (state === 'play') {
    const gas = held.gas || held.kGas, brake = held.brake || held.kBrake;
    L.setInput(G, gas, brake);
    const x0 = b.x, v0 = b.vx;
    L.step(G, dt);
    for (const ev of G.events) onEvent(ev);
    G.events.length = 0;
    wheelRot += (b.vx / P.wheelR) * dt;
    if (gas && b.x > x0) { driveAcc += b.x - x0; if (driveAcc >= 200) { driveAcc = 0; tutorialSignal('drive'); } }
    if (brake && v0 - b.vx > 0) { brakedSig += v0 - b.vx; if (brakedSig > 60) { brakedSig = 0; tutorialSignal('brake'); } }
    engine(Math.hypot(b.vx, b.vy), gas && G.fuel > 0, true);
    if (G.fuel > 0 && G.fuel < 25 && !G.tutorial) { lowT += dt; if (lowT > 0.9) { lowT = 0; sfx.low(); } }
    if (gas && G.contact[0] && Math.random() < dt * 40) parts.push({ x: b.x - 30, y: b.y + 24, vx: -60 - Math.random() * 40, vy: -30 - Math.random() * 40, t: 0, life: 0.45, color: '#b89870', r: 2.5 });
    if (G.over) gameOver();
  }
  // 카메라: 앞쪽을 더 보여 줌
  const tx = b.x - 110 + Math.min(100, b.vx * 0.25), ty = b.y - 330, k = Math.min(1, dt * 5);
  cam.x += (tx - cam.x) * k; cam.y += (ty - cam.y) * Math.min(1, dt * 3);
  for (const p of parts) { p.t += dt; p.vy += 500 * dt; p.x += p.vx * dt; p.y += p.vy * dt; }
  parts = parts.filter((p) => p.t < p.life);
  for (const f of floats) f.t += dt; floats = floats.filter((f) => f.t < 1);
  shake = Math.max(0, shake - dt);
}
function onEvent(ev) {
  if (ev.type === 'coin') { sfx.coin(); tutorialSignal('coin'); floats.push({ x: ev.x, y: ev.y - 12, t: 0, text: '+5', color: '#ffe36a' }); }
  else if (ev.type === 'fuel') { sfx.fuel(); tutorialSignal('fuel'); floats.push({ x: ev.x, y: ev.y - 16, t: 0, text: '⛽ 연료 충전!', color: '#9dff9d' }); }
  else if (ev.type === 'land') { sfx.land(); }
  else if (ev.type === 'safeland') { tutorialSignal('air'); floats.push({ x: G.b.x, y: G.b.y - 50, t: 0, text: '멋진 착지!', color: '#fff' }); }
  else if (ev.type === 'empty') floats.push({ x: G.b.x, y: G.b.y - 60, t: 0, text: '연료 없음! 연료통을 찾으세요', color: '#ff9a9a' });
  else if (ev.type === 'respawn') floats.push({ x: G.b.x, y: G.b.y - 60, t: 0, text: '연습이라 다시 세워 줬어요', color: '#fff' });
}

// ---------- 그리기 ----------
const sx = (x) => x - cam.x, sy = (y) => y - cam.y;
function draw() {
  const b = G.b;
  const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#6ec6f5'); g.addColorStop(0.6, '#cfeeff'); g.addColorStop(1, '#f4f0d0'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // 먼 산 (천천히 따라옴)
  for (const [par, base, amp, col] of [[0.1, 390, 50, '#9fcbe0'], [0.25, 430, 40, '#78b0c8']]) {
    ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(0, H);
    for (let px = 0; px <= W + 10; px += 10) { const wx = px + cam.x * par; ctx.lineTo(px, base - cam.y * par * 0.2 + Math.sin(wx * 0.006) * amp + Math.sin(wx * 0.017) * 14); }
    ctx.lineTo(W, H); ctx.fill();
  }
  ctx.save();
  if (shake > 0) ctx.translate((Math.random() - 0.5) * 8 * shake * 2, (Math.random() - 0.5) * 8 * shake * 2);
  // 땅
  const gy = (x) => L.groundAt(G.T, x).y;
  ctx.fillStyle = '#7a5a3a'; ctx.beginPath(); ctx.moveTo(0, H + 400);
  for (let px = -4; px <= W + 8; px += 6) ctx.lineTo(px, sy(gy(px + cam.x)));
  ctx.lineTo(W + 8, H + 400); ctx.fill();
  ctx.strokeStyle = '#5ab04a'; ctx.lineWidth = 9; ctx.lineJoin = 'round'; ctx.beginPath();
  for (let px = -4; px <= W + 8; px += 6) { const y = sy(gy(px + cam.x)) + 3; px === -4 ? ctx.moveTo(px, y) : ctx.lineTo(px, y); } ctx.stroke();
  ctx.strokeStyle = 'rgba(0,0,0,.12)'; ctx.lineWidth = 2; for (let k = 1; k <= 3; k++) { ctx.beginPath(); for (let px = -4; px <= W + 8; px += 12) { const y = sy(gy(px + cam.x)) + 16 * k + Math.sin((px + cam.x) * 0.02 + k) * 3; px === -4 ? ctx.moveTo(px, y) : ctx.lineTo(px, y); } ctx.stroke(); }
  // 연료통 · 코인
  for (const it of G.T.items) {
    if (it.got || it.x < cam.x - 40 || it.x > cam.x + W + 40) continue;
    const x = sx(it.x), y = sy(it.y) + Math.sin(clock * 3 + it.x) * 2;
    if (it.k === 'fuel') { ctx.fillStyle = '#d83a3a'; ctx.fillRect(x - 11, y - 14, 22, 28); ctx.fillStyle = '#ffd23a'; ctx.fillRect(x - 11, y - 4, 22, 8); ctx.fillStyle = '#222'; ctx.fillRect(x - 4, y - 19, 8, 6); ctx.fillStyle = '#fff'; ctx.font = '800 9px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('FUEL', x, y + 3); }
    else { const w = Math.abs(Math.cos(clock * 4 + it.x * 0.05)); ctx.fillStyle = '#c98a00'; ctx.beginPath(); ctx.ellipse(x, y, 9 * (0.25 + 0.75 * w), 10, 0, 0, 7); ctx.fill(); ctx.fillStyle = '#ffe36a'; ctx.beginPath(); ctx.ellipse(x, y, 6.5 * (0.25 + 0.75 * w), 7.5, 0, 0, 7); ctx.fill(); }
  }
  for (const p of parts) { ctx.globalAlpha = Math.max(0, 1 - p.t / p.life); ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(sx(p.x), sy(p.y), p.r, 0, 7); ctx.fill(); }
  ctx.globalAlpha = 1;
  drawBike(b);
  ctx.textAlign = 'center'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.5)';
  for (const f of floats) { const k = f.t; ctx.globalAlpha = 1 - k; ctx.fillStyle = f.color; ctx.font = '900 14px sans-serif'; ctx.strokeText(f.text, sx(f.x), sy(f.y) - k * 28); ctx.fillText(f.text, sx(f.x), sy(f.y) - k * 28); ctx.globalAlpha = 1; }
  ctx.restore();
  drawHud();
}
function drawBike(b) {
  ctx.save(); ctx.translate(sx(b.x), sy(b.y)); ctx.rotate(b.th);
  const wheel = (x, y) => { ctx.save(); ctx.translate(x, y); ctx.fillStyle = '#222'; ctx.beginPath(); ctx.arc(0, 0, P.wheelR, 0, 7); ctx.fill(); ctx.rotate(wheelRot); ctx.strokeStyle = '#bbb'; ctx.lineWidth = 2; for (let i = 0; i < 3; i++) { ctx.rotate(Math.PI / 3); ctx.beginPath(); ctx.moveTo(-P.wheelR + 3, 0); ctx.lineTo(P.wheelR - 3, 0); ctx.stroke(); } ctx.fillStyle = '#ddd'; ctx.beginPath(); ctx.arc(0, 0, 3, 0, 7); ctx.fill(); ctx.restore(); };
  wheel(-P.a, P.hw); wheel(P.a, P.hw);
  ctx.strokeStyle = '#d83a3a'; ctx.lineWidth = 6; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(-P.a, P.hw); ctx.lineTo(-8, -4); ctx.lineTo(14, -4); ctx.lineTo(P.a, P.hw); ctx.stroke();      // 차체
  ctx.fillStyle = '#d83a3a'; ctx.fillRect(-12, -14, 22, 12);                                                                                 // 연료통
  ctx.fillStyle = '#333'; ctx.fillRect(-16, -9, 12, 5);                                                                                      // 안장
  ctx.strokeStyle = '#444'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(P.a - 2, P.hw - 2); ctx.lineTo(P.a - 8, -16); ctx.lineTo(P.a - 2, -18); ctx.stroke();                          // 핸들
  // 운전자
  ctx.strokeStyle = '#3a6ad8'; ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(-8, -10); ctx.lineTo(-5, -26); ctx.stroke();                     // 몸통
  ctx.beginPath(); ctx.moveTo(-6, -22); ctx.lineTo(P.a - 10, -17); ctx.stroke();                                                              // 팔
  ctx.beginPath(); ctx.moveTo(-8, -8); ctx.lineTo(6, 2); ctx.stroke();                                                                         // 다리
  ctx.fillStyle = '#f2c9a0'; ctx.beginPath(); ctx.arc(P.head[0], P.head[1], 7, 0, 7); ctx.fill();
  ctx.fillStyle = '#ffd23a'; ctx.beginPath(); ctx.arc(P.head[0], P.head[1] - 1, 8.5, Math.PI, 0); ctx.fill();                                  // 헬멧
  ctx.restore();
}
function drawHud() {
  ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(0, 0, W, 44);
  ctx.textAlign = 'left'; ctx.fillStyle = '#fff'; ctx.font = '900 20px sans-serif'; ctx.fillText(`${L.meters(G)}m`, 10, 28);
  ctx.font = '800 13px sans-serif'; ctx.fillStyle = '#ffe36a'; ctx.fillText(`🪙 ${G.coins}`, 100, 27);
  // 연료 게이지
  const fx = 150, fw = 100, f = G.tutorial ? 1 : G.fuel / 100;
  ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(fx - 1, 15, fw + 2, 14);
  ctx.fillStyle = f > 0.25 ? '#7be08a' : (Math.floor(clock * 4) % 2 ? '#ff4a4a' : '#ffb02e'); ctx.fillRect(fx, 16, fw * f, 12);
  ctx.font = '700 10px sans-serif'; ctx.fillStyle = '#fff'; ctx.fillText('⛽', fx - 16, 27);
  if (G.fuel <= 0 && !G.tutorial) { ctx.textAlign = 'center'; ctx.fillStyle = '#ff6a6a'; ctx.font = '900 16px sans-serif'; ctx.lineWidth = 4; ctx.strokeStyle = '#000'; ctx.strokeText('연료가 없어요! 굴러서 연료통으로!', W / 2, 90); ctx.fillText('연료가 없어요! 굴러서 연료통으로!', W / 2, 90); }
  else if (G.fuel < 25 && !G.tutorial && Math.floor(clock * 3) % 2) { ctx.textAlign = 'center'; ctx.fillStyle = '#ffb02e'; ctx.font = '900 14px sans-serif'; ctx.lineWidth = 4; ctx.strokeStyle = '#000'; ctx.strokeText('연료가 얼마 안 남았어요!', W / 2, 90); ctx.fillText('연료가 얼마 안 남았어요!', W / 2, 90); }
  if (state === 'play' && G.t < 4 && !tut) { ctx.textAlign = 'center'; ctx.fillStyle = `rgba(255,255,255,${0.6 + 0.4 * Math.sin(clock * 5)})`; ctx.font = '800 14px sans-serif'; ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.strokeText('가속 버튼을 누르고 있으세요!', W / 2, 140); ctx.fillText('가속 버튼을 누르고 있으세요!', W / 2, 140); }
}

let last = performance.now();
function frame(now) { const dt = Math.min(0.05, (now - last) / 1000); last = now; update(dt); draw(); requestAnimationFrame(frame); }
showTitle();
requestAnimationFrame(frame);
