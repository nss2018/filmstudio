/* roll.js —— 钢琴卷帘图形编辑器（纯 Canvas + Pointer Events，手机手指也能画）
 *
 * 设计取舍：
 *   1) 编辑的是「拍」而不是「秒」——改 BPM 音符不会乱跳，跟 cues.json 的 beat 语义一致；
 *      只有音符时长 d 输出时换算成秒（parseScore 里 d 就是秒）。
 *   2) 纵轴默认只画五声音阶（两个八度 = 10 格）。怎么点都不难听，这是给非乐手用的。
 *      打击乐轨强制一行，只能左右拖。
 *   3) 不自己造时间轴语义：画完序列化成标准 cues.json，照样走 parseScore / renderScore。
 */
(function (root) {
  'use strict';
  var FS = (root.FS = root.FS || {});

  var PENTA = [0, 2, 4, 7, 9];                 // 五声音阶（大调）
  var DRUMS = { kick: 1, snare: 1, hat: 1, clap: 1 };
  // 轨道配色：全大地色系，无紫无黑。theme.js 没加载（比如只引了 roll.js）时退回内置一份，别白屏
  var TRAIL = (FS.theme && FS.theme.trail) || ['#C05A38', '#2F6F7A', '#B8892B', '#6B7F45',
                                               '#A8442E', '#5A6B84', '#C77C4E', '#4E6B45'];

  var LBLW = 96;      // 左侧轨名栏宽
  var RH = 20;        // 旋律格高
  var DRH = 32;       // 鼓轨行高
  var CW = 30;        // 一格多宽（一拍）
  var ROWS = 10;      // 纵轴格数（五声两个八度）

  function isDrum(inst) { return !!DRUMS[inst]; }
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function trackColor(i) { return TRAIL[i % TRAIL.length]; }

  function midi2name(m) {
    var names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    return names[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
  }

  /* ---------------- 音高 <-> 纵轴行 ---------------- */
  /** 让这批音高落在 [root, root+21] 内，root 对齐到 C，保证五声格整齐 */
  function fitRoot(notes) {
    var lo = null, hi = null;
    for (var i = 0; i < notes.length; i++) {
      var m = notes[i].midi;
      if (m === null) continue;
      if (lo === null || m < lo) lo = m;
      if (hi === null || m > hi) hi = m;
    }
    if (lo === null) return 48;                 // 空轨给默认音区
    var root = 48 + Math.floor((lo - 48) / 12) * 12;
    // ⚠️ 方向不能写反：音太高说明窗口太低，root 要「上移」（+=）才追得上 hi；
    //    写成 -= 的话条件 root+21<hi 会越来越真，while 永远出不来，整页卡死。
    var guard = 0;
    while (root + 21 < hi && isFinite(hi) && guard++ < 24) root += 12;
    return root;
  }

  /** midi -> 行号（0 在最上面） */
  function midi2row(m, root) {
    var rel = m - root;
    var oct = Math.floor(rel / 12);
    var pc = ((rel % 12) + 12) % 12;
    var deg = PENTA.indexOf(pc);
    if (deg < 0) {                              // 非五声音（通常是鼓/未知轨）：吸到最近的一格
      var best = 99;
      for (var i = 0; i < 5; i++) { var d = Math.abs(PENTA[i] - pc); if (d < best) { best = d; deg = i; } }
    }
    var r = 9 - (oct * 5 + deg);
    return clamp(r, 0, ROWS - 1);
  }

  /** 行号 -> midi */
  function row2midi(r, root) {
    var k = clamp(9 - r, 0, ROWS - 1);
    return root + Math.floor(k / 5) * 12 + PENTA[k % 5];
  }

  function fnv(str) { var h = 2166136261; for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = (h * 16777619) >>> 0; } return h; }
  function mulberry(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

  /* ---------------- 视图状态 ---------------- */
  var st = {
    bpm: 84, master: 0.8, sr: 44100, cols: 16,
    tracks: []   // { name, instrument, loop(秒), gain, notes:[{beat,dur(拍),midi}] }
  };
  var sel = { track: 0, note: -1 };
  var drag = null;          // {mode:'brush'|'move'|'resize', ...}
  var head = -1;            // 播放头（秒）
  var opts = null;
  var playing = false;

  function spb() { return 60 / (st.bpm || 84); }

  /** 从 parseScore 结果灌进来 */
  function load(score) {
    var beat = 60 / (score.bpm || 84);
    st.bpm = score.bpm || 84;
    st.master = score.master === undefined ? 0.8 : score.master;
    st.sr = score.sr || 44100;
    st.tracks = score.tracks.map(function (t) {
      return {
        name: t.name || t.instrument,
        instrument: t.instrument,
        loop: t.loop || 0,
        gain: 0.8,
        notes: t.notes.map(function (n) {
          return { beat: n.t / beat, dur: Math.max(0.25, n.dur / beat), midi: n.midi };
        }).sort(function (a, b) { return a.beat - b.beat; })
      };
    });
    if (st.tracks.length) sel.track = Math.min(sel.track, st.tracks.length - 1);
    sel.note = -1;
    renderTracks();
    draw();
  }

  /** 序列化成标准 cues.json 对象（t 用拍，d 用秒） */
  function serialize() {
    var b = spb();
    var tracks = st.tracks.map(function (t) {
      var notes = t.notes.map(function (n) {
        if (n.midi === null) return { beat: +n.beat.toFixed(3), d: +(n.dur * b).toFixed(3) };
        var o = { beat: +n.beat.toFixed(3), d: +(n.dur * b).toFixed(3) };
        if (n.midi !== undefined) o.p = midi2name(n.midi);
        return o;
      });
      var o = { name: t.name, instrument: t.instrument, notes: notes };
      if (t.loop > 0) o.loop = t.loop;
      return o;
    });
    var out = { bpm: st.bpm, sample_rate: st.sr, master: st.master, tracks: tracks };
    // 时长不写死：交给 parseScore 按最后一音推算，loop 轨它会自己铺满一个周期
    return out;
  }

  /* ---------------- 几何 ---------------- */
  function trackH(t) { return isDrum(t.instrument) ? DRH : RH * ROWS; }
  function trackY(t) { var y = 0; for (var i = 0; i < st.tracks.length; i++) { if (st.tracks[i] === t) return y; y += trackH(st.tracks[i]); } return 0; }

  function hitTest(px, py) {
    if (px < LBLW) return null;
    var x = px - LBLW, col = Math.floor(x / CW), colFrac = (x % CW) / CW;
    if (col < 0 || col >= st.cols) return null;
    var ty = 0;
    for (var i = 0; i < st.tracks.length; i++) {
      var t = st.tracks[i], h = trackH(t), y0 = ty;
      if (py >= y0 && py < y0 + h) {
        var row = isDrum(t.instrument) ? 0 : Math.floor((py - y0) / RH);
        // 命中有没有音符？音符按 beat 宽度横向铺
        var n = t.notes.find(function (nn) {
          return nn.beat <= col + colFrac && nn.beat + nn.dur >= col + colFrac;
        });
        return { track: i, row: row, col: col, colFrac: colFrac, note: n || null, inRight: colFrac > 0.68 };
      }
      ty += h;
    }
    return { track: -1, col: col, colFrac: colFrac, note: null, inRight: colFrac > 0.68 };
  }

  /* ---------------- 画 ---------------- */
  var cv = null, g = null, dpr = 1;

  function layout() {
    var totalH = 0;
    st.tracks.forEach(function (t) { totalH += trackH(t); });
    if (!totalH) totalH = RH * ROWS;
    cv.width = Math.round((LBLW + st.cols * CW) * dpr);
    cv.height = Math.round((totalH + 8) * dpr);
    cv.style.width = (LBLW + st.cols * CW) + 'px';
    cv.style.height = (totalH + 8) + 'px';
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function draw() {
    if (!cv) return;
    var w = LBLW + st.cols * CW;
    var totalH = 0;
    st.tracks.forEach(function (t) { totalH += trackH(t); });
    layout();

    g.clearRect(0, 0, w, totalH + 8);
    g.fillStyle = FS.theme.trough;
    g.fillRect(0, 0, w, totalH + 8);

    var ty = 0;
    for (var i = 0; i < st.tracks.length; i++) {
      var t = st.tracks[i], h = trackH(t), col = trackColor(i);
      // 轨底
      g.fillStyle = i % 2 ? FS.theme.troughDeep : FS.theme.trough;
      g.fillRect(LBLW, ty, w - LBLW, h);

      // 拍线（每 4 拍加粗）
      for (var c = 0; c < st.cols; c++) {
        var x = LBLW + c * CW;
        g.fillStyle = c % 4 === 0 ? hexA(FS.theme.ink, .14) : hexA(FS.theme.ink, .05);
        g.fillRect(x, ty + 1, 1, h - 2);
      }
      // 音高格线
      if (!isDrum(t.instrument)) {
        for (var r = 0; r <= ROWS; r++) {
          g.fillStyle = hexA(FS.theme.ink, .05);
          g.fillRect(LBLW, ty + r * RH, w - LBLW, 1);
        }
      }

      // 音符
      var root = isDrum(t.instrument) ? 0 : fitRoot(t.notes);
      t.notes.forEach(function (n, k) {
        var nx = LBLW + n.beat * CW;
        var ny = isDrum(t.instrument) ? ty + 7 : ty + (ROWS - 1 - midi2row(n.midi, root)) * RH;
        var nw = Math.max(6, n.dur * CW - 2), nh = isDrum(t.instrument) ? DRH - 14 : RH - 3;
        var on = (i === sel.track && k === sel.note);
        g.fillStyle = on ? FS.theme.card : col;
        g.globalAlpha = on ? 1 : 0.92;
        roundRect(g, nx + 1, ny, nw, nh, 4);
        g.fill();
        g.globalAlpha = 1;
        if (on) { g.strokeStyle = col; g.lineWidth = 2; roundRect(g, nx - 1, ny - 2, nw + 4, nh + 4, 5); g.stroke(); }
      });

      // 左侧标签
      g.fillStyle = i === sel.track ? hexA(FS.theme.accent, .16) : FS.theme.troughDeep;
      g.fillRect(0, ty, LBLW, h);
      g.fillStyle = col;
      g.fillRect(0, ty, 3, h);
      g.fillStyle = i === sel.track ? FS.theme.ink : FS.theme.ink2;
      g.font = (i === sel.track ? '600 ' : '') + '12px ' + '"PingFang SC",system-ui,sans-serif';
      g.textBaseline = 'middle'; g.textAlign = 'left';
      var nm = t.name.length > 6 ? t.name.slice(0, 6) : t.name;
      g.fillText(nm, 8, ty + (isDrum(t.instrument) ? DRH / 2 : 16));
      g.fillStyle = hexA(FS.theme.ink, .42);
      g.font = '10px ui-monospace,monospace';
      g.fillText(t.instrument, 8, ty + (isDrum(t.instrument) ? DRH - 9 : h - 8));

      ty += h;
    }

    // 播放头
    if (head >= 0 && st.tracks.length) {
      var hx = LBLW + (head / spb()) * CW;
      if (hx <= w) {
        g.fillStyle = hexA(FS.theme.accent, .85);
        g.fillRect(hx, 0, 2, totalH);
      }
    }
    // 右侧可拖区提示
    g.fillStyle = hexA(FS.theme.ink, .4);
    g.font = '10px ui-monospace,monospace';
    g.textAlign = 'right';
    g.fillText('拍 →', w - 6, 10);
  }

  function roundRect(g, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  function hexA(hex, a) {
    var h = hex.replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  /* ---------------- 交互 ---------------- */
  function localPos(e) {
    var r = cv.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function commit() {
    if (!opts || !opts.onChange) return;
    try { opts.onChange(JSON.stringify(serialize(), null, 2)); }
    catch (err) { if (opts.onError) opts.onError(err); }
  }

  function selectTrack(i) { sel.track = i; sel.note = -1; renderTracks(); draw(); updateOps(); }

  function addNote(t, col, row, drum) {
    var n = { beat: col, dur: 1, midi: drum ? null : row2midi(row, fitRoot(t.notes)) };
    if (drum) n.midi = null;
    t.notes.push(n);
    t.notes.sort(function (a, b) { return a.beat - b.beat; });
    sel.note = t.notes.indexOf(n);
    return n;
  }

  function onDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    var p = localPos(e);
    var hit = hitTest(p.x, p.y);
    if (!hit || hit.track < 0) return;
    if (hit.track !== sel.track) { sel.track = hit.track; sel.note = -1; renderTracks(); updateOps(); }

    var t = st.tracks[sel.track], drum = isDrum(t.instrument);
    if (hit.note) {
      sel.note = t.notes.indexOf(hit.note);
      var mode = (!drum && hit.inRight) ? 'resize' : 'move';
      var root = fitRoot(t.notes);
      // 记下"鼠标 - 音符"的偏移，拖动时才不会跳到格子中心
      drag = {
        mode: mode, note: hit.note, lastCol: hit.col,
        offBeat: (hit.col + hit.colFrac) - hit.note.beat,
        offRow: drum ? 0 : hit.row - midi2row(hit.note.midi, root)
      };
    } else {
      var n = addNote(t, hit.col, hit.row, drum);
      sel.note = t.notes.indexOf(n);
      drag = { mode: 'brush', note: n };
    }
    try { cv.setPointerCapture(e.pointerId); } catch (err) {}
    draw(); updateOps();
    e.preventDefault();
  }

  function onMove(e) {
    if (!drag) return;
    var p = localPos(e);
    var hit = hitTest(p.x, p.y);
    if (!hit) return;
    var t = st.tracks[sel.track], drum = isDrum(t.instrument);
    var n = drag.note;

    if (drag.mode === 'brush') {
      // 刷子：跨到新拍格就在这儿补一个音（空的地方补），拖过一段就是一条旋律
      if (hit.col !== drag.lastCol) {
        var k = t.notes.indexOf(n);
        if (k >= 0 && n.beat !== hit.col) t.notes.splice(k, 1);
        if (!t.notes.some(function (o) { return o.beat === hit.col; })) {
          var nn = addNote(t, hit.col, hit.row, drum);
          drag.note = n = nn;
          sel.note = t.notes.indexOf(nn);
        }
        drag.lastCol = hit.col;
      }
      return;
    }

    if (drag.mode === 'move') {
      var raw = hit.col + hit.colFrac - drag.offBeat;
      n.beat = Math.max(0, Math.min(st.cols - 0.2, Math.round(raw)));   // 吸附整拍，手感稳
      if (!drum && hit.row !== undefined) {
        n.midi = row2midi(clamp(hit.row - drag.offRow, 0, ROWS - 1), fitRoot(t.notes));
      }
    } else if (drag.mode === 'resize') {
      var end = hit.col + hit.colFrac;
      n.dur = Math.max(0.5, Math.round(end - n.beat));
    }
    draw();
    e.preventDefault();
  }

  function onUp(e) {
    if (!drag) return;
    var wasBrush = drag.mode === 'brush';
    drag = null;
    try { if (cv.hasPointerCapture) cv.releasePointerCapture(e.pointerId); } catch (err) {}
    st.tracks.forEach(function (t) { t.notes.sort(function (a, b) { return a.beat - b.beat; }); });
    draw(); updateOps(); commit();
    if (wasBrush) return;
  }

  function deleteSel() {
    var t = st.tracks[sel.track];
    if (!t || sel.note < 0) return;
    t.notes.splice(sel.note, 1);
    sel.note = -1; draw(); updateOps(); commit();
  }

  function nudgeDur(d) {
    var t = st.tracks[sel.track];
    if (!t || sel.note < 0) return;
    t.notes[sel.note].dur = Math.max(0.5, t.notes[sel.note].dur + d);
    draw(); commit();
  }

  function clearTrack(i) {
    var t = st.tracks[i === undefined ? sel.track : i];
    if (!t) return;
    t.notes = []; sel.note = -1; draw(); updateOps(); commit();
  }

  function clearAll() {
    st.tracks.forEach(function (t) { t.notes = []; });
    sel.note = -1; draw(); updateOps(); commit();
  }

  function addTrack(inst) {
    st.tracks.push({ name: ('track' + (st.tracks.length + 1)), instrument: inst || 'pad', loop: 0, gain: 0.8, notes: [] });
    sel.track = st.tracks.length - 1;
    sel.note = -1;
    renderTracks(); draw(); updateOps();
  }

  function delTrack(i) {
    if (st.tracks.length <= 1) { clearAll(); return; }
    st.tracks.splice(i, 1);
    sel.track = Math.max(0, Math.min(sel.track, st.tracks.length - 1));
    sel.note = -1;
    renderTracks(); draw(); updateOps(); commit();
  }

  /* ---------------- 轨道列表（DOM） ---------------- */
  function renderTracks() {
    if (!opts || !opts.trackBox) return;
    var box = opts.trackBox;
    box.innerHTML = '';
    st.tracks.forEach(function (t, i) {
      var row = document.createElement('div');
      row.className = 'trow' + (i === sel.track ? ' on' : '');
      row.style.borderLeftColor = trackColor(i);

      var nm = document.createElement('input');
      nm.type = 'text'; nm.value = t.name; nm.className = 'tn';
      nm.addEventListener('input', function () { t.name = nm.value; draw(); });
      nm.addEventListener('focus', function () { selectTrack(i); });

      var sel2 = document.createElement('select');
      var cur = isDrum(t.instrument) ? t.instrument : t.instrument;
      var insts = (root.FS.instruments ? root.FS.instruments() : []) || [];
      var drumNames = ['kick', 'snare', 'hat', 'clap'];
      var list = drumNames.concat(insts.filter(function (x) { return drumNames.indexOf(x) < 0; }));
      list.forEach(function (x) {
        var o = document.createElement('option');
        o.value = x; o.textContent = x;
        if (x === cur) o.selected = true;
        sel2.appendChild(o);
      });
      sel2.addEventListener('change', function () {
        t.instrument = sel2.value;
        // 打击乐换另一个鼓时，音符不要变长；旋律↔鼓切换时把 midi 清掉/补回来
        if (isDrum(t.instrument) && !isDrum(cur)) t.notes.forEach(function (n) { n.midi = null; });
        if (!isDrum(t.instrument)) t.notes.forEach(function (n) { if (n.midi === null) n.midi = row2midi(5, fitRoot(t.notes)); });
        draw(); commit();
      });
      sel2.addEventListener('focus', function () { selectTrack(i); });

      var del = document.createElement('button');
      del.className = 'tdel'; del.textContent = '×'; del.title = '删这条轨';
      del.addEventListener('click', function () { delTrack(i); });

      row.appendChild(nm); row.appendChild(sel2); row.appendChild(del);
      box.appendChild(row);
    });

    var add = document.createElement('button');
    add.className = 'btn ghost tadd';
    add.textContent = '+ 加一条轨';
    add.addEventListener('click', function () { addTrack('pad'); });
    box.appendChild(add);
  }

  /* ---------------- 选中操作条 ---------------- */
  function updateOps() {
    if (!opts || !opts.opsBox) return;
    var has = sel.note >= 0 && st.tracks[sel.track];
    Array.prototype.forEach.call(opts.opsBox.querySelectorAll('button'), function (b) {
      if (b.dataset.needs) b.disabled = !has;
    });
    var t = st.tracks[sel.track];
    if (opts.opsBox.querySelector('#roll-selinfo')) {
      opts.opsBox.querySelector('#roll-selinfo').textContent = t
        ? ('当前：' + t.name + '（' + t.instrument + '）· ' + t.notes.length + ' 音')
        : '当前：没有轨';
    }
  }

  /* ---------------- 工具条 ---------------- */
  function bindBar() {
    if (!opts || !opts.barBox) return;
    var bpm = opts.barBox.querySelector('#roll-bpm');
    var cols = opts.barBox.querySelector('#roll-cols');
    var loop = opts.barBox.querySelector('#roll-loop');
    var playBtn = opts.barBox.querySelector('#roll-play-track');
    if (bpm) bpm.addEventListener('change', function () {
      var v = parseFloat(bpm.value);
      if (isFinite(v) && v > 20 && v < 300) { st.bpm = v; commit(); draw(); }
      bpm.value = st.bpm;
    });
    if (cols) cols.addEventListener('change', function () {
      st.cols = parseInt(cols.value, 10) || 16; draw();
    });
    if (loop) loop.addEventListener('change', function () {
      var v = parseFloat(loop.value) || 0;
      st.tracks[sel.track].loop = v; commit(); draw();
    });
    if (playBtn) playBtn.addEventListener('click', function () {
      playing = !playing;
      playBtn.textContent = playing ? '■ 停' : '▶ 试听本轨';
      if (playing && opts.onPlayTrack) opts.onPlayTrack(st.tracks[sel.track]);
      else if (!playing && opts.onStopTrack) opts.onStopTrack();
    });
  }

  /* ---------------- 挂载 ---------------- */
  function mount(o) {
    opts = o || {};
    cv = opts.canvas; g = cv.getContext('2d');
    dpr = Math.min(2, root.devicePixelRatio || 1);

    cv.addEventListener('pointerdown', onDown);
    cv.addEventListener('pointermove', onMove);
    cv.addEventListener('pointerup', onUp);
    cv.addEventListener('pointercancel', onUp);
    cv.addEventListener('contextmenu', function (e) { e.preventDefault(); deleteSel(); });
    // 触屏长按 = 删除（手机上没有右键）
    var timer = null, moved = false;
    cv.addEventListener('pointerdown', function (e) {
      moved = false;
      clearTimeout(timer);
      timer = setTimeout(function () {
        if (!moved && sel.note >= 0) {
          if (root.navigator && root.navigator.vibrate) { try { root.navigator.vibrate(18); } catch (err) {} }
          deleteSel();
        }
      }, 620);
    });
    cv.addEventListener('pointermove', function () { moved = true; clearTimeout(timer); });
    cv.addEventListener('pointerup', function () { clearTimeout(timer); });

    if (opts.opsBox) {
      Array.prototype.forEach.call(opts.opsBox.querySelectorAll('button[data-act]'), function (b) {
        b.addEventListener('click', function () {
          var a = b.dataset.act;
          if (a === 'del') deleteSel();
          else if (a === 'dur-') nudgeDur(-1);
          else if (a === 'dur+') nudgeDur(1);
          else if (a === 'clear') clearTrack();
        });
      });
    }
    bindBar();
    return api;
  }

  var api = {
    mount: mount, load: load, draw: draw,
    serialize: serialize,
    setPlayhead: function (sec) { head = sec; if (playing) draw(); },
    clearPlayhead: function () { head = -1; draw(); },
    addTrack: addTrack,
    setBPM: function (v) { st.bpm = v; },
    state: function () { return st; },
    _internal: { midi2row: midi2row, row2midi: row2midi, fitRoot: fitRoot, serialize: serialize, load: load }
  };

  FS.roll = api;
})(window);
