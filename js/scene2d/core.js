/* scene2d/core.js —— 2D 生活场景的绘图原语
 *
 * 风格定位：低多边形 2D 插画（不是照片感，也不假装 3D）。
 * 靠「分层 + 两点透视地面 + 剪影 + 光斑」做出纵深，成本极低、渲染极快，
 * 适合 1280×720 @30fps 在浏览器里实时跑（还能直接进现有 MediaRecorder 导出）。
 *
 * 约定：设计坐标系 1280×720，所有场景函数签名 f(g, t, p, o)
 *   t = 全局秒（动画）、p = 本段进度 0..1、o = { scene, mood, ... }
 */
(function (root) {
  'use strict';
  var FS = (root.FS = root.FS || {});
  var W = 1280, H = 720;
  var HZ = 470;                        // 地平线高度

  /* ---------------- 基础 ---------------- */
  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  /** 平滑步进，动画起停用 */
  function smooth(x) { x = clamp01(x); return x * x * (3 - 2 * x); }
  /** 缓动：easeOutCubic */
  function easeOut(x) { return 1 - Math.pow(1 - clamp01(x), 3); }

  /* ---------------- 颜色 ---------------- */
  /** '#rrggbb' + alpha -> rgba() */
  function A(hex, a) {
    if (typeof hex !== 'string') return 'rgba(255,255,255,' + (a === undefined ? 1 : a) + ')';
    if (hex[0] !== '#') return hex;
    var s = hex.slice(1);
    if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
    var r = parseInt(s.slice(0, 2), 16), g = parseInt(s.slice(2, 4), 16), b = parseInt(s.slice(4, 6), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + (a === undefined ? 1 : a) + ')';
  }
  /** 明度调整：k<1 变暗，k>1 变亮 */
  function shade(hex, k) {
    var s = hex.slice(1);
    if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
    var r = clamp01(parseInt(s.slice(0, 2), 16) / 255 * k);
    var g = clamp01(parseInt(s.slice(2, 4), 16) / 255 * k);
    var b = clamp01(parseInt(s.slice(4, 6), 16) / 255 * k);
    return '#' + [r, g, b].map(function (v) {
      return ('0' + Math.round(v * 255).toString(16)).slice(-2);
    }).join('');
  }
  function mixc(h1, h2, t) {
    function p(h) {
      var s = h.slice(1);
      if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
      return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
    }
    var a = p(h1), b = p(h2);
    return '#' + a.map(function (v, i) {
      return ('0' + Math.round(lerp(v, b[i], clamp01(t))).toString(16)).slice(-2);
    }).join('');
  }

  /* ---------------- 天空 / 光 ---------------- */

  /** 竖直渐变天空（可多段：stops = [[pos, color], ...]） */
  function sky(g, stops, top, bottom) {
    var grd = g.createLinearGradient(0, top, 0, bottom);
    stops.forEach(function (s) { grd.addColorStop(s[0], s[1]); });
    g.fillStyle = grd;
    g.fillRect(0, top, W, bottom - top);
  }

  /** 太阳/月亮光斑：带柔和辉光 */
  function glow(g, x, y, r, color, a) {
    var grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, A(color, a));
    grd.addColorStop(0.45, A(color, a * 0.4));
    grd.addColorStop(1, A(color, 0));
    g.fillStyle = grd;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }

  /** 地平线雾带：把远景和地面衔接起来（廉价大气透视） */
  function haze(g, y, h, color, a) {
    var grd = g.createLinearGradient(0, y - h, 0, y + h);
    grd.addColorStop(0, A(color, 0));
    grd.addColorStop(0.5, A(color, a));
    grd.addColorStop(1, A(color, 0));
    g.fillStyle = grd;
    g.fillRect(0, y - h, W, h * 2);
  }

  /* ---------------- 地面：两点透视 ---------------- */

  /**
   * 地面网格。vp = 灭点 x（默认画面中心），hz = 地平线 y。
   * 画出向灭点收敛的横线（道路/地板砖），是 2D 场景纵深的主要来源。
   */
  function groundGrid(g, o) {
    o = o || {};
    var hz = o.hz === undefined ? HZ : o.hz;
    var vp = o.vp === undefined ? W / 2 : o.vp;
    var y0 = o.y0 === undefined ? H : o.y0;                 // 近端
    var rows = o.rows || 7;
    var color = o.color || '#2a3346';
    var drift = o.drift || 0;                              // 0..1，纵向滚动
    g.save();
    g.strokeStyle = A(color, o.a === undefined ? 0.3 : o.a);
    g.lineWidth = o.lw || 1.5;
    // 纵向线（朝灭点收敛）
    var n = o.cols || 14;
    for (var i = 0; i <= n; i++) {
      var x = (i / n) * W;
      g.beginPath();
      g.moveTo(x, y0);
      g.lineTo(lerp(x, vp, 0.88), hz);
      g.stroke();
    }
    // 横向线（等比间距 = 透视感）
    for (var j = 0; j < rows; j++) {
      var f = (j + ((drift % 1) + 1) % 1) / rows;
      var y = lerp(y0, hz, Math.pow(f, 0.62));
      g.beginPath();
      g.moveTo(0, y); g.lineTo(W, y);
      g.globalAlpha = (o.a === undefined ? 0.3 : o.a) * (0.35 + 0.65 * (1 - f));
      g.stroke();
      g.globalAlpha = 1;
    }
    g.restore();
  }

  /** 地面色块（一条路、一块地板），带纵深梯形 */
  function groundBand(g, o) {
    var hz = o.hz === undefined ? HZ : o.hz;
    var vp = o.vp === undefined ? W / 2 : o.vp;
    var y0 = o.y0 === undefined ? H : o.y0;
    var y1 = o.y1 === undefined ? hz : o.y1;               // 远端
    var xc0 = o.x0 === undefined ? 0 : o.x0;               // 近端左右
    var xc1 = o.x1 === undefined ? W : o.x1;
    var xr0 = o.xr0 === undefined ? vp - 40 : o.xr0;        // 远端左右（更窄 = 透视）
    var xr1 = o.xr1 === undefined ? vp + 40 : o.xr1;
    g.fillStyle = o.color;
    g.beginPath();
    g.moveTo(xc0, y0); g.lineTo(xc1, y0); g.lineTo(xr1, y1); g.lineTo(xr0, y1);
    g.closePath(); g.fill();
  }

  /* ---------------- 剪影图元 ---------------- */

  /** 矩形建筑（可带窗格） */
  function building(g, o) {
    var x = o.x, y = o.y, w = o.w, h = o.h;
    g.fillStyle = o.color;
    g.fillRect(x, y - h, w, h);
    // 侧面（假厚度）
    if (o.depth) {
      g.fillStyle = shade(o.color, 0.78);
      g.beginPath();
      g.moveTo(x + w, y - h);
      g.lineTo(x + w + o.depth, y - h - o.depth * 0.5);
      g.lineTo(x + w + o.depth, y - o.depth * 0.5);
      g.lineTo(x + w, y);
      g.closePath(); g.fill();
    }
    // 窗
    if (o.windows) {
      var cols = o.winCols || 3, rows = o.winRows || 4;
      var ww = o.winW || 14, wh = o.wh || 18, gap = o.winGap || 16;
      var lit = o.lit === undefined ? 0.35 : o.lit;
      for (var r = 0; r < rows; r++) {
        for (var c = 0; c < cols; c++) {
          var wx = x + 12 + c * gap, wy = y - h + 22 + r * (wh + 14);
          if (wx + ww > x + w - 8 || wy + wh > y - 10) continue;
          // 每扇窗的亮灭用位置做伪随机（确定性，不用 Math.random）
          var on = ((r * 7 + c * 13 + Math.round(x)) % 5) / 5 < lit;
          g.fillStyle = on ? A(o.winColor || '#ffd98a', 0.85) : A(shade(o.color, 0.55), 0.9);
          g.fillRect(wx, wy, ww, wh);
        }
      }
    }
  }

  /** 树（低多边形：树干 + 2~3 团） */
  function tree(g, x, baseY, h, o) {
    o = o || {};
    var leaf = o.leaf || '#3f7a46';
    var trunkW = Math.max(4, h * 0.09);
    g.fillStyle = o.trunk || '#6b4f3a';
    g.fillRect(x - trunkW / 2, baseY - h * 0.55, trunkW, h * 0.55);
    var r = h * 0.34;
    var blobs = [[0, -0.82, 1], [-0.28, -0.62, 0.68], [0.3, -0.66, 0.62]];
    for (var i = 0; i < blobs.length; i++) {
      var b = blobs[i];
      g.fillStyle = shade(leaf, 0.82 + b[2] * 0.34);
      g.beginPath();
      g.arc(x + b[0] * h, baseY + b[1] * h, r * b[2], 0, Math.PI * 2);
      g.fill();
    }
  }

  /** 灌木 / 草丛 */
  function bush(g, x, baseY, w, color) {
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(x - w / 2, baseY);
    g.lineTo(x - w * 0.28, baseY - w * 0.55);
    g.lineTo(x, baseY - w * 0.7);
    g.lineTo(x + w * 0.3, baseY - w * 0.5);
    g.lineTo(x + w / 2, baseY);
    g.closePath(); g.fill();
  }

  /** 桌子（俯视+一点侧面） */
  function table2d(g, x, baseY, w, h, top, leg) {
    g.fillStyle = leg || shade(top, 0.7);
    g.fillRect(x - w * 0.42, baseY - h, w * 0.08, h);
    g.fillRect(x + w * 0.34, baseY - h, w * 0.08, h);
    g.fillStyle = top;
    g.beginPath();
    g.moveTo(x - w / 2, baseY - h);
    g.lineTo(x + w / 2, baseY - h);
    g.lineTo(x + w * 0.42, baseY - h - h * 0.28);
    g.lineTo(x - w * 0.42, baseY - h - h * 0.28);
    g.closePath(); g.fill();
  }

  /** 杯子（带蒸汽，蒸汽是 2D 生活场景的灵魂） */
  function cup(g, x, baseY, w, h, color, steamT, o) {
    o = o || {};
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(x - w / 2, baseY - h);
    g.lineTo(x + w / 2, baseY - h);
    g.lineTo(x + w * 0.36, baseY);
    g.lineTo(x - w * 0.36, baseY);
    g.closePath(); g.fill();
    // 把手
    g.strokeStyle = color; g.lineWidth = Math.max(1.5, w * 0.09);
    g.beginPath();
    g.arc(x + w * 0.52, baseY - h * 0.62, w * 0.22, -1.1, 1.1);
    g.stroke();
    // 蒸汽：三段正弦飘带
    if (o.steam !== false) {
      g.strokeStyle = A('#ffffff', 0.3);
      g.lineWidth = Math.max(1.2, w * 0.1);
      for (var s = 0; s < 2; s++) {
        var ph = steamT * 1.5 + s * 2.1;
        g.beginPath();
        for (var k = 0; k <= 8; k++) {
          var u = k / 8;
          var yy = baseY - h - u * h * 1.5;
          var xx = x + Math.sin(ph + u * 4.2) * w * 0.22 * u;
          if (k === 0) g.moveTo(xx, yy); else g.lineTo(xx, yy);
        }
        g.globalAlpha = 0.5 - s * 0.18;
        g.stroke();
        g.globalAlpha = 1;
      }
    }
  }

  /** 吊灯 / 台灯光锥 */
  function lampCone(g, x, y, spread, h, color, a) {
    var grd = g.createLinearGradient(x, y, x, y + h);
    grd.addColorStop(0, A(color, a));
    grd.addColorStop(1, A(color, 0));
    g.fillStyle = grd;
    g.beginPath();
    g.moveTo(x - 5, y);
    g.lineTo(x + 5, y);
    g.lineTo(x + spread, y + h);
    g.lineTo(x - spread, y + h);
    g.closePath(); g.fill();
  }

  /* ---------------- 角色剪影（2D） ---------------- */

  /**
   * 一个人形剪影。o = { color, h, action, t, x, baseY }
   * action: stand | walk | sit | wave | run
   * 靠分段矩形做关节，够用且不贵。
   */
  function personSil(g, o) {
    var h = o.h || 150;
    var x = o.x, y = o.baseY;
    var t = o.t || 0;
    var act = o.action || 'stand';
    var c = o.color || '#1f2937';
    var u = h / 8;                                   // 八头身
    g.save();
    g.fillStyle = c;
    g.strokeStyle = c;
    g.lineCap = 'round';

    var swing = act === 'walk' || act === 'run' ? Math.sin(t * (act === 'run' ? 9 : 5.5)) : 0;
    var bob = act === 'walk' || act === 'run' ? Math.abs(Math.sin(t * (act === 'run' ? 9 : 5.5))) * u * 0.12 : 0;
    var bodyY = y - u * 4 - bob;

    // 腿
    g.lineWidth = u * 0.46;
    if (act === 'sit') {
      g.beginPath();
      g.moveTo(x - u * 0.1, bodyY + u * 0.6); g.lineTo(x - u * 0.1, y - u * 0.5);
      g.lineTo(x + u * 0.7, y - u * 0.5);
      g.stroke();
      g.beginPath();
      g.moveTo(x + u * 0.1, bodyY + u * 0.6); g.lineTo(x + u * 0.1, y - u * 0.5);
      g.lineTo(x + u * 0.7, y - u * 0.5);
      g.stroke();
    } else {
      g.beginPath();
      g.moveTo(x, bodyY + u * 0.5);
      g.lineTo(x - swing * u * 0.7, y);
      g.stroke();
      g.beginPath();
      g.moveTo(x, bodyY + u * 0.5);
      g.lineTo(x + swing * u * 0.7, y);
      g.stroke();
    }

    // 躯干
    g.lineWidth = u * 0.78;
    g.beginPath();
    g.moveTo(x, bodyY - u * 0.4);
    g.lineTo(x, bodyY + u * 0.7);
    g.stroke();

    // 手臂
    g.lineWidth = u * 0.34;
    var armSw = act === 'walk' || act === 'run' ? -swing : 0;
    if (act === 'wave') {
      var wa = Math.sin(t * 6) * 0.5 - 0.4;
      g.beginPath();
      g.moveTo(x + u * 0.2, bodyY - u * 0.3);
      g.lineTo(x + u * 0.2 + Math.cos(wa) * u * 1.5, bodyY - u * 0.3 + Math.sin(wa) * u * 1.5);
      g.stroke();
      g.beginPath();
      g.moveTo(x - u * 0.2, bodyY - u * 0.3);
      g.lineTo(x - u * 0.5, bodyY + u * 0.7);
      g.stroke();
    } else {
      g.beginPath();
      g.moveTo(x - u * 0.2, bodyY - u * 0.3);
      g.lineTo(x - u * 0.2 + armSw * u * 0.8, bodyY + u * 0.9);
      g.stroke();
      g.beginPath();
      g.moveTo(x + u * 0.2, bodyY - u * 0.3);
      g.lineTo(x + u * 0.2 - armSw * u * 0.8, bodyY + u * 0.9);
      g.stroke();
    }

    // 头
    g.fillStyle = o.head || c;
    g.beginPath();
    g.arc(x, bodyY - u * 0.95, u * 0.52, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }

  /** 猫剪影（尾巴摆动是灵魂） */
  function catSil(g, o) {
    var x = o.x, y = o.baseY, t = o.t || 0;
    var s = o.s || 0.5;                        // 缩放（猫比人小很多）
    var c = o.color || '#2b2b33';
    var walking = o.action === 'walk';
    var bob = walking ? Math.abs(Math.sin(t * 7)) * 3 * s : 0;
    g.save();
    g.fillStyle = c;
    // 身体
    g.beginPath();
    g.ellipse(x, y - 14 * s - bob, 20 * s, 11 * s, 0, 0, Math.PI * 2);
    g.fill();
    // 头
    g.beginPath();
    g.arc(x + 18 * s, y - 22 * s - bob, 8 * s, 0, Math.PI * 2);
    g.fill();
    // 耳
    g.beginPath();
    g.moveTo(x + 14 * s, y - 27 * s - bob); g.lineTo(x + 16 * s, y - 34 * s - bob); g.lineTo(x + 20 * s, y - 28 * s - bob);
    g.closePath(); g.fill();
    // 尾
    g.strokeStyle = c;
    g.lineWidth = 3.2 * s;
    g.lineCap = 'round';
    var tw = Math.sin(t * (walking ? 6 : 2.2)) * 0.5;
    g.beginPath();
    g.moveTo(x - 19 * s, y - 15 * s - bob);
    g.quadraticCurveTo(x - 34 * s, y - 26 * s - bob + tw * 12 * s,
      x - 40 * s, y - 40 * s - bob + tw * 20 * s);
    g.stroke();
    // 腿
    g.lineWidth = 3 * s;
    for (var i = 0; i < 2; i++) {
      var off = walking ? Math.sin(t * 7 + i * Math.PI) * 5 * s : 0;
      g.beginPath();
      g.moveTo(x - 8 * s + i * 14 * s, y - 7 * s - bob);
      g.lineTo(x - 8 * s + i * 14 * s + off, y);
      g.stroke();
    }
    g.restore();
  }

  /** 鸟（飞过时画一道弧线） */
  function birdSil(g, x, y, s, color) {
    g.strokeStyle = color || '#2b2b33';
    g.lineWidth = 2.2 * (s || 1);
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(x - 10 * s, y);
    g.quadraticCurveTo(x - 5 * s, y - 6 * s, x, y - 1 * s);
    g.quadraticCurveTo(x + 5 * s, y - 6 * s, x + 10 * s, y);
    g.stroke();
  }

  /* ---------------- 粒子 / 天气 ---------------- */

  /**
   * 通用粒子（雨/雪/尘埃/光斑）。用位置哈希做确定性随机，不用 Math.random。
   * o = { n, x0,y0,x1,y1, size, color, speed, drift, shape }
   */
  function particles(g, o) {
    var n = o.n || 60;
    var t = o.t || 0;
    for (var i = 0; i < n; i++) {
      // 三次哈希拿到稳定的伪随机
      var h1 = ((i * 9301 + 49297) % 233280) / 233280;
      var h2 = ((i * 4021 + 12345) % 233280) / 233280;
      var h3 = ((i * 7919 + 104729) % 233280) / 233280;
      var spanX = (o.x1 || W) - (o.x0 || 0);
      var spanY = (o.y1 || H) - (o.y0 || 0);
      var sp = o.speed || 120;
      var y = (o.y0 || 0) + ((h2 * spanY + t * sp) % spanY);
      var x = (o.x0 || 0) + h1 * spanX + Math.sin(t * 0.8 + h3 * 6.28) * (o.sway || 0);
      var sz = (o.size || 3) * (0.6 + h3 * 0.8);
      g.fillStyle = A(o.color || '#ffffff', (o.alpha || 0.4) * (0.5 + h3 * 0.5));
      if (o.shape === 'streak') {
        g.strokeStyle = g.fillStyle;
        g.lineWidth = sz * 0.5;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x - (o.slant || 3), y + sz * 3);
        g.stroke();
      } else {
        g.beginPath(); g.arc(x, y, sz, 0, Math.PI * 2); g.fill();
      }
    }
  }

  /* ---------------- 文字 ---------------- */
  function text(g, str, x, y, size, color, o) {
    o = o || {};
    g.save();
    g.font = (o.weight || 400) + ' ' + size + 'px "PingFang SC","Hiragino Sans GB","Microsoft YaHei",system-ui,sans-serif';
    g.textAlign = o.align || 'left';
    g.textBaseline = o.baseline || 'alphabetic';
    if (o.shadow) {
      g.shadowColor = A(o.shadow, o.shadowA || 0.5);
      g.shadowBlur = size * 0.35;
      g.shadowOffsetY = size * 0.06;
    }
    g.fillStyle = color;
    g.fillText(str, x, y);
    g.restore();
  }

  /** 招牌 / 灯箱（生活场景的标志物） */
  function sign(g, x, y, w, h, label, o) {
    o = o || {};
    g.fillStyle = o.bg || '#1f2937';
    g.fillRect(x, y, w, h);
    g.strokeStyle = o.border || A('#ffffff', 0.25);
    g.lineWidth = 2;
    g.strokeRect(x + 3, y + 3, w - 6, h - 6);
    text(g, label, x + w / 2, y + h / 2 + h * 0.14, h * 0.52, o.fg || '#ffe9a8',
      { align: 'center', weight: 600 });
    if (o.glowOn) glow(g, x + w / 2, y + h / 2, w * 0.7, o.fg || '#ffe9a8', 0.16);
  }

  /* ---------------- 导出 ---------------- */
  FS.s2d = {
    W: W, H: H, HZ: HZ,
    clamp01: clamp01, lerp: lerp, smooth: smooth, easeOut: easeOut,
    A: A, shade: shade, mixc: mixc,
    sky: sky, glow: glow, haze: haze,
    groundGrid: groundGrid, groundBand: groundBand,
    building: building, tree: tree, bush: bush, table2d: table2d, cup: cup, lampCone: lampCone,
    personSil: personSil, catSil: catSil, birdSil: birdSil,
    particles: particles, text: text, sign: sign
  };
})(typeof window !== 'undefined' ? window : this);
