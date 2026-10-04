# 部署到自己的服务器

这个站是**纯前端静态站**：没有后端、没有数据库、没有构建步骤。所有合成、渲染、编码都在浏览器里跑完，
服务器只需要把文件原样放上去就能用。

## 方式一：scp 上传（最快）

```bash
# 在你自己的电脑上执行（把 user@host 换成你的服务器）
scp -r filmstudio-deploy.zip user@host:/tmp/

# 登录服务器后解压到站点目录
ssh user@host
cd /tmp && unzip -q filmstudio-deploy.zip
sudo cp -r filmstudio-deploy/* /你的站点根目录/
```

站点根目录通常是下面之一（宝塔 / aaPanel / nginx 默认）：

| 面板 | 路径 |
|---|---|
| 宝塔 | `/www/wwwroot/<你的站点>/` |
| aaPanel | `/www/wwwroot/<你的站点>/` |
| 裸 nginx | `/usr/share/nginx/html/` 或 `/var/www/html/` |

## 方式二：本地起服务（内网预览 / 手机同局域网测试）

```bash
cd filmstudio-deploy
python3 -m http.server 8899
# 手机连同一个 Wi-Fi，浏览器打开 http://<电脑内网IP>:8899
```

## 方式三：Nginx 配置（如果还没有站点）

```nginx
server {
    listen 80;
    server_name 你的域名;
    root /var/www/filmstudio;      # 解压后的目录
    index index.html;

    # 静态资源带指纹的可以长缓存；html 短缓存避免更新不及时
    location ~* \.(js|css|html)$ {
        add_header Cache-Control "public, max-age=300";
    }
    # 其余（workers/proxy.js 等）
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

改完 `sudo nginx -t && sudo nginx -s reload`。

## 需要 HTTPS 吗？

- 只自己用、只在局域网：不需要。
- 要在手机上用（尤其是 iOS Safari）：**需要 HTTPS**。
  `MediaRecorder` 和 `OfflineAudioContext` 在非安全上下文里会被浏览器禁用
  （`localhost` 例外）。用 Let's Encrypt：
  ```bash
  sudo apt install certbot python3-certbot-nginx
  sudo certbot --nginx -d 你的域名
  ```

## 验证部署成功

打开 `你的域名/tests/gl-probe.html?w=480&h=270&n=6`：

- 最后一行显示「引擎可用 ✓」→ 3D 引擎正常
- 底部显示「本环境：… · 3D 生活场景 可用」→ WebGL 正常
- 如果显示「无 WebGL」，是浏览器/显卡驱动问题，换 Chrome 或开硬件加速

## 注意

- 整个目录是**一个整体**，别漏 `js/gl/` 子目录
- 没有 `package.json`、不需要 `npm install`
- 文件都是 UTF-8 中文文件名/内容，服务器不用改编码
