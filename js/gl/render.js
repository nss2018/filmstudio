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

  /* ---------------- 描边（线框）专用着色器 ----------------
   * 为什么不给线单独一套光照：线框风格的视觉重心是「轮廓的干净」，
   * 不是「体积感」。所以线只吃两个东西 —— 顶色 + 距离雾（远线淡出、近线实），
   * 再叠一个随时间缓慢流动的微光 uPulse，让画面在只有线的时候也不死。
   * 顶点格式跟三角面一样（aPos/aNormal/aColor），upload() 可以直接复用。 */
  var VS_LINE = [
    '#version 300 es',
    'in vec3 aPos; in vec3 aNormal; in vec3 aColor;',
    'uniform mat4 uProj, uView, uModel;',
    'out vec3 vColor, vWorld;',
    'void main(){',
    '  vec4 wp = uModel * vec4(aPos, 1.0);',
    '  vWorld = wp.xyz;',
    '  vColor = aColor;',
    '  gl_Position = uProj * uView * wp;',
    '}'
  ].join('\n');

  var FS_LINE = [
    '#version 300 es',
    'precision highp float;',
    'in vec3 vColor, vWorld;',
    'uniform vec3 uCamPos, uTint, uLineColor;',
    'uniform float uFogNear, uFogFar, uAlpha, uTime, uPulse, uLineMix, uFill;',
    'out vec4 frag;',
    'void main(){',
    // uFill=1 → 这是「消隐用的暗面」：不上色、不算光，只写深度。
    //   纯线框如果真的一个面都不画，深度缓冲是空的 → 所有背面的边都透出来，
    //   画面变成一团毛线（实测出图确认过）。所以线框档仍然画一遍面，
    //   但走的是这个「只写深度」的极简分支 —— 没有任何点光/法线/半兰伯特计算，
    //   这才是「轻量」的来源（省的是光照，不是深度）。
    '  if (uFill > 0.5) { frag = vec4(0.0, 0.0, 0.0, 1.0); return; }',
    // uLineMix=0 → 用物体本色；1 → 统一成 uLineColor（更「图纸」）
    '  vec3 base = mix(vColor, uLineColor, uLineMix);',
    // 沿世界坐标做一点缓慢起伏，让线面呼吸（振幅很小，只在暗处看得出）
    '  float w = sin(vWorld.x * 0.9 + uTime * 0.7) * 0.5 + sin(vWorld.y * 1.3 - uTime * 0.5) * 0.5;',
    '  vec3 col = base * (1.0 + w * 0.10 * uPulse);',
    '  float d = length(uCamPos - vWorld);',
    '  float f = clamp((d - uFogNear) / max(uFogFar - uFogNear, 0.001), 0.0, 1.0);',
    // 远线淡出而不是被雾色吃掉 —— 线框画面里雾色会把轮廓糊成一坨
    '  col *= (1.0 - f * 0.72);',
    '  col *= uTint;',
    '  frag = vec4(col, uAlpha * (1.0 - f * 0.45));',
    '}'
  ].join('\n');

  var VS_FULL = [    '#version 300 es',
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
    // 全屏线性渐变在深色背景下编码成 H.264 会出现色带（hyperframes 明确警告过这点），
    // 加一点屏幕空间抖动把色带打碎，成本几乎为零。
    'void main(){',
    '  vec3 c = mix(uBottom, uTop, pow(vUv.y, 0.85));',
    '  float d = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;',
    '  frag = vec4(c + d / 255.0, 1.0);',
    '}'
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
    var progLine = GLC.createProgram(gl, VS_LINE, FS_LINE, 'line');
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
    var uLine = uloc(progLine, ['uProj', 'uView', 'uModel', 'uCamPos', 'uTint', 'uLineColor',
      'uFogNear', 'uFogFar', 'uAlpha', 'uTime', 'uPulse', 'uLineMix', 'uFill']);
    var uSky = uloc(progSky, ['uTop', 'uBottom']);
    var uBright = uloc(progBright, ['uTex', 'uThreshold']);
    var uBlur = uloc(progBlur, ['uTex', 'uDir']);
    var uMix = uloc(progMix, ['uTex', 'uBloom', 'uAmount']);

    var M4 = GLC.M4;

    /* ---------- 资源缓存：同一地点只烘焙一次，但必须有上限 ----------
     * 借鉴 digiCreature_ios 的 boxCache 有界设计：那里是
     *   「if boxCache.count > 256 { boxCache.removeAll() }」+ NSLock。
     * GPU 显存不像内存，泄漏是实打实的：一直换场景会把纹理/缓冲堆满，
     * 最后整个 WebGL 上下文丢失（Safari 上尤其明显）。淘汰时必须
     * deleteVertexArray/deleteBuffer，光从 JS 对象里删是释放不了显存的
     * —— 所以淘汰逻辑抽到 js/gl/lru.js，能在 node 里直接测。
     */
    var PLACE_MAX = 6, CAST_MAX = 8;

    function disposeAll(m) {
      if (!m) return;
      GLC.disposeMesh(gl, m.solid);
      GLC.disposeMesh(gl, m.water);
      GLC.disposeMesh(gl, m.glow);
      GLC.disposeMesh(gl, m.line);          // 描边网格也要释放（显存不是 JS 对象）
      if (m.lines) m.lines.forEach(function (x) { GLC.disposeMesh(gl, x); });
      if (m.meshes) m.meshes.forEach(function (x) { GLC.disposeMesh(gl, x); });
    }

    var placeCache = FS.LRU(PLACE_MAX, function (k, m) { disposeAll(m); });
    var castCache = FS.LRU(CAST_MAX, function (k, m) { disposeAll(m); });

    /** 描边网格**懒建**：只有切到线框模式时才抽边。
     *  为什么不一次性建好：抽边是一次纯 CPU 的 O(三角形数) 遍历 + 哈希去重，
     *  20 个场景全建一遍在低端机上会明显卡一下；而大部分人一辈子只用实体模式。
     *  建过一次就缓存住（挂在 pm.line / cm.lines 上），来回切模式不再重算。 */
    function placeLines(m) {
      if (m.line !== undefined) return m.line;
      // creaseAngle 18°：剔掉「同一个平面内的三角化对角线」。
      // 不剔的话地板/墙面上全是交叉线（实测出图确认），像毛线不像线稿。
      var eg = FS.geom.placeEdges(m.info, { minLen: 0.004, creaseAngle: 18 });
      m.line = (eg && eg.idx.length) ? GLC.uploadLines(gl, eg) : null;
      return m.line;
    }

    function placeMesh(placeId, seed) {
      var key = placeId + '#' + seed;
      var got = placeCache.get(key);
      if (got) return got;
      // 每个地点用固定种子 → 每次打开同一场景布局一致（可复现），但不同地点各不相同
      var rng = FS.director.mkRng(FS.director.fnv(placeId) ^ 0x9e37);
      var b = FS.world.buildPlace(placeId, rng.f);
      return placeCache.set(key, {
        info: b,
        solid: b.solid && b.solid.idx.length ? GLC.upload(gl, b.solid) : null,
        water: b.water && b.water.idx.length ? GLC.upload(gl, b.water) : null,
        glow: b.glow && b.glow.idx.length ? GLC.upload(gl, b.glow) : null
      });
    }
    function castMesh(castId, seed) {
      var key = castId + '#' + seed;
      var got = castCache.get(key);
      if (got) return got;
      var rng = FS.director.mkRng(FS.director.fnv(castId) ^ 0x85eb);
      var inst = FS.cast.instantiate(castId, rng.f, 'a');
      if (!inst) return null;
      var parts = inst.parts.map(function (p) { return GLC.upload(gl, p.geo); });
      // 原始 geo 留着：描边要**懒建**（只切线框时才抽边），而抽边必须从 geo 出发，
      // 已上传的 mesh 里拿不回顶点数组了。
      return castCache.set(key, { inst: inst, meshes: parts, geos: inst.parts.map(function (p) { return p.geo; }) });
    }

    /** 角色描边：每个部件一条线网格，按需建、建过就缓存 */
    function castLines(m) {
      if (m.lines) return m.lines;
      m.lines = (m.geos || []).map(function (geo) {
        if (!geo || !geo.idx || !geo.idx.length) return null;
        var eg = FS.geom.edges(geo, { minLen: 0.004, creaseAngle: 18 });
        return eg.idx.length ? GLC.uploadLines(gl, eg) : null;
      });
      return m.lines;
    }

    /* ---------- 一帧 ---------- */
    var subOn = true;                      // 字幕开关（setSubtitles 改它）
    var style = 'solid';                   // 画质档：solid | line | both（setStyle 改它）
    var engine = {
      gl: gl,
      storyboard: null,
      lastInfo: null,
      lastError: null,   // 自检页读这个：GL 错误码 / 关键 uniform 是否为 null

      setStoryboard: function (sb) { engine.storyboard = sb; },
      setSubtitles: function (on) { subOn = !!on; },

      /** 切 3D 画质：'solid' 实体 / 'line' 纯线框 / 'both' 线框+实体。
       *  纯线框不是「把实体调暗」—— 是换一套着色器（不吃法线与点光，只吃
       *  顶色 + 距离雾 + 微光），所以画面更干净、也更快。 */
      setStyle: function (s) {
        style = (s === 'line' || s === 'both') ? s : 'solid';
        return style;
      },
      getStyle: function () { return style; },

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
        // 画质档分流
        var wantLine = (style === 'line' || style === 'both');
        if (style === 'both' && pm.solid) GLC.drawMesh(gl, pm.solid);   // 叠加档：实体打底
        if (pm.water && style !== 'line') {
          gl.uniform1f(uMain.uWave, 1);
          gl.disable(gl.CULL_FACE);
          GLC.drawMesh(gl, pm.water);
          gl.enable(gl.CULL_FACE);
          gl.uniform1f(uMain.uWave, 0);
        }

        // 角色（叠加档走实体；线框档的角色在下面画消隐暗面 + 描边）
        if (style !== 'line') drawCast(shot, abs, local, cam, grade, proj, view);
        if (pm.glow && style === 'both') {
          gl.uniform1f(uMain.uEmissive, 1);
          GLC.drawMesh(gl, pm.glow);
          gl.uniform1f(uMain.uEmissive, 0);
        }

        // 描边通道（线框档 / 叠加档）
        if (wantLine) {
          gl.useProgram(progLine);
          gl.uniformMatrix4fv(uLine.uProj, false, proj);
          gl.uniformMatrix4fv(uLine.uView, false, view);
          gl.uniform3fv(uLine.uCamPos, cam.eye);
          gl.uniform3fv(uLine.uTint, grade.tint);
          gl.uniform1f(uLine.uFogNear, info.fog.near * grade.fogMul);
          gl.uniform1f(uLine.uFogFar, info.fog.far * grade.fogMul);
          gl.uniform1f(uLine.uTime, abs);

          // ① 消隐暗面（仅线框档）：写深度但不上色。
          //    不做这一步的话深度缓冲是空的，背面的边全透出来 → 一团毛线。
          //    这层「面」用的是 progLine 的 uFill 分支，片元里直接 return，
          //    没有点光/法线/雾的任何计算 —— 省的正是这部分。
          if (style === 'line' && pm.solid) {
            gl.uniform1f(uLine.uFill, 1);
            gl.uniformMatrix4fv(uLine.uModel, false, model);
            GLC.drawMesh(gl, pm.solid);
            drawCastFill(shot, abs, local, cam);
            gl.uniform1f(uLine.uFill, 0);
          }

          // ② 描边本身
          gl.uniform1f(uLine.uPulse, style === 'line' ? 1 : 0.45);
          // 纯线框统一成冷白（更像图纸/技术插画）；叠加档保留物体本色做高亮边
          gl.uniform3fv(uLine.uLineColor, [0.82, 0.90, 1.0]);
          gl.uniform1f(uLine.uLineMix, style === 'line' ? 0.72 : 0.30);
          gl.uniform1f(uLine.uAlpha, style === 'line' ? 0.95 : 0.80);
          gl.disable(gl.CULL_FACE);          // 背面轮廓线也要画，否则转一圈就「缺边」
          gl.enable(gl.BLEND);
          gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
          gl.uniformMatrix4fv(uLine.uModel, false, model);
          GLC.drawLines(gl, placeLines(pm));
          drawCastLines(shot, abs, local, cam, proj);
          gl.disable(gl.BLEND);
          gl.enable(gl.CULL_FACE);
          gl.useProgram(progMain);           // 交回主程序，后面的实体/发光还要用它的 uniform
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
          progress: local, bloom: bloomOn, style: style
        };
        engine.lastInfo = info2;
        // 顺手抓 GL 错误：画面为空时这行能直接告诉我们是 shader/纹理/帧缓冲哪一步挂了
        var err = gl.getError();
        engine.lastError = {
          glError: err,
          glErrorName: err === 0 ? 'NO_ERROR' : (err === 0x0500 ? 'INVALID_ENUM' :
            err === 0x0501 ? 'INVALID_VALUE' : err === 0x0502 ? 'INVALID_OPERATION' :
            err === 0x0506 ? 'INVALID_FRAMEBUFFER_OPERATION' : ('0x' + err.toString(16))),
          uProj: !!uMain.uProj, uModel: !!uMain.uModel, uView: !!uMain.uView,
          uLightPos: !!uMain['uLightPos[0]'],
          program: !!progMain, framebuffer: rtScene.ok, tris: info2.tris,
          drewSolid: !!pm.solid, drewWater: !!pm.water, drewCast: shot.cast.length,
          // 线框档自检：这两个能直接回答「为什么线没出来」
          lineProgram: !!progLine, drewLine: wantLine ? !!placeLines(pm) : false, style: style
        };
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
        var ps = placeCache.stats(), cs = castCache.stats();
        var tris = 0, lines = 0;
        placeCache.forEach(function (m) {
          if (m.solid) tris += m.solid.tris;
          if (m.water) tris += m.water.tris;
          if (m.glow) tris += m.glow.tris;
          if (m.line) lines += m.line.tris;          // 描边按线段数报（tris 字段复用）
        });
        return {
          places: ps.size, casts: cs.size, tris: tris, lines: lines, style: style,
          bloom: rtScene.ok && rtA.ok,
          evicted: ps.evictions + cs.evictions, hits: ps.hits + cs.hits,
          placeMax: ps.limit, castMax: cs.limit
        };
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

    /* ---------- 角色绘制 ----------
     * ⚠️ 描边通道必须和实体通道**用同一份世界变换**，否则线框和实体会错位。
     *   所以把「局部 → 世界」那段算术抽成 partMatrix()，两条通道都调它 ——
     *   以前这段只有 drawCast 一处用，抽出来反而少了重复实现。 */
    function castPose(shot, abs, local, cam) {
      var out = [];
      for (var k = 0; k < shot.cast.length; k++) {
        var c = shot.cast[k];
        var cm = castMesh(c.id, shot.place);
        if (!cm) continue;
        var p = smooth(local);
        var x = c.from[0] + (c.to[0] - c.from[0]) * p;
        var z = c.from[2] + (c.to[2] - c.from[2]) * p;
        var dx = c.to[0] - c.from[0], dz = c.to[2] - c.from[2];
        var moving = Math.abs(dx) + Math.abs(dz) > 0.05;
        var yaw = moving ? Math.atan2(dx, dz) : Math.atan2(cam.eye[0] - x, cam.eye[2] - z);
        var world = { x: x, y: 0, z: z, yaw: yaw };
        var parts = FS.cast.pose(cm.inst, c.action, abs + c.id.charCodeAt(0) * 0.37, world, 1);
        var cy = Math.cos(yaw), sy = Math.sin(yaw);
        var mats = [];
        for (var i = 0; i < parts.length; i++) mats.push(partMatrix(parts[i], x, z, yaw, cy, sy));
        out.push({ cm: cm, parts: parts, mats: mats });
      }
      return out;
    }

    /** 单个部件的局部 → 世界矩阵（先绕自身 pivot 转，再整体偏转 yaw，最后平移） */
    function partMatrix(part, x, z, yaw, cy, sy) {
      var lp = part.pos, pv = part.pivot || [0, 0, 0];
      var rx = lp[0] - pv[0], ry = lp[1] - pv[1], rz = lp[2] - pv[2];
      var m = M4.fromTRS([pv[0], pv[1], pv[2]], part.rot, part.scale || [1, 1, 1]);
      var wx = x + (m[0] * rx + m[4] * ry + m[8] * rz + m[12]) * cy + (m[2] * rx + m[6] * ry + m[10] * rz + m[14]) * sy;
      var wy = (m[1] * rx + m[5] * ry + m[9] * rz + m[13]);
      var wz = z - (m[0] * rx + m[4] * ry + m[8] * rz + m[12]) * sy + (m[2] * rx + m[6] * ry + m[10] * rz + m[14]) * cy;
      return M4.fromTRS([wx, wy, wz], [0, yaw, 0], [1, 1, 1]);
    }

    function drawCast(shot, abs, local, cam, grade, proj, view) {
      void proj; void view; void grade;
      var posed = castPose(shot, abs, local, cam);
      for (var k = 0; k < posed.length; k++) {
        var cm = posed[k].cm, mats = posed[k].mats;
        for (var i = 0; i < mats.length; i++) {
          var mesh = cm.meshes[i];
          if (!mesh) continue;
          gl.uniformMatrix4fv(uMain.uModel, false, mats[i]);
          gl.uniformMatrix4fv(uMain.uNormalMat, false, M4.normalMatrix(mats[i]));
          GLC.drawMesh(gl, mesh);
        }
      }
    }

    /** 角色描边：与 drawCast 走同一份 castPose（错位风险从根上消除） */
    function drawCastLines(shot, abs, local, cam, proj) {
      void proj;
      var posed = castPose(shot, abs, local, cam);
      for (var k = 0; k < posed.length; k++) {
        var lines = castLines(posed[k].cm);
        for (var i = 0; i < posed[k].mats.length; i++) {
          if (!lines[i]) continue;
          gl.uniformMatrix4fv(uLine.uModel, false, posed[k].mats[i]);
          GLC.drawLines(gl, lines[i]);
        }
      }
    }

    /** 角色的消隐暗面（只写深度）。与描边共用 castPose，
     *  这样「挡住线的那层暗面」和「线」在同一个位置，不会出现线浮在面前。 */
    function drawCastFill(shot, abs, local, cam) {
      var posed = castPose(shot, abs, local, cam);
      for (var k = 0; k < posed.length; k++) {
        for (var i = 0; i < posed[k].mats.length; i++) {
          if (!posed[k].cm.meshes[i]) continue;
          gl.uniformMatrix4fv(uLine.uModel, false, posed[k].mats[i]);
          GLC.drawMesh(gl, posed[k].cm.meshes[i]);
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
