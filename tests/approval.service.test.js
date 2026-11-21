/**
 * 审核通过五表原子事务测试
 * 环境：**fake-indexeddb 6.2.8**（Node 24），不是真实浏览器验证。
 */

import "fake-indexeddb/auto"
import test from "node:test"
import assert from "node:assert/strict"

import { approveTask, APPROVAL_RESULT, TASK_STATUS, approvalEventKey } from "../src/services/approval.service.js"
import { DB_ERROR_CODES } from "../src/db/errors.js"
import { createTestDb, destroyTestDb, seedChildAndTask } from "./test-utils.js"

async function setup(prefix) {
  const context = await createTestDb(prefix)
  const seeded = await seedChildAndTask(context.db)
  return { ...context, ...seeded }
}

async function snapshot(db) {
  return {
    task: await db.tasks.get("t_test"),
    reviews: await db.reviews.count(),
    ledger: await db.pointLedger.count(),
    pet: await db.petProgress.count(),
    streaks: await db.streaks.count(),
  }
}

/** 让指定表的 creating 钩子抛错，用于验证事务整体回滚；返回恢复函数 */
function failOnCreate(table) {
  const handler = () => {
    throw new Error("inject: write failure")
  }
  table.hook("creating").subscribe(handler)
  return () => table.hook("creating").unsubscribe(handler)
}

/** 让指定表的 updating 钩子抛错，用于验证事务整体回滚；返回恢复函数 */
function failOnUpdate(table) {
  const handler = () => {
    throw new Error("inject: update failure")
  }
  table.hook("updating").subscribe(handler)
  return () => table.hook("updating").unsubscribe(handler)
}

test("8.2-1 正常通过：五表数据全部正确", async (t) => {
  const { db, name } = await setup("b002_approve_ok")
  t.after(() => destroyTestDb(db, name))

  const now = new Date(2026, 10, 20, 10, 30, 0) // 本地时间 2026-11-20 10:30
  const result = await approveTask({ taskId: "t_test", now, db })

  assert.equal(result.status, APPROVAL_RESULT.APPROVED)
  assert.equal(result.approvalDate, "2026-11-20")
  assert.equal(result.points, 10)
  assert.equal(result.exp, 10)

  const task = await db.tasks.get("t_test")
  assert.equal(task.status, TASK_STATUS.APPROVED)
  assert.equal(task.approvalDate, "2026-11-20")
  assert.equal(task.approvedAt, now.toISOString())

  const reviews = await db.reviews.toArray()
  assert.equal(reviews.length, 1)
  assert.equal(reviews[0].eventKey, "approval:t_test")
  assert.equal(reviews[0].result, "approved")

  const ledger = await db.pointLedger.toArray()
  assert.equal(ledger.length, 1)
  assert.equal(ledger[0].delta, 10)
  assert.equal(ledger[0].source, "task")
  assert.equal(ledger[0].eventKey, "approval:t_test")

  const pet = await db.petProgress.toArray()
  assert.equal(pet.length, 1)
  assert.equal(pet[0].delta, 10)
  assert.equal(pet[0].eventKey, "approval:t_test")

  const streak = await db.streaks.get("c_test:2026-11-20")
  assert.ok(streak)
  assert.equal(streak.date, "2026-11-20")
  assert.equal(streak.approvedCount, 1)
})

test("8.2-2 积分流水写失败：全回滚", async (t) => {
  const { db, name } = await setup("b002_approve_fail_ledger")
  t.after(() => destroyTestDb(db, name))

  const restore = failOnCreate(db.pointLedger)
  try {
    await assert.rejects(
      approveTask({ taskId: "t_test", now: new Date(2026, 10, 20, 9, 0), db }),
      (error) => error?.code === DB_ERROR_CODES.TRANSACTION_FAILED,
    )
  } finally {
    restore()
  }

  const after = await snapshot(db)
  assert.equal(after.task.status, TASK_STATUS.SUBMITTED)
  assert.equal(after.task.approvedAt, null)
  assert.equal(after.reviews, 0)
  assert.equal(after.ledger, 0)
  assert.equal(after.pet, 0)
  assert.equal(after.streaks, 0)
})

test("8.2-3 宠物经验写失败：全回滚（含已写的积分流水）", async (t) => {
  const { db, name } = await setup("b002_approve_fail_pet")
  t.after(() => destroyTestDb(db, name))

  const restore = failOnCreate(db.petProgress)
  try {
    await assert.rejects(
      approveTask({ taskId: "t_test", now: new Date(2026, 10, 20, 9, 0), db }),
      (error) => error?.code === DB_ERROR_CODES.TRANSACTION_FAILED,
    )
  } finally {
    restore()
  }

  const after = await snapshot(db)
  assert.equal(after.task.status, TASK_STATUS.SUBMITTED)
  assert.equal(after.reviews, 0)
  assert.equal(after.ledger, 0, "先写入的积分流水也必须回滚")
  assert.equal(after.pet, 0)
  assert.equal(after.streaks, 0)
})

test("8.2-4 连续记录写失败：全回滚", async (t) => {
  const { db, name } = await setup("b002_approve_fail_streak")
  t.after(() => destroyTestDb(db, name))

  const restore = failOnCreate(db.streaks)
  try {
    await assert.rejects(
      approveTask({ taskId: "t_test", now: new Date(2026, 10, 20, 9, 0), db }),
      (error) => error?.code === DB_ERROR_CODES.TRANSACTION_FAILED,
    )
  } finally {
    restore()
  }

  const after = await snapshot(db)
  assert.equal(after.task.status, TASK_STATUS.SUBMITTED)
  assert.equal(after.reviews, 0)
  assert.equal(after.ledger, 0)
  assert.equal(after.pet, 0)
  assert.equal(after.streaks, 0)
})

test("8.2-5 重复审核：不重复发放", async (t) => {
  const { db, name } = await setup("b002_approve_dup")
  t.after(() => destroyTestDb(db, name))

  const now = new Date(2026, 10, 20, 9, 0)
  const first = await approveTask({ taskId: "t_test", now, db })
  const second = await approveTask({ taskId: "t_test", now, db })
  const third = await approveTask({ taskId: "t_test", now, db })

  assert.equal(first.status, APPROVAL_RESULT.APPROVED)
  assert.equal(second.status, APPROVAL_RESULT.DUPLICATE)
  assert.equal(third.status, APPROVAL_RESULT.DUPLICATE)

  assert.equal(await db.reviews.count(), 1)
  assert.equal(await db.pointLedger.count(), 1)
  assert.equal(await db.petProgress.count(), 1)
  const streak = await db.streaks.get("c_test:2026-11-20")
  assert.equal(streak.approvedCount, 1)
})

test("8.2-6 已通过任务再审核：返回明确结果", async (t) => {
  const { db, name } = await setup("b002_approve_already")
  t.after(() => destroyTestDb(db, name))

  // 模拟历史数据：任务已是 approved，但审核记录不在本库（例如从旧备份恢复）
  await db.tasks.update("t_test", {
    status: TASK_STATUS.APPROVED,
    approvedAt: new Date(2026, 10, 19, 9, 0).toISOString(),
    approvalDate: "2026-11-19",
  })

  const result = await approveTask({ taskId: "t_test", now: new Date(2026, 10, 20, 9, 0), db })
  assert.equal(result.status, APPROVAL_RESULT.ALREADY_APPROVED)
  assert.equal(result.approvalDate, "2026-11-19")
  assert.equal(await db.pointLedger.count(), 0)
  assert.equal(await db.petProgress.count(), 0)
})

test("8.2-7 逾期补交：按实际审核日期记录，不回填到期日", async (t) => {
  const { db, name } = await setup("b002_approve_late")
  t.after(() => destroyTestDb(db, name))

  // 任务原定 2026-01-02，家长在 2026-11-20 才审核通过
  await db.tasks.update("t_test", { dueDate: "2026-01-02" })
  const now = new Date(2026, 10, 20, 20, 45)
  const result = await approveTask({ taskId: "t_test", now, db })

  assert.equal(result.approvalDate, "2026-11-20")
  const ledger = await db.pointLedger.toArray()
  assert.equal(ledger[0].approvalDate, "2026-11-20")

  assert.ok(await db.streaks.get("c_test:2026-11-20"))
  assert.equal(await db.streaks.get("c_test:2026-01-02"), undefined)

  // 同日再通过第二条任务：计数累加，不新建记录
  await db.tasks.add({
    id: "t_test_2",
    childId: "c_test",
    title: "写字 10 分钟",
    points: 5,
    type: "temp",
    status: TASK_STATUS.SUBMITTED,
    dueDate: "2026-11-20",
  })
  await approveTask({ taskId: "t_test_2", now: new Date(2026, 10, 20, 21, 0), db })
  const streak = await db.streaks.get("c_test:2026-11-20")
  assert.equal(streak.approvedCount, 2)
  assert.equal(await db.streaks.count(), 1)
})

test("8.2-8 非「待家长确认」任务：拒绝且状态不变", async (t) => {
  const { db, name } = await setup("b002_approve_invalid")
  t.after(() => destroyTestDb(db, name))

  await db.tasks.update("t_test", { status: TASK_STATUS.TODO })
  await assert.rejects(
    approveTask({ taskId: "t_test", now: new Date(2026, 10, 20, 9, 0), db }),
    (error) => error?.code === DB_ERROR_CODES.VALIDATION_FAILED,
  )

  const task = await db.tasks.get("t_test")
  assert.equal(task.status, TASK_STATUS.TODO)
  assert.equal(await db.pointLedger.count(), 0)
  assert.equal(await db.reviews.count(), 0)
})

test("8.2-9 连续点击 / 并发重复触发：只发放一次", async (t) => {
  const { db, name } = await setup("b002_approve_concurrent")
  t.after(() => destroyTestDb(db, name))

  const now = new Date(2026, 10, 20, 9, 0)
  const [a, b] = await Promise.all([
    approveTask({ taskId: "t_test", now, db }),
    approveTask({ taskId: "t_test", now, db }),
  ])

  const statuses = [a.status, b.status].sort()
  assert.deepEqual(statuses, [APPROVAL_RESULT.APPROVED, APPROVAL_RESULT.DUPLICATE].sort())
  assert.equal(await db.reviews.count(), 1)
  assert.equal(await db.pointLedger.count(), 1)
  assert.equal(await db.petProgress.count(), 1)
  assert.equal((await db.streaks.get("c_test:2026-11-20")).approvedCount, 1)
})

test("8.2-10 日期级：本地 00:05 不会因 UTC 换算回退到前一天", async (t) => {
  const { db, name } = await setup("b002_approve_date_boundary")
  t.after(() => destroyTestDb(db, name))

  const result = await approveTask({ taskId: "t_test", now: new Date(2026, 10, 20, 0, 5), db })
  assert.equal(result.approvalDate, "2026-11-20")
  assert.equal(approvalEventKey("t_test"), "approval:t_test")
})

test("8.2-11 R-04：streak 主键格式不符时仍按 childId+date 更新", async (t) => {
  const { db, name } = await setup("b002_approve_streak_compound")
  t.after(() => destroyTestDb(db, name))

  const createdAt = new Date(2026, 10, 20, 8, 0).toISOString()
  await db.streaks.add({
    id: "legacy_streak_without_expected_id_format",
    childId: "c_test",
    date: "2026-11-20",
    approvedCount: 4,
    createdAt,
    updatedAt: createdAt,
  })

  const result = await approveTask({ taskId: "t_test", now: new Date(2026, 10, 20, 9, 0), db })
  assert.equal(result.status, APPROVAL_RESULT.APPROVED)
  assert.equal(result.streakId, "legacy_streak_without_expected_id_format")
  assert.equal((await db.streaks.get(result.streakId))?.approvedCount, 5)
  assert.equal(await db.streaks.get("c_test:2026-11-20"), undefined)
  assert.equal(await db.streaks.count(), 1)
})

test("8.2-12 R-04：tasks.update 失败时五表全回滚", async (t) => {
  const { db, name } = await setup("b002_approve_fail_task_update")
  t.after(() => destroyTestDb(db, name))

  const restore = failOnUpdate(db.tasks)
  try {
    await assert.rejects(
      approveTask({ taskId: "t_test", now: new Date(2026, 10, 20, 9, 0), db }),
      (error) => error?.code === DB_ERROR_CODES.TRANSACTION_FAILED,
    )
  } finally {
    restore()
  }

  const after = await snapshot(db)
  assert.equal(after.task.status, TASK_STATUS.SUBMITTED)
  assert.equal(after.task.approvedAt, null)
  assert.equal(after.reviews, 0)
  assert.equal(after.ledger, 0)
  assert.equal(after.pet, 0)
  assert.equal(after.streaks, 0)
})

test("8.2-13 R-04：reviews.add 失败时五表全回滚", async (t) => {
  const { db, name } = await setup("b002_approve_fail_review_add")
  t.after(() => destroyTestDb(db, name))

  const restore = failOnCreate(db.reviews)
  try {
    await assert.rejects(
      approveTask({ taskId: "t_test", now: new Date(2026, 10, 20, 9, 0), db }),
      (error) => error?.code === DB_ERROR_CODES.TRANSACTION_FAILED,
    )
  } finally {
    restore()
  }

  const after = await snapshot(db)
  assert.equal(after.task.status, TASK_STATUS.SUBMITTED)
  assert.equal(after.task.approvedAt, null)
  assert.equal(after.reviews, 0)
  assert.equal(after.ledger, 0)
  assert.equal(after.pet, 0)
  assert.equal(after.streaks, 0)
})
