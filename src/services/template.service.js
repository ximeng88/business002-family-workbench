/**
 * 固定任务模板与自动生成（M3）。
 *
 * 解决的问题：家长每天手动布置同样几件事，太累。
 *
 * 数据落点（**不需要 Schema v3**）：
 * `taskTemplates` 在 Schema v1 就是
 * `"id, type, enabled, *childIds"`，字段注释也已写明
 * `name / points / type(daily|weekly) / childIds / weekdays / enabled / createdAt`。
 * 本轮按这份预留结构写入即可，零结构变更、老库直接可用。
 *
 * 防重（任务书硬要求）：
 * 复用 v1 就定好的 `tasks.&generationKey`，格式 `${type}:${childId}:${templateId}:${dateKey}`。
 * 生成前在**同一个事务里**按该键查一次，配合唯一索引兜底，
 * 保证"同一天同一个模板同一个孩子"永远只有一条任务。
 *
 * 边界：
 * - 只生成**今天**，不补历史（避免一打开就冒出十几条逾期任务）；
 * - 停用模板不生成；删除模板**不删除**已经生成的任务（那些是历史，K18）；
 * - 生成的任务是快照：之后改模板的名字 / 星星数不影响已生成的任务。
 */

import { getDb } from "../db/database.js"
import { DbError, DB_ERROR_CODES, wrapDbError } from "../db/errors.js"
import { isDateKey, toIsoTimestamp, toLocalDateKey, weekdayOfDateKey } from "../db/date.js"
import { makeId } from "../db/ids.js"
import { TASK_STATUS } from "./approval.service.js"

export const TEMPLATE_TYPE = Object.freeze({
  DAILY: "daily",
  WEEKLY: "weekly",
})

export const TEMPLATE_TYPE_LABEL = Object.freeze({
  daily: "每天",
  weekly: "每周",
})

export const TEMPLATE_TITLE_MAX_LENGTH = 20
export const TEMPLATE_POINTS_MAX = 50

/** 星期选项：展示顺序按周一到周日，值保持 `Date.getDay()` 口径（0=周日） */
export const WEEKDAY_OPTIONS = Object.freeze([
  Object.freeze({ value: 1, label: "一", short: "周一" }),
  Object.freeze({ value: 2, label: "二", short: "周二" }),
  Object.freeze({ value: 3, label: "三", short: "周三" }),
  Object.freeze({ value: 4, label: "四", short: "周四" }),
  Object.freeze({ value: 5, label: "五", short: "周五" }),
  Object.freeze({ value: 6, label: "六", short: "周六" }),
  Object.freeze({ value: 0, label: "日", short: "周日" }),
])

export function weekdayLabel(value) {
  return WEEKDAY_OPTIONS.find((option) => option.value === value)?.short ?? ""
}

/**
 * 固定任务的生成键（与 `tech/contract.md` §3 完全一致）。
 * @param {{ type: string, childId: string, templateId: string, dateKey: string }} input
 */
export function generationKeyOf({ type, childId, templateId, dateKey }) {
  return `${type}:${childId}:${templateId}:${dateKey}`
}

/** 模板的中文重复描述，如"每天"/"每周三、周五" */
export function describeTemplate(template) {
  if (template.type === TEMPLATE_TYPE.WEEKLY) {
    const labels = (template.weekdays ?? [])
      .slice()
      .sort((a, b) => ((a === 0 ? 7 : a) - (b === 0 ? 7 : b)))
      .map((value) => weekdayLabel(value))
      .filter(Boolean)
    return labels.length ? `每${labels.join("、")}` : "每周（未选星期）"
  }
  return "每天"
}

function assertTitle(title) {
  if (typeof title !== "string" || title.trim() === "") {
    throw new DbError(DB_ERROR_CODES.VALIDATION_FAILED, "固定任务要有名字", { context: { title } })
  }
  const trimmed = title.trim()
  if (trimmed.length > TEMPLATE_TITLE_MAX_LENGTH) {
    throw new DbError(DB_ERROR_CODES.VALIDATION_FAILED, `名字不要超过 ${TEMPLATE_TITLE_MAX_LENGTH} 个字`)
  }
  return trimmed
}

function normalizePoints(points) {
  if (!Number.isInteger(points) || points < 0 || points > TEMPLATE_POINTS_MAX) {
    throw new DbError(DB_ERROR_CODES.VALIDATION_FAILED, `星星数要是 0–${TEMPLATE_POINTS_MAX} 的整数`, {
      context: { points },
    })
  }
  return points
}

function normalizeWeekdays(type, weekdays) {
  if (type !== TEMPLATE_TYPE.WEEKLY) return null
  if (!Array.isArray(weekdays) || weekdays.length === 0) {
    throw new DbError(DB_ERROR_CODES.VALIDATION_FAILED, "每周重复至少要选一个星期")
  }
  const unique = [...new Set(weekdays)]
  for (const value of unique) {
    if (!Number.isInteger(value) || value < 0 || value > 6) {
      throw new DbError(DB_ERROR_CODES.VALIDATION_FAILED, "星期取值必须是 0–6", { context: { value } })
    }
  }
  return unique.sort((a, b) => (a === 0 ? 7 : a) - (b === 0 ? 7 : b))
}

/**
 * 新建固定任务模板。
 *
 * @param {{
 *   title: string,
 *   points: number,
 *   type?: "daily"|"weekly",
 *   childIds: string[],
 *   weekdays?: number[],
 *   now?: Date,
 *   db?: import("dexie").default,
 * }} input
 */
export async function createTemplate(input = {}) {
  const { title, points, childIds, weekdays, now = new Date(), db = getDb() } = input
  const type = input.type === TEMPLATE_TYPE.WEEKLY ? TEMPLATE_TYPE.WEEKLY : TEMPLATE_TYPE.DAILY
  const safeTitle = assertTitle(title)
  const safePoints = normalizePoints(points)
  const safeWeekdays = normalizeWeekdays(type, weekdays)

  if (!Array.isArray(childIds) || childIds.length === 0) {
    throw new DbError(DB_ERROR_CODES.VALIDATION_FAILED, "固定任务至少要给一个孩子")
  }
  const uniqueChildIds = [...new Set(childIds.filter((id) => typeof id === "string" && id !== ""))]
  if (!uniqueChildIds.length) {
    throw new DbError(DB_ERROR_CODES.VALIDATION_FAILED, "固定任务至少要给一个孩子")
  }
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new DbError(DB_ERROR_CODES.VALIDATION_FAILED, "now 必须是有效的 Date")
  }

  const createdAt = toIsoTimestamp(now)
  const template = {
    id: makeId("tpl"),
    title: safeTitle,
    points: safePoints,
    type,
    childIds: uniqueChildIds,
    enabled: true,
    createdAt,
    updatedAt: createdAt,
  }
  if (safeWeekdays) template.weekdays = safeWeekdays

  try {
    return await db.transaction("rw", db.children, db.taskTemplates, async () => {
      for (const childId of uniqueChildIds) {
        if (!(await db.children.get(childId))) {
          throw new DbError(DB_ERROR_CODES.VALIDATION_FAILED, "固定任务里有不存在的孩子", { context: { childId } })
        }
      }
      await db.taskTemplates.add(template)
      return template
    })
  } catch (error) {
    if (error instanceof DbError) throw error
    throw wrapDbError(error, { phase: "transaction", context: { stage: "create-template" } })
  }
}

/**
 * 列出全部模板（含停用），按创建时间正序。
 * @param {import("dexie").default} [db]
 */
export async function listTemplates(db = getDb()) {
  try {
    const templates = await db.taskTemplates.toArray()
    return templates.sort((a, b) => {
      const byCreated = String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? ""))
      return byCreated || String(a.id).localeCompare(String(b.id))
    })
  } catch (error) {
    throw wrapDbError(error, { phase: "read", context: { table: "taskTemplates" } })
  }
}

/**
 * 启用 / 停用模板。停用只影响之后的生成，已经生成的任务不动。
 * @param {{ templateId: string, enabled: boolean, now?: Date, db?: import("dexie").default }} input
 */
export async function setTemplateEnabled({ templateId, enabled, now = new Date(), db = getDb() } = {}) {
  if (typeof templateId !== "string" || templateId === "") {
    throw new DbError(DB_ERROR_CODES.VALIDATION_FAILED, "templateId 必须是非空字符串")
  }
  try {
    return await db.transaction("rw", db.taskTemplates, async () => {
      const template = await db.taskTemplates.get(templateId)
      if (!template) {
        throw new DbError(DB_ERROR_CODES.VALIDATION_FAILED, "这个固定任务已经不在了")
      }
      const next = { ...template, enabled: Boolean(enabled), updatedAt: toIsoTimestamp(now) }
      await db.taskTemplates.put(next)
      return next
    })
  } catch (error) {
    if (error instanceof DbError) throw error
    throw wrapDbError(error, { phase: "transaction", context: { templateId } })
  }
}

/**
 * 删除模板。**不删除**已经生成的任务（生成过后就是历史记录）。
 * @param {{ templateId: string, db?: import("dexie").default }} input
 */
export async function deleteTemplate({ templateId, db = getDb() } = {}) {
  if (typeof templateId !== "string" || templateId === "") {
    throw new DbError(DB_ERROR_CODES.VALIDATION_FAILED, "templateId 必须是非空字符串")
  }
  try {
    return await db.transaction("rw", db.taskTemplates, async () => {
      const template = await db.taskTemplates.get(templateId)
      if (!template) return { deleted: false, templateId }
      await db.taskTemplates.delete(templateId)
      return { deleted: true, templateId }
    })
  } catch (error) {
    throw wrapDbError(error, { phase: "transaction", context: { templateId } })
  }
}

/**
 * 为某一天生成固定任务（幂等）。
 *
 * 同一 `generationKey` 已存在就跳过，因此：
 * 应用启动、刷新、切换孩子、重复点按钮都不会产生第二条。
 *
 * @param {{ dateKey?: string, now?: Date, db?: import("dexie").default }} [options]
 * @returns {Promise<{ dateKey: string, created: number, skipped: number, tasks: object[] }>}
 */
export async function generateTemplateTasks({ dateKey = toLocalDateKey(), now = new Date(), db = getDb() } = {}) {
  if (!isDateKey(dateKey)) {
    throw new DbError(DB_ERROR_CODES.VALIDATION_FAILED, "dateKey 必须是真实的 YYYY-MM-DD", { context: { dateKey } })
  }
  const weekday = weekdayOfDateKey(dateKey)
  const baseTime = now instanceof Date && !Number.isNaN(now.getTime()) ? now.getTime() : Date.now()

  try {
    return await db.transaction("rw", db.taskTemplates, db.tasks, db.children, async () => {
      const templates = await db.taskTemplates.toArray()
      const children = new Set((await db.children.toArray()).map((child) => child.id))
      const createdTasks = []
      let skipped = 0

      for (const template of templates) {
        if (template.enabled === false) continue
        const type = template.type === TEMPLATE_TYPE.WEEKLY ? TEMPLATE_TYPE.WEEKLY : TEMPLATE_TYPE.DAILY
        if (type === TEMPLATE_TYPE.WEEKLY) {
          const weekdays = Array.isArray(template.weekdays) ? template.weekdays : []
          if (!weekdays.includes(weekday)) continue
        }

        const childIds = Array.isArray(template.childIds) ? template.childIds : []
        for (const childId of childIds) {
          if (!children.has(childId)) {
            skipped += 1
            continue
          }
          const generationKey = generationKeyOf({ type, childId, templateId: template.id, dateKey })
          const existing = await db.tasks.where("generationKey").equals(generationKey).first()
          if (existing) {
            skipped += 1
            continue
          }

          const task = {
            id: makeId("task"),
            childId,
            title: template.title,
            points: template.points,
            type,
            status: TASK_STATUS.TODO,
            dueDate: dateKey,
            templateId: template.id,
            generationKey,
            createdAt: toIsoTimestamp(new Date(baseTime + createdTasks.length)),
          }

          try {
            await db.tasks.add(task)
          } catch (error) {
            // 并发下另一个事务刚写了同一条：唯一索引会拦下来，按"已存在"处理
            if (error?.name === "ConstraintError") {
              skipped += 1
              continue
            }
            throw error
          }
          createdTasks.push(task)
        }
      }

      return { dateKey, created: createdTasks.length, skipped, tasks: createdTasks }
    })
  } catch (error) {
    if (error instanceof DbError) throw error
    throw wrapDbError(error, { phase: "transaction", context: { dateKey, stage: "generate" } })
  }
}

/**
 * 启动时调用：把今天的固定任务补齐。
 * @param {{ now?: Date, db?: import("dexie").default }} [options]
 */
export async function ensureTodayTemplateTasks({ now = new Date(), db = getDb() } = {}) {
  return generateTemplateTasks({ dateKey: toLocalDateKey(now), now, db })
}

/** 给模板附加"孩子昵称"用于界面展示 */
export function childNamesOf(template, children) {
  const ids = Array.isArray(template.childIds) ? template.childIds : []
  const names = ids.map((id) => children.find((child) => child.id === id)?.nickname).filter(Boolean)
  return names.length ? names.join("、") : "（孩子已删除）"
}
