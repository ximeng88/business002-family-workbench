/**
 * 连续学习天数（Q-02 建议口径，M1 展示用）。
 *
 * 口径（待 Owner 最终确认，抽在常量里便于整块替换）：
 * - 以"实际审核通过日期"为一天（`streaks.date`），不用任务截止日；
 * - 今天有通过 → 从今天往前数连续天数；
 * - 今天没有、昨天有 → 连续天数仍然"活着"，从昨天往前数；
 * - 最后一天 ≤ 前天 → 归零。
 *
 * 本模块只读 `streaks`，不写任何表；streaks 的写入在审核通过事务里。
 */

import { getDb } from "../db/database.js"
import { DbError, DB_ERROR_CODES, wrapDbError } from "../db/errors.js"
import { isDateKey, shiftDateKey, toLocalDateKey } from "../db/date.js"

/** 日期键平移复用 db/date.js 的实现；此处继续导出，保持调用方稳定。 */
export { shiftDateKey }

export const STREAK_RULE = Object.freeze({
  /** 允许"今天还没通过、昨天通过过"仍然保留连续记录 */
  KEEP_ALIVE_DAYS: 2,
})

function assertChildId(childId) {
  if (typeof childId !== "string" || childId.trim() === "") {
    throw new DbError(DB_ERROR_CODES.VALIDATION_FAILED, "childId 必须是非空字符串", { context: { childId } })
  }
}

/**
 * 计算当前连续学习天数。
 *
 * @param {string} childId
 * @param {{ now?: Date, db?: import("dexie").default }} [options]
 * @returns {Promise<{ childId: string, days: number, lastDate: string | null, countedToday: boolean }>}
 */
export async function getCurrentStreak(childId, { now = new Date(), db = getDb() } = {}) {
  assertChildId(childId)
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new DbError(DB_ERROR_CODES.VALIDATION_FAILED, "now 必须是有效的 Date")
  }

  let records
  try {
    records = await db.streaks.where("childId").equals(childId).toArray()
  } catch (error) {
    throw wrapDbError(error, { phase: "read", context: { childId, table: "streaks" } })
  }

  const active = new Set(
    records
      .filter((record) => isDateKey(record?.date) && Number(record?.approvedCount) > 0)
      .map((record) => record.date),
  )

  const today = toLocalDateKey(now)
  const yesterday = shiftDateKey(today, -1)
  const countedToday = active.has(today)
  const start = countedToday ? today : yesterday

  if (!active.has(start)) {
    return { childId, days: 0, lastDate: null, countedToday: false }
  }

  let days = 0
  let cursor = start
  while (active.has(cursor)) {
    days += 1
    cursor = shiftDateKey(cursor, -1)
  }

  return { childId, days, lastDate: start, countedToday }
}
