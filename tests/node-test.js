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
