import { NextRequest, NextResponse } from "next/server";

/**
 * Same-origin proxy to the car SoftAP / LAN IP.
 * Browser → localhost (no mixed-content / PNA issues) → Node → car.
 */
const DEFAULT_CAR = "192.168.4.1";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ path?: string[] }> },
) {
  const { path = [] } = await ctx.params;
  const carIp = req.nextUrl.searchParams.get("ip") || DEFAULT_CAR;
  const sub = path.join("/") || "api/status";
  const url = `http://${carIp}/${sub}`;

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 4000);
  try {
    const res = await fetch(url, {
      method: "GET",
      cache: "no-store",
      signal: ctrl.signal,
      headers: { Accept: "application/json,*/*" },
    });
    const body = await res.text();
    return new NextResponse(body, {
      status: res.status,
      headers: {
        "Content-Type":
          res.headers.get("Content-Type") || "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "proxy_fail";
    return NextResponse.json(
      { ok: false, error: msg, tried: url },
      { status: 502 },
    );
  } finally {
    clearTimeout(t);
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Allow-Private-Network": "true",
    },
  });
}
