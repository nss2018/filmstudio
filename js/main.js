/* main.js —— UI 装配。所有交互状态集中在这里，渲染层（score/synth/story）不含 DOM。 */
(function (root) {
  'use strict';
  var FS = root.FS;
  var $ = function (id) { return document.getElementById(id); };

  function hint(el, msg, kind) {
    el.textContent = msg;
    el.className = 'hint' + (kind ? ' ' + kind : '');
  }

  /* ================== 音频上下文（懒建，首次用户手势后 resume） ================== */
  var live = null;
  function ctx() {
    if (!live) {
      var C = root.AudioContext || root.webkitAudioContext;
      if (!C) throw new Error('这个浏览器没有 Web Audio（AudioContext）');
      live = new C();
    }
    if (live.state === 'suspended') live.resume();
    return live;
  }

  /* ================== 配乐台 ================== */
  var PRESETS = {
    ui: {
      bpm: 120, sample_rate: 44100, master: 0.8,
      tracks: [
        { name: 'tap', instrument: 'click', notes: [{ p: 'C6', t: 0, d: .05 }, { p: 'G6', t: .18, d: .05 }, { p: 'C7', t: .36, d: .05 }] },
        { name: 'ok', instrument: 'bell', notes: [{ p: 'E5', t: .5, d: .5 }, { p: 'A5', t: .62, d: .6 }, { p: 'C6', t: .74, d: .9 }] },
        { name: 'err', instrument: 'blip', notes: [{ p: 'A4', t: .95, d: .12 }, { p: 'Ab4', t: 1.08, d: .26 }] }
      ]
    },
    loop: {
      bpm: 84, sample_rate: 44100, master: 0.8,
      tracks: [
        { name: 'pad', instrument: 'pad', loop: 8, notes: [{ p: 'C3', t: 0, d: 3.6 }, { p: 'G3', t: 4, d: 3.6 }] },
        { name: 'bass', instrument: 'bass', loop: 8, notes: [{ p: 'C2', t: 0, d: 1.7 }, { p: 'C2', t: 4, d: 1.7 }] },
        { name: 'drums', instrument: 'kick', loop: 8, notes: ['x', '-', '-', '-', 'x', '-', 'x', '-'] },
        { name: 'hats', instrument: 'hat', loop: 8, notes: ['-', 'x', '-', 'x', '-', 'x', '-', 'x'] },
        { name: 'melody', instrument: 'pluck', loop: 8, notes: [{ p: 'E4', t: 0, d: .5 }, { p: 'G4', t: 1, d: .5 }, { p: 'A4', t: 2, d: .5 }, { p: 'G4', t: 3, d: .5 }, { p: 'E4', t: 4, d: .5 }, { p: 'D4', t: 5, d: .5 }] }
      ]
    },
    basic: {
      bpm: 72, sample_rate: 44100, master: 0.8,
      tracks: [
        { name: 'lead', instrument: 'lead', notes: [{ p: 'C4', beat: 0, d: 1 }, { p: 'D4', beat: 2, d: 1 }, { p: 'E4', beat: 4, d: 1 }, { p: 'G4', beat: 6, d: 1 }] },
        { name: 'pad', instrument: 'pad', notes: [{ p: 'C3', beat: 0, d: 4 }, { p: 'F3', beat: 8, d: 4 }] },
        { name: 'drums', instrument: 'snare', notes: ['-', '-', 'x', '-'] }
      ]
    }
  };

  var mScore = null, mBuf = null, mPlaying = false, mStart = 0, mNode = null;

  function setStatus(text, kind) { hint($('score-status'), text, kind); }

  function parseMusic() {
    var raw = $('score-input').value;
    try {
      mScore = FS.parseScore(raw);
    } catch (e) {
      setStatus('✗ ' + e.message, 'bad');
      return null;
    }
    var info = FS.scoreInfo(mScore);
    $('score-meta').textContent = info.summary;
    setStatus('✓ ' + mScore.tracks.length + ' 轨 / ' + info.notes + ' 音 / ' + mScore.duration.toFixed(2) + 's', 'ok');
    // 任何来源（预设 / 源码 / 图形）的谱都让卷帘重画一遍，图形永远跟音频一致
    try { FS.roll.load(mScore); } catch (e) {}
    return mScore;
  }

  var parseTimer = null;
  $('score-input').addEventListener('input', function () {
    clearTimeout(parseTimer);
    parseTimer = setTimeout(function () {
      var sc = parseMusic();
      if (sc) renderMusic(sc);
    }, 450);
  });

  /* ================== 音乐工厂接线 ================== */
  // 出过的曲子指纹都记着：点「再来一首」时用它避开刚出的那几首
  var mfUsed = {}, mfLast = null;

  (function fillStyles() {
    var sel = $('mf-style');
    FS.factory.STYLES.forEach(function (s) {
      var o = document.createElement('option');
      o.value = s.id;
      o.textContent = s.name + ' · ' + s.desc;
      sel.appendChild(o);
    });
  })();

  function mfOpts(over) {
    var o = {
      theme: $('mf-theme').value.trim() || '未命名',
      style: $('mf-style').value,
      bars: parseInt($('mf-bars').value, 10) || 12,
      density: parseFloat($('mf-dens').value),
      drums: $('mf-drums').checked
    };
    var b = parseFloat($('mf-bpm').value);
    if (isFinite(b) && b > 20) o.bpm = b;          // 留空 = 交给风格自己定
    if (over) { for (var k in over) o[k] = over[k]; }
    return o;
  }

  /** 把「采了什么 + 怎么改的」写出来 —— 随机生成最怕看不懂在干嘛 */
  function mfShow(meta) {
    var rec = $('mf-rec');
    rec.innerHTML = '';
    var head = document.createElement('div');
    head.className = 'mf-head';
    head.textContent = meta.style.name + ' · ' + meta.key + ' ' + meta.scale + ' · ' +
      meta.bpm + ' BPM · ' + meta.bars + ' 小节 · ' + meta.notes + ' 个音 · ' + meta.seconds.toFixed(1) + 's';
    rec.appendChild(head);
    var grid = document.createElement('div');
    grid.className = 'mf-grid';
    meta.sources.forEach(function (s) {
      var d = document.createElement('span');
      d.className = 'mf-chip';
      d.innerHTML = '<b>' + s.type + '</b>' + s.label;
      grid.appendChild(d);
    });
    rec.appendChild(grid);
    var ops = document.createElement('div');
    ops.className = 'mf-ops';
    ops.innerHTML = '变形：<b>' + (meta.ops.join('、') || '（原动机直用）') + '</b>' +
      ' · 曲式 ' + meta.structure + ' · 乐句变体 ' + meta.variants + ' 个（已查重）' +
      ' · 指纹 <code>' + meta.fingerprint + '</code>';
    rec.appendChild(ops);
    $('mf-status').textContent = '✓ ' + meta.style.name + ' / ' + meta.bpm + ' BPM';
  }

  /** 生成 -> 写进源码框 -> 走 parseScore -> 渲染 + 灌进卷帘（和手改的谱共用同一条链路） */
  function mfApply(res) {
    mfLast = res;
    mfUsed[res.meta.fingerprint] = 1;
    $('score-input').value = FS.factory.toText(res.score);
    var sc = parseMusic();
    if (sc) renderMusic(sc);
    mfShow(res.meta);
    return res;
  }

  $('mf-go').addEventListener('click', function () { mfApply(FS.factory.generate(mfOpts())); });
  $('mf-play').addEventListener('click', function () { mPlaying ? musicStop() : musicPlay(); });
  $('mf-again').addEventListener('click', function () { mfApply(FS.factory.generateUnique(mfOpts(), mfUsed)); });
  $('mf-skip').addEventListener('click', function () {
    var ids = ['auto'].concat(FS.factory.STYLES.map(function (s) { return s.id; }));
    var sel = $('mf-style');
    sel.value = ids[(ids.indexOf(sel.value) + 1) % ids.length];
    mfApply(FS.factory.generateUnique(mfOpts(), mfUsed));
  });
  $('mf-dens').addEventListener('input', function () { $('mf-dens-val').textContent = (+this.value).toFixed(2); });
  $('mf-theme').addEventListener('change', function () {
    var rec = FS.factory.recommend($('mf-theme').value.trim() || '未命名');
    $('mf-status').textContent = '建议：' + rec.styleName + ' / ' + rec.key + ' 调 / 约 ' + rec.bpm + ' BPM';
  });
  $('mf-tofilm').addEventListener('click', function () {
    if (!mfLast) { $('mf-status').textContent = '先生成一首，再拿去配片'; return; }
    film.custom = { score: mfLast.score, meta: mfLast.meta };
    $('f-bpm').value = mfLast.meta.bpm;
    readFilm();
    redraw();
    switchTab('film');
    setMusicLabel('配乐来源：音乐工厂挑的「' + mfLast.meta.style.name + '」· 指纹 ' + mfLast.meta.fingerprint);
  });

  /* ================== 图形卷帘接线 ================== */
  // 配乐那行提示由两截拼成：从哪来的 + 跟文案合不合。分开存，别互相覆盖。
  var musicLabel = '配乐来源：自动（按片名当主题生成）';
  function setMusicLabel(s) { musicLabel = s; refreshMusicLine(); }

  // 图形编辑器只产出 JSON 文本，剩下还是走 parseScore -> renderScore，不另开一套渲染
  FS.roll.mount({
    canvas: $('roll'),
    trackBox: $('roll-tracks'),
    opsBox: $('roll-ops'),
    barBox: $('roll-bar'),
    onChange: function (text) {
      $('score-input').value = text;          // 切到源码页就能看到同一个谱
      var sc = parseMusic();
      if (sc) renderMusic(sc);
    },
    onError: function (e) { setStatus('✗ ' + e.message, 'bad'); },
    onPlayTrack: playTrack,
    onStopTrack: musicStop
  });

  /** 单独试听一条轨（把这条轨包成一个单轨乐谱，走常规渲染） */
  function playTrack(t) {
    try { ctx(); } catch (e) { setStatus('✗ ' + e.message, 'bad'); return; }
    if (!t.notes.length) { setStatus('这条轨是空的，先点几下', 'bad'); return; }
    var s = FS.roll.state();
    var b = 60 / (s.bpm || 84);
    var last = 0;
    t.notes.forEach(function (n) { last = Math.max(last, (n.beat + n.dur) * b + 0.25); });
    var raw = {
      bpm: s.bpm, sample_rate: 44100, master: 0.85,
      duration: Math.min(last, s.cols * b),
      tracks: [{
        name: t.name, instrument: t.instrument, loop: t.loop,
        notes: t.notes.map(function (n) {
          return n.midi === null
            ? { beat: n.beat, d: n.dur * b }
            : { p: FS.midi2name(n.midi), beat: n.beat, d: n.dur * b };
        })
      }]
    };
    var sc;
    try { sc = FS.parseScore(JSON.stringify(raw)); }
    catch (e) { setStatus('✗ ' + e.message, 'bad'); return; }
    FS.renderScore(sc, { sampleRate: 44100 }).then(function (buf) {
      musicStop();
      var node = ctx().createBufferSource();
      node.buffer = buf;
      node.connect(ctx().destination);
      node.start(ctx().currentTime + 0.04);
      setStatus('▶ 正在试听「' + t.name + '」', 'ok');
      root.setTimeout(function () {
        setStatus('✓ 合成完成 · ' + buf.duration.toFixed(2) + 's', 'ok');
      }, buf.duration * 1000);
    })['catch'](function (e) { setStatus('✗ ' + e.message, 'bad'); });
  }

  /* 图形 / 源码 切换 */
  Array.prototype.forEach.call(document.querySelectorAll('#edimode .seg-btn'), function (b) {
    b.addEventListener('click', function () {
      Array.prototype.forEach.call(document.querySelectorAll('#edimode .seg-btn'), function (x) {
        x.classList.toggle('active', x === b);
      });
      $('ed-roll').hidden = (b.dataset.mode !== 'roll');
      $('ed-json').hidden = (b.dataset.mode !== 'json');
      if (b.dataset.mode === 'roll') FS.roll.draw();
    });
  });

  function renderMusic(sc) {
    var btn = $('btn-play');
    btn.disabled = true;
    setStatus('⋯ 合成中', '');
    try {
      FS.renderScore(sc, { sampleRate: parseInt($('sr-select').value, 10) }).then(function (buf) {
        mBuf = buf;
        drawWave(buf);
        btn.disabled = false;
        setStatus('✓ 合成完成 · ' + buf.duration.toFixed(2) + 's · ' + buf.sampleRate + 'Hz', 'ok');
      })['catch'](function (e) {
        btn.disabled = false;
        setStatus('✗ ' + e.message, 'bad');
      });
    } catch (e) {
      btn.disabled = false;
      setStatus('✗ ' + e.message, 'bad');
    }
  }

  function drawWave(buf) {
    var cv = $('wave'), g = cv.getContext('2d');
    var w = cv.width, h = cv.height;
    g.clearRect(0, 0, w, h);
    g.fillStyle = FS.theme.trough;
    g.fillRect(0, 0, w, h);
    var d = buf.getChannelData(0), n = d.length;
    var cols = Math.min(w, 640);
    var step = Math.max(1, Math.floor(n / cols));
    g.strokeStyle = FS.theme.accent;
    g.lineWidth = 1.5;
    g.beginPath();
    for (var i = 0; i < cols; i++) {
      var idx = Math.floor(i * n / cols);
      var peak = 0, j;
      var st = Math.max(1, Math.floor(n / cols / 6));
      for (j = 0; j < st && idx + j < n; j++) {
        var v = Math.abs(d[idx + j]);
        if (v > peak) peak = v;
      }
      var y = h / 2 - peak * (h / 2 - 8);
      i ? g.lineTo(i, y) : g.moveTo(i, y);
    }
    g.stroke();
    g.strokeStyle = hexA(FS.theme.ink, .12);
    g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
  }

  function musicPlay() {
    if (!mBuf) { setStatus('还没合成出音频，先点「生成配乐」或选个预设', 'bad'); return; }
    try { ctx(); } catch (e) { setStatus('✗ ' + e.message, 'bad'); return; }
    musicStop();
    var c = ctx();
    mNode = c.createBufferSource();
    mNode.buffer = mBuf;
    mNode.connect(c.destination);
    mStart = c.currentTime + 0.05;
    mNode.start(mStart);
    mPlaying = true;
    $('btn-play').textContent = '❚❚ 播放中';
    var mp = $('mf-play');
    if (mp) mp.textContent = '❚❚ 试听中';
    tickMusic();
  }

  function musicStop() {
    mPlaying = false;
    if (mNode) { try { mNode.stop(); } catch (e) {} mNode = null; }
    $('btn-play').textContent = '▶ 播放';
    var mp = $('mf-play');
    if (mp) mp.textContent = '▶ 试听';
    $('play-progress').style.width = '0%';
    try { FS.roll.clearPlayhead(); } catch (e) {}
  }

  function tickMusic() {
    if (!mPlaying) return;
    var c = ctx();
    var t = c.currentTime - mStart;
    if (t < 0) t = 0;
    var dur = mBuf ? mBuf.duration : 1;
    $('play-progress').style.width = Math.min(100, t / dur * 100) + '%';
    try { FS.roll.setPlayhead(t); } catch (e) {}
    if (t > dur) { musicStop(); return; }
    root.requestAnimationFrame(tickMusic);
  }

  $('btn-play').addEventListener('click', function () {
    if (mPlaying) musicStop(); else musicPlay();
  });
  $('btn-stop').addEventListener('click', musicStop);
  $('btn-wav').addEventListener('click', function () {
    if (!mBuf) { setStatus('还没合成出音频', 'bad'); return; }
    var blob = new Blob([FS.encodeWav(mBuf)], { type: 'audio/wav' });
    FS.download(blob, 'soundtrack.wav');
    setStatus('✓ 已导出 wav（' + (blob.size / 1048576).toFixed(2) + ' MB）', 'ok');
  });
  Array.prototype.forEach.call(document.querySelectorAll('#presets .chip'), function (b) {
    b.addEventListener('click', function () {
      var p = PRESETS[b.dataset.preset];
      $('score-input').value = JSON.stringify(p, null, 2);
      var sc = parseMusic();
      if (sc) renderMusic(sc);
    });
  });
  $('master').addEventListener('input', function () {
    $('master-val').textContent = this.value;
    $('score-input').value = JSON.stringify(decorateMaster(), null, 2);
    var sc = parseMusic();
    if (sc) renderMusic(sc);
  });
  function decorateMaster() {
    var sc = mScore || PRESETS.loop;
    sc.master = parseFloat($('master').value);
    return sc;
  }

  /* ================== 宣传片生成器 ================== */
  var film = {
    title: '群论：结构之美', template: 'concept', palette: 'ink', engine: '2d',
    bpm: 84, beats: 8, scenes: [], music: true, sub: 'on',
    custom: null,      // 手动挑的配乐（音乐工厂出的曲子）；null = 按片名自动生成
    sb: null, sbSeed: null   // 3D 分镜脚本与其种子
  };
  var fBuf = null, fPlaying = false, fStart = 0, fNode = null, fT0 = 0, fRAF = null;

  function readFilm() {
    film.title = $('f-title').value.trim() || '未命名';
    film.template = $('f-template').value;
    film.palette = $('f-palette').value;
    film.engine = $('f-engine').value;      // '2d' | '3d'
    film.bpm = parseInt($('f-bpm').value, 10) || 84;
    film.beats = parseInt($('f-beats').value, 10) || 8;
    film.music = $('f-music').checked;
    film.sub = $('f-sub').value;      // 关掉后母题函数里就不画字幕
    film.scenes = [];
    Array.prototype.forEach.call(document.querySelectorAll('#f-scenes .scene'), function (el) {
      var ins = el.querySelectorAll('input');
      film.scenes.push({
        title: (ins[0].value || '').trim(),
        text: (ins[1].value || '').trim()
      });
    });
    if (!film.scenes.length) film.scenes = [{ title: film.title, text: '' }];
    var tl = FS.story.timeline(film);
    $('f-timing').textContent = '共 ' + film.scenes.length + ' 段 · 每段 ' + film.beats + ' 拍 / ' +
      (film.beats * 60 / film.bpm).toFixed(2) + 's · 全长 ' + tl.total.toFixed(2) + 's';
    drawTimeline();
    drawDots(tl);
    if (film.template === 'daily') applyScenes();
    // 配乐那行提示顺手动一下：文案一改，合不合拍的结论可能就变了（musicPlan 有缓存，不重算）
    try { refreshMusicLine(); } catch (e) {}
  }

  function addScene(scene) {
    scene = scene || { title: '', text: '' };
    var wrap = document.createElement('div');
    wrap.className = 'scene';
    var idx = document.createElement('div'); idx.className = 'idx';
    // 序号按「DOM 里已有几张卡」算：film.scenes 此时还是上一轮的旧值，会差一位
    idx.textContent = String(document.querySelectorAll('#f-scenes .scene').length + 1).padStart(2, '0');
    var body = document.createElement('div'); body.className = 'body';
    var i1 = document.createElement('input'); i1.type = 'text'; i1.value = scene.title; i1.placeholder = '小标题 / 公式 / 左栏名';
    var i2 = document.createElement('input'); i2.type = 'text'; i2.value = scene.text; i2.placeholder = '一句点题的话';
    body.appendChild(i1); body.appendChild(i2);
    var del = document.createElement('button'); del.className = 'del'; del.textContent = '×';
    del.addEventListener('click', function () {
      if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
      Array.prototype.forEach.call(document.querySelectorAll('#f-scenes .scene'), function (el, k) {
        el.querySelector('.idx').textContent = String(k + 1).padStart(2, '0');
      });
      readFilm();
      redraw();
      sync3D();
    });
    [i1, i2].forEach(function (i) {
      i.addEventListener('input', function () { readFilm(); redraw(); sync3D(); });
    });
    wrap.appendChild(idx); wrap.appendChild(body); wrap.appendChild(del);
    $('f-scenes').appendChild(wrap);
    // film.scenes 由 readFilm() 从 DOM 重建，这里不要 push，否则序号会整体错位
  }

  $('f-add-scene').addEventListener('click', function () { addScene({ title: '第 ' + (film.scenes.length + 1) + ' 段', text: '' }); readFilm(); redraw(); sync3D(); });

  /* 3D 分镜随文案自动重排：改文案不重建分镜 = 导出还是旧文案的画面（字幕缺失的根因）。
     打字会连发 input，防抖 700ms；显式动作（自动分段）直接调 sync3DNow。 */
  var sync3dTimer = 0;
  function sync3DNow() {
    if (film.engine !== '3d' || !gl3d) return;
    readFilm();
    film.sbSeed = null;                              // 文案变了，按新文案重算种子
    runDirector('local');
  }
  function sync3D() {
    clearTimeout(sync3dTimer);
    sync3dTimer = setTimeout(sync3DNow, 700);
  }

  /* 粘贴全文自动分段：句号/问叹号切句，长句再按逗顿切，打包成每段 ≤24 字
     （24 字约 5 秒旁白，正好装进默认 8 拍/段），碎句并入前段。 */
  function splitNarration(text) {
    var t = (text || '').replace(/\s+/g, '');
    if (!t) return [];
    var sentences = [], buf = '';
    for (var i = 0; i < t.length; i++) {
      buf += t[i];
      if ('。！？!?；;…'.indexOf(t[i]) >= 0) { sentences.push(buf); buf = ''; }
    }
    if (buf) sentences.push(buf);
    var pieces = [];
    sentences.forEach(function (p) {
      if (p.length <= 24) { pieces.push(p); return; }
      var clauses = [], sub = '';
      for (var j = 0; j < p.length; j++) {
        sub += p[j];
        if ('，,、：:'.indexOf(p[j]) >= 0 && sub.length >= 8) { clauses.push(sub); sub = ''; }
      }
      if (sub) clauses.push(sub);
      var pack = '';
      clauses.forEach(function (c) {
        if (pack && (pack + c).length > 24) { pieces.push(pack); pack = c; }
        else pack += c;
      });
      if (pack) pieces.push(pack);
    });
    var out = [];
    pieces.forEach(function (p) {
      // 无标点超长兜底：硬切 24 字
      if (p.length > 24) {
        for (var k = 0; k < p.length; k += 24) out.push(p.slice(k, k + 24));
      } else if (out.length && (out[out.length - 1] + p).length <= 24) {
        out[out.length - 1] += p;
      } else out.push(p);
    });
    return out.slice(0, 24).map(function (s) { return { title: '', text: s }; });
  }
  $('f-split').addEventListener('click', function () {
    var parts = splitNarration($('f-bulk').value);
    if (!parts.length) { hint($('f-status'), '先把整篇文案粘到上面的框里', 'bad'); return; }
    $('f-scenes').innerHTML = '';
    parts.forEach(function (p) { addScene(p); });
    readFilm(); redraw(); sync3DNow();
    hint($('f-status'), '已拆成 ' + parts.length + ' 段，3D 分镜已按新文案重排', 'ok');
  });

  function drawDots(tl) {
    var box = $('f-scene-dots');
    box.innerHTML = '';
    tl.marks.forEach(function (m, i) {
      var d = document.createElement('div');
      d.className = 'dot'; d.title = '第 ' + (i + 1) + ' 段';
      d.addEventListener('click', function () { filmJump(m.start); });
      box.appendChild(d);
    });
  }

  function markDots(t) {
    var tl = FS.story.timeline(film);
    var i = tl.marks.findIndex(function (m) { return t >= m.start && t < m.end; });
    if (i < 0) i = tl.marks.length - 1;
    Array.prototype.forEach.call($('f-scene-dots').children, function (d, k) {
      d.classList.toggle('on', k === i);
    });
  }

  function drawTimeline() {
    var cv = $('timeline'), g = cv.getContext('2d');
    var w = cv.width, h = cv.height;
    g.clearRect(0, 0, w, h);
    g.fillStyle = FS.theme.trough; g.fillRect(0, 0, w, h);
    var tl = FS.story.timeline(film);
    var pad = 8, barY = 34, barH = 26;
    var x0 = pad, usable = w - pad * 2;
    tl.marks.forEach(function (m, i) {
      var x = x0 + usable * m.start / tl.total;
      var bw = usable * m.dur / tl.total - 3;
      var c = FS.story.palette(film.palette);
      var hovered = i === Math.floor((+($('f-scrub').value) / 1000) * tl.marks.length);
      g.fillStyle = hovered ? c.main : hexA(c.main, .28);
      g.fillRect(x, barY, Math.max(2, bw), barH);
      g.fillStyle = FS.theme.ink2;
      g.font = '11px ' + '"PingFang SC",sans-serif';
      g.fillText(String(i + 1), x + 4, barY + barH / 2 + 4);
    });
    g.strokeStyle = hexA(FS.theme.ink, .18);
    g.strokeRect(x0, barY, usable, barH);
    var cur = x0 + usable * (+($('f-scrub').value) / 1000);
    g.strokeStyle = FS.theme.ink; g.lineWidth = 2;
    g.beginPath(); g.moveTo(cur, 10); g.lineTo(cur, h - 10); g.stroke();
  }

  function hexA(hex, a) {
    var h = hex.replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  /** 重画一帧到 stage（t 由调用方给） */
  /** 画第 t 秒那一帧。st 缺省用当前 film；导出时传「参数快照」，
   *  这样用户在导出过程中改界面也不会让成片串帧（借鉴 digiCreature_ios 的导出前快照）。 */
  function paint(t, st) {
    st = st || film;
    var cv = $('stage');
    var g = cv.getContext('2d');
    g.clearRect(0, 0, cv.width, cv.height);
    // 3D 模式：GL 渲染完由 render3d 自己 drawImage 回 stage 并叠字幕，
    // 所以导出（captureStream(stage)）那条链路一行都不用改。
    if (st.engine === '3d' && gl3d && gl3d.storyboard) {
      if (gl3d.draw(t)) return;
      // 这一帧 3D 没出画（取不到地点/几何）→ 当帧丢掉 3D，用 2D 顶上，
      // 别把一块黑底留在预览里让人以为片子坏了
      gl3d.setStoryboard(null);
      var why = $('f-g3d');
      if (why) hint(why, '✗ 3D 这一帧没画出来，已改用 2D 兜底（点「重新生成分镜」再试）', 'bad');
    }
    FS.story.drawFrame(g, st, t);
  }

  /** 导出前的状态快照：只挑渲染真正会读的字段 */
  function filmSnapshot() {
    return {
      title: film.title, template: film.template, palette: film.palette,
      engine: film.engine, bpm: film.bpm, beats: film.beats, sub: film.sub,
      scenes: film.scenes.map(function (s) { return { title: s.title, text: s.text }; })
    };
  }

  function redraw() {
    var t = (+$('f-scrub').value) / 1000 * FS.story.timeline(film).total;
    $('f-clock').textContent = t.toFixed(2) + 's';
    if (gl3d) gl3d.setSubtitles(film.sub !== 'off');   // 「2. 定节奏」里的字幕开关对 3D 也生效
    paint(t);
    drawTimeline();
    markDots(t);
    showG3D();
  }

  /* ================== 3D 生活场景：引擎 + 导演 ================== */
  var gl3d = null, glFail = '';

  function glEngine() {
    if (gl3d || glFail) return gl3d;
    try {
      // out2d 传 stage 的 2D context：3D 帧 + 字幕都合成到它上面
      gl3d = FS.render3d.create($('gl'), { ctx: $('stage').getContext('2d') });
    } catch (e) {
      glFail = e.message;
      hint($('f3d-status'), '✗ WebGL 起不来：' + e.message, 'bad');
      return null;
    }
    return gl3d;
  }

  function setEngine(v) {
    readFilm();
    $('f3d-panel').hidden = (v !== '3d');
    $('f-2d-row').hidden = (v === '3d');
    // GL 画布永远收着：它只是画板，成帧之后 drawImage 到 stage（含字幕）才给人看。
    // 放它出来既会遮住 2D 画面（黑块），又会把字幕挡掉。
    $('gl').hidden = true;
    $('f-g3d').hidden = (v !== '3d');
    $('f-engine-tip').textContent = v === '3d'
      ? '3D：文案 → 地点 / 角色 / 动作 / 镜头'
      : '2D 母题适合讲道理，3D 适合讲生活';
    if (v === '3d') { if (glEngine()) runDirector('local'); }
    else if (gl3d) { gl3d.clear(); }
    redraw();
  }

  function directorOpts() {
    return {
      title: film.title, scenes: film.scenes, bpm: film.bpm, beats: film.beats,
      seed: film.sbSeed === null ? undefined : film.sbSeed
    };
  }

  function runDirector(mode) {
    var eng = glEngine();
    if (!eng) return;
    if (film.sbSeed === null || film.sbSeed === undefined) {
      // 没指定种子就按「片名 + 全部文案」定：同一份文案默认给同一部片子
      film.sbSeed = FS.director.fnv(film.title + '|' +
        film.scenes.map(function (s) { return (s.title || '') + (s.text || ''); }).join('|'));
    }
    var opts = directorOpts();
    var sb = FS.director.build(opts);
    if (mode === 'llm' && cfg && cfg.key) {
      hint($('f3d-status'), 'AI 导演思考中…（本地分镜已备好，失败会回落）');
      FS.director.askLLM(cfg, opts, sb).then(function (raw) {
        if (raw) {
          applySB(FS.director.mergeLLM(sb, raw));
          hint($('f3d-status'), '✓ AI 分镜已合入（' + sb.shots.length + ' 段，非法值已按本地规则顶掉）', 'ok');
        } else {
          applySB(sb);
          hint($('f3d-status'), '没拿到 AI 结果，用的本地分镜', 'ok');
        }
      })['catch'](function (e) {
        applySB(sb);
        hint($('f3d-status'), '✗ ' + e.message + '（已回落到本地分镜）', 'bad');
        // 八成是 Key / 模型这两件事。顺手重拉一次清单，用户当场能看到这个 Key 到底能用什么
        if (/401|403|鉴权|没权限|没开通|无权限/.test(e.message || '')) {
          try { pullModels(true); } catch (err) {}
        }
      });
    } else {
      applySB(sb);
      hint($('f3d-status'), '本地分镜（不联网）· 种子 ' + film.sbSeed, 'ok');
    }
  }

  function applySB(sb) {
    film.sb = sb;
    var eng = glEngine();
    if (eng) eng.setStoryboard(sb);
    showSB(sb);
    redraw();
  }

  function showSB(sb) {
    var box = $('f3d-sb');
    if (!box) return;
    box.innerHTML = '';
    var place = FS.world.placeById(sb.place) || {};
    var hero = FS.cast.castById(sb.hero) || {};
    var head = document.createElement('div');
    head.className = 'mf-head';
    head.textContent = sb.title + ' · 主场景 ' + (place.name || sb.place) +
      ' · 主角 ' + (hero.name || sb.hero) +
      ' · ' + sb.totalSec.toFixed(1) + 's / ' + sb.shots.length + ' 段' +
      ' · 种子 ' + sb.seed + (sb.source === 'llm' ? ' · AI 导演' : ' · 本地导演');
    box.appendChild(head);
    var grid = document.createElement('div');
    grid.className = 'mf-grid';
    sb.shots.forEach(function (s) {
      var d = document.createElement('span');
      d.className = 'mf-chip';
      var who = s.cast.map(function (c) {
        return (FS.cast.castById(c.id) || {}).name || c.id;
      }).join('、');
      d.innerHTML = '<b>段' + (s.index + 1) + '</b>' + ((FS.world.placeById(s.place) || {}).name || s.place) +
        ' · ' + who + ' · ' + s.shot.type + ' · ' + (s.grade.label || s.grade.mood);
      grid.appendChild(d);
    });
    box.appendChild(grid);
  }

  /** 底部实时状态：当前段 / 地点 / 镜头 / 三角面数 */
  function showG3D() {
    var el = $('f-g3d');
    if (!el) return;
    if (film.engine !== '3d') { el.hidden = true; return; }
    el.hidden = false;
    if (glFail) { hint(el, 'WebGL 不可用：' + glFail, 'bad'); return; }
    if (!gl3d || !gl3d.lastInfo) { hint(el, gl3d ? '点「按文案生成分镜」开始' : 'WebGL 还没初始化'); return; }
    var i = gl3d.lastInfo;
    var st = gl3d.stats();
    var le = gl3d.lastError || {};
    // 画面只有光影=几何没画出来时，这几个字段直接指认原因，不用猜
    var diag = 'GL:' + (le.glErrorName || '?') +
      ' · 着色器' + (le.program ? 'ok' : '失败') +
      ' · 帧缓冲' + (le.framebuffer ? 'ok' : '失败') +
      ' · uniform' + ((le.uProj && le.uModel && le.uView) ? 'ok' : '缺') +
      ' · 场景几何' + (le.drewSolid ? '已上传' : '空') +
      ' · 本帧角色' + (le.drewCast || 0);
    hint(el, '第 ' + (i.shotIndex + 1) + ' 段 · ' + i.placeName + ' · 镜头 ' + i.shotType +
      ' · ' + i.mood + ' · 出场 ' + (i.cast.join('、') || '（无角色）') +
      ' · 三角面 ' + st.tris + ' · 缓存 ' + st.places + '/' + st.placeMax + ' 场景' +
      (st.evicted ? ' · 已淘汰 ' + st.evicted : '') +
      ' · ' + (st.bloom ? '辉光开' : '辉光关') + ' ｜ ' + diag, 'ok');
  }

  /* ---------------- 2D 生活场景：选景 ---------------- */
  function fillSceneSelect() {
    var sel = $('f-scene');
    if (!sel || !FS.s2dScenes || !FS.s2dScenes.meta) return;
    var cur = sel.value;
    sel.innerHTML = '';
    var auto = document.createElement('option');
    auto.value = '';
    auto.textContent = '自动（按文案判断）';
    sel.appendChild(auto);
    Object.keys(FS.s2dScenes.meta).forEach(function (k) {
      var o = document.createElement('option');
      o.value = k;
      o.textContent = FS.s2dScenes.meta[k].name + '（' + FS.s2dScenes.meta[k].tags.join('·') + '）';
      sel.appendChild(o);
    });
    if (cur) sel.value = cur;
  }

  /** 按当前文案给每段选场景；手动指定时所有段都用它 */
  function applyScenes() {
    if (film.template !== 'daily') { film.scenes2d = null; return; }
    var manual = $('f-scene') && $('f-scene').value;
    if (manual) {
      film.scenes2d = film.scenes.map(function () { return manual; });
    } else if (FS.s2dPick) {
      film.scenes2d = FS.s2dPick.pickScenes(film.scenes, film.sbSeed || 0);
    }
    var names = (film.scenes2d || []).map(function (id) {
      return (FS.s2dScenes.meta && FS.s2dScenes.meta[id] || {}).name || id;
    });
    var tip = $('f-scene-tip');
    if (tip) { tip.hidden = false; tip.textContent = (manual ? '已手动指定 · ' : '自动 · ') + names.join(' → '); }
  }

  function syncTemplateUI() {
    var isDaily = film.template === 'daily';
    var row = $('f-scene-row');
    if (row) row.hidden = !isDaily;
    if (isDaily) { fillSceneSelect(); applyScenes(); }
  }

  $('f-scene').addEventListener('change', function () { readFilm(); applyScenes(); redraw(); });
  $('f-scene-auto').addEventListener('click', function () {
    $('f-scene').value = '';
    film.sbSeed = (FS.director.fnv(String(film.sbSeed) + '|s2d')) >>> 0;
    readFilm(); applyScenes(); redraw();
  });

  $('f-engine').addEventListener('change', function () { setEngine(this.value); });
  $('f3d-go').addEventListener('click', function () { runDirector($('f3d-mode').value); });
  $('f3d-reroll').addEventListener('click', function () {
    // 换种子 = 同一部文案换一版分镜：地点走位、镜头、氛围都会变，主角不变
    film.sbSeed = (FS.director.fnv(String(film.sbSeed) + '|reroll') + 7919) >>> 0;
    runDirector($('f3d-mode').value);
  });

  /* ---------------- 唯一的时间推进控制器 ----------------
   * 借鉴 hyperframes 的「player owns playback / timelines start paused」：
   * 播放与停止只能由一个控制器说了算。这里曾有**两条推进链**——预览走 rAF、
   * 导出走 setTimeout，而 filmStop() 只 cancel 了前者（导出时 fRAF 是 null），
   * 于是导出过程中点「停止」毫无反应。现在两条链都登记到 drive：
   * 停止 = token 自增（让在跑的链自行退出）+ 清掉 rAF / timer。
   */
  var drive = { raf: 0, timer: 0, token: 0 };

  function driveCancel() {
    drive.token++;
    if (drive.raf) { root.cancelAnimationFrame(drive.raf); drive.raf = 0; }
    if (drive.timer) { root.clearTimeout(drive.timer); drive.timer = 0; }
  }
  function driveToken() { return drive.token; }
  function driveAlive(tok) { return tok === drive.token; }

  /** 当前进度（秒）。停止/续播/从头播都读它，避免各处各算一遍 */
  function currentT() {
    var tl = FS.story.timeline(film);
    var v = +$('f-scrub').value;
    var t = isFinite(v) ? v / 1000 * tl.total : 0;
    return Math.max(0, Math.min(tl.total, isFinite(t) ? t : 0));
  }

  function filmStop() {
    fPlaying = false;
    driveCancel();
    if (fNode) { try { fNode.stop(); } catch (e) {} fNode = null; }
    narrStopAll();
    // ★ 停在中间就把按钮叫「继续」：点一下从断点接上，不用手动拖进度条回去找
    var t = currentT(), total = FS.story.timeline(film).total;
    $('f-preview').textContent = (t > 0.05 && t < total - 0.05)
      ? '▶ 继续播放（' + t.toFixed(1) + 's）' : '▶ 预览播放';
    if (fStatusAbort) fStatusAbort('已停止');
  }
  /** 导出/播放被中止时的收尾（由 drive token 触发） */
  var fStatusAbort = null;

  function filmPlay() {
    var tl = FS.story.timeline(film);
    try { ctx(); } catch (e) { hint($('f-status'), '✗ ' + e.message, 'bad'); return; }
    var c = ctx();
    filmStop();
    var from = currentT();                          // ★ 断点续播：从当前进度接，不是每次从头来
    var plan0 = musicPlan();
    // 配音先合成好（有缓存就是秒回），再起播——预览时人声按时间轴精确排程。
    // 进度直接打在预览按钮上；失败兜底恢复按钮，不再无声无息。
    buildNarrPlan(film, c, function (m) { $('f-preview').textContent = m; }).then(function (plan) {
      if (fPlaying) return;                        // 合成期间用户又点了停止/重播
      var p = plan0;
      if (!p.use) {                                // 判为不合拍 → 这台机器这次就没配乐可放
        fBuf = null;
        hint($('f-musicsrc'), '⏹ ' + p.reason + ' → 这次不配乐，只有画面 + 配音', 'bad');
      }
      // ⚠️ fBuf 以前压根没人赋值过，等于「预览配乐」这个开关一直是死的。
      //    现在按计划渲染一次（同一个 buffer，试听/导出/预览听到的都是它）。
      var audio = p.use ? filmRenderAudio() : Promise.resolve(null);
      return audio.then(function (buf) {
        if (fPlaying) return;
        fBuf = buf;
        if (buf && film.music) {                   // 有配乐就放；没有也照常播（纯画面+配音）
          fNode = c.createBufferSource();
          fNode.buffer = buf;
          fNode.connect(c.destination);
          fStart = c.currentTime + 0.08 - from;    // ⚠️ 音频整体左移 → 画面时间轴正好落回断点
          if (fStart < c.currentTime) fStart = c.currentTime;
          var off = buf.duration > 0.05 ? Math.min(from, buf.duration - 0.05) : 0;
          fNode.start(fStart, off > 0.01 ? off : undefined);   // 配乐也从断点的那一秒接着响
        } else fStart = c.currentTime + 0.08 - from;  // ⚠️ 必须赋值，否则 fT0 沿用上次的旧值，配音会排程到过去全部齐响
        if (fStart < c.currentTime) fStart = c.currentTime;
        fT0 = fStart;
        narrStopAll();                             // 双保险：清掉任何残留排程，杜绝重叠语音
        narrStartAt(plan, c, fT0, c.destination);
        fPlaying = true;
        tickFilm.tok = driveToken();   // 记下本轮 token：被「停止」作废后 tickFilm 会自行退出
        $('f-preview').textContent = '❚❚ 播放中';
        // 把「这次到底有没有人声、有没有配乐」写进状态行：以前配音挂了只有按钮复位，
        // 用户听不到声音却不知道原因（2026-10-05「视频里没有文字语音合成」）。
        var heard = [];
        heard.push(plan && plan.length ? ('配音 ' + plan.length + ' 段') : '无配音');
        heard.push((buf && film.music) ? '有配乐' : '无配乐');
        hint($('f-status'), (plan && plan.narrFail ? '⚠ ' + plan.narrNote + ' · ' : '✓ ') + heard.join(' · '),
          plan && plan.narrFail ? 'bad' : 'ok');
        tickFilm();
      });
    })['catch'](function (e) {
      $('f-preview').textContent = '▶ 预览播放';
      // 以前这里只复位按钮，什么都不说 → 失败等于静默
      hint($('f-status'), '✗ 播放没起来：' + (e && e.message ? e.message : '未知原因'), 'bad');
    });
  }

  function tickFilm() {
    if (!fPlaying || !driveAlive(tickFilm.tok)) return;
    var c = live;
    var t = c.currentTime - fT0;
    var tl = FS.story.timeline(film);
    if (t < 0) t = 0;
    if (t > tl.total) { t = tl.total; filmStop(); }
    $('f-scrub').value = Math.round(t / tl.total * 1000);
    $('f-clock').textContent = t.toFixed(2) + 's';
    paint(t);
    markDots(t);
    if (fPlaying) drive.raf = root.requestAnimationFrame(tickFilm);
  }

  function filmJump(t) {
    filmStop();
    var tl = FS.story.timeline(film);
    $('f-scrub').value = Math.round(Math.min(t, tl.total) / tl.total * 1000);
    redraw();
  }

  $('f-scrub').addEventListener('input', function () { filmStop(); redraw(); });
  $('f-preview').addEventListener('click', function () { fPlaying ? filmStop() : filmPlay(); });
  $('f-stop').addEventListener('click', filmStop);
  // 停在中间想重看：先回到 0（按钮自动变回「预览播放」），再起播
  if ($('f-restart')) {
    $('f-restart').addEventListener('click', function () {
      filmStop();
      $('f-scrub').value = 0;
      $('f-preview').textContent = '▶ 预览播放';
      redraw();
      filmPlay();
    });
  }

  ['f-title', 'f-template', 'f-palette', 'f-bpm', 'f-beats', 'f-sub'].forEach(function (id) {
    $(id).addEventListener('change', function () { readFilm(); syncTemplateUI(); redraw(); });
    $(id).addEventListener('input', function () { readFilm(); redraw(); });
  });
  $('f-music').addEventListener('change', function () { readFilm(); });

  // ⚠️ 两条链路都得先过 parseScore：工厂/故事吐的都是 {p, beat} 形式（没 t），
  // 直接送渲染器 = 音符时间 undefined，一路 NaN 变整段静音，还查不出毛病。
  function filmCues() {
    if (film.custom) return film.custom.score;      // 手工挑的那首
    return FS.factory.forFilm(film).score;         // 按片名当主题：同片名可复现，不同片名必不同
  }

  /* ---------------- 配乐跟文案对齐（不合拍就不配） ----------------
   * 用户定的两条规矩：
   *   ① 有文案 → 按字幕断句打点，拍点往字幕落点上靠；
   *   ② 判为不合拍（重合度太低 / 配乐太短）→ 直接不配乐，只出画面 + 配音。
   * 判定结果缓存起来：文案没动就不重复体检，预览和导出看到的是同一份结论。
   */
  var musicPlanCache = null, musicPlanKey = '';

  function musicPlanKeyOf() {
    return [film.title, film.template, film.palette, film.bpm, film.beats,
      JSON.stringify((film.scenes || []).map(function (s) { return (s.title || '') + '|' + (s.text || ''); })),
      JSON.stringify(film.custom ? film.custom.score : null)].join('#');
  }

  function musicPlan(force) {
    var k = musicPlanKeyOf();
    if (!force && musicPlanCache && musicPlanKey === k) return musicPlanCache;
    var raw = filmCues();
    var rep = FS.scoreSync.syncReport(raw, film);
    var out = FS.scoreSync.apply(raw, film, rep);
    musicPlanCache = { raw: out.score || raw, use: rep.use, reason: rep.reason,
      ratio: rep.ratio, anchors: rep.anchors, snapped: !!out.score };
    musicPlanKey = k;
    refreshMusicLine();      // 只在重新体检后写一次，拖进度条不会一直重写这行字
    return musicPlanCache;
  }

  function refreshMusicLine() {
    var mh = $('f-musicsrc');
    if (!mh) return;
    var p = musicPlan();                        // 命中缓存时不重算
    var tail = p.use
      ? '跟字幕对齐：' + p.anchors.length + ' 个落点（' + p.reason + '）'
      : '⏹ ' + p.reason + ' → 这次不配乐，只有画面 + 配音';
    hint(mh, musicLabel + ' · ' + tail);
  }

  /** 配乐到底放不放 + 为什么：给状态行和「只导配乐」按钮用 */
  function musicHint() {
    var p = musicPlan();
    return p.use
      ? '配乐已按字幕断句对齐（' + p.anchors.length + ' 个落点，' + p.reason + '）'
      : '⏹ ' + p.reason + ' → 这次不配乐，只有画面 + 配音';
  }
  /* ---------------- 配音（服务器 edge-tts，ffmpeg 级中文音色） ---------------- */
  var narrCache = {};          // 'voice|text' -> AudioBuffer，预览/导出共用
  var fVoiceNodes = [];        // 正在响/已排程的配音源，停止时全停

  function fetchNarr(text, voice, c) {
    var key = voice + '|' + text;
    if (narrCache[key]) return Promise.resolve(narrCache[key]);
    return fetch('tts.php?voice=' + encodeURIComponent(voice) + '&text=' + encodeURIComponent(text))
      .then(function (r) {
        if (!r.ok) {
          // 站点是纯静态时最容易撞 404：tts.php 没跟着部署，配音就整条哑掉。
          // 这里把「服务器没这个文件」翻译成人话，别只甩一个数字。
          if (r.status === 404) throw new Error('服务器上没有 tts.php（配音服务没跟着站点一起部署）');
          if (r.status === 400) throw new Error('tts.php 拒了这段文案（单段限 90 字，或音色名不认）');
          throw new Error('TTS 服务失败 ' + r.status + '（「' + text.slice(0, 10) + '…」）');
        }
        return r.arrayBuffer();
      })
      .then(function (ab) { return c.decodeAudioData(ab); })
      .then(function (buf) { narrCache[key] = buf; return buf; });
  }

  /** 生成 [{at, buf}]：at = 该段在时间轴上的起点。按顺序合成，
   *  onProg(msg) 可选——把进度同步打到触发按钮上（状态条在页面顶部，用户盯着按钮看）。
   *  ⚠️ 返回值在 plan 数组上挂了 narrFail / narrNote 两个字段（数组本身照旧是 [{at,buf}]）：
   *  以前「某一段合成失败」会让整条 Promise reject → filmPlay 的 catch 只把按钮复位，
   *  用户看到的就是「点了播放没反应」，完全不知道是配音挂了（2026-10-05 反馈「没有语音合成」）。
   *  现在逐段容错：成功的照常排程，失败的记下原因，片子照样出（画面 + 能合成的那几段）。 */
  function buildNarrPlan(st, c, onProg) {
    var voice = ($('f-voice') && $('f-voice').value) || '';
    function bare(note) { var a = []; a.narrFail = 0; a.narrNote = note; return a; }
    if (!voice) return Promise.resolve(bare('配音设为「无」'));
    var texts = st.scenes.map(function (s) { return (s.text || '').trim(); });
    var need = [];
    texts.forEach(function (tx, i) { if (tx) need.push(i); });
    if (!need.length) return Promise.resolve(bare('这一片没有文案，没有可念的内容'));
    var tl = FS.story.timeline(st);
    var items = [], done = 0, fail = 0, firstErr = '';
    function prog(msg) { hint($('f-status'), msg); if (onProg) onProg(msg); }
    prog('⏳ 合成配音 0/' + need.length + '…');
    return need.reduce(function (chain, idx) {
      return chain.then(function () {
        return fetchNarr(texts[idx], voice, c).then(function (buf) {
          done++;
          prog('⏳ 合成配音 ' + done + '/' + need.length + '…');
          items.push({ at: tl.marks[idx] ? tl.marks[idx].start : 0, buf: buf });
        })['catch'](function (e) {
          done++; fail++;
          if (!firstErr) firstErr = e.message;
          prog('⏳ 合成配音 ' + done + '/' + need.length + '（第 ' + (idx + 1) + ' 段失败，继续）…');
        });
      });
    }, Promise.resolve()).then(function () {
      items.narrFail = fail;
      items.narrNote = fail
        ? ('有 ' + fail + '/' + need.length + ' 段没合成出来：' + firstErr)
        : ('配音 ' + need.length + ' 段就绪');
      prog(fail ? '⚠ ' + items.narrNote : '✓ ' + items.narrNote);
      return items;
    });
  }

  function narrStartAt(plan, c, baseTime, dest1, dest2) {
    plan.forEach(function (p) {
      if (!isFinite(baseTime + p.at)) return;      // 非法时刻（NaN/undefined）不排程，宁缺毋滥
      var src = c.createBufferSource();
      src.buffer = p.buf;
      src.connect(dest1);
      if (dest2) src.connect(dest2);
      src.start(baseTime + p.at);
      fVoiceNodes.push(src);
    });
  }
  function narrStopAll() {
    fVoiceNodes.forEach(function (n) { try { n.stop(); n.disconnect(); } catch (e) {} });
    fVoiceNodes = [];
  }

  /** 导出被「停止」打断时的收尾：停录、停音频、恢复按钮、给出可读原因 */
  function abortExport(rec, node, btn, k, frames) {
    try { if (rec && rec.state !== 'inactive') rec.stop(); } catch (e) {}
    try { if (node) { node.stop(); node.disconnect(); } } catch (e) {}
    if (btn) btn.disabled = false;
    fNode = null; fPlaying = false;
    drive.timer = 0;
    if (gl3d && film.sb) gl3d.setStoryboard(film.sb);   // 恢复预览用的分镜
    hint($('f-status'), '⏹ 已停止在第 ' + k + '/' + frames + ' 帧', 'ok');
  }

  /** 渲染配乐。判为不合拍时返回 null —— 宁可不配，也别放一段乱响的 */
  function filmRenderAudio() {
    var p = musicPlan();
    if (!p.use) return Promise.resolve(null);
    var sc = FS.parseScore(JSON.stringify(p.raw));   // 顺带校验，坏谱会给人话错误
    return FS.renderScore(sc, { sampleRate: 44100 });
  }

  $('f-newmusic').addEventListener('click', function () {
    readFilm();
    var bars = Math.max(2, Math.min(48, Math.round(film.scenes.length * film.beats / 4)));
    var res = FS.factory.generateUnique({ theme: film.title, bpm: film.bpm, bars: bars }, mfUsed);
    film.custom = { score: res.score, meta: res.meta };
    mfApply(res);                                   // 顺便让配乐台也能看/改这一首
    setMusicLabel('配乐来源：按片名「' + film.title + '」现生成 · ' +
      res.meta.style.name + ' / ' + res.meta.bpm + ' BPM / 指纹 ' + res.meta.fingerprint);
  });

  $('f-audio').addEventListener('click', function () {
    try { ctx(); } catch (e) { hint($('f-status'), '✗ ' + e.message, 'bad'); return; }
    var p = musicPlan();
    if (!p.use) {                       // 不合拍就直说，别给用户一个 0 秒的 wav
      hint($('f-status'), '⏹ 这次不导配乐：' + p.reason, 'bad');
      return;
    }
    filmRenderAudio().then(function (buf) {
      if (!buf) { hint($('f-status'), '⏹ 这次不导配乐：' + p.reason, 'bad'); return; }
      var blob = new Blob([FS.encodeWav(buf)], { type: 'audio/wav' });
      FS.download(blob, (film.title || 'score') + '.wav');
      hint($('f-status'), '✓ 配乐已导出（' + buf.duration.toFixed(1) + 's，' + (blob.size / 1048576).toFixed(2) + ' MB）', 'ok');
    })['catch'](function (e) { hint($('f-status'), '✗ ' + e.message, 'bad'); });
  });

  /* ---------------- 视频录制 ---------------- */
  var MIME_CANDS = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
  function pickMime() {
    if (!root.MediaRecorder) return null;
    for (var i = 0; i < MIME_CANDS.length; i++) {
      if (MediaRecorder.isTypeSupported(MIME_CANDS[i])) return MIME_CANDS[i];
    }
    return '';
  }

  /* ---------------- 视频导出：逐帧确定性 ----------------
   * 借鉴 digiCreature_ios 的做法（VideoExporter 用 t = k/fps，姿态只由帧号决定，不读系统时间）：
   * 原来是 rAF 循环 + `t = c.currentTime - t0`（墙钟驱动），掉帧/卡顿会让画面时间轴跳变，
   * 同一份片子两次导出会不一样。现在改成：
   *   画面：captureStream(0) + track.requestFrame() 手动推帧，t = k / FPS 严格递增
   *   墙钟：只用来「什么时候推下一帧」，不参与画面内容计算
   *   音频：仍实时播放（要听见），推帧速度被限到不超过实时 → 音画不会错位
   * 浏览器不支持 requestFrame 时回落成「自动抓帧 + 同样的 t=k/fps」，确定性弱一档但不会黑屏。
   */
  var EXPORT_FPS = 30;
  $('f-render').addEventListener('click', function () {
    var mime = pickMime();
    var cv = $('stage');
    if (mime === null || !cv.captureStream) {
      hint($('f-status'), '这个浏览器不支持录制（MediaRecorder），换 Chrome / Edge；或者点『逐帧 PNG』', 'bad');
      return;
    }
    try { ctx(); } catch (e) { hint($('f-status'), '✗ ' + e.message, 'bad'); return; }

    var btn = this;
    btn.disabled = true;
    driveCancel();          // 连续导出两次时，先把上一轮残留的链作废
    var snap = filmSnapshot();                       // 快照：导出期间改界面不影响成片
    var sbSnap = film.sb;
    var tl = FS.story.timeline(snap);
    var c = ctx();

    // 能不能手动推帧？决定导出走「完全确定性」还是「弱确定性」
    var probeStream = cv.captureStream(0);
    var canPush = !!(probeStream.getVideoTracks()[0] && probeStream.getVideoTracks()[0].requestFrame);
    var stream = canPush ? probeStream : cv.captureStream(EXPORT_FPS);
    var track = stream.getVideoTracks()[0];

    // 配音先合成（进度见状态条），再渲配乐，最后一起排进录制流
    buildNarrPlan(snap, c, function (m) { btn.textContent = m; }).then(function (plan) {
      return filmRenderAudio().then(function (buf) { return { buf: buf, plan: plan }; });
    }).then(function (r) {
      var buf = r.buf, plan = r.plan;
      if (snap.engine === '3d' && gl3d && sbSnap) gl3d.setStoryboard(sbSnap);
      var media = c.createMediaStreamDestination();
      var node = null;
      if (buf) {                        // 判为不合拍时 buf 为 null —— 只录画面 + 配音，不放空响轨
        node = c.createBufferSource();
        node.buffer = buf;
        node.connect(media);
        node.connect(c.destination);    // 同步外放，不然录的时候听不见
      }
      var rec = new MediaRecorder(new MediaStream([track].concat(media.stream.getAudioTracks())),
        mime ? { mimeType: mime, videoBitsPerSecond: 6000000 } : undefined);

      var chunks = [];
      rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
      rec.onstop = function () {
        filmStop();
        narrStopAll();
        btn.disabled = false;
        btn.textContent = '⦿ 导出视频（含配乐）';
        var blob = new Blob(chunks, { type: mime || 'video/webm' });
        FS.download(blob, (snap.title || 'film') + (mime.indexOf('mp4') >= 0 ? '.mp4' : '.webm'));
        hint($('f-status'), '✓ 导出完成（' + frames + ' 帧 @' + EXPORT_FPS + 'fps，' +
          (blob.size / 1048576).toFixed(1) + ' MB' + (canPush ? '，逐帧确定性' : '，自动抓帧模式') + '）', 'ok');
        if (gl3d) gl3d.setStoryboard(film.sb);        // 恢复预览用的分镜
      };

      var total = tl.total;
      var frames = Math.max(1, Math.ceil(total * EXPORT_FPS));
      var t0Wall = c.currentTime + 0.12;
      // ⚠️ node 只在「判为合拍」时才建。上一轮加了「不合拍就不配乐」后这里还写着
      //    node.start(t0Wall) 无条件调用 → 不配乐时 node 是 null，直接抛 TypeError，
      //    整条导出链 reject，表现为「点导出没反应/报 unknown」。（自己引入的回归）
      if (node) node.start(t0Wall);
      narrStopAll();                               // 连续导出两次时清掉上一轮残留
      narrStartAt(plan, c, t0Wall, media, c.destination);   // 人声按时间轴录进流里 + 外放
      rec.start();
      fNode = node; fPlaying = false;                  // 导出不走播放逻辑，自己排帧
      var what = [];
      if (buf) what.push('配乐'); else what.push('无配乐（' + (musicPlan().reason || '不合拍') + '）');
      what.push(plan && plan.length ? ('配音 ' + plan.length + ' 段') : '无配音');
      hint($('f-status'), '导出中… ' + (canPush ? '逐帧确定性模式' : '自动抓帧模式（该浏览器不支持手动推帧）') +
        ' · 本次含：' + what.join(' + '), 'ok');

      var bar = $('f-progress');
      var wall0 = (root.performance && performance.now) ? performance.now() : Date.now();
      var now = function () { return ((root.performance && performance.now) ? performance.now() : Date.now()) - wall0; };
      var k = 0;

      function finish() {
        bar.style.width = '100%';
        $('f-clock').textContent = total.toFixed(2) + 's';
        // 音频是实时的：画面推完了音频可能还在放，等它播完再收尾（音画才对得上）
        var remain = (t0Wall + total + 0.25) - c.currentTime;
        setTimeout(function () {
          // rec 和 node 分开 try：以前写在一起，node 为 null 时 node.stop() 先抛，
          // 连带把 rec.stop() 也跳过 → 录制停不下来、按钮一直卡在「导出中」。
          try { rec.stop(); } catch (e) {}
          try { if (node) { node.stop(); node.disconnect(); } } catch (e) {}
        }, Math.max(150, remain * 1000));
      }

      var myTok = driveToken();
      function step() {
        if (!driveAlive(myTok)) { abortExport(rec, node, btn, k, frames); return; }
        if (k >= frames) { finish(); return; }
        var t = k / EXPORT_FPS;                        // ★ 时间只由帧号决定
        paint(t, snap);
        markDots(t);
        if (canPush) track.requestFrame();
        k++;
        $('f-clock').textContent = t.toFixed(2) + 's';
        bar.style.width = Math.min(100, k / frames * 100) + '%';
        // 限速：不比实时快，否则音频先放完、画面还在推 → 音画错位
        var due = k * (1000 / EXPORT_FPS);
        drive.timer = setTimeout(step, Math.max(0, due - now()));
      }
      setTimeout(step, 0);
    })['catch'](function (e) {
      btn.disabled = false;
      btn.textContent = '⦿ 导出视频（含配乐）';
      hint($('f-status'), '✗ ' + e.message, 'bad');
    });
  });

  /* ---------------- 逐帧 PNG ---------------- */
  $('f-frames').addEventListener('click', function () {
    var tl = FS.story.timeline(film);
    var cv = document.createElement('canvas');
    cv.width = FS.story.W; cv.height = FS.story.H;
    var g = cv.getContext('2d');
    var made = 0;
    tl.marks.forEach(function (m, i) {
      var mid = (m.start + m.end) / 2;
      FS.story.drawFrame(g, film, mid);
      cv.toBlob(function (b) {
        FS.download(b, (film.title || 'frame') + '-' + String(i + 1).padStart(2, '0') + '.png');
      });
      made++;
    });
    hint($('f-status'), '已按每段中点导出 ' + made + ' 张 PNG（浏览器会连续弹出下载）', 'ok');
  });

  /* ---------------- 项目备份 ---------------- */
  $('f-project').addEventListener('click', function () {
    readFilm();
    var payload = { type: 'film-project', v: 1, film: film, score: FS.story.buildScore(film) };
    FS.download(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
      (film.title || 'project') + '.json');
    hint($('f-status'), '✓ 项目已备份（含配乐谱，可复原到配乐台重调）', 'ok');
  });

  /* ================== 文案助手（字幕从哪来） ================== */
  var cfg = FS.script.loadCfg() || {};

  function scriptOpts() {
    return {
      topic: $('sw-topic').value,
      example: $('sw-example').value,
      mood: $('sw-mood').value,
      count: $('sw-count').value,
      bpm: parseInt($('f-bpm').value, 10) || 84
    };
  }

  /** 把文案灌进生成器：重建段落 DOM、顺带把每段拍数调到读得完 */
  function applyScript(out) {
    var box = $('f-scenes');
    box.innerHTML = '';
    (out.scenes || []).forEach(function (s) { addScene({ title: s.title, text: s.text }); });
    $('f-title').value = out.title || '未命名';
    if (out.advice && out.advice.beats) $('f-beats').value = out.advice.beats;
    readFilm();
    redraw();
    var adv = out.advice || FS.script.advice(out.scenes, parseInt($('f-bpm').value, 10));
    hint($('sw-out'), '已填入 ' + out.scenes.length + ' 段。最长一段 ' + adv.longest +
      ' 字' + (adv.ok ? '，这个字数读得过来。' : '，偏长了，观众来不及看——建议拆短或加拍数：') +
      ' 每段建议 ' + adv.beats + ' 拍（' + (adv.beats * 60 / (parseInt($('f-bpm').value, 10) || 84)).toFixed(1) + 's）。', adv.ok ? 'ok' : 'bad');
  }

  $('sw-go').addEventListener('click', function () {
    var mode = $('sw-mode').value;
    var opts = scriptOpts();
    opts.engine = $('f-engine').value;   // 让模型知道自己在给哪种画面写字幕（2D 手绘 / 3D 低多边形生活场景）
    if (mode === 'llm') {
      opts.base = $('sw-base').value.trim();
      opts.key = $('sw-key').value.trim();
      opts.model = $('sw-model').value.trim();
      if (!opts.key) { hint($('sw-status'), '✗ 先展开「API 设置」填 Key', 'bad'); return; }
    }
    var btn = this;
    btn.disabled = true;
    FS.script.generate(mode, opts, function (p) { $('sw-status').textContent = p; })
      .then(function (out) {
        applyScript(out);
        hint($('sw-status'), '✓ 生成完成', 'ok');
      })['catch'](function (e) {
        hint($('sw-status'), '✗ ' + e.message, 'bad');
      })['finally'](function () { btn.disabled = false; });
  });

  /* ---------------- 一键成片（联网全自动） ----------------
   * 一个来回让模型把「主题 + 具象例子 + 片名 + 每段字幕 + 每段分镜」全吐出来，页面上
   * 一个字都不用填；分镜一合入就直接开导出，不用再点「生成文案 / 生成分镜 / 导出」。
   *
   * ⚠️ 没 Key 时**不偷偷回落到本地模板**——那样会产生一个很坏的错觉：
   *    你以为片子是 AI 出的，其实渲染的是上一次的旧文案。宁可报错说清楚。
   */
  function autoFilm(btn) {
    var k = $('sw-key').value.trim() || (cfg && cfg.key) || '';
    var eff = {
      base: $('sw-base').value.trim() || (cfg && cfg.base) || '',
      key: k,
      model: $('sw-model').value.trim() || (cfg && cfg.model) || ''
    };
    if (!eff.key) {
      var fold = $('api-fold');
      if (fold) fold.open = true;
      hint($('sw-status'), '✗ 一键成片要联网：展开「API 设置」选个服务商（如火山方舟豆包）并填 Key，Key 只存你自己浏览器', 'bad');
      return;
    }
    if (!eff.base || !eff.model) {
      hint($('sw-status'), '✗ Base 或模型还是空的——展开「API 设置」选一下服务商，会自动补上', 'bad');
      return;
    }
    btn.disabled = true;
    hint($('sw-status'), 'AI 正在想主题、找例子、写字幕、排分镜…（一次往返，别走开）');
    // 用户填了就照他的写，没填就传空串让模型自己想（prompt 里会提示"用户没给，请自拟"）
    FS.director.auto(eff, {
      engine: $('f-engine').value,
      count: parseInt($('sw-count').value, 10) || 4,
      topic: $('sw-topic').value.trim(),
      example: $('sw-example').value.trim()
    }).then(function (j) {
      // ① 片名 + 段落灌进 UI
      if (j.topic) $('sw-topic').value = j.topic;
      if (j.example) $('sw-example').value = j.example;
      $('f-title').value = j.title || '未命名';
      var box = $('f-scenes');
      box.innerHTML = '';
      (j.scenes || []).forEach(function (s) { addScene({ title: s.title, text: s.text }); });
      readFilm();
      // ② 拍数跟着字数走（别让 22 字挤出 2 秒）
      var adv = FS.script.advice(film.scenes, film.bpm);
      $('f-beats').value = adv.beats;
      readFilm();
      redraw();
      // ③ 分镜：本地先推一版保证有合法值，再把模型给的盖上去
      film.sbSeed = null;
      var sb0 = FS.director.build(directorOpts());
      var merged = (j.shots && j.shots.length) ? FS.director.mergeLLM(sb0, j) : sb0;
      film.sbSeed = sb0.seed;
      applySB(merged);
      hint($('sw-status'), '✓ 成片就绪：' + (merged.title || '未命名') + ' · ' + merged.shots.length +
        ' 段 · 主场景 ' + ((FS.world.placeById(merged.place) || {}).name || merged.place) +
        ' · AI 例子「' + (j.example || '—') + '」，正在导出…', 'ok');
      // ④ 直接开导出（3D 要建 GL 上下文，给一拍的余地）
      setTimeout(function () {
        try { $('f-render').click(); }
        catch (e) { hint($('f-status'), '✗ ' + e.message + '（手动点『导出视频』即可）', 'bad'); }
      }, 400);
    })['catch'](function (e) {
      hint($('sw-status'), '✗ ' + e.message + '（没动你已经填的内容，改好再试一次）', 'bad');
    })['finally'](function () { btn.disabled = false; });
  }
  $('sw-auto').addEventListener('click', function () { autoFilm(this); });

  $('sw-apply').addEventListener('click', function () {
    var out = FS.script.local(scriptOpts());
    applyScript(out);
    hint($('sw-status'), '✓ 已填进下面（没调用任何网络）', 'ok');
  });

  $('sw-advice').addEventListener('click', function () {
    var opts = scriptOpts();
    var adv = FS.script.advice(FS.script.local(opts).scenes, opts.bpm);
    $('f-beats').value = adv.beats;
    readFilm(); redraw();
    hint($('sw-status'), '建议每段 ' + adv.beats + ' 拍（最长一段 ' + adv.longest + ' 字）', 'ok');
  });

  /* API 设置：本地存，换设备不会带过去（本来就没打算同步） */
  function applyPreset(id) {
    var p = FS.script.PRESETS.filter(function (x) { return x.id === id; })[0];
    if (!p) return;
    $('sw-base').value = p.base || cfg.base || '';
    $('sw-model').value = p.model || cfg.model || '';
    // 方舟按账号授权模型：预设里那个预览模型（doubao-seed-2-0-code-preview）不是每个账号都有，
    // 撞上去就是 401。查到清单就优先用 ep- 推理接入点——那是你自己在控制台建过、必定有权限的。
    if (p.id === 'ark') {
      var cached = null;
      try { cached = FS.script.readModelCache(p.base); } catch (e) {}
      var ep = (cached || []).filter(function (m) { return m && /^ep-/.test(String(m.id)); });
      if (ep.length) $('sw-model').value = ep[0].id;
    }
  }
  $('sw-preset').addEventListener('change', function () { cfg.preset = this.value; applyPreset(this.value); pullModels(true); });
  ['sw-base', 'sw-key', 'sw-model'].forEach(function (id) {
    $(id).addEventListener('change', function () {
      cfg[id] = this.value;
      cfg.base = $('sw-base').value; cfg.model = $('sw-model').value; cfg.key = $('sw-key').value;
      FS.script.saveCfg(cfg);
      if (id === 'sw-model') rememberModel(this.value.trim());
      else pullModels(true);      // 换了 Key / Base 就重新列一次这个账号能用什么
    });
    // 边打字边探会刷爆请求：松手稍等再自动拉一次（同一 Key 只自动一次，之后靠按钮）
    if (id === 'sw-key' || id === 'sw-base') {
      $(id).addEventListener('input', debounce(function () {
        var k = $('sw-key').value.trim(), b = $('sw-base').value.trim();
        if (!k || !b) return;
        pullModels(true);
      }, 1200));
    }
  });

  /* ---- 模型清单：填了 Key 就把这个账号已开通的模型列进下拉 ----
   * 下拉是 datalist（保留手打能力，自定义端点也能用），option 的 value 就是真实模型名，
   * label 给人看：中文备注 + 是不是自建接入点。 */
  function debounce(fn, ms) {
    var t = null;
    return function () {
      var self = this, args = arguments;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, ms);
    };
  }

  /** [{id,label}] 塞进 datalist。已经填了（上次选的 / 手打的）就别动，空着才替他选第一个。 */
  function fillModelPicker(list) {
    var dl = $('sw-model-list'), inp = $('sw-model');
    if (!dl || !inp) return { n: 0, cur: '', inList: false };
    var cur = (inp.value || '').trim();
    dl.innerHTML = '';
    (list || []).forEach(function (m) {
      var o = document.createElement('option');
      o.value = m.id;
      if (m.label && m.label !== m.id) o.setAttribute('label', m.label);
      dl.appendChild(o);
    });
    var inList = !!cur && (list || []).some(function (m) { return m.id === cur; });
    if (!cur && list && list.length) {
      // 空着就替他选。方舟是按账号授权模型的（写错一个字就是 401），
      // 所以有「推理接入点 ep-」就优先它——那是自己控制台建过、肯定有权限的
      var ep = (list || []).filter(function (m) { return m && /^ep-/.test(String(m.id)); });
      inp.value = (ep[0] || list[0]).id;
    }
    return { n: (list || []).length, cur: cur, inList: inList };
  }

  /** 手打的模型名也留个档（下次下拉里还能翻出来，最多 8 条） */
  function rememberModel(v) {
    if (!v) return;
    var h = cfg.modelHistory || (cfg.modelHistory = []);
    if (h.indexOf(v) < 0) { h.unshift(v); if (h.length > 8) h.length = 8; }
    FS.script.saveCfg(cfg);
  }

  function modelTip(msg, cls) {
    var el = $('sw-models');
    if (!el) return;
    el.textContent = msg;
    el.className = 'mono dim' + (cls ? ' ' + cls : '');
  }

  /** 拉清单。quiet=true 时不抢 sw-status 的位置，只在模型那行小字里说话 */
  var lastPull = { key: '', ts: 0 };
  function pullModels(quiet, force) {
    var k = $('sw-key').value.trim(), base = $('sw-base').value.trim();
    // 同一个 Key 刚拉过（4 秒内）就别重复刷，不然边打字边发请求
    var sig = k + '@' + base, now = Date.now();
    if (!force && lastPull.key === sig && now - lastPull.ts < 4000) return;
    lastPull.key = sig; lastPull.ts = now;
    if (!k) {
      modelTip('✗ 先填 Key 才能列清单');
      if (!quiet) hint($('sw-status'), '✗ 先填 Key，才能列出这个账号已开通的模型', 'bad');
      return;
    }
    if (!base) {
      modelTip('✗ Base 是空的');
      if (!quiet) hint($('sw-status'), '✗ Base 还是空的——先选个服务商（Base 会自动补）', 'bad');
      return;
    }
    var btn = $('sw-list');
    if (btn) btn.disabled = true;
    if (!quiet) modelTip('正在查…');
    FS.script.listModels({ base: base, key: k }).then(function (list) {
      var r = fillModelPicker(list);
      FS.script.writeModelCache(base, list);
      var msg = '✓ 这个 Key 可调用 ' + r.n + ' 个模型' + (r.cur && !r.inList ? '（你填的 ' + r.cur + ' 不在里头，注意别写错）' : '');
      modelTip(msg, r.cur && !r.inList ? 'bad' : 'ok');
      if (quiet) hint($('sw-status'), '✓ 已列出这个 Key 的 ' + r.n + ' 个可用模型，在「模型」下拉里直接选', 'ok');
    })['catch'](function (e) {
      modelTip('✗ ' + e.message);
      // 自动拉失败别吵（可能这家根本不给跨域）；手动点的、或方舟，必须说清楚
      if (!quiet || cfg.preset === 'ark') hint($('sw-status'), '✗ 拉模型清单失败：' + e.message, 'bad');
    })['finally'](function () { if (btn) btn.disabled = false; });
  }
  $('sw-list').addEventListener('click', function () { pullModels(false, true); });

  if (cfg.preset) $('sw-preset').value = cfg.preset;
  applyPreset(cfg.preset || 'deepseek');
  if (cfg.key) $('sw-key').value = cfg.key;
  // 先拿缓存把下拉填上（离线也能选），再悄悄去服务端刷新一次
  (function bootModels() {
    var base = $('sw-base').value.trim();
    if (!base) return;
    var cached = FS.script.readModelCache(base);
    if (cached && cached.length) fillModelPicker(cached);
    if ($('sw-key').value.trim()) pullModels(true);
  })();
  // 手打过的模型也补进下拉（追加，别把已开通的顶掉）
  (function bootHistory() {
    var cur = $('sw-model').value.trim();
    var dl = $('sw-model-list');
    var h = (cfg.modelHistory || []).filter(function (x) { return x && x !== cur; });
    if (!dl || !h.length) return;
    h.forEach(function (x) {
      var o = document.createElement('option');
      o.value = x; o.setAttribute('label', '你上次用的');
      dl.appendChild(o);
    });
  })();

  /* ================== tab 切换 & 环境自检 ================== */
  function switchTab(key) {
    Array.prototype.forEach.call(document.querySelectorAll('#tabs .tab'), function (x) {
      x.classList.toggle('active', x.dataset.tab === key);
    });
    ['music', 'film'].forEach(function (k) {
      $('panel-' + k).classList.toggle('active', k === key);
    });
    if (key === 'film') { readFilm(); redraw(); }
    try {
      if (location.hash.replace('#', '') !== key) history.replaceState(null, '', '#' + key);
    } catch (e) { /* file:// 下可能不允许改 hash，忽略即可 */ }
  }
  Array.prototype.forEach.call(document.querySelectorAll('#tabs .tab'), function (b) {
    b.addEventListener('click', function () { switchTab(b.dataset.tab); });
  });
  // 分享链接写 #film 可以直接落到生成器（手机上发给别人就是"点开就能做片"）
  switchTab((location.hash || '').replace('#', '') === 'film' ? 'film' : 'music');

  function probe() {
    var bits = [];
    var C = root.AudioContext || root.webkitAudioContext;
    var OC = root.OfflineAudioContext || root.webkitOfflineAudioContext;
    bits.push('WebAudio ' + (C ? '✓' : '✗'));
    bits.push('离线合成 ' + (OC ? '✓' : '✗'));
    var rec = pickMime();
    bits.push('视频录制 ' + (rec !== null ? '✓' : '✗'));
    bits.push('WAV 编码 ✓');
    // 3D 引擎不真正建上下文（那会吃掉一张纹理），只报能力；真正起不来时 f3d-status 会给人话错误
    var hasGL = !!(root.WebGL2RenderingContext || root.WebGLRenderingContext);
    bits.push('3D 生活场景 ' + (hasGL ? '可用' : '✗ 无 WebGL'));
    $('probe-badge').textContent = '本环境：' + bits.join(' · ');
  }

  /* ---------------- 启动 ---------------- */
  $('score-input').value = JSON.stringify(PRESETS.loop, null, 2);
  addScene({ title: '对称，是最早被看见的数学', text: '一个图形旋转后和自己重合——群就在这一步诞生' });
  addScene({ title: 'a² = e', text: '把「做一次」当成操作，做两次就回到原处' });
  addScene({ title: '三条公理', text: '封闭 · 结合 · 有单位与逆元' });
  addScene({ title: '所有对称构成一个群', text: '结构不是金箍棒，是统一描述的语言' });
  readFilm();
  redraw();
  parseMusic();
  if (mScore) renderMusic(mScore);
  probe();
  window.addEventListener('resize', function () { drawTimeline(); });
})(window);
