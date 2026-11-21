/**
 * M0 任务与 Seed 服务。
 * 固定任务模板、连续天数算法、附件和历史入口均不在本模块实现。
 */

import { getDb } from "../db/database.js"
import { DbError, DB_ERROR_CODES, wrapDbError } from "../db/errors.js"
import { isDateKey, shiftDateKey, toIsoTimestamp, toLocalDateKey } from "../db/date.js"
import { makeId } from "../db/ids.js"
import { TASK_STATUS } from "./approval.service.js"

export const M0_CHILD_ID = "c_m0"

export const M0_SEED_TASKS = Object.freeze([
  Object.freeze({ id: "t_seed_01", title: "整理书包", points: 5 }),
  Object.freeze({ id: "t_seed_02", title: "朗读课文", points: 10 }),
  Object.freeze({ id: "t_seed_03", title: "数学口算", points: 10 }),
  Object.freeze({ id: "t_seed_04", title: "收拾书桌", points: 5 }),
  Object.freeze({ id: "t_seed_05", title: "亲子阅读", points: 15 }),
])

function assertNonEmptyString(value, name) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new DbError(DB_ERROR_CODES.VALIDATION_FAILED, `${name} 必须是非空字符串`, {
      context: { [name]: value },
    })
  }
}

/** 创建一条临时任务；临时任务不写 templateId / generationKey。 */
export async function createTask(input = {}) {
  const { childId, title, points, dueDate = toLocalDateKey() } = input
  assertNonEmptyString(childId, "childId")
  assertNonEmptyString(title, "title")
  if (!Number.isInteger(points) || points < 0) {
    throw new DbError(DB_ERROR_CODES.VALIDATION_FAILED, "points 必须是大于等于 0 的整数", {
      context: { points },
    })
  }
  if (!isDateKey(dueDate)) {
    throw new DbError(DB_ERROR_CODES.VALIDATION_FAILED, "dueDate 必须是真实的 YYYY-MM-DD 日期", {
      context: { dueDate },
    })
  }

  const task = {
    id: makeId("task"),
    childId,
    title: title.trim(),
    points,
    type: "temp",
    status: TASK_STATUS.TODO,
    dueDate,
    createdAt: toIsoTimestamp(),
  }

  const db = getDb()
  try {
    return await db.transaction("rw", db.children, db.tasks, async () => {
      // 不允许给不存在的孩子布置任务：宁可报错，也不留下孤立的 task
      if (!(await db.children.get(childId))) {
        throw new DbError(DB_ERROR_CODES.VALIDATION_FAILED, "孩子不存在，无法布置任务", {
          context: { childId },
        })
      }
      await db.tasks.add(task)
      return task
    })
  } catch (error) {
    if (error instanceof DbError) throw error
    throw wrapDbError(error, { phase: "transaction", context: { childId, taskId: task.id } })
  }
}

/** 查询孩子今天的任务，包含四种状态，供孩子端与家长确认页共同使用。 */
export async function listTodayTasks(childId) {
  assertNonEmptyString(childId, "childId")
  try {
    const tasks = await getDb()
      .tasks.where("[childId+dueDate]")
      .equals([childId, toLocalDateKey()])
      .toArray()
    return tasks.sort((a, b) => {
      const byCreatedAt = String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? ""))
      return byCreatedAt || String(a.id).localeCompare(String(b.id))
    })
  } catch (error) {
    throw wrapDbError(error, { phase: "read", context: { childId } })
  }
}

/**
 * 查询孩子的逾期未完成任务：`dueDate < 今天` 且未通过。
 *
 * 纪律：
 * - 查询取全量，**不在查询阶段 limit**；折叠只发生在渲染层；
 * - 已通过的历史任务不算逾期，不进这个列表（历史回看不在 M1 范围）；
 * - 补交时 `submitTask` 照常可用，审核通过仍按**实际审核日期**记 streak（不回填原日期）。
 */
export async function listOverdueTasks(childId) {
  assertNonEmptyString(childId, "childId")
  const today = toLocalDateKey()
  try {
    const tasks = await getDb()
      .tasks.where("[childId+dueDate]")
      // 下界用 ""：任何 YYYY-MM-DD 都大于空字符串，无需依赖 Dexie.minKey
      .between([childId, ""], [childId, today], true, false)
      .toArray()
    return tasks
      .filter((task) => task.status !== TASK_STATUS.APPROVED)
      .sort((a, b) => {
        const byDue = String(a.dueDate ?? "").localeCompare(String(b.dueDate ?? ""))
        return byDue || String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? ""))
      })
  } catch (error) {
    throw wrapDbError(error, { phase: "read", context: { childId } })
  }
}

/**
 * 查询接下来 N 天内（不含今天）已经安排的任务，供家长端「接下来几天」确认布置结果。
 * 只读，不改变今天/逾期的口径。
 */
export async function listUpcomingTasks(childId, { days = 7 } = {}) {
  assertNonEmptyString(childId, "childId")
  if (!Number.isInteger(days) || days <= 0) {
    throw new DbError(DB_ERROR_CODES.VALIDATION_FAILED, "days 必须是正整数", { context: { days } })
  }

  const tomorrow = shiftDateKey(toLocalDateKey(), 1)
  const end = shiftDateKey(tomorrow, days - 1)

  try {
    const tasks = await getDb()
      .tasks.where("[childId+dueDate]")
      .between([childId, tomorrow], [childId, end], true, true)
      .toArray()
    return tasks.sort((a, b) => {
      const byDue = String(a.dueDate ?? "").localeCompare(String(b.dueDate ?? ""))
      return byDue || String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? ""))
    })
  } catch (error) {
    throw wrapDbError(error, { phase: "read", context: { childId, days } })
  }
}

/** 文字提交：同一事务更新任务并新增一条提交记录。 */
export async function submitTask({ taskId, childId, contentType, content } = {}) {
  assertNonEmptyString(taskId, "taskId")
  assertNonEmptyString(childId, "childId")
  if (contentType !== "text") {
    throw new DbError(DB_ERROR_CODES.VALIDATION_FAILED, "M0 只支持 text 文字提交", {
      context: { contentType },
    })
  }
  assertNonEmptyString(content, "content")

  const db = getDb()
  const submissionId = makeId("sub")
  const submittedAt = toIsoTimestamp()
  const trimmedContent = content.trim()

  try {
    return await db.transaction("rw", db.tasks, db.submissions, async () => {
      const task = await db.tasks.get(taskId)
      if (!task || task.childId !== childId) {
        throw new DbError(DB_ERROR_CODES.VALIDATION_FAILED, "任务不存在或不属于该孩子", {
          context: { taskId, childId },
        })
      }
      if (![TASK_STATUS.TODO, TASK_STATUS.REVISION].includes(task.status)) {
        throw new DbError(DB_ERROR_CODES.VALIDATION_FAILED, "只有待完成或需修改的任务可以提交", {
          context: { taskId, status: task.status },
        })
      }

      const version = (await db.submissions.where("taskId").equals(taskId).count()) + 1
      // 重新提交时清掉上一次的退回原因：原因历史留在 reviews 表里，
      // 任务记录上只保留"当前是否还有待处理的修改意见"。
      const nextTask = { ...task, status: TASK_STATUS.SUBMITTED, submittedAt }
      delete nextTask.revisionReason
      await db.tasks.put(nextTask)
      await db.submissions.add({
        id: submissionId,
        taskId,
        childId,
        submittedAt,
        version,
        status: TASK_STATUS.SUBMITTED,
        contentType,
        content: trimmedContent,
      })

      return { status: TASK_STATUS.SUBMITTED, taskId, submissionId, version, submittedAt }
    })
  } catch (error) {
    if (error instanceof DbError) throw error
    throw wrapDbError(error, { phase: "transaction", context: { taskId, childId } })
  }
}

/** 固定主键补种；不会重置已提交或已通过的任务。 */
export async function ensureSeedData() {
  const db = getDb()
  const now = new Date()
  const dueDate = toLocalDateKey(now)
  const createdAt = toIsoTimestamp(now)

  try {
    return await db.transaction("rw", db.children, db.tasks, async () => {
      let addedChild = false
      if (!(await db.children.get(M0_CHILD_ID))) {
        await db.children.add({
          id: M0_CHILD_ID,
          nickname: "朵朵",
          avatarKey: "cat",
          hasChildPin: false,
          createdAt,
        })
        addedChild = true
      }

      let addedTasks = 0
      for (const seed of M0_SEED_TASKS) {
        if (await db.tasks.get(seed.id)) continue
        await db.tasks.add({
          id: seed.id,
          childId: M0_CHILD_ID,
          title: seed.title,
          points: seed.points,
          type: "temp",
          status: TASK_STATUS.TODO,
          dueDate,
          createdAt,
        })
        addedTasks += 1
      }

      const taskCount = await db.tasks.where("childId").equals(M0_CHILD_ID).count()
      return { childId: M0_CHILD_ID, addedChild, addedTasks, taskCount }
    })
  } catch (error) {
    if (error instanceof DbError) throw error
    throw wrapDbError(error, { phase: "transaction", context: { childId: M0_CHILD_ID, stage: "seed" } })
  }
}
