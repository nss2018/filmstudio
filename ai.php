<?php
/**
 * ai.php —— 工坊的 OpenAI 兼容中转（解决浏览器直连被 CORS 拦死的问题）
 *
 * 为什么必须有它：
 *   火山方舟**明令禁止浏览器直连**——/api/v3/models 连 Access-Control-Allow-Origin
 *   都不返回（实测 401 且无该响应头）。这不是配置疏漏，是强制安全策略。
 *   所以纯静态页无论模型名填得多对，fetch 都会被浏览器按 CORS 拦掉。
 *
 * 它做什么：
 *   1) 浏览器 POST /filmstudio/ai.php  { host, path, payload, key }
 *      → 服务端用 curl 转发到 https://{host}{path}，原样透传响应与状态码
 *   2) GET /filmstudio/ai.php?models=1&key=…
 *      → 直接列该 Key 已开通的模型，**这才是「填对模型名」的正解**：
 *         不用去控制台抄，也不用赌哪个模型开通了。
 *
 * 安全：
 *   - 只放行白名单 host（防止这台服务器变成万能开放代理）
 *   - Key 只由浏览器带过来、转发给上游，**不落盘、不写日志**
 *   - 默认限流：单 IP 每分钟 40 次（防被人当免费额度用）
 */
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');
if (isset($_SERVER['REQUEST_METHOD']) && $_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

/* ---------- 白名单：只转发这些 host ---------- */
$ALLOW = [
  'ark.cn-beijing.volces.com',      // 火山方舟（豆包）
  'api.deepseek.com',
  'api.openai.com',
  'api.siliconflow.cn',
  'api.moonshot.cn',
  'open.bigmodel.cn',              // 智谱 GLM
  'dashscope.aliyuncs.com',        // 通义千问
];

/* ---------- 各家的「版本段」前缀 ----------
 * 客户端只带业务路径（/chat/completions），版本段（方舟是 /api/v3）必须在这里补齐。
 * ⚠️ 这里踩过一个真坑：以前直接 "https://$host$path"，方舟就被拼成
 *    https://ark.cn-beijing.volces.com/chat/completions —— 缺 /api/v3，网关一律 404。
 *    而「列模型」那行当时写死了 /api/v3/models 是对的，所以现场怪像是
 *    「模型列得出来，一聊天就 404」。 */
$PREFIX = [
  'ark.cn-beijing.volces.com' => '/api/v3',           // 火山方舟（豆包）
  'api.deepseek.com'          => '/v1',
  'api.openai.com'            => '/v1',
  'api.siliconflow.cn'        => '/v1',
  'api.moonshot.cn'           => '/v1',
  'open.bigmodel.cn'          => '/api/paas/v4',      // 智谱 GLM
  'dashscope.aliyuncs.com'    => '/compatible-mode/v1', // 通义千问兼容模式
];
/** 拼上游完整 URL：host 决定版本段；客户端若已自带版本段（/v1、/api/v3）就不重复拼。 */
function upstream_url($host, $path, $PREFIX) {
  $pfx = isset($PREFIX[$host]) ? $PREFIX[$host] : '';
  if ($pfx !== '' && !preg_match('#^/(api/)?v\d#i', $path)) $path = $pfx . $path;
  return "https://$host$path";
}

function out_json($code, $arr) {
  http_response_code($code);
  header('Content-Type: application/json; charset=utf-8');
  echo json_encode($arr, JSON_UNESCAPED_UNICODE);
  exit;
}
function fail($code, $msg) { out_json($code, ['error' => ['message' => $msg]]); }

/* ---------- 限流：单 IP 每分钟 40 次 ---------- */
$RL = '/tmp/ai_rl_' . md5($_SERVER['REMOTE_ADDR'] ?? 'x') . '.txt';
$now = time();
$hits = [];
if (is_file($RL)) {
  $raw = @file_get_contents($RL);
  $arr = $raw ? array_filter(explode(',', trim($raw))) : [];
  foreach ($arr as $ts) { if ($now - (int)$ts < 60) $hits[] = (int)$ts; }
}
if (count($hits) >= 40) {
  header('Retry-After: 60');
  fail(429, '这个 IP 一分钟请求太多（上限 40 次），等一分钟再试。');
}
$hits[] = $now;
@file_put_contents($RL, implode(',', $hits));

/* ---------- 列模型：GET ?models=1&key=…&host=… ---------- */
if (isset($_GET['models'])) {
  $key  = trim((string)($_GET['key'] ?? ''));
  $host = trim((string)($_GET['host'] ?? 'ark.cn-beijing.volces.com'));
  if (!in_array($host, $ALLOW, true)) fail(403, "host 不在白名单里：$host");
  if ($key === '') fail(400, '没填 Key');
  $ch = curl_init(upstream_url($host, '/models', $PREFIX));
  curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER     => ['Authorization: Bearer ' . $key, 'Content-Type: application/json'],
    CURLOPT_TIMEOUT        => 30,
    CURLOPT_SSL_VERIFYPEER => true,
  ]);
  $txt = curl_exec($ch);
  $rc  = curl_errno($ch);
  $st  = curl_getinfo($ch, CURLINFO_HTTP_CODE);
  $msg = curl_error($ch);
  curl_close($ch);
  if ($rc) fail(502, "服务器连不上 $host：$msg");
  header('Content-Type: application/json; charset=utf-8');
  http_response_code($st);
  echo $txt;
  exit;
}

/* ---------- 转发：POST ---------- */
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') fail(405, '只接受 POST 或 ?models=1');

$in = json_decode(file_get_contents('php://input'), true);
if (!is_array($in)) fail(400, '请求体不是 JSON');

$host   = trim((string)($in['host'] ?? ''));
$path   = (string)($in['path'] ?? '/chat/completions');
$key    = trim((string)($in['key'] ?? ''));
$payload = $in['payload'] ?? [];

if (!in_array($host, $ALLOW, true)) fail(403, "host 不在白名单里：$host（工坊只允许转发到已知服务商）");
if (!preg_match('#^/[A-Za-z0-9/_.\-]*$#', $path)) fail(400, 'path 不合法');
if ($key === '') fail(400, '没填 Key');
if (getenv('AI_PROXY_KEY') && !hash_equals((string)getenv('AI_PROXY_KEY'), $key)) {
  // 预留：若将来想强制「Key 必须先在服务端登记」，把 AI_PROXY_KEY 配进 php-fpm 环境即可
}

$ch = curl_init(upstream_url($host, $path, $PREFIX));
$headers = ['Content-Type: application/json'];
if ($key !== '') $headers[] = 'Authorization: Bearer ' . $key;
curl_setopt_array($ch, [
  CURLOPT_RETURNTRANSFER => true,
  CURLOPT_POST           => true,
  CURLOPT_HTTPHEADER     => $headers,
  CURLOPT_POSTFIELDS     => json_encode($payload, JSON_UNESCAPED_UNICODE),
  CURLOPT_TIMEOUT        => 120,
  CURLOPT_SSL_VERIFYPEER => true,
]);
$txt = curl_exec($ch);
$rc  = curl_errno($ch);
$st  = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$msg = curl_error($ch);
curl_close($ch);

if ($rc) fail(502, "服务器连不上 $host：$msg");
header('Content-Type: application/json; charset=utf-8');
http_response_code($st ?: 502);
echo $txt;   // 原样透传：状态码和 error.code 都保留给前端做提示
