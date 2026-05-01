# quark-tool

夸克网盘扫码登录工具。登录成功后会把 session 保存到 `references/session_api.json`。

## 安装依赖

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
```

## 使用

一步完成登录：

```bash
.venv/bin/python -m quark_tool login
```

分步登录：

```bash
.venv/bin/python -m quark_tool login-prepare
# 用夸克 App 扫描 references/qr_code.png
.venv/bin/python -m quark_tool login-wait
```

检查登录状态：

```bash
.venv/bin/python -m quark_tool auth-status
```

## JS / GitHub Pages 版本

静态前端在 `docs/` 目录，可直接作为 GitHub Pages 来源部署：

```text
Settings -> Pages -> Build and deployment -> Source: Deploy from a branch
Branch: main
Folder: /docs
```

本地预览：

```bash
python3 -m http.server 8080 -d docs
```

访问 `http://localhost:8080` 后点击“生成二维码”。

注意：GitHub Pages 纯前端不能读取夸克返回的 HttpOnly Cookie，也不能绕过浏览器 CORS 或第三方 Cookie 限制。页面支持两种模式：

- 直连模式：不填 API 代理地址。浏览器会直接请求夸克接口，但当前夸克接口没有返回 CORS 许可，通常会失败。
- 代理模式：填写一个你自己部署的代理地址。仓库提供了 `workers/quark-login-proxy.js`，可部署到 Cloudflare Workers。

Cloudflare Worker 代理部署要点：

```bash
# 示例，需要你本机已安装并登录 wrangler
wrangler deploy workers/quark-login-proxy.js
```

建议给 Worker 设置环境变量 `ALLOWED_ORIGIN`，值为你的 GitHub Pages 地址，例如：

```text
https://<你的用户名>.github.io
```

部署完成后，把 Worker URL 填到页面的“API 代理地址”。代理模式登录成功后页面会显示 `Cookie String`，它是敏感凭据，不要公开分享。

## 敏感文件

以下文件包含登录凭据或二维码，不要提交或分享：

- `references/session_api.json`
- `references/login_token.json`
- `references/qr_code.png`
