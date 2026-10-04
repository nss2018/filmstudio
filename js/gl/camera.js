/* camera.js —— 镜头脚本：导演写「推/摇/环绕/跟」，渲染器只管按进度求值
 *
 * 镜头是纯函数 eval(shot, p) -> {eye, target, fov, roll}，不用随机数，
 * 所以同一份分镜脚本每次渲染完全一致（导出视频才可复现）。
 */
(function (root) {
  'use strict';
  var FS = (root.FS = root.FS || {});

  /* ---------------- 缓动 ---------------- */
  var EASE = {
    linear: function (t) { return t; },
    inQuad: function (t) { return t * t; },
    outQuad: function (t) { return t * (2 - t); },
    inOutQuad: function (t) { return t < .5 ? 2 * t * t : -1 + (4 - 2 * t) * t; },
    outCubic: function (t) { return 1 - Math.pow(1 - t, 3); },
    inOutCubic: function (t) { return t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; },
    outQuint: function (t) { return 1 - Math.pow(1 - t, 5); },
    // 手持感：两个不同频率正弦叠加，幅度很小
    handheld: function (t) { return t + Math.sin(t * 11.3) * 0.006 + Math.sin(t * 4.7) * 0.004; }
  };

  function ease(name, t) {
    return (EASE[name] || EASE.inOutCubic)(t);
  }

  function lerp(a, b, t) { return a + (b - a) * t; }
  function lerp3(a, b, t) { return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]; }
  function clamp01(t) { return t < 0 ? 0 : t > 1 ? 1 : t; }

  /**
   * 求某一帧的镜头。
   * shot = {
   *   type: 'dolly_in'|'dolly_out'|'orbit'|'crane'|'pan'|'follow'|'static'|'push_orbit',
   *   from:[x,y,z], to:[x,y,z],        // 起点/终点（orbit 用 from 当半径起点）
   *   look:[x,y,z] | 'follow',         // 注视点
   *   target:[x,y,z],                  // orbit 的圆心
   *   fov: 起始视角(度), fovTo: 结束视角
   *   ease: 缓动名, roll: 画面横滚(度)
   * }
   * p = 0..1 进度；t = 绝对秒（给 handheld 用）
   */
  function evalShot(shot, p, t) {
    p = clamp01(p);
    var e = ease(shot.ease, p);
    var from = shot.from || [0, 2, 8];
    var to = shot.to || [0, 2, 5];
    var fov = shot.fov === undefined ? 42 : shot.fov;
    var fovTo = shot.fovTo === undefined ? fov : shot.fovTo;
    var out = { eye: [0, 0, 0], target: [0, 1, 0], fov: fov, roll: 0 };

    switch (shot.type) {
      case 'dolly_in':
      case 'dolly_out':
      case 'push_orbit': {
        var dir = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
        var d = Math.hypot(dir[0], dir[1], dir[2]) || 1;
        var k = shot.type === 'dolly_out' ? 1 - e : e;
        out.eye = [from[0] + dir[0] * k, from[1] + dir[1] * k, from[2] + dir[2] * k];
        if (shot.type === 'push_orbit') {
          // 推进的同时绕目标转半圈（左右各 15°，避免转到背面穿帮）
          var ang = (e - .5) * 0.52;
          var cx = shot.target ? shot.target[0] : 0;
          var cz = shot.target ? shot.target[2] : 0;
          var rx = out.eye[0] - cx, rz = out.eye[2] - cz;
          out.eye[0] = cx + rx * Math.cos(ang) - rz * Math.sin(ang);
          out.eye[2] = cz + rx * Math.sin(ang) + rz * Math.cos(ang);
        }
        out.target = shot.look && shot.look !== 'follow' ? shot.look.slice()
          : (shot.target ? shot.target.slice() : [0, 1.2, 0]);
        out.fov = lerp(fov, fovTo, e);
        break;
      }
      case 'orbit': {
        // from 当作「起始角度、起始半径」的约定：from=[angleDeg, radius, height]
        var a0 = (from[0] || 0) * Math.PI / 180, a1 = (to[0] || a0 + 30) * Math.PI / 180;
        var r0 = from[1] === undefined ? 7 : from[1];
        var r1 = to[1] === undefined ? r0 : to[1];
        var h0 = from[2] === undefined ? 2.4 : from[2];
        var h1 = to[2] === undefined ? h0 : to[2];
        var c = shot.target || [0, 1.2, 0];
        var a = lerp(a0, a1, e), r = lerp(r0, r1, e);
        out.eye = [c[0] + Math.cos(a) * r, lerp(h0, h1, e), c[2] + Math.sin(a) * r];
        out.target = c.slice();
        out.fov = lerp(fov, fovTo, e);
        break;
      }
      case 'crane': {
        // 摇臂：从低处升到高处，同时微微推近
        out.eye = [lerp(from[0], to[0], e), lerp(from[1], to[1], e), lerp(from[2], to[2], e)];
        out.target = shot.look && shot.look !== 'follow' ? shot.look.slice()
          : (shot.target ? shot.target.slice() : [0, 1.2, 0]);
        out.fov = lerp(fov, fovTo, e);
        break;
      }
      case 'pan': {
        // 平移：视线固定，机身横移（视线方向 = 垂直于移动方向）
        var mv = [to[0] - from[0], 0, to[2] - from[2]];
        out.eye = [lerp(from[0], to[0], e), from[1], lerp(from[2], to[2], e)];
        var perp = [mv[2], 0, -mv[0]];
        var l = Math.hypot(perp[0], perp[2]) || 1;
        out.target = [out.eye[0] + perp[0] / l * 4, out.eye[1] - 0.35, out.eye[2] + perp[2] / l * 4];
        out.fov = lerp(fov, fovTo, e);
        break;
      }
      case 'follow': {
        // ⚠️ 侧向跟拍：**不能**让相机从目标一侧平移到另一侧 —— 中点会正好压在注视点上，
        //    视线方向退化（lookAt 的 z 向量为 0），画面里什么都没有，只剩天空和雾。
        //    所以沿「垂直于视线的方向」绕目标走弧线，始终保持设定距离。
        var tg = shot.target || [0, 1.2, 0];
        var dirx = to[0] - from[0], dirz = to[2] - from[2];
        var dl = Math.hypot(dirx, dirz) || 1;
        var dist = shot.dist === undefined ? Math.max(4, dl) : shot.dist;
        var ang = (e - 0.5) * 0.6;                          // 左右各 17°，避免转到背面穿帮
        var base = Math.atan2(to[2] - tg[2], to[0] - tg[0]);
        var a = base + ang;
        var r = dist * (1.15 - 0.3 * e);   // 顺带推近 15%：纯绕圈不像跟拍，推进才有跟的感觉
        out.eye = [tg[0] + Math.cos(a) * r,
                   lerp(from[1], to[1], e),
                   tg[2] + Math.sin(a) * r];
        out.target = tg.slice();
        out.fov = lerp(fov, fovTo, e);
        break;
      }
      case 'static':
      default: {
        out.eye = from.slice();
        out.target = shot.look && shot.look !== 'follow' ? shot.look.slice()
          : (shot.target ? shot.target.slice() : [0, 1.2, 0]);
        // 固定镜头也给一点点呼吸，纯静帧容易像截图
        var br = shot.breath === undefined ? 1 : shot.breath;
        out.eye[0] += Math.sin(t * 0.7) * 0.012 * br;
        out.eye[1] += Math.sin(t * 0.53 + 1.7) * 0.016 * br;
        out.fov = lerp(fov, fovTo, e);
        break;
      }
    }

    if (shot.roll) out.roll = shot.roll * Math.PI / 180;
    // 手持抖动：任何镜头都能叠一点（幅度极小，只为去掉"太稳"的塑料感）
    if (shot.handheld) {
      var a2 = shot.handheld;
      out.eye[0] += Math.sin(t * 3.1) * 0.008 * a2;
      out.eye[1] += Math.sin(t * 2.3 + 0.8) * 0.010 * a2;
      out.roll += Math.sin(t * 1.7) * 0.0016 * a2;
    }
    // 别让相机钻进地面或穿到天上去
    out.eye[1] = Math.max(0.25, out.eye[1]);
    return out;
  }

  /** 从一个点看向另一个点的「标准机位」：好用的默认值，省得导演每段都算 */
  function shotLookingAt(target, dist, height, angleDeg, type) {
    var a = (angleDeg || 0) * Math.PI / 180;
    return {
      type: type || 'static',
      from: [target[0] + Math.cos(a) * dist, height, target[2] + Math.sin(a) * dist],
      to: [target[0] + Math.cos(a) * dist * 0.7, height, target[2] + Math.sin(a) * dist * 0.7],
      target: target.slice(),
      look: target.slice(),
      fov: 42
    };
  }

  FS.camera = { evalShot: evalShot, shotLookingAt: shotLookingAt, EASE: EASE, lerp3: lerp3, lerp: lerp };
})(typeof window !== 'undefined' ? window : this);
