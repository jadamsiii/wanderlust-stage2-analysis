import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const endpoint = process.env.STAGE2_API_URL;
    const token = process.env.STAGE2_SUBMISSION_TOKEN;

    if (!endpoint || !token) {
      return NextResponse.json(
        { ok: false, error: "The Stage 2 analysis service is not configured." },
        { status: 503 },
      );
    }

    const body = await request.json();
    const upstream = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ ...body, token }),
    });

    const text = await upstream.text();
    let result: unknown;
    try {
      result = JSON.parse(text);
    } catch {
      return NextResponse.json(
        { ok: false, error: "The Stage 2 analysis service returned an invalid response." },
        { status: 502 },
      );
    }

    return NextResponse.json(result, { status: upstream.ok ? 200 : 502 });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Stage 2 request failed." },
      { status: 500 },
    );
  }
}
