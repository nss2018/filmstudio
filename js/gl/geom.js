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

  /* ================================================================
   *  描边（线框）几何 —— 2026-10-05
   *
   *  为什么要这个：现有 3D 场景全是**实体低多边形**（676~2916 面），
   *  每个物体都走「法线 + 4 盏点光 + 雾 + 辉光」的完整着色，一屏要算
   *  几万个三角形。线框风格（只画轮廓线）看起来反而更像「设计过的」，
   *  而且**只要边不要面** —— 顶点还在，光照计算可以省掉一大半。
   *
   *
   *  ⚠️⚠️ 去重必须按**坐标**做，不能按顶点下标（2026-10-05 实测踩到）：
   *  本项目的 tri()/quad() 是「每个面 push 一组全新顶点」的写法（低多边形
   *  刻意不共享顶点，好让每个面有硬边自己的法线）。所以一个立方体的
   *  12 条边在 idx 里是 **36 个互不相同的顶点对** —— 按下标去重等于没去重，
   *  画出来是三倍亮度的粗线，斜面上还会 z-fighting 一样地抖。
   *  正解：先按量化坐标把顶点「合并成规范号」，再去重边。
   *  量化取 1e-4（世界坐标的小数点后 4 位）——场景里最小构件也有 1e-2 量级，
   *  1e-4 绝不会把两条不同的边误并成一个。
   * ================================================================ */
  function edges(geo, opt) {
    opt = opt || {};
    var idx = geo.idx, pos = geo.pos, col = geo.col, nrm = geo.nrm;
    var Q = opt.quant === undefined ? 1e4 : opt.quant;      // 坐标量化精度
    var seen = opt.noDedup ? null : {};
    var vmap = opt.noDedup ? null : {};
    var nverts = 0;
    var out = empty();
    /** 顶点下标 → 规范顶点号（同坐标的多个下标归到同一个） */
    function canon(vi) {
      if (!vmap) return vi;                            // noDedup 模式不做规范，直接用原下标
      var k = Math.round(pos[vi * 3] * Q) + '|' + Math.round(pos[vi * 3 + 1] * Q) +
              '|' + Math.round(pos[vi * 3 + 2] * Q);
      var got = vmap[k];
      if (got === undefined) { got = nverts++; vmap[k] = got; }
      return got;
    }
    /* ---------- 折痕过滤：把「同一个平面内的三角化对角线」剔掉 ----------
     *  实测出图的问题：一面墙/地板被 quad 拆成两个三角后，中间那条**对角线**
     *  也被描了出来，在大片平面上 criss-cross 一片，看起来像毛线而不是建筑线稿
     *  （线框预览图里能直接看到地板上那堆交叉线）。
     *
     *  判据：一条边如果被两个三角形共用，且两个三角形的**法线夹角很小**
     *  （共面），那它就是「平面内部的三角化线」，不是物体的棱 → 剔掉。
     *  盒子真正的 90° 棱会留下。
     *
     *  为什么不能用「只出现一次的边就剔掉」：那种剔法会把悬边（只属于一个面）
     *  也删了，而 low-poly 里 open mesh 不少见。这里只看夹角，更保守。
     *
     *  opt.creaseAngle = 保留的最大夹角（度）。默认 18° ——
     *  够钝（球/圆柱的相邻面要留下），又够严（平面三角化线是 0° 必剔）。
     */
    var faceOf = {}, angTol = null;
    if (opt.creaseAngle !== undefined && opt.creaseAngle !== null) {
      angTol = Math.cos(Math.max(0, Math.min(89.9, opt.creaseAngle)) * Math.PI / 180);
      var fi = 0;
      for (var fi2 = 0; fi2 < idx.length; fi2 += 3, fi++) {
        var t0 = idx[fi2], t1 = idx[fi2 + 1], t2 = idx[fi2 + 2];
        [[t0, t1], [t1, t2], [t2, t0]].forEach(function (pr) {
          var kk = canon(pr[0]) < canon(pr[1])
            ? canon(pr[0]) + '_' + canon(pr[1])
            : canon(pr[1]) + '_' + canon(pr[0]);
          if (!faceOf[kk]) faceOf[kk] = [];
          faceOf[kk].push(fi);
        });
      }
      // 每个三角面的法线
      var fn_ = [];
      for (var f = 0; f < idx.length / 3; f++) {
        var a0 = idx[f * 3], a1 = idx[f * 3 + 1], a2 = idx[f * 3 + 2];
        var ux = pos[a1 * 3] - pos[a0 * 3], uy = pos[a1 * 3 + 1] - pos[a0 * 3 + 1], uz = pos[a1 * 3 + 2] - pos[a0 * 3 + 2];
        var vx = pos[a2 * 3] - pos[a0 * 3], vy = pos[a2 * 3 + 1] - pos[a0 * 3 + 1], vz = pos[a2 * 3 + 2] - pos[a0 * 3 + 2];
        var nx2 = uy * vz - uz * vy, ny2 = uz * vx - ux * vz, nz2 = ux * vy - uy * vx;
        var len = Math.hypot(nx2, ny2, nz2) || 1;
        fn_.push([nx2 / len, ny2 / len, nz2 / len]);
      }
      var isCrease = function (k) {
        var fs = faceOf[k];
        if (!fs || fs.length < 2) return true;           // 边界/悬边：保留
        var A = fn_[fs[0]], Bv = fn_[fs[1]];
        var dp = A[0] * Bv[0] + A[1] * Bv[1] + A[2] * Bv[2];
        return dp < angTol;                              // 夹角 > 阈值 → 是棱，留
      };
    }

    function addEdge(a, b) {
      if (a === b) return;                              // 退化三角形
      var ca = canon(a), cb = canon(b);
      if (ca === cb) return;                            // 两端同一点 → 零长边
      var k = ca < cb ? (ca + '_' + cb) : (cb + '_' + ca);
      if (seen) {
        if (seen[k]) return;
        seen[k] = 1;
      }
      if (isCrease && !isCrease(k)) return;             // 共面 → 三角化线，剔掉
      // 线的颜色取两端顶点的平均色（两端可能属于不同面，描边跟着物体走）
      var r = 0, gg = 0, bb = 0, nx = 0, ny = 0, nz = 0, n = 0;
      [a, b].forEach(function (vi) {
        r += col[vi * 3]; gg += col[vi * 3 + 1]; bb += col[vi * 3 + 2];
        nx += nrm[vi * 3]; ny += nrm[vi * 3 + 1]; nz += nrm[vi * 3 + 2];
        n++;
      });
      out.pos.push(pos[a * 3], pos[a * 3 + 1], pos[a * 3 + 2]);
      out.pos.push(pos[b * 3], pos[b * 3 + 1], pos[b * 3 + 2]);
      out.nrm.push(nx / n, ny / n, nz / n);
      out.nrm.push(nx / n, ny / n, nz / n);
      out.col.push(r / n, gg / n, bb / n);
      out.col.push(r / n, gg / n, bb / n);
      out.idx.push(out.idx.length, out.idx.length + 1);
    }
    for (var i = 0; i < idx.length; i += 3) {
      var a = idx[i], b = idx[i + 1], c = idx[i + 2];
      addEdge(a, b); addEdge(b, c); addEdge(c, a);
    }
    // 极短线段（< eps）在屏幕上就是亮点，删掉省一半线段
    if (opt.minLen) {
      var f = empty();
      for (var j = 0; j < out.idx.length; j += 2) {
        var ia = out.idx[j], ib = out.idx[j + 1];
        var dx = out.pos[ia * 3] - out.pos[ib * 3];
        var dy = out.pos[ia * 3 + 1] - out.pos[ib * 3 + 1];
        var dz = out.pos[ia * 3 + 2] - out.pos[ib * 3 + 2];
        if (Math.hypot(dx, dy, dz) < opt.minLen) continue;
        var off = f.pos.length / 3;
        f.pos.push(out.pos[ia * 3], out.pos[ia * 3 + 1], out.pos[ia * 3 + 2]);
        f.pos.push(out.pos[ib * 3], out.pos[ib * 3 + 1], out.pos[ib * 3 + 2]);
        f.nrm.push(out.nrm[ia * 3], out.nrm[ia * 3 + 1], out.nrm[ia * 3 + 2]);
        f.nrm.push(out.nrm[ib * 3], out.nrm[ib * 3 + 1], out.nrm[ib * 3 + 2]);
        f.col.push(out.col[ia * 3], out.col[ia * 3 + 1], out.col[ia * 3 + 2]);
        f.col.push(out.col[ib * 3], out.col[ib * 3 + 1], out.col[ib * 3 + 2]);
        f.idx.push(off, off + 1);
      }
      return f;
    }
    return out;
  }

  /** 整份 place 几何（solid/water/glow）一次性转成描边几何。
   *  water 不进描边：水面是平的，描出来是一堆重叠横线，反而脏。 */
  function placeEdges(built, opt) {
    var out = empty();
    ['solid', 'glow'].forEach(function (k) {
      var g = built[k];
      if (!g || !g.idx || !g.idx.length) return;
      var e = edges(g, opt);
      var off = out.pos.length / 3;
      for (var i = 0; i < e.pos.length; i++) out.pos.push(e.pos[i]);
      for (var i2 = 0; i2 < e.nrm.length; i2++) out.nrm.push(e.nrm[i2]);
      for (var i3 = 0; i3 < e.col.length; i3++) out.col.push(e.col[i3]);
      for (var i4 = 0; i4 < e.idx.length; i4++) out.idx.push(e.idx[i4] + off);
    });
    return out;
  }

  /** 沿 Y 渐变着色（天空渐变、地面远处变暗） */  function paintGradientY(g, cLow, cHigh, y0, y1) {
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
    edges: edges, placeEdges: placeEdges,
    color: color, shade: shade, hsl2rgb: hsl2rgb
  };
})(typeof window !== 'undefined' ? window : this);
