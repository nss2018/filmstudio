/* score.js —— 乐谱解析（浏览器版，对齐 Python 版 soundtrack 的语义）
 * 支持：音名(音名+八度) / 秒(t) / 拍(beat,beats) / loop 周期 / 数组简写(["x","-"])
 * 任何错误都带位置和人话，不抛裸 JSON 异常。
 */
(function (root) {
  'use strict';
  var FS = (root.FS = root.FS || {});

  var NOTE_IDX = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  var PITCH_CHARS = '#b';

  /** "F#3" / "Bb4" -> midi 60（C4）。返回 null 表示不是音名。 */
  function pitchToMidi(name) {
    if (typeof name !== 'string') return null;
    var m = /^([A-Ga-g])([#b]?)(-?\d+)$/.exec(name.trim());
    if (!m) return null;
    var pc = NOTE_IDX[m[1].toUpperCase()];
    if (pc === undefined) return null;
    var acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
    var oct = parseInt(m[3], 10);
    return (oct + 1) * 12 + pc + acc;
  }

  /** midi -> 频率（A4=440） */
  function midiToFreq(m) {
    return 440 * Math.pow(2, (m - 69) / 12);
  }

  function beat2sec(beat, bpm) {
    return beat * (60 / (bpm || 90));
  }

  function num(v, dflt) {
    var n = typeof v === 'number' ? v : parseFloat(v);
    return isFinite(n) ? n : dflt;
  }

  function err(msg) {
    var e = new Error(msg);
    e.isScoreError = true;
    throw e;
  }

  function isObject(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

  /** 展开一条 note：支持 {"p":"C4","t":0,"d":0.5} / {"beat":4} / "x" / "-" / 数字 */
  function expandNote(raw, inst, loopSpan, bpm, where) {
    var t, dur = 0.4, gain = 0.8, pitchRaw = null;

    if (typeof raw === 'string') {
      if (raw === '-' || raw === '.') return null;           // 休止
      var p = pitchToMidi(raw);
      if (p === null) err(where + ' 音符 "' + raw + '" 看不懂，写音名如 "C4" 或 "x" / "-"');
      t = 0; pitchRaw = p;
    } else if (raw && typeof raw === 'object') {
      var nn = raw;
      pitchRaw = pitchToMidi(nn.p !== undefined ? nn.p : nn.pitch);
      if (nn.p !== undefined && pitchRaw === null)
        err(where + ' 音名 "' + nn.p + '" 不合法（例：C4、F#2、Bb3）');

      t = num(nn.t !== undefined ? nn.t : nn.time, null);
      if (t === null) {
        var b = num(nn.beat !== undefined ? nn.beat : nn.beats, null);
        if (b !== null) t = beat2sec(b, bpm);
      }
      if (t === null) {
        // 数组形式：没有时间字段 -> 按拍号排开
        t = 0;
      }
      dur = num(nn.d !== undefined ? nn.d : nn.dur, 0.4);
      gain = num(nn.gain !== undefined ? nn.gain : nn.v, 0.8);
      if (dur <= 0) dur = 0.4;
    } else {
      err(where + ' 音符格式不对（收到 ' + JSON.stringify(raw) + '）');
    }

    // loop 轨：把落点折进 [0, span)
    if (loopSpan > 0 && t >= loopSpan) t = t % loopSpan;

    return { t: t, midi: pitchRaw, dur: dur, gain: gain, inst: inst, raw: pitchRaw !== null };
  }

  /** 字符串轨 / 数组轨：["x","-","x","-"] —— 一拍一个 */
  function fromSeq(arr, inst, span, bpm, where) {
    var out = [], beatSec = 60 / (bpm || 90);
    for (var i = 0; i < arr.length; i++) {
      var v = arr[i];
      if (v === '-' || v === '.' || v === null) continue;
      var n;
      if (typeof v === 'string' || typeof v === 'number') {
        n = { t: i * beatSec, midi: typeof v === 'string' ? pitchToMidi(v) : null, dur: beatSec * 0.9, gain: 0.85, inst: inst, raw: true };
        if (n.midi === null && typeof v === 'string' && v !== 'x' && v !== 'o')
          err(where + ' 第 ' + (i + 1) + ' 项 "' + v + '" 既不是 x 也不是音名');
      } else {
        n = expandNote(v, inst, span, bpm, where + ' 第 ' + (i + 1) + ' 项');
        if (n) { n.t = i * beatSec; n.dur = beatSec * 0.9; }
      }
      // ⚠️ "x" 没有音高也要留下：鼓不看音高，丢掉它就等于鼓轨静音
      if (n) out.push(n);
    }
    return out;
  }

  /** 解析乐谱文本 -> { bpm, sr, master, tracks:[{name,instrument,notes:[...]}], duration } */
  function parseScore(text) {
    var data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      err('JSON 语法错：' + e.message + '（看红框位置）');
    }
    if (!data || typeof data !== 'object' || Array.isArray(data))
      err('顶层必须是一个对象，像 { "bpm": 84, "tracks": [...] }');

    var bpm = num(data.bpm, 90);
    if (bpm <= 0) err('bpm 得是正数，收到 ' + data.bpm);

    var tracks = data.tracks;
    if (!Array.isArray(tracks) || !tracks.length)
      err('tracks 是空的 —— 至少放一条轨道。这是渲染时间轴用的 cues 文件吗？如果是，去「宣传片生成器」标签页，用「项目备份」导入。');

    var out = [];
    var lastEnd = 0;

    for (var i = 0; i < tracks.length; i++) {
      var tr = tracks[i];
      var where = 'tracks[' + i + ']';
      if (!tr || typeof tr !== 'object') err(where + ' 不是一个对象');

      var inst = tr.instrument || tr.inst || tr.name || 'pad';
      var span = num(tr.loop, 0);
      var notes = [];

      if (typeof tr.notes === 'string') {
        notes = fromSeq(tr.notes.split(/\s+/).filter(Boolean), inst, span, bpm, where);
      } else if (Array.isArray(tr.notes) && tr.notes.length && isObject(tr.notes[0])) {
        // 音名对象数组：[{"p":"C4","t":0}] —— 每个都要走完整解析（能带 t/d/gain）
        for (var j = 0; j < tr.notes.length; j++) {
          var n = expandNote(tr.notes[j], inst, span, bpm, where + '.notes[' + j + ']');
          if (n) notes.push(n);
        }
      } else if (Array.isArray(tr.notes)) {
        // 打击乐数组：["x","-","x"] 一拍一个
        notes = fromSeq(tr.notes, inst, span, bpm, where);
      } else if (tr.seq || tr.pattern) {
        notes = fromSeq(tr.seq || tr.pattern, inst, span, bpm, where);
      } else {
        err(where + ' 没有 notes（要数组，或 "x - x -" 这样的字符串）');
      }

      notes.sort(function (a, b) { return a.t - b.t; });
      out.push({ name: tr.name || inst, instrument: inst, loop: span, notes: notes });

      // 时长：loop 轨至少走满一个周期
      for (var k = 0; k < notes.length; k++) {
        var end = notes[k].t + notes[k].dur;
        if (span > 0) {
          var base = notes[k].t;
          lastEnd = Math.max(lastEnd, (Math.floor(base / span) + 1) * span + end - base);
        } else lastEnd = Math.max(lastEnd, end);
      }
    }

    var duration = num(data.duration, 0);
    if (duration <= 0) duration = lastEnd > 0 ? lastEnd + 0.6 : 2.0;

    return {
      bpm: bpm,
      sr: num(data.sample_rate, 44100),
      master: num(data.master, 0.8),
      tracks: out,
      duration: duration
    };
  }

  function scoreInfo(sc) {
    var n = 0, insts = {};
    sc.tracks.forEach(function (t) {
      n += t.notes.length;
      insts[t.instrument] = (insts[t.instrument] || 0) + 1;
    });
    return {
      bpm: sc.bpm, sr: sc.sr, dur: sc.duration, notes: n,
      insts: Object.keys(insts),
      summary: sc.tracks.length + ' 轨 / ' + n + ' 音 / ' + sc.duration.toFixed(1) + 's / ' + sc.bpm + ' BPM'
    };
  }

  FS.parseScore = parseScore;
  FS.scoreInfo = scoreInfo;
  FS.pitchToMidi = pitchToMidi;
  FS.midiToFreq = midiToFreq;
})(window);
