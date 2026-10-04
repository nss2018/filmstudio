/**
 * Cloudflare Worker —— 给「不给浏览器跨域（CORS）」的 OpenAI 兼容 API 当中转。
 *
 * 为什么要它：工坊的文案助手是**浏览器直连你的 API**（Key 只存本地）。
 * 但 DeepSeek / OpenAI 这类服务大多不返回 CORS 头，直连会被浏览器拦掉。
 * 贴一个 Worker 当中转就行了。
 *
 * 部署：
 *   1. dash.cloudflare.com → Workers & Pages → Create Worker → 粘贴本文件 → Deploy
 *   2. 下面两处按需填写 → 重新 Deploy
 *   3. 工坊「API 设置」里：Base 填 https://<你的worker>.workers.dev/v1 ，Key 留空
 *
 * ⚠️ 安全提醒：这是个中转站，谁拿到地址都能用。
 *    公网部署前请务必把 AUTH 设成一个长随机串（工坊里没有这个输入框，
 *    就把它写进 worker 内部校验请求头 X-Proxy-Token；或者干脆只在本地/内网用）。
 */

const KEYS = {
  // 在这里存 Key，浏览器就不用带 Key 了（更保险）
  // "api.deepseek.com": "sk-...",
  // "api.openai.com": "sk-...",
};

// 只允许转发到这些 host（防止你的 Worker 变成万能开放代理）
const ALLOW_HOSTS = [
  'api.deepseek.com',
  'api.openai.com',
  'api.siliconflow.cn',
  'api.moonshot.cn'
];

// 非空则要求请求带 X-Proxy-Token 头，且值相等
const AUTH = '';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Proxy-Token',
  'Access-Control-Max-Age': '86400'
};

function fail(code, msg) {
  return new Response(JSON.stringify({ error: { message: msg } }), {
    status: code,
    headers: { ...CORS, 'Content-Type': 'application/json' }
  });
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (request.method !== 'POST') return fail(405, '只接受 POST');

    if (AUTH && request.headers.get('X-Proxy-Token') !== AUTH) return fail(401, 'token 不对');

    let body;
    try {
      body = await request.json();
    } catch (e) {
      return fail(400, '请求体不是 JSON：' + e.message);
    }

    // 工坊发的请求：POST { host, path, payload }
    const host = String(body.host || '');
    const path = String(body.path || '/chat/completions');
    if (!ALLOW_HOSTS.includes(host)) return fail(403, '这个 host 不在白名单里：' + host);
    if (!/^\/[A-Za-z0-9/_.-]*$/.test(path)) return fail(400, 'path 不合法');

    const headers = { 'Content-Type': 'application/json' };
    const key = KEYS[host] || body.key;
    if (key) headers.Authorization = 'Bearer ' + key;
    if (body.model) headers['X-Model-Hint'] = String(body.model).slice(0, 60);

    const upstream = await fetch('https://' + host + path, {
      method: 'POST',
      headers,
      body: JSON.stringify(body.payload || {})
    });

    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: { ...CORS, 'Content-Type': 'application/json' }
    });
  }
};
