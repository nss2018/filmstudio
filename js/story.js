/* story.js —— 科普宣传片生成器：五个视觉母题 + 时间轴 + 按段落自动配乐
 * 渲染是纯 Canvas2D 确定性的：同一 t 永远出同一帧（导出和预览走同一个 drawFrame）。
 */
(function (root) {
  'use strict';
  var FS = (root.FS = root.FS || {});

  var W = 1280, H = 720;

  var PALETTE = {
    ink:    { a: '#0a1420', b: '#101d2e', main: '#4dd0c7', alt: '#7c8cff', text: '#eaf2ff', dim: 'rgba(234,242,255,.55)', grid: 'rgba(120,160,200,.10)' },
    sunset: { a: '#150c26', b: '#2c1440', main: '#ff9a5c', alt: '#ffd166', text: '#fff3ea', dim: 'rgba(255,243,234,.55)', grid: 'rgba(255,200,160,.10)' },
    mint:   { a: '#eef7f4', b: '#d6ebe6', main: '#0f766e', alt: '#1d6f4f', text: '#0b2b28', dim: 'rgba(11,43,40,.5)',   grid: 'rgba(15,118,110,.12)' },
    mono:   { a: '#0a0a0a', b: '#1c1c1c', main: '#ffffff', alt: '#9aa0aa', text: '#ffffff', dim: 'rgba(255,255,255,.5)', grid: 'rgba(255,255,255,.08)' }
  };

  function pal(name) { return PALETTE[name] || PALETTE.ink; }
  var FONT = '"PingFang SC","Hiragino Sans GB","Microsoft YaHei",system-ui,sans-serif';
  function font(px, weight) { return (weight || 400) + ' ' + px + 'px ' + FONT; }

  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
  function ease(x) { return 1 - Math.pow(1 - clamp01(x), 3); }         // easeOutCubic
  function smooth(x) { x = clamp01(x); return x * x * (3 - 2 * x); }

  /** 段落时间轴：[{start, end, i, dur}] */
  function timeline(story) {
    var spb = 60 / (story.bpm || 84);
    var d = (story.beats || 8) * spb;
    var tl = [], acc = 0;
    for (var i = 0; i < story.scenes.length; i++) {
      tl.push({ start: acc, end: acc + d, i: i, dur: d });
      acc += d;
    }
    return { marks: tl, total: Math.max(acc, spb * 4) };
  }

  /** 背景：渐变 + 网格 + 缓慢呼吸的光斑 */
  function backdrop(g, story, t, p) {
    var c = pal(story.palette);
    var grd = g.createLinearGradient(0, 0, W, H);
    grd.addColorStop(0, c.a);
    grd.addColorStop(1, c.b);
    g.fillStyle = grd;
    g.fillRect(0, 0, W, H);

    g.save();
    g.strokeStyle = c.grid;
    g.lineWidth = 1;
    for (var x = 0; x <= W; x += 64) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
    for (var y = 0; y <= H; y += 64) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
    g.restore();

    // 呼吸光斑（跟着时间走，纯函数）
    var cx = W * (0.5 + 0.22 * Math.sin(t * 0.35 + story.scenes.length));
    var cy = H * (0.42 + 0.18 * Math.cos(t * 0.27));
    var r = 260 + 90 * Math.sin(t * 0.5);
    var gl = g.createRadialGradient(cx, cy, 0, cx, cy, Math.max(60, r));
    gl.addColorStop(0, hexA(c.main, 0.20 + 0.06 * Math.sin(t * 0.8)));
    gl.addColorStop(1, hexA(c.main, 0));
    g.fillStyle = gl;
    g.fillRect(0, 0, W, H);
  }

  function hexA(hex, a) {
    var h = hex.replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  /** 字幕：开了 sub 才画，超长自动缩字号（最多两行），返回占了几行 */
  function sub(g, story, sc, cx, y, maxW, basePx, weight) {
    if (story.sub === 'off' || !sc.text) return 0;
    var c = pal(story.palette);
    var px = basePx, w = weight || 400, lines;
    g.font = font(px, w);
    lines = wrapText(g, sc.text, maxW);
    var guard = 0;
    while (lines.length > 2 && px > 15 && guard++ < 14) {
      px -= 2;
      g.font = font(px, w);
      lines = wrapText(g, sc.text, maxW);
    }
    g.fillStyle = c.text;
    var lh = px * 1.5;
    var y0 = y - (lines.length - 1) * lh / 2;
    for (var i = 0; i < lines.length; i++) g.fillText(lines[i], cx, y0 + i * lh);
    return lines.length;
  }

  function wrapText(g, text, maxW) {
    var lines = [], cur = '';
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (g.measureText(cur + ch).width > maxW && cur) { lines.push(cur); cur = ch; }
      else cur += ch;
    }
    if (cur) lines.push(cur);
    return lines;
  }

  /* ---------------- 母题 1：概念递进 ---------------- */
  function drawConcept(g, story, sc, p, t, alpha) {
    var c = pal(story.palette);
    var cx = W / 2, cy = H / 2;

    // 同心圆，随段内进度扩散
    g.save();
    g.globalAlpha = alpha * 0.5;
    g.strokeStyle = hexA(c.main, 0.35);
    g.lineWidth = 1.5;
    for (var k = 0; k < 5; k++) {
      var rr = 120 + k * 78 + p * 60;
      g.beginPath();
      g.arc(cx, cy, rr, 0, Math.PI * 2);
      g.stroke();
    }
    g.restore();

    g.save();
    g.globalAlpha = alpha;
    g.textAlign = 'center';
    g.textBaseline = 'middle';

    var rise = (1 - ease(p * 2.2)) * 34;              // 从下方浮上来
    var fade = smooth(p * 6) * smooth((1 - p) * 8);   // 段内淡入淡出

    var title = sc.title || '';
    g.font = font(88, 700);
    g.fillStyle = c.main;
    g.shadowColor = hexA(c.main, .5); g.shadowBlur = 30;
    g.fillText(title, cx, cy - 26 + rise);
    g.shadowBlur = 0;

    if (sc.text) {
      g.globalAlpha = alpha * fade;      // sub() 只管字和位置，透明度留给调用方
      sub(g, story, sc, cx, cy + 92, W - 260, 30, 400);
    }

    // 段落序号
    g.globalAlpha = alpha * .7;
    g.font = font(20, 600);
    g.fillStyle = c.dim;
    g.fillText(String(sc.i + 1).padStart(2, '0') + ' / ' + String(story.scenes.length).padStart(2, '0'), cx, H - 150);
    g.restore();
    return alpha;
  }

  /* ---------------- 母题 2：公式推导（逐字高亮） ---------------- */
  function drawFormula(g, story, sc, p, t, alpha) {
    var c = pal(story.palette);
    var cx = W / 2, cy = H / 2;
    var expr = sc.title || '';
    var note = sc.text || '';

    g.save();
    g.globalAlpha = alpha;
    g.textAlign = 'center';
    g.textBaseline = 'middle';

    // 逐字揭示：先量每个字符宽 -> 算总宽 -> 从 cx-totalW/2 起排开，否则全叠在中心
    g.font = font(64, 600);
    var chars = Array.from(expr);
    var revealed = Math.floor(ease(p * 1.35) * chars.length + 1e-6);
    var widths = [], totalW = 0, i;
    for (i = 0; i < chars.length; i++) {
      var wch = g.measureText(chars[i]).width;
      widths.push(wch);
      totalW += wch;
    }
    var x = cx - totalW / 2;
    for (i = 0; i < chars.length; i++) {
      var ch = chars[i];
      var on = i < revealed;
      g.font = font(64, on ? 600 : 400);
      g.fillStyle = on ? c.main : hexA(c.dim, .3);
      if (ch !== ' ') g.fillText(ch, x + widths[i] / 2, cy);
      x += widths[i];
    }

    // 高亮光标（跟着揭示进度走）
    if (revealed < chars.length) {
      var caret = 0;
      for (i = 0; i < revealed; i++) caret += widths[i];
      g.fillStyle = hexA(c.main, .8 * (0.4 + 0.6 * Math.abs(Math.sin(t * 6))));
      g.fillRect(cx - totalW / 2 + caret + 2, cy - 30, 3, 60);
    }

    if (note) {
      g.globalAlpha = alpha * smooth((p - .35) * 4);
      sub(g, story, sc, cx, cy + 118, W - 300, 28, 400);
    }
    g.restore();
  }

  /* ---------------- 母题 3：数据演进（柱子生长） ---------------- */
  function drawBars(g, story, sc, p, t, alpha) {
    var c = pal(story.palette);
    var n = story.scenes.length;
    var gap = 46, bw = (W - 200 - gap * (n - 1)) / n;
    var baseY = H - 210;
    var maxH = 380;

    g.save();
    g.globalAlpha = alpha;

    for (var i = 0; i < n; i++) {
      var sc_i = story.scenes[i];
      var vi = i < sc.i ? 1 : i === sc.i ? ease(p) : 0;
      var hgt = vi * maxH * (0.55 + 0.45 * ((i * 37) % 11) / 10);
      var x = 100 + i * (bw + gap);
      var y = baseY - hgt;

      var grd = g.createLinearGradient(0, y, 0, baseY);
      grd.addColorStop(0, i === sc.i ? c.main : hexA(c.main, .55));
      grd.addColorStop(1, hexA(c.main, .12));
      g.fillStyle = grd;
      g.fillRect(x, y, bw, hgt);

      g.strokeStyle = hexA(c.main, .8);
      g.lineWidth = 2;
      g.strokeRect(x, y, bw, hgt);

      if (vi > 0.02) {
        g.fillStyle = c.text;
        g.font = font(30, 700);
        g.textAlign = 'center';
        g.fillText(Math.round(vi * 100) + '', x + bw / 2, y - 18);
      }
      g.fillStyle = c.dim;
      g.font = font(19, 400);
      g.fillText(sc_i.title || '', x + bw / 2, baseY + 32);
    }

    g.strokeStyle = hexA(c.text, .35);
    g.lineWidth = 1;
    g.beginPath(); g.moveTo(60, baseY + 6); g.lineTo(W - 60, baseY + 6); g.stroke();

    g.textAlign = 'center';
    g.fillStyle = c.main;
    g.font = font(56, 700);
    g.fillText(story.title || '', W / 2, 150);
    if (sc.text) {
      g.globalAlpha = alpha * smooth((p - .2) * 4);
      sub(g, story, sc, W / 2, 230, W - 200, 26, 400);
    }
    g.restore();
  }

  /* ---------------- 母题 4：对比演示（左右分屏） ---------------- */
  function drawSplit(g, story, sc, p, t, alpha) {
    var c = pal(story.palette);
    // ⚠️ 以前只认「标题里写死 vs/对比」，没写就退化成字面量 'A' / 'B'——
    //    于是任何用「对比演示」模板的片子，右侧永远一个大写 B（用户 2026-10-05 反馈「2D 动画有问题」）。
    // 解析优先级：① 标题里的 vs/对比/相比；② 标题里用「比/和/与」连接的两短句（两侧都 ≤8 字才算）；
    //    ③ 标题按顿号/逗号切两段；④ 都不行就只画左半单栏，右半留空（宁可单栏也不硬塞一个字）。
    //    ⚠️ 别拿正文去猜：正文是完整句子，切出来必然是「北京 一天里能走完的距离」这种半截话。
    var raw = String(sc.title || '').trim();
    var body = String(sc.text || '');
    var left = '', right = '';
    var m = raw.match(/^(.{1,14}?)\s*(?:vs|VS|Vs|versus|对比|相比)\s*(.{1,14})$/);
    if (m) { left = m[1]; right = m[2]; }
    if (!right) {
      // 只在标题里找，且两侧都要短 —— 「深圳比北京」能切，「没有结构的普通段落说明」不能切
      var m2 = raw.match(/^(.{1,8}?)\s*(?:比|和|与)\s*(.{1,8}?)$/);
      if (m2) { left = m2[1]; right = m2[2]; }
    }
    if (!right) {
      var seg = raw.split(/\s*[，,、；;]\s*/).filter(function (s) { return s; });
      if (seg.length >= 2 && seg[0].length <= 8 && seg[1].length <= 8) { left = seg[0]; right = seg[1]; }
    }
    left = left.trim() || raw || '对比';
    right = right.trim();
    var two = !!right;                        // 只有真解析出右项才画分屏，否则单栏
    var note = body;

    g.save();
    g.globalAlpha = alpha;

    var cx = W / 2;
    var wLeft = two ? cx * ease(p) : W * ease(p);
    var wRight = W - wLeft;
    var y0 = 190, h0 = H - 300;

    g.fillStyle = hexA(c.main, .16);
    g.fillRect(0, y0, wLeft, h0);
    if (two) {
      g.fillStyle = hexA(c.alt, .16);
      g.fillRect(wLeft, y0, wRight, h0);
    }

    g.strokeStyle = c.main; g.lineWidth = 3;
    g.beginPath(); g.moveTo(wLeft, y0 - 20); g.lineTo(wLeft, y0 + h0 + 20); g.stroke();

    g.textAlign = 'center'; g.textBaseline = 'middle';
    // 字号按「这一栏有多宽 / 词有多长」现算，写死 58px 会顶出格子；
    // 补一个 measureText 实测兜底（估算对 latin 偏松，中文够用，两者取小）。
    function fit(str, boxW) {
      var est = Math.min(58, Math.max(22, (boxW - 70) / Math.max(2, str.length) * 1.6));
      g.font = font(est, 700);
      var w = g.measureText(str).width;
      if (w > boxW - 70 && est > 22) g.font = font(Math.max(22, est * (boxW - 70) / w), 700);
      return g.font;
    }
    g.fillStyle = c.main; g.font = fit(left, wLeft);
    g.fillText(left, wLeft / 2, y0 + h0 / 2);
    if (two) {
      g.fillStyle = c.alt; g.font = fit(right, wRight);
      g.fillText(right, wLeft + wRight / 2, y0 + h0 / 2);
    }

    if (raw) {
      g.fillStyle = c.text; g.font = font(46, 600);
      g.fillText(raw, W / 2, 110);
    }

    g.globalAlpha = alpha * smooth((p - .3) * 3.5);
    sub(g, story, sc, W / 2, H - 108, W - 300, 26, 400);
    g.restore();
  }

  /* ---------------- 母题 5：几何演化（对称群） ---------------- */
  function drawGeo(g, story, sc, p, t, alpha) {
    var c = pal(story.palette);
    var cx = W / 2, cy = H / 2;
    var n = story.scenes.length + 2;
    var grow = ease(p);
    var R = 130 + 150 * grow;

    g.save();
    g.globalAlpha = alpha;
    g.strokeStyle = hexA(c.main, .25);
    g.lineWidth = 1;
    for (var ring = 1; ring <= 3; ring++) {
      g.beginPath(); g.arc(cx, cy, R * (1 + ring * .45), 0, Math.PI * 2); g.stroke();
    }

    var rot = t * 0.35;
    var pts = [], i;
    for (i = 0; i < n; i++) {
      var ang = rot + i * (Math.PI * 2 / n);
      pts.push([cx + Math.cos(ang) * R, cy + Math.sin(ang) * R]);
    }
    g.strokeStyle = c.main; g.lineWidth = 3;
    g.beginPath();
    for (i = 0; i < pts.length; i++) { i ? g.lineTo(pts[i][0], pts[i][1]) : g.moveTo(pts[i][0], pts[i][1]); }
    g.closePath(); g.stroke();

    // 顶点与连线
    g.fillStyle = c.main;
    for (i = 0; i < pts.length; i++) {
      g.beginPath(); g.arc(pts[i][0], pts[i][1], 7, 0, Math.PI * 2); g.fill();
      g.strokeStyle = hexA(c.alt, .5); g.lineWidth = 1;
      g.beginPath(); g.moveTo(cx, cy); g.lineTo(pts[i][0], pts[i][1]); g.stroke();
    }

    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = c.text;
    g.font = font(52, 700);
    g.fillText(sc.title || '', cx, cy - R - 70);
    g.fillStyle = c.dim;
    sub(g, story, sc, cx, cy + R + 62, W - 420, 24, 400);
    g.restore();
  }

  /* ---------------- 生活场景（2D 插画） ---------------- */
  // 与 2D 母题并行的第 6 种画面类型：低多边形插画风的生活场景。
  // 场景可按文案自动选（FS.s2dPick，��用 3D 导演层同一份词典），也可在界面上手动指定。
  function drawDaily(g, story, sc, p, t, alpha) {
    var R = FS.s2dScenes;
    if (!R) { drawConcept(g, story, sc, p, t, alpha); return; }
    var id = (story.scenes2d && story.scenes2d[sc.i]) ||
             (FS.s2dPick && FS.s2dPick.pickScene((sc.title || '') + ' ' + (sc.text || ''), sc.i)) || 'cafe';
    var fn = R[id];
    if (typeof fn !== 'function') fn = R.cafe || R.street;
    if (!fn) { drawConcept(g, story, sc, p, t, alpha); return; }
    g.save();
    g.globalAlpha = alpha;
    // 段间交叉淡入：每段前后各 0.35s 叠化，避免硬切
    fn(g, t, p, { mood: story.palette, place: id, scene: sc });
    g.restore();
    // 场景名角标（右上角小字，方便确认「这段用的是哪个场景」）
    var meta = R.meta && R.meta[id];
    if (meta && story.sceneLabel !== false) {
      g.save();
      g.globalAlpha = alpha * 0.55;
      g.font = '12px ui-monospace,monospace';
      g.textAlign = 'right';
      g.fillStyle = hexA(pal(story.palette).text, .8);
      g.fillText('场景 · ' + meta.name, W - 16, 28);
      g.restore();
    }
    // 段标题（小字，左上）
    if (sc.title) {
      g.save();
      g.globalAlpha = alpha * 0.9;
      g.font = font(30, 600);
      g.fillStyle = pal(story.palette).text;
      g.textAlign = 'left';
      g.fillText(sc.title, 56, 66);
      g.restore();
    }
    // ★ 字幕：生活场景模板以前**根本不画文案**，于是「生活场景」这种片子导出后
    //   只有插画、看不到一句字（用户 2026-10-05 反馈「视频里没有文字」）。
    //   插画本身是满屏的，所以先铺一条自下而上的暗色渐变把字托出来，
    //   再走公共的 sub()（自动按宽度折行 + 超长缩字号 + 受「字幕」开关控制）。
    if (sc.text) {
      g.save();
      g.globalAlpha = alpha;
      var sg = g.createLinearGradient(0, H - 230, 0, H);
      sg.addColorStop(0, 'rgba(0,0,0,0)');
      sg.addColorStop(.42, 'rgba(0,0,0,.5)');
      sg.addColorStop(1, 'rgba(0,0,0,.88)');
      g.fillStyle = sg;
      g.fillRect(0, H - 230, W, 230);
      g.restore();
      g.save();
      g.globalAlpha = alpha * smooth(p * 5);   // 段内前 0.2 拍淡入，别跟场景抢镜
      sub(g, story, sc, W / 2, H - 72, W - 300, 31, 600);
      g.restore();
    }
  }

  var TEMPLATES = { concept: drawConcept, formula: drawFormula, bars: drawBars, split: drawSplit, geo: drawGeo, daily: drawDaily };
  FS.templates = Object.keys(TEMPLATES);

  /** 画一帧。t 是全局时间（秒）。设计坐标系 1280×720，画布更大时整体等比放大。 */
  function drawFrame(g, story, t) {
    var cv = g.canvas;
    var sx = cv ? cv.width / W : 1, sy = cv ? cv.height / H : 1;
    if (sx !== 1 || sy !== 1) { g.save(); g.scale(sx, sy); }
    var tl = timeline(story);
    var total = tl.total;
    var ti = clamp01(t / total) * (tl.marks.length || 1);
    var idx = Math.min(tl.marks.length - 1, Math.floor(ti));
    var mark = tl.marks[idx];
    var sc = story.scenes[idx] || {};
    sc.i = idx;
    var local = t - mark.start;
    var p = clamp01(local / mark.dur);

    backdrop(g, story, t, p);

    var fn = TEMPLATES[story.template] || drawConcept;
    var alpha = 1;
    var fadeIn = smooth(local / 0.28);
    var fadeOut = smooth((mark.dur - local) / 0.28);
    alpha = Math.min(fadeIn, fadeOut, 1);
    fn(g, story, sc, p, t, alpha);

    // 片名题头（前 1.2 秒）
    if (t < 1.4 && story.title) {
      var c = pal(story.palette);
      g.save();
      g.globalAlpha = smooth(t / 0.6) * smooth((1.4 - t) / 0.5);
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillStyle = c.text;
      g.font = font(46, 700);
      g.fillText(story.title, W / 2, 120);
      g.restore();
    }

    // 底部进度线 + 字幕时间码
    var c2 = pal(story.palette);
    g.save();
    g.fillStyle = hexA(c2.text, .18);
    g.fillRect(0, H - 6, W, 6);
    g.fillStyle = c2.main;
    g.fillRect(0, H - 6, W * clamp01(t / total), 6);
    g.fillStyle = hexA(c2.text, .45);
    g.font = '11px ui-monospace,monospace';
    g.textAlign = 'right';
    g.fillText(t.toFixed(2) + 's / ' + total.toFixed(2) + 's', W - 14, H - 18);
    g.restore();
    if (sx !== 1 || sy !== 1) g.restore();
  }

  /* ---------------- 按段落自动生成配乐 ---------------- */
  // 五声音阶（大调），怎么排都不难听；每段一个和声落点 + 每拍一层节奏
  var PENTA = [0, 2, 4, 7, 9];

  function buildScore(story) {
    var spb = 60 / (story.bpm || 84);
    var beats = story.beats || 8;
    var per = beats * spb;
    var tracks = [];

    var padNotes = [], bellNotes = [], kickNotes = [], hatNotes = [];
    for (var i = 0; i < story.scenes.length; i++) {
      var t0 = i * per;
      var root = 48 + PENTA[i % PENTA.length];          // C3 起
      padNotes.push({ p: midi2name(root), beat: i * beats, d: Math.min(per * .95, per - .1), gain: .7 });
      padNotes.push({ p: midi2name(root + 7), beat: i * beats + Math.max(1, (beats >> 1)), d: Math.min(per * .5, per - .1), gain: .45 });
      bellNotes.push({ p: midi2name(root + 12), beat: i * beats + (beats - 2), d: spb, gain: .5 });
      for (var b = 0; b < beats; b++) {
        if (b % 2 === 0) kickNotes.push({ beat: i * beats + b, d: spb * .3, gain: .8 });
        if (b % 2 === 1) hatNotes.push({ beat: i * beats + b, d: spb * .2, gain: .5 });
      }
    }

    tracks.push({ name: 'pad', instrument: 'pad', notes: padNotes });
    tracks.push({ name: 'bell', instrument: 'bell', notes: bellNotes });
    tracks.push({ name: 'drums', instrument: 'kick', notes: kickNotes });
    tracks.push({ name: 'hats', instrument: 'hat', notes: hatNotes });

    return {
      bpm: story.bpm || 84,
      sample_rate: 44100,
      master: 0.8,
      tracks: tracks,
      duration: story.scenes.length * per + spb * 2
    };
  }

  function midi2name(m) {
    var names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    return names[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
  }

  FS.story = {
    W: W, H: H, timeline: timeline, drawFrame: drawFrame, drawDaily: drawDaily,
    buildScore: buildScore, palette: pal, midi2name: midi2name
  };
})(window);
