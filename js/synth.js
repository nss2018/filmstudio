/* synth.js —— Web Audio 加法合成（12 种音色），离线渲染成 AudioBuffer。
 * 试听和导出用的是同一个 buffer，不会出现「听到的和导出不一致」。
 */
(function (root) {
  'use strict';
  var FS = (root.FS = root.FS || {});
  var midiToFreq = FS.midiToFreq;

  /* 音色表：partials=[倍数, 幅度, 音分(可选)]，a/d/s/r=ADSR，lp=低通截止
   * drum 字段走打击乐分支（kick 扫频 / snare·hat·clap 噪声） */
  var INST = {
    pad:    { partials: [[1, .5, 0], [2, .24, 0], [3, .09, 0]], a: .55, d: .5, s: .7, r: 1.5, lp: 1500, gain: .42 },
    organ:  { partials: [[1, .5, 0], [2, .32, 0], [3, .2, 0], [4, .12, 0]], a: .04, d: .1, s: .85, r: .3, lp: 2600, gain: .34 },
    pluck:  { partials: [[1, .8, 0], [2, .3, 0], [3, .12, 0], [4, .05, 0]], a: .003, d: .22, s: .06, r: .18, lp: 4200, gain: .5 },
    bass:   { partials: [[1, 1, 0], [2, .3, 0], [3, .08, 0]], a: .006, d: .18, s: .55, r: .22, lp: 900, gain: .55 },
    lead:   { partials: [[1, .6, 0], [2, .25, 6], [3, .12, -5], [4, .05, 4]], a: .02, d: .18, s: .7, r: .3, lp: 5200, gain: .4 },
    blip:   { partials: [[1, .5, 0], [2, .5, 1200], [3, .3, -1200]], a: .001, d: .07, s: .02, r: .05, lp: 6000, gain: .45 },
    bell:   { partials: [[1, .7, 0], [2.76, .3, 0], [5.4, .16, 0], [8.9, .06, 0]], a: .002, d: .7, s: .03, r: .6, lp: 8000, gain: .4 },
    click:  { partials: [[1, .3, 0], [4, .6, 0]], a: .001, d: .03, s: 0, r: .02, lp: 5000, gain: .4 },

    kick:  { drum: 'kick', gain: .95 },
    snare: { drum: 'snare', gain: .6 },
    hat:   { drum: 'hat', gain: .32 },
    clap:  { drum: 'clap', gain: .5 }
  };

  function inst(name) { return INST[name] || INST.pad; }
  FS.inst = inst;
  FS.instruments = function () { return Object.keys(INST); };

  function noiseBuffer(ctx, sec) {
    var n = Math.max(1, Math.floor(ctx.sampleRate * sec));
    var b = ctx.createBuffer(1, n, ctx.sampleRate);
    var d = b.getChannelData(0);
    // 固定种子 -> 每次渲染结果一致（跟 Python 版一样确定）
    var seed = 20261004, x = 1234567;
    for (var i = 0; i < n; i++) {
      x = (x * 1103515245 + 12345) & 0x7fffffff;
      d[i] = (x / 0x3fffffff) - 1;
    }
    return b;
  }

  function env(param, t0, dur, def, peak) {
    var a = def.a, d = def.d, s = def.s, r = def.r;
    var top = peak;
    param.setValueAtTime(0.0001, t0);
    param.linearRampToValueAtTime(top, t0 + a);
    param.linearRampToValueAtTime(Math.max(top * s, 0.0001), t0 + a + d);
    var relStart = Math.max(t0 + a + d, t0 + dur);
    param.setValueAtTime(Math.max(top * s, 0.0001), relStart);
    param.linearRampToValueAtTime(0.0001, relStart + Math.max(r, 0.01));
  }

  /** 调度一个音/一次打击到 dest 上，返回它的结束时间 */
  function schedule(ctx, dest, note, def, t0, nBuf) {
    var dur = note.dur;
    var amp = (note.gain === undefined ? 0.8 : note.gain) * def.gain;
    if (def.drum) return scheduleDrum(ctx, dest, def.drum, t0, dur, amp, nBuf);

    var f = midiToFreq(note.midi);
    var lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = def.lp || 6000;
    lp.Q.value = 0.7;

    var g = ctx.createGain();
    lp.connect(g); g.connect(dest);

    var t1 = t0 + dur;
    for (var i = 0; i < def.partials.length; i++) {
      var p = def.partials[i];
      var ratio = p[0], pa = p[1], cents = p[2] || 0;
      var o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f * ratio;
      if (cents) o.detune.value = cents;
      var pg = ctx.createGain();
      pg.gain.value = pa;
      o.connect(pg); pg.connect(lp);
      o.start(t0);
      o.stop(t1 + def.r + 0.05);
      o.onended = (function (o) { return function () { try { o.disconnect(); } catch (e) {} }; })(o);
    }
    env(g.gain, t0, dur, def, amp);
    return t1 + def.r;
  }

  function scheduleDrum(ctx, dest, kind, t0, dur, amp, nBuf) {
    if (kind === 'kick') {
      var o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(150, t0);
      o.frequency.exponentialRampToValueAtTime(46, t0 + 0.11);
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(amp, t0 + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + Math.max(0.26, dur));
      o.connect(g); g.connect(dest);
      o.start(t0); o.stop(t0 + Math.max(0.3, dur) + 0.02);
      return t0 + Math.max(0.3, dur);
    }
    // 噪声类
    var src = ctx.createBufferSource();
    src.buffer = nBuf;
    var f = ctx.createBiquadFilter();
    var g2 = ctx.createGain();
    var len;
    if (kind === 'hat') { f.type = 'highpass'; f.frequency.value = 7200; len = 0.06; }
    else if (kind === 'clap') { f.type = 'bandpass'; f.frequency.value = 1300; f.Q.value = 1.4; len = 0.16; }
    else { f.type = 'bandpass'; f.frequency.value = 1900; f.Q.value = 0.9; len = 0.14; }
    g2.gain.setValueAtTime(0.0001, t0);
    g2.gain.linearRampToValueAtTime(amp, t0 + 0.003);
    g2.gain.exponentialRampToValueAtTime(0.0001, t0 + len);
    src.connect(f); f.connect(g2); g2.connect(dest);
    src.start(t0); src.stop(t0 + len + 0.02);
    if (kind === 'clap') {           // 三连击质感
      var s2 = ctx.createBufferSource(); s2.buffer = nBuf;
      var g3 = ctx.createGain();
      g3.gain.setValueAtTime(0.0001, t0 + 0.012);
      g3.gain.linearRampToValueAtTime(amp * .7, t0 + 0.015);
      g3.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.016 + len * .6);
      s2.connect(f); g3.connect(dest); s2.start(t0 + 0.012); s2.stop(t0 + 0.012 + len);
    }
    return t0 + len + 0.05;
  }

  function OfflineCtor() {
    return root.OfflineAudioContext || root.webkitOfflineAudioContext;
  }

  /** score -> Promise(AudioBuffer)，已归一化。
   *  ⚠️ 坑：OfflineAudioContext 的时长是「建的时候」定死的，渲染中途改不了。
   *  所以先按估算开一个，调度完发现最后一个音的尾巴超出就丢弃重建 —— 实际上几乎不触发。 */
  function renderScore(score, opts) {
    opts = opts || {};
    var Ctor = OfflineCtor();
    if (!Ctor) return Promise.reject(new Error('这个浏览器不支持离线音频（OfflineAudioContext），换个 Chrome / Safari 试试'));

    var sr = opts.sampleRate || score.sr || 44100;

    // 校验：未经 parseScore 的原始谱（比如 buildScore 直接输出）t 是 undefined，
    // 会一路变成 NaN 静音，还查不出毛病 —— 在这里挡下来给人话
    var bad = null;
    score.tracks.forEach(function (tr) {
      tr.notes.forEach(function (n, i) {
        if (bad) return;
        if (typeof n.t !== 'number' || !isFinite(n.t)) {
          bad = new Error('第 ' + (i + 1) + ' 个音符没有合法的时间 t（收到 ' + n.t + '）'
            + ' —— 配乐谱要先过一遍 parseScore 再渲染');
          bad.isScoreError = true;
        }
      });
    });
    if (bad) return Promise.reject(bad);

    function attempt(dur) {
      var ctx = new Ctor(2, Math.ceil(sr * dur), sr);
      var master = ctx.createGain();
      master.gain.value = score.master === undefined ? 0.8 : score.master;
      var limiter = ctx.createDynamicsCompressor();   // 兜底防削顶
      limiter.threshold.value = -6; limiter.knee.value = 6;
      limiter.ratio.value = 8; limiter.attack.value = 0.004; limiter.release.value = 0.15;
      master.connect(limiter); limiter.connect(ctx.destination);

      var nBuf = noiseBuffer(ctx, 0.5);
      var tail = 0;
      score.tracks.forEach(function (tr) {
        var def = inst(tr.instrument);
        tr.notes.forEach(function (n) {
          // 打击乐没有音高（midi 为 null），不能在这里过滤掉，否则鼓轨整个静音
          if (n.midi === null && !def.drum) return;
          var e = schedule(ctx, master, n, def, Math.max(0, n.t), nBuf);
          if (e > tail) tail = e;
        });
      });
      return { ctx: ctx, tail: tail };
    }

    var first = attempt(Math.max(1.0, (score.duration || 2) + 0.4));
    // 尾部再留 0.2s 留白，最后一个音才不会被切掉
    if (first.tail + 0.2 > first.ctx.duration) first = attempt(first.tail + 0.2);

    // normalize 是就地改采样，统计信息挂在 buffer.norm 上 —— 不能把返回值顶掉，
    // 否则拿到的是统计对象而不是 AudioBuffer，encodeWav 直接炸。
    return first.ctx.startRendering().then(function (buf) {
      buf.norm = normalize(buf);
      return buf;
    });
  }

  /** 归一化：峰值贴到 ~0.92，太小的抬到 0.16。就地缩放 buffer 采样。 */
  function normalize(buffer) {
    var chs = [], c2, i;
    for (var c = 0; c < buffer.numberOfChannels; c++) chs.push(buffer.getChannelData(c));
    var peak = 0;
    for (c2 = 0; c2 < chs.length; c2++) {
      var d = chs[c2];
      for (i = 0; i < d.length; i += 7) {
        var v = Math.abs(d[i]);
        if (v > peak) peak = v;
      }
    }
    var g = 1;
    if (peak > 0.0001) {
      g = peak > 0.92 ? 0.92 / peak : (peak < 0.06 ? Math.min(1, 0.16 / peak) : 1);
    }
    if (g !== 1) {
      for (c2 = 0; c2 < chs.length; c2++) {
        var a = chs[c2];
        for (i = 0; i < a.length; i++) a[i] *= g;
      }
    }
    return { peak: peak, gain: g, channels: chs.length };
  }

  FS.renderScore = renderScore;
  FS.normalize = normalize;
})(window);
