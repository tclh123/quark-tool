from __future__ import annotations

import json
import time
import urllib.parse
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

import httpx


PAN_ORIGIN = "https://pan.quark.cn"
QR_TOKEN_URL = "https://uop.quark.cn/cas/ajax/getTokenForQrcodeLogin"
QR_TICKET_URL = "https://uop.quark.cn/cas/ajax/getServiceTicketByQrcodeToken"
QR_URL_BASE = "https://su.quark.cn/4_eMHBJ"
ACCOUNT_INFO_URL = "https://pan.quark.cn/account/info"


def default_headers() -> dict[str, str]:
    return {
        "user-agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        ),
        "origin": PAN_ORIGIN,
        "referer": f"{PAN_ORIGIN}/",
        "accept": "application/json, text/plain, */*",
        "accept-language": "zh-CN,zh;q=0.9",
    }


def save_png_qr(url: str, out_path: Path) -> None:
    try:
        import qrcode
    except ImportError as exc:
        raise RuntimeError("缺少 qrcode 依赖，请先安装 requirements.txt") from exc

    out_path.parent.mkdir(parents=True, exist_ok=True)
    qrcode.make(url).save(out_path)


@dataclass(frozen=True)
class LoginResult:
    cookie_string: str
    cookies: list[dict[str, Any]]


class QuarkLoginClient:
    def __init__(self, timeout_s: float = 60.0) -> None:
        self.client = httpx.Client(
            timeout=timeout_s,
            headers=default_headers(),
            follow_redirects=True,
            trust_env=False,
        )

    def close(self) -> None:
        self.client.close()

    def __enter__(self) -> "QuarkLoginClient":
        return self

    def __exit__(self, _exc_type: object, _exc: object, _tb: object) -> None:
        self.close()

    def get_qr_token(self) -> str:
        response = self.client.get(
            QR_TOKEN_URL,
            params={"client_id": "532", "v": "1.2", "request_id": str(uuid.uuid4())},
        )
        response.raise_for_status()
        payload = response.json()
        if payload.get("status") != 2000000:
            raise RuntimeError(f"获取二维码 token 失败: {_safe_json(payload)}")

        token = payload.get("data", {}).get("members", {}).get("token")
        if not token:
            raise RuntimeError(f"响应缺少 token: {_safe_json(payload)}")
        return str(token)

    def build_qr_url(self, token: str) -> str:
        params = {
            "token": token,
            "client_id": "532",
            "ssb": "weblogin",
            "uc_param_str": "",
            "uc_biz_str": "S:custom|OPT:SAREA@0|OPT:IMMERSIVE@1|OPT:BACK_BTN_STYLE@0",
        }
        return f"{QR_URL_BASE}?{urllib.parse.urlencode(params)}"

    def poll_service_ticket(
        self,
        token: str,
        *,
        timeout_s: int = 300,
        poll_interval_s: float = 2.0,
        progress_cb: Callable[[int, str], None] | None = None,
    ) -> str:
        started_at = time.time()
        while time.time() - started_at < timeout_s:
            response = self.client.get(
                QR_TICKET_URL,
                params={
                    "client_id": "532",
                    "v": "1.2",
                    "token": token,
                    "request_id": str(uuid.uuid4()),
                },
            )
            if response.status_code == 200:
                payload = response.json()
                service_ticket = payload.get("data", {}).get("members", {}).get("service_ticket")
                if payload.get("status") == 2000000 and service_ticket:
                    if progress_cb:
                        progress_cb(max(0, int(timeout_s - (time.time() - started_at))), "扫码确认成功")
                    return str(service_ticket)

            if progress_cb:
                remaining = max(0, int(timeout_s - (time.time() - started_at)))
                progress_cb(remaining, "等待扫码确认")
            time.sleep(poll_interval_s)

        raise TimeoutError("二维码登录超时")

    def exchange_ticket_for_cookies(self, service_ticket: str) -> LoginResult:
        response = self.client.get(ACCOUNT_INFO_URL, params={"st": service_ticket, "lw": "scan"})
        response.raise_for_status()
        return self.export_cookies()

    def export_cookies(self) -> LoginResult:
        cookies: list[dict[str, Any]] = []
        pairs: list[str] = []
        for cookie in self.client.cookies.jar:
            if not cookie.domain or "quark.cn" not in cookie.domain:
                continue
            cookies.append(
                {
                    "name": cookie.name,
                    "value": cookie.value,
                    "domain": ".quark.cn",
                    "path": "/",
                    "secure": bool(getattr(cookie, "secure", False)),
                    "expires": getattr(cookie, "expires", None),
                    "httponly": bool(getattr(cookie, "rest", {}).get("HttpOnly")) if hasattr(cookie, "rest") else None,
                }
            )
            pairs.append(f"{cookie.name}={cookie.value}")

        if not cookies:
            raise RuntimeError("登录完成但没有获取到 quark.cn cookie")
        return LoginResult(cookie_string="; ".join(pairs), cookies=cookies)


def _safe_json(payload: Any) -> str:
    return json.dumps(payload, ensure_ascii=False)[:800]
