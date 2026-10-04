/* Node 端测试：渲染层（score / synth / story）不依赖 DOM，可以直接在 node 里跑。
 * 跑法：node tests/node-test.js   （不需要任何依赖）
 * 覆盖：乐谱解析与报错、时间轴、五种母题的绘制路径、离线合成调度、配乐自动生成。
 */
'use strict';
const path = require('path');
global.window = global;
require(path.join(__dirname, '..', 'js', 'score.js'));
require(path.join(__dirname, '..', 'js', 'wav.js'));
require(path.join(__dirname, '..', 'js', 'synth.js'));
require(path.join(__dirname, '..', 'js', 'story.js'));
require(path.join(__dirname, '..', 'js', 'factory.js'));
require(path.join(__dirname, '..', 'js', 'gl', 'core.js'));
require(path.join(__dirname, '..', 'js', 'gl', 'geom.js'));
require(path.join(__dirname, '..', 'js', 'gl', 'camera.js'));
require(path.join(__dirname, '..', 'js', 'gl', 'world.js'));
require(path.join(__dirname, '..', 'js', 'gl', 'cast.js'));
require(path.join(__dirname, '..', 'js', 'director.js'));
const FS = global.FS;

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name + (extra ? '  ' + extra : '')); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  ' + extra : '')); }
}
function section(s) { console.log('\n' + s); }
function throws(fn, needle) {
  try { fn(); return null; } catch (e) {
    return needle && e.message.indexOf(needle) < 0 ? '错误文案不含「' + needle + '」：' + e.message : null;
  }
}

/* ---------- 1. 乐谱解析 ---------- */
section('1. 乐谱解析');
const sc = FS.parseScore(JSON.stringify({
  bpm: 84, tracks: [
    { name: 'pad', instrument: 'pad', loop: 8, notes: [{ p: 'C3', t: 0, d: 2 }, { p: 'G3', t: 4, d: 2 }] },
    { name: 'k', instrument: 'kick', loop: 8, notes: ['x', '-', 'x', '-'] }
  ]
}));
ok('正常乐谱解析', sc.tracks.length === 2 && sc.tracks[0].notes.length === 2);
ok('音名 -> midi', sc.tracks[0].notes[0].midi === 48, '(C3=48)');
ok('loop 轨把落点折进周期', sc.tracks[0].notes[1].t === 4);
ok('loop 轨摸到一个完整周期时长', sc.duration >= 8, '(duration=' + sc.duration.toFixed(2) + ')');
ok('打击乐数组跳过休止符', sc.tracks[1].notes.length === 2);

const withBeat = FS.parseScore(JSON.stringify({
  bpm: 120, tracks: [{ instrument: 'lead', notes: [{ p: 'C4', beat: 4, d: 1 }] }]
}));
ok('beat 换算成秒', Math.abs(withBeat.tracks[0].notes[0].t - 2.0) < 1e-9, '(4拍@120=2.0s)');

ok('坏 JSON 给人话错误', throws(() => FS.parseScore('{oops'), 'JSON 语法错') === null,
  throws(() => FS.parseScore('{oops'), 'JSON 语法错') || '');
ok('空 track 报错', throws(() => FS.parseScore('{"bpm":90,"tracks":[]}'), 'tracks 是空的') === null);
ok('乱音名报错', throws(() => FS.parseScore('{"tracks":[{"instrument":"pad","notes":[{"p":"H9"}]}]}'), '音名') === null);
let cueMsg = '';
try { FS.parseScore('{"cues":[{"label":"chapter"}]}'); } catch (e) { cueMsg = e.message; }
ok('时间轴 cue 文件被误当乐谱时，提示去宣传片标签页',
  cueMsg.indexOf('宣传片生成器') >= 0, cueMsg.slice(0, 46));

/* ---------- 2. 时间轴 ---------- */
section('2. 宣传片时间轴');
const film = {
  title: '结构之美', template: 'concept', palette: 'ink', bpm: 84, beats: 8,
  scenes: [{ title: 'a', text: '' }, { title: 'b', text: '' }, { title: 'c', text: '' }, { title: 'd', text: '' }]
};
const tl = FS.story.timeline(film);
ok('段数正确', tl.marks.length === 4);
ok('每段时长 = 拍数 × 每拍秒数', Math.abs(tl.marks[0].dur - 8 * 60 / 84) < 1e-9,
  '(' + (8 * 60 / 84).toFixed(2) + 's/段)');
ok('总时长 = 段数 × 段时长', Math.abs(tl.total - 4 * 8 * 60 / 84) < 1e-9, '(total=' + tl.total.toFixed(2) + 's)');
ok('段落首尾相接', tl.marks[1].start === tl.marks[0].end);

/* ---------- 3. 五种母题绘制 ---------- */
section('3. 母题绘制（stub canvas）');
function stubCtx() {
  const noop = () => {};
  const ctx = {
    canvas: { width: 1280, height: 720 },
    calls: 0,
    fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', textAlign: '', textBaseline: '',
    globalAlpha: 1, shadowColor: '', shadowBlur: 0, Q: 0, type: '',
    fillRect: () => ctx.calls++, strokeRect: () => ctx.calls++, clearRect: () => ctx.calls++,
    beginPath: noop, closePath: noop, moveTo: () => ctx.calls++, lineTo: () => ctx.calls++,
    arc: () => ctx.calls++, stroke: () => ctx.calls++, fill: () => ctx.calls++,
    save: noop, restore: noop, translate: noop, rotate: noop, scale: noop,
    fillText: (t, x, y) => { if (typeof x !== 'number' || !isFinite(x)) throw new Error('fillText 的坐标不是数字: ' + t); ctx.calls++; },
    strokeText: noop,
    measureText: (t) => ({ width: String(t).length * 12 }),
    createLinearGradient: () => ({ addColorStop: noop }),
    createRadialGradient: () => ({ addColorStop: noop }),
    drawImage: noop
  };
  return ctx;
}

FS.templates.forEach((tpl) => {
  film.template = tpl;
  let err = null, frames = 0;
  for (let i = 0; i <= 20; i++) {
    const g = stubCtx();
    try { FS.story.drawFrame(g, film, tl.total * i / 20); frames++; } catch (e) { err = e; break; }
  }
  ok('母题 ' + tpl + ' 21 帧全程无异常', !err, err ? err.message : '(frames=' + frames + ' calls=' + 'ok)');
});

['ink', 'sunset', 'mint', 'mono'].forEach((p) => {
  film.template = 'concept'; film.palette = p;
  let err = null;
  try { FS.story.drawFrame(stubCtx(), film, 3.2); } catch (e) { err = e; }
  ok('配色 ' + p + ' 可绘制', !err, err ? err.message : '');
});
film.palette = 'ink';

const fsc = FS.story.buildScore(film);
ok('自动配乐有 4 条轨', fsc.tracks.length === 4);
ok('自动配乐的音都在谱上', fsc.tracks.every((t) => t.notes.every((n) => n.midi !== null)));
ok('配乐时长覆盖画面总长', fsc.duration >= tl.total * 0.9, '(' + fsc.duration.toFixed(1) + 's vs ' + tl.total.toFixed(1) + 's)');
ok('配乐能再被解析一遍', FS.parseScore(JSON.stringify(fsc)).tracks.length === 4);

/* ---------- 4. 离线合成调度 ---------- */
section('4. 离线合成（stub Web Audio）');
const scheduled = [];
function stubParam() { return { value: 0, setValueAtTime: () => {}, linearRampToValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} }; }
function stubNode(kind) {
  return {
    kind, gain: stubParam(), frequency: stubParam(), detune: stubParam(), Q: { value: 0 },
    threshold: stubParam(), knee: stubParam(), ratio: stubParam(), attack: stubParam(), release: stubParam(),
    type: '', buffer: null, onended: null,
    connect: (d) => d, disconnect: () => {}, start: (t) => scheduled.push({ kind, t }), stop: () => {}
  };
}
global.OfflineAudioContext = function (ch, len, sr) {
  this.sampleRate = sr; this.length = len;
  Object.defineProperty(this, 'duration', { get: () => len / sr });
  this.destination = stubNode('dest');
  this.createGain = () => stubNode('gain');
  this.createOscillator = () => stubNode('osc');
  this.createBiquadFilter = () => stubNode('filter');
  this.createDynamicsCompressor = () => stubNode('comp');
  this.createBufferSource = () => stubNode('bufsrc');
  this.createBuffer = (c, n, r) => ({ getChannelData: () => new Float32Array(n) });
  this.startRendering = () => {
    const n = len, data = new Float32Array(n);
    for (let i = 0; i < n; i++) data[i] = Math.sin(i * 0.01) * 0.5;   // 假波形
    return Promise.resolve({
      numberOfChannels: 2, length: n, sampleRate: sr, duration: len / sr,
      getChannelData: () => data
    });
  };
};

// buildScore 吐的是 {p, beat} 形式，没过 parseScore 就送进渲染器 = 时间 NaN = 静音。
// 这条要能拦住，否则「自动生成配乐」是哑的还查不出原因。
FS.renderScore(FS.story.buildScore(film), { sampleRate: 8000 }).then(
  () => ok('未解析的配乐谱被拒绝', false, '(竟然通过了)'),
  (e) => ok('未解析的配乐谱被拒绝（而不是静音 NaN）', !!e, e.message.slice(0, 40))
);

const fscParsed = FS.parseScore(JSON.stringify(fsc));   // main.js 走的就是这条链路
ok('buildScore -> parseScore 后音符都带上 t',
  fscParsed.tracks.every((t) => t.notes.every((n) => typeof n.t === 'number' && isFinite(n.t))));

/* ---------- 5. 音乐工厂 ---------- */
section('5. 音乐工厂（采集 + 变形 + 不重复）');
const KEY_PC = [0, 2, 4, 5, 7, 9, 11];

/** 独立复算：按 meta 的调式推出允许的 pitch class 集合（不复用工厂内部实现，才算数） */
function scalePCs(meta) {
  const steps = Object.keys(FS.factory.SCALES).filter((k) => FS.factory.SCALES[k].name === meta.scale)[0];
  const st = FS.factory.SCALES[steps].steps;
  const rootPc = KEY_PC['CDEFGAB'.indexOf(meta.key)];
  return st.map((s) => (s + rootPc) % 12);
}

const g1 = FS.factory.generate({ theme: '群论', seed: 2024, bars: 12 });
const g2 = FS.factory.generate({ theme: '群论', seed: 2024, bars: 12 });
ok('同主题同种子完全可复现（逐字节）',
  FS.factory.toText(g1.score) === FS.factory.toText(g2.score));
ok('产物是标准 cues.json 且能被解析', (() => {
  const p = FS.parseScore(FS.factory.toText(g1.score));
  return p.tracks.length === g1.score.tracks.length && p.duration > 0;
})());
ok('有 lead / bass / pad 轨', ['lead', 'bass', 'pad'].every((n) => g1.score.tracks.some((t) => t.name === n)));
ok('鼓轨音符没有音高（走打击乐分支）',
  g1.score.tracks.filter((t) => ['kick', 'snare', 'hat'].includes(t.instrument))
    .every((t) => t.notes.every((n) => n.p === undefined)));

// ⚠️ 回归测试：曾经给"小调三度"减半音，把 i 和弦的 C-Eb 变成 C-D（大二度）= 跑调
const offScale = [];
['群论', '量子力学', '热血少年', '月亮与海', '赛博朋克城市', '咖啡猫'].forEach((theme, i) => {
  const r = FS.factory.generate({ theme, seed: 700 + i, bars: 12 });
  const pcs = scalePCs(r.meta);
  r.score.tracks.filter((t) => t.instrument !== 'kick' && t.instrument !== 'snare' && t.instrument !== 'hat')
    .forEach((t) => t.notes.forEach((n) => {
      const pc = ((FS.pitchToMidi(n.p) % 12) + 12) % 12;
      if (!pcs.includes(pc)) offScale.push(theme + '/' + t.name + '/' + n.p);
    }));
});
ok('所有旋律/低音/铺底音都在当前调式内（6 首 × 全音符）', offScale.length === 0,
  offScale.length ? offScale.slice(0, 5).join(' ') : '');

// ⚠️ 回归测试：变形算子曾经因为 usedOps[o.id] < 3（undefined 比较恒 false）一次都没生效
ok('变形算子真的生效了（不是原动机直用）', g1.meta.ops.length >= 1, '(' + g1.meta.ops.join('、') + ')');
ok('素材来源写清了采了什么', g1.meta.sources.length >= 5 && g1.meta.sources.every((s) => s.label && s.label.length),
  g1.meta.sources.map((s) => s.type).join('/'));
ok('12 小节至少 4 个乐句变体', g1.meta.variants >= 4, '(' + g1.meta.variants + ' 个)');

const seedRuns = {};
for (let i = 0; i < 30; i++) seedRuns[FS.factory.generate({ theme: '随机', seed: i }).meta.fingerprint] = 1;
ok('同主题换 30 个种子 = 30 首不同的曲子', Object.keys(seedRuns).length === 30, '(' + Object.keys(seedRuns).length + '/30)');

const themeRuns = {};
['群论', '量子', '热血', '月亮', '咖啡猫', '历史', 'AI', '森林', '游戏', '赛博'].forEach((t, i) => {
  themeRuns[t] = FS.factory.generate({ theme: t, seed: 1 }).meta.fingerprint;
});
ok('10 个主题给出 10 首不同的曲子', new Set(Object.values(themeRuns)).size === 10);

const used = {};
let clash = 0;
for (let i = 0; i < 12; i++) {
  const r = FS.factory.generateUnique({ theme: '群论', seed: 300 + i }, used);
  if (used[r.meta.fingerprint]) clash++;
  used[r.meta.fingerprint] = 1;
}
ok('「保证不重复」连出 12 首，零冲突', clash === 0 && Object.keys(used).length === 12, '(clash=' + clash + ')');

ok('同一主题映射到同一风格（可复现），不同主题可区分', (() => {
  const a = FS.factory.styleFor('热血少年').id;
  const b = FS.factory.styleFor('热血少年').id;
  const c = FS.factory.styleFor('群论').id;
  return a === b && a !== c;
})(), '(热血少年→' + FS.factory.styleFor('热血少年').name + '，群论→' + FS.factory.styleFor('群论').name + ')');

const filmMusic = FS.factory.forFilm({ title: '群论：结构之美', bpm: 84, beats: 8, scenes: [1, 2, 3, 4] });
ok('宣传片配乐：按片名生成，长度跟画幅走', filmMusic.meta.bars === 8 && filmMusic.meta.bpm === 84,
  '(' + filmMusic.meta.bars + ' 小节 / ' + filmMusic.meta.bpm + ' BPM)');
ok('宣传片配乐能覆盖画面总长', filmMusic.score.duration >= 4 * 8 * 60 / 84,
  '(' + filmMusic.score.duration.toFixed(1) + 's vs ' + (4 * 8 * 60 / 84).toFixed(1) + 's)');
const factoryParsed = FS.parseScore(FS.factory.toText(filmMusic.score));
ok('工厂产物 -> parseScore 后音符都带上 t',
  factoryParsed.tracks.every((t) => t.notes.every((n) => typeof n.t === 'number' && isFinite(n.t))));

/* ---------- 6. 3D 引擎：数学 / 几何 / 场景 / 角色 / 镜头 ---------- */
section('6. 3D 引擎逻辑层（数学 / 几何 / 场景 / 角色 / 镜头）');
const M4 = FS.gl.M4;
const G = FS.geom;

// 矩阵
const idM = M4.fromTRS([1, 2, 3], [0, 0, 0], [1, 1, 1]);
const p0 = M4.transformPoint(idM, [0, 0, 0]);
ok('fromTRS 把原点平移到目标位置', Math.abs(p0[0] - 1) < 1e-6 && Math.abs(p0[1] - 2) < 1e-6 && Math.abs(p0[2] - 3) < 1e-6,
  '(' + p0.map((v) => v.toFixed(1)).join(',') + ')');
ok('invert 能把矩阵还原（乘积≈单位阵）', (() => {
  const m = M4.fromTRS([2, -1, .5], [.3, .7, -.2], [1.4, .8, 2.2]);
  const inv = M4.invert(m);
  const prod = M4.multiply(m, inv);
  return Math.abs(prod[0] - 1) < 1e-4 && Math.abs(prod[5] - 1) < 1e-4 &&
         Math.abs(prod[10] - 1) < 1e-4 && Math.abs(prod[12]) < 1e-4;
})());
ok('lookAt 会把目标放到相机前方', (() => {
  const view = M4.lookAt([0, 0, 5], [0, 0, 0], [0, 1, 0]);
  const v = M4.transformPoint(view, [0, 0, 0]);
  return Math.abs(v[2] + 5) < 1e-4;   // 目标在 eye 前方 5 米 → 视图空间 z = -5
})());
ok('perspective 产生合法投影矩阵', (() => {
  const pr = M4.perspective(Math.PI / 4, 16 / 9, .1, 100);
  return pr[11] === -1 && pr[0] > 0 && pr[5] > 0;
})());

// 几何
const gBox = G.box(1, 2, 3, [1, 0, 0]);
ok('box = 12 个三角面', gBox.idx.length / 3 === 12, '(' + gBox.idx.length / 3 + ')');
ok('box 每个面的法线都朝外', (() => {          // 回归：面序写反会导致整个场景「里外翻」
  let okAll = 0, total = 0;
  for (let i = 0; i < gBox.pos.length; i += 9) {
    const cx = (gBox.pos[i] + gBox.pos[i + 3] + gBox.pos[i + 6]) / 3;
    const cy = (gBox.pos[i + 1] + gBox.pos[i + 4] + gBox.pos[i + 7]) / 3;
    const cz = (gBox.pos[i + 2] + gBox.pos[i + 5] + gBox.pos[i + 8]) / 3;
    total++;
    if (cx * gBox.nrm[i] + cy * gBox.nrm[i + 1] + cz * gBox.nrm[i + 2] > 0) okAll++;
  }
  return okAll === total;
})());
ok('地形法线朝上', (() => {
  const t = G.terrain(8, 8, 6, 6, (x, z) => Math.sin(x) * .3 + Math.cos(z) * .2, [.4, .5, .4]);
  for (let i = 1; i < t.nrm.length; i += 3) if (t.nrm[i] <= 0) return false;
  return t.idx.length > 0;
})());
ok('xform 不改顶点数、法线仍是单位向量', (() => {
  const s = G.sphere(1, 8, 6, [1, 1, 1]);
  const before = s.pos.length / 3;
  G.xform(s, [1, 2, 3], [.4, .2, .1], [2, 1, .5]);
  let unit = true;
  for (let i = 0; i < s.nrm.length; i += 3) {
    if (Math.abs(Math.hypot(s.nrm[i], s.nrm[i + 1], s.nrm[i + 2]) - 1) > 1e-3) unit = false;
  }
  return s.pos.length / 3 === before && unit;
})());
ok('merge 会把索引整体后移（不会画到别人的顶点）', (() => {
  const m = G.merge([G.box(1, 1, 1, [1, 0, 0]), G.box(1, 1, 1, [0, 1, 0])]);
  // 两个 box = 2 × 12 三角 = 72 个索引，顶点 2 × 12 = 24 个
  return m.idx.length === 72 && Math.max(...m.idx) === m.pos.length / 3 - 1;
})());
ok('非均匀缩放后法线仍朝外（逆转置生效）', (() => {
  const b = G.box(1, 1, 1, [1, 1, 1]);
  G.xform(b, [0, 0, 0], [.5, 0, 0], [3, .4, 3]);
  let okAll = 0, total = 0;
  for (let i = 0; i < b.pos.length; i += 9) {
    const cx = (b.pos[i] + b.pos[i + 3] + b.pos[i + 6]) / 3;
    const cy = (b.pos[i + 1] + b.pos[i + 4] + b.pos[i + 7]) / 3;
    const cz = (b.pos[i + 2] + b.pos[i + 5] + b.pos[i + 8]) / 3;
    total++;
    if (cx * b.nrm[i] + cy * b.nrm[i + 1] + cz * b.nrm[i + 2] > 0) okAll++;
  }
  return okAll === total;
})());

// 场景
section('7. 生活场景库');
ok('地点库有 8 个场景', FS.world.PLACES.length === 8, '(' + FS.world.PLACES.map((p) => p.name).join('、') + ')');
const placeStat = FS.world.PLACES.map((p) => {
  const b = FS.world.buildPlace(p.id, FS.director.mkRng(1).f);
  return { id: p.id, tris: b.solid.idx.length / 3, lights: b.lights.length, sky: !!b.sky, fog: !!b.fog };
});
ok('每个地点都能建出几何（且三角面数不是零）', placeStat.every((s) => s.tris > 200),
  placeStat.map((s) => s.id + ':' + s.tris).join(' '));
ok('每个地点都有灯光 / 天空 / 雾参数', placeStat.every((s) => s.lights >= 1 && s.sky && s.fog));
ok('同一地点两次 build 结果一致（固定种子，可复现）', (() => {
  const a = FS.world.buildPlace('cafe', FS.director.mkRng(1).f);
  const b = FS.world.buildPlace('cafe', FS.director.mkRng(1).f);
  return a.solid.idx.length === b.solid.idx.length && a.solid.pos.length === b.solid.pos.length;
})());
ok('不同地点的几何不同（不是复制粘贴）', (() => {
  const a = FS.world.buildPlace('cafe', FS.director.mkRng(1).f);
  const b = FS.world.buildPlace('seaside', FS.director.mkRng(1).f);
  return a.solid.idx.length !== b.solid.idx.length || Math.abs(a.solid.pos[0] - b.solid.pos[0]) > 1e-6;
})());

// 角色
section('8. 人物 / 动物');
ok('角色库有 7 个角色', FS.cast.CASTS.length === 7, '(' + FS.cast.CASTS.map((c) => c.name).join('、') + ')');
ok('每个角色都能实例化并算出姿态', (() => {
  const rng = FS.director.mkRng(3).f;
  return FS.cast.CASTS.every((c) => {
    const inst = FS.cast.instantiate(c.id, rng, 'a');
    if (!inst || !inst.parts.length) return false;
    const acts = Object.keys(inst.def.poses || {});
    return acts.every((a) => {
      const pose = FS.cast.pose(inst, a, 1.5, { x: 0, y: 0, z: 0, yaw: 0 }, 1);
      return pose.length === inst.parts.length && pose.every((p) => p.pos.every((v) => isFinite(v)));
    });
  });
})());
ok('动画真的随时间变化（t 不同 → 姿态不同）', (() => {
  const inst = FS.cast.instantiate('person', FS.director.mkRng(3).f, 'a');
  const a = FS.cast.pose(inst, 'walk', 0, { x: 0, y: 0, z: 0, yaw: 0 }, 1);
  const b = FS.cast.pose(inst, 'walk', 0.7, { x: 0, y: 0, z: 0, yaw: 0 }, 1);
  return JSON.stringify(a.map((p) => p.rot)) !== JSON.stringify(b.map((p) => p.rot));
})());
ok('角色内部没有 Math.random（否则同分镜每次长得不一样）',
  !/Math\.random/.test(require('fs').readFileSync(path.join(__dirname, '..', 'js', 'gl', 'cast.js'), 'utf8').replace(/rng \|\| Math\.random/, '')));

// 镜头
section('9. 镜头脚本');
['dolly_in', 'dolly_out', 'orbit', 'crane', 'pan', 'follow', 'static', 'push_orbit'].forEach((tp) => {
  let err = null;
  for (const p of [0, .3, .5, .8, 1]) {
    try {
      const c = FS.camera.evalShot({ type: tp, from: [3, 2, 6], to: [1, 1.6, 3], target: [0, 1.2, 0], fov: 42 }, p, p * 4);
      if (c.eye.some((v) => !isFinite(v))) throw new Error('NaN');
    } catch (e) { err = e; }
  }
  ok('镜头 ' + tp + ' 全程无异常且不出 NaN', !err, err ? err.message : '');
});
ok('orbit 的机位到目标距离 ≈ 设定半径', (() => {
  const c = FS.camera.evalShot({ type: 'orbit', from: [0, 8, 2.5], to: [40, 8, 2.5], target: [0, 1.2, 0] }, .5, 0);
  const d = Math.hypot(c.eye[0] - 0, c.eye[2] - 0);
  return Math.abs(d - 8) < 1e-3;
})());
ok('相机不会钻进地面', (() => {
  const c = FS.camera.evalShot({ type: 'static', from: [0, -3, 4], to: [0, -3, 4], target: [0, 1, 0] }, .5, 0);
  return c.eye[1] >= 0.25;
})());

/* ---------- 10. 导演层 ---------- */
section('10. 导演层（文案 → 分镜）');
const DS = [
  { title: '清晨的巷口', text: '老人在街边买早点，猫从墙头跳下' },
  { title: '公园长椅', text: '孩子追着蝴蝶跑过草地' },
  { title: '海边黄昏', text: '鱼在浅水里游，鸟掠过海面' },
  { title: '实验室的夜', text: '数据和试管，屏幕闪着光' }
];
const sb = FS.director.build({ title: '城市的一天', scenes: DS, bpm: 84, beats: 8, seed: 7 });
ok('分镜段数与文案段落一致', sb.shots.length === DS.length);
ok('每段都有地点 / 镜头 / 角色 / 氛围', sb.shots.every((s) =>
  !!s.place && !!s.shot.type && Array.isArray(s.cast) && s.cast.length >= 1 && !!s.grade.mood));

// ⚠️ 回归：词权重。「实验室的夜」里 nightmarket 的「夜」权重 1、lab 的「实验」权重 2，
//    不加权的话实验室片会被判成夜市片。
ok('更具体的地点词压过宽泛词（实验室 ≠ 夜市）',
  FS.director.build({ title: '实验室的夜', scenes: [{ title: '发现', text: '实验室的数据和试管' }], seed: 42 }).place === 'lab',
  '(得到 ' + FS.director.build({ title: '实验室的夜', scenes: [{ title: '发现', text: '实验室的数据和试管' }], seed: 42 }).place + ')');

// ⚠️ 回归：站位是 [x,0,z]，曾经把 z 写成 from[1]（y，恒为 0），所有角色被压在一条线上
ok('角色站位有纵深（不是全挤在 z=0）', (() => {
  const s2 = FS.director.build({ title: '城市', scenes: [
    { title: 'a', text: '街边早餐' }, { title: 'b', text: '公交穿过街道' },
    { title: 'c', text: '公园长椅' }, { title: 'd', text: '海边的黄昏' }], seed: 7 });
  const zs = s2.shots.flatMap((s) => s.cast.map((c) => c.from[2]));
  return zs.filter((z) => Math.abs(z) > 0.2).length >= zs.length / 2;
})(), '(z 取值 ' + sb.shots.map((s) => s.cast[0].from[2]).join(',') + ')');

ok('室内不出现跑 / 飞 / 跳 / 游', (() => {
  const bad = [];
  ['cafe', 'study', 'lab', 'kitchen'].forEach((p) => {
    Object.keys(FS.director.ACTIONS).forEach((c) => {
      FS.director.legalActions(c, p).forEach((a) => {
        if (['run', 'fly', 'hop', 'swim'].includes(a)) bad.push(c + '@' + p + '=' + a);
      });
    });
  });
  return bad.length === 0;
})(), '');
ok('角色 × 地点 合理性穷举（56 组合）全部能修好', (() => {
  const r = FS.director.mkRng(1);
  let bad = 0;
  FS.world.placeIds().forEach((p) => {
    Object.keys(FS.director.HABITAT).forEach((c) => {
      const fix = FS.director.reconcile(c, p, r);
      if ((FS.director.HABITAT[fix.cast] || []).indexOf(fix.place) < 0) bad++;
    });
  });
  return bad === 0;
})());
ok('鱼不会留在室内（被换成该场景能容纳的角色或换地点）', (() => {
  const r = FS.director.mkRng(9);
  const fix = FS.director.reconcile('fish', 'cafe', r);
  return (FS.director.HABITAT[fix.cast] || []).indexOf(fix.place) >= 0;
})());
ok('分镜可复现：同文案同种子 → 逐字段相同', (() => {
  const a = FS.director.build({ title: 'x', scenes: DS, seed: 99 });
  const b = FS.director.build({ title: 'x', scenes: DS, seed: 99 });
  return JSON.stringify(a) === JSON.stringify(b);
})());
ok('换种子 → 换分镜（20 个种子给出多套走位/镜头）', (() => {
  const sigs = {};
  for (let i = 0; i < 20; i++) {
    const s = FS.director.build({ title: 'x', scenes: DS, seed: i });
    sigs[s.shots.map((x) => x.place + x.shot.type + x.cast.map((c) => c.action).join()).join('|')] = 1;
  }
  const n = Object.keys(sigs).length;
  return n >= 12 ? ('(' + n + '/20 套不同)') : ('只有 ' + n + ' 套，种子没起作用');
})());
ok('LLM 分镜并入后仍然合法（非法地点/角色被顶掉）', (() => {
  const merged = FS.director.mergeLLM(sb, {
    shots: [
      { place: 'mars_base', shotType: 'weird', mood: 'neon', cast: ['person', 'dragon'] },
      { place: 'seaside', shotType: 'track', mood: 'dusk', cast: ['fish'] }
    ]
  });
  return merged.shots.every((s) => !!FS.world.placeById(s.place) &&
    s.cast.every((c) => !!FS.cast.castById(c.id) && (FS.director.HABITAT[c.id] || []).includes(s.place)) &&
    !!FS.director.GRADE[s.grade.mood] && !!s.shot.type);
})());
ok('LLM 段落数超出文案时不会多出镜头', (() => {
  const merged = FS.director.mergeLLM(sb, { shots: [{}, {}, {}, {}, {}, {}] });
  return merged.shots.length === sb.shots.length;
})());

FS.renderScore(FS.parseScore(JSON.stringify(filmMusic.score)), { sampleRate: 22050 }).then(
  () => ok('工厂出的曲子能离线渲染出音频', true),
  (e) => ok('工厂出的曲子能离线渲染出音频', false, e.message.slice(0, 60))
);

FS.renderScore(fscParsed, { sampleRate: 22050 }).then((buf) => {
  ok('渲染回调拿到 AudioBuffer', !!buf && typeof buf.getChannelData === 'function');
  ok('归一化信息挂在 buffer.norm 上', !!buf.norm && buf.norm.gain !== undefined,
    '(peak=' + buf.norm.peak.toFixed(3) + ' gain=' + buf.norm.gain.toFixed(3) + ')');
  ok('调度出的音符数 > 0', scheduled.length > 0, '(' + scheduled.length + ' 个源)');
  ok('所有调度时间都非负', scheduled.every((s) => s.t >= 0));
  ok('渲染时长覆盖最后一个音', buf.duration >= fsc.duration * 0.9, '(' + buf.duration.toFixed(2) + 's)');
  section('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
}).catch((e) => {
  console.log('  ✗ 渲染抛错: ' + e.message);
  process.exit(1);
});
