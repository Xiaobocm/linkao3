export default {
  async fetch(request, env, ctx) {
    const TARGET_HOST = "archiveofourown.org";
    const url = new URL(request.url);

    // 1. 把请求指向 AO3
    url.hostname = TARGET_HOST;
    url.protocol = "https:";
    url.port = "";

    // 2. 构造转发请求，带上必要的请求头
    const newRequest = new Request(url.toString(), {
      method: request.method,
      headers: request.headers,
      body: request.method !== "GET" && request.method !== "HEAD" ? request.body : null,
      redirect: "follow",
    });

    // 3. 设置 Host 头，避免 AO3 拒绝请求
    newRequest.headers.set("Host", TARGET_HOST);
    newRequest.headers.set("Referer", `https://${TARGET_HOST}/`);

    try {
      const response = await fetch(newRequest);

      // 4. 关键：移除 X-Frame-Options，允许 iframe 嵌入
      const newHeaders = new Headers(response.headers);
      newHeaders.delete("X-Frame-Options");
      newHeaders.delete("Content-Security-Policy"); // 部分页面也有 CSP 限制
      newHeaders.delete("X-Content-Type-Options");

      // 5. 处理重定向：把 Location 里的 AO3 域名替换回你的 Worker 域名
      const location = newHeaders.get("Location");
      if (location) {
        newHeaders.set("Location", location.replace(`https://${TARGET_HOST}`, `https://${url.hostname}`));
      }

      // 6. 如果返回的是 HTML，用 HTMLRewriter 重写链接
      const contentType = newHeaders.get("Content-Type") || "";
      if (contentType.includes("text/html")) {
        class AttrRewriter {
          constructor(attr) { this.attr = attr; }
          element(el) {
            const val = el.getAttribute(this.attr);
            if (val && val.includes(TARGET_HOST)) {
              el.setAttribute(this.attr, val.replaceAll(`https://${TARGET_HOST}`, `https://${url.hostname}`).replaceAll(`http://${TARGET_HOST}`, `https://${url.hostname}`));
            }
            // 处理相对路径（以 / 开头的链接指向 AO3）
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

        return rewriter.transform(new Response(response.body, {
          status: response.status,
          headers: newHeaders,
        }));
      }

      // 非 HTML 资源（CSS/JS/图片）直接返回
      return new Response(response.body, {
        status: response.status,
        headers: newHeaders,
      });
    } catch (e) {
      return new Response(`Proxy error: ${e.message}`, { status: 502 });
    }
  },
};
