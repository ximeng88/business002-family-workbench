/**
 * 积分流水服务
 *
 * 规则（PRD §6 / design IR-10 / IR-12）：
 * - 余额是 pointLedger 的汇总结果，**不是**可写字段；
 * - 家长手动加减积分必须写流水并记录原因；
 * - 扣减后余额不得为负；
 * - 不提供任何"直接把余额改成 X"的入口；
 * - K18：流水不裁剪、不归档删除。
 *
 * 本轮不实现兑换页面；兑换确认时的扣分复用 adjustPoints 的同一套余额校验。
 */

import Dexie from "dexie"
import { getDb } from "../db/database.js"
import { DbError, DB_ERROR_CODES, wrapDbError } from "../db/errors.js"
import { toIsoTimestamp } from "../db/date.js"
import { makeId } from "../db/ids.js"

export const LEDGER_SOURCE = Object.freeze({
  TASK: "task",
  REDEEM: "redeem",
  MANUAL: "manual",
})

/** 手动调整原因长度上限（design IR-12: ≤30 字） */
export const MANUAL_REASON_MAX_LENGTH = 30

function assertChildId(childId) {
  if (typeof childId !== "string" || childId.trim() === "") {
    throw new DbError(DB_ERROR_CODES.VALIDATION_FAILED, "childId 必须是非空字符串", { context: { childId } })
  }
}

function sumDeltas(entries) {
  return entries.reduce((total, entry) => total + (Number.isFinite(entry?.delta) ? entry.delta : 0), 0)
}

/**
 * 从流水实时汇总余额（唯一权威算法）。
 * @param {string} childId
 * @param {import("dexie").default} [db]
 * @returns {Promise<{ childId: string, balance: number, entryCount: number }>}
 */
export async function getBalance(childId, db = getDb()) {
  assertChildId(childId)
  const entries = await db.pointLedger.where("childId").equals(childId).toArray()
  return { childId, balance: sumDeltas(entries), entryCount: entries.length }
}

/** 重算余额（当前没有余额缓存，等价于从流水汇总；保留为显式接口，便于将来加缓存后校验） */
export async function recalculateBalance(childId, db = getDb()) {
  return getBalance(childId, db)
}

/**
 * 分页读取积分流水（时间倒序）。只做分页，不做时间裁剪。
 * @param {string} childId
 * @param {{ limit?: number, offset?: number, db?: import("dexie").default }} [options]
 */
export async function listLedger(childId, { limit = 30, offset = 0, db = getDb() } = {}) {
  assertChildId(childId)
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new DbError(DB_ERROR_CODES.VALIDATION_FAILED, "limit 必须是正整数", { context: { limit } })
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw new DbError(DB_ERROR_CODES.VALIDATION_FAILED, "offset 必须是非负整数", { context: { offset } })
  }
  return db.pointLedger
    .where("[childId+createdAt]")
    .between([childId, Dexie.minKey], [childId, Dexie.maxKey])
    .reverse()
    .offset(offset)
    .limit(limit)
    .toArray()
}

/**
 * 家长手动调整积分：写一条流水，余额由流水派生。
 *
 * @param {{
 *   childId: string,
 *   delta: number,
 *   reason: string,
 *   actor?: string,
 *   now?: Date,
 *   db?: import("dexie").default,
 * }} options
 * @returns {Promise<{ balance: number, previousBalance: number, entry: Record<string, unknown> }>}
 */
export async function adjustPoints({
  childId,
  delta,
  reason,
  actor = "parent",
  now = new Date(),
  db = getDb(),
} = {}) {
  assertChildId(childId)
  if (!Number.isInteger(delta) || delta === 0) {
    throw new DbError(DB_ERROR_CODES.VALIDATION_FAILED, "调整值必须是非零整数", { context: { childId, delta } })
  }
  const trimmedReason = typeof reason === "string" ? reason.trim() : ""
  if (!trimmedReason) {
    throw new DbError(DB_ERROR_CODES.VALIDATION_FAILED, "手动调整积分必须填写原因", { context: { childId, delta } })
  }
  if (trimmedReason.length > MANUAL_REASON_MAX_LENGTH) {
    throw new DbError(DB_ERROR_CODES.VALIDATION_FAILED, `原因不能超过 ${MANUAL_REASON_MAX_LENGTH} 字`, {
      context: { childId, length: trimmedReason.length },
    })
  }

  const createdAt = toIsoTimestamp(now)
  const entryId = makeId("lgr")

  try {
    return await db.transaction("rw", db.pointLedger, async () => {
      const entries = await db.pointLedger.where("childId").equals(childId).toArray()
      const previousBalance = sumDeltas(entries)
      const nextBalance = previousBalance + delta

      if (nextBalance < 0) {
        throw new DbError(
          DB_ERROR_CODES.VALIDATION_FAILED,
          `积分不足：当前 ${previousBalance} 分，本次需要扣减 ${Math.abs(delta)} 分`,
          { context: { childId, previousBalance, delta, rule: "balance-must-not-be-negative" } },
        )
      }

      const entry = {
        id: entryId,
        childId,
        delta,
        reason: trimmedReason,
        source: LEDGER_SOURCE.MANUAL,
        actor,
        eventKey: `manual:${entryId}`,
        createdAt,
      }
      await db.pointLedger.add(entry)

      return { balance: nextBalance, previousBalance, entry }
    })
  } catch (error) {
    if (error instanceof DbError) throw error
    throw wrapDbError(error, { phase: "transaction", context: { childId, delta } })
  }
}
