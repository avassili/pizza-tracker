import { NextRequest, NextResponse } from "next/server";
import { DEFAULT_TENANT_CONFIG } from "@/domain/config/schema";
import { toTrackerViewModel } from "@/domain/fsm/selectors";
import { createDynamoOrderRepository } from "@/infra/dynamodb/orderRepository";

function matchesIfNoneMatch(headerValue: string | null, etag: string): boolean {
  if (!headerValue) return false;
  const trimmed = headerValue.trim();
  if (trimmed === "*") return true;
  return trimmed
    .split(",")
    .map((tag) => tag.trim())
    .some((tag) => tag === etag || tag === etag.replace(/^W\//, ""));
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ tenant: string; token: string }> },
): Promise<NextResponse> {
  const { tenant, token } = await ctx.params;

  const repo = createDynamoOrderRepository();
  const order = await repo.getOrderByPublicToken(token);

  // Never distinguish unknown token from wrong-tenant token (return 404).
  if (!order || order.tenantId !== tenant) {
    return NextResponse.json(
      { ok: false, error: { code: "NOT_FOUND", message: "Order not found" } },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }

  const etag = `W/"${order.version}"`;
  if (matchesIfNoneMatch(req.headers.get("if-none-match"), etag)) {
    return new NextResponse(null, {
      status: 304,
      headers: {
        ETag: etag,
        "Cache-Control": "no-store",
      },
    });
  }

  const localeParam = req.nextUrl.searchParams.get("locale")?.trim() || undefined;
  const config = { ...DEFAULT_TENANT_CONFIG, tenantId: order.tenantId };
  const view = toTrackerViewModel(config, order, Date.now(), localeParam);

  return NextResponse.json(view, {
    status: 200,
    headers: {
      ETag: etag,
      "Cache-Control": "no-store",
    },
  });
}
