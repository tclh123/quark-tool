const QR_TOKEN_URL = "https://uop.quark.cn/cas/ajax/getTokenForQrcodeLogin";
const QR_TICKET_URL = "https://uop.quark.cn/cas/ajax/getServiceTicketByQrcodeToken";
const QR_URL_BASE = "https://su.quark.cn/4_eMHBJ";
const ACCOUNT_INFO_URL = "https://pan.quark.cn/account/info";
const DEFAULT_API_BASE = "https://quark-login-api.zwind.app/";

const state = {
  token: "",
  qrUrl: "",
  apiBase: localStorage.getItem("quarkApiBase") || DEFAULT_API_BASE,
  proxyCookieString: "",
  controller: null,
  polling: false,
};

const els = {
  prepareBtn: document.querySelector("#prepareBtn"),
  pollBtn: document.querySelector("#pollBtn"),
  stopBtn: document.querySelector("#stopBtn"),
  apiBase: document.querySelector("#apiBase"),
  saveApiBaseBtn: document.querySelector("#saveApiBaseBtn"),
  clearLogBtn: document.querySelector("#clearLogBtn"),
  qrCode: document.querySelector("#qrCode"),
  qrPlaceholder: document.querySelector("#qrPlaceholder"),
  qrUrl: document.querySelector("#qrUrl"),
  ticket: document.querySelector("#ticket"),
  cookieString: document.querySelector("#cookieString"),
  log: document.querySelector("#log"),
  statusDot: document.querySelector("#statusDot"),
  statusText: document.querySelector("#statusText"),
};

els.apiBase.value = state.apiBase;

function requestId() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function appendLog(message) {
  const stamp = new Date().toLocaleTimeString("zh-CN", { hour12: false });
  els.log.textContent += `[${stamp}] ${message}\n`;
  els.log.scrollTop = els.log.scrollHeight;
}

function setStatus(text, ok = false) {
  els.statusText.textContent = text;
  els.statusDot.classList.toggle("ok", ok);
}

function setPolling(isPolling) {
  state.polling = isPolling;
  els.prepareBtn.disabled = isPolling;
  els.pollBtn.disabled = isPolling || !state.token;
  els.stopBtn.disabled = !isPolling;
}

function buildQrUrl(token) {
  const params = new URLSearchParams({
    token,
    client_id: "532",
    ssb: "weblogin",
    uc_param_str: "",
    uc_biz_str: "S:custom|OPT:SAREA@0|OPT:IMMERSIVE@1|OPT:BACK_BTN_STYLE@0",
  });
  return `${QR_URL_BASE}?${params.toString()}`;
}

async function fetchJson(url, params, options = {}) {
  const target = new URL(url);
  Object.entries(params).forEach(([key, value]) => target.searchParams.set(key, value));
  const response = await fetch(target, {
    method: "GET",
    mode: "cors",
    credentials: options.credentials || "omit",
    signal: options.signal,
    headers: {
      accept: "application/json, text/plain, */*",
    },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}

async function quarkApi(kind, params, options = {}) {
  if (!state.apiBase) {
    const directUrl = {
      token: QR_TOKEN_URL,
      ticket: QR_TICKET_URL,
      accountInfo: ACCOUNT_INFO_URL,
    }[kind];
    return fetchJson(directUrl, params, options);
  }

  const target = new URL(kind, `${state.apiBase.replace(/\/+$/, "")}/`);
  Object.entries(params).forEach(([key, value]) => target.searchParams.set(key, value));
  const headers = { accept: "application/json" };
  if (state.proxyCookieString) {
    headers["x-quark-cookie"] = state.proxyCookieString;
  }

  const response = await fetch(target, {
    method: "GET",
    mode: "cors",
    credentials: "omit",
    signal: options.signal,
    headers,
  });
  if (!response.ok) {
    throw new Error(`proxy HTTP ${response.status}`);
  }

  const body = await response.json();
  if (body.cookieString) {
    state.proxyCookieString = body.cookieString;
  }
  if (body.cookies?.length) {
    els.cookieString.value = body.cookieString || "";
  }
  if (body.error) {
    throw new Error(body.error);
  }
  return body.payload;
}

async function renderQr(qrUrl) {
  if (!window.QRCode) {
    throw new Error("二维码渲染库加载失败，请检查 docs/vendor/qrcode.min.js 是否存在");
  }
  els.qrCode.innerHTML = "";
  new window.QRCode(els.qrCode, {
    text: qrUrl,
    width: 240,
    height: 240,
    colorDark: "#191814",
    colorLight: "#fffdf6",
    correctLevel: window.QRCode.CorrectLevel.M,
  });
  els.qrCode.style.display = "block";
  els.qrPlaceholder.style.display = "none";
}

async function prepareLogin() {
  stopPolling();
  setStatus("正在生成二维码");
  appendLog("请求夸克二维码 token");

  state.proxyCookieString = "";
  els.cookieString.value = "";

  const payload = await quarkApi("token", {
    client_id: "532",
    v: "1.2",
    request_id: requestId(),
  });

  if (payload.status !== 2000000) {
    throw new Error(`获取 token 失败: ${JSON.stringify(payload).slice(0, 300)}`);
  }

  const token = payload?.data?.members?.token;
  if (!token) {
    throw new Error("响应缺少 token");
  }

  state.token = token;
  state.qrUrl = buildQrUrl(token);
  els.qrUrl.value = state.qrUrl;
  els.ticket.value = "";
  await renderQr(state.qrUrl);

  els.pollBtn.disabled = false;
  setStatus("二维码已生成");
  appendLog("二维码已生成，请使用夸克 App 扫码确认");
}

async function pollTicket() {
  if (!state.token) {
    appendLog("请先生成二维码");
    return;
  }

  state.controller = new AbortController();
  setPolling(true);
  setStatus("等待扫码确认");
  appendLog("开始轮询扫码状态");

  const startedAt = Date.now();
  const timeoutMs = 5 * 60 * 1000;

  try {
    while (Date.now() - startedAt < timeoutMs) {
      const payload = await quarkApi(
        "ticket",
        {
          client_id: "532",
          v: "1.2",
          token: state.token,
          request_id: requestId(),
        },
        { signal: state.controller.signal },
      );

      const serviceTicket = payload?.data?.members?.service_ticket;
      if (payload.status === 2000000 && serviceTicket) {
        els.ticket.value = serviceTicket;
        appendLog("扫码确认成功，已获取 service_ticket");
        setStatus("已获取 ticket", true);
        await exchangeTicket(serviceTicket);
        return;
      }

      await sleep(2000, state.controller.signal);
    }

    throw new Error("二维码登录超时");
  } finally {
    setPolling(false);
    state.controller = null;
  }
}

async function exchangeTicket(serviceTicket) {
  appendLog(state.apiBase ? "通过代理换取 cookie" : "尝试访问 pan.quark.cn/account/info 完成浏览器侧登录");
  try {
    await quarkApi(
      "account-info",
      { st: serviceTicket, lw: "scan" },
      { credentials: "include" },
    );
    if (state.apiBase && els.cookieString.value) {
      appendLog("代理已返回 Cookie String。请把它当作敏感凭据保存。");
    } else {
      appendLog("浏览器侧登录请求已完成。Cookie 是否写入取决于夸克的 CORS 与浏览器第三方 Cookie 策略。");
    }
    setStatus("登录请求完成", true);
  } catch (error) {
    appendLog(`登录交换失败: ${error.message}`);
    appendLog("如果未配置代理，这通常是 CORS 或第三方 Cookie 限制。GitHub Pages 纯静态页面无法绕过该限制。");
  }
}

function stopPolling() {
  if (state.controller) {
    state.controller.abort();
  }
  setPolling(false);
  setStatus(state.token ? "已停止轮询" : "待生成二维码");
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

els.prepareBtn.addEventListener("click", async () => {
  try {
    await prepareLogin();
  } catch (error) {
    setStatus("生成失败");
    appendLog(`生成二维码失败: ${error.message}`);
  }
});

els.pollBtn.addEventListener("click", async () => {
  try {
    await pollTicket();
  } catch (error) {
    if (error.name === "AbortError") {
      appendLog("轮询已停止");
      return;
    }
    setStatus("轮询失败");
    appendLog(`轮询失败: ${error.message}`);
  }
});

els.stopBtn.addEventListener("click", stopPolling);
els.saveApiBaseBtn.addEventListener("click", () => {
  state.apiBase = els.apiBase.value.trim().replace(/\/+$/, "");
  if (state.apiBase) {
    localStorage.setItem("quarkApiBase", state.apiBase);
    appendLog(`已保存代理地址: ${state.apiBase}`);
  } else {
    localStorage.removeItem("quarkApiBase");
    appendLog("已清空代理地址，将尝试浏览器直连。直连通常会被 CORS 拦截。");
  }
});
els.clearLogBtn.addEventListener("click", () => {
  els.log.textContent = "";
});

appendLog(state.apiBase ? `页面已加载，当前代理: ${state.apiBase}` : "页面已加载。未配置代理时，GitHub Pages 直连夸克接口通常会被 CORS 拦截。");
