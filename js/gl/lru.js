/* lru.js —— 有界 LRU 缓存（可独立测试，不依赖 GL）
 *
 * 为什么单独抽出来：GPU 显存不像内存，「从 JS 对象里删掉」并不会释放显存，
 * 必须回调里 deleteVertexArray / deleteBuffer。抽成独立模块后，
 * 淘汰逻辑能直接在 node 里测（渲染层需要 GL 上下文，测不了）。
 *
 * 借鉴 digiCreature_ios 的 boxCache：有界 + 淘汰时释放 GPU 资源 + 有淘汰计数。
 */
(function (root) {
  'use strict';
  var FS = (root.FS = root.FS || {});

  /**
   * @param max 最多存多少条
   * @param onEvict (key, value) => void  淘汰回调（在这里释放显存）
   */
  function LRU(max, onEvict) {
    var map = {};          // key -> value
    var order = [];        // 旧 → 新
    var limit = Math.max(1, max | 0);
    var evictions = 0;
    var hits = 0, misses = 0;

    function unlink(key) {
      var i = order.indexOf(key);
      if (i >= 0) order.splice(i, 1);
    }

    return {
      get: function (key) {
        if (Object.prototype.hasOwnProperty.call(map, key)) {
          hits++;
          unlink(key); order.push(key);      // 命中即提到最新
          return map[key];
        }
        misses++;
        return undefined;
      },
      has: function (key) {
        return Object.prototype.hasOwnProperty.call(map, key);
      },
      set: function (key, value) {
        if (Object.prototype.hasOwnProperty.call(map, key)) {
          unlink(key);
          // ⚠️ 顺序要紧：先回调释放再 delete。反过来写的话 onEvict 收到的是 undefined，
          //    显存就没被释放 —— 而这正是这个模块存在的理由。
          if (onEvict) onEvict(key, map[key]);
          delete map[key];
        }
        map[key] = value;
        order.push(key);
        while (order.length > limit) {
          var old = order.shift();
          if (onEvict) onEvict(old, map[old]);
          delete map[old];
          evictions++;
        }
        return value;
      },
      /** 遍历时同时拿到 key，GL 侧统计三角面要用 */
      forEach: function (fn) {
        for (var i = 0; i < order.length; i++) fn(map[order[i]], order[i]);
      },
      keys: function () { return order.slice(); },
      size: function () { return order.length; },
      clear: function () {
        if (onEvict) order.forEach(function (k) { onEvict(k, map[k]); });
        map = {}; order = []; evictions = 0;
      },
      stats: function () {
        return { size: order.length, limit: limit, evictions: evictions, hits: hits, misses: misses };
      }
    };
  }

  FS.LRU = LRU;
})(typeof window !== 'undefined' ? window : this);
