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
  function lerp(a, b, x) { return a + (b - a) * clamp01(x); }

  /* ==================================================================
   *  运动基元（2026-10-05）
   *  为什么要这一层：原来六个母题的画面变化只有 2%~5%（实测 concept 2.2%、
   *  formula 1.9%、bars 2.8%、split 4.9%、geo 3.0%、daily 2.0%），
   *  肉眼看过去就是「只有文字，没有动画」——因为每段里真正在动的只有
   *  几十像素的位移和透明度，构图完全不变。
   *  这里把「动」拆成可复用的零件，让每个母题都有**贯穿整段的连续运动**：
   *  入场、循环、收场三层叠在一起，保证任意时刻画面里都有东西在变。
   * ================================================================== */

  /** 弹性出场：overshoot 一下再落回，比线性/缓动有生气得多。
   *  x=0 → 0，x=1 → 1，中途会冲过 1 再回落。 */
  function back(x, s) {
    x = clamp01(x);
    s = s === undefined ? 1.7 : s;
    var u = x - 1;
    return 1 + (s + 1) * u * u * u + s * u * u;
  }

  /** 段内归一化时间：把全局 t 折成「这一段里走了多少」，
   *  再补一个 loop 次数，让同一个动作能在段内反复播。 */
  function seg(t, p, cycles) {
    return { t: t, p: p, loop: (p * (cycles || 1)) % 1, ping: 1 - Math.abs(((p * (cycles || 1)) % 2) - 1) };
  }

  /** 持续旋转（弧度）——给几何图形用，保证整段都在转 */
  function spin(t, rpm) { return t * (rpm || 6) * Math.PI / 30; }

  /** 描边生长：返回一个 0..1 的比例，配 ctx.setLineDash([len*ratio, len]) 用。
   *  ctx 需支持 setLineDash（node 的 stub 和真 canvas 都支持）。 */
  function drawGrowth(g, pathFn, ratio) {
    var len = 2000;                                  // 估个够大的周长
    if (g.setLineDash) g.setLineDash([len * clamp01(ratio), len * 2]);
    pathFn();
    g.stroke();
    if (g.setLineDash) g.setLineDash([]);
  }

  /** 粒子群：N 个粒子在各自相位上沿一个方向循环飘，带尾迹。
   *  这是让画面「一直在动」最省力的手段——比单个元素持续位移活跃得多。 */
  function particles(g, o) {
    var n = o.n || 26, sp = o.speed || 0.06, t = o.t || 0;
    var col = o.color || '#ffffff';
    var box = o.box || { x: 0, y: 0, w: W, h: H };
    var seed = o.seed || 1;
    g.save();
    for (var i = 0; i < n; i++) {
      var ph = ((i * 2654435761 % 1000) / 1000 + seed * 0.137) % 1;
      var life = (t * sp + ph) % 1;
      var x = box.x + ((i * 97 + seed * 31) % 100) / 100 * box.w + Math.sin(t * 0.7 + i) * 26;
      var y = box.y + box.h - life * box.h;                 // 自下而上飘
      var r = (o.r || 2.4) * (0.5 + 0.9 * Math.sin(i * 1.7 + t));
      var a = (o.alpha || 0.5) * Math.sin(life * Math.PI);   // 两头淡入淡出
      if (a <= 0.01) continue;
      g.globalAlpha = a;
      g.fillStyle = col;
      g.beginPath();
      g.arc(x, y, Math.max(0.4, r), 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
  }

  /** 沿路径走的一个「主体」（图标/光点），带运动残影。
   *  这是让画面有「叙事感」的关键——一个可见的东西在画面里移动。 */
  function runner(g, o) {
    var p = clamp01(o.p);
    var x = lerp(o.x0, o.x1, p);
    var y = lerp(o.y0, o.y1, p) + Math.sin(p * Math.PI * 2 * (o.bob || 1)) * (o.bobAmp || 0);
    var r = o.r || 12;
    // 残影：往回取 3 个点，透明度递减
    for (var k = 3; k >= 1; k--) {
      var pk = clamp01(p - k * 0.028);
      var xk = lerp(o.x0, o.x1, pk);
      var yk = lerp(o.y0, o.y1, pk) + Math.sin(pk * Math.PI * 2 * (o.bob || 1)) * (o.bobAmp || 0);
      g.globalAlpha = (o.alpha || 1) * 0.13 * (4 - k) / 3;
      g.fillStyle = o.color || '#fff';
      g.beginPath();
      g.arc(xk, yk, r * (1 - k * 0.13), 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = o.alpha || 1;
    g.fillStyle = o.color || '#fff';
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
    if (o.glow) {
      var gg = g.createRadialGradient(x, y, 0, x, y, r * 4.2);
      gg.addColorStop(0, hexA(o.color || '#ffffff', 0.5));
      gg.addColorStop(1, hexA(o.color || '#ffffff', 0));
      g.fillStyle = gg;
      g.beginPath();
      g.arc(x, y, r * 4.2, 0, Math.PI * 2);
      g.fill();
    }
    return { x: x, y: y };
  }

  /** 环形进度/仪表：整段持续转的虚线环 + 一个随 p 走的高亮弧 */
  function dial(g, o) {
    var cx = o.x, cy = o.y, R = o.r, t = o.t, p = clamp01(o.p);
    g.save();
    g.lineCap = 'round';
    // 底盘：整段持续缓慢转，读得出「还在动」
    g.save();
    g.translate(cx, cy); g.rotate(spin(t, o.rpm || 8));
    g.strokeStyle = o.dim || hexA(o.color || '#fff', 0.18);
    g.lineWidth = o.lw || 2;
    for (var k = 0; k < 36; k++) {
      var a0 = k * Math.PI * 2 / 36;
      var len = (k % 3 === 0) ? 0.13 : 0.07;           // 长短刻度交错，转起来有节奏
      g.beginPath();
      g.arc(0, 0, R, a0, a0 + len);
      g.stroke();
    }
    g.restore();
    // 进度弧：随 p 生长，带发光
    g.save();
    g.translate(cx, cy); g.rotate(-Math.PI / 2 + spin(t, 3));
    g.strokeStyle = o.color || '#fff';
    g.lineWidth = (o.lw || 2) + 2.5;
    g.shadowColor = hexA(o.color || '#fff', 0.6);
    g.shadowBlur = 16;
    g.beginPath();
    g.arc(0, 0, R, 0, Math.PI * 2 * p);
    g.stroke();
    g.restore();
    g.restore();
  }


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
  /* 重做（2026-10-05）：原来整段画面只变化 2.2%，实际就是「一个标题浮在暗底上」，
     同心圆淡到看不见 → 用户反馈「只有文字没有动画」。
     现在按四层运动叠：① 背景粒子持续飘 ② 环形仪表整段自转 + 进度弧生长
     ③ 三个光点各走一条轨道（错相位，构图一直不对称地动）
     ④ 标题弹性入场 + 下划线写出 + 两侧卡片滑入把版面撑满 */
  function drawConcept(g, story, sc, p, t, alpha) {
    var c = pal(story.palette);
    var cx = W / 2, cy = H / 2 - 34;

    // ① 背景粒子：整段持续飘，密度随段内进度增加
    particles(g, {
      t: t, n: 26 + Math.floor(p * 34), speed: 0.055, seed: sc.i + 1,
      color: c.main, r: 3.0, alpha: 0.40 * alpha,
      box: { x: 40, y: 50, w: W - 80, h: H - 170 }
    });

    // ② 环形仪表：底盘刻度整段缓慢转（这是「一直在动」的主要来源）
    dial(g, { x: cx, y: cy, r: 196 + Math.sin(t * 0.9) * 14, t: t, p: p,
      color: c.main, dim: hexA(c.main, 0.22), lw: 2, rpm: 14 });

    // ③ 三个光点各走一条轨道，相位错开（构图一直不对称地动）
    var o1 = seg(t, p, 1.0);
    runner(g, { p: o1.ping, x0: cx - 400, y0: cy + 118, x1: cx + 400, y1: cy - 118,
      r: 10, color: c.alt, alpha: alpha, glow: 1, bob: 2, bobAmp: 30 });
    var o2 = seg(t, p + 0.34, 1.0);
    runner(g, { p: o2.ping, x0: cx + 400, y0: cy + 96, x1: cx - 400, y1: cy - 150,
      r: 7, color: c.main, alpha: alpha * 0.85, glow: 1, bob: 3, bobAmp: 24 });
    var o3 = seg(t, p + 0.67, 1.0);
    runner(g, { p: o3.ping, x0: cx - 330, y0: cy - 150, x1: cx + 360, y1: cy + 150,
      r: 5.5, color: c.alt, alpha: alpha * 0.7, glow: 0, bob: 1, bobAmp: 40 });

    // 同心圆：中心一圈圈「弹出」（back 弹性），不再是整体缓慢扩散
    g.save();
    for (var k = 0; k < 4; k++) {
      var kp = clamp01((p - k * 0.16) / 0.5);          // 每圈错开 16% 依次弹出
      if (kp <= 0) continue;
      var rr = 96 + k * 74;
      g.globalAlpha = alpha * (1 - kp * 0.7) * 0.85;
      g.strokeStyle = k === 0 ? c.alt : c.main;
      g.lineWidth = k === 0 ? 2.4 : 1.5;
      g.shadowColor = hexA(k === 0 ? c.alt : c.main, 0.5);
      g.shadowBlur = 12 * (1 - kp);
      g.beginPath();
      g.arc(cx, cy, rr * back(kp, 0.9), 0, Math.PI * 2);
      g.stroke();
    }
    g.restore();

    // ④ 左右两张「卡片」从两侧滑入 —— 把空荡的版面撑住，构图不再只有中间一块
    g.save();
    var cardIn = back(clamp01((p - 0.1) / 0.34), 1.2);
    var cardW = 232, cardH = 132, cardY = cy + 176;
    [[cx - 372 - (1 - cardIn) * 420, c.main, '概念'],
     [cx + 372 + (1 - cardIn) * 420, c.alt, '要点']].forEach(function (c2, ci) {
      if (cardIn <= 0.01) return;
      g.globalAlpha = alpha * Math.min(1, cardIn) * 0.9;
      g.fillStyle = hexA(c2[1], 0.10);
      g.strokeStyle = hexA(c2[1], 0.45);
      g.lineWidth = 1.5;
      g.beginPath();
      if (g.roundRect) g.roundRect(c2[0] - cardW / 2, cardY - cardH / 2, cardW, cardH, 10);
      else g.rect(c2[0] - cardW / 2, cardY - cardH / 2, cardW, cardH);
      g.fill(); g.stroke();
      g.fillStyle = hexA(c2[1], 0.95);
      g.font = font(20, 600);
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(ci === 0 ? '概念' : String(sc.i + 1) + ' / ' + story.scenes.length, c2[0], cardY);
    });
    g.restore();

    g.save();
    g.globalAlpha = alpha;
    g.textAlign = 'center';
    g.textBaseline = 'middle';

    // 标题：弹性入场（原来只是匀速上浮 34px，看着不动）
    var inP = back(clamp01(p / 0.28), 1.9);
    var rise = (1 - inP) * 92;
    var title = sc.title || '';
    g.save();
    g.translate(cx, cy - 26 + rise);
    g.scale(lerp(0.86, 1, inP), lerp(0.86, 1, inP));      // 轻微缩放配合弹性
    g.font = font(88, 700);
    g.fillStyle = c.main;
    g.shadowColor = hexA(c.main, .55); g.shadowBlur = 34;
    g.fillText(title, 0, 0);
    g.shadowBlur = 0;
    // 标题下划线：从左往右「写」出来
    var tw = Math.min(560, Math.max(120, title.length * 92));
    g.globalAlpha = alpha * clamp01((p - 0.22) / 0.3);
    g.fillStyle = c.alt;
    g.fillRect(-tw / 2, 62, tw * clamp01((p - 0.22) / 0.3), 4);
    g.restore();

    if (sc.text) {
      g.globalAlpha = alpha * smooth(p * 5) * smooth((1 - p) * 7);
      // 字幕挪到卡片上方那条带子里，不再被圆环压住；
      // y 从 cy+262 收到 cy+236，给底部片名题头（H-34≈686）让出安全距离。
      sub(g, story, sc, cx, cy + 236, W - 300, 29, 500);
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

    // 运动层（2026-10-05）：原来整段只变化 1.9%，逐字揭示之外画面几乎不动
    particles(g, { t: t, n: 20 + Math.floor(p * 22), speed: 0.045, seed: sc.i + 7,
      color: c.main, r: 2.6, alpha: 0.30 * alpha, box: { x: 60, y: 70, w: W - 120, h: H - 190 } });
    dial(g, { x: 124, y: H - 164, r: 60, t: t, p: p, color: c.alt,
      dim: hexA(c.alt, 0.22), lw: 1.6, rpm: 26 });

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
    // 宽度兜底（2026-10-05）：公式里常夹中文（如「E = mc² 的秘密」），按 64px 量总宽会
    // 顶出 1280 的画面，两头的字符直接出画。超了就整体按比例缩字号（下限 30px）再重量一次。
    var exprPx = 64;
    if (totalW > W - 150) {
      exprPx = Math.max(30, 64 * (W - 150) / totalW);
      g.font = font(exprPx, 600);
      widths = []; totalW = 0;
      for (i = 0; i < chars.length; i++) {
        var w2 = g.measureText(chars[i]).width;
        widths.push(w2); totalW += w2;
      }
    }
    var x = cx - totalW / 2;
    for (i = 0; i < chars.length; i++) {
      var ch = chars[i];
      var on = i < revealed;
      g.font = font(exprPx, on ? 600 : 400);
      g.fillStyle = on ? c.main : hexA(c.dim, .3);
      if (ch !== ' ') g.fillText(ch, x + widths[i] / 2, cy);
      x += widths[i];
    }

    // 高亮光标（跟着揭示进度走，高度跟着缩过的字号走）
    if (revealed < chars.length) {
      var caret = 0;
      for (i = 0; i < revealed; i++) caret += widths[i];
      g.fillStyle = hexA(c.main, .8 * (0.4 + 0.6 * Math.abs(Math.sin(t * 6))));
      g.fillRect(cx - totalW / 2 + caret + 2, cy - exprPx * 0.47, 3, exprPx * 0.94);
    }

    if (note) {
      // ⚠️ 原来 y=cy+118，字幕两行时上沿正好压住还在逐字揭示的字符（截图里糊成一团）。
      // 下移到 cy+172，并要求逐字揭示过半才淡入。
      g.globalAlpha = alpha * smooth((p - .45) * 4);
      sub(g, story, sc, cx, cy + 172, W - 300, 28, 400);
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

    // 运动层（2026-10-05）：原来 2.8%，柱子长完就静止了
    particles(g, { t: t, n: 18 + Math.floor(p * 20), speed: 0.05, seed: sc.i + 3,
      color: c.main, r: 2.4, alpha: 0.28 * alpha, box: { x: 80, y: 120, w: W - 160, h: H - 300 } });

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

    // 运动层（2026-10-05）：原来 4.9%，就是一块色板宽度在变
    particles(g, { t: t, n: 20 + Math.floor(p * 22), speed: 0.05, seed: sc.i + 5,
      color: two ? c.alt : c.main, r: 2.6, alpha: 0.28 * alpha,
      box: { x: 60, y: 90, w: W - 120, h: H - 220 } });

    var cx = W / 2;
    // 分屏缝用弹性推进（原来 ease 太软，看着像没动）
    var wLeft = two ? cx * back(clamp01(p / 0.62), 0.55) : W * back(clamp01(p / 0.7), 0.4);
    var wRight = W - wLeft;
    // ⚠️ 2026-10-05 修「字幕被色板盖住」：色板原来 h0 = H-300 → 底边落在 y=610，
    //    而字幕基线在 H-108 = 612（两行时上沿 579.5）→ 字幕正好骑在色板底边上，
    //    一半在色块里一半在外。色板收 60px（底边 580），字幕再下移 24px（H-84 = 636），
    //    两行时上沿 603.5，与色板之间留出 23px 净空。
    var y0 = 190, h0 = H - 330;

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
      // ⚠️ 原来画在 y=110，色板从 y=190 起、上边缘还会被描边加粗 → 标题压在色板上糊成一团。
      // 改成画在色板**上方**的独立一行，并加一条分隔线，层次也清楚了。
      g.fillStyle = c.text; g.font = font(42, 600);
      g.fillText(raw, W / 2, 104);
      g.globalAlpha = alpha * 0.4;
      g.strokeStyle = hexA(c.main, 0.5);
      g.lineWidth = 1;
      g.beginPath(); g.moveTo(W / 2 - 90, 140); g.lineTo(W / 2 + 90, 140); g.stroke();
    }

    g.globalAlpha = alpha * smooth((p - .3) * 3.5);
    sub(g, story, sc, W / 2, H - 84, W - 300, 26, 400);
    g.restore();
  }

  /* ---------------- 母题 5：几何演化（对称群） ---------------- */
  function drawGeo(g, story, sc, p, t, alpha) {
    var c = pal(story.palette);
    var cx = W / 2, cy = H / 2;
    var n = story.scenes.length + 2;
    var grow = ease(p);
    // ⚠️ 2026-10-05 修「标题被多边形扫到」：原来 R 长到 280，多边形是**旋转**的，
    //    转到有顶点朝正上方时最高点 y = cy - R = 360 - 280 = 80，
    //    正好扎进标题带（63~105）和分隔线（118）——肉眼就是「标题压到多边形」。
    //    改后 R 上限 210：最高点最多到 150（离分隔线还有 32px），
    //    最低点最多到 570（字幕两行时上沿 594，留 24px）。
    var R = 110 + 100 * grow;

    // 运动层（2026-10-05）：原来 3.0%，只是整体缓慢放大
    particles(g, { t: t, n: 22 + Math.floor(p * 24), speed: 0.05, seed: sc.i + 11,
      color: c.alt, r: 2.6, alpha: 0.3 * alpha, box: { x: 70, y: 80, w: W - 140, h: H - 200 } });
    dial(g, { x: cx, y: cy, r: 108, t: t, p: p, color: c.alt,
      dim: hexA(c.alt, 0.2), lw: 1.6, rpm: 30 });

    g.save();
    g.globalAlpha = alpha;
    g.strokeStyle = hexA(c.main, .25);
    g.lineWidth = 1;
    for (var ring = 1; ring <= 3; ring++) {
      // 每层环反向自转、速度不同 → 整段一直有相对运动
      g.save();
      g.translate(cx, cy);
      g.rotate(spin(t, (ring % 2 ? 9 : -7) * (ring + 1)));
      g.beginPath(); g.arc(0, 0, R * (1 + ring * .45), 0, Math.PI * 2); g.stroke();
      g.restore();
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
    // ⚠️ 原来标题画在 cy-R-70：R 随生长到 280，y 会顶到 10（贴边/出画），
    // 而且多边形是**旋转**的，顶点会扫过标题。改成固定在画面上方一条带子里。
    g.fillStyle = c.text;
    g.font = font(42, 700);
    g.fillText(sc.title || '', cx, 84);
    g.globalAlpha = alpha * 0.45;
    g.strokeStyle = hexA(c.main, 0.55);
    g.lineWidth = 1;
    g.beginPath(); g.moveTo(cx - 80, 118); g.lineTo(cx + 80, 118); g.stroke();
    g.globalAlpha = alpha;
    g.fillStyle = c.dim;
    sub(g, story, sc, cx, H - 96, W - 420, 24, 400);
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
    // 运动层（2026-10-05）：原来 2.0%，场景本身只有极轻微的循环动画，
    // 整段几乎定格。这里补前景粒子 + 底部光带推移，让画面始终有流动感。
    particles(g, { t: t, n: 16 + Math.floor(p * 18), speed: 0.04, seed: sc.i + 13,
      color: pal(story.palette).main, r: 2.2, alpha: 0.22 * alpha,
      box: { x: 50, y: 90, w: W - 100, h: H - 240 } });

    g.save();
    g.globalAlpha = alpha;
    // 段间交叉淡入：每段前后各 0.35s 叠化，避免硬切
    fn(g, t, p, { mood: story.palette, place: id, scene: sc });
    g.restore();

    // 底部一道横向推移的光带（很轻，但保证整段画面有连续变化）
    g.save();
    g.globalAlpha = alpha * 0.30;
    var bandY = H - 246, bandW = 300;
    var bandX = ((t * 130) % (W + bandW * 2)) - bandW;
    var bg2 = g.createLinearGradient(bandX, 0, bandX + bandW, 0);
    bg2.addColorStop(0, 'rgba(255,255,255,0)');
    bg2.addColorStop(0.5, hexA(pal(story.palette).alt, 0.5));
    bg2.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = bg2;
    g.fillRect(bandX, bandY, bandW, 2);
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

    // 片名题头（前 1.4 秒）
    // ⚠️ 原来固定画在 y=120，跟 split(104) / geo(84) / concept 的段标题撞在一起，
    //   开场 1.4 秒会出现两层字叠成重影（截图里「捡最亮」那种糊字）。
    //   改到底部也不行：concept 字幕在 cy+262≈622、题头原定 H-118≈602，只差 20px 照样叠。
    //   正解：题头放在**进度线正上方的空档**（H-30 往上、进度线在 H-6），
    //   并且这 1.4 秒内不画任何别的字——把整段开头让给它。
    if (t < 1.4 && story.title) {
      var c = pal(story.palette);
      g.save();
      g.globalAlpha = smooth(t / 0.6) * smooth((1.4 - t) / 0.5);
      var ty = H - 34;
      var grd2 = g.createLinearGradient(0, ty - 40, 0, ty + 10);
      grd2.addColorStop(0, 'rgba(0,0,0,0)');
      grd2.addColorStop(0.5, 'rgba(0,0,0,.6)');
      grd2.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd2;
      g.fillRect(0, ty - 40, W, 50);
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillStyle = c.text;
      g.font = font(34, 700);
      g.shadowColor = hexA(c.main, .55); g.shadowBlur = 16;
      g.fillText(story.title, W / 2, ty);
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
