/* core.js —— WebGL2 薄封装 + 4x4 数学（零依赖，不引 gl-matrix）
 *
 * 设计取舍：
 *   1) 顶点格式固定为 position(3) + normal(3) + color(3) = 9 float，**颜色进顶点**。
 *      低多边形场景里一屏有几十种颜色，进顶点就不用为每个物体单独 draw call。
 *   2) 着色器编译失败要把出错那几行原样打出来（GLSL 报错只给行号，不看代码没法查）。
 *   3) 矩阵列主序，和 GLSL 的 mat4 内存布局一致，省掉一次转置。
 *   4) 数学部分挂 FS.M4，纯函数，node 里可直接测。
 */
(function (root) {
  'use strict';
  var FS = (root.FS = root.FS || {});

  /* ==================== 4x4 数学 ==================== */
  var M4 = {
    create: function () { return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]); },

    identity: function (o) {
      o = o || new Float32Array(16);
      o[0] = 1; o[1] = 0; o[2] = 0; o[3] = 0; o[4] = 0; o[5] = 1; o[6] = 0; o[7] = 0;
      o[8] = 0; o[9] = 0; o[10] = 1; o[11] = 0; o[12] = 0; o[13] = 0; o[14] = 0; o[15] = 1;
      return o;
    },

    /** a * b（列主序：先 b 后 a 的直觉顺序），out 可省略 */
    multiply: function (a, b, out) {
      out = out || new Float32Array(16);
      for (var c = 0; c < 4; c++) {
        var b0 = b[c * 4], b1 = b[c * 4 + 1], b2 = b[c * 4 + 2], b3 = b[c * 4 + 3];
        out[c * 4]     = a[0] * b0 + a[4] * b1 + a[8]  * b2 + a[12] * b3;
        out[c * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9]  * b2 + a[13] * b3;
        out[c * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
        out[c * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
      }
      return out;
    },

    perspective: function (fovy, aspect, near, far) {
      var f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
      var o = new Float32Array(16);
      o[0] = f / aspect; o[5] = f; o[10] = (far + near) * nf; o[11] = -1; o[14] = 2 * far * near * nf;
      return o;
    },

    ortho: function (l, r, b, t, n, f) {
      var o = new Float32Array(16);
      o[0] = 2 / (r - l); o[5] = 2 / (t - b); o[10] = 2 / (n - f);
      o[12] = -(r + l) / (r - l); o[13] = -(t + b) / (t - b); o[14] = -(f + n) / (n - f); o[15] = 1;
      return o;
    },

    lookAt: function (eye, center, up) {
      var zx = eye[0] - center[0], zy = eye[1] - center[1], zz = eye[2] - center[2];
      var zl = Math.hypot(zx, zy, zz) || 1; zx /= zl; zy /= zl; zz /= zl;
      var xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
      var xl = Math.hypot(xx, xy, xz) || 1; xx /= xl; xy /= xl; xz /= xl;
      var yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
      return new Float32Array([
        xx, yx, zx, 0,
        xy, yy, zy, 0,
        xz, yz, zz, 0,
        -(xx * eye[0] + xy * eye[1] + xz * eye[2]),
        -(yx * eye[0] + yy * eye[1] + yz * eye[2]),
        -(zx * eye[0] + zy * eye[1] + zz * eye[2]),
        1
      ]);
    },

    fromTRS: function (pos, rot, scl) {
      // rot = [rx, ry, rz]（弧度），先缩放再 ZYX 旋转
      var cx = Math.cos(rot[0]), sx = Math.sin(rot[0]);
      var cy = Math.cos(rot[1]), sy = Math.sin(rot[1]);
      var cz = Math.cos(rot[2]), sz = Math.sin(rot[2]);
      var sX = scl[0], sY = scl[1], sZ = scl[2];
      // R = Rz * Ry * Rx
      var m00 = cz * cy,               m01 = sz * cy,               m02 = -sy;
      var m10 = cz * sy * sx - sz * cx, m11 = sz * sy * sx + cz * cx, m12 = cy * sx;
      var m20 = cz * sy * cx + sz * sx, m21 = sz * sy * cx - cz * sx, m22 = cy * cx;
      return new Float32Array([
        m00 * sX, m10 * sX, m20 * sX, 0,
        m01 * sY, m11 * sY, m21 * sY, 0,
        m02 * sZ, m12 * sZ, m22 * sZ, 0,
        pos[0], pos[1], pos[2], 1
      ]);
    },

    /** 4x4 求逆（用于法线矩阵的逆转置）。奇异矩阵返回单位阵，不崩 */
    invert: function (m) {
      var o = new Float32Array(16);
      var a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3],
          a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7],
          a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11],
          a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];
      var b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10,
          b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12,
          b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30,
          b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
      var det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
      if (!det) return M4.identity(o);
      det = 1 / det;
      o[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
      o[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
      o[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
      o[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
      o[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
      o[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
      o[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
      o[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
      o[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
      o[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
      o[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
      o[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
      o[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
      o[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
      o[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
      o[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
      return o;
    },

    /** 法线矩阵 = 模型矩阵逆转置的前 3x3，塞回 mat4（着色器按 mat3 用 uniformMatrix3fv 也行，这里给 mat4 简化） */
    normalMatrix: function (m) {
      var inv = M4.invert(m);
      // 逆转置：把逆矩阵左上 3x3 转置后写进 4x4
      return new Float32Array([
        inv[0], inv[4], inv[8], 0,
        inv[1], inv[5], inv[9], 0,
        inv[2], inv[6], inv[10], 0,
        0, 0, 0, 1
      ]);
    },

    transformPoint: function (m, p) {
      var x = p[0], y = p[1], z = p[2];
      var w = m[3] * x + m[7] * y + m[11] * z + m[15] || 1;
      return [
        (m[0] * x + m[4] * y + m[8] * z + m[12]) / w,
        (m[1] * x + m[5] * y + m[9] * z + m[13]) / w,
        (m[2] * x + m[6] * y + m[10] * z + m[14]) / w
      ];
    }
  };

  /* ==================== GL 上下文 ==================== */

  /** 拿 WebGL2 上下文；拿不到给一句人话（Safari 旧版 / 虚拟机 / 被策略禁用） */
  function getContext(canvas, opts) {
    opts = opts || {};
    var names = ['webgl2', 'webgl', 'experimental-webgl'];
    for (var i = 0; i < names.length; i++) {
      try {
        var g = canvas.getContext(names[i], Object.assign({
          antialias: true, alpha: false, depth: true, preserveDrawingBuffer: !!opts.preserve
        }, opts.contextAttributes || {}));
        if (g) return g;
      } catch (e) { /* 试下一个 */ }
    }
    throw new Error(
      '这个浏览器/环境拿不到 WebGL 上下文（试过 ' + names.join('、') + '）。' +
      '换 Chrome / Edge，或在设置里打开「使用硬件加速」。'
    );
  }

  /* ==================== 着色器 ==================== */

  /** 编译失败时把出错行连同上下文一起抛出来 —— GLSL 只报行号，不看代码没法查 */
  function compileShader(gl, type, src, label) {
    var sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      var log = gl.getShaderInfoLog(sh) || '';
      var lines = src.split('\n');
      var m = /(\d+):(\d+)/.exec(log);
      var out = '着色器编译失败（' + label + '）：\n' + log.trim();
      if (m) {
        var ln = parseInt(m[2], 10);
        var from = Math.max(1, ln - 3), to = Math.min(lines.length, ln + 3);
        var ctxLines = [];
        for (var i = from; i <= to; i++) {
          ctxLines.push((i === ln ? '▶ ' : '  ') + i + ' | ' + lines[i - 1]);
        }
        out += '\n—— 出错位置 ——\n' + ctxLines.join('\n');
      }
      gl.deleteShader(sh);
      throw new Error(out);
    }
    return sh;
  }

  function createProgram(gl, vsSrc, fsSrc, label) {
    var vs = compileShader(gl, gl.VERTEX_SHADER, vsSrc, (label || 'program') + '.vert');
    var fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSrc, (label || 'program') + '.frag');
    var p = gl.createProgram();
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.bindAttribLocation(p, 0, 'aPos');
    gl.bindAttribLocation(p, 1, 'aNormal');
    gl.bindAttribLocation(p, 2, 'aColor');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      var log = gl.getProgramInfoLog(p);
      throw new Error('着色器链接失败（' + label + '）：' + log);
    }
    gl.deleteShader(vs); gl.deleteShader(fs);
    return p;
  }

  /* ==================== 网格 ==================== */

  /** STRIDE = 9（pos3 + nrm3 + col3） */
  var STRIDE = 9;

  /** geo = {pos:[], nrm:[], col:[], idx:[]} → GPU buffer（可复用已有 glMesh） */
  function upload(gl, geo) {
    var n = geo.pos.length / 3;
    var data = new Float32Array(n * STRIDE);
    for (var i = 0; i < n; i++) {
      data[i * STRIDE] = geo.pos[i * 3];
      data[i * STRIDE + 1] = geo.pos[i * 3 + 1];
      data[i * STRIDE + 2] = geo.pos[i * 3 + 2];
      data[i * STRIDE + 3] = geo.nrm[i * 3];
      data[i * STRIDE + 4] = geo.nrm[i * 3 + 1];
      data[i * STRIDE + 5] = geo.nrm[i * 3 + 2];
      data[i * STRIDE + 6] = geo.col[i * 3];
      data[i * STRIDE + 7] = geo.col[i * 3 + 1];
      data[i * STRIDE + 8] = geo.col[i * 3 + 2];
    }
    var vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    var vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    var bytes = STRIDE * 4;
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, bytes, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, bytes, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 3, gl.FLOAT, false, bytes, 24);
    var ibo = gl.createBuffer();
    var use32 = n > 65535;
    var idx = use32 ? new Uint32Array(geo.idx) : new Uint16Array(geo.idx);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    return { vao: vao, count: geo.idx.length, type: use32 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT, tris: geo.idx.length / 3 };
  }

  function drawMesh(gl, m) {
    if (!m || !m.count) return;
    gl.bindVertexArray(m.vao);
    gl.drawElements(gl.TRIANGLES, m.count, m.type, 0);
  }

  function disposeMesh(gl, m) {
    if (!m) return;
    gl.deleteVertexArray(m.vao);
  }

  /* ==================== 帧缓冲（后期用） ==================== */

  function createTarget(gl, w, h, opts) {
    opts = opts || {};
    w = Math.max(1, w | 0); h = Math.max(1, h | 0);
    var tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    var internal = opts.float ? gl.RGBA16F : gl.RGBA8;
    var type = opts.float ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE;
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, gl.RGBA, type, null);
    var filter = opts.nearest ? gl.NEAREST : gl.LINEAR;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    var fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    var depth = null;
    if (opts.depth !== false) {
      depth = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
    }
    var ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { fbo: fbo, tex: tex, depth: depth, w: w, h: h, ok: ok };
  }

  /** 离屏目标的全屏三角形（比 quad 少一个三角形，还省掉对角线接缝） */
  function createFullscreen(gl) {
    var vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    var vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    return vao;
  }

  FS.gl = {
    M4: M4,
    STRIDE: STRIDE,
    getContext: getContext,
    createProgram: createProgram,
    compileShader: compileShader,
    upload: upload,
    drawMesh: drawMesh,
    disposeMesh: disposeMesh,
    createTarget: createTarget,
    createFullscreen: createFullscreen
  };
})(typeof window !== 'undefined' ? window : this);
