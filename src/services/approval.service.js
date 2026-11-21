/**
 * 审核通过服务：五表原子事务
 *
 * 冻结规则（不得回退）：
 * - 任务四状态：todo / submitted / approved / revision
 * - 审核通过 = tasks + reviews + pointLedger + petProgress + streaks 同一事务
 * - 事件幂等键 `approval:${taskId}`
 * - 宠物经验与积分**分开记账**，不得共用字段或常量
 *
 * 事务纪律：
 * - 事务回调内只做 IndexedDB 操作，不做任何其它异步；
 * - 任一步失败整体回滚；
 * - 事务返回后调用方才可更新 UI（本服务不碰 UI）。
 */

import { getDb } from "../db/database.js"
import { DbError, DB_ERROR_CODES, wrapDbError } from "../db/errors.js"
import { toLocalDateKey, toIsoTimestamp } from "../db/date.js"
import { makeId } from "../db/ids.js"

export const TASK_STATUS = Object.freeze({
  TODO: "todo",
  SUBMITTED: "submitted",
  APPROVED: "approved",
  REVISION: "revision",
})

export const APPROVAL_RESULT = Object.freeze({
  APPROVED: "approved",
  DUPLICATE: "duplicate",
  ALREADY_APPROVED: "already-approved",
})

/**
 * Q-05 待 Owner 确认：宠物经验与积分的比例。
 * 抽成常量，业务判断里不出现字面量；改为其它系数时只改这里（或调用方覆盖）。
 */
export const EXP_PER_POINT = 1 // TODO(decision: Q-05)

export function approvalEventKey(taskId) {
  return `approval:${taskId}`
}

/** 退回原因长度上限（design IR-14：给孩子的说明要短、能读完） */
export const REVISION_REASON_MAX_LENGTH = 60

function assertTaskId(taskId) {
  if (typeof taskId !== "string" || taskId.trim() === "") {
    throw new DbError(DB_ERROR_CODES.VALIDATION_FAILED, "taskId 必须是非空字符串", { context: { taskId } })
  }
}

/**
 * 家长审核通过一个任务。
 *
 * @param {{
 *   taskId: string,
 *   reviewerId?: string,
 *   reviewer?: string,
 *   now?: Date,
 *   expPerPoint?: number,
 *   db?: import("dexie").default,
 * }} options
 * @returns {Promise<
 *   | { status: "approved", taskId: string, childId: string, approvalDate: string, approvedAt: string, points: number, exp: number, eventKey: string, reviewId: string, ledgerId: string, petId: string, streakId: string }
 *   | { status: "duplicate", taskId: string, childId?: string, eventKey: string, approvalDate?: string | null }
 *   | { status: "already-approved", taskId: string, childId?: string, approvalDate?: string | null }
 * >}
 */
export async function approveTask({
  taskId,
  reviewerId = "parent",
  reviewer = reviewerId,
  now = new Date(),
  expPerPoint = EXP_PER_POINT,
  db = getDb(),
} = {}) {
  assertTaskId(taskId)
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new DbError(DB_ERROR_CODES.VALIDATION_FAILED, "now 必须是有效的 Date")
  }
  if (typeof expPerPoint !== "number" || !Number.isFinite(expPerPoint) || expPerPoint < 0) {
    throw new DbError(DB_ERROR_CODES.VALIDATION_FAILED, "expPerPoint 必须是非负数字", {
      context: { expPerPoint },
    })
  }

  // 日期级：按本地自然日记录实际审核日期，不用 dueDate 代替（PRD §8.2）
  const approvalDate = toLocalDateKey(now)
  const approvedAt = toIsoTimestamp(now)
  const eventKey = approvalEventKey(taskId)

  // 主键在事务外生成（crypto.randomUUID 是同步的，但避免事务内做任何非 IDB 动作）
  const reviewId = makeId("rev")
  const ledgerId = makeId("lgr")
  const petId = makeId("exp")

  try {
    return await db.transaction(
      "rw",
      db.tasks,
      db.reviews,
      db.pointLedger,
      db.petProgress,
      db.streaks,
      async () => {
        // 幂等第一道：同一 approval:${taskId} 已存在则直接返回，不写任何表
        const existingEvent = await db.reviews.where("eventKey").equals(eventKey).first()
        if (existingEvent) {
          return {
            status: APPROVAL_RESULT.DUPLICATE,
            taskId,
            childId: existingEvent.childId,
            eventKey,
            approvalDate: existingEvent.approvalDate ?? null,
          }
        }

        const task = await db.tasks.get(taskId)
        if (!task) {
          throw new DbError(DB_ERROR_CODES.VALIDATION_FAILED, `任务不存在：${taskId}`, {
            context: { taskId },
          })
        }
        if (task.status === TASK_STATUS.APPROVED) {
          return {
            status: APPROVAL_RESULT.ALREADY_APPROVED,
            taskId,
            childId: task.childId,
            approvalDate: task.approvalDate ?? null,
          }
        }
        if (task.status !== TASK_STATUS.SUBMITTED) {
          throw new DbError(
            DB_ERROR_CODES.VALIDATION_FAILED,
            "只有「待家长确认」的任务才能审核通过",
            { context: { taskId, status: task.status } },
          )
        }
        if (!Number.isInteger(task.points) || task.points < 0) {
          throw new DbError(DB_ERROR_CODES.VALIDATION_FAILED, "任务积分数必须是大于等于 0 的整数", {
            context: { taskId, points: task.points },
          })
        }

        const points = task.points
        const exp = Math.round(points * expPerPoint)
        if (!Number.isInteger(exp) || exp < 0) {
          throw new DbError(DB_ERROR_CODES.VALIDATION_FAILED, "宠物经验值计算异常", {
            context: { taskId, points, expPerPoint },
          })
        }

        // ① tasks：状态 → approved，写 approvedAt / approvalDate
        await db.tasks.update(taskId, {
          status: TASK_STATUS.APPROVED,
          approvedAt,
          approvalDate,
        })

        // ② reviews：审核记录
        await db.reviews.add({
          id: reviewId,
          taskId,
          childId: task.childId,
          result: "approved",
          reason: null,
          reviewer,
          reviewedAt: approvedAt,
          approvalDate,
          eventKey,
        })

        // ③ pointLedger：积分奖励流水（独立账本）
        await db.pointLedger.add({
          id: ledgerId,
          childId: task.childId,
          delta: points,
          reason: `完成「${task.title}」`,
          source: "task",
          taskId,
          approvalDate,
          eventKey,
          createdAt: approvedAt,
        })

        // ④ petProgress：宠物经验流水（与积分分开记录）
        await db.petProgress.add({
          id: petId,
          childId: task.childId,
          delta: exp,
          taskId,
          approvalDate,
          eventKey,
          createdAt: approvedAt,
        })

        // ⑤ streaks：按实际审核通过日期记账（补交不回填原任务日期）
        const streakId = `${task.childId}:${approvalDate}`
        const existingStreak = await db.streaks
          .where("[childId+date]")
          .equals([task.childId, approvalDate])
          .first()
        if (existingStreak) {
          await db.streaks.update(existingStreak.id, {
            approvedCount: (existingStreak.approvedCount ?? 0) + 1,
            updatedAt: approvedAt,
          })
        } else {
          await db.streaks.add({
            id: streakId,
            childId: task.childId,
            date: approvalDate,
            approvedCount: 1,
            createdAt: approvedAt,
            updatedAt: approvedAt,
          })
        }

        return {
          status: APPROVAL_RESULT.APPROVED,
          taskId,
          childId: task.childId,
          approvalDate,
          approvedAt,
          points,
          exp,
          eventKey,
          reviewId,
          ledgerId,
          petId,
          streakId: existingStreak?.id ?? streakId,
        }
      },
    )
  } catch (error) {
    if (error instanceof DbError) throw error

    // 唯一索引冲突的兜底：事务已整体回滚，此时若通过事件已落库，说明是重复请求
    if (error?.name === "ConstraintError") {
      let duplicate = null
      try {
        duplicate = await db.reviews.where("eventKey").equals(eventKey).first()
      } catch {
        duplicate = null
      }
      if (duplicate) {
        return {
          status: APPROVAL_RESULT.DUPLICATE,
          taskId,
          childId: duplicate.childId,
          eventKey,
          approvalDate: duplicate.approvalDate ?? null,
        }
      }
    }

    throw wrapDbError(error, { phase: "transaction", context: { taskId, eventKey } })
  }
}

/**
 * 家长退回一个任务：tasks.status → revision，并写一条 reviews(result="revision")。
 *
 * 纪律（R-02，写代码前必须守）：
 * - **退回记录不写 `eventKey` 属性**：不是 `""`、`null` 或 `undefined`。
 *   `reviews` 有 `&eventKey` 唯一索引，空字符串是合法键值，会与下一次退回撞键；
 *   只有"属性不存在"时才不进入唯一索引。
 * - 不发积分、不发宠物经验、不改 streaks：退回不是完成。
 * - 只改 tasks + reviews 两张表，同一读写事务；任一步失败整体回滚。
 *
 * @param {{
 *   taskId: string,
 *   reason?: string,
 *   reviewerId?: string,
 *   reviewer?: string,
 *   now?: Date,
 *   db?: import("dexie").default,
 * }} options
 * @returns {Promise<{
 *   status: "revision",
 *   taskId: string,
 *   childId: string,
 *   revisionReason: string | null,
 *   returnCount: number,
 *   reviewId: string,
 *   reviewedAt: string,
 * }>}
 */
export async function rejectTask({
  taskId,
  reason = "",
  reviewerId = "parent",
  reviewer = reviewerId,
  now = new Date(),
  db = getDb(),
} = {}) {
  assertTaskId(taskId)
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new DbError(DB_ERROR_CODES.VALIDATION_FAILED, "now 必须是有效的 Date")
  }
  if (reason !== undefined && reason !== null && typeof reason !== "string") {
    throw new DbError(DB_ERROR_CODES.VALIDATION_FAILED, "退回原因必须是字符串", {
      context: { taskId, reasonType: typeof reason },
    })
  }

  const trimmedReason = typeof reason === "string" ? reason.trim() : ""
  if (trimmedReason.length > REVISION_REASON_MAX_LENGTH) {
    throw new DbError(
      DB_ERROR_CODES.VALIDATION_FAILED,
      `退回原因不能超过 ${REVISION_REASON_MAX_LENGTH} 字`,
      { context: { taskId, length: trimmedReason.length } },
    )
  }

  // 主键在事务外生成，事务内只做 IndexedDB 操作
  const reviewId = makeId("rev")
  const reviewedAt = toIsoTimestamp(now)

  try {
    return await db.transaction("rw", db.tasks, db.reviews, async () => {
      const task = await db.tasks.get(taskId)
      if (!task) {
        throw new DbError(DB_ERROR_CODES.VALIDATION_FAILED, `任务不存在：${taskId}`, {
          context: { taskId },
        })
      }
      if (task.status === TASK_STATUS.APPROVED) {
        throw new DbError(DB_ERROR_CODES.VALIDATION_FAILED, "已通过的任务不能退回", {
          context: { taskId, status: task.status },
        })
      }
      if (task.status !== TASK_STATUS.SUBMITTED) {
        throw new DbError(
          DB_ERROR_CODES.VALIDATION_FAILED,
          "只有「待家长确认」的任务才能退回",
          { context: { taskId, status: task.status } },
        )
      }

      const returnCount = (Number.isInteger(task.returnCount) ? task.returnCount : 0) + 1

      // 用 put 写回整条记录：没有原因时必须让 revisionReason 这个键**不存在**，
      // 而不是留一条空字符串或 undefined，避免界面把空串当成"家长说了什么"。
      const nextTask = { ...task, status: TASK_STATUS.REVISION, returnCount }
      if (trimmedReason) {
        nextTask.revisionReason = trimmedReason
      } else {
        delete nextTask.revisionReason
      }
      await db.tasks.put(nextTask)

      const review = {
        id: reviewId,
        taskId,
        childId: task.childId,
        result: "revision",
        reason: trimmedReason || null,
        reviewer,
        reviewedAt,
        // 注意：这里没有 eventKey —— 见函数头 R-02 说明
      }
      await db.reviews.add(review)

      return {
        status: TASK_STATUS.REVISION,
        taskId,
        childId: task.childId,
        revisionReason: trimmedReason || null,
        returnCount,
        reviewId,
        reviewedAt,
      }
    })
  } catch (error) {
    if (error instanceof DbError) throw error
    throw wrapDbError(error, { phase: "transaction", context: { taskId, action: "reject" } })
  }
}
