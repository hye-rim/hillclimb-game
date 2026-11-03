'use strict';
// 힐 클라이밍: 규칙만 (DOM 없음). 화면·입력·소리는 game.js.
// 가속과 브레이크 두 버튼으로 울퉁불퉁한 언덕을 달리는 오토바이. 연료통과 코인을 모으고, 머리가 땅에 닿으면(뒤집히면) 끝.
// 차체는 바퀴 두 개를 용수철로 땅에 얹은 단단한 막대로 계산한다(바퀴가 땅을 누르는 힘과 구동력이 차체를 앞으로 밀고 기울임).
(function (root) {
  const P = {
    g: 900, wheelR: 12, a: 28, hw: 12,             // 중력, 바퀴 반지름, 바퀴 앞뒤 위치(±a), 바퀴 높이(무게중심 아래 hw)
    k: 420, c: 30,                                 // 바퀴 용수철 세기와 감쇠
    I: 1500,                                       // 회전 관성
    drive: 460, brake: 560, mu: 1.25, rolling: 0.35, vmax: 300,
    airTorque: 3800, angDamp: 1.6,
    head: [-4, -34], headMargin: 3,                // 머리(운전자) 위치와 여유
    step: 70,                                      // 지형 점 간격
  };
  const LEVELS = {
    easy: { label: '쉬움', fuel: 100, burn: 5, idle: 0.6, can: 55, canEvery: 1100, slope0: 0.2, slopeMax: 0.5, amp: 70 },
    normal: { label: '보통', fuel: 100, burn: 6, idle: 0.7, can: 50, canEvery: 1300, slope0: 0.25, slopeMax: 0.72, amp: 110 },
  };
  const rng = (seed) => { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // ---------- 지형 ----------
  // 점들 사이를 부드러운 곡선(Catmull-Rom)으로 이은 높이 함수. 끝없이 오른쪽으로 계속 만들어 감.
  function newTerrain(rand, level, tutorial) {
    const lv = LEVELS[level];
    const T = { rand, level: lv, ys: [0, 0, 0, 0], tutorial: !!tutorial, items: [], lastCan: 0, lastCoin: 300, slope: 0 };
    return T;
  }
  function slopeLimit(T, x) { const d = Math.max(0, x) / 6000; return Math.min(T.level.slopeMax, T.level.slope0 + d * (T.level.slopeMax - T.level.slope0)); }
  function extend(T, x) {
    const need = Math.ceil(x / P.step) + 4;
    while (T.ys.length < need) {
      const i = T.ys.length, px = i * P.step, lim = slopeLimit(T, px);
      let y = T.ys[i - 1], base = T.tutorial ? 0.9 : 1;
      // 기울기가 천천히 바뀌는 임의 걸음, 높이가 너무 벗어나면 되돌아옴
      T.slope = clamp(T.slope + (T.rand() - 0.5) * 0.7 * base, -lim, lim);
      if (T.tutorial && px < 420) T.slope = 0;                                   // 연습: 처음엔 평평
      const band = T.level.amp * (1 + Math.min(1.5, px / 5000));
      if (y > band) T.slope = Math.min(T.slope, -0.1); else if (y < -band) T.slope = Math.max(T.slope, 0.1);
      y += T.slope * P.step;
      T.ys.push(y);
    }
  }
  const catmull = (p0, p1, p2, p3, t) => 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
  const catmullD = (p0, p1, p2, p3, t) => 0.5 * ((-p0 + p2) + 2 * (2 * p0 - 5 * p1 + 4 * p2 - p3) * t + 3 * (-p0 + 3 * p1 - 3 * p2 + p3) * t * t);
  function groundAt(T, x) {
    if (x < 0) x = 0;
    extend(T, x + P.step * 3);
    const f = x / P.step, i = Math.floor(f), t = f - i, y = T.ys;
    const p0 = y[Math.max(0, i - 1)], p1 = y[i], p2 = y[i + 1], p3 = y[i + 2];
    return { y: catmull(p0, p1, p2, p3, t), d: catmullD(p0, p1, p2, p3, t) / P.step };
  }
  // 연료통과 코인을 지형 위 앞쪽에 미리 놓아 둠
  function populate(T, upTo) {
    while (T.lastCan < upTo || T.lastCoin < upTo) {
      if (T.lastCan <= T.lastCoin) {
        T.lastCan += T.level.canEvery * (0.8 + T.rand() * 0.4);
        const x = T.lastCan, g = groundAt(T, x); T.items.push({ k: 'fuel', x, y: g.y - 30, got: false });
      } else {
        T.lastCoin += 120 + T.rand() * 260;
        const n = 3 + Math.floor(T.rand() * 3), x0 = T.lastCoin;
        for (let i = 0; i < n; i++) { const x = x0 + i * 34, g = groundAt(T, x); T.items.push({ k: 'coin', x, y: g.y - 26 - Math.sin((i / Math.max(1, n - 1)) * Math.PI) * 18, got: false }); }
        T.lastCoin += n * 34;
      }
    }
  }

  // ---------- 게임 ----------
  function newGame(rand, opts = {}) {
    rand = rand || Math.random;
    const lv = LEVELS[opts.level] ? opts.level : 'normal';
    const T = newTerrain(rand, lv, !!opts.tutorial);
    extend(T, 400);
    const g0 = groundAt(T, 60);
    const st = { rand, level: lv, params: LEVELS[lv], T, tutorial: !!opts.tutorial, t: 0, over: false, why: null, events: [], input: { gas: false, brake: false },
      b: { x: 60, y: g0.y - P.wheelR - P.hw - 2, vx: 0, vy: 0, th: 0, om: 0 }, fuel: LEVELS[lv].fuel, maxX: 60, coins: 0, cans: 0, air: 0, maxAir: 0, flips: 0, still: 0, wasAir: false, spin: 0, crashes: 0, contact: [false, false] };
    populate(T, 900);
    return st;
  }
  function setInput(st, gas, brake) { st.input.gas = !!gas; st.input.brake = !!brake; }

  const rot = (th, x, y) => [x * Math.cos(th) - y * Math.sin(th), x * Math.sin(th) + y * Math.cos(th)];
  function sub1(st, h) {
    const b = st.b, T = st.T, inp = st.input, gas = inp.gas && st.fuel > 0, brake = inp.brake;
    let fx = 0, fy = P.g, tau = 0, contacts = 0;
    const wheels = [[-P.a, P.hw], [P.a, P.hw]];
    for (let w = 0; w < 2; w++) {
      const [rx, ry] = rot(b.th, wheels[w][0], wheels[w][1]);
      const wx = b.x + rx, wy = b.y + ry;
      const gr = groundAt(T, wx), cs = 1 / Math.sqrt(1 + gr.d * gr.d);
      const s = gr.y - wy, pen = P.wheelR - s * cs;                    // 땅과 바퀴 중심 사이(수직 거리)와 눌린 깊이
      st.contact[w] = pen > 0;
      if (pen <= 0) continue;
      contacts++;
      const nx = gr.d * cs, ny = -cs, tx = cs, ty = gr.d * cs;          // 위쪽 법선, 접선
      const vwx = b.vx - b.om * ry, vwy = b.vy + b.om * rx;             // 바퀴 닿은 점의 속도
      const vn = vwx * nx + vwy * ny, vt = vwx * tx + vwy * ty;
      const Fn = Math.max(0, P.k * pen - P.c * vn);
      let Ft = -P.rolling * vt * 0.2;                                   // 굴러가는 저항
      if (gas && w === 0) Ft += P.drive * (vt < P.vmax ? 1 : 0);        // 뒷바퀴 구동
      if (brake) { Ft += vt > 8 ? -P.brake : (gas || vt < -70 ? 0 : -P.drive * 0.35); }   // 브레이크(거의 멈추면 천천히 뒤로, 뒤로 가는 속도에는 한도)
      const lim = P.mu * Fn; Ft = clamp(Ft, -lim, lim);
      const Fx = Fn * nx + Ft * tx, Fy = Fn * ny + Ft * ty;
      fx += Fx; fy += Fy; tau += rx * Fy - ry * Fx;
    }
    // 공중 조종: 가속은 앞을 들고(반시계), 브레이크는 앞을 숙임
    if (contacts === 0) { tau += (inp.brake ? 1 : 0) * P.airTorque - (gas ? 1 : 0) * P.airTorque; }
    tau -= b.om * P.angDamp * 40;
    b.vx += fx * h; b.vy += fy * h; b.om += (tau / P.I) * h;
    b.x += b.vx * h; b.y += b.vy * h; b.th += b.om * h;
    st.air = contacts === 0 ? st.air + h : 0;
    st.contact = st.contact.slice();
    // 머리가 땅에 닿으면 넘어짐
    const [hx, hy] = rot(b.th, P.head[0], P.head[1]), g = groundAt(T, b.x + hx);
    if (b.y + hy > g.y - P.headMargin) return crash(st, 'head');
    return null;
  }
  function crash(st, why) {
    st.crashes++;
    if (st.tutorial) { respawn(st); st.events.push({ type: 'respawn' }); return null; }
    st.over = true; st.why = why; st.events.push({ type: 'crash', why }); return why;
  }
  function respawn(st) {
    const b = st.b, g = groundAt(st.T, b.x);
    b.y = g.y - P.wheelR - P.hw - 6; b.th = Math.atan(g.d); b.vx = Math.max(0, b.vx * 0.3); b.vy = 0; b.om = 0;
  }

  function step(st, dt) {
    if (st.over) return;
    const n = Math.max(1, Math.ceil(dt / (1 / 240))), h = dt / n;
    for (let i = 0; i < n && !st.over; i++) {
      const wasAir = st.air > 0;
      if (sub1(st, h)) break;
      if (wasAir && st.air === 0) { st.events.push({ type: 'land', air: st.lastAir }); }
      if (st.air > 0) st.lastAir = st.air;
      if (st.air === 0 && wasAir && st.lastAir > 0.35) st.events.push({ type: 'safeland', air: st.lastAir });
      if (st.air > st.maxAir) st.maxAir = st.air;
    }
    if (st.over) return;
    st.t += dt;
    const b = st.b;
    if (b.x > st.maxX) st.maxX = b.x;
    // 연료
    if (!st.tutorial) { const burn = st.input.gas && st.fuel > 0 ? st.params.burn : st.params.idle; st.fuel = Math.max(0, st.fuel - burn * dt); }
    if (st.fuel === 0 && !st.tutorial) {
      st.still = Math.hypot(b.vx, b.vy) < 18 ? st.still + dt : 0;
      if (!st.fuelEmptyShown) { st.fuelEmptyShown = true; st.events.push({ type: 'empty' }); }
      if (st.still > 1.5) { st.over = true; st.why = 'fuel'; st.events.push({ type: 'crash', why: 'fuel' }); }
    }
    // 연료통 · 코인 먹기
    populate(st.T, b.x + 1200);
    for (const it of st.T.items) {
      if (it.got || Math.abs(it.x - b.x) > 40) continue;
      if (Math.hypot(it.x - b.x, it.y - b.y) < (it.k === 'fuel' ? 34 : 28)) {
        it.got = true;
        if (it.k === 'fuel') { st.fuel = Math.min(100, st.fuel + st.params.can); st.cans++; st.fuelEmptyShown = false; st.events.push({ type: 'fuel', x: it.x, y: it.y }); }
        else { st.coins++; st.events.push({ type: 'coin', x: it.x, y: it.y }); }
      }
    }
    if (st.T.items.length > 400) st.T.items = st.T.items.filter((it) => it.x > b.x - 800);
  }

  const meters = (st) => Math.max(0, Math.floor((st.maxX - 60) / 10));
  const scoreOf = (st) => meters(st) + st.coins * 5;

  const api = { P, LEVELS, rng, clamp, newTerrain, extend, groundAt, populate, newGame, setInput, step, meters, scoreOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.LOGIC_HILL = api;
})(typeof window !== 'undefined' ? window : globalThis);
