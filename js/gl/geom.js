/* geom.js —— 程序化几何（低多边形 / flat shading）
 *
 * 几何格式：{pos:[], nrm:[], col:[], idx:[]}，纯数组，**不依赖 GL**，所以能在 node 里直接测。
 * 顶点不共享 → 每个三角面有独立法线 → 棱角分明的低多边形风格，也省掉法线平均的功夫。
 * 颜色放在顶点里（core.js 的 STRIDE=9：pos3+nrm3+col3），一屏几十种颜色也不用切 draw call。
 */
(function (root) {
  'use strict';
  var FS = (root.FS = root.FS || {});
  var M4 = FS.gl.M4;

  function empty() { return { pos: [], nrm: [], col: [], idx: [] }; }

  /** 往 geo 里塞一个三角形（自动算面法线） */
  function tri(g, a, b, c, col) {
    var ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    var vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    var nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    var l = Math.hypot(nx, ny, nz);
    if (l > 1e-9) { nx /= l; ny /= l; nz /= l; } else { nx = ny = 0; nz = 1; }
    var base = g.pos.length / 3;
    [a, b, c].forEach(function (p) {
      g.pos.push(p[0], p[1], p[2]);
      g.nrm.push(nx, ny, nz);
      g.col.push(col[0], col[1], col[2]);
    });
    g.idx.push(base, base + 1, base + 2);
    return g;
  }

  /** 四边形（a,b,c,d 需从外侧看逆时针；两条三角 (a,b,c)+(a,c,d)） */
  function quad(g, a, b, c, d, col) {
    tri(g, a, b, c, col);
    tri(g, a, c, d, col);
    return g;
  }

  /* ==================== 基本体 ==================== */

  /** 长方体（中心在原点）。面序：+Z -Z +X -X +Y -Y */
  function box(w, h, d, col) {
    col = col || [1, 1, 1];
    var g = empty();
    var x = w / 2, y = h / 2, z = d / 2;
    quad(g, [-x, -y,  z], [x, -y,  z], [x,  y,  z], [-x,  y,  z], col);  // +Z
    quad(g, [x, -y, -z], [-x, -y, -z], [-x,  y, -z], [x,  y, -z], col);  // -Z
    quad(g, [x, -y,  z], [x, -y, -z], [x,  y, -z], [x,  y,  z], col);  // +X
    quad(g, [-x, -y, -z], [-x, -y,  z], [-x,  y,  z], [-x,  y, -z], col);  // -X
    quad(g, [-x,  y,  z], [x,  y,  z], [x,  y, -z], [-x,  y, -z], col);  // +Y
    quad(g, [-x, -y, -z], [x, -y, -z], [x, -y,  z], [-x, -y,  z], col);  // -Y
    return g;
  }

  /** UV 球（低 seg/rings 即低多边形球） */
  function sphere(r, seg, rings, col) {
    seg = seg || 8; rings = rings || 6;
    col = col || [1, 1, 1];
    var g = empty();
    function P(i, j) {
      var phi = Math.PI * (i / rings);        // 0 顶 → PI 底
      var th = Math.PI * 2 * (j / seg);
      return [r * Math.sin(phi) * Math.cos(th), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(th)];
    }
    for (var i = 0; i < rings; i++) {
      for (var j = 0; j < seg; j++) {
        var a = P(i, j), b = P(i, j + 1), c = P(i + 1, j + 1), d = P(i + 1, j);
        if (i > 0) tri(g, a, b, c, col);
        if (i < rings - 1) tri(g, a, c, d, col);
      }
    }
    return g;
  }

  /** 圆柱 / 圆台（rBottom -> rTop），含两端盖 */
  function cylinder(rBottom, rTop, h, seg, col, capBottom, capTop) {
    seg = seg || 8;
    col = col || [1, 1, 1];
    var g = empty();
    var y0 = 0, y1 = h;
    for (var j = 0; j < seg; j++) {
      var t0 = Math.PI * 2 * (j / seg), t1 = Math.PI * 2 * ((j + 1) / seg);
      var p00 = [Math.cos(t0) * rBottom, y0, Math.sin(t0) * rBottom];
      var p10 = [Math.cos(t1) * rBottom, y0, Math.sin(t1) * rBottom];
      var p01 = [Math.cos(t0) * rTop, y1, Math.sin(t0) * rTop];
      var p11 = [Math.cos(t1) * rTop, y1, Math.sin(t1) * rTop];
      quad(g, p00, p10, p11, p01, col);
      if (capBottom !== false && rBottom > 1e-6) tri(g, [0, y0, 0], p10, p00, col);
      if (capTop !== false && rTop > 1e-6) tri(g, [0, y1, 0], p01, p11, col);
    }
    return g;
  }

  /** 圆锥 */
  function cone(r, h, seg, col) { return cylinder(r, 0.0001, h, seg || 8, col, true, false); }

  /** n 棱柱（人物躯干、柱子、树干） */
  function prism(sides, r, h, col, twist) {
    sides = sides || 6;
    col = col || [1, 1, 1];
    var g = empty();
    for (var j = 0; j < sides; j++) {
      var t0 = Math.PI * 2 * (j / sides) + (twist || 0);
      var t1 = Math.PI * 2 * ((j + 1) / sides) + (twist || 0);
      var a = [Math.cos(t0) * r, 0, Math.sin(t0) * r];
      var b = [Math.cos(t1) * r, 0, Math.sin(t1) * r];
      var c = [Math.cos(t1) * r, h, Math.sin(t1) * r];
      var d = [Math.cos(t0) * r, h, Math.sin(t0) * r];
      quad(g, a, b, c, d, col);
      tri(g, [0, h, 0], d, c, col);
      tri(g, [0, 0, 0], b, a, col);
    }
    return g;
  }

  /** 地面 / 平板（可细分起伏），y = fn(x,z) */
  function plane(w, d, nx, nz, fn, col) {
    nx = Math.max(1, nx | 0); nz = Math.max(1, nz | 0);
    col = col || [1, 1, 1];
    var g = empty();
    var h = fn || function () { return 0; };
    function P(i, j) {
      var x = (i / nx - .5) * w, z = (j / nz - .5) * d;
      return [x, h(x, z), z];
    }
    for (var i = 0; i < nx; i++) {
      for (var j = 0; j < nz; j++) {
        var a = P(i, j), b = P(i, j + 1), c = P(i + 1, j + 1), d2 = P(i + 1, j);
        if (i > 0) tri(g, a, b, c, col);
        if (j > 0) tri(g, a, c, d2, col);
      }
    }
    // 平面用两片大三角会让法线朝上不一致：统一朝上
    for (var k = 0; k < g.nrm.length; k += 3) { g.nrm[k] = 0; g.nrm[k + 1] = 1; g.nrm[k + 2] = 0; }
    return g;
  }

  /** 起伏地形（山丘/沙丘/水面），fn 决定形状 */
  function terrain(w, d, nx, nz, fn, col) {
    var g = plane(w, d, nx, nz, fn, col);
    // 按高度重新算法线（数值微分），不然山是平的
    var e = Math.max(w / nx, d / nz) * .5;
    for (var i = 0; i < g.pos.length; i += 9) {
      for (var v = 0; v < 3; v++) {
        var o = i + v * 3;
        var x = g.pos[o], y = g.pos[o + 1], z = g.pos[o + 2];
        var dhx = (fn(x + e, z) - fn(x - e, z)) / (2 * e);
        var dhz = (fn(x, z + e) - fn(x, z - e)) / (2 * e);
        var nx2 = -dhx, ny2 = 1, nz2 = -dhz;
        var l = Math.hypot(nx2, ny2, nz2);
        g.nrm[o] = nx2 / l; g.nrm[o + 1] = ny2 / l; g.nrm[o + 2] = nz2 / l;
      }
    }
    return g;
  }

  /** 挤出多边形（凸多边形）：poly = [[x,z], ...]，沿 Y 挤出 h */
  function extrude(poly, h, col) {
    col = col || [1, 1, 1];
    var g = empty();
    var n = poly.length;
    for (var j = 0; j < n; j++) {
      var a = poly[j], b = poly[(j + 1) % n];
      quad(g,
        [a[0], 0, a[1]], [b[0], 0, b[1]], [b[0], h, b[1]], [a[0], h, a[1]], col);
    }
    // 顶面扇形（poly 是凸的，扇形三角化成立）
    for (var k = 1; k < n - 1; k++) {
      tri(g, [poly[0][0], h, poly[0][1]], [poly[k][0], h, poly[k][1]], [poly[k + 1][0], h, poly[k + 1][1]], col);
    }
    return g;
  }

  /** 不规则多面体（树冠 / 云 / 石头）：球面顶点随机扰动 + 扁平化，种子决定形状 */
  function blob(r, detail, rough, rng, col) {
    detail = detail || 1;              // 1=低多边形，2=更圆
    var g = sphere(r, 6 * detail, 4 * detail, col);
    // 按"同位置同扰动"扰动，避免相邻面裂开：量化坐标后取同一随机值
    var cache = {};
    for (var i = 0; i < g.pos.length; i += 3) {
      var key = Math.round(g.pos[i] * 20) + '_' + Math.round(g.pos[i + 1] * 20) + '_' + Math.round(g.pos[i + 2] * 20);
      var k = cache[key];
      if (k === undefined) { k = 1 + (rng() - .5) * rough; cache[key] = k; }
      g.pos[i] *= k; g.pos[i + 1] *= k; g.pos[i + 2] *= k;
    }
    return g;
  }

  /* ==================== 变换与合并 ==================== */

  /** 就地变换：平移 / 旋转[弧度] / 缩放，法线用逆转置（缩放不均匀也不会歪） */
  function xform(g, pos, rot, scl) {
    var m = M4.fromTRS(pos || [0, 0, 0], rot || [0, 0, 0], scl || [1, 1, 1]);
    var nm = M4.normalMatrix(m);
    for (var i = 0; i < g.pos.length; i += 3) {
      var x = g.pos[i], y = g.pos[i + 1], z = g.pos[i + 2];
      g.pos[i] = m[0] * x + m[4] * y + m[8] * z + m[12];
      g.pos[i + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
      g.pos[i + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
      var nx = g.nrm[i], ny = g.nrm[i + 1], nz = g.nrm[i + 2];
      var ax = nm[0] * nx + nm[4] * ny + nm[8] * nz;
      var ay = nm[1] * nx + nm[5] * ny + nm[9] * nz;
      var az = nm[2] * nx + nm[6] * ny + nm[10] * nz;
      var l = Math.hypot(ax, ay, az) || 1;
      g.nrm[i] = ax / l; g.nrm[i + 1] = ay / l; g.nrm[i + 2] = az / l;
    }
    return g;
  }

  /** 合并（索引整体后移） */
  function merge(list) {
    var out = empty();
    for (var i = 0; i < list.length; i++) {
      var g = list[i];
      if (!g || !g.pos.length) continue;
      var off = out.pos.length / 3;
      for (var k = 0; k < g.pos.length; k++) out.pos.push(g.pos[k]);
      for (var k2 = 0; k2 < g.nrm.length; k2++) out.nrm.push(g.nrm[k2]);
      for (var k3 = 0; k3 < g.col.length; k3++) out.col.push(g.col[k3]);
      for (var k4 = 0; k4 < g.idx.length; k4++) out.idx.push(g.idx[k4] + off);
    }
    return out;
  }

  /** 换色（就地） */
  function paint(g, col) {
    for (var i = 0; i < g.col.length; i += 3) { g.col[i] = col[0]; g.col[i + 1] = col[1]; g.col[i + 2] = col[2]; }
    return g;
  }

  /** 沿 Y 渐变着色（天空渐变、地面远处变暗） */
  function paintGradientY(g, cLow, cHigh, y0, y1) {
    for (var i = 0, j = 1; j < g.pos.length; i += 3, j += 3) {
      var t = (g.pos[j] - y0) / ((y1 - y0) || 1);
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      g.col[i] = cLow[0] + (cHigh[0] - cLow[0]) * t;
      g.col[i + 1] = cLow[1] + (cHigh[1] - cLow[1]) * t;
      g.col[i + 2] = cLow[2] + (cHigh[2] - cLow[2]) * t;
    }
    return g;
  }

  /* ==================== 颜色 ==================== */

  /** '#4dd0c7' | [r,g,b] (0..1) | 'hsl(180,40%,60%)' → [r,g,b] */
  function color(c) {
    if (Array.isArray(c)) return c;
    if (typeof c !== 'string') return [1, 1, 1];
    if (c[0] === '#') {
      var s = c.slice(1);
      if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
      return [parseInt(s.slice(0, 2), 16) / 255, parseInt(s.slice(2, 4), 16) / 255, parseInt(s.slice(4, 6), 16) / 255];
    }
    var m = /hsl\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*\)/.exec(c);
    if (m) return hsl2rgb(+m[1], +m[2] / 100, +m[3] / 100);
    return [1, 1, 1];
  }

  function hsl2rgb(h, s, l) {
    h = ((h % 360) + 360) % 360 / 360;
    var r, g, b;
    function f(p, q, t) {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    }
    if (s === 0) { r = g = b = l; }
    else {
      var q = l < .5 ? l * (1 + s) : l + s - l * s;
      var p = 2 * l - q;
      r = f(p, q, h + 1 / 3); g = f(p, q, h); b = f(p, q, h - 1 / 3);
    }
    return [r, g, b];
  }

  /** 明度调整（k>1 变亮，k<1 变暗），用于同一色相生成层次 */
  function shade(c, k) {
    var a = Array.isArray(c) ? c : color(c);
    return [Math.min(1, a[0] * k), Math.min(1, a[1] * k), Math.min(1, a[2] * k)];
  }

  FS.geom = {
    empty: empty, tri: tri, quad: quad,
    box: box, sphere: sphere, cylinder: cylinder, cone: cone, prism: prism,
    plane: plane, terrain: terrain, extrude: extrude, blob: blob,
    xform: xform, merge: merge, paint: paint, paintGradientY: paintGradientY,
    color: color, shade: shade, hsl2rgb: hsl2rgb
  };
})(typeof window !== 'undefined' ? window : this);
