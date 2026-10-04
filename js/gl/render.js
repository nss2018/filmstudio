/* render.js —— WebGL2 渲染器：把 storyboard 逐帧画出来
 *
 * 为什么分两个 canvas：
 *   gl  = WebGL 画场景（几何/光照/雾/辉光）
 *   out = 2D 画字幕与题头，再由 drawTo() 把两者合成到一张 2D canvas 上
 *   → 这样现有的 `stage.captureStream()` + MediaRecorder 导出链路**一行都不用改**，
 *     录出来的就是带 3D 画面 + 字幕的成品。
 *
 * 光照：4 盏点光的半兰伯特 + 边缘光 + 线性雾 + 色调分级（time/grade）。
 * 后期：阈值提取 → 高斯模糊 → 叠加（辉光），让 glow 桶真的发光。
 * 全程无外部依赖，shader 编译失败会把出错行连上下文一起抛出（见 core.js）。
 */
(function (root) {
  'use strict';
  var FS = (root.FS = root.FS || {});
  var GLC = FS.gl;

  /* ==================== shader ==================== */

  var VS_MAIN = [
    '#version 300 es',
    'in vec3 aPos; in vec3 aNormal; in vec3 aColor;',
    'uniform mat4 uProj, uView, uModel, uNormalMat;',
    'out vec3 vNormal, vColor, vWorld;',
    'void main(){',
    '  vec4 wp = uModel * vec4(aPos, 1.0);',
    '  vWorld = wp.xyz;',
    '  vNormal = mat3(uNormalMat) * aNormal;',
    '  vColor = aColor;',
    '  gl_Position = uProj * uView * wp;',
    '}'
  ].join('\n');

  var FS_MAIN = [
    '#version 300 es',
    'precision highp float;',
    'in vec3 vNormal, vColor, vWorld;',
    'uniform vec3 uLightPos[4];',
    'uniform vec3 uLightColor[4];',
    'uniform float uLightCount;',
    'uniform vec3 uAmbient, uFogColor, uCamPos, uTint;',
    'uniform float uFogNear, uFogFar, uEmissive, uTime, uWave, uAlpha;',
    'out vec4 frag;',
    'void main(){',
    '  vec3 N = normalize(vNormal);',
    '  vec3 V = normalize(uCamPos - vWorld);',
    '  vec3 col = vColor * uAmbient;',
    '  for (int i = 0; i < 4; i++) {',
    '    if (float(i) >= uLightCount) break;',
    '    vec3 Lp = uLightPos[i] - vWorld;',
    '    float dist = length(Lp);',
    '    vec3 L = Lp / max(dist, 0.001);',
    '    float atten = 1.0 / (1.0 + 0.10 * dist + 0.03 * dist * dist);',
    '    float diff = max(dot(N, L), 0.0);',
    '    float wrap = max(dot(N, L) * 0.5 + 0.5, 0.0);',
    '    col += vColor * uLightColor[i] * (diff * 0.72 + wrap * 0.28) * atten;',
    '    float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0);',
    '    col += uLightColor[i] * rim * 0.14;',
    '  }',
    '  if (uWave > 0.5) {',
    '    float w = sin(vWorld.x * 1.6 + uTime * 1.5) * 0.5 + sin(vWorld.z * 2.1 - uTime * 1.05) * 0.5;',
    '    col += vec3(0.10, 0.17, 0.22) * max(w, 0.0);',
    '    float spec = pow(max(w, 0.0), 6.0) * 0.5;',
    '    col += vec3(1.0, 0.95, 0.85) * spec;',
    '  }',
    '  float d = length(uCamPos - vWorld);',
    '  float f = clamp((d - uFogNear) / max(uFogFar - uFogNear, 0.001), 0.0, 1.0);',
    '  col = mix(col, uFogColor, f * f);',
    '  col *= uTint;',
    '  col = mix(col, vColor * 1.15, uEmissive);',
    '  frag = vec4(col, uAlpha);',
    '}'
  ].join('\n');

  var VS_FULL = [
    '#version 300 es',
    'in vec2 aPos;',
    'out vec2 vUv;',
    'void main(){ vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }'
  ].join('\n');

  var FS_SKY = [
    '#version 300 es',
    'precision highp float;',
    'in vec2 vUv;',
    'uniform vec3 uTop, uBottom;',
    'out vec4 frag;',
    'void main(){ frag = vec4(mix(uBottom, uTop, pow(vUv.y, 0.85)), 1.0); }'
  ].join('\n');

  var FS_BRIGHT = [
    '#version 300 es',
    'precision highp float;',
    'in vec2 vUv;',
    'uniform sampler2D uTex; uniform float uThreshold;',
    'out vec4 frag;',
    'void main(){',
    '  vec3 c = texture(uTex, vUv).rgb;',
    '  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));',
    '  float k = max(l - uThreshold, 0.0) / max(l, 0.001);',
    '  frag = vec4(c * k, 1.0);',
    '}'
  ].join('\n');

  var FS_BLUR = [
    '#version 300 es',
    'precision highp float;',
    'in vec2 vUv;',
    'uniform sampler2D uTex; uniform vec2 uDir;',
    'out vec4 frag;',
    'void main(){',
    '  vec3 s = texture(uTex, vUv).rgb * 0.227;',
    '  s += (texture(uTex, vUv + uDir * 1.3846).rgb + texture(uTex, vUv - uDir * 1.3846).rgb) * 0.316;',
    '  s += (texture(uTex, vUv + uDir * 3.2308).rgb + texture(uTex, vUv - uDir * 3.2308).rgb) * 0.070;',
    '  frag = vec4(s, 1.0);',
    '}'
  ].join('\n');

  var FS_MIX = [
    '#version 300 es',
    'precision highp float;',
    'in vec2 vUv;',
    'uniform sampler2D uTex, uBloom; uniform float uAmount;',
    'out vec4 frag;',
    'void main(){',
    '  vec3 c = texture(uTex, vUv).rgb;',
    '  c += texture(uBloom, vUv).rgb * uAmount;',
    '  // 轻微暗角，把注意力收到中间',
    '  vec2 q = vUv - 0.5;',
    '  c *= 1.0 - dot(q, q) * 0.42;',
    '  frag = vec4(c, 1.0);',
    '}'
  ].join('\n');

  /* ==================== 渲染器 ==================== */

  function create(canvas, out2d) {
    var gl = GLC.getContext(canvas, { preserve: true });
    var W = canvas.width, H = canvas.height;
    var out = out2d || null;

    var progMain = GLC.createProgram(gl, VS_MAIN, FS_MAIN, 'main');
    var progSky = GLC.createProgram(gl, VS_FULL, FS_SKY, 'sky');
    var progBright = GLC.createProgram(gl, VS_FULL, FS_BRIGHT, 'bright');
    var progBlur = GLC.createProgram(gl, VS_FULL, FS_BLUR, 'blur');
    var progMix = GLC.createProgram(gl, VS_FULL, FS_MIX, 'mix');

    var fsVao = GLC.createFullscreen(gl);
    var rtScene = GLC.createTarget(gl, W, H, { depth: true });
    var rtA = GLC.createTarget(gl, W >> 1, H >> 1, { depth: false });
    var rtB = GLC.createTarget(gl, W >> 1, H >> 1, { depth: false });

    // uniform 位置缓存
    function uloc(p, names) {
      var o = {};
      names.forEach(function (n) { o[n] = gl.getUniformLocation(p, n); });
      return o;
    }
    var uMain = uloc(progMain, ['uProj', 'uView', 'uModel', 'uNormalMat', 'uLightPos[0]', 'uLightColor[0]',
      'uLightCount', 'uAmbient', 'uFogColor', 'uCamPos', 'uTint', 'uFogNear', 'uFogFar', 'uEmissive', 'uTime', 'uWave', 'uAlpha']);
    var uSky = uloc(progSky, ['uTop', 'uBottom']);
    var uBright = uloc(progBright, ['uTex', 'uThreshold']);
    var uBlur = uloc(progBlur, ['uTex', 'uDir']);
    var uMix = uloc(progMix, ['uTex', 'uBloom', 'uAmount']);

    var M4 = GLC.M4;

    /* ---------- 资源缓存：同一地点只烘焙一次 ---------- */
    var placeCache = {};
    function placeMesh(placeId, seed) {
      var key = placeId + '#' + seed;
      if (placeCache[key]) return placeCache[key];
      // 每个地点用固定种子 → 每次打开同一场景布局一致（可复现），但不同地点各不相同
      var rng = FS.director.mkRng(FS.director.fnv(placeId) ^ 0x9e37);
      var b = FS.world.buildPlace(placeId, rng.f);
      var m = {
        info: b,
        solid: b.solid && b.solid.idx.length ? GLC.upload(gl, b.solid) : null,
        water: b.water && b.water.idx.length ? GLC.upload(gl, b.water) : null,
        glow: b.glow && b.glow.idx.length ? GLC.upload(gl, b.glow) : null
      };
      placeCache[key] = m;
      return m;
    }
    var castCache = {};
    function castMesh(castId, seed) {
      var key = castId + '#' + seed;
      if (castCache[key]) return castCache[key];
      var rng = FS.director.mkRng(FS.director.fnv(castId) ^ 0x85eb);
      var inst = FS.cast.instantiate(castId, rng.f, 'a');
      if (!inst) return null;
      var parts = inst.parts.map(function (p) { return GLC.upload(gl, p.geo); });
      var c = { inst: inst, meshes: parts };
      castCache[key] = c;
      return c;
    }

    /* ---------- 一帧 ---------- */
    var subOn = true;                      // 字幕开关（setSubtitles 改它）
    var engine = {
      gl: gl,
      storyboard: null,
      lastInfo: null,

      setStoryboard: function (sb) { engine.storyboard = sb; },
      setSubtitles: function (on) { subOn = !!on; },

      /** 渲染 t 秒那一帧到 GL canvas，并（可选）合成到 2D canvas */
      draw: function (t) { return engine.drawAt(t, out ? out.ctx : null); },

      /** 同上，但这次指定合成目标（导出逐帧、自检页都要用） */
      drawAt: function (t, outCtx) {
        var sb = engine.storyboard;
        if (!sb || !sb.shots || !sb.shots.length) { engine.clear(); return null; }
        var total = sb.totalSec || 1;
        if (t < 0) t = 0;
        if (t > total) t = total - 0.001;

        // ① 找当前段
        var idx = 0, acc = 0;
        for (var i = 0; i < sb.shots.length; i++) {
          if (t >= acc && t < acc + sb.shots[i].durationSec) { idx = i; break; }
          acc += sb.shots[i].durationSec;
          if (i === sb.shots.length - 1) idx = i;
        }
        var shot = sb.shots[idx];
        var local = Math.max(0, Math.min(1, (t - acc) / shot.durationSec));
        var abs = t;

        // ② 镜头
        var cam = FS.camera.evalShot(shot.shot, local, abs);
        var proj = M4.perspective(cam.fov * Math.PI / 180, W / H, 0.1, 220);
        var view = M4.lookAt(cam.eye, cam.target, [0, 1, 0]);

        var pm = placeMesh(shot.place, sb.seed);
        if (!pm) { engine.clear(); return null; }
        var info = pm.info;
        var grade = shot.grade || FS.director.GRADE.day;

        // ③ 离屏画场景
        gl.bindFramebuffer(gl.FRAMEBUFFER, rtScene.fbo);
        gl.viewport(0, 0, rtScene.w, rtScene.h);
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

        // 天空
        gl.disable(gl.DEPTH_TEST);
        gl.useProgram(progSky);
        gl.uniform3fv(uSky.uTop, FS.geom.color(info.sky.top));
        gl.uniform3fv(uSky.uBottom, FS.geom.color(info.sky.bottom));
        gl.bindVertexArray(fsVao);
        gl.drawArrays(gl.TRIANGLES, 0, 3);

        // 场景
        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LEQUAL);
        gl.enable(gl.CULL_FACE);
        gl.cullFace(gl.BACK);
        gl.useProgram(progMain);
        gl.uniformMatrix4fv(uMain.uProj, false, proj);
        gl.uniformMatrix4fv(uMain.uView, false, view);
        gl.uniform1f(uMain.uTime, abs);
        gl.uniform3fv(uMain.uCamPos, cam.eye);
        gl.uniform3fv(uMain.uAmbient, [
          (info.indoor ? 0.30 : 0.42) * grade.lightMul,
          (info.indoor ? 0.32 : 0.44) * grade.lightMul,
          (info.indoor ? 0.38 : 0.50) * grade.lightMul
        ]);
        var fog = FS.geom.color(info.fog.color);
        gl.uniform3fv(uMain.uFogColor, [
          fog[0] * grade.fogMul * grade.tint[0], fog[1] * grade.fogMul * grade.tint[1], fog[2] * grade.fogMul * grade.tint[2]
        ]);
        gl.uniform1f(uMain.uFogNear, info.fog.near * grade.fogMul);
        gl.uniform1f(uMain.uFogFar, info.fog.far * grade.fogMul);
        gl.uniform3fv(uMain.uTint, grade.tint);
        gl.uniform1f(uMain.uAlpha, 1);

        // 灯光（最多 4 盏，取最亮的）
        var lights = (info.lights || []).slice().sort(function (a, b) { return b.intensity - a.intensity; }).slice(0, 4);
        var lp = new Float32Array(12), lc = new Float32Array(12);
        lights.forEach(function (L, k) {
          lp[k * 3] = L.pos[0]; lp[k * 3 + 1] = L.pos[1]; lp[k * 3 + 2] = L.pos[2];
          var c = FS.geom.color(L.color);
          var it = L.intensity * grade.lightMul;
          lc[k * 3] = c[0] * it; lc[k * 3 + 1] = c[1] * it; lc[k * 3 + 2] = c[2] * it;
        });
        gl.uniform3fv(uMain['uLightPos[0]'], lp);
        gl.uniform3fv(uMain['uLightColor[0]'], lc);
        gl.uniform1f(uMain.uLightCount, lights.length);

        // 静态几何
        var model = M4.fromTRS([0, 0, 0], [0, 0, 0], [1, 1, 1]);
        gl.uniformMatrix4fv(uMain.uModel, false, model);
        gl.uniformMatrix4fv(uMain.uNormalMat, false, M4.normalMatrix(model));
        gl.uniform1f(uMain.uWave, 0);
        gl.uniform1f(uMain.uEmissive, 0);
        if (pm.solid) GLC.drawMesh(gl, pm.solid);

        // 水（带波纹）
        if (pm.water) {
          gl.uniform1f(uMain.uWave, 1);
          gl.disable(gl.CULL_FACE);                 // 水面从下面也能看
          GLC.drawMesh(gl, pm.water);
          gl.enable(gl.CULL_FACE);
          gl.uniform1f(uMain.uWave, 0);
        }

        // 角色
        drawCast(shot, abs, local, cam, grade, proj, view);

        // 发光体（自发光，画在最后不受光）
        if (pm.glow) {
          gl.uniform1f(uMain.uEmissive, 1);
          GLC.drawMesh(gl, pm.glow);
          gl.uniform1f(uMain.uEmissive, 0);
        }

        // ④ 辉光后期
        gl.disable(gl.DEPTH_TEST);
        gl.disable(gl.CULL_FACE);
        var bloomOn = rtScene.ok && rtA.ok && rtB.ok;
        if (bloomOn) {
          gl.bindFramebuffer(gl.FRAMEBUFFER, rtA.fbo);
          gl.viewport(0, 0, rtA.w, rtA.h);
          gl.useProgram(progBright);
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, rtScene.tex);
          gl.uniform1i(uBright.uTex, 0);
          gl.uniform1f(uBright.uThreshold, 0.62);
          gl.bindVertexArray(fsVao);
          gl.drawArrays(gl.TRIANGLES, 0, 3);

          gl.useProgram(progBlur);
          gl.bindFramebuffer(gl.FRAMEBUFFER, rtB.fbo);
          gl.uniform1i(uBlur.uTex, 0);
          gl.bindTexture(gl.TEXTURE_2D, rtA.tex);
          gl.uniform2f(uBlur.uDir, 1 / rtA.w, 0);
          gl.drawArrays(gl.TRIANGLES, 0, 3);

          gl.bindFramebuffer(gl.FRAMEBUFFER, rtA.fbo);
          gl.bindTexture(gl.TEXTURE_2D, rtB.tex);
          gl.uniform2f(uBlur.uDir, 0, 1 / rtA.h);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
        }

        // 合成到屏幕
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, W, H);
        gl.useProgram(progMix);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, rtScene.tex);
        gl.uniform1i(uMix.uTex, 0);
        if (bloomOn) {
          gl.activeTexture(gl.TEXTURE1);
          gl.bindTexture(gl.TEXTURE_2D, rtA.tex);
          gl.uniform1i(uMix.uBloom, 1);
          gl.uniform1f(uMix.uAmount, 0.75);
        } else {
          gl.uniform1f(uMix.uAmount, 0);
        }
        gl.bindVertexArray(fsVao);
        gl.drawArrays(gl.TRIANGLES, 0, 3);

        var info2 = {
          shotIndex: idx, place: shot.place, placeName: info.name,
          shotType: shot.shot.type, mood: grade.mood,
          cast: shot.cast.map(function (c) { return c.id + ':' + c.action; }),
          eye: cam.eye, target: cam.target, fov: cam.fov,
          progress: local, bloom: bloomOn
        };
        engine.lastInfo = info2;
        if (outCtx) {
          outCtx.drawImage(canvas, 0, 0, outCtx.canvas.width, outCtx.canvas.height);
          drawOverlay(outCtx, sb, shot, local, t, info2, subOn);
        }
        return info2;
      },

      clear: function () {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, W, H);
        gl.clearColor(0.04, 0.05, 0.07, 1);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      },

      resize: function (w, h) {
        W = canvas.width = w; H = canvas.height = h;
        [rtScene, rtA, rtB].forEach(function (rt) {
          if (rt.fbo) { gl.deleteFramebuffer(rt.fbo); gl.deleteTexture(rt.tex); if (rt.depth) gl.deleteRenderbuffer(rt.depth); }
        });
        rtScene = GLC.createTarget(gl, W, H, { depth: true });
        rtA = GLC.createTarget(gl, W >> 1, H >> 1, { depth: false });
        rtB = GLC.createTarget(gl, W >> 1, H >> 1, { depth: false });
      },

      /** 统计信息，给 UI 显示 */
      stats: function () {
        var keys = Object.keys(placeCache), ckeys = Object.keys(castCache);
        var tris = 0;
        keys.forEach(function (k) {
          var m = placeCache[k];
          if (m.solid) tris += m.solid.tris;
          if (m.water) tris += m.water.tris;
          if (m.glow) tris += m.glow.tris;
        });
        return { places: keys.length, casts: ckeys.length, tris: tris, bloom: rtScene.ok && rtA.ok };
      },

      /** 能力自检，给页面底部的环境自检用 */
      probe: function () {
        return {
          webgl2: (typeof WebGL2RenderingContext !== 'undefined') && gl instanceof WebGL2RenderingContext,
          renderer: 'WebGL',
          framebuffer: rtScene.ok,
          bloom: rtScene.ok && rtA.ok && rtB.ok
        };
      }
    };

    /* ---------- 角色绘制 ---------- */
    function drawCast(shot, abs, local, cam, grade, proj, view) {
      for (var k = 0; k < shot.cast.length; k++) {
        var c = shot.cast[k];
        var cm = castMesh(c.id, shot.place);
        if (!cm) continue;
        // 走位：动作进度在这段里的插值
        var p = smooth(local);
        var x = c.from[0] + (c.to[0] - c.from[0]) * p;
        var z = c.from[2] + (c.to[2] - c.from[2]) * p;
        // 朝向：走位方向（原地动作就朝着镜头）
        var dx = c.to[0] - c.from[0], dz = c.to[2] - c.from[2];
        var moving = Math.abs(dx) + Math.abs(dz) > 0.05;
        var yaw = moving ? Math.atan2(dx, dz) : Math.atan2(cam.eye[0] - x, cam.eye[2] - z);
        var world = { x: x, y: 0, z: z, yaw: yaw };

        var parts = FS.cast.pose(cm.inst, c.action, abs + c.id.charCodeAt(0) * 0.37, world, 1);
        var cy = Math.cos(yaw), sy = Math.sin(yaw);

        for (var i = 0; i < parts.length; i++) {
          var part = parts[i];
          var mesh = cm.meshes[i];
          if (!mesh) continue;
          // 局部 → 世界：先绕自身 pivot 转，再整体偏转 yaw，最后平移
          var lp = part.pos, pv = part.pivot || [0, 0, 0];
          var rx = lp[0] - pv[0], ry = lp[1] - pv[1], rz = lp[2] - pv[2];
          var m = M4.fromTRS([pv[0], pv[1], pv[2]], part.rot, part.scale || [1, 1, 1]);
          // 角色整体旋转 + 平移
          var wx = x + (m[0] * rx + m[4] * ry + m[8] * rz + m[12]) * cy + (m[2] * rx + m[6] * ry + m[10] * rz + m[14]) * sy;
          var wy = (m[1] * rx + m[5] * ry + m[9] * rz + m[13]);
          var wz = z - (m[0] * rx + m[4] * ry + m[8] * rz + m[12]) * sy + (m[2] * rx + m[6] * ry + m[10] * rz + m[14]) * cy;
          var full = M4.fromTRS([wx, wy, wz], [0, yaw, 0], [1, 1, 1]);
          gl.uniformMatrix4fv(uMain.uModel, false, full);
          gl.uniformMatrix4fv(uMain.uNormalMat, false, M4.normalMatrix(full));
          GLC.drawMesh(gl, mesh);
        }
      }
    }

    function smooth(t) { return t * t * (3 - 2 * t); }

    return engine;
  }

  /* ==================== 字幕 / 题头（2D 叠加） ==================== */

  function drawOverlay(ctx, sb, shot, local, t, info, subOn) {
    var W = ctx.canvas.width, H = ctx.canvas.height;
    var k = W / 1280;                                   // 按 1280 基准缩放
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';

    if (subOn !== false) {
      // 段标题（左上）
      if (shot.title) {
        ctx.globalAlpha = Math.min(1, local * 6) * 0.92;
        ctx.fillStyle = '#ffffff';
        ctx.font = '600 ' + Math.round(30 * k) + 'px -apple-system,"PingFang SC",sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(shot.title, 56 * k, 76 * k);
        ctx.textAlign = 'center';
      }
      // 字幕（底部）
      if (shot.text) {
        var fade = Math.min(1, local * 5) * Math.min(1, (1 - local) * 8 + 0.15);
        ctx.globalAlpha = Math.max(0, Math.min(1, fade));
        var size = Math.round(34 * k);
        ctx.font = '400 ' + size + 'px -apple-system,"PingFang SC",sans-serif';
        var lines = wrap(ctx, shot.text, W - 300 * k);
        if (lines.length > 2) {                          // 长了自动缩号
          size = Math.round(size * 0.82);
          ctx.font = '400 ' + size + 'px -apple-system,"PingFang SC",sans-serif';
          lines = wrap(ctx, shot.text, W - 260 * k);
        }
        ctx.fillStyle = 'rgba(0,0,0,.42)';
        var bh = lines.length * size * 1.5;
        ctx.fillRect(W * 0.5 - (W - 200 * k) / 2, H - 118 * k - bh + size * 0.3, W - 200 * k, bh);
        ctx.fillStyle = '#f2f6fb';
        for (var i = 0; i < lines.length; i++) {
          ctx.fillText(lines[i], W / 2, H - 118 * k - bh + size * (1.15 + i * 1.5));
        }
      }
    }

    // 进度线
    var prog = Math.max(0, Math.min(1, t / (sb.totalSec || 1)));
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = 'rgba(255,255,255,.25)';
    ctx.fillRect(0, H - 4 * k, W, 4 * k);
    ctx.fillStyle = '#4dd0c7';
    ctx.fillRect(0, H - 4 * k, W * prog, 4 * k);
    ctx.restore();
  }

  function wrap(ctx, text, maxW) {
    var out = [], line = '';
    for (var i = 0; i < text.length; i++) {
      var test = line + text[i];
      if (ctx.measureText(test).width > maxW && line) { out.push(line); line = text[i]; }
      else line = test;
    }
    if (line) out.push(line);
    return out;
  }

  FS.render3d = {
    create: create,
    wrap: wrap
  };
})(typeof window !== 'undefined' ? window : this);
