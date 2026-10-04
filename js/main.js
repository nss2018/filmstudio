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
    g.fillStyle = '#0b0e15';
    g.fillRect(0, 0, w, h);
    var d = buf.getChannelData(0), n = d.length;
    var cols = Math.min(w, 640);
    var step = Math.max(1, Math.floor(n / cols));
    g.strokeStyle = '#4dd0c7';
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
    g.strokeStyle = 'rgba(255,255,255,.08)';
    g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
  }

  function musicPlay() {
    if (!mBuf) return;
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
    tickMusic();
  }

  function musicStop() {
    mPlaying = false;
    if (mNode) { try { mNode.stop(); } catch (e) {} mNode = null; }
    $('btn-play').textContent = '▶ 播放';
    $('play-progress').style.width = '0%';
  }

  function tickMusic() {
    if (!mPlaying) return;
    var c = ctx();
    var t = c.currentTime - mStart;
    if (t < 0) t = 0;
    var dur = mBuf ? mBuf.duration : 1;
    $('play-progress').style.width = Math.min(100, t / dur * 100) + '%';
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
    title: '群论：结构之美', template: 'concept', palette: 'ink',
    bpm: 84, beats: 8, scenes: [], music: true, sub: 'on'
  };
  var fBuf = null, fPlaying = false, fStart = 0, fNode = null, fT0 = 0, fRAF = null;

  function readFilm() {
    film.title = $('f-title').value.trim() || '未命名';
    film.template = $('f-template').value;
    film.palette = $('f-palette').value;
    film.bpm = parseInt($('f-bpm').value, 10) || 84;
    film.beats = parseInt($('f-beats').value, 10) || 8;
    film.music = $('f-music').checked;
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
    });
    [i1, i2].forEach(function (i) {
      i.addEventListener('input', function () { readFilm(); redraw(); });
    });
    wrap.appendChild(idx); wrap.appendChild(body); wrap.appendChild(del);
    $('f-scenes').appendChild(wrap);
    // film.scenes 由 readFilm() 从 DOM 重建，这里不要 push，否则序号会整体错位
  }

  $('f-add-scene').addEventListener('click', function () { addScene({ title: '第 ' + (film.scenes.length + 1) + ' 段', text: '' }); readFilm(); redraw(); });

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
    g.fillStyle = '#0b0e15'; g.fillRect(0, 0, w, h);
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
      g.fillStyle = 'rgba(255,255,255,.55)';
      g.font = '11px ' + '"PingFang SC",sans-serif';
      g.fillText(String(i + 1), x + 4, barY + barH / 2 + 4);
    });
    g.strokeStyle = 'rgba(255,255,255,.12)';
    g.strokeRect(x0, barY, usable, barH);
    var cur = x0 + usable * (+($('f-scrub').value) / 1000);
    g.strokeStyle = '#fff'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(cur, 10); g.lineTo(cur, h - 10); g.stroke();
  }

  function hexA(hex, a) {
    var h = hex.replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  /** 重画一帧到 stage（t 由调用方给） */
  function paint(t) {
    var cv = $('stage');
    var g = cv.getContext('2d');
    g.clearRect(0, 0, cv.width, cv.height);
    FS.story.drawFrame(g, film, t);
  }

  function redraw() {
    var t = (+$('f-scrub').value) / 1000 * FS.story.timeline(film).total;
    $('f-clock').textContent = t.toFixed(2) + 's';
    paint(t);
    drawTimeline();
    markDots(t);
  }

  function filmStop() {
    fPlaying = false;
    if (fRAF) root.cancelAnimationFrame(fRAF);
    fRAF = null;
    if (fNode) { try { fNode.stop(); } catch (e) {} fNode = null; }
    $('f-preview').textContent = '▶ 预览播放';
  }

  function filmPlay() {
    var tl = FS.story.timeline(film);
    try { ctx(); } catch (e) { hint($('f-status'), '✗ ' + e.message, 'bad'); return; }
    var c = ctx();
    filmStop();
    if (film.music) {
      if (!fBuf) { hint($('f-status'), '配乐还没生成，先点『只导配乐』或直接开始的按钮', 'bad'); }
      else {
        fNode = c.createBufferSource();
        fNode.buffer = fBuf;
        fNode.connect(c.destination);
        fStart = c.currentTime + 0.08;
        fNode.start(fStart);
      }
    } else fStart = c.currentTime + 0.08;
    fT0 = fStart;
    fPlaying = true;
    $('f-preview').textContent = '❚❚ 播放中';
    tickFilm();
  }

  function tickFilm() {
    if (!fPlaying) return;
    var c = live;
    var t = c.currentTime - fT0;
    var tl = FS.story.timeline(film);
    if (t < 0) t = 0;
    if (t > tl.total) { t = tl.total; filmStop(); }
    $('f-scrub').value = Math.round(t / tl.total * 1000);
    $('f-clock').textContent = t.toFixed(2) + 's';
    paint(t);
    markDots(t);
    if (fPlaying) fRAF = root.requestAnimationFrame(tickFilm);
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

  ['f-title', 'f-template', 'f-palette', 'f-bpm', 'f-beats'].forEach(function (id) {
    $(id).addEventListener('change', function () { readFilm(); redraw(); });
    $(id).addEventListener('input', function () { readFilm(); redraw(); });
  });
  $('f-music').addEventListener('change', function () { readFilm(); });

  // ⚠️ buildScore 吐的是 {p, beat} 形式（没 t），必须先过 parseScore 归一化，
  // 否则音符时间是 undefined，一路 NaN 变成整段静音，还查不出毛病。
  function filmRenderAudio() {
    var raw = FS.story.buildScore(film);
    var sc = FS.parseScore(JSON.stringify(raw));   // 顺带校验，坏谱会给人话错误
    return FS.renderScore(sc, { sampleRate: 44100 });
  }

  $('f-audio').addEventListener('click', function () {
    try { ctx(); } catch (e) { hint($('f-status'), '✗ ' + e.message, 'bad'); return; }
    filmRenderAudio().then(function (buf) {
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
    var tl = FS.story.timeline(film);
    var c = ctx();
    var stream = cv.captureStream(30);
    var media = null;
    var node = null;

    filmRenderAudio().then(function (buf) {
      media = c.createMediaStreamDestination();
      node = c.createBufferSource();
      node.buffer = buf;
      node.connect(media);
      node.connect(c.destination);      // 同步外放，不然录的时候听不见
      var rec = new MediaRecorder(new MediaStream([
        stream.getVideoTracks()[0], media.stream.getAudioTracks()[0]
      ]), mime ? { mimeType: mime, videoBitsPerSecond: 6000000 } : undefined);

      var chunks = [];
      rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
      rec.onstop = function () {
        filmStop();
        btn.disabled = false;
        var blob = new Blob(chunks, { type: mime || 'video/webm' });
        FS.download(blob, (film.title || 'film') + (mime.indexOf('mp4') >= 0 ? '.mp4' : '.webm'));
        hint($('f-status'), '✓ 导出完成（' + (blob.size / 1048576).toFixed(1) + ' MB）', 'ok');
      };

      var t0 = c.currentTime + 0.12;
      node.start(t0);
      rec.start();
      fNode = node; fPlaying = true; fT0 = t0;

      var bar = $('f-progress');
      (function loop() {
        if (!fPlaying) return;
        var t = c.currentTime - t0;
        bar.style.width = Math.min(100, t / tl.total * 100) + '%';
        $('f-clock').textContent = Math.max(0, t).toFixed(2) + 's';
        paint(Math.max(0, t));
        markDots(Math.max(0, t));
        if (t > tl.total) {
          bar.style.width = '100%';
          setTimeout(function () { try { rec.stop(); node.stop(); node.disconnect(); } catch (e) {} }, 120);
          fPlaying = false;
          return;
        }
        fRAF = root.requestAnimationFrame(loop);
      })();
    })['catch'](function (e) {
      btn.disabled = false;
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
