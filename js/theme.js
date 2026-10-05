/* ------------------------------------------------------------------
 * theme.js —— 全站调色板（JS 侧唯一真源）
 *
 * 为什么单独一份：页面上有 3 个 canvas（#wave 波形、#roll 钢琴卷帘、
 * #timeline 时间轴）是 JS 逐像素画的，CSS 变量它们读不到。所以颜色在这里
 * 定义一份，canvas 直接取；UI 侧在 css/app.css 的 :root 里同名定义一份。
 * ⚠️ 两处必须保持一致 —— tests/node-test.js 有一条断言逐字比对，
 *    改了一个忘了改另一个会直接 fail。
 *
 * 设计方向：Editorial / Organic（暖纸 + 印刷色）。
 * 明确禁用：纯黑/深蓝黑背景、紫、紫蓝、荧光青。
 * ---------------------------------------------------------------- */
(function (root) {
  'use strict';
  var FS = (root.FS = root.FS || {});

  FS.theme = {
    /* —— 纸面 —— */
    paper: '#F7F2E9',      // 页面底（暖米）
    card: '#FFFDF8',       // 卡片面
    trough: '#EFE7D9',     // 凹槽面（输入框 / 波形 / 卷帘底）
    troughDeep: '#E5DAC7', // 更深的凹槽（卷帘隔行）

    /* —— 墨色（深棕，不是黑）—— */
    ink: '#33291F',        // 主文字
    ink2: '#6E6053',       // 次要文字
    ink3: '#9A8C7C',       // 弱文字 / 占位

    /* —— 线 —— */
    rule: '#E2D6C0',       // 分隔线
    rule2: '#D3C3A8',      // 深一档线

    /* —— 语义色 —— */
    accent: '#C05A38',     // 主强调：陶土朱（印刷色）
    accentDeep: '#9E4526', // 主强调 hover / 实心按钮底
    olive: '#4E6B45',      // 次强调：橄榄（成功 / 播放）
    brick: '#B23A2C',      // 危险
    gold: '#B8892B',       // 提示 / 高亮

    /* —— 卷帘轨道配色（8 条轨，全大地色系，无紫无黑）—— */
    trail: ['#C05A38', '#2F6F7A', '#B8892B', '#6B7F45',
            '#A8442E', '#5A6B84', '#C77C4E', '#4E6B45']
  };

  /** '#RRGGBB' + alpha(0~1) → 'rgba(...)'，canvas 里画半透明用 */
  function hexA(hex, a) {
    var h = hex.replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }
  FS.theme.hexA = hexA;
})(typeof window !== 'undefined' ? window : globalThis);
