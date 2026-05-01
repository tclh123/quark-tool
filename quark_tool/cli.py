from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
REF_DIR = ROOT / "references"
TOKEN_PATH = REF_DIR / "login_token.json"
SESSION_PATH = REF_DIR / "session_api.json"
QR_PATH = REF_DIR / "qr_code.png"


def write_json(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def save_session(data: dict[str, Any]) -> None:
    write_json(SESSION_PATH, data)


def open_qr(path: Path) -> None:
    try:
        subprocess.Popen(["open", str(path)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except Exception:
        pass


def prepare_login(args: argparse.Namespace) -> int:
    from .quark_login import QuarkLoginClient, save_png_qr

    with QuarkLoginClient(timeout_s=60) as client:
        token = client.get_qr_token()
        qr_url = client.build_qr_url(token)
        save_png_qr(qr_url, QR_PATH)
        write_json(
            TOKEN_PATH,
            {
                "token": token,
                "qr_url": qr_url,
                "timeout": args.timeout,
                "created_at": int(time.time()),
            },
        )

    if not args.no_open:
        open_qr(QR_PATH)

    print(json.dumps({"qr_png": str(QR_PATH), "qr_url": qr_url, "token_file": str(TOKEN_PATH)}, ensure_ascii=False))
    return 0


def wait_login(args: argparse.Namespace) -> int:
    from .quark_login import QuarkLoginClient

    if not TOKEN_PATH.exists():
        raise FileNotFoundError("未找到 login_token.json，请先运行 login-prepare")

    token_data = read_json(TOKEN_PATH)
    token = token_data["token"]
    timeout = int(args.timeout or token_data.get("timeout") or 300)

    last_report = 0.0

    def progress(remaining: int, message: str) -> None:
        nonlocal last_report
        now = time.time()
        if message == "扫码确认成功" or now - last_report >= args.progress_interval:
            last_report = now
            print(f"[login] {message}，剩余 {remaining}s", flush=True)

    with QuarkLoginClient(timeout_s=60) as client:
        service_ticket = client.poll_service_ticket(
            token,
            timeout_s=timeout,
            poll_interval_s=args.poll_interval,
            progress_cb=progress,
        )
        result = client.exchange_ticket_for_cookies(service_ticket)
        save_session(
            {
                "source": "api-qr",
                "service_ticket": service_ticket,
                "cookieString": result.cookie_string,
                "cookies": result.cookies,
                "saved_at": int(time.time()),
            }
        )

    print(json.dumps({"ok": True, "session": str(SESSION_PATH)}, ensure_ascii=False))
    return 0


def login(args: argparse.Namespace) -> int:
    prepare_login(argparse.Namespace(timeout=args.timeout, no_open=args.no_open))
    return wait_login(
        argparse.Namespace(
            timeout=args.timeout,
            poll_interval=args.poll_interval,
            progress_interval=args.progress_interval,
        )
    )


def auth_status(_args: argparse.Namespace) -> int:
    try:
        import httpx
    except ImportError:
        print(json.dumps({"ok": False, "reason": "missing_dependency", "dependency": "httpx"}, ensure_ascii=False))
        return 1

    if not SESSION_PATH.exists():
        print(json.dumps({"ok": False, "reason": "missing_session", "session": str(SESSION_PATH)}, ensure_ascii=False))
        return 1

    session = read_json(SESSION_PATH)
    cookie_string = session.get("cookieString")
    if not cookie_string:
        print(json.dumps({"ok": False, "reason": "missing_cookie_string"}, ensure_ascii=False))
        return 1

    try:
        response = httpx.get(
            "https://drive-pc.quark.cn/1/clouddrive/file/sort",
            params={"pr": "ucpro", "fr": "pc", "uc_param_str": ""},
            headers={"cookie": cookie_string},
            timeout=15,
            follow_redirects=True,
            trust_env=False,
        )
    except httpx.HTTPError as exc:
        print(json.dumps({"ok": False, "reason": "request_failed", "error": str(exc)}, ensure_ascii=False))
        return 1

    ok = response.status_code not in (401, 403)
    print(json.dumps({"ok": ok, "status_code": response.status_code, "session": str(SESSION_PATH)}, ensure_ascii=False))
    return 0 if ok else 1


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="quark-tool", description="夸克网盘扫码登录工具")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_login = sub.add_parser("login", help="生成二维码并等待扫码登录")
    p_login.add_argument("--timeout", type=int, default=300)
    p_login.add_argument("--poll-interval", type=float, default=2.0)
    p_login.add_argument("--progress-interval", type=float, default=30.0)
    p_login.add_argument("--no-open", action="store_true", help="不自动打开二维码图片")
    p_login.set_defaults(func=login)

    p_prepare = sub.add_parser("login-prepare", help="生成二维码和 token")
    p_prepare.add_argument("--timeout", type=int, default=300)
    p_prepare.add_argument("--no-open", action="store_true", help="不自动打开二维码图片")
    p_prepare.set_defaults(func=prepare_login)

    p_wait = sub.add_parser("login-wait", help="等待已生成二维码扫码确认并保存 session")
    p_wait.add_argument("--timeout", type=int, default=None)
    p_wait.add_argument("--poll-interval", type=float, default=2.0)
    p_wait.add_argument("--progress-interval", type=float, default=30.0)
    p_wait.set_defaults(func=wait_login)

    p_status = sub.add_parser("auth-status", help="检查已保存 session 是否可用")
    p_status.set_defaults(func=auth_status)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        return int(args.func(args))
    except Exception as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
