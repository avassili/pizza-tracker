/**
 * Local console notification driver.
 * See DESIGN.md §3.3 and docs/TACTICAL-DESIGN.md §11.
 *
 * Emits structured JSON lines to stdout in development so no SES/SNS calls
 * are ever made offline.
 */

import type { NotificationIntent } from "@/domain/fsm/types";

export function emitNotices(requestId: string, notices: readonly NotificationIntent[]): void {
  if (notices.length === 0) return;
  for (const notice of notices) {
    console.log(
      JSON.stringify({
        driver: process.env.NOTIFICATION_DRIVER ?? "console",
        requestId,
        ...notice,
      }),
    );
  }
}
