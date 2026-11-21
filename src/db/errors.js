/**
 * 统一数据库错误
 *
 * 约束（DEV-B002-006 任务书第九节）：
 * - 不得把 DB 错误统一转成"暂无数据"；
 * - 不得在错误时自动清空数据库；
 * - 不得在错误时创建空家庭覆盖旧数据；
 * - 错误信息保留调试上下文，但不得泄露 PIN / 恢复码等敏感值。
 */

export const DB_ERROR_CODES = Object.freeze({
  /** 浏览器不支持 / 禁用 IndexedDB */
  UNSUPPORTED: "DB_UNSUPPORTED",
  /** 打开数据库失败（损坏、被策略阻止、被其他标签页阻塞等） */
  OPEN_FAILED: "DB_OPEN_FAILED",
  /** 数据存在但恢复 / 初始化状态不完整，禁止当作正常业务库使用 */
  INVALID_STATE: "DB_INVALID_STATE",
  /** 版本升级失败或版本不兼容（含降级） */
  UPGRADE_FAILED: "DB_UPGRADE_FAILED",
  /** 事务失败 / 中止 */
  TRANSACTION_FAILED: "DB_TRANSACTION_FAILED",
  /** 唯一索引冲突 */
  UNIQUE_CONFLICT: "DB_UNIQUE_CONFLICT",
  /** 数据校验失败（入参不合法、状态不允许等） */
  VALIDATION_FAILED: "DB_VALIDATION_FAILED",
  /** 存储空间 / 配额异常 */
  QUOTA_EXCEEDED: "DB_QUOTA_EXCEEDED",
  /** 未归类 */
  UNKNOWN: "DB_UNKNOWN",
})

export class DbError extends Error {
  /**
   * @param {string} code DB_ERROR_CODES 中的值
   * @param {string} message 面向开发者的说明（不面向最终用户）
   * @param {{ cause?: unknown, context?: Record<string, unknown> }} [options]
   */
  constructor(code, message, { cause, context } = {}) {
    super(message)
    this.name = "DbError"
    this.code = code
    if (cause !== undefined) this.cause = cause
    this.context = sanitizeContext(context)
  }
}

const SENSITIVE_KEY_PATTERN = /pin|password|passwd|secret|token|recovery|salt/i

/**
 * 去掉敏感字段并截断过长字符串，避免错误日志把 PIN / 恢复码带出去。
 * @param {Record<string, unknown>} [context]
 */
export function sanitizeContext(context = {}) {
  if (!context || typeof context !== "object") return {}
  const safe = {}
  for (const [key, value] of Object.entries(context)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      safe[key] = "[redacted]"
      continue
    }
    if (typeof value === "string") {
      safe[key] = value.length > 200 ? `${value.slice(0, 200)}…` : value
    } else if (typeof value === "bigint") {
      safe[key] = value.toString()
    } else {
      safe[key] = value
    }
  }
  return safe
}

export function isDbError(error) {
  return error instanceof DbError
}

function errorName(error) {
  return typeof error?.name === "string" ? error.name : ""
}

function isQuotaError(error) {
  const name = errorName(error)
  if (name === "QuotaExceededError") return true
  return typeof error?.message === "string" && /quota|storage.*full|空间不足/i.test(error.message)
}

/**
 * 把底层异常归类成 DB_ERROR_CODES。阶段（phase）会影响归类：
 * - open：版本问题 → 升级失败；其余 → 打开失败
 * - transaction：约束 → 唯一冲突；配额 → 配额异常；其余 → 事务失败
 * @param {unknown} error
 * @param {{ phase?: "open" | "upgrade" | "transaction" | "read" | "write" }} [options]
 */
export function classifyError(error, { phase = "transaction" } = {}) {
  if (error instanceof DbError) return error.code
  const name = errorName(error)

  if (name === "MissingAPIError") return DB_ERROR_CODES.UNSUPPORTED
  if (isQuotaError(error)) return DB_ERROR_CODES.QUOTA_EXCEEDED
  if (name === "ConstraintError") return DB_ERROR_CODES.UNIQUE_CONFLICT

  if (phase === "open" || phase === "upgrade") {
    if (name === "VersionError" || name === "UpgradeError") {
      return DB_ERROR_CODES.UPGRADE_FAILED
    }
    return DB_ERROR_CODES.OPEN_FAILED
  }

  if (name === "AbortError" || name === "TransactionInactiveError" || name === "DatabaseClosedError") {
    return DB_ERROR_CODES.TRANSACTION_FAILED
  }
  if (phase === "transaction" || phase === "write") return DB_ERROR_CODES.TRANSACTION_FAILED
  if (phase === "read") return DB_ERROR_CODES.OPEN_FAILED
  return DB_ERROR_CODES.UNKNOWN
}

/**
 * 包装任意异常为 DbError，保留原始错误（cause）与安全上下文。
 * @param {unknown} error
 * @param {{ phase?: "open" | "upgrade" | "transaction" | "read" | "write", context?: Record<string, unknown>, message?: string }} [options]
 */
export function wrapDbError(error, { phase = "transaction", context = {}, message } = {}) {
  if (error instanceof DbError) return error
  const code = classifyError(error, { phase })
  const fallbackMessage =
    {
      [DB_ERROR_CODES.UNSUPPORTED]: "当前浏览器不支持或禁用了本地数据库（IndexedDB）",
      [DB_ERROR_CODES.OPEN_FAILED]: "本地数据库打开失败",
      [DB_ERROR_CODES.INVALID_STATE]: "库状态异常：数据存在，但初始化或恢复尚未完成",
      [DB_ERROR_CODES.UPGRADE_FAILED]: "本地数据库版本升级失败",
      [DB_ERROR_CODES.TRANSACTION_FAILED]: "数据库事务执行失败",
      [DB_ERROR_CODES.UNIQUE_CONFLICT]: "唯一索引冲突（同一事件被重复写入）",
      [DB_ERROR_CODES.VALIDATION_FAILED]: "数据校验未通过",
      [DB_ERROR_CODES.QUOTA_EXCEEDED]: "浏览器存储空间不足",
      [DB_ERROR_CODES.UNKNOWN]: "数据库操作出现未归类错误",
    }[code] ?? "数据库操作失败"

  return new DbError(code, message ?? fallbackMessage, {
    cause: error,
    context: { ...context, originalName: errorName(error) || "UnknownError" },
  })
}
