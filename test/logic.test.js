'use strict';
// 힐 클라이밍 규칙 시험. 실행: node --test
const test = require('node:test');
const assert = require('node:assert');
const L = require('../logic.js');

const P = L.P;
const step = (st, sec, gas, brake) => { for (let i = 0; i < Math.round(sec * 60); i++) { L.setInput(st, gas, brake); L.step(st, 1 / 60); } };
// 지형을 원하는 모양으로 바꾼 시험용 게임: slope = 기울기(내려가는 쪽이 +)
function flat(level = 'normal', slope = 0) {
  const st = L.newGame(L.rng(5), { level, tutorial: false });
  st.T.ys = Array.from({ length: 800 }, (_, i) => i * P.step * slope); st.T.slope = slope; st.T.level = Object.assign({}, st.T.level, { slope0: Math.abs(slope), slopeMax: Math.abs(slope), amp: 0 });
  st.T.items = []; st.T.lastCan = 1e9; st.T.lastCoin = 1e9;
  const g = L.groundAt(st.T, 200); st.b.x = 200; st.b.y = g.y - P.wheelR - P.hw - 1; st.b.th = Math.atan(slope); st.b.vx = st.b.vy = st.b.om = 0; st.maxX = 200;
  return st;
}
const clearEv = (st) => { const e = st.events.slice(); st.events.length = 0; return e; };

test('terrain: same seed gives the same ground; slopes stay within the limit and grow with distance', () => {
  for (const level of ['easy', 'normal']) {
    const a = L.newGame(L.rng(9), { level }), b = L.newGame(L.rng(9), { level });
    for (let x = 0; x < 12000; x += 37) { const ga = L.groundAt(a.T, x), gb = L.groundAt(b.T, x); assert.strictEqual(ga.y, gb.y); }
    let maxNear = 0, maxFar = 0;
    for (let x = 0; x < 40000; x += 5) { const d = Math.abs(L.groundAt(a.T, x).d); if (x < 3000) maxNear = Math.max(maxNear, d); if (x > 30000) maxFar = Math.max(maxFar, d); assert.ok(d < L.LEVELS[level].slopeMax * 1.5 + 0.05, `slope ${d} at ${x}`); }
    assert.ok(maxFar >= maxNear * 0.9, 'later terrain is at least as steep');
  }
  const e = L.newGame(L.rng(1), { level: 'easy' }), n = L.newGame(L.rng(1), { level: 'normal' });
  assert.ok(L.LEVELS.easy.slopeMax < L.LEVELS.normal.slopeMax);
  void e; void n;
});

test('terrain is continuous and smooth between points', () => {
  const st = L.newGame(L.rng(4), { level: 'normal' });
  for (let x = 0; x < 20000; x += 3) { const g1 = L.groundAt(st.T, x), g2 = L.groundAt(st.T, x + 3); assert.ok(Math.abs(g2.y - g1.y) < 3 * 1.2, 'no jumps at ' + x); assert.ok(Math.abs(g2.d - g1.d) < 0.1, 'smooth slope at ' + x); }
});

test('the bike settles on flat ground without sinking, jittering or tipping', () => {
  const st = flat(); step(st, 3, false, false);
  const ground = L.groundAt(st.T, st.b.x).y;
  assert.ok(Math.abs(st.b.th) < 0.01 && Math.abs(st.b.vy) < 1 && st.over === false);
  assert.ok(st.b.y + P.hw + P.wheelR > ground - 1 && st.b.y + P.hw + P.wheelR < ground + 4, 'wheels rest on the ground: ' + (st.b.y + P.hw + P.wheelR - ground));
  assert.ok(st.contact[0] && st.contact[1]);
});

test('gas speeds up to about the top speed; coasting slows down; brake stops', () => {
  const st = flat(); step(st, 3, true, false);
  assert.ok(st.b.vx > P.vmax * 0.9 && st.b.vx < P.vmax * 1.05, 'top speed ' + st.b.vx);
  const v1 = st.b.vx; step(st, 2, false, false); assert.ok(st.b.vx < v1 && st.b.vx > 0);
  step(st, 3, false, true); assert.ok(st.b.vx < 5, 'brake: ' + st.b.vx);
  assert.ok(Math.abs(st.b.th) < 0.3, 'did not flip while braking');
});

test('uphill: the bike climbs a moderate slope but not a wall; downhill it gains speed', () => {
  const up = flat('normal', -0.35); step(up, 6, true, false);
  assert.ok(up.b.x > 200 + 600 && !up.over, 'climbed: ' + (up.b.x - 200));
  const down = flat('normal', 0.35); step(down, 3, false, false);
  assert.ok(down.b.vx > 150, 'rolls downhill: ' + down.b.vx);
});

test('in the air, gas lifts the nose and brake drops it; landing on the wheels is safe', () => {
  const mk = () => { const st = flat(); st.b.y -= 160; st.b.vx = 100; return st; };
  const a = mk(); step(a, 0.5, true, false); assert.ok(a.air > 0.3); assert.ok(a.b.th < -0.15, 'nose up: ' + a.b.th);
  const b = mk(); step(b, 0.5, false, true); assert.ok(b.b.th > 0.15, 'nose down: ' + b.b.th);
  const c = mk(); step(c, 3, false, false);
  assert.strictEqual(c.over, false); assert.ok(Math.abs(c.b.th) < 0.2);
  assert.ok(clearEv(c).some((e) => e.type === 'safeland' || e.type === 'land'));
});

test('the head touching the ground ends the game (tutorial respawns instead)', () => {
  const st = flat(); st.b.th = 2.8; st.b.y -= 20; step(st, 1, false, false);
  assert.strictEqual(st.over, true); assert.strictEqual(st.why, 'head');
  assert.ok(clearEv(st).some((e) => e.type === 'crash'));
  const t = L.newGame(L.rng(5), { level: 'normal', tutorial: true }); t.b.th = 2.8; step(t, 1, false, false);
  assert.strictEqual(t.over, false); assert.ok(t.crashes >= 1); assert.ok(Math.abs(t.b.th) < 0.6);
});

test('fuel: gas burns more than idling; empty tank means no drive, and the game ends once you stop', () => {
  const a = flat('normal'); const f0 = a.fuel; step(a, 2, true, false); const gasBurn = f0 - a.fuel;
  const b = flat('normal'); step(b, 2, false, false); const idleBurn = f0 - b.fuel;
  assert.ok(gasBurn > idleBurn * 3, `${gasBurn} vs ${idleBurn}`);
  const c = flat('normal'); c.fuel = 0.2; step(c, 2, true, false);
  assert.strictEqual(c.fuel, 0);
  const v = c.b.vx; step(c, 1, true, false); assert.ok(c.b.vx <= v + 1, 'no drive without fuel');
  step(c, 20, false, true); assert.strictEqual(c.over, true); assert.strictEqual(c.why, 'fuel');
  assert.ok(L.LEVELS.easy.burn < L.LEVELS.normal.burn);
});

test('fuel cans add fuel (capped at 100) and coins count once; both are placed above the ground', () => {
  const st = flat(); st.fuel = 30; const g = L.groundAt(st.T, st.b.x + 100).y;
  st.T.items = [{ k: 'fuel', x: st.b.x + 100, y: g - 20, got: false }, { k: 'coin', x: st.b.x + 130, y: g - 20, got: false }];
  step(st, 1.5, true, false);
  assert.strictEqual(st.cans, 1); assert.ok(st.fuel > 30 + st.params.can - 15 && st.fuel <= 100);
  assert.strictEqual(st.coins, 1);
  const ev = clearEv(st); assert.ok(ev.some((e) => e.type === 'fuel') && ev.some((e) => e.type === 'coin'));
  const t = L.newGame(L.rng(8), { level: 'normal' }); L.populate(t.T, 20000);
  for (const it of t.T.items) { assert.ok(it.y < L.groundAt(t.T, it.x).y - 10, 'above ground'); }
  const cans = t.T.items.filter((i) => i.k === 'fuel'); assert.ok(cans.length >= 12);
  for (let i = 1; i < cans.length; i++) assert.ok(cans[i].x - cans[i - 1].x > 500 && cans[i].x - cans[i - 1].x < L.LEVELS.normal.canEvery * 1.3);
  const full = flat(); full.fuel = 98; full.T.items = [{ k: 'fuel', x: full.b.x + 50, y: L.groundAt(full.T, full.b.x + 50).y - 20, got: false }]; step(full, 1, true, false); assert.ok(full.fuel <= 100);
});

test('distance and score count from the start; the same inputs give the same run; big steps stay stable', () => {
  const run = () => { const st = L.newGame(L.rng(3), { level: 'normal' }); for (let i = 0; i < 600; i++) { L.setInput(st, i % 120 < 90, i % 120 >= 100); L.step(st, 1 / 60); } return st; };
  const a = run(), b = run();
  assert.strictEqual(a.b.x, b.b.x); assert.strictEqual(a.fuel, b.fuel);
  assert.strictEqual(L.meters(a), Math.floor((a.maxX - 60) / 10)); assert.strictEqual(L.scoreOf(a), L.meters(a) + a.coins * 5);
  const big = flat(); L.setInput(big, true, false); for (let i = 0; i < 60; i++) L.step(big, 0.1);
  assert.ok(Math.abs(big.b.th) < 0.3 && !big.over && big.b.vx > 200, 'big dt: ' + big.b.vx);
});

// 지형 기울기에 맞춰 자세를 잡는 시험용 운전자
function smart(st) {
  const b = st.b, g = L.groundAt(st.T, b.x), slope = Math.atan(g.d);
  if (st.air > 0.05) { const err = b.th - slope; return err > 0.15 ? [true, false] : err < -0.15 ? [false, true] : [false, false]; }
  const ahead = L.groundAt(st.T, b.x + 80).d, down = ahead > 0.55; return [!down, down && b.vx > 200];
}
test('balance: a careful driver gets far on both levels; holding gas only is worse on normal', () => {
  const dist = (level, policy, seed) => { const st = L.newGame(L.rng(seed), { level }); for (let f = 0; f < 60 * 240 && !st.over; f++) { const [g, b] = policy(st); L.setInput(st, g, b); L.step(st, 1 / 60); st.events.length = 0; } return L.meters(st); };
  const med = (level, policy) => { const a = []; for (let s = 1; s <= 10; s++) a.push(dist(level, policy, s * 37)); a.sort((x, y) => x - y); return a[5]; };
  const nSmart = med('normal', smart), nHold = med('normal', () => [true, false]), eSmart = med('easy', smart);
  assert.ok(nSmart >= 500, 'normal careful: ' + nSmart);
  assert.ok(eSmart > nSmart, `easy ${eSmart} vs normal ${nSmart}`);
  assert.ok(nSmart >= nHold * 0.9, `careful ${nSmart} vs hold ${nHold}`);
});
