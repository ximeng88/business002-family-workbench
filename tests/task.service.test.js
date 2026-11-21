/** M0 任务、Seed 与刷新持久化测试（fake-indexeddb，不替代真实浏览器点击）。 */

import "fake-indexeddb/auto"
import test from "node:test"
import assert from "node:assert/strict"
import Dexie from "dexie"

import { closeDb, getDb, openDatabase } from "../src/db/database.js"
import { DB_NAME } from "../src/db/schema.js"
import { DB_ERROR_CODES } from "../src/db/errors.js"
import { approveTask } from "../src/services/approval.service.js"
import { getBalance } from "../src/services/points.service.js"
import {
  createTask,
  ensureSeedData,
  listTodayTasks,
  M0_CHILD_ID,
  submitTask,
} from "../src/services/task.service.js"

async function useCleanDatabase(t) {
  closeDb()
  await Dexie.delete(DB_NAME)
  await openDatabase()
  t.after(async () => {
    closeDb()
    await Dexie.delete(DB_NAME)
  })
}

test("M0-1 Seed：一个孩子五条临时任务，重复执行不覆盖状态", async (t) => {
  await useCleanDatabase(t)

  const first = await ensureSeedData()
  assert.deepEqual(first, { childId: M0_CHILD_ID, addedChild: true, addedTasks: 5, taskCount: 5 })
  assert.equal(await getDb().children.count(), 1)

  const tasks = await listTodayTasks(M0_CHILD_ID)
  assert.equal(tasks.length, 5)
  assert.deepEqual(tasks.map((task) => task.id), ["t_seed_01", "t_seed_02", "t_seed_03", "t_seed_04", "t_seed_05"])
  for (const task of tasks) {
    assert.equal(task.type, "temp")
    assert.equal(task.status, "todo")
    assert.equal(Object.hasOwn(task, "generationKey"), false)
    assert.equal(Object.hasOwn(task, "templateId"), false)
  }

  await getDb().tasks.update("t_seed_01", { status: "submitted" })
  const second = await ensureSeedData()
  assert.deepEqual(second, { childId: M0_CHILD_ID, addedChild: false, addedTasks: 0, taskCount: 5 })
  assert.equal((await getDb().tasks.get("t_seed_01")).status, "submitted")
})

test("M0-2 createTask/listTodayTasks：临时任务不写生成键且能按今天查询", async (t) => {
  await useCleanDatabase(t)
  await ensureSeedData()

  const created = await createTask({ childId: M0_CHILD_ID, title: "  浇花  ", points: 3 })
  assert.equal(created.title, "浇花")
  assert.equal(created.status, "todo")
  assert.equal(Object.hasOwn(created, "generationKey"), false)
  assert.equal(Object.hasOwn(created, "templateId"), false)
  assert.equal((await listTodayTasks(M0_CHILD_ID)).length, 6)

  await assert.rejects(
    createTask({ childId: M0_CHILD_ID, title: "错误日期", points: 1, dueDate: "2026-02-30" }),
    (error) => error?.code === DB_ERROR_CODES.VALIDATION_FAILED,
  )
})

test("M0-3 闭环：todo → submitted → approved，重开后状态与积分仍在", async (t) => {
  await useCleanDatabase(t)
  await ensureSeedData()

  const submitted = await submitTask({
    taskId: "t_seed_01",
    childId: M0_CHILD_ID,
    contentType: "text",
    content: "我已经把课本和文具都整理好了",
  })
  assert.equal(submitted.status, "submitted")
  assert.equal(submitted.version, 1)
  assert.equal((await getDb().tasks.get("t_seed_01")).status, "submitted")
  assert.equal((await getDb().submissions.get(submitted.submissionId)).content, "我已经把课本和文具都整理好了")

  await assert.rejects(
    submitTask({ taskId: "t_seed_01", childId: M0_CHILD_ID, contentType: "text", content: "重复提交" }),
    (error) => error?.code === DB_ERROR_CODES.VALIDATION_FAILED,
  )
  assert.equal(await getDb().submissions.count(), 1)

  const approved = await approveTask({ taskId: "t_seed_01", reviewerId: "parent_m0" })
  assert.equal(approved.status, "approved")
  assert.equal(approved.points, 5)
  assert.equal((await getDb().reviews.get(approved.reviewId)).reviewer, "parent_m0")
  assert.equal((await getBalance(M0_CHILD_ID)).balance, 5)

  closeDb()
  await openDatabase()
  const seedAfterReopen = await ensureSeedData()
  assert.equal(seedAfterReopen.addedTasks, 0)

  const persistedTask = (await listTodayTasks(M0_CHILD_ID)).find((task) => task.id === "t_seed_01")
  assert.equal(persistedTask.status, "approved")
  assert.equal(persistedTask.approvalDate, approved.approvalDate)
  assert.equal((await getBalance(M0_CHILD_ID)).balance, 5)
  assert.equal(await getDb().submissions.count(), 1)
  assert.equal(await getDb().reviews.count(), 1)
  assert.equal(await getDb().pointLedger.count(), 1)
  assert.equal(await getDb().petProgress.count(), 1)
  assert.equal(await getDb().streaks.count(), 1)
})
