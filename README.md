# AO3 反向代理 Worker

一個國中生花了幾小時寫的 Cloudflare Workers 小工具。把 `worker.js` 貼到 Cloudflare 就能用，用 Worker 網域轉發 `archiveofourown.org`（AO3），並移除 iframe 限制、改寫連結與重定向。

> ⚠️ 非官方專案，不保證 100% 可用，請自行評估風險。

---

## 🚀 部署（3 步）

1. 登入 [Cloudflare Dashboard](https://dash.cloudflare.com) → **Workers & Pages** → **Create Worker**
2. 建立 Worker（例如 `ao3-proxy`）→ **Deploy**
3. 點 **Edit code**，貼上下方程式碼 → **Deploy**

完成後用 `https://你的子網域.workers.dev` 就能透過代理打開 AO3。

---

## 📄 worker.js

```js
export default {
  async fetch(request, env, ctx) {
    const TARGET_HOST = "archiveofourown.org";
    const url = new URL(request.url);

    // 1. 把請求指向 AO3
    url.hostname = TARGET_HOST;
    url.protocol = "https:";
    url.port = "";

    // 2. 建構轉發請求
    const newRequest = new Request(url.toString(), {
      method: request.method,
      headers: request.headers,
      body: request.method !== "GET" && request.method !== "HEAD" ? request.body : null,
      redirect: "follow",
    });

    // 3. 設定 Host 標頭，避免 AO3 拒絕請求
    newRequest.headers.set("Host", TARGET_HOST);
    newRequest.headers.set("Referer", `https://${TARGET_HOST}/`);

    try {
      const response = await fetch(newRequest);

      // 4. 移除 iframe / CSP 限制
      const newHeaders = new Headers(response.headers);
      newHeaders.delete("X-Frame-Options");
      newHeaders.delete("Content-Security-Policy");
      newHeaders.delete("X-Content-Type-Options");

      // 5. 改寫重定向 Location
      const location = newHeaders.get("Location");
      if (location) {
        newHeaders.set(
          "Location",
          location.replace(`https://${TARGET_HOST}`, `https://${url.hostname}`)
        );
      }

      // 6. HTML 用 HTMLRewriter 改寫連結
      const contentType = newHeaders.get("Content-Type") || "";
      if (contentType.includes("text/html")) {
        class AttrRewriter {
          constructor(attr) {
            this.attr = attr;
          }
          element(el) {
            const val = el.getAttribute(this.attr);
            if (val && val.includes(TARGET_HOST)) {
              el.setAttribute(
                this.attr,
                val
                  .replaceAll(`https://${TARGET_HOST}`, `https://${url.hostname}`)
                  .replaceAll(`http://${TARGET_HOST}`, `https://${url.hostname}`)
              );
            }
            if (val && val.startsWith("/") && !val.startsWith("//")) {
              el.setAttribute(this.attr, `https://${url.hostname}${val}`);
            }
          }
        }

        const rewriter = new HTMLRewriter()
          .on("a", new AttrRewriter("href"))
          .on("link", new AttrRewriter("href"))
          .on("script", new AttrRewriter("src"))
          .on("img", new AttrRewriter("src"))
          .on("img", new AttrRewriter("srcset"));

        return rewriter.transform(
          new Response(response.body, {
            status: response.status,
            headers: newHeaders,
          })
        );
      }

      // 非 HTML 資源直接回傳
      return new Response(response.body, {
        status: response.status,
        headers: newHeaders,
      });
    } catch (e) {
      return new Response(`Proxy error: ${e.message}`, { status: 502 });
    }
  },
};
```

---

## 🧩 原理

```
瀏覽器 → 你的 Worker → 改寫成 AO3 → AO3 回應
                              ↓
        Worker 處理：移除 iframe 限制 → 改寫連結 / 重定向 → 回傳
```

| 動作 | 作用 |
| --- | --- |
| `url.hostname = TARGET_HOST` | 把請求位址改成 AO3 |
| 設定 `Host` / `Referer` | 避免被 AO3 拒絕 |
| 刪除 `X-Frame-Options` / `CSP` | 允許 iframe 嵌入 |
| `HTMLRewriter` | 串流改寫 HTML 連結 |
| 替換 `Location` | 重定向後仍停在你的網域 |

---

## ❓ FAQ

- **白畫面 / 報錯？** 部分頁面依賴 Cookie、登入狀態或 CSRF，代理不一定完整轉發，屬正常。
- **登入 / 發文 / 按讚能用嗎？** 不保證，本工具主要面向「瀏覽」。
- **綁自己的網域？** Worker 設定 → **Triggers → Custom Domains**。
- **免費額度？** 每天 10 萬次請求，個人瀏覽基本夠用。
- **會違規嗎？** 有可能。請遵守 Cloudflare 與 AO3 條款，勿用於大規模擷取或繞過限制。

---

## ⚠️ 免責聲明

本專案僅供**學習與技術交流**，非官方專案，與 AO3、Cloudflare 無關。使用產生的一切後果由使用者自行承擔，作者不負任何責任。請勿用於商業或違規用途。

---

## 📝 MIT License

Copyright (c) 2026 Xiaobocm

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
