/**
 * 日期工具
 *
 * Q-14（已确认）：截止时间按"日期级"，默认当天 23:59。
 * 关键纪律：业务日期一律用**本地自然日**的 `YYYY-MM-DD`，
 * 不能对 Date 直接 `toISOString()`（会按 UTC 换算，东八区在 00:00–07:59 会偏移一天）。
 */

import { DbError, DB_ERROR_CODES } from "./errors.js"

const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

/**
 * 把 Date / 时间戳 / 可解析字符串转成本地自然日 `YYYY-MM-DD`。
 * @param {Date | number | string} [value]
 * @returns {string}
 */
export function toLocalDateKey(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) {
    throw new DbError(DB_ERROR_CODES.VALIDATION_FAILED, "无法识别的日期值", {
      context: { value: typeof value === "string" ? value : String(value) },
    })
  }
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

/**
 * 校验 `YYYY-MM-DD` 且必须是真实存在的日期（拒绝 2026-02-30）。
 * @param {unknown} value
 * @returns {boolean}
 */
export function isDateKey(value) {
  if (typeof value !== "string") return false
  const matched = DATE_KEY_PATTERN.exec(value)
  if (!matched) return false
  const year = Number(matched[1])
  const month = Number(matched[2])
  const day = Number(matched[3])
  const date = new Date(year, month - 1, day)
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
}

/** 绝对时间戳（ISO 8601 UTC），用于"发生时刻"，不用于自然日判定。 */
export function toIsoTimestamp(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) {
    throw new DbError(DB_ERROR_CODES.VALIDATION_FAILED, "无法识别的时间值")
  }
  return date.toISOString()
}

/**
 * 日期键平移若干天（本地自然日，构造 Date 而不是加减毫秒，避开夏令时）。
 * @param {string} dateKey YYYY-MM-DD
 * @param {number} days 正数向后、负数向前
 * @returns {string} YYYY-MM-DD
 */
export function shiftDateKey(dateKey, days = 0) {
  const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey ?? ""))
  if (!matched) {
    throw new DbError(DB_ERROR_CODES.VALIDATION_FAILED, "dateKey 必须是 YYYY-MM-DD", { context: { dateKey } })
  }
  if (!Number.isInteger(days)) {
    throw new DbError(DB_ERROR_CODES.VALIDATION_FAILED, "days 必须是整数", { context: { days } })
  }
  const date = new Date(Number(matched[1]), Number(matched[2]) - 1, Number(matched[3]) + days)
  return toLocalDateKey(date)
}

/**
 * 日期键对应的星期（0=周日 … 6=周六），与 `Date.prototype.getDay()` 同口径。
 *
 * 固定任务的"每周几重复"直接存这个数字，避免中英混写与 1/7 起始歧义。
 * @param {string} dateKey YYYY-MM-DD
 * @returns {number}
 */
export function weekdayOfDateKey(dateKey) {
  const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey ?? ""))
  if (!matched) {
    throw new DbError(DB_ERROR_CODES.VALIDATION_FAILED, "dateKey 必须是 YYYY-MM-DD", { context: { dateKey } })
  }
  const date = new Date(Number(matched[1]), Number(matched[2]) - 1, Number(matched[3]))
  if (Number.isNaN(date.getTime())) {
    throw new DbError(DB_ERROR_CODES.VALIDATION_FAILED, "dateKey 不是真实日期", { context: { dateKey } })
  }
  return date.getDay()
}
