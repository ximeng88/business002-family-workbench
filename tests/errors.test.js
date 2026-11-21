/**
 * 错误处理单元测试（纯逻辑，不依赖 IndexedDB）
 */

import test from "node:test"
import assert from "node:assert/strict"

import {
  DbError,
  DB_ERROR_CODES,
  classifyError,
  sanitizeContext,
  wrapDbError,
} from "../src/db/errors.js"

function namedError(name, message = "x") {
  const error = new Error(message)
  error.name = name
  return error
}

test("9 打开阶段的版本降级 / 升级异常 → DB_UPGRADE_FAILED", () => {
  assert.equal(classifyError(namedError("VersionError"), { phase: "open" }), DB_ERROR_CODES.UPGRADE_FAILED)
  assert.equal(classifyError(namedError("UpgradeError"), { phase: "open" }), DB_ERROR_CODES.UPGRADE_FAILED)
})

test("9 打开阶段普通异常 → DB_OPEN_FAILED（不伪装成「暂无数据」）", () => {
  const wrapped = wrapDbError(namedError("UnknownError", "disk broken"), {
    phase: "open",
    context: { dbName: "b002" },
  })
  assert.equal(wrapped.code, DB_ERROR_CODES.OPEN_FAILED)
  assert.equal(wrapped.context.dbName, "b002")
  assert.ok(wrapped.cause instanceof Error)
})

test("9 事务阶段：约束 / 配额 / 中止 分类正确", () => {
  assert.equal(classifyError(namedError("ConstraintError"), { phase: "transaction" }), DB_ERROR_CODES.UNIQUE_CONFLICT)
  assert.equal(classifyError(namedError("QuotaExceededError"), { phase: "transaction" }), DB_ERROR_CODES.QUOTA_EXCEEDED)
  assert.equal(classifyError(namedError("AbortError"), { phase: "transaction" }), DB_ERROR_CODES.TRANSACTION_FAILED)
  assert.equal(classifyError(namedError("InvalidStateError"), { phase: "transaction" }), DB_ERROR_CODES.TRANSACTION_FAILED)
})

test("9 浏览器不支持 IndexedDB → DB_UNSUPPORTED", () => {
  assert.equal(classifyError(namedError("MissingAPIError"), { phase: "open" }), DB_ERROR_CODES.UNSUPPORTED)
})

test("9 DbError 透传，不被重复包装", () => {
  const original = new DbError(DB_ERROR_CODES.VALIDATION_FAILED, "bad input")
  const wrapped = wrapDbError(original, { phase: "transaction" })
  assert.equal(wrapped, original)
})

test("9 错误上下文脱敏：PIN / 恢复码 / token 不出现在调试信息里", () => {
  const safe = sanitizeContext({
    childId: "c_test",
    parentPin: "1234",
    childPinHash: "abc",
    recoveryCode: "ABCD-EFGH",
    token: "secret",
    note: "x".repeat(300),
  })
  assert.equal(safe.parentPin, "[redacted]")
  assert.equal(safe.childPinHash, "[redacted]")
  assert.equal(safe.recoveryCode, "[redacted]")
  assert.equal(safe.token, "[redacted]")
  assert.equal(safe.childId, "c_test")
  assert.ok(safe.note.endsWith("…"))
  assert.ok(safe.note.length < 300)
})
