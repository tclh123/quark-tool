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

## 敏感文件

以下文件包含登录凭据或二维码，不要提交或分享：

- `references/session_api.json`
- `references/login_token.json`
- `references/qr_code.png`
