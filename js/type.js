/* type.js —— 排版模块：仿「完全用代码生成」的动画那套文字语言
 *
 * 为什么单独抽一层（2026-10-05）：
 *   原先字幕是 story.js 里一个 sub()，字号 31px、白字、直接 fillText 就完事。
 *   那种片子（Three.js + headless Chrome 逐帧渲的全代码动画）文字之所以「像样」，
 *   靠的不是字体本身，而是**排版动作**：字有先后地出、标题与正文有量级差、
 *   关键词被点亮、字距被拉开、底部有一条托底的暗带。这套语言以前完全没有。
 *   所以这层只做一件事：把「怎么把一段话摆成好看的画面」收成可复用的零件，
 *   母题函数只管调用，不再各写各的。
 *
 * 全部纯 Canvas2D、确定性（同 t 永远同帧），不引字体文件（离线可用、导出可复现）。
 * 字距用逐字绘制实现（ctx.letterSpacing 在 Safari 旧版没有，不能依赖）。
 */
(function (root) {
  'use strict';
  var FS = (root.FS = root.FS || {});

  var FONT = '"PingFang SC","Hiragino Sans GB","Microsoft YaHei",system-ui,sans-serif';
  var MONO = 'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace';

  function font(px, weight) { return (weight || 400) + ' ' + Math.round(px) + 'px ' + FONT; }
  function mono(px, weight) { return (weight || 400) + ' ' + Math.round(px) + 'px ' + MONO; }

  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
  function ease(x) { return 1 - Math.pow(1 - clamp01(x), 3); }        // easeOutCubic
  function smooth(x) { x = clamp01(x); return x * x * (3 - 2 * x); }

  function hexA(hex, a) {
    var h = String(hex || '#fff').replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    if (isNaN(n)) return 'rgba(255,255,255,' + a + ')';
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  /** 逐字绘制以支持字距（letter-spacing）：返回实际占用宽度。
   *  ctx.letterSpacing 在 Chrome 99+ 有、Safari 16 以前没有 —— 自己算最稳。 */
  function drawTracked(g, str, x, y, tracking) {
    if (!tracking) { g.fillText(str, x, y); return g.measureText(str).width; }
    var tr = tracking;
    if (g.textAlign === 'center') {
      var w = measureTracked(g, str, tr);
      x -= w / 2;
    } else if (g.textAlign === 'right' || g.textAlign === 'end') {
      x -= measureTracked(g, str, tr);
    }
    var s = String(str), cx = x;
    for (var i = 0; i < s.length; i++) {
      g.fillText(s[i], cx, y);
      cx += g.measureText(s[i]).width + tr;
    }
    return Math.max(0, cx - tr - x);
  }
  function measureTracked(g, str, tracking) {
    if (!tracking) return g.measureText(str).width;
    var s = String(str), w = 0;
    for (var i = 0; i < s.length; i++) w += g.measureText(s[i]).width + tracking;
    return Math.max(0, w - tracking);
  }

  /* ================================================================
   *  1. 逐字入场（stagger reveal）
   *  这是「像样」的最大来源：所有字同时淡入就是 PPT，
   *  按字数错开 0.03~0.05 拍、每字从下方 12px 滑上来 + 轻微模糊感的
   *  透明度差，才像被人手敲出来的。
   * ================================================================ */

  /** 返回实际画了几个字（stagger 之后还没轮到的字会被跳过，省掉无谓的 fillText）
   *
   *  stagger 的默认值是**按字数自适应**的（2026-10-05 修）：
   *  写死 0.045 时，20 字的字幕要 0.045*20 + 0.34 ≈ 1.24 拍才出完 ——
   *  而一段只有 8 拍，最后一个字在第 7 拍才刚出现，字幕读不完就淡出了。
   *  改成「整句统一在 total 拍内出完」：stagger = total / 字数，并夹在
   *  [0.008, 0.05]。短标题（5~8 字）依然有明显的逐字感，长句也不会拖。
   */
  function revealText(g, str, x, y, o) {
    o = o || {};
    var s = String(str == null ? '' : str);
    if (!s) return 0;
    var prog = clamp01(o.p === undefined ? 1 : o.p);
    var per = o.per === undefined ? 0.30 : o.per;          // 单个字走完自己的动画要多久
    var total = o.total === undefined ? 0.62 : o.total;   // 整句出完要多久（p 的份额）
    var n = s.length;
    var stagger = o.stagger;
    if (stagger === undefined) {
      stagger = n > 1 ? Math.max(0.008, Math.min(0.05, (total - per) / (n - 1))) : per;
    }
    var rise = o.rise === undefined ? 14 : o.rise;
    var tr = o.tracking || 0;
    g.font = o.font || font(o.size || 32, o.weight || 600);
    g.textAlign = o.align || 'left';
    g.textBaseline = o.baseline || 'alphabetic';
    g.fillStyle = o.color || '#fff';

    var align = g.textAlign;
    var totalW = measureTracked(g, s, tr);
    var x0 = x;
    if (align === 'center') x0 = x - totalW / 2;
    else if (align === 'right' || align === 'end') x0 = x - totalW;

    var shown = 0, cx = x0;
    for (var i = 0; i < s.length; i++) {
      var cp = clamp01((prog - i * stagger) / per);
      var e = ease(cp);
      var chW = g.measureText(s[i]).width;
      // 每个字自己的竖直偏移 + 透明度；到位的字（e>=1）就不再逐帧重算，直接原位画
      var dy = rise * (1 - e);
      var a = (o.alpha === undefined ? 1 : o.alpha) * e;
      if (a > 0.01) {
        var ga = g.globalAlpha;
        g.globalAlpha = ga * a;
        g.fillText(s[i], cx, y + dy);
        g.globalAlpha = ga;
        shown++;
      }
      cx += chW + tr;
    }
    return shown;
  }

  /* ================================================================
   *  2. 标题：字重对比 + 底部生长下划线
   *  「大字重 + 细副标」是代码动画最常见的层级手段。
   *  underline 随 p 横向生长，宽度跟文字实际宽度对齐（不写死像素，
   *  否则换字号就错位）。
   * ================================================================ */
  function title(g, str, x, y, o) {
    o = o || {};
    var p = clamp01(o.p === undefined ? 1 : o.p);
    var size = o.size || 56;
    var tr = o.tracking === undefined ? size * 0.02 : o.tracking;
    g.save();
    g.textBaseline = o.baseline || 'alphabetic';
    g.textAlign = o.align || 'left';
    g.font = o.font || font(size, o.weight || 800);
    if (o.shadow) {
      g.shadowColor = hexA(o.shadow, o.shadowA === undefined ? 0.5 : o.shadowA);
      g.shadowBlur = o.shadowBlur || size * 0.28;
    }
    var w = revealText(g, str, x, y, {
      p: p, size: size, weight: o.weight || 800, color: o.color || '#fff',
      align: o.align || 'left', baseline: o.baseline || 'alphabetic',
      tracking: tr, stagger: o.stagger === undefined ? 0.035 : o.stagger,
      rise: o.rise === undefined ? size * 0.18 : o.rise, alpha: o.alpha
    });
    // 下划线：跟着「整句都出场」之后才开始生长，起点与文字左边缘对齐
    if (o.underline) {
      var uw = Math.max(0, w * 0);   // revealText 返回的是字数，宽度另算
      g.font = o.font || font(size, o.weight || 800);
      uw = measureTracked(g, String(str), tr);
      var up = clamp01((p - 0.55) / 0.35);
      var uy = y + (o.underlineGap === undefined ? size * 0.20 : o.underlineGap);
      g.shadowBlur = 0;
      g.fillStyle = o.underline;
      g.fillRect(x, uy, uw * ease(up), Math.max(2, size * 0.055));
    }
    g.restore();
    return w;
  }

  /* ================================================================
   *  3. kicker：段首的小标签（大字距 + 全大写/数字感）
   *  一段 5 秒的画面里，真正决定「专业」的是这个小标签。
   *  ⚠️ 颜色不能固定用主色：主色在深底上好看（比如 ink 的青），
   *  遇到 bright 场景（公园的浅蓝天空）就是「青字压在浅蓝上」，几乎读不出来
   *  —— 实测出图就是这样。所以默认走 text 色 + 暗色投影，两种底都读得清；
   *  调用方确实知道底色时可以用 shadow:false 关掉投影换成主色。
   * ================================================================ */
  function kicker(g, str, x, y, o) {
    o = o || {};
    var p = clamp01(o.p === undefined ? 1 : o.p);
    var size = o.size || 15;
    g.save();
    g.textBaseline = o.baseline || 'alphabetic';
    g.textAlign = o.align || 'left';
    g.font = o.font || mono(size, 700);
    g.globalAlpha = g.globalAlpha * clamp01(p / 0.5);
    if (o.shadow !== false) {
      g.shadowColor = 'rgba(0,0,0,0.72)';
      g.shadowBlur = size * 0.9;
      g.shadowOffsetY = size * 0.06;
    }
    g.fillStyle = o.color || '#ffffff';
    var s = String(str);
    var tr = o.tracking === undefined ? size * 0.34 : o.tracking;
    var w = drawTracked(g, s, x, y, tr);
    // 标签前一条 1px 短横线，随 p 横向生长
    if (o.rule !== false) {
      g.shadowBlur = 0;
      g.fillRect(x - size * 1.5, y - size * 0.36, size * 1.1 * ease(p), Math.max(1, size * 0.09));
    }
    g.restore();
    return w;
  }

  /* ================================================================
   *  4. 字幕带（底部托底）
   *  原来的做法是在 daily 母题里手写一条渐变带。抽出来后：
   *    · 三段式带（顶部完全透明 → 中段半透 → 底部压实），字永远读得出来
   *    · 带高按实际行数算（两行字幕不需要 230px 那么高的带，画面会被吃掉一块）
   *    · 关键词高亮：命中的词用主色 + 轻微发光，其余压成半透
   * ================================================================ */
  function band(g, cx, baselineY, lineH, lines, o) {
    o = o || {};
    var W = o.W || 1280, H = o.H || 720;
    var top = baselineY - (lines - 1) * lineH / 2 - lineH * 0.92;
    var bot = baselineY + (lines - 1) * lineH / 2 + lineH * 0.92;
    if (top < H * 0.35) return;                        // 字幕太靠上就不铺带，否则吃掉画面
    var grd = g.createLinearGradient(0, top, 0, bot);
    grd.addColorStop(0, 'rgba(0,0,0,0)');
    grd.addColorStop(0.45, 'rgba(0,0,0,' + (o.mid === undefined ? 0.46 : o.mid) + ')');
    grd.addColorStop(1, 'rgba(0,0,0,' + (o.strong === undefined ? 0.86 : o.strong) + ')');
    g.save();
    g.fillStyle = grd;
    g.fillRect(0, top, W, bot - top);
    g.restore();
  }

  /** 把一行文案按 maxW 折行；返回行数组（中文按字折，西文按词折） */
  function wrap(g, text, maxW) {
    var s = String(text || '');
    if (!s) return [];
    var lines = [], cur = '';
    for (var i = 0; i < s.length; i++) {
      var ch = s[i];
      if (ch === '\n') { lines.push(cur); cur = ''; continue; }
      var probe = cur + ch;
      if (g.measureText(probe).width > maxW && cur) {
        // 西文尽量不把词劈开：若当前行末尾是 ASCII 词的一部分，退到上一个空格
        if (/[A-Za-z0-9]/.test(ch) && /[A-Za-z0-9]/.test(cur[cur.length - 1] || '')) {
          var sp = cur.lastIndexOf(' ');
          if (sp > 0 && cur.length - sp < 14) {
            lines.push(cur.slice(0, sp));
            cur = cur.slice(sp + 1) + ch;
            continue;
          }
        }
        lines.push(cur); cur = ch;
      } else cur = probe;
    }
    if (cur) lines.push(cur);
    return lines;
  }

  /** 关键词命中判定：命中返回该词在行内的 [start,end)，用于上色 */
  function hitRanges(line, words) {
    var out = [];
    if (!words || !words.length) return out;
    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      if (!w) continue;
      var from = 0, at;
      while ((at = line.indexOf(w, from)) >= 0) {
        out.push([at, at + w.length]);
        from = at + w.length;
      }
    }
    out.sort(function (a, b) { return a[0] - b[0]; });
    // 合并重叠区间（两个关键词嵌套时别画两遍底色）
    var merged = [];
    out.forEach(function (r) {
      var last = merged[merged.length - 1];
      if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
      else merged.push([r[0], r[1]]);
    });
    return merged;
  }

  /** 完整字幕：铺带 → 折行 → 逐字入场 → 关键词点亮。返回占用行数。 */
  function subtitle(g, text, cx, cy, o) {
    o = o || {};
    if (o.off || !text) return 0;
    var maxW = o.maxW || 980;
    var size = o.size || 31, weight = o.weight || 600;
    var p = clamp01(o.p === undefined ? 1 : o.p);
    var px = size, lines, guard = 0;
    g.font = font(px, weight);
    lines = wrap(g, text, maxW);
    // 最多两行；超了就把字号往下收（每次 2px，最多 14 次 ≈ 28px）
    while (lines.length > (o.maxLines || 2) && px > 15 && guard++ < 14) {
      px -= 2;
      g.font = font(px, weight);
      lines = wrap(g, text, maxW);
    }
    var lh = px * 1.5;
    band(g, cx, cy, lh, lines.length, o);
    var y0 = cy - (lines.length - 1) * lh / 2;
    var base = o.color || '#eef3ff';
    var hi = o.highlight || '#ffd166';
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      // 逐行错开 0.12 拍，入场更像「一句一句被敲出来」
      var lp = clamp01((p - i * 0.12) / 0.62);
      var rngs = hitRanges(line, o.words);
      if (!rngs.length) {
        revealText(g, line, cx, y0 + i * lh, {
          p: lp, size: px, weight: weight, color: base, align: 'center',
          baseline: 'middle', tracking: px * 0.01, stagger: 0.022, rise: px * 0.34,
          alpha: o.alpha
        });
        continue;
      }
      // 有关键词：整行按字绘制，命中区间换成高亮色 + 发光
      var perChar = 0.5 / Math.max(1, line.length);
      var tr = px * 0.01;
      g.save();
      g.font = font(px, weight);
      g.textBaseline = 'middle';
      var trW = measureTracked(g, line, tr);
      var x0 = cx - trW / 2;
      var cx2 = x0;
      for (var k = 0; k < line.length; k++) {
        var cp = ease(clamp01((lp - k * perChar) / 0.34));
        if (cp > 0.01) {
          var on = false;
          for (var r = 0; r < rngs.length; r++) if (k >= rngs[r][0] && k < rngs[r][1]) { on = true; break; }
          var ga = g.globalAlpha;
          g.globalAlpha = ga * cp * (o.alpha === undefined ? 1 : o.alpha) * (on ? 1 : 0.86);
          if (on) { g.shadowColor = hexA(hi, 0.55); g.shadowBlur = px * 0.34; }
          g.fillStyle = on ? hi : base;
          g.fillText(line[k], cx2, y0 + i * lh + px * 0.30 * (1 - cp));
          g.globalAlpha = ga; g.shadowBlur = 0;
        }
        cx2 += g.measureText(line[k]).width + tr;
      }
      g.restore();
    }
    return lines.length;
  }

  /** 从一段文案里抽关键词（2~4 个），用于 subtitle 的高亮。
   *  规则够用就好：优先书名号/引号里的词，其次长度 2~6 的名词性片段。
   *  刻意不引分词库 —— 这里错漏的代价只是「某个词没被点亮」，无害。 */
  function keywords(text, max) {
    max = max || 3;
    var s = String(text || ''), out = [], seen = {};
    function push(w) {
      w = String(w || '').trim();
      if (w.length < 2 || w.length > 8) return;
      if (seen[w]) return; seen[w] = 1; out.push(w);
    }
    var m = s.match(/[《「【"'']([^》」】"'']{2,8})[》」】"'']/g) || [];
    m.forEach(function (x) { push(x.replace(/[《「【"''》」】]/g, '')); });
    if (out.length < max) {
      // 数字与英文缩写通常是关键词（「3 天」「WebGL」）
      var m2 = s.match(/[A-Za-z][A-Za-z0-9+.]{1,12}|\d+(?:\.\d+)?\s*(?:秒|天|年|次|个|米|倍|%|％)?/g) || [];
      m2.forEach(push);
    }
    return out.slice(0, max);
  }

  FS.type = {
    font: font, mono: mono, hexA: hexA,
    clamp01: clamp01, ease: ease, smooth: smooth,
    drawTracked: drawTracked, measureTracked: measureTracked,
    revealText: revealText, title: title, kicker: kicker,
    band: band, wrap: wrap, hitRanges: hitRanges,
    subtitle: subtitle, keywords: keywords,
    FONT: FONT, MONO: MONO
  };
})(typeof window !== 'undefined' ? window : this);
