const routeHandlers = {
  async gist(request, url, env) {
    const [token, key] = ["token", "key"].map((p) => url.searchParams.get(p));
    const { githubUser, githubId } = ((v) => (v ? JSON.parse(v) : {}))(
      await env.GIST_TOKEN.get(token),
    );
    if (githubUser && githubId) {
      const gistContent = await fetch(
        `https://gist.githubusercontent.com/${githubUser}/${githubId}/raw/${key}?t=${Date.now()}`,
      );
      return new Response(await gistContent.text(), {
        status: gistContent.status,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        },
      });
    }
  },

  async release(request, url, env) {
    const [token, filename, tag] = ["token", "filename", "tag"].map((p) =>
      url.searchParams.get(p),
    );
    const { githubUser, githubRepo, githubPat } = ((v) =>
      v ? JSON.parse(v) : {})(await env.RELEASE_TOKEN.get(token));
    if (githubUser && githubRepo && githubPat) {
      const targetAsset = (
        await (
          await fetch(
            tag
              ? `https://api.github.com/repos/${githubUser}/${githubRepo}/releases/tags/${tag}`
              : `https://api.github.com/repos/${githubUser}/${githubRepo}/releases/latest`,
            {
              headers: {
                Authorization: `Bearer ${githubPat}`,
                Accept: "application/vnd.github+json",
                "User-Agent": "cfworker",
              },
            },
          )
        ).json()
      ).assets?.find((a) => a.name === filename);
      if (targetAsset) {
        const assetResp = await fetch(targetAsset.url, {
          headers: {
            Authorization: `Bearer ${githubPat}`,
            Accept: targetAsset.content_type,
            "User-Agent": "cfworker",
          },
          redirect: "follow",
        });
        return new Response(assetResp.body, {
          status: assetResp.status,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Content-Type": targetAsset.content_type,
            "Content-Disposition": `attachment; filename="${filename}"`,
          },
        });
      }
    }
  },

  async raw(request, url) {
    const inputPath = url.pathname.replace("/raw", "");
    const domains = {
      "raw.githubusercontent.com": {
        prefix: "/raw.githubusercontent.com",
        allowPaths: null,
      },
      "github.com": {
        prefix: "/github.com",
        allowPaths: ["/releases/download/", "/archive/"],
      },
    };

    for (const [domain, { prefix, allowPaths }] of Object.entries(domains)) {
      if (inputPath.startsWith(prefix)) {
        const githubPath = inputPath.slice(prefix.length);
        if (
          !allowPaths ||
          allowPaths.some((path) => githubPath.includes(path))
        ) {
          const targetUrl = `https://${domain}${githubPath}`;
          const response = await fetch(targetUrl, { redirect: "follow" });
          const contentType =
            response.headers.get("Content-Type") || "application/octet-stream";
          return new Response(response.body, {
            status: response.status,
            headers: {
              "Access-Control-Allow-Origin": "*",
              "Access-Control-Allow-Methods": "GET, OPTIONS",
              "Access-Control-Allow-Headers": "Content-Type",
              "Content-Type": contentType,
            },
          });
        }
        break;
      }
    }
  },
};

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    const url = new URL(request.url);
    const pathname = url.pathname;

    const routes = {
      "/gist": () => routeHandlers.gist(request, url, env),
      "/release": () => routeHandlers.release(request, url, env),
      "/raw": () => routeHandlers.raw(request, url),
    };

    for (const [route, handler] of Object.entries(routes)) {
      if (pathname === route || pathname.startsWith(route)) {
        return await handler();
      }
    }
  },
};
