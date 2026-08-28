/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS: Fetcher;
  STAGE2_API_URL: string;
  STAGE2_SUBMISSION_TOKEN: string;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/stage2" && request.method === "POST") {
      try {
        if (!env.STAGE2_API_URL || !env.STAGE2_SUBMISSION_TOKEN) {
          return Response.json({ ok: false, error: "The Stage 2 analysis service is not configured." }, { status: 503 });
        }
        const body = await request.json<Record<string, unknown>>();
        const upstream = await fetch(env.STAGE2_API_URL, {
          method: "POST",
          headers: { "Content-Type": "text/plain;charset=utf-8" },
          body: JSON.stringify({ ...body, token: env.STAGE2_SUBMISSION_TOKEN }),
        });
        const text = await upstream.text();
        try {
          return Response.json(JSON.parse(text), { status: upstream.ok ? 200 : 502 });
        } catch {
          return Response.json({ ok: false, error: "The Stage 2 analysis service returned an invalid response." }, { status: 502 });
        }
      } catch (error) {
        return Response.json({ ok: false, error: error instanceof Error ? error.message : "Stage 2 request failed." }, { status: 500 });
      }
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(request, env, ctx);
  },
};

export default worker;
