const QUARK_ENDPOINTS = {
  token: "https://uop.quark.cn/cas/ajax/getTokenForQrcodeLogin",
  ticket: "https://uop.quark.cn/cas/ajax/getServiceTicketByQrcodeToken",
  "account-info": "https://pan.quark.cn/account/info",
};

const EXPOSED_HEADERS = "content-type";

export default {
  async fetch(request, env) {
    const origin = request.headers.get("origin") || "";
    const allowOrigin = env.ALLOWED_ORIGIN || origin || "*";

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(allowOrigin) });
    }

    if (request.method !== "GET") {
      return json({ error: "method_not_allowed" }, 405, allowOrigin);
    }

    const url = new URL(request.url);
    const route = url.pathname.replace(/^\/+/, "") || "health";
    if (route === "health") {
      return json({ ok: true }, 200, allowOrigin);
    }

    const endpoint = QUARK_ENDPOINTS[route];
    if (!endpoint) {
      return json({ error: "not_found" }, 404, allowOrigin);
    }

    const target = new URL(endpoint);
    url.searchParams.forEach((value, key) => target.searchParams.set(key, value));

    const upstreamHeaders = {
      accept: "application/json, text/plain, */*",
      "accept-language": "zh-CN,zh;q=0.9",
      origin: "https://pan.quark.cn",
      referer: "https://pan.quark.cn/",
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    };

    const inboundCookie = request.headers.get("x-quark-cookie");
    if (inboundCookie) {
      upstreamHeaders.cookie = inboundCookie;
    }

    try {
      const upstream = await fetch(target, {
        method: "GET",
        headers: upstreamHeaders,
        redirect: "follow",
      });
      const payloadText = await upstream.text();
      const payload = safeJson(payloadText);
      const cookieString = mergeCookieStrings(inboundCookie || "", getSetCookies(upstream.headers));
      const cookies = cookieStringToObjects(cookieString);

      return json(
        {
          ok: upstream.ok,
          status: upstream.status,
          payload,
          cookieString,
          cookies,
        },
        upstream.ok ? 200 : upstream.status,
        allowOrigin,
      );
    } catch (error) {
      return json({ error: error.message || "upstream_failed" }, 502, allowOrigin);
    }
  },
};

function corsHeaders(origin) {
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "content-type, x-quark-cookie",
    "access-control-expose-headers": EXPOSED_HEADERS,
    vary: "Origin",
  };
}

function json(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(origin),
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 1000) };
  }
}

function getSetCookies(headers) {
  if (typeof headers.getSetCookie === "function") {
    return headers.getSetCookie();
  }
  const combined = headers.get("set-cookie");
  return combined ? splitCombinedSetCookie(combined) : [];
}

function splitCombinedSetCookie(value) {
  return value.split(/,(?=\s*[^;,=\s]+=[^;,]+)/g).map((item) => item.trim()).filter(Boolean);
}

function mergeCookieStrings(existing, setCookies) {
  const pairs = new Map();
  existing
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .forEach((part) => {
      const eq = part.indexOf("=");
      if (eq > 0) {
        pairs.set(part.slice(0, eq), part.slice(eq + 1));
      }
    });

  for (const setCookie of setCookies) {
    const first = setCookie.split(";")[0]?.trim();
    const eq = first?.indexOf("=") ?? -1;
    if (eq > 0) {
      pairs.set(first.slice(0, eq), first.slice(eq + 1));
    }
  }

  return [...pairs.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

function cookieStringToObjects(cookieString) {
  return cookieString
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const eq = part.indexOf("=");
      return {
        name: part.slice(0, eq),
        value: part.slice(eq + 1),
        domain: ".quark.cn",
        path: "/",
      };
    });
}
