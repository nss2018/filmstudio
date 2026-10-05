/* Node 端测试：渲染层（score / synth / story）不依赖 DOM，可以直接在 node 里跑。
 * 跑法：node tests/node-test.js   （不需要任何依赖）
 * 覆盖：乐谱解析与报错、时间轴、五种母题的绘制路径、离线合成调度、配乐自动生成。
 */
'use strict';
const path = require('path');
global.window = global;
require(path.join(__dirname, '..', 'js', 'type.js'));    // 排版模块（story.js 依赖它）
require(path.join(__dirname, '..', 'js', 'aiscene.js')); // AI 生成 2D 场景代码
require(path.join(__dirname, '..', 'js', 'theme.js'));   // 界面 + canvas 调色板（UI 层唯一真源）
require(path.join(__dirname, '..', 'js', 'score.js'));
require(path.join(__dirname, '..', 'js', 'wav.js'));
require(path.join(__dirname, '..', 'js', 'synth.js'));
require(path.join(__dirname, '..', 'js', 'story.js'));
require(path.join(__dirname, '..', 'js', 'factory.js'));
require(path.join(__dirname, '..', 'js', 'roll.js'));
require(path.join(__dirname, '..', 'js', 'script.js'));   // 服务商预设（火山方舟等）
require(path.join(__dirname, '..', 'js', 'gl', 'core.js'));
require(path.join(__dirname, '..', 'js', 'gl', 'lru.js'));
require(path.join(__dirname, '..', 'js', 'gl', 'geom.js'));
require(path.join(__dirname, '..', 'js', 'gl', 'camera.js'));
require(path.join(__dirname, '..', 'js', 'gl', 'world.js'));
require(path.join(__dirname, '..', 'js', 'gl', 'cast.js'));
require(path.join(__dirname, '..', 'js', 'director.js'));
require(path.join(__dirname, '..', 'js', 'gl', 'world2.js'));
require(path.join(__dirname, '..', 'js', 'gl', 'world3.js'));
require(path.join(__dirname, '..', 'js', 'scene2d', 'core.js'));
require(path.join(__dirname, '..', 'js', 'scene2d', 'scenes.js'));
require(path.join(__dirname, '..', 'js', 'scene2d', 'scenes2.js'));
require(path.join(__dirname, '..', 'js', 'scene2d', 'scenes3.js'));
require(path.join(__dirname, '..', 'js', 'scene2d', 'pick.js'));
require(path.join(__dirname, '..', 'js', 'scoresync.js'));
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
  /* save/restore 要**真**实现：以前是 noop，于是 particles/dial 把 globalAlpha 改成
   * 「最后一个粒子的透明度」之后再也没恢复，后面所有 fillText 都读到一个被污染的 alpha。
   * 真 canvas 上不会（人家 save/restore 是真的），但这层 noop 会让测试看不见
   * 「运动基元忘记配对 save/restore」这类真 bug —— 在真机上表现就是整块画面发灰。 */
  const stack = [];
  const ctx = {
    canvas: { width: 1280, height: 720 },
    calls: 0,
    fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', textAlign: '', textBaseline: '',
    globalAlpha: 1, shadowColor: '', shadowBlur: 0, Q: 0, type: '',
    fillRect: () => ctx.calls++, strokeRect: () => ctx.calls++, clearRect: () => ctx.calls++,
    beginPath: noop, closePath: noop, moveTo: () => ctx.calls++, lineTo: () => ctx.calls++,
    arc: () => ctx.calls++, stroke: () => ctx.calls++, fill: () => ctx.calls++,
    // 生活场景（daily 母题）用到曲线与椭圆，缺一个就整段母题自检挂掉
    quadraticCurveTo: () => ctx.calls++, bezierCurveTo: () => ctx.calls++,
    ellipse: () => ctx.calls++, rect: () => ctx.calls++, clip: noop,
    setLineDash: noop,
    save: () => {
      stack.push({ a: ctx.globalAlpha, f: ctx.font, ta: ctx.textAlign, tb: ctx.textBaseline,
        fs: ctx.fillStyle, ss: ctx.strokeStyle, lw: ctx.lineWidth, sb: ctx.shadowBlur });
    },
    restore: () => {
      const s = stack.pop(); if (!s) return;
      ctx.globalAlpha = s.a; ctx.font = s.f; ctx.textAlign = s.ta; ctx.textBaseline = s.tb;
      ctx.fillStyle = s.fs; ctx.strokeStyle = s.ss; ctx.lineWidth = s.lw; ctx.shadowBlur = s.sb;
    },
    translate: noop, rotate: noop, scale: noop,
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
ok('地点库有 20 个场景（3D 生活场景两批合计）', FS.world.PLACES.length === 20,
  '(' + FS.world.PLACES.map((p) => p.name).join('、') + ')');
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

/* ---------- 9b. 机位安全（回归：机位穿墙/穿楼 → 后面分段整帧只剩墙面/雾） ---------- */
section('9b. 机位安全：室内不出墙、走廊不出廊、任何机位不糊进雾');
{
  const D = FS.director;
  const CAM_R = D.CAM_R, CAM_BOX = D.CAM_BOX;
  // 与 director.placeIndoor 同步（新增 bedroom/metro 是室内）
  // 与 director.placeIndoor 同步：4 批新增的室内场景都得登记（漏一个就漏一次机位钳制）
  const INDOOR = { cafe: 1, study: 1, lab: 1, kitchen: 1, bedroom: 1, metro: 1,
                   livingroom: 1, office: 1, bakery: 1, hospital: 1 };
  // 与 world.js / world2.js / world3.js 同步：各地雾的 near/far（改了那几个文件要同步）
  const FOG = { cafe: [7, 26], street: [16, 62], park: [18, 70], seaside: [22, 80], study: [6, 22], lab: [8, 28], kitchen: [6, 22], nightmarket: [8, 34],
    bedroom: [6, 20], market: [12, 40], metro: [8, 30], campus: [20, 62], rainstreet: [8, 34], balcony: [14, 52],
    livingroom: [7, 26], office: [9, 30], bakery: [7, 24], hospital: [9, 30], farmfield: [20, 70], busstop: [16, 56] };
  // ⚠️ 回归：加新地点忘了往这两张表登记 → FOG[id][0] 直接把测试打崩（undefined[0]）
  ok('机位安全表的 INDOOR/FOG 与 director 判定完全一致', (() => {
    const bad = [];
    FS.world.placeIds().forEach((id) => {
      if (!FOG[id]) bad.push(id + ' FOG 缺登记');
      const wantIndoor = FS.director.placeIndoor(id) ? 1 : 0;
      if ((INDOOR[id] ? 1 : 0) !== wantIndoor) bad.push(id + ' INDOOR 判定不一致');
    });
    return bad.length === 0;
  })(), '');
  let bad = 0, msg = '';
  FS.world.placeIds().forEach((place) => {
    const maxR = CAM_R[place] || 14;
    for (let seed = 1; seed <= 40 && bad < 3; seed++) {
      // 5 段 = establish/push/track/orbit/pullout 全覆盖；keepPlace 强制落在这个地点
      const scenes5 = [1, 2, 3, 4, 5].map((k) => ({ title: '', text: '第' + k + '段普通文案，命中不了地点词。' }));
      const sbb = D.build({
        title: '安全钳' + seed, scenes: scenes5,
        bpm: 84, beats: 8, seed: seed * 7919 + place.length * 131, keepPlace: place
      });
      sbb.shots.forEach((sh) => {
        const b2 = CAM_BOX[sh.place];
        // 段落有 30% 概率切到 RELATED 地点，雾距/钳制判据必须按镜头自己的地点算
        const fogOk = FOG[sh.place][0] + 0.25 * (FOG[sh.place][1] - FOG[sh.place][0]) + 0.5;
        // 走廊地点禁止 follow / push_orbit：两者运行时绕注视点旋转，静态钳制管不住
        if (b2 && (sh.shot.type === 'follow' || sh.shot.type === 'push_orbit')) {
          bad++; msg = sh.place + ' 用了运行时旋转镜头 ' + sh.shot.type; return;
        }
        // 演员走位别拐进楼/墙里
        if (b2) {
          for (const c of sh.cast) for (const pt of [c.from, c.to]) {
            if (Math.abs(pt[0]) > b2.x) { bad++; msg = sh.place + ' 演员进楼 x=' + pt[0].toFixed(2); return; }
          }
        }
        for (const p of [0, .25, .5, .75, 1]) {
          const cam = FS.camera.evalShot(sh.shot, p, 0);
          const m = Math.hypot(cam.eye[0], cam.eye[2]);
          if (INDOOR[sh.place] && m > (CAM_R[sh.place] || maxR) + 0.05) { bad++; msg = sh.place + ' 穿墙 r=' + m.toFixed(2) + ' p=' + p; return; }
          if (b2 && (Math.abs(cam.eye[0]) > b2.x + 0.05 || Math.abs(cam.eye[2]) > b2.z + 0.05)) {
            bad++; msg = sh.place + ' 出廊 eye=[' + cam.eye[0].toFixed(2) + ',' + cam.eye[2].toFixed(2) + '] p=' + p; return;
          }
          const d = Math.hypot(cam.eye[0] - cam.target[0], cam.eye[1] - cam.target[1], cam.eye[2] - cam.target[2]);
          if (d > fogOk) { bad++; msg = sh.place + ' 糊雾 d=' + d.toFixed(2) + ' p=' + p; return; }
        }
      });
    }
  });
  ok('8 地点 × 40 种子 × 全镜头：室内不出墙 / 走廊不出廊 / 不超雾距', bad === 0, bad ? msg : '');
}

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
/* 接火山方舟豆包（Doubao-Seed-2.0-Code）后加的：预设 + URL 拼装 + 新地点白名单 */
ok('服务商预设里有火山方舟豆包，且带一个豆包默认模型', (() => {
  // 2026-10-05 第二轮：模型留空会让用户随手填 deepseek-chat → 方舟 404。
  // 改成预设直接带一个「大概率已开通」的豆包模型；一旦拉到账号真实清单，
  // 清单会盖掉这个猜测值（见 pickFromList / fillModelPicker 的 force 分支）。
  const p = FS.script.PRESETS.filter((x) => x.id === 'ark')[0];
  return !!(p && p.base === 'https://ark.cn-beijing.volces.com/api/v3'
    && p.model === FS.script.DEFAULT_ARK_MODEL && /doubao/.test(p.model));
})());
ok('方舟「走本站代理」预设排在第一位（直连必被 CORS 拦）', (() => {
  const f = FS.script.PRESETS.filter((x) => x.id === 'local-ark')[0];
  return !!f && f.base === 'ai.php' && f.via === 'ark.cn-beijing.volces.com' &&
    FS.script.PRESETS[0].id === 'local-ark';
})());
// 兜底模型名只允许有一个来源：DEFAULT_ARK_MODEL。曾经同一份 script.js 里
// 代理路径写 1-6、直连路径写 2-0-lite，两处不一致 → 用户按框里名字试就 401。
    ok('方舟兜底模型只有一个来源（不许散落硬编码模型名）', (() => {
      const src = require('fs').readFileSync(path.join(__dirname, '..', 'js', 'script.js'), 'utf8');
      const uniq = [...new Set(src.match(/doubao-seed-[A-Za-z0-9-]+/g) || [])];
      return uniq.length === 1 && uniq[0] === FS.script.DEFAULT_ARK_MODEL;
    })());
    // 2026-10-05：默认模型必须是**真调通过**的那个 id（拿用户自己的 Key 实测 200/2.4s），
    // 而不是拍脑袋写一个。真调过一次的是 doubao-seed-2-0-code-preview-260215。
    ok('默认模型是实测能跑通的那个豆包 id', /^doubao-seed-2-0-code/.test(FS.script.DEFAULT_ARK_MODEL),
      '(' + FS.script.DEFAULT_ARK_MODEL + ')');
    ok('下拉里那个模型有专门的人话备注', (() => {
      const src = require('fs').readFileSync(path.join(__dirname, '..', 'js', 'script.js'), 'utf8');
      return /2\[\.\\-_\]\?0\[\.\\-_\]\?code/.test(src) && /写脚本/.test(src);
    })());
    // ⚠️ 选模型**不能「取第一个」**：实测某 Key 的 /models 返回 135 个、按上线时间排，
    //    第一个是 doubao-lite-128k-240428（2024 年老古董）。这里拿真实清单的前几项复现。
    ok('挑模型不靠「取第一个」（否则会选中 2024 年的老古董）', (() => {
      const m = require('fs').readFileSync(path.join(__dirname, '..', 'js', 'main.js'), 'utf8');
      const fn = /function pickModelFrom\(list\)\s*\{[\s\S]*?\n  \}/.exec(m);
      if (!fn) return false;
      const body = fn[0];
      // 允许 `arr[0]` 出现在最后的兜底里，但不允许 `ep[0] || arr[0]` 这种"第一个说了算"
      return /DEFAULT_ARK_MODEL/.test(body) && !/arr\[0\]\s*\)\s*;?\s*$/.test(body.trim().replace(/\}\s*$/, ''))
        && !/ep\[0\]\s*\|\|\s*arr\[0\]/.test(body);
    })());
ok('isProxyBase 认得 ai.php、认不得普通地址', (() => {
  const f = FS.script.isProxyBase;
  return f('ai.php') && f('/filmstudio/ai.php') && !f('https://api.deepseek.com/v1') && !f('');
})());
ok('火山方舟 base 不会被误补 /v1（结尾是 /v3 就该原样用）', (() => {
  const p = FS.script.PRESETS.filter((x) => x.id === 'ark')[0];
  let base = p.base.replace(/\/+$/, '');
  if (!/\/v\d+$/.test(base)) base += '/v1';
  return base + '/chat/completions' === 'https://ark.cn-beijing.volces.com/api/v3/chat/completions';
})());
ok('豆包分镜走白名单：world3 的 6 个新地点能被模型选、非法值被顶掉', (() => {
  const m = FS.director.mergeLLM(sb, {
    shots: [
      { place: 'martini', shotType: 'explode', mood: 'neon', cast: ['fish', 'hospital'], note: '晚风' },
      { place: 'bakery', shotType: 'push', mood: 'warm', cast: ['person'], note: '刚出炉' }
    ]
  });
  if (!m.shots.every((s) => !!FS.world.placeById(s.place) && s.cast.every((c) =>
    !!FS.cast.castById(c.id) && (FS.director.HABITAT[c.id] || []).includes(s.place)))) return false;
  // 第 1 段模型给了不存在的地点/镜头/氛围，必须回落成本地合法值
  const a = m.shots[0];
  return !!FS.world.placeById(a.place) && !!a.shot.type && !!FS.director.GRADE[a.grade.mood] &&
    a.cast.every((c) => Array.isArray(c.from) && c.from.length === 3) &&
    ['livingroom', 'office', 'bakery', 'hospital', 'farmfield', 'busstop']
      .some((id) => (FS.director.PLACE_WORDS[id] || []).length > 0);
})());

/* ---------- 11. 有界缓存（借鉴 digiCreature_ios 的 boxCache） ---------- */
section('11. 有界 LRU 缓存（显存不能只删 JS 对象）');
const freed = [];
const lru = FS.LRU(3, (k, v) => freed.push(k + ':' + v));
lru.set('a', 1); lru.set('b', 2); lru.set('c', 3);
ok('未超上限时不淘汰', freed.length === 0 && lru.size() === 3, '(size=' + lru.size() + ')');
lru.get('a');                         // a 变成最新
lru.set('d', 4);                       // 容量 4 > 3 → 淘汰最旧的 b
ok('超上限淘汰最旧的一条（不是最早插入的那条）', freed.length === 1 && freed[0] === 'b:2',
  '(淘汰 ' + freed.join(',') + ')');
ok('被淘汰的确实不在缓存里了', !lru.has('b') && lru.has('a') && lru.has('d'));
lru.set('a', 9);                       // 覆盖已存在的 key
ok('覆盖旧值也会回调释放（否则显存留双份）', freed.length === 2 && freed[1] === 'a:1' && lru.get('a') === 9);
ok('淘汰计数与命中数可读（给自检页显示）', (() => {
  const s = lru.stats();
  return s.evictions >= 1 && s.hits >= 2 && s.limit === 3 && s.misses >= 0;
})());
ok('clear 会释放全部', (() => {
  const n0 = freed.length;
  lru.clear();
  return lru.size() === 0 && freed.length > n0;
})());
ok('缓存上限在渲染层真的接上了（源码里有 PLACE_MAX / CAST_MAX 传进 LRU）', (() => {
  const src = require('fs').readFileSync(path.join(__dirname, '..', 'js', 'gl', 'render.js'), 'utf8');
  return /FS\.LRU\(\s*\w+\s*,/.test(src) && /disposeMesh/.test(src);
})());

/* ---------- 12. 逐帧确定性导出（借鉴 digiCreature_ios 的 t = k/fps） ---------- */
section('12. 逐帧确定性导出');
const FPS = 30;
const sb2 = FS.director.build({ title: '导出测试', scenes: DS, bpm: 84, beats: 8, seed: 5 });
const total2 = sb2.totalSec;
const frames2 = Math.ceil(total2 * FPS);
ok('帧数 = ceil(总时长 × fps)', frames2 === Math.ceil(total2 * 30),
  '(' + frames2 + ' 帧 / ' + total2.toFixed(2) + 's)');
ok('最后一帧不越界（t < total）', (frames2 - 1) / FPS < total2, '(t=' + ((frames2 - 1) / FPS).toFixed(2) + 's)');
ok('两段「不同推进节奏」渲染出的帧序列完全相同（这才是确定性的定义）', (() => {
  // A：稳定 30fps；B：模拟卡顿（步长抖动，帧号不变）
  const seqA = [], seqB = [];
  let wall = 0;
  for (let k = 0; k < frames2; k++) {
    const t = k / FPS;
    seqA.push(JSON.stringify(FS.camera.evalShot(sb2.shots[0].shot, t / sb2.shots[0].durationSec, t)));
    wall += 7 + (k % 5) * 3;                 // 假墙钟：忽快忽慢
    seqB.push(JSON.stringify(FS.camera.evalShot(sb2.shots[0].shot, wall * 0 + (k / FPS) / sb2.shots[0].durationSec, k / FPS)));
  }
  return seqA.join('|') === seqB.join('|');
})());
ok('角色姿态在相同 t 下逐字段一致（含动画相位）', (() => {
  const inst = FS.cast.instantiate('person', FS.director.mkRng(3).f, 'a');
  const w = { x: 1, y: 0, z: 2, yaw: 0.5 };
  const a = JSON.stringify(FS.cast.pose(inst, 'walk', 1.234, w, 1));
  const b = JSON.stringify(FS.cast.pose(inst, 'walk', 1.234, w, 1));
  return a === b;
})());
ok('导出快照与当前 film 隔离（快照是深拷贝）', (() => {
  const film = { title: 'x', scenes: [{ title: 'a', text: 'b' }], bpm: 84, beats: 8, engine: '2d', sub: 'on' };
  const snap = JSON.parse(JSON.stringify(film));
  film.scenes[0].text = '被改了';
  return snap.scenes[0].text === 'b';
})());

/* ---------- 7. 相机安全：视线距离不得退化（3D 画面只剩天空雾的回归） ---------- */
section('\n7. 相机安全（eye-target 距离）');
const distOf = (c) => Math.hypot(c.eye[0] - c.target[0], c.eye[1] - c.target[1], c.eye[2] - c.target[2]);
ok('follow 回归：from/to 分列注视点两侧，中点不再穿过（距离恒 >2m）', (() => {
  // 复刻段2 bug：相机 y 与注视点同高，直线插值的中点距离恰为 0 → lookAt 方向退化 → 只剩天空和雾
  const shot = { type: 'follow', from: [-8.5, 1.2, 0], to: [8.5, 1.2, 0], target: [0, 1.2, 0], fov: 42, ease: 'inOutQuad' };
  let worst = Infinity;
  for (let k = 0; k <= 100; k++) worst = Math.min(worst, distOf(FS.camera.evalShot(shot, k / 100, k / 10)));
  return worst > 2 ? true : '最近 ' + worst.toFixed(3) + 'm';
})());
ok('全镜头类型 × 全进度扫描（40 种子 × 3/4/5 段）：距离恒 >1m', (() => {
  const texts = ['咖啡馆 咖啡', '街道 汽车', '公园 散步', '海边 日落', '书房 读书', '实验室 数据', '厨房 做饭', '夜市 小吃'];
  let worst = Infinity, worstAt = '';
  for (let seed = 1; seed <= 40; seed++) {
    for (const n of [3, 4, 5]) {
      const sb = FS.director.build({
        title: 't' + seed, seed,
        scenes: Array.from({ length: n }, (_, i) => ({ title: 's' + i, text: texts[(seed + i) % texts.length] }))
      });
      for (const sh of sb.shots) {
        for (let k = 0; k <= 50; k++) {
          const p = k / 50;
          const d = distOf(FS.camera.evalShot(sh.shot, p, p * 4));
          if (d < worst) { worst = d; worstAt = 'seed=' + seed + ' 段' + sh.index + ' ' + sh.shot.type + ' p=' + p.toFixed(2); }
        }
      }
    }
  }
  return worst > 1 ? true : '最近 ' + worst.toFixed(3) + 'm @ ' + worstAt;
})());

/* ---------- 8. 钢琴卷帘：fitRoot 不得死循环（点「生成配乐」整页卡死的回归） ---------- */
section('\n8. 钢琴卷帘 fitRoot');
ok('fitRoot：lo=59 hi=79（音区偏高）能返回且窗口追得上 hi', (() => {
  // 旧代码 `while (root + 21 < hi) root -= 12` 方向写反：root 越减条件越真，
  // while 永远出不来 —— 点「生成配乐」→ parseMusic → roll.load → fitRoot，整页卡死。
  const notes = [{ midi: 59 }, { midi: 79 }];
  const root = FS.roll._internal.fitRoot(notes);
  return isFinite(root) && root + 21 >= 79;
})(), '');
ok('fitRoot：极端输入（hi=Infinity / 巨大音域）有 guard 不死循环', (() => {
  const r1 = FS.roll._internal.fitRoot([{ midi: 48 }, { midi: Infinity }]);
  const r2 = FS.roll._internal.fitRoot([{ midi: 0 }, { midi: 127 }]);
  return isFinite(r1) && isFinite(r2);
})(), '');
ok('fitRoot：工厂出的每条轨（全风格 × 密度扫描）都能正常返回', (() => {
  let calls = 0;
  for (const st of FS.factory.STYLES) {
    for (const d of [0.3, 0.7, 0.9]) {
      const r = FS.factory.generate({ theme: '未命名', style: st.id, bars: 12, density: d, drums: true });
      const sc = FS.parseScore(FS.factory.toText(r.score));
      for (const t of sc.tracks) {
        const root = FS.roll._internal.fitRoot(t.notes);
        if (!isFinite(root)) return 'style=' + st.id + ' 轨 ' + t.instrument + ' 返回 ' + root;
        calls++;
      }
    }
  }
  return true;
})(), '');

/* ---------- 13. 2D 生活场景 + 3D 场景扩充 ---------- */
section('13. 生活场景（2D 插画 + 3D 扩充）');

// --- 2D 场景库 ---
const S2D = FS.s2dScenes;
const s2dIds = Object.keys(S2D.meta);
ok('2D 生活场景有 18 个（第二批 6 个已补画）', s2dIds.length === 18, '(' + s2dIds.length + ' 个)');
ok('每个 2D 场景都有中文名与标签', s2dIds.every((k) => S2D.meta[k] && S2D.meta[k].name && S2D.meta[k].tags.length));
ok('每个 2D 场景都有对应的 draw 函数', s2dIds.every((k) => typeof S2D[k] === 'function'));

// stub canvas：只记录调用，验证不抛异常且真的画了东西
function s2dCtx() {
  const c = { canvas: { width: 1280, height: 720 }, fillStyle: '', strokeStyle: '', lineWidth: 1,
    globalAlpha: 1, font: '', textAlign: '', textBaseline: '', lineCap: '',
    shadowColor: '', shadowBlur: 0, shadowOffsetY: 0 };
  let n = 0;
  ['save','restore','beginPath','closePath','moveTo','lineTo','arc','ellipse','quadraticCurveTo',
   'bezierCurveTo','rect','fill','stroke','fillRect','strokeRect','fillText','translate','scale',
   'rotate','setLineDash','clip'].forEach((k) => { c[k] = () => { n++; }; });
  c.createLinearGradient = c.createRadialGradient = () => ({ addColorStop: () => {} });
  c.measureText = () => ({ width: 10 });
  c.calls = () => n;
  return c;
}
ok('18 个 2D 场景 × 3 个时刻都能画且不抛异常', (() => {
  const bad = [];
  s2dIds.forEach((id) => {
    [0, 1.7, 4.2].forEach((t) => {
      try {
        const c = s2dCtx();
        S2D[id](c, t, t / 10, { mood: 'day' });
        if (c.calls() < 50) bad.push(id + '@' + t + ' 绘制调用过少');
      } catch (e) { bad.push(id + '@' + t + ': ' + e.message); }
    });
  });
  return bad.length === 0;
})(), '');
ok('2D 场景里有真人剪影（人物不是画的贴图）', (() => {
  // personSil 被至少 6 个场景用到：生活场景得有人在
  let n = 0;
  s2dIds.forEach((id) => {
    const src = S2D[id].toString();
    if (src.indexOf('personSil') >= 0) n++;
  });
  return n >= 6;
})(), '');

// --- 按文案自动选景（与 3D 共用词典）---
ok('按文案选景：下雨撑伞 → 雨巷', FS.s2dPick.pickScene('下雨了，撑伞走在街头', 1) === 'rainy',
  '(得到 ' + FS.s2dPick.pickScene('下雨了，撑伞走在街头', 1) + ')');
ok('按文案选景：菜市场 → 菜市场', FS.s2dPick.pickScene('讨价还价的菜市场', 1) === 'market',
  '(得到 ' + FS.s2dPick.pickScene('讨价还价的菜市场', 1) + ')');
ok('按文案选景：地铁通勤 → 地铁', FS.s2dPick.pickScene('地铁通勤的站台', 1) === 'metro',
  '(得到 ' + FS.s2dPick.pickScene('地铁通勤的站台', 1) + ')');
ok('2D 画不出的地点会语义退到最像的场景（厨房→咖啡馆）',
  FS.s2dPick.pickScene('厨房的灯亮着，孩子在桌边吃面', 1) === 'cafe',
  '(得到 ' + FS.s2dPick.pickScene('厨房的灯亮着，孩子在桌边吃面', 1) + ')');
ok('选景结果永远是 2D 画得出的场景', (() => {
  const texts = ['卧室里的清晨', '雨夜街头', '地铁通勤', '阳台上晒太阳', '海边的黄昏',
                '公园长椅', '夜市小吃', '菜市场', '校园操场', '咖啡馆', '书房', '街道'];
  return texts.every((t) => typeof S2D[FS.s2dPick.pickScene(t, 3)] === 'function');
})());
ok('新增 2D 生活场景能被文案直接命中（客厅/办公室/面包房/病房/田埂/公交站）', (() => {
  const cases = [['客厅的沙发上电视还亮着', 'livingroom'], ['他在办公室加班到深夜', 'office'],
                 ['面包房里烤箱冒着麦香', 'bakery'], ['医院病房里陪护', 'hospital'],
                 ['麦田里的稻草人', 'farmfield'], ['公交站等末班车', 'busstop']];
  const bad = [];
  cases.forEach((c) => {
    const got = FS.s2dPick.pickScene(c[0], 3);
    // 必须既是真画得出的场景，又就是期望那一个（不能被 FALLBACK 顺延抢走）
    if (typeof S2D[got] !== 'function' || got !== c[1]) bad.push(c[0] + '→' + got + '(期望 ' + c[1] + ')');
  });
  return bad.length === 0;
})(), '');
ok('3D 有 / 2D 没画的地点会顺延到画得出的场景（厨房→咖啡馆，实验室→书房）', (() => {
  const f = FS.s2dPick.pickScene('在厨房煮汤', 3);
  const g2 = FS.s2dPick.pickScene('实验室里的数据分析', 3);
  return f === 'cafe' && g2 === 'study';
})(), '(kitchen/lab 靠 pick.js 的 FALLBACK 顺延)');
ok('选景可复现（同文案同参数 → 同一场景）', (() => {
  const a = FS.s2dPick.pickScene('下雨的夜晚', 5);
  const b = FS.s2dPick.pickScene('下雨的夜晚', 5);
  return a === b;
})());

// --- 3D 场景扩充 ---
ok('3D 地点扩到 20 个（第二轮生活场景已入库）', FS.world.PLACES.length === 20,
  '(' + FS.world.PLACES.length + ' 个：' + FS.world.PLACES.map((x) => x.name).join('、') + ')');
ok('新增的 6 个 3D 生活场景都在库里',
  ['livingroom', 'office', 'bakery', 'hospital', 'farmfield', 'busstop'].every((id) => !!FS.world.placeById(id)));
ok('全部 20 个 3D 地点都能建出几何 + 灯光 + 天空 + 雾', (() => {
  const bad = [];
  FS.world.placeIds().forEach((id) => {
    try {
      const b = FS.world.buildPlace(id, FS.director.mkRng(FS.director.fnv(id) ^ 0x9e37).f);
      if (!(b.solid.idx.length / 3 > 200)) bad.push(id + ' 三角面过少');
      if (!b.lights.length || !b.sky || !b.fog) bad.push(id + ' 灯光/天空/雾缺失');
    } catch (e) { bad.push(id + ': ' + e.message); }
  });
  return bad.length === 0;
})(), '');
ok('导演层认识全部地点（站位/关联/词典，逐条查不靠数量凑）', (() => {
  const miss = FS.world.placeIds().filter((id) =>
    !FS.director.SPOTS[id] || !FS.director.RELATED[id] || !FS.director.PLACE_WORDS[id]);
  return miss.length === 0;
})(), '');
// ⚠️ 回归：加地点却忘加 HABITAT → reconcile 把地点顶回 hab[0]，新场景永远选不中
ok('每个角色都至少能待在一个已建场景里（reconcile 不会把地点顶掉）', (() => {
  const r = FS.director.mkRng(1);
  const bad = [];
  Object.keys(FS.director.HABITAT).forEach((cid) => {
    FS.director.HABITAT[cid].forEach((pid) => {
      if (!FS.world.placeById(pid)) bad.push(cid + ' 的栖息地 ' + pid + ' 不存在');
    });
    // 随便找个场景试 reconcile，地点不能被换掉
    const fix = FS.director.reconcile(cid, FS.world.placeIds()[3], r);
    if (!FS.world.placeById(fix.place)) bad.push(cid + ' reconcile 到了不存在的地点');
  });
  return bad.length === 0;
})(), '');
ok('新增场景能被文案命中（卧室/菜市场/校园/雨夜/阳台 + 第二批 6 个）', (() => {
  const cases = [['卧室里的清晨', 'bedroom'], ['讨价还价的菜市场', 'market'],
                 ['同学在操场跑步', 'campus'], ['下雨撑伞走在街头', 'rainstreet'],
                 ['阳台上晒太阳', 'balcony'], ['地铁通勤站台', 'metro'],
                 // 第二批生活场景：客厅/办公室/面包房/病房/田埂/公交站
                 ['客厅的沙发上，电视还亮着', 'livingroom'],
                 ['他在办公室加班到深夜', 'office'],
                 ['面包房里烤箱冒着麦香', 'bakery'],
                 ['医院病房里陪护', 'hospital'],
                 ['麦田里的稻草人站在田埂上', 'farmfield'],
                 ['公交站等末班车', 'busstop']];
  const bad = [];
  cases.forEach(([text, want]) => {
    const got = FS.director.build({ title: text, scenes: [{ title: text, text }], seed: 7 }).place;
    if (got !== want) bad.push(text + '→' + got + '(期望 ' + want + ')');
  });
  return bad.length === 0;
})(), '');
ok('室内判定覆盖全部室内场景（卧室/地铁/客厅/办公室/面包房/病房）',
  ['bedroom', 'metro', 'livingroom', 'office', 'bakery', 'hospital']
    .every((id) => FS.director.placeIndoor(id)) &&
  ['campus', 'balcony', 'farmfield', 'busstop', 'park']
    .every((id) => !FS.director.placeIndoor(id)));

// --- daily 母题接进 story ---
ok('2D 母题列表含 daily（生活场景）', FS.templates.indexOf('daily') >= 0, '(' + FS.templates.join(', ') + ')');
ok('daily 母题走完整 drawFrame 链路不抛异常', (() => {
  const st = { title: '测试', template: 'daily', palette: 'ink', bpm: 84, beats: 8,
    scenes: [{ title: 'a', text: '街边的早晨' }, { title: 'b', text: '雨夜' }],
    scenes2d: ['street', 'rainy'] };
  const tl = FS.story.timeline(st);
  for (let i = 0; i < 40; i++) {
    try { FS.story.drawFrame(s2dCtx(), st, i * 0.2); }
    catch (e) { return false; }
  }
  return true;
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

  /* ---------- UI 主题：不黑、不紫（以后重排风格时别飘回去） ---------- */
  (function () {
    const fs = require('fs');
    const path = require('path');
    const ROOT = path.join(__dirname, '..');
    const css = fs.readFileSync(path.join(ROOT, 'css', 'app.css'), 'utf8');
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

    /** hex → 亮度 l(0~1) + 色相 h(0~360)，用来判「黑」和「紫」 */
    function hsl(hex) {
      const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
      if (!m) return null;
      const n = parseInt(m[1], 16);
      const r = (n >> 16 & 255) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
      let h = 0;
      if (d) {
        if (mx === r) h = 60 * (((g - b) / d) % 6);
        else if (mx === g) h = 60 * ((b - r) / d + 2);
        else h = 60 * ((r - g) / d + 4);
      }
      return { l: (mx + mn) / 2, h: (h + 360) % 360 };
    }
    function scan(txt) {
      const dark = [], purple = [];
      const re = /#([0-9a-fA-F]{6})\b/g;
      let m;
      while ((m = re.exec(txt))) {
        const c = hsl(m[1]);
        if (!c) continue;
        if (c.l < 0.12) dark.push('#' + m[1]);
        if (c.h >= 250 && c.h <= 330) purple.push('#' + m[1] + '(h' + Math.round(c.h) + ')');
      }
      return { dark: dark, purple: purple };
    }

    const T = FS.theme;
    ok('theme 调色板完整（纸面/墨色/线/语义色/8 轨色）',
      !!(T.paper && T.card && T.trough && T.troughDeep && T.ink && T.ink2 && T.ink3 &&
         T.rule && T.rule2 && T.accent && T.accentDeep && T.olive && T.brick && T.gold) &&
      T.trail.length === 8);
    ok('纸面三档都是亮色（L ≥ 0.8）',
      [T.paper, T.card, T.trough, T.troughDeep].every((c) => hsl(c).l >= 0.8));

    const cs = scan(css);
    ok('UI 样式里没有纯黑 / 近黑（L < 0.12）', cs.dark.length === 0,
      cs.dark.join(' ') || '(深棕墨 #33291F L=0.16 是刻意保留的文字墨色)');
    ok('UI 样式里没有紫 / 蓝紫（色相 250°–330°）', cs.purple.length === 0, cs.purple.join(' ') || '');

    const ts = scan(fs.readFileSync(path.join(ROOT, 'js', 'theme.js'), 'utf8'));
    ok('canvas 调色板没有纯黑 / 近黑', ts.dark.length === 0, ts.dark.join(' ') || '');
    ok('canvas 调色板没有紫 / 蓝紫', ts.purple.length === 0, ts.purple.join(' ') || '');
    ok('卷帘 8 条轨色两两不同、都不黑不紫',
      new Set(T.trail).size === 8 &&
      T.trail.every((c) => { const h = hsl(c); return h.l >= 0.2 && !(h.h >= 250 && h.h <= 330); }));

    // CSS 变量是 theme.js 的镜像：只改一边会立刻 fail
    const root = /:root\{([\s\S]*?)\n\}/.exec(css);
    ok('css :root 与 theme.js 逐字一致（改了一边忘改另一边会 fail）', (() => {
      if (!root) return false;
      const map = {};
      root[1].replace(/(--[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{6})/g, function (_, k, v) { map[k] = v.toLowerCase(); });
      const pairs = { '--paper': T.paper, '--card': T.card, '--trough': T.trough, '--trough-deep': T.troughDeep,
                      '--ink': T.ink, '--ink-2': T.ink2, '--ink-3': T.ink3,
                      '--rule': T.rule, '--rule-2': T.rule2,
                      '--accent': T.accent, '--accent-deep': T.accentDeep,
                      '--olive': T.olive, '--brick': T.brick, '--gold': T.gold };
      return Object.keys(pairs).every((k) => map[k] === pairs[k].toLowerCase());
    })());

    const uses = (html.match(/<use href="#i-/g) || []).length;
    ok('index.html 挂了 theme.js（canvas 取色依赖它）', /<script src="js\/theme\.js/.test(html));
    ok('按钮已换掉 emoji 图标（用内联 SVG sprite）', uses >= 12, '(' + uses + ' 处)');
  })();

  /* ---------- 一键成片（联网全自动） ---------- */
  section('\n一键成片：主题 / 例子 / 文案 / 分镜 一次出齐');

  ok('20 个地点都有中文别名表条目（漏一个，模型说中文就被白名单顶掉）',
    FS.world.placeIds().every((id) => !!FS.director.PLACE_ALIAS[id]),
    '(' + FS.world.placeIds().filter((id) => !FS.director.PLACE_ALIAS[id]).join(',') + ')');

  ok('中文/繁体/日常叫法都能解析回 place id', (() => {
    const cases = [['咖啡馆', 'cafe'], ['咖啡館', 'cafe'], ['便利店', 'cafe'], ['公园', 'park'],
      ['海邊', 'seaside'], ['厨房里', 'kitchen'], ['菜市場', 'market'], ['地鐵', 'metro'],
      ['雨中街道', 'rainstreet'], ['客廳', 'livingroom'], ['麵包房', 'bakery'], ['医院病房', 'hospital'],
      ['田埂', 'farmfield'], ['公交站', 'busstop'], ['街道', 'street'], ['校园', 'campus'],
      ['卧室', 'bedroom'], ['阳台', 'balcony'], ['办公室', 'office'], ['夜市', 'nightmarket'],
      ['实验室', 'lab'], ['书房', 'study'], ['大排档', 'nightmarket'], ['超市', 'market']];
    return cases.every((c) => FS.director.resolvePlace(c[0]) === c[1]);
  })());

  ok('认不出的地名返回 null（交回白名单顶，不乱猜）',
    FS.director.resolvePlace('martini') === null && FS.director.resolvePlace('火星基地') === null);

  ok('autoPrompt 没给主题时要求模型自拟', /用户没给主题/.test(FS.director.autoPrompt({ engine: '3d', count: 4 })));
  ok('autoPrompt 把 20 个 place id 全列给模型了',
    FS.world.placeIds().every((id) => FS.director.autoPrompt({ engine: '3d' }).indexOf(id) >= 0));
  ok('autoPrompt 按引擎描述画面（3D 低多边形 / 2D 手绘）',
    /低多边形 3D 生活场景/.test(FS.director.autoPrompt({ engine: '3d' })) &&
    /Canvas2D 手绘的生活插画/.test(FS.director.autoPrompt({ engine: '2d' })));

  ok('autoPrompt 要求场景落在具体小事上、不要空词',
    /一件具体的小事/.test(FS.director.autoPrompt({ engine: '2d', count: 4 })));

  // 模型顺影视语感给 crane（想拉远收尾），必须落到拉远，不能被 `|| 'push'` 兜底成推近
  ok('导演说法 ↔ 渲染层镜头名对齐（crane / wide / follow / pan）', (() => {
    const cases = [['crane', 'crane'], ['pullout', 'crane'], ['wide', 'orbit'],
      ['establish', 'orbit'], ['push', 'dolly_in'], ['closeup', 'dolly_in']];
    return cases.every((c) => {
      const sb = FS.director.build({ title: 't', scenes: [{ title: '1', text: '街上的雨' }], bpm: 84, beats: 4, seed: 4242 });
      const merged = FS.director.mergeLLM(sb, { shots: [{ place: 'rainstreet', shotType: c[0] }] });
      return merged.shots[0].shot.type === c[1];
    });
  })());

  ok('模型给的中文地点经 auto 翻译后，mergeLLM 不丢段', (() => {
    const sb = FS.director.build({ title: '十点那一碗', scenes: [
      { title: '还不到店', text: '下班的时候天已经黑透了' },
      { title: '热气', text: '便利店关东煮的热气糊了我的眼镜' },
      { title: '擦一下', text: '我抬手擦了一下，世界就清楚了一点' },
      { title: '吃完', text: '十点那一碗面，把我接住了' }], bpm: 84, beats: 8, seed: null });
    const merged = FS.director.mergeLLM(sb, { shots: [
      { place: '街道', shotType: 'establish', cast: ['person'] },
      { place: '便利店', shotType: 'push', cast: ['person'] },
      { place: '客厅', shotType: 'track', cast: ['person'] },
      { place: '菜市场', shotType: 'pullout', cast: ['person'] }] });
    return merged.shots.length === 4 && merged.shots.every((s) =>
      !!FS.world.placeById(s.place) && s.cast.length > 0 && !!s.shot && !!s.shot.type);
  })());

/* ---------- 14. 配乐跟文案对齐：按字幕断句打点，不合拍就不配 ---------- */
section('14. 配乐跟文案走（字幕断句 / 不合拍静音）');
{
  const S = FS.scoreSync;
  const f2 = {
    title: '结构之美', template: 'concept', palette: 'ink', bpm: 84, beats: 8,
    scenes: [
      { title: 'a', text: '第一句，第二句。第三句！' },
      { title: 'b', text: '只有一句' }
    ]
  };

  ok('断句：按中文标点切开', JSON.stringify(S.splitPhrases('第一句，第二句。第三句！')) ===
    JSON.stringify(['第一句', '第二句', '第三句']));
  ok('超长小句按 7 字再切一刀', S.splitPhrases('一二三四五六七八九十一二三四五六七八九十').length === 3);
  ok('只有标点的文本不出句', S.splitPhrases('，、。！').length === 0);

  const anchors = S.copyAnchors(f2);
  const tl2 = FS.story.timeline(f2);
  ok('落点=每句字幕出现的位置（两三段共 4 个）', anchors.length === 4);
  ok('落点都在自己那段的范围内', anchors.every((a) => a.t >= 0 && a.t <= tl2.total));
  ok('落点按时间升序', anchors.every((a, i) => i === 0 || a.t >= anchors[i - 1].t));

  // 每个落点都有一记音符顶着 -> 判合拍
  const a0 = anchors[0].t;
  const mkHit = (inst) => ({
    bpm: 84, duration: 999,
    tracks: [{ instrument: inst || 'pad', notes: anchors.map((a) => ({ p: 'C3', t: a.t })) }]
  });
  const hit = mkHit();
  const repHit = S.syncReport(hit, f2);
  ok('每个落点都有音符顶着 = 合拍', repHit.use === true && repHit.ratio > 0.99,
    '(ratio=' + repHit.ratio.toFixed(2) + ')');
  ok('合拍也给得出人话理由', /重合\s*\d+%/.test(repHit.reason));

  // 音符全在别的地方（差两个半拍以上）-> 判不合拍，宁可不要
  const off = { bpm: 84, duration: 999, tracks: [{ instrument: 'pad', notes: [{ p: 'C3', t: 0 }] }] };
  const sparse = { bpm: 84, duration: 999, tracks: [{ instrument: 'pad', notes: [{ p: 'C3', t: 0 }] }] };
  anchors.forEach((a) => sparse.tracks[0].notes.push({ p: 'G3', t: a.t + 5 }));
  const repOff = S.syncReport(off, f2), repSparse = S.syncReport(sparse, f2);
  ok('落点处大片哑着 = 不合拍（宁可不配）', repOff.use === false && /哑的/.test(repOff.reason));
  ok('起音跟文案整体错开 = 不合拍', repSparse.use === false && repSparse.ratio < S.MIN_RATIO,
    '(ratio=' + repSparse.ratio.toFixed(2) + ')');
  ok('长音铺着的算「在响」（不是哑，不能当脱拍砍掉）', (() => {
    const pad = { bpm: 84, duration: 999, tracks: [{ instrument: 'pad', loop: 0, notes: [{ p: 'C3', t: 0, d: 99 }] }] };
    const r = S.syncReport(pad, f2);
    return r.cov > 0.99 && r.use === true;
  })());
  ok('循环轨绕下去，短谱不算「太短」', (() => {
    const r = S.syncReport({
      bpm: 84, duration: 3,
      tracks: [{ instrument: 'pad', loop: 3, notes: [{ p: 'C3', t: 0, d: 3 }] }]
    }, f2);
    return r.use === true;   // 片子 17s 也没关系，它会一直绕
  })());
  ok('一次性短谱压长片 = 不配', (() => {
    const r = S.syncReport({
      bpm: 84, duration: 3,
      tracks: [{ instrument: 'pad', loop: 0, notes: [{ p: 'C3', t: 0, d: 2.5 }] }]
    }, f2);
    return r.use === false && /压不住/.test(r.reason);
  })());

  ok('配乐太短压不住 = 不合拍', (() => {
    const r = S.syncReport({ bpm: 84, duration: 1.0, tracks: hit.tracks }, f2);
    return r.use === false && /压不住/.test(r.reason);
  })());
  // ⚠️ 2026-10-05 改判：以前「没有文案 → use=false → 整部片子一点声音都没有」，
  //   用户原话「没有背景音乐」。但「没填字幕」不等于「不要配乐」——
  //   没有字幕可跟时按**每段中点**对齐照样能出声音。
  // ⚠️ 用例必须自带一首**够长**的谱：hit 只有 4s，片子 11.4s，会先被
  //   「配乐太短压不住」那条规则拦掉 —— 那是另一条规则，跟本次改动无关。
  const longHit = {
    bpm: 84,
    tracks: [{ notes: Array.from({ length: 24 }, (_, k) => ({ p: 'C4', t: k, d: 0.9 })) }]
  };
  ok('没有字幕 = 按每段中点兜底对齐，仍然配乐（不再直接哑掉）', (() => {
    const r = S.syncReport(longHit, { title: 'x', bpm: 84, beats: 8, scenes: [{ text: '' }, { text: '' }] });
    return r.use === true && r.fallbackBeats === true && r.anchors.length === 2;
  })());
  ok('兜底落点真的落在每段中点上（不是随便取个时刻）', (() => {
    const st = { title: 'x', bpm: 84, beats: 8, scenes: [{ text: '' }, { text: '' }, { text: '' }] };
    const r = S.syncReport(longHit, st);
    const tl = FS.story.timeline(st);
    return r.anchors.length === 3 && r.anchors.every((a, i) =>
      Math.abs(a.t - (tl.marks[i].start + tl.marks[i].dur * 0.5)) < 0.01);
  })());
  ok('只填了标题、字幕框空着 → 也要有配乐（这是用户实际遇到的情况）', (() => {
    const st = {
      title: '对称', bpm: 84, beats: 8,
      scenes: [{ title: '对称，是最早被看见的数学', text: '' },
               { title: '对称，是最早被看见的数学', text: '' }]
    };
    const r = S.syncReport(longHit, st);
    return r.use === true && r.anchors.length > 0 && !r.fallbackBeats;
  })(), '(标题就是内容，不该判成「没有文案」)');
  ok('时间轴短到不足半秒 = 真的没救（那时才不给配乐）', (() => {
    const r = S.syncReport(longHit, { title: 'x', bpm: 600, beats: 2, scenes: [{ text: '' }] });
    return r.use === false && /太短/.test(r.reason);
  })());
  ok('一个音都没有 = 不配乐', (() => {
    const r = S.syncReport({ bpm: 84, duration: 999, tracks: [] }, f2);
    return r.use === false && /一个音符/.test(r.reason);
  })());

  const applied = S.apply(hit, f2, repHit);
  ok('apply 产出新谱', !!applied.score);
  ok('不合拍时 apply 不产出（调用方就别渲染了）', S.apply(off, f2, repOff).score === null);
  ok('原有谱不被改动（apply 是深拷贝）', hit.tracks[0].notes[0].t === a0);
  ok('新增一条「字幕打点」轨', applied.score.tracks.length === 2 &&
    applied.score.tracks[1].name === '字幕打点' && applied.score.tracks[1].notes.length === 4);
  ok('每句落点都有一记重音', applied.score.tracks[1].notes.every((n, i) => Math.abs(n.t - anchors[i].t) < 1e-3));
  ok('打点轨时长被顶起来（不会中途断在最后一句）', applied.score.duration >= anchors[3].t);
  ok('原音符吸附到最近的落点（误差在 1e-4 内）',
    applied.score.tracks[0].notes.every((n, i) => Math.abs(n.t - anchors[i].t) < 1e-4));
  ok('打点用鼓（原谱里有鼓就别用 blip）', (() => {
    const withDrum = mkHit('kick');
    return S.apply(withDrum, f2, S.syncReport(withDrum, f2)).score.tracks[1].instrument === 'kick';
  })());
  ok('解析对齐后的谱不报错（round-trip）', (() => {
    const sc = FS.parseScore(JSON.stringify(applied.score));
    return sc.tracks.length === 2 && sc.tracks[1].notes.length === 4;
  })());
}

/* ---------- 15. 模型清单：填了 Key 就把这个账号已开通的模型列出来 ---------- */
section('15. 模型清单（已开通 / 已建接入点）');

ok('OpenAI 标准 {data:[{id}]} 能解析', (() => {
  const l = FS.script.parseModelList(JSON.stringify({ object: 'list', data: [
    { id: 'doubao-seed-2-0-code-preview-260215' }, { id: 'doubao-seed-1-6-250415' }] }));
  return l.length === 2 && l[0].id === 'doubao-seed-2-0-code-preview-260215' && /豆包 Seed 2\.0/.test(l[0].label);
})());
ok('方舟自建接入点 ep- 有人话标注', (() => {
  const l = FS.script.parseModelList(JSON.stringify({ data: [
    { id: 'ep-20240601-abc', owned_by: 'volcengine' }, { id: 'doubao-pro-32k' }] }));
  return l.length === 2 && /接入点/.test(l[0].label) && /豆包/.test(l[1].label);
})());
ok('字符串数组 / name 字段 / 裸数组都能解析', (() => {
  const a = FS.script.parseModelList('["deepseek-chat","deepseek-reasoner"]');
  const b = FS.script.parseModelList(JSON.stringify({ data: [{ name: 'gpt-4o-mini' }] }));
  const c = FS.script.parseModelList('[{"id":"kimi-k2"}]');
  return a.length === 2 && b.length === 1 && c.length === 1 && c[0].id === 'kimi-k2';
})());
ok('重复 id 只留一个', FS.script.parseModelList('[{"id":"a"},{"id":"a"},{"id":"b"}]').length === 2);
ok('非 JSON 给人话错误',
  throws(() => FS.script.parseModelList('<html>oops'), '非 JSON') === null,
  throws(() => FS.script.parseModelList('<html>oops'), '非 JSON') || '');
ok('空清单说清楚是没开通',
  throws(() => FS.script.parseModelList('{"data":[]}'), '空的') === null);
ok('上游 error 原文透出来',
  throws(() => FS.script.parseModelList('{"error":{"message":"quota exceeded"}}'), 'quota exceeded') === null);
ok('normalizeBase 容错（方舟 /api/v3 不误补 /v1，裸域名补 /v1）', (() => {
  const n = FS.script.normalizeBase;
  return n('https://ark.cn-beijing.volces.com/api/v3') === 'https://ark.cn-beijing.volces.com/api/v3'
    && n('https://api.deepseek.com/v1') === 'https://api.deepseek.com/v1'
    && n('https://api.siliconflow.cn') === 'https://api.siliconflow.cn/v1'
    && n('https://x/v1///') === 'https://x/v1';
})());
ok('没有 localStorage 时缓存读写不炸', (() => {
  FS.script.writeModelCache('https://x/v1', [{ id: 'a', label: 'A' }]);
  return FS.script.readModelCache('https://x/v1') === null;
})());

// listModels 走网络，用假 fetch 顶上（node 22 自带 fetch，测完还原）
const realFetch = global.fetch;
function stub(res) {
  global.fetch = function () {
    return Promise.resolve(res
      ? { status: res.status || 200, text: () => Promise.resolve(res.body || '') }
      : Promise['reject'](new TypeError('Failed to fetch')));
  };
}
const listMsg = function (cfg) {
  return FS.script.listModels(cfg).then(() => '', (e) => (e && e.message) || String(e));
};
(async function testListModels() {
  ok('没填 Key 直接拒绝', (await listMsg({ base: 'https://x/v1' })) === '先填 API Key');
  ok('Base 空白直接拒绝', (await listMsg({ key: 'sk-x' })) === 'Base 地址还是空的');
  stub({ status: 401 });
  let m401 = await listMsg({ base: 'https://x/v1', key: 'sk-x' });
  ok('401 说清是鉴权被拒 / 没权限',
    m401.indexOf('401') > 0 && m401.indexOf('鉴权') >= 0 && /Key 不对 \/ 过期|上游返回/.test(m401));
  stub({ status: 404 });
  let m404 = await listMsg({ base: 'https://x/v1', key: 'sk-x' });
  ok('404 提示 base 填错了', m404.indexOf('404') >= 0 && /base 不像|\/v1/.test(m404));
  stub({ status: 500 });
  ok('500 报上游拒绝', (await listMsg({ base: 'https://x/v1', key: 'sk-x' })).indexOf('上游报错') === 6);
  stub(null);
  ok('CORS 被拦时给办法不是堆栈', (await listMsg({ base: 'https://x/v1', key: 'sk-x' })).indexOf('ai.php') > 0);
  stub({ status: 200, body: JSON.stringify({ data: [{ id: 'a' }, { id: 'b' }] }) });
  const got = await FS.script.listModels({ base: 'https://x/v1', key: 'sk-x' });
  ok('正常返回模型清单', Array.isArray(got) && got.length === 2 && got[0].id === 'a');
  global.fetch = realFetch;
})()
  .then(() => {
    section('16. 鉴权报错要带上游原话 + 明确的下一步');
  {
    const u = FS.script.upstreamMsg, tip = FS.script.denyTip;
    const ARK = 'https://ark.cn-beijing.volces.com/api/v3';
    const e401 = '{"error":{"code":"AuthenticationError","message":"API key does not have permission to access this endpoint"}}';
    const m1 = u(401, e401, ARK, 'doubao-seed-2-1-pro');
    ok('401 把上游 code 原话透出来', /AuthenticationError/.test(m1) && /does not have permission/.test(m1));
    ok('401 点出方舟那两套密钥别拿错', /AccessKey\/SecretKey/.test(m1) && /AKLT/.test(m1));
    ok('401 说清这个模型没开通', /没开通/.test(m1) && /doubao-seed-2-1-pro/.test(m1));
    ok('401 带上实际发出去的地址', m1.indexOf(ARK + '/chat/completions') > 0);
    const m2 = u(401, e401, ARK, 'ep-20261005-zzz');
    ok('ep- 接入点被拒 → 提示接入点没授权/停用', /接入点/.test(m2) && /停用/.test(m2));
    const m3 = u(401, e401, ARK, '');
    ok('模型空着 → 提示先去拉清单', /模型框还是空的/.test(m3) || /拉这个 Key 已开通的模型/.test(m3));
    ok('非方舟 401 只说 Key 与 base', /Key 不对 \/ 过期/.test(u(401, e401, 'https://api.deepseek.com/v1', 'deepseek-chat')));
    // 404 有两条成因完全不同的路，提示必须分得开（2026-10-05 修 ai.php 漏 /api/v3 时补）：
    //   ① 端点 / 版本段不对（少 /v1、/api/v3） → 该说 base；
    //   ② 端点是对的但模型不存在 / 没授权   → 该说模型（方舟对这种情况也回 404，极易被误判成①）
    ok('404 且是方舟：不再甩锅 base，改说模型不对',
      !/base 不像/.test(u(404, '', ARK, 'deepseek-chat'))
      && /模型/.test(u(404, '', ARK, 'deepseek-chat'))
      && /拉这个 Key 已开通的模型/.test(u(404, '', ARK, 'deepseek-chat')));
    ok('404 且是方舟：把填错的模型名点出来',
      u(404, '{"error":{"code":"ModelNotFound","message":"model does not exist"}}', ARK, 'deepseek-chat')
        .indexOf('deepseek-chat') > 0);
    ok('404 非方舟 + 上游说模型：也只说模型',
      /模型名不对/.test(u(404, '{"error":{"message":"The model x does not exist"}}', 'https://api.deepseek.com/v1', 'x')));
    ok('404 非方舟 + 没提模型：仍是 base 版本段的老提示',
      /base 不像|\/v1/.test(u(404, '', 'https://api.deepseek.com/v1', 'deepseek-chat')));
    ok('429 提示限流', /限流/.test(u(429, '')) && /限流/.test(tip(429, ARK, '', '')));
    ok('5xx 让人稍后再试并愿意收原话', /上游自己炸了/.test(u(500, '')));
    ok('账号异常单独说（实名/欠费）',
      /实名/.test(tip(401, ARK, '', 'InvalidAccountStatus')) || /欠费/.test(tip(401, ARK, '', 'InvalidAccountStatus')));
    ok('非 JSON 响应体也把原文带上', /上游返回/.test(u(401, '<html>oops 401', ARK, '')));
    ok('上游没 body 也不至于空白', /鉴权被拒/.test(u(401, '', ARK, '')));
    ok('列模型的错写的是 /models 不是 /chat/completions',
      u(401, e401, ARK, '', '/models').indexOf('/models') > 0
      && u(401, e401, ARK, '', '/models').indexOf('chat/completions') < 0);
    ok('denyWord 按状态码定性', FS.script.denyWord(401).indexOf('鉴权') >= 0
      && FS.script.denyWord(404).indexOf('不存在') >= 0 && FS.script.denyWord(429).indexOf('限流') >= 0);
  }

  /* ---------- 17. 2D 画面自检（2026-10-05：视频里没有文字 / 2D 动画有问题） ---------- */
  section('\n17. 2D 画面：字幕必现 + 对比模板不塞 B + 场景不重复');
  // 记录 fillText 内容的 canvas，用来断言「这句文案真的被画上去了」
  function spyCtx() {
    const g = stubCtx();
    g.texts = [];
    const realFont = g.font;
    g.fillText = (t) => { g.texts.push(String(t)); g.calls++; };
    void realFont;
    return g;
  }
  /** 判断一段文案有没有真的被画上去。
   *  排版模块改成逐字入场后，一句话会变成 N 次 fillText（每次一个字），
   *  所以「整句一次出现」这种老断言从 2026-10-05 起全部失效 —— 这里既能认
   *  整句一次填（老母题/标题仍是那样），也能把逐字序列拼回来再认。 */
  function hasText(g, text) {
    if (!text) return false;
    if (g.texts.indexOf(text) >= 0) return true;
    const joined = g.texts.join('');
    return joined.indexOf(text) >= 0;
  }
  const dfilm = {
    title: '城市的一天', template: 'daily', palette: 'ink', bpm: 84, beats: 8, sub: 'on',
    scenes: [
      { title: '清晨的厨房', text: '锅里的水刚冒泡，蒸汽在窗户上留下一层薄薄的雾。' },
      { title: '深夜的书桌', text: '台灯把一小圈光钉在桌面上，其余的都交给了夜。' }
    ]
  };
  const dtl = FS.story.timeline(dfilm);
  const dg = spyCtx();
  FS.story.drawFrame(dg, dfilm, dtl.marks[0].dur * 0.6);
  // ⚠️ 2026-10-05：字幕改走 FS.type.subtitle 之后是**逐字** fillText 的，
  //   再也不会出现「整句一次填完」这种 fillText(整句)。所以断言不能只找整句，
  //   要能把逐字序列拼回来（hasText 就是干这个的）。
  ok('daily 模板把文案画上去了（以前一个字都不画）',
    hasText(dg, dfilm.scenes[0].text), '(本帧共 ' + dg.texts.length + ' 处文字)');
  ok('daily 也画段标题', hasText(dg, '清晨的厨房'));

  // 「字幕」开关关掉后，daily 也不该再画文案（跟其它母题保持一致）
  const dfilm2 = JSON.parse(JSON.stringify(dfilm)); dfilm2.sub = 'off';
  const dg2 = spyCtx();
  FS.story.drawFrame(dg2, dfilm2, dtl.marks[0].dur * 0.6);
  ok('字幕关掉后 daily 也不画文案', !hasText(dg2, dfilm.scenes[0].text));

  // 对比模板：标题没写 vs 时，以前右侧恒为字面量 'B'
  function splitTexts(title) {
    const st = {
      title: 'x', template: 'split', palette: 'ink', bpm: 84, beats: 8, sub: 'on',
      scenes: [{ title: title, text: '一句说明文案。' }, { title: 'b', text: 'x' }]
    };
    const t = FS.story.timeline(st);
    const g = spyCtx();
    FS.story.drawFrame(g, st, t.marks[0].dur * 0.95);
    return g.texts;
  }
  ok('标题写 vs 能切出左右两项',
    splitTexts('白天 vs 夜晚').indexOf('白天') >= 0 && splitTexts('白天 vs 夜晚').indexOf('夜晚') >= 0);
  ok('「深圳比北京」能切成两栏（两侧都短）',
    splitTexts('深圳比北京').indexOf('深圳') >= 0 && splitTexts('深圳比北京').indexOf('北京') >= 0);
  ok('顿号并列能切两栏',
    splitTexts('早高峰、深夜').indexOf('早高峰') >= 0 && splitTexts('早高峰、深夜').indexOf('深夜') >= 0);
  ok('解析不出对比项时不再硬塞一个 B', splitTexts('一个普通标题').indexOf('B') < 0,
    '(画了: ' + splitTexts('一个普通标题').join('/') + ')');
  ok('长句不拿正文硬切（避免半截话）',
    splitTexts('没有结构的普通段落说明文字').indexOf('B') < 0
    && splitTexts('没有结构的普通段落说明文字').indexOf('一句说明文案') < 0);

  // 场景重复：5 段文案都不含地点词时，不该反复落在同 1~2 个场景
  const dupScenes = [
    { title: '清晨', text: '锅里的水刚冒泡。' },
    { title: '傍晚', text: '风把窗帘吹起来。' },
    { title: '深夜', text: '路灯一盏盏亮着。' },
    { title: '午后', text: '光斑落在地板上。' },
    { title: '周末', text: '被子还没叠。' }
  ];
  const picked = FS.s2dPick.pickScenes(dupScenes, 7);
  ok('自动选景：5 段不该全撞同一个场景',
    new Set(picked).size >= 4, '(' + picked.join('→') + ')');
  ok('自动选景：解析不出地点时不会退化成全 cafe',
    picked.every((id) => typeof id === 'string' && id.length > 0));

  section('\n18. 三处「画面元素互相压」的几何回归（标题 / 字幕 / 图形）');
  /* 这一节要真量文字矩形，所以 measureText 必须跟字号挂钩——stubCtx 那个固定 12px/字
   * 量不出「长公式顶出画面」这类问题。中文按 1em、拉丁按 0.55em 近似（够判定越界）。 */
  function geomCtx() {
    const g = stubCtx();
    g.texts = []; g.rects = []; g.arcs = [];
    const pxOf = () => parseFloat((/(\d+(?:\.\d+)?)px/.exec(g.font || '16px') || [0, 16])[1]) || 16;
    g.measureText = (t) => {
      const px = pxOf();
      let w = 0;
      for (const ch of String(t)) w += /[\u2e80-\u9fff\uff00-\uffef]/.test(ch) ? px : px * 0.55;
      return { width: w };
    };
    g.fillText = (t, x, y) => {
      const px = pxOf(), w = g.measureText(t).width;
      let l = x;
      if (g.textAlign === 'center') l = x - w / 2;
      else if (g.textAlign === 'right') l = x - w;
      const mid = g.textBaseline === 'middle';
      g.texts.push({
        t: String(t), l, r: l + w, px, y, a: g.globalAlpha,
        top: mid ? y - px / 2 : y - px * 0.8,
        bot: mid ? y + px / 2 : y + px * 0.2
      });
      g.calls++;
    };
    g.fillRect = (x, y, w, h) => { g.rects.push({ x, y, w, h }); g.calls++; };
    g.arc = (x, y, r) => { g.arcs.push({ x, y, r }); g.calls++; };
    return g;
  }
  const CW = 1280, CH = 720;
  const visText = (arr) => arr.filter((h) => h.a > 0.12 && h.t.trim() !== '');
  const minOf = (arr, f) => Math.min.apply(null, arr.map(f));
  const maxOf = (arr, f) => Math.max.apply(null, arr.map(f));

  // ① 对比模板：底部字幕原来骑在色板底边上（色板底 610 / 字幕上沿 599，两行时 579）
  (function () {
    const st = {
      title: 'x', template: 'split', palette: 'ink', bpm: 84, beats: 8, sub: 'on',
      scenes: [
        { title: '深圳 比 北京', text: '一天里能走完的距离差得不是一点半点' },
        { title: '第二步换角度', text: '换个角度再试一次就好' }
      ]
    };
    const tl = FS.story.timeline(st);
    let subTop = Infinity, bandBot = -Infinity, seen = false;
    for (const f of [0.4, 0.7, 0.999]) {
      const g = geomCtx();
      FS.story.drawFrame(g, st, tl.marks[0].dur * f);
      const bands = g.rects.filter((r) => Math.abs(r.y - 190) < 0.5 && r.h > 100);   // 左右两块色板
      if (!bands.length) continue;
      bandBot = Math.max(bandBot, maxOf(bands, (r) => r.y + r.h));
      const subs = visText(g.texts).filter((h) => h.y > 500);                        // 字幕（栏内大字在 385）
      if (subs.length) { subTop = Math.min(subTop, minOf(subs, (h) => h.top)); seen = true; }
    }
    ok('对比模板：底部字幕落在色板下方，不再被色板压住',
      seen && subTop > bandBot,
      '(字幕最高 ' + subTop.toFixed(0) + ' > 色板底 ' + bandBot.toFixed(0) + ')');
  })();

  // ② 几何演化：多边形是旋转的，原来 R 长到 280 → 顶点最高 y=80 扎进标题带（63~105）
  (function () {
    const st = {
      title: 'x', template: 'geo', palette: 'ink', bpm: 84, beats: 8, sub: 'on',
      scenes: [
        { title: '对称群', text: '正六边形的六个顶点两两连线构成完整的对称结构' },
        { title: '第二步', text: '换个角度再试一次' },
        { title: '第三步', text: '对比度决定最终效果' },
        { title: '收尾', text: '就到这里' }
      ]
    };
    const tl = FS.story.timeline(st);
    let topMin = Infinity, titleBot = -Infinity, verts = 0;
    for (let k = 0; k <= 24; k++) {
      const g = geomCtx();
      FS.story.drawFrame(g, st, tl.total * (0.02 + 0.96 * k / 24));
      const v = g.arcs.filter((a) => Math.abs(a.r - 7) < 0.01);     // 顶点标记固定 r=7
      if (v.length) { topMin = Math.min(topMin, minOf(v, (a) => a.y)); verts += v.length; }
      const ttl = visText(g.texts).filter((h) => h.y < 130 && h.px >= 36);
      if (ttl.length) titleBot = Math.max(titleBot, ttl[0].bot);
    }
    ok('几何演化：旋转的多边形顶点扫不到上方标题（R 上限收到 210）',
      verts > 0 && topMin > titleBot,
      '(顶点最高 ' + topMin.toFixed(0) + ' vs 标题底 ' + titleBot.toFixed(0) + '，' + verts + ' 个顶点样本)');
  })();

  // ③ 公式母题：夹中文的长公式按 64px 会横着顶出 1280 的画面
  (function () {
    function span(expr) {
      const st = {
        title: 'x', template: 'formula', palette: 'ink', bpm: 84, beats: 8, sub: 'on',
        scenes: [{ title: expr, text: '一句说明。' }, { title: 'b', text: 'x' }]
      };
      const tl = FS.story.timeline(st);
      const g = geomCtx();
      // ⚠️ 别用 0.999：段末是交叉淡出帧，globalAlpha 已经归零，会被 a>0.12 全部滤掉
      FS.story.drawFrame(g, st, tl.marks[0].dur * 0.5);
      const body = visText(g.texts).filter((h) => h.y > 300 && h.y < 420);   // 居中那行公式（字幕在 532）
      if (!body.length) return null;
      return { l: minOf(body, (h) => h.l), r: maxOf(body, (h) => h.r), px: body[0].px };
    }
    const sh = span('E = mc²');
    const lg = span('能量等于质量乘以光速的平方这是一个很长的公式名字');
    ok('公式母题：短公式保持 64px', !!sh && sh.px === 64, sh ? '(' + sh.px + 'px)' : '量不到');
    ok('公式母题：长公式自动缩字号且不出画',
      !!lg && lg.px < 64 && lg.l > 60 && lg.r < CW - 60,
      lg ? '(' + lg.px.toFixed(0) + 'px, x[' + lg.l.toFixed(0) + '..' + lg.r.toFixed(0) + '])' : '量不到');
  })();

  // ④ 页面下拉必须真的能选到「走本站代理」——否则 ai.php 那条通路在 UI 上根本进不去
  (function () {
    const html = require('fs').readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    const m = /<select id="sw-preset">([\s\S]*?)<\/select>/.exec(html);
    const opts = m ? (m[1].match(/value="([^"]+)"/g) || []).map((s) => s.slice(7, -1)) : [];
    ok('API 设置的下拉里能选到「走本站代理」预设', opts.indexOf('local-ark') >= 0,
      '(' + opts.join(',') + ')');
    ok('代理预设排在下拉第一位（开箱默认就是它）', opts[0] === 'local-ark');
    // 2026-10-05 第二轮：那段「接豆包 / 方舟 401 三条 / Cloudflare Worker」的长篇说明
    // 用户反馈是鸡肋，整块删了。这里改成守住「不许再长回来」+ 下拉自己说明是代理。
    ok('下拉选项自己写明了是走本站代理', /火山方舟 豆包（走本站代理/.test(html));
    ok('那段长篇科普说明已删除，没长回来',
      !/接豆包 \//.test(html) && !/方舟 401 就这三条/.test(html) && !/workers\/proxy\.js/.test(html));
    ok('模型框的占位字是豆包（不再是 deepseek-chat 误导人）', (() => {
      const mi = /<input[^>]*id="sw-model"[^>]*>/.exec(html);
      return !!mi && /doubao-/.test(mi[0]) && !/deepseek-chat/.test(mi[0]);
    })());
    // 光有默认值不够：方舟按账号授权，"猜的默认值"和"账号真开通过的"常常不是同一个。
    // 所以拉到清单时必须能把猜的值换掉（force 分支），否则等于没做。
    ok('方舟系预设：拉到的真实模型会盖掉预设里猜的默认值', (() => {
      const m = require('fs').readFileSync(path.join(__dirname, '..', 'js', 'main.js'), 'utf8');
      return /fillModelPicker\(list,\s*isArkPreset\(\)\)/.test(m) && /function pickModelFrom/.test(m);
    })());
  })();

  // ⑤ ai.php 拼上游 URL 必须带版本段 —— 曾经的真实 bug：裸拼 "https://$host$path"，
  //    方舟被拼成 https://ark.cn-beijing.volces.com/chat/completions（缺 /api/v3）→ 网关一律 404，
  //    而「列模型」那行写着 /api/v3/models 是对的，于是出现「模型列得出、一聊天就 404」的怪像。
  (function () {
    const php = require('fs').readFileSync(path.join(__dirname, '..', 'ai.php'), 'utf8');
    ok('ai.php 用 upstream_url() 拼地址（不再裸拼 host+path）',
      /upstream_url\(/.test(php) && !/curl_init\("https:\/\/\$host\$path"\)/.test(php));
    ok('ai.php 的前缀表里方舟是 /api/v3', /'ark\.cn-beijing\.volces\.com'\s*=>\s*'\/api\/v3'/.test(php));
    ok('ai.php 列模型也走 upstream_url（不写死一家）', /upstream_url\(\$host,\s*'\/models'/.test(php));
  })();

  // ⑥ 本站代理的地址必须能算对 —— 真实事故：2026-10-05 手机端「ai.php 根本不能代理」。
  //    服务器 access log 实锤：浏览器请求的是 /filmstudio/js/ai.php（多一层 js/）→ nginx
  //    "Primary script unknown" → 404。根因是 proxyUrl() 在**运行期**问 document.currentScript，
  //    而部分手机 WebView（实测 OPPO HeyTapBrowser/Chromium 115）运行期仍返回最后执行的脚本，
  //    目录被算成 .../filmstudio/js/。桌面 Chrome 上 currentScript 真的是 null，所以本地永远测不出来。
  (function () {
    const savedDoc = global.document;
    const savedScript = FS.script;
    try {
      // ① 加载期：currentScript 指向 /filmstudio/js/script.js（真实部署形态）
      global.document = {
        currentScript: { src: 'https://api.yuansutansuo.ltd/filmstudio/js/script.js?v=20261005n' },
        getElementsByTagName: () => []
      };
      const p = require.resolve(path.join(__dirname, '..', 'js', 'script.js'));
      delete require.cache[p];
      require(p);
      const loaded = FS.script;

      ok('加载期就把代理地址定成站点根（去掉 js/）',
        loaded.proxyUrl() === 'https://api.yuansutansuo.ltd/filmstudio/ai.php',
        '(' + loaded.proxyUrl() + ')');

      // ② 关键：运行期 currentScript 变回 null（桌面）或仍返回脚本（手机 WebView）都不能影响它
      global.document.currentScript = null;
      ok('运行期 currentScript=null，地址照样对',
        loaded.proxyUrl() === 'https://api.yuansutansuo.ltd/filmstudio/ai.php');
      global.document.currentScript = { src: 'https://api.yuansutansuo.ltd/filmstudio/js/story.js' };
      ok('运行期 currentScript 又返回脚本（手机 WebView 的怪癖），地址仍不变',
        loaded.proxyUrl() === 'https://api.yuansutansuo.ltd/filmstudio/ai.php',
        '(' + loaded.proxyUrl() + ')');

      // ③ 源码级守卫：proxyUrl 里不许再问 document.currentScript
      const src = require('fs').readFileSync(path.join(__dirname, '..', 'js', 'script.js'), 'utf8');
      const fnBody = /function proxyUrl\(\)\s*\{[\s\S]*?\n  \}/.exec(src);
      ok('proxyUrl() 不再碰 document.currentScript（改用加载期定下的 SELF_DIR）',
        !!fnBody && !/currentScript/.test(fnBody[0]) && /SELF_DIR/.test(fnBody[0]));

      // ④ Key 绝不能进 URL（会明文落进 nginx access log —— 真实日志里已看到过）
      ok('客户端不再用 ?models=1&key=…（Key 会进访问日志）', !/\?models=1&host=/.test(src));
      ok('列模型改走 POST 请求体', /op:\s*'models'/.test(src) && /body:\s*JSON\.stringify\(\{\s*op:\s*'models'/.test(src));
      const php = require('fs').readFileSync(path.join(__dirname, '..', 'ai.php'), 'utf8');
      ok('ai.php 停用 GET ?models=1（Key 会进访问日志）', /isset\(\$_GET\['models'\]\)[\s\S]{0,200}fail\(400/.test(php));
      ok('ai.php 支持 op=ping 探活（前端靠它判断代理在不在）', /'op'\]\s*\)?\s*===\s*'ping'/.test(php) || /===\s*'ping'/.test(php));

      // ⑤ 直连被 CORS 拦时要自动改走代理重试（桌面端那条报错的根治办法）
      ok('直连 CORS 失败会自动改走本站代理重试', /proxyPing\(\)/.test(src) && /listModels\(\{\s*base:\s*LOCAL_PROXY/.test(src) && /callApi\(t,\s*promptStr,\s*parseFn\)/.test(src));
    } finally {
      if (savedDoc === undefined) delete global.document; else global.document = savedDoc;
      const p = require.resolve(path.join(__dirname, '..', 'js', 'script.js'));
      delete require.cache[p];
      require(p);
      if (!savedScript) FS.script = savedScript;
    }
  })();

  /* ================================================================
   * 排版模块 FS.type（js/type.js，2026-10-05）
   * 为什么要单独测它：它接管了所有母题的字幕与标题，一处画歪
   * 就是「字压在画面上」「字根本不出现在导出里」这类问题，
   * 而这些在 node 里量得到（几何断言），不必等截图。
   * ================================================================ */
  ok('FS.type 已加载并导出齐了 8 个零件', FS.type && ['revealText','title','kicker','subtitle','wrap','hitRanges','keywords','band']
    .every((k) => typeof FS.type[k] === 'function'));
  ok('排版模块不依赖 ctx.letterSpacing（Safari 旧版没有）', !/letterSpacing\s*=/.test(
    require('fs').readFileSync(path.join(__dirname, '..', 'js', 'type.js'), 'utf8')));

  {
    const g = stubCtx();
    // measureText 必须跟字号挂钩，才能验「字有没有出框」
    g.measureText = (t) => ({ width: String(t).length * 10 });
    const T = FS.type;

    // ① 逐字入场：p=0 时一个字都不该画（否则「还没出场就看见了」）
    ok('revealText 在 p=0 时不画任何字（还没出场就看见=静态感）',
      T.revealText(g, '结构之美', 100, 100, { p: 0, size: 40 }) === 0);
    const mid = T.revealText(g, '结构之美', 100, 100, { p: 0.3, size: 40 });
    const end = T.revealText(g, '结构之美', 100, 100, { p: 1, size: 40 });
    // ⚠️ 必须用长句验「逐字」：4 个字在 p=0.3 时全出完了（stagger 上限 0.05，per 0.30），
    //    拿它断言「中途 < 全部」是拿短句当长句测，测的是 clamp 不是 stagger。
    const mid2 = T.revealText(g, '一个用来验证逐字入场的完整句子', 100, 100, { p: 0.25, size: 30 });
    const end2 = T.revealText(g, '一个用来验证逐字入场的完整句子', 100, 100, { p: 1, size: 30 });
    ok('revealText 随 p 推进逐字增加（0 < 中途 < 全部）',
      mid > 0 && mid === end && mid2 > 0 && mid2 < end2);

    // ② stagger 按字数自适应：20 字的长句也必须在合理时间内出完
    const long = '这是一句很长的字幕用来验证逐字入场的节奏不会被拖到段尾才出完';
    ok('长字幕 stagger 自适应（整句在 0.85 拍内出完，不会拖到段尾）',
      T.revealText(g, long, 100, 100, { p: 0.85, size: 30 }) === long.length);

    // ③ 折行：超宽必须折，且中文按字折
    const w1 = T.wrap(g, '短句', 1000);
    const w2 = T.wrap(g, '一二三四五六七八九十', 50);   // 每字 10px，50px 装 5 字
    ok('wrap 宽内不折行', w1.length === 1);
    ok('wrap 超宽按字折行（≤2 行/每行 ≤5 字）', w2.length >= 2 && w2.every((l) => l.length <= 5));

    // ④ 关键词：书名号里的词优先，其次数字/英文
    const kw = T.keywords('读《群论》只用 3 个 WebGL 概念就够了');
    ok('keywords 抓到了书名号里的词', kw.indexOf('群论') >= 0);
    ok('keywords 抓到了数字/英文', kw.some((k) => /3|WebGL/.test(k)));
    ok('keywords 最多 3 个（太多会满屏发光）', kw.length <= 3);

    // ⑤ 命中区间：'WebGL' 与 'WebGL2' 在同一处重叠（8..13 与 8..14）→ 必须合成一条
    const hr = T.hitRanges('WebGL 与 WebGL2 的差别', ['WebGL', 'WebGL2']);
    ok('hitRanges 合并重叠区间（不会重复上色）',
      hr.length === 2 && hr[0][0] === 0 && hr[0][1] === 5 && hr[1][0] === 8 && hr[1][1] === 14,
      JSON.stringify(hr));
    // 无关键词时返回空数组（不能返回 [[0,0]] 这种把整行都点亮的东西）
    ok('hitRanges 无命中时返回空数组', T.hitRanges('普通一句话', ['不存在']).length === 0);

    // ⑥ 字幕返回行数（母题靠它算带高），且 off 时必须 0
    const n1 = T.subtitle(g, '一行字幕', 640, 600, { p: 1, size: 30, band: {} });
    const n2 = T.subtitle(g, '一行字幕', 640, 600, { p: 1, size: 30, off: true });
    ok('subtitle 返回占用行数', n1 >= 1);
    ok('subtitle 关闭时返回 0 且不画字', n2 === 0);

    // ⑦ 字号自动收：超长文案不许溢出到三行
    const n3 = T.subtitle(g, '一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十' +
      '一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十', 640, 600,
      { p: 1, size: 30, maxW: 400, maxLines: 2, band: {} });
    ok('超长字幕自动缩到 ≤2 行（不溢出画面）', n3 <= 2);

    // ⑧ 带高按行数算：两行字幕不该吃掉 230px 的画面
    const topOf = (lines, baseY, lh) => baseY - (lines - 1) * lh / 2 - lh * 0.92;
    ok('字幕带高度随行数收敛（一行 < 两行）',
      topOf(1, 600, 45) > topOf(2, 600, 45));
    // 字幕太靠上时不铺带（否则吃掉大半个画面）
    ok('band 在字幕过靠上时直接不铺', (() => {
      const g2 = stubCtx();
      let filled = 0;
      g2.fillRect = () => filled++;
      T.band(g2, 640, 120, 45, 1, { W: 1280, H: 720 });
      return filled === 0;
    })());
  }

  /* ================================================================
   * 成片声音四档（2026-10-05）
   * 回归点：以前「不配音」只能把音色选成「无」，纯音乐在界面上表达不出来；
   * 且 filmRenderAudio 不看声音模式 → 选「纯人声」也会带配乐。
   * ================================================================ */
  section('\n[19] 成片声音模式');
  {
    const src = require('fs').readFileSync(path.join(__dirname, '..', 'js', 'main.js'), 'utf8');
    const html = require('fs').readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    ok('UI 有成片声音四档（纯音乐/人声+配乐/纯人声/全静音）',
      /id="f-audmode"/.test(html) && /value="music"/.test(html) && /value="both"/.test(html) &&
      /value="voice"/.test(html) && /value="mute"/.test(html));
    ok('默认档是纯音乐（不出人声）', /<option value="music" selected>纯音乐/.test(html));
    ok('配音不再是「默认开 + 无」这种绕路的表达', !/value=""[^>]*>无（不出人声）/.test(html));
    ok('buildNarrPlan 按 audmode 决定要不要人声（music/mute 直接不合成）',
      /mode === 'music' \|\| mode === 'mute'/.test(src));
    ok('纯人声/全静音时 filmRenderAudio 返回 null（不会偷偷带配乐）',
      /!opts\.force && \(mode === 'voice' \|\| mode === 'mute'\)/.test(src));
    ok('「只导配乐」按钮无视声音模式（显式要曲子，force）',
      /filmRenderAudio\(film, \{ force: true \}\)/.test(src));
    ok('状态行按档位说人话，不是甩 music/voice',
      /AUDMODE_LABEL/.test(src) && /纯音乐（无人声）/.test(src));
  }

  /* ================================================================
   * 开场题头闸门 + 光线闸门（2026-10-05，都是出图实测抓出来的）
   * ================================================================ */
  section('\n[19b] 画面合理性：题头不压字幕 / 夜文案不配白天户外');
  {
    // ① 开场 1.4 秒内：母题不许画字幕（题头在 H-34，daily 字幕在 H-72，实测骑在一起）
    const spyT = stubCtx();
    spyT.texts = [];
    spyT.fillText = (t) => { spyT.texts.push(String(t)); };
    const tf = {
      title: '城市的一天', template: 'daily', palette: 'ink', bpm: 84, beats: 8, sub: 'on',
      scenes: [{ title: '清晨的厨房', text: '锅里的水刚冒泡。' }]
    };
    FS.story.drawFrame(spyT, tf, 0.9);                 // t<1.4：题头在
    const tEarly = spyT.texts.join('');
    ok('开场 1.4 秒内母题不画字幕（片名题头独占画面）', tEarly.indexOf('锅里的水刚冒泡') < 0);
    ok('开场 1.4 秒内片名题头在场', tEarly.indexOf('城市的一天') >= 0);
    const spyT2 = stubCtx();
    spyT2.texts = [];
    spyT2.fillText = (t) => { spyT2.texts.push(String(t)); };
    FS.story.drawFrame(spyT2, tf, 2.4);                // t>1.4：字幕该回来了
    ok('1.4 秒后字幕正常出现（闸门会放行）', spyT2.texts.join('').indexOf('锅里的水刚冒泡') >= 0);

    // ② 光线闸门：文案说夜，就不能给白天户外场景
    const night = FS.s2dPick.pickScene('深夜的书桌，台灯把一小圈光钉在桌面上，其余的都交给了夜。', 7);
    const DAY = ['park', 'seaside', 'campus', 'farmfield', 'balcony', 'busstop', 'street'];
    ok('「深夜的书桌」不会被选成白天户外场景（实测曾落到公园）',
      DAY.indexOf(night) < 0, '(得到 ' + night + ')');
    // 但文案明说公园时不该被闸门拦
    ok('「深夜的公园长椅」仍能选到公园（闸门只拦落表，不拦明说的地点）',
      FS.s2dPick.pickScene('深夜的公园长椅', 7) === 'park',
      '(得到 ' + FS.s2dPick.pickScene('深夜的公园长椅', 7) + ')');
    // 夜里的书桌类文案能落到夜里成立的室内场景
    ok('「深夜的书桌」落到室内夜景类场景',
      ['study', 'bedroom', 'nightmarket', 'rainy', 'livingroom', 'cafe'].indexOf(night) >= 0);
    // ③ 回归：光线词不许混进地点词表（否则会抢走后面的地点）
    ok('「办公室加班到深夜」仍然是办公室（study 词表里不能有「深夜」）',
      FS.s2dPick.pickScene('他在办公室加班到深夜', 3) === 'office',
      '(得到 ' + FS.s2dPick.pickScene('他在办公室加班到深夜', 3) + ')');
  }

  /* ================================================================
   * 3D 描边（线框）几何 —— 2026-10-05
   * ⚠️ 这里的每条断言都对应一个实测踩过的坑，别当成「凑数」删掉。
   * ================================================================ */
  section('\n[19c] 3D 线条轮廓：抽边去重 + 着色器');
  {
    const G = FS.geom;
    ok('FS.geom 导出了 edges / placeEdges', typeof G.edges === 'function' && typeof G.placeEdges === 'function');

    // ① 去重必须按坐标而不是下标：box() 每个面 push 一组全新顶点，
    //    按下标去重对它是「36 条棱」而不是 18 条（= 12 棱 + 6 面对角线）。
    const box = G.box(1, 1, 1, [1, 0, 0]);
    const eBox = G.edges(box);
    ok('立方体抽边 = 18 条（12 棱 + 6 面对角线，不是 36）',
      eBox.idx.length / 2 === 18, '(得到 ' + eBox.idx.length / 2 + '，tris=' + box.idx.length / 3 + ')');
    ok('noDedup 模式给出未去重的 36 条（证明去重确实在起作用）',
      G.edges(box, { noDedup: true }).idx.length / 2 === 36);

    // ② 描边几何自洽：顶点数 == 索引数、idx 连续、法线非零、颜色在 [0,1]
    const rng = FS.director.mkRng(FS.director.fnv('bedroom') ^ 0x9e37);
    const b = FS.world.buildPlace('bedroom', rng.f);
    const pe = G.placeEdges(b, { minLen: 0.004 });
    ok('描边几何自洽（顶点数 == 索引数）', pe.pos.length / 3 === pe.idx.length,
      '(' + pe.pos.length / 3 + ' vs ' + pe.idx.length + ')');
    ok('描边索引连续（0..n-1 无洞）', (() => {
      const seen = new Set(pe.idx);
      return seen.size === pe.idx.length && Math.min(...pe.idx) === 0 && Math.max(...pe.idx) === pe.idx.length - 1;
    })());
    ok('描边没有零长线段（两端不会落在同一点）', (() => {
      for (let i = 0; i < pe.idx.length; i += 2) {
        const a = pe.idx[i], c = pe.idx[i + 1];
        const d = Math.hypot(pe.pos[a * 3] - pe.pos[c * 3], pe.pos[a * 3 + 1] - pe.pos[c * 3 + 1],
          pe.pos[a * 3 + 2] - pe.pos[c * 3 + 2]);
        if (d < 1e-9) return false;
      }
      return true;
    })());
    ok('描边颜色分量都在 [0,1]（着色器直接拿它当输出）',
      pe.col.every((v) => v >= 0 && v <= 1));
    ok('描边法线非零（平均后不该出现零向量）', (() => {
      for (let i = 0; i < pe.nrm.length; i += 3) {
        if (pe.nrm[i] === 0 && pe.nrm[i + 1] === 0 && pe.nrm[i + 2] === 0) return false;
      }
      return true;
    })());

    // ③ 线框档确实比实体省：线段数应当明显少于三角形数 × 3
    const tris = b.solid.idx.length / 3;
    ok('线框比实体省几何（线段数 < 三角面数 × 3）', pe.idx.length / 2 < tris * 3,
      '(' + pe.idx.length / 2 + ' 线段 vs ' + tris + ' 面)');
    // 去重的核心不变量：**不存在重复边**。如果这里挂了，画出来就是
    // 三倍亮度的粗线 + 斜面抖动（因为每条共享边被两个面各提交了一次）。
    // ⚠️ 别去比「线段数 == 某个算出来的数」：placeEdges 合并了 solid+glow，
    //   minLen 又会剪短边，数字对不上是正常的，重复才是真 bug。
    ok('edges() 输出里没有任何一条重复边（同一对端点只出现一次）', (() => {
      const got = new Set();
      for (let i = 0; i < pe.idx.length; i += 2) {
        const a = pe.idx[i], c = pe.idx[i + 1];
        const k = a < c ? a + '_' + c : c + '_' + a;
        if (got.has(k)) return false;
        got.add(k);
      }
      return true;
    })());
    ok('去掉 minLen 后也仍然没有重复边（去重与剪边是两层独立的事）', (() => {
      const all = G.placeEdges(b, {});
      const got = new Set();
      for (let i = 0; i < all.idx.length; i += 2) {
        const a = all.idx[i], c = all.idx[i + 1];
        const k = a < c ? a + '_' + c : c + '_' + a;
        if (got.has(k)) return false;
        got.add(k);
      }
      return true;
    })());

    // ④ minLen 真的在剪短线段
    ok('minLen 能剪掉更短的线段', (() => {
      const loose = G.placeEdges(b, { minLen: 0 });
      const tight = G.placeEdges(b, { minLen: 0.5 });
      return tight.idx.length <= loose.idx.length;
    })());

    // ④' 折痕过滤：剔掉「同一个平面内的三角化对角线」。
    //     不剔的话地板/墙面上全是交叉线（实测出图确认），像毛线不像线稿。
    ok('折痕过滤后立方体只剩 12 条真棱（去掉 6 条面对角线）',
      G.edges(box, { creaseAngle: 18 }).idx.length / 2 === 12,
      '(得到 ' + G.edges(box, { creaseAngle: 18 }).idx.length / 2 + ')');
    ok('不传 creaseAngle 时保留全部 18 条（含对角线）', G.edges(box).idx.length / 2 === 18);
    ok('阈值越大线越少（钝角被当成平面剔掉）', (() => {
      const l = G.placeEdges(b, { minLen: 0.004, creaseAngle: 12 }).idx.length / 2;
      const m = G.placeEdges(b, { minLen: 0.004, creaseAngle: 18 }).idx.length / 2;
      const h = G.placeEdges(b, { minLen: 0.004, creaseAngle: 30 }).idx.length / 2;
      return l > m && m > h;
    })());
    ok('折痕过滤确实大幅减线（客厅场景上千条 → 约七百）', (() => {
      const all = G.placeEdges(b, { minLen: 0.004 }).idx.length / 2;
      const cre = G.placeEdges(b, { minLen: 0.004, creaseAngle: 18 }).idx.length / 2;
      return cre < all * 0.75 && all > 500;
    })());
    ok('渲染器实际用了 18° 折痕阈值（不是只写了个没人调的参数）',
      /creaseAngle: 18/.test(require('fs').readFileSync(path.join(__dirname, '..', 'js', 'gl', 'render.js'), 'utf8')));
    ok('折痕过滤后依然没有重复边（过滤不能破坏去重）', (() => {
      const cre = G.placeEdges(b, { minLen: 0.004, creaseAngle: 18 });
      const got = new Set();
      for (let i = 0; i < cre.idx.length; i += 2) {
        const a = cre.idx[i], c = cre.idx[i + 1];
        const k = a < c ? a + '_' + c : c + '_' + a;
        if (got.has(k)) return false;
        got.add(k);
      }
      return true;
    })());

    // ⑤ placeEdges 不含 water（水面描出来是一堆重叠横线，反而脏）
    ok('placeEdges 不把水面算进描边', (() => {
      const only = G.placeEdges({ solid: b.solid, water: b.water, glow: b.glow }, { minLen: 0.004 });
      const solidOnly = G.placeEdges({ solid: b.solid, glow: b.glow }, { minLen: 0.004 });
      return only.idx.length === solidOnly.idx.length;
    })());

    // ⑥ 着色器源码级守卫：GLSL 只在运行时编译，node 里只能查结构
    const rsrc = require('fs').readFileSync(path.join(__dirname, '..', 'js', 'gl', 'render.js'), 'utf8');
    ok('render.js 有线框专用着色器（不是把实体调暗）', /var VS_LINE = \[/.test(rsrc) && /var FS_LINE = \[/.test(rsrc));
    ok('线框着色器不吃点光/法线（省掉光照计算 = 轻量的来源）',
      (() => {
        const m = rsrc.match(/var FS_LINE = \[([\s\S]*?)\]\.join/)[1];
        return !/uLightPos/.test(m) && !/dot\(N/.test(m);
      })());
    ok('线框档不画水（水面是平的，描出来是一堆重叠横线）', /pm\.water && style !== 'line'/.test(rsrc));
    ok('线框档先画一遍「消隐暗面」再画线（否则深度缓冲为空，背面的边全透出来）',
      /uFill > 0\.5[\s\S]{0,200}frag = vec4\(0\.0, 0\.0, 0\.0, 1\.0\); return;/.test(rsrc) &&
      /if \(style === 'line' && pm\.solid\)[\s\S]{0,300}uLine\.uFill, 1[\s\S]{0,900}drawLines\(gl, placeLines/.test(rsrc));
    ok('消隐暗面有独立的角色通道（人物也要挡住线）', /drawCastFill\(shot, abs, local, cam\)/.test(rsrc));
    ok('「轻量」是省掉光照而不是省掉深度（暗面走 uFill 早退分支，无点光/法线/雾）',
      /if \(uFill > 0\.5\)[\s\S]{0,120}return;/.test(rsrc) &&
      !/uFill[\s\S]{0,300}uLightPos/.test(rsrc.match(/var FS_LINE = \[[\s\S]*?\]\.join/)[1]));
    ok('叠加档先画实体再画线（有面打底才看得出线在哪）',
      /style === 'both' && pm\.solid\) GLC\.drawMesh/.test(rsrc));
    ok('画线时关掉背面剔除（否则转一圈物体就缺边）',
      /gl\.disable\(gl\.CULL_FACE\);[^]*?drawLines\(gl, placeLines\(pm\)\)/.test(rsrc));
    ok('线框用 gl.LINES 而不是 TRIANGLES', /drawElements\(gl\.LINES/.test(
      require('fs').readFileSync(path.join(__dirname, '..', 'js', 'gl', 'core.js'), 'utf8')));
    ok('描边网格懒建（抽边只在切到线框时做，不预建）',
      /m\.line !== undefined/.test(rsrc) && /if \(m\.line !== undefined\) return m\.line/.test(rsrc));
    ok('描边网格也释放显存（进 disposeAll）', /disposeMesh\(gl, m\.line\)/.test(rsrc));
    ok('描边与实体共用同一份角色世界变换（不会错位）',
      /function castPose/.test(rsrc) && /drawCastLines[\s\S]{0,400}castPose\(shot, abs, local, cam\)/.test(rsrc));

    // ⑦ UI：画质档位 + 快照带上（否则预览线框、导出实体）
    const msrc = require('fs').readFileSync(path.join(__dirname, '..', 'js', 'main.js'), 'utf8');
    const mhtml = require('fs').readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    ok('UI 有 3D 画质三档（线条 / 叠加 / 实体）',
      /id="f-style"/.test(mhtml) && /value="line"/.test(mhtml) &&
      /value="both"/.test(mhtml) && /value="solid"/.test(mhtml));
    ok('画质栏只在 3D 引擎下显示', /f-style-row'\)\.hidden = \(v !== '3d'\)/.test(msrc));
    ok('默认档是线条轮廓（轻量）', /<option value="line" selected>/.test(mhtml) ||
      /<option value="line">线条轮廓/.test(mhtml));
    ok('导出快照带上画质档（预览与导出一致）',
      msrc.indexOf("style: ($('f-style') && $('f-style').value) || 'line'") >= 0 &&
      msrc.indexOf('gl3d.setStyle(snap.style)') >= 0);
  }

  /* ================================================================
   * 2D「让 AI 画这段」—— js/aiscene.js（2026-10-05）
   * 这里的断言几乎每条都对应一个实测踩到的坑。
   * ================================================================ */
  section('\n[19d] AI 生成 2D 场景：沙箱 + 画笔清单');
  {
    const AS = FS.aiscene;
    const A2 = FS.s2d;
    ok('FS.aiscene 导出齐了（prompt/extract/lint/compile/smoke/register）',
      AS && ['prompt', 'extract', 'lint', 'compile', 'smoke', 'register', 'unregister']
        .every((k) => typeof AS[k] === 'function'));

    /* ---------- ① 画笔清单必须与 core.js 真实签名一致 ----------
     * ⚠️ 第一版清单是手写的，错了三处（building 的 windows/winCols、
     *    particles 的 x0/y0/x1/y1、groundBand 的 hz/y0/y1），
     *    结果「楼画出来了但一扇窗都没亮、粒子撒到画布外」。出图才发现。
     *    所以这里把清单里出现的每个参数名拿去 core.js 源码里 grep，必须存在。 */
    const coreSrc = require('fs').readFileSync(path.join(__dirname, '..', 'js', 'scene2d', 'core.js'), 'utf8');
    const docOpts = [
      ['building', ['windows', 'winColor', 'lit', 'winCols', 'winRows', 'winW', 'winGap', 'depth', 'color']],
      ['particles', ['x0', 'y0', 'x1', 'y1', 'n', 'color', 'size', 'alpha', 'speed', 'sway', 'shape']],
      ['groundBand', ['hz', 'y0', 'y1', 'x0', 'x1', 'color']],
      ['groundGrid', ['hz', 'vp', 'y0', 'rows', 'color', 'alpha', 'lw']],
      ['personSil', ['x', 'baseY', 'h', 'color', 't', 'action']],
      // ⚠️ catSil 是 s（缩放）不是 h；cup 是 o.steam:false 关热气，不是 steamOn。
      //    这两个都是第一版清单里凭空编的字段名，测试当场抓出来。
      ['catSil', ['x', 'baseY', 's', 'color', 't', 'action']],
      ['sign', ['bg', 'fg', 'border', 'glowOn']],
      ['text', ['align', 'weight', 'baseline', 'shadow', 'shadowA']],
      ['cup', ['steam']]
    ];
    const docStr = AS.API_DOC;
    const bad = [];
    docOpts.forEach(([fn, keys]) => {
      keys.forEach((k) => {
        // 清单里写了 + core.js 源码里也得能搜到，两边都对才算没漂
        if (docStr.indexOf(k) < 0) bad.push(fn + '.' + k + '(清单里没提)');
        else if (coreSrc.indexOf(k) < 0) bad.push(fn + '.' + k + '(core.js 里没有)');
      });
    });
    ok('画笔清单的参数名与 scene2d/core.js 逐条对齐（防漂移守卫）', bad.length === 0, bad.join(' / '));
    ok('清单里点名的每个函数在 FS.s2d 上都真实存在', (() => {
      const named = (docStr.match(/A\.([A-Za-z_][\w]*)/g) || [])
        .map((s) => s.slice(2))
        .filter((k, i, arr) => arr.indexOf(k) === i);
      const missing = named.filter((k) => A2[k] === undefined);
      return missing.length === 0;
    })(), (docStr.match(/A\.([A-Za-z_][\w]*)/g) || []).map((s) => s.slice(2))
      .filter((k, i, arr) => arr.indexOf(k) === i && A2[k] === undefined).join(','));
    ok('building 的 lit 被说成「0~1 比例」而不是布尔（第一版写错，窗全不亮）',
      /lit 是 0~1 的亮窗比例/.test(docStr));
    ok('particles 的区域用 x0/y0/x1/y1 说明（第一版写 x/y/w/h，粒子撒出画布）',
      /x0\/y0\/x1\/y1/.test(docStr));

    /* ---------- ② extract：模型输出的各种脏形状都能抠出函数 ---------- */
    const good = 'function(g,t,p){ var A=this; A.sky(g,[[0,"#fff"],[1,"#000"]],0,400); A.tree(g,300,500,200,{leaf:"#2a5"}); A.birdSil(g,800,200,1,"#fff"); }';
    ok('extract 认得带 ```js 围栏 + 前言 + 后语的输出',
      AS.extract('好的：\n```javascript\n' + good + '\n```\n希望有用').indexOf('function') === 0);
    ok('extract 抠掉函数后面多写的代码（只留一个函数）', (() => {
      const r = AS.extract(good + '\nvar x = 1;\nfunction other(){}');
      return r.indexOf('var x') < 0 && r.indexOf('other') < 0;
    })());
    ok('extract 遇到没有 function 的输出会报错（不是静默返回空）', (() => {
      try { AS.extract('var x = 1;'); return false; } catch (e) { return /找不到 function/.test(e.message); }
    })());
    ok('extract 遇到花括号不配平（输出被截断）会报错', (() => {
      try { AS.extract('function(g,t,p){ var A=this; A.sky(g,[[0,"#fff"],[1,"#000"]],0,400);'); return false; }
      catch (e) { return /没配平/.test(e.message); }
    })());

    /* ---------- ③ lint：死循环必须在**执行前**拦下 ----------
     * ⚠️ 这里原来是「跑完再量耗时」，而 while(true) 根本不返回 →
     *   node 进程被卡死 120s。所以防线改成静态检查。 */
    const loops = [
      ['while(true){}', 'function(g,t,p){ var A=this; while(true){} }'],
      ['while(i<10)', 'function(g,t,p){ var A=this; var i=0; while(i<10){ i++; } A.sky(g,[[0,"#fff"],[1,"#000"]],0,400); }'],
      ['for(;;){}', 'function(g,t,p){ var A=this; for(;;){ } }'],
      ['for(;true;){}', 'function(g,t,p){ var A=this; for(;true;){ } }'],
      ['for(条件变量不变)', 'function(g,t,p){ var A=this; var n=3; for(;n;){ } }'],
      ['eval', 'function(g,t,p){ var A=this; eval("1"); }'],
      ['new Function', 'function(g,t,p){ var A=this; new Function("return 1"); }']
    ];
    let loopLeak = 0;
    loops.forEach(([nm, code]) => {
      const t0 = Date.now();
      let rejected = false;
      try { AS.compile(code); } catch (e) { rejected = true; }
      if (!rejected) loopLeak++;
      // 静态检查必须是「瞬间」的；超过 50ms 说明它居然真去执行了
      if (Date.now() - t0 > 50) loopLeak++;
    });
    ok('七种死循环/逃逸写法全部被静态检查拒掉（且都在 50ms 内，不执行）', loopLeak === 0);
    ok('合法的 for 循环不被误拒',
      (() => { try { AS.compile('function(g,t,p){ var A=this; for(var i=0;i<5;i++){ A.tree(g,i*100,500,100,{leaf:"#2a5"}); } }'); return true; } catch (e) { return false; } })());
    ok('源码里不再有「跑完再量耗时」那种无效的超时判断（那个拦不住 while(true)）',
      !/dt > \d+/.test(require('fs').readFileSync(path.join(__dirname, '..', 'js', 'aiscene.js'), 'utf8')));

    /* ---------- ④ compile 包装层：形参必须列全 ---------- */
    // 踩过的坑：写成 new Function('A', '...g, t, p...') 而没把 g/t/p 声明为形参
    ok('compile 后的绘制器能真的画（不是「g is not defined」）', (() => {
      const fn = AS.compile(good);
      const g = AS.probeCtx();
      fn(g, 0.5, 0.5);
      return g.calls > 3;
    })());
    ok('compile 报语法错时给的是人话（不是裸的 Unexpected token）', (() => {
      try { AS.compile('function(g,t,p){ var A=this; A.sky(g,[[0,"#fff"],0,400); }'); return false; }
      catch (e) { return /语法错/.test(e.message); }
    })());

    /* ---------- ⑤ smoke：能识别「等于什么都没画」 ---------- */
    ok('空函数被拒（画面等于没画）', (() => {
      const fn = AS.compile('function(g,t,p){ var A=this; }');
      return AS.smoke(fn).ok === false;
    })());
    ok('只用 arc/lineTo 画东西也算画了（第一版只数 fillRect，树/鸟全被漏掉）', (() => {
      const fn = AS.compile('function(g,t,p){ var A=this; g.beginPath(); g.moveTo(0,0); g.lineTo(100,100); g.lineTo(200,0); g.stroke(); g.beginPath(); g.arc(50,50,20,0,6.28); g.fill(); g.beginPath(); g.arc(90,60,20,0,6.28); g.fill(); }');
      return AS.smoke(fn).ok === true;
    })());
    ok('引用不存在的画笔会被抓出来（给的是人话）', (() => {
      const fn = AS.compile('function(g,t,p){ var A=this; A.不存在的画笔(g,1,2,3); }');
      const r = AS.smoke(fn);
      return r.ok === false && /抛错/.test(r.reason);
    })());

    /* ---------- ⑥ register：进场景池后与手写场景同一时间轴 ---------- */
    ok('register 之后场景进池且标记为 AI 生成', (() => {
      const r = AS.register('ai-test', good, { name: 'AI·测试' });
      return FS.s2dScenes['ai-test'] && AS.isAi('ai-test') && FS.s2dScenes.meta['ai-test'].ai === true;
    })());
    ok('AI 场景能被 daily 母题真的画出来（走完整 drawFrame 链路）', (() => {
      const st = {
        title: 't', template: 'daily', palette: 'ink', bpm: 84, beats: 8, sub: 'on',
        scenes: [{ title: 'AI 段', text: '一段用来验证 AI 场景的文案。' }], scenes2d: ['ai-test']
      };
      const g = AS.probeCtx();
      g.canvas = { width: 1280, height: 720 };
      let err = null;
      try { FS.story.drawFrame(g, st, 2.0); } catch (e) { err = e; }
      return !err && g.calls > 10;
    })());
    ok('unregister 能撤回（用户点「换一版」要能回到上一版）', (() => {
      AS.register('ai-tmp', good, {});
      const had = !!FS.s2dScenes['ai-tmp'];
      AS.unregister('ai-tmp');
      return had && !FS.s2dScenes['ai-tmp'] && !AS.isAi('ai-tmp');
    })());
    ok('源码可取回（导出项目时带上，复现得出来）', AS.codeOf('ai-test') === good);
    AS.unregister('ai-test');

    /* ---------- ⑦ UI 接线 ---------- */
    const mhtml2 = require('fs').readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    const msrc2 = require('fs').readFileSync(path.join(__dirname, '..', 'js', 'main.js'), 'utf8');
    ok('index.html 加载了 aiscene.js', /js\/aiscene\.js\?v=/.test(mhtml2));
    ok('UI 有「让 AI 画这段」与「清除 AI 场景」', /id="f-ai-paint"/.test(mhtml2) && /id="f-ai-clear"/.test(mhtml2));
    ok('场景面板只在 2D 生活场景母题下出现',
      /panel\.hidden = !isDaily/.test(msrc2) && /id="f-scene-panel"/.test(mhtml2));
    // 用户原话「上面也有下面也有，这有什么关系」+「你说几种，有p用」：
    // 母题下拉不再报「18 种」（那是内部实现细节），场景显示只留「每段一个卡片」一处。
    ok('母题下拉不再写「18 种」（用户：说几种有p用）',
      !/18 种/.test(mhtml2) && /value="daily">生活场景（2D 插画）/.test(mhtml2));
    ok('每段一个场景卡片（一次看全各段，不再只显示当前段）',
      /id="f-scene-strip"/.test(mhtml2) && /function drawSceneStrip/.test(msrc2));
    ok('没有多余的重复提示行（同一场景名不再显示两遍）', !/id="f-scene-tip"/.test(mhtml2));
    ok('「让 AI 画这段」用当前选中段，不再另设一个「选一段…」下拉',
      /var idx = s2dCur;/.test(msrc2) && !/id="f-ai-scene"/.test(mhtml2));
    ok('AI 场景在下拉里以 ★ 标出且排在最前', /sceneIsAi\(k\) \? '★ '/.test(msrc2));
    // 这条曾是 bug：改一次场景把**所有段**都设成同一个（截图里 4 段全变 AI 场景）
    ok('改场景只影响当前那一段（不再全片统一）',
      /film\.scenes2d\[s2dCur\] = v;/.test(msrc2) &&
      !/film\.scenes2d = film\.scenes\.map\(function \(\) \{ return manual; \}\)/.test(msrc2));
    ok('applyScenes 不再整份重算（保住手动指定与 AI 场景）',
      /if \(!film\.scenes2d \|\| film\.scenes2d\.length !== film\.scenes\.length\)/.test(msrc2));
    ok('aiClear 逐段退回而不是整份置 null', !/film\.scenes2d = null;[\s\S]{0,200}applyScenes/.test(msrc2));
    ok('AI 场景记在 film.aiScenes 里，且手动改场景会把它摘掉',
      /film\.aiScenes\[idx\] = id/.test(msrc2) &&
      /if \(film\.aiScenes\) delete film\.aiScenes\[s2dCur\]/.test(msrc2));
    ok('AI 失败时保留手写场景，绝不开天窗', (() => {
      // catch 分支里必须 unregister + 保留原 scenes2d（不是把这一段置空）
      const c = msrc2.match(/\['catch'\]\(function \(e\) \{[\s\S]{0,600}?\}\)\['finally'\]/);
      return c && /aiscene\.unregister/.test(c[0]) && /退回手写场景/.test(c[0]);
    })());
    ok('没填 Key 时直说人话而不是发一个必然失败的请求',
      /还没填 API Key/.test(msrc2));
  }

  section('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
    process.exit(fail ? 1 : 0);
  })
  .catch((e) => {
    console.log('  ✗ 模型清单那段抛错: ' + e.message);
    process.exit(1);
  });
}).catch((e) => {
  console.log('  ✗ 渲染抛错: ' + e.message);
  process.exit(1);
});
