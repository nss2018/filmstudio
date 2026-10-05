/* scoresync.js —— 配乐跟文案走（纯函数，node 可测）
 *
 * 规矩是用户定的，代码就照着写：
 *   ① 有文案 → 按「字幕断句」打点：每句（每一小句）字幕出现的位置就是落点，
 *      配乐的拍点往这些落点上靠，每句出现还额外给一记重音；
 *   ② 拍点跟字幕对不上（或者配乐太短压不住）→ 直接不配乐，
 *      宁可让片子只剩画面 + 配音，也别放一段不合拍的。
 *
 * 为什么判「合拍」用「字幕落点到最近音符的距离」：
 *   音乐跟文案合不合，听感上就是「这句词冒出来的瞬间有没有东西应一下」。
 *   所以把每个落点去找最近的原始音符，距离落在半拍内就算应上了，
 *   全部落点的平均命中率就是合拍度（ratio）。
 *
 * 全程不碰 DOM：动画/UI 层只调 syncReport / apply，测试直接跑这里。
 */
(function (root) {
  'use strict';
  var FS = (root.FS = root.FS || {});

  /* 合拍阈值：重合度低于这个值就认为「不如不要」（用户原话）。
   * cov 是「有没有声音在响」，prox 是「起音离得多近」—— 都低了就别放。 */
  var MIN_RATIO = 0.25;   // 起音重合度（低于这个数说明整首的节奏根本不是跟着文案走的）
  var COV_MIN = 0.5;      // 落点处有声覆盖率：低于这个数 = 大片地方哑着
  var COV_FULL = 0.9;     // 覆盖率到这个数 = 一路都响着，不再追究起音
  /* 配乐短于片子这个比例就算压不住（太短 = 中间一大段没声，比不合拍还难听） */
  var MIN_LEN = 0.6;

  var DRUMS = { kick: 1, snare: 1, hat: 1, clap: 1 };
  /* 中文断句标点：逗号句号叹号问号分号冒号顿号省略号破折号波浪线 */
  var PUNC = /[，。！？；：、…—～,\.;!?]/;

  function num(v, d) {
    var n = typeof v === 'number' ? v : parseFloat(v);
    return isFinite(n) ? n : d;
  }
  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
  function r4(x) { return Math.round(x * 10000) / 10000; }
  function byT(a, b) { return a.t - b.t; }

  /** 断句：按标点切开，超过 14 字的小句再按 7 字切一刀（一句最多铺两个落点） */
  function splitPhrases(text) {
    var out = [], buf = '';
    function flush(s) {
      s = String(s || '').replace(/^[\s，。！？；：、…—～]+/, '').replace(/[\s，。！？；：、…—～]+$/, '');
      if (!s) return;
      if (s.length > 14) {
        for (var k = 0; k < s.length; k += 7) {
          var piece = s.slice(k, k + 7);
          if (piece) out.push(piece);
        }
      } else out.push(s);
    }
    for (var i = 0; i < text.length; i++) {
      buf += text[i];
      if (PUNC.test(text[i])) { flush(buf); buf = ''; }
    }
    flush(buf);
    return out;
  }

  /** 一条音符在时间轴上的位置（t / time / beat 都能认） */
  function noteTime(n, bpm) {
    if (!n || typeof n !== 'object') return null;
    if (isFinite(n.t)) return n.t;
    if (isFinite(n.time)) return n.time;
    if (isFinite(n.beat)) return n.beat * 60 / (bpm > 0 ? bpm : 90);
    return null;
  }

  /**
   * 字幕落点：每一句/每一小句「冒出来」的时刻。
   * 一段文案里的小句，按字数比例铺在这段的时长里（跟画面推进一致），
   * 再往右挪 5% —— 字刚出来的那一帧就该有声音顶上来，不能等人读完才响。
   */
  function copyAnchors(story) {
    var tl = FS.story.timeline(story);
    var out = [];
    (story.scenes || []).forEach(function (s, i) {
      var m = tl.marks[i];
      if (!m) return;
      var text = String((s && s.text) || '').trim();
      if (!text) return;
      var phrases = splitPhrases(text);
      if (!phrases.length) return;                 // 纯标点不配落点
      var total = 0, k;
      for (k = 0; k < phrases.length; k++) total += phrases[k].length;
      if (!total) total = 1;
      var acc = 0;
      for (k = 0; k < phrases.length; k++) {
        out.push({
          t: m.start + m.dur * (acc / total) + m.dur * 0.05,
          i: i,
          phrase: phrases[k]
        });
        acc += phrases[k].length;
      }
    });
    out.sort(byT);
    return out;
  }

  /** 全部音符的原始落点（判合拍度只看这些，不看后加的重音） */
  function collectTimes(raw) {
    var bpm = num(raw.bpm, 90), out = [];
    (raw.tracks || []).forEach(function (tr) {
      (tr.notes || []).forEach(function (n) {
        var t = noteTime(n, bpm);
        if (t !== null && isFinite(t)) out.push(t);
      });
    });
    return out;
  }

  /** 所有「起音」时刻（循环轨按周期展开到 horizon）。判合拍只看起音：
   *  长音铺着的段落本来就在响，那叫和声，不叫脱拍。 */
  function onsets(raw, horizon) {
    var bpm = num(raw.bpm, 90), out = [];
    (raw.tracks || []).forEach(function (tr) {
      var loop = num(tr.loop, 0);
      (tr.notes || []).forEach(function (n) {
        var t0 = noteTime(n, bpm);
        if (t0 === null) return;
        out.push(t0);
        if (loop > 0) {
          for (var k = 1; k * loop <= horizon + loop; k++) out.push(t0 + k * loop);
        }
      });
    });
    out.sort(byT);
    return out;
  }

  /** t 这一刻到底有没有声音在响（循环轨按周期折回来比） */
  function soundsAt(raw, t, horizon) {
    var bpm = num(raw.bpm, 90), hit = false;
    (raw.tracks || []).forEach(function (tr) {
      if (hit) return;
      var loop = num(tr.loop, 0);
      (tr.notes || []).forEach(function (n) {
        if (hit) return;
        var t0 = noteTime(n, bpm);
        if (t0 === null) return;
        var d = num(n.d !== undefined ? n.d : n.dur, 0.4);
        if (loop > 0) {
          var k = Math.floor((t - t0) / loop);
          for (var m = k - 1; m <= k + 1; m++) {
            var s = t0 + m * loop;
            if (t >= s && t < s + Math.max(d, 0.08)) hit = true;
          }
        } else if (t >= t0 && t < t0 + Math.max(d, 0.08)) hit = true;
      });
    });
    return hit;
  }

  /** 乐谱总长：显式 duration 优先，否则按最后一个音算 */
  function scoreDur(raw) {
    var bpm = num(raw.bpm, 90), last = 0;
    (raw.tracks || []).forEach(function (tr) {
      (tr.notes || []).forEach(function (n) {
        var t = noteTime(n, bpm);
        if (t === null || !isFinite(t)) return;
        var d = num(n.d !== undefined ? n.d : n.dur, 0.4);
        last = Math.max(last, t + d);
      });
    });
    var ex = num(raw.duration, 0);
    return ex > 0 ? ex : last;
  }

  function nearest(list, t) {
    var best = null, bd = Infinity;
    for (var i = 0; i < list.length; i++) {
      var d = Math.abs(list[i] - t);
      if (d < bd) { bd = d; best = list[i]; }
    }
    return { t: best, d: bd };
  }

  /** 合拍度体检：不产出乐谱，只回答「这首配乐能不能跟这首片子的文案对上」。
   *  两个分数：
   *    cov  —— 字幕落点上「有声音在响」的比例（和声/长音/循环都算，别把铺着的 pad 当成哑巴）
   *    prox —— 落点到最近「起音」的距离（这个才是「有没有东西应一下」）
   *  判定：
   *    ① 大片落点哑着              → 接不上文案，不配；
   *    ② 有声但有断断续续的口子，且起音整体错开 → 两张皮，不配；
   *    ③ 一路都响着的铺底（cov≈1）→ 起音本来就不在线上，那叫和声不叫脱拍，照用。
   * 毕竟对齐时每句字幕都会补一记重音，「应一下」由打点层保证，不该拿它去砍整首曲子。 */
  function syncReport(raw, story) {
    var anchors = copyAnchors(story);
    var rep = { anchors: anchors, ratio: 0, cov: 0, use: false, reason: '' };
    if (!anchors.length) {
      rep.reason = '这部片子没有文案（没字幕可跟），配乐无处对齐';
      return rep;
    }
    var times = collectTimes(raw);
    if (!times.length) {
      rep.reason = '配乐里一个音符都没有，放出来就是静音';
      return rep;
    }
    var total = FS.story.timeline(story).total;
    var bpm = num(raw.bpm, 90);
    var spb = 60 / (bpm > 0 ? bpm : 90);
    var tol = spb * 0.5;                            // 半拍内算「应上了」
    var on = onsets(raw, Math.max(total, 4));
    var covSum = 0, proxSum = 0;
    anchors.forEach(function (a) {
      covSum += soundsAt(raw, a.t, total) ? 1 : 0;
      proxSum += on.length ? clamp01(1 - nearest(on, a.t).d / tol) : 0;
    });
    rep.cov = covSum / anchors.length;
    rep.ratio = proxSum / anchors.length;

    // 有循环轨的乐谱会一直绕下去，短谱不等于短音乐 —— 这条检查只对一次性乐谱生效
    var loops = (raw.tracks || []).some(function (tr) { return num(tr.loop, 0) > 0; });
    var dur = scoreDur(raw);
    var dead = Math.round((1 - rep.cov) * 100);
    if (!loops && total > 0 && dur > 0 && dur < total * MIN_LEN) {
      rep.use = false;
      rep.reason = '配乐只有 ' + dur.toFixed(1) + 's、片子 ' + total.toFixed(1) + 's，中间一大段没声，压不住';
      return rep;
    }
    if (rep.cov < COV_MIN) {
      rep.use = false;
      rep.reason = '配乐有 ' + dead + '% 的字幕落点处是哑的，接不上文案，宁可不配';
      return rep;
    }
    if (rep.cov < COV_FULL && rep.ratio < MIN_RATIO) {
      rep.use = false;
      rep.reason = '配乐起断断续续，还跟字幕错开（重合 ' + Math.round(rep.ratio * 100) + '%），宁可不配';
      return rep;
    }
    rep.use = true;
    rep.reason = '起音跟字幕重合 ' + Math.round(rep.ratio * 100) + '%，落点处 ' + Math.round(rep.cov * 100) + '% 有声';
    return rep;
  }

  /** 打点层用什么音色：有鼓就用鼓（跟得住），没有就用 blip（不抢戏） */
  function accentInst(raw) {
    var drum = null;
    (raw.tracks || []).forEach(function (tr) {
      var n = tr.instrument || tr.inst || tr.name;
      if (DRUMS[n]) drum = n;
    });
    return drum || 'blip';
  }

  /**
   * 把配乐对齐到字幕落点。返回 {score, report}；
   * 不合拍时 score = null（调用方就别渲染了）。绝不改动传入的 raw。
   */
  function apply(raw, story, given) {
    var rep = given || syncReport(raw, story);
    if (!rep.use) return { score: null, report: rep };

    var out = JSON.parse(JSON.stringify(raw));
    var bpm = num(out.bpm, 90);
    var spb = 60 / (bpm > 0 ? bpm : 90);
    var tol = spb * 0.5;
    var A = rep.anchors || [];

    (out.tracks || []).forEach(function (tr) {
      var ns = tr.notes;
      if (!Array.isArray(ns)) return;
      ns.forEach(function (n) {
        if (!n || typeof n !== 'object') return;
        var t = noteTime(n, bpm);
        if (t === null) return;
        var hit = nearest(A, t);
        if (hit.t !== null && hit.d <= tol) {         // 半拍内才吸附，太远说明本来就不是这个位置的音
          n.t = r4(hit.t);
          delete n.beat;
          delete n.beats;
        }
      });
      ns.sort(byT);
    });

    var inst = accentInst(out);
    var acc = A.map(function (a) {
      return { t: r4(a.t), dur: r4(Math.min(0.14, spb * 0.3)), gain: 0.5, inst: inst, midi: null };
    });
    out.tracks = out.tracks || [];
    out.tracks.push({ name: '字幕打点', instrument: inst, loop: 0, notes: acc });

    var last = acc.length ? acc[acc.length - 1].t : 0;
    if (num(out.duration, 0) < last + 0.8) out.duration = r4(last + 0.8);
    return { score: out, report: rep };
  }

  FS.scoreSync = {
    copyAnchors: copyAnchors,
    syncReport: syncReport,
    apply: apply,
    splitPhrases: splitPhrases,
    scoreDur: scoreDur,
    MIN_RATIO: MIN_RATIO,
    MIN_LEN: MIN_LEN,
    COV_MIN: COV_MIN,
    COV_FULL: COV_FULL
  };
})(typeof window !== 'undefined' ? window : this);
