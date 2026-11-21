/**
 * 退回 / 重提闭环测试（M1）。
 *
 * 环境：fake-indexeddb（Node），不是真实浏览器验证。
 * 重点守 R-02：退回记录**不写 eventKey 属性**，否则 `&eventKey` 唯一索引会让下一次退回撞键。
 */

import "fake-indexeddb/auto"
import test from "node:test"
import assert from "node:assert/strict"
import Dexie from "dexie"

import { closeDb, getDb, openDatabase } from "../src/db/database.js"
import { DB_NAME } from "../src/db/schema.js"
import { DB_ERROR_CODES } from "../src/db/errors.js"
import {
  approveTask,
  rejectTask,
  REVISION_REASON_MAX_LENGTH,
  TASK_STATUS,
} from "../src/services/approval.service.js"
import { getBalance } from "../src/services/points.service.js"
import { ensureSeedData, M0_CHILD_ID, submitTask } from "../src/services/task.service.js"
import { createTestDb, destroyTestDb, seedChildAndTask } from "./test-utils.js"

async function useCleanDatabase(t) {
  closeDb()
  await Dexie.delete(DB_NAME)
  await openDatabase()
  t.after(async () => {
    closeDb()
    await Dexie.delete(DB_NAME)
  })
}

async function submittedSeedTask() {
  await ensureSeedData()
  return submitTask({
    taskId: "t_seed_01",
    childId: M0_CHILD_ID,
    contentType: "text",
    content: "书包整理好了，语文书和数学书都在",
  })
}

test("M1-RJ1 退回：状态转 revision，写原因，不发分不发经验", async (t) => {
  await useCleanDatabase(t)
  await submittedSeedTask()

  const result = await rejectTask({ taskId: "t_seed_01", reason: "  再检查一遍书包侧袋  " })
  assert.equal(result.status, TASK_STATUS.REVISION)
  assert.equal(result.revisionReason, "再检查一遍书包侧袋")
  assert.equal(result.returnCount, 1)

  const task = await getDb().tasks.get("t_seed_01")
  assert.equal(task.status, TASK_STATUS.REVISION)
  assert.equal(task.revisionReason, "再检查一遍书包侧袋")
  assert.equal(task.returnCount, 1)

  const reviews = await getDb().reviews.toArray()
  assert.equal(reviews.length, 1)
  assert.equal(reviews[0].result, "revision")
  assert.equal(reviews[0].reason, "再检查一遍书包侧袋")
  // R-02 铁证：属性必须不存在，不是 ""、null 或 undefined
  assert.equal(Object.hasOwn(reviews[0], "eventKey"), false)
  assert.equal(Object.hasOwn(reviews[0], "approvalDate"), false)

  assert.equal(await getDb().pointLedger.count(), 0)
  assert.equal(await getDb().petProgress.count(), 0)
  assert.equal(await getDb().streaks.count(), 0)
  assert.equal((await getBalance(M0_CHILD_ID)).balance, 0)
})

test("M1-RJ2 退回不填原因：revisionReason 键不存在，reviews.reason 为 null", async (t) => {
  await useCleanDatabase(t)
  await submittedSeedTask()

  await rejectTask({ taskId: "t_seed_01", reason: "   " })

  const task = await getDb().tasks.get("t_seed_01")
  assert.equal(task.status, TASK_STATUS.REVISION)
  assert.equal(Object.hasOwn(task, "revisionReason"), false)
  assert.equal(task.returnCount, 1)

  const [review] = await getDb().reviews.toArray()
  assert.equal(review.reason, null)
  assert.equal(Object.hasOwn(review, "eventKey"), false)
})

test("M1-RJ3 连续退回两条不同任务：没有 eventKey 不会撞唯一索引", async (t) => {
  await useCleanDatabase(t)
  await ensureSeedData()
  for (const taskId of ["t_seed_01", "t_seed_02"]) {
    await submitTask({ taskId, childId: M0_CHILD_ID, contentType: "text", content: "做完了" })
  }

  await rejectTask({ taskId: "t_seed_01", reason: "再写具体一点" })
  await rejectTask({ taskId: "t_seed_02" })

  const reviews = await getDb().reviews.toArray()
  assert.equal(reviews.length, 2)
  for (const review of reviews) {
    assert.equal(review.result, "revision")
    assert.equal(Object.hasOwn(review, "eventKey"), false)
  }
})

test("M1-RJ4 只有「待家长确认」能退回：todo / revision 都拒绝且不写库", async (t) => {
  await useCleanDatabase(t)
  await ensureSeedData()

  await assert.rejects(
    rejectTask({ taskId: "t_seed_01" }),
    (error) => error?.code === DB_ERROR_CODES.VALIDATION_FAILED,
  )
  assert.equal((await getDb().tasks.get("t_seed_01")).status, TASK_STATUS.TODO)
  assert.equal(await getDb().reviews.count(), 0)

  await submitTask({ taskId: "t_seed_01", childId: M0_CHILD_ID, contentType: "text", content: "做完了" })
  await rejectTask({ taskId: "t_seed_01" })

  await assert.rejects(
    rejectTask({ taskId: "t_seed_01" }),
    (error) => error?.code === DB_ERROR_CODES.VALIDATION_FAILED,
  )
  assert.equal(await getDb().reviews.count(), 1)
  assert.equal((await getDb().tasks.get("t_seed_01")).returnCount, 1)

  await assert.rejects(
    rejectTask({ taskId: "not-exist" }),
    (error) => error?.code === DB_ERROR_CODES.VALIDATION_FAILED,
  )
})

test("M1-RJ5 退回原因过长：拒绝写入", async (t) => {
  await useCleanDatabase(t)
  await submittedSeedTask()

  await assert.rejects(
    rejectTask({ taskId: "t_seed_01", reason: "改".repeat(REVISION_REASON_MAX_LENGTH + 1) }),
    (error) => error?.code === DB_ERROR_CODES.VALIDATION_FAILED,
  )
  assert.equal((await getDb().tasks.get("t_seed_01")).status, TASK_STATUS.SUBMITTED)
  assert.equal(await getDb().reviews.count(), 0)
})

test("M1-RJ6 闭环：提交 → 退回 → 重提 → 通过，只有最后一次通过发分", async (t) => {
  await useCleanDatabase(t)
  const first = await submittedSeedTask()
  assert.equal(first.version, 1)

  await rejectTask({ taskId: "t_seed_01", reason: "说明里没写读了哪一课" })

  const resubmitted = await submitTask({
    taskId: "t_seed_01",
    childId: M0_CHILD_ID,
    contentType: "text",
    content: "补上：读了第 8 课《雨点儿》，读了三遍",
  })
  assert.equal(resubmitted.version, 2)
  assert.equal((await getDb().tasks.get("t_seed_01")).status, TASK_STATUS.SUBMITTED)

  // 重提后任务记录上不再挂着旧原因（历史留在 reviews 表）
  const afterResubmit = await getDb().tasks.get("t_seed_01")
  assert.equal(Object.hasOwn(afterResubmit, "revisionReason"), false)
  assert.equal((await getDb().reviews.toArray())[0].reason, "说明里没写读了哪一课")

  const approved = await approveTask({ taskId: "t_seed_01" })
  assert.equal(approved.status, "approved")
  assert.equal(approved.points, 5)
  assert.equal((await getBalance(M0_CHILD_ID)).balance, 5)
  assert.equal(await getDb().pointLedger.count(), 1)
  assert.equal(await getDb().petProgress.count(), 1)
  assert.equal(await getDb().streaks.count(), 1)

  const reviews = await getDb().reviews.toArray()
  assert.equal(reviews.length, 2)
  assert.equal(reviews.filter((review) => review.result === "revision").length, 1)
  assert.equal(reviews.filter((review) => review.result === "approved").length, 1)
  assert.equal(reviews.find((review) => review.result === "approved").eventKey, "approval:t_seed_01")
})

test("M1-RJ7 退回事务回滚：reviews 写入失败时任务状态不变", async (t) => {
  const { db, name } = await createTestDb("b002_reject_rollback")
  t.after(() => destroyTestDb(db, name))
  await seedChildAndTask(db)

  const handler = () => {
    throw new Error("inject: review write failure")
  }
  db.reviews.hook("creating").subscribe(handler)
  t.after(() => db.reviews.hook("creating").unsubscribe(handler))

  await assert.rejects(rejectTask({ taskId: "t_test", reason: "回滚验证", db }))

  const task = await db.tasks.get("t_test")
  assert.equal(task.status, TASK_STATUS.SUBMITTED)
  assert.equal(task.revisionReason ?? null, null) // 种子任务原本就是 null，回滚后不得变成原因文本
  assert.equal(await db.reviews.count(), 0)
})
