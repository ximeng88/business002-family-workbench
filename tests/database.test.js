/**
 * 数据库基础测试
 * 环境：**fake-indexeddb 6.2.8**（Node 24），不是真实浏览器验证。
 * 真实浏览器冒烟见 tests/browser-smoke.html 与交付报告。
 */

import "fake-indexeddb/auto"
import test from "node:test"
import assert from "node:assert/strict"
import Dexie from "dexie"

import {
  createFamilyDatabase,
  openDatabase,
  readSchemaVersion,
  isDatabaseSupported,
} from "../src/db/database.js"
import { SCHEMA_VERSION, TABLE_NAMES } from "../src/db/schema.js"
import { applySchema } from "../src/db/migrations.js"
import { DbError, DB_ERROR_CODES } from "../src/db/errors.js"
import { toIsoTimestamp } from "../src/db/date.js"
import { createTestDb, destroyTestDb, makeChild, makeTask, uniqueDbName } from "./test-utils.js"

test("8.1 打开正常：表清单与元数据齐全", async (t) => {
  const { db, name } = await createTestDb("b002_db_open")
  t.after(() => destroyTestDb(db, name))

  assert.equal(db.isOpen(), true)
  assert.equal(await readSchemaVersion(db), SCHEMA_VERSION)

  const createdAt = await db.table(TABLE_NAMES.META).get("createdAt")
  assert.ok(createdAt && typeof createdAt.value === "string")
  const restoreState = await db.table(TABLE_NAMES.META).get("restoreState")
  assert.equal(restoreState?.value, "complete")

  const tables = db.tables.map((table) => table.name).sort()
  assert.deepEqual(tables, Object.values(TABLE_NAMES).sort())
  // v2：13 张业务表（含装扮收藏与穿戴）+ _meta
  assert.equal(tables.length, Object.values(TABLE_NAMES).length)
  assert.equal(tables.length, 14)
})

test("8.1 核心表读写正常", async (t) => {
  const { db, name } = await createTestDb("b002_db_rw")
  t.after(() => destroyTestDb(db, name))

  const child = makeChild()
  const task = makeTask()
  await db.children.add(child)
  await db.tasks.add(task)
  await db.settings.put({ key: "lastBackupAt", value: null, updatedAt: toIsoTimestamp() })

  assert.equal((await db.children.get(child.id)).nickname, child.nickname)
  const storedTask = await db.tasks.get(task.id)
  assert.equal(storedTask.title, task.title)
  assert.equal(storedTask.dueDate, "2026-11-18")
  assert.equal((await db.settings.get("lastBackupAt")).key, "lastBackupAt")

  // 日期级索引可用：按 孩子 + 应完成日期 查询
  const sameDay = await db.tasks.where("[childId+dueDate]").equals([child.id, "2026-11-18"]).toArray()
  assert.equal(sameDay.length, 1)
})

test("8.1 唯一索引阻止重复：积分流水 eventKey", async (t) => {
  const { db, name } = await createTestDb("b002_db_unique_ledger")
  t.after(() => destroyTestDb(db, name))

  const entry = {
    id: "lgr_1",
    childId: "c_test",
    delta: 10,
    reason: "完成「读 10 分钟」",
    source: "task",
    eventKey: "approval:t_test",
    createdAt: toIsoTimestamp(),
  }
  await db.pointLedger.add(entry)
  await assert.rejects(
    db.pointLedger.add({ ...entry, id: "lgr_2" }),
    (error) => error?.name === "ConstraintError",
  )
  assert.equal(await db.pointLedger.count(), 1)
})

test("8.1 唯一索引阻止重复：宠物经验 eventKey 与审核记录 eventKey", async (t) => {
  const { db, name } = await createTestDb("b002_db_unique_exp")
  t.after(() => destroyTestDb(db, name))

  const createdAt = toIsoTimestamp()
  await db.petProgress.add({ id: "exp_1", childId: "c_test", delta: 10, eventKey: "approval:t_test", createdAt })
  await assert.rejects(
    db.petProgress.add({ id: "exp_2", childId: "c_test", delta: 10, eventKey: "approval:t_test", createdAt }),
    (error) => error?.name === "ConstraintError",
  )

  await db.reviews.add({
    id: "rev_1",
    taskId: "t_test",
    childId: "c_test",
    result: "approved",
    eventKey: "approval:t_test",
    reviewedAt: createdAt,
  })
  await assert.rejects(
    db.reviews.add({
      id: "rev_2",
      taskId: "t_test",
      childId: "c_test",
      result: "approved",
      eventKey: "approval:t_test",
      reviewedAt: createdAt,
    }),
    (error) => error?.name === "ConstraintError",
  )
})

test("8.1 R-02：连续退回记录不写 eventKey，可重复写入", async (t) => {
  const { db, name } = await createTestDb("b002_db_revision_events")
  t.after(() => destroyTestDb(db, name))

  const base = {
    taskId: "t_test",
    childId: "c_test",
    result: "revision",
    reason: "再检查一遍",
    reviewedAt: toIsoTimestamp(),
  }
  await db.reviews.add({ ...base, id: "rev_return_1" })
  await db.reviews.add({ ...base, id: "rev_return_2" })

  const records = await db.reviews.toArray()
  assert.equal(records.length, 2)
  assert.equal(Object.hasOwn(records[0], "eventKey"), false)
  assert.equal(Object.hasOwn(records[1], "eventKey"), false)
})

test("8.1 R-01：同模板同日两个孩子各生成一条，均成功", async (t) => {
  const { db, name } = await createTestDb("b002_db_generation_children")
  t.after(() => destroyTestDb(db, name))

  await db.tasks.add(makeTask({
    id: "t_fixed_a",
    childId: "c_a",
    templateId: "tpl_shared",
    generationKey: "daily:c_a:tpl_shared:2026-11-18",
  }))
  await db.tasks.add(makeTask({
    id: "t_fixed_b",
    childId: "c_b",
    templateId: "tpl_shared",
    generationKey: "daily:c_b:tpl_shared:2026-11-18",
  }))

  assert.equal(await db.tasks.count(), 2)
})

test("8.1 R-01：同孩子同模板同日第二次生成抛 ConstraintError", async (t) => {
  const { db, name } = await createTestDb("b002_db_generation_duplicate")
  t.after(() => destroyTestDb(db, name))

  const generationKey = "daily:c_test:tpl_test:2026-11-18"
  await db.tasks.add(makeTask({ id: "t_fixed_1", generationKey }))
  await assert.rejects(
    db.tasks.add(makeTask({ id: "t_fixed_2", generationKey })),
    (error) => error?.name === "ConstraintError",
  )
  assert.equal(await db.tasks.count(), 1)
})

test("8.1 临时任务不写 generationKey，可存在多条", async (t) => {
  const { db, name } = await createTestDb("b002_db_generation_temp")
  t.after(() => destroyTestDb(db, name))

  const tempA = makeTask({ id: "t_temp_1", type: "temp", status: "todo" })
  const tempB = makeTask({ id: "t_temp_2", type: "temp", status: "todo" })
  delete tempA.generationKey
  delete tempB.generationKey
  await db.tasks.add(tempA)
  await db.tasks.add(tempB)

  assert.equal(await db.tasks.count(), 2)
  assert.equal(Object.hasOwn(await db.tasks.get("t_temp_1"), "generationKey"), false)
  assert.equal(Object.hasOwn(await db.tasks.get("t_temp_2"), "generationKey"), false)
  assert.equal((await db.tasks.where("generationKey").equals("").count()), 0)
})

test("8.1 streaks：每孩子每天唯一（唯一复合索引）", async (t) => {
  const { db, name } = await createTestDb("b002_db_streak")
  t.after(() => destroyTestDb(db, name))

  const createdAt = toIsoTimestamp()
  await db.streaks.add({ id: "c_test:2026-11-20", childId: "c_test", date: "2026-11-20", approvedCount: 1, createdAt })
  await assert.rejects(
    db.streaks.add({ id: "dup", childId: "c_test", date: "2026-11-20", approvedCount: 1, createdAt }),
    (error) => error?.name === "ConstraintError",
  )
  // 不同日期、不同孩子均可
  await db.streaks.add({ id: "c_test:2026-11-21", childId: "c_test", date: "2026-11-21", approvedCount: 1, createdAt })
  await db.streaks.add({ id: "c_other:2026-11-20", childId: "c_other", date: "2026-11-20", approvedCount: 1, createdAt })
  assert.equal(await db.streaks.count(), 3)
})

test("8.1 版本升级可执行（Dexie 原生机制验证）", async () => {
  const name = uniqueDbName("b002_upgrade_ok")
  const v1 = new Dexie(name)
  v1.version(1).stores({ items: "id" })
  await v1.open()
  await v1.items.add({ id: "a" })
  v1.close()

  const v2 = new Dexie(name)
  v2.version(1).stores({ items: "id" })
  v2.version(2)
    .stores({ items: "id, tag" })
    .upgrade(async (tx) => {
      await tx
        .table("items")
        .toCollection()
        .modify((item) => {
          item.tag = "migrated"
        })
    })
  await v2.open()
  assert.equal(v2.verno, 2)
  assert.equal((await v2.items.get("a")).tag, "migrated")
  v2.close()
  await Dexie.delete(name)
})

test("8.1 升级失败：明确报错且不清空原数据", async () => {
  const name = uniqueDbName("b002_upgrade_fail")

  // 版本 1 的库与数据
  const seed = new Dexie(name)
  seed.version(1).stores({ items: "id" })
  await seed.open()
  await seed.items.add({ id: "keep_me" })
  seed.close()

  // 版本 2 的 upgrade 主动抛错（模拟迁移代码失败），经真实的 applySchema 注册
  const failing = new Dexie(name)
  applySchema(failing, [
    { version: 1, stores: { items: "id" } },
    {
      version: 2,
      stores: { items: "id, tag" },
      upgrade: async () => {
        throw new Error("inject: upgrade failure")
      },
    },
  ])

  await assert.rejects(openDatabase(failing), (error) => {
    assert.ok(error instanceof DbError)
    assert.equal(error.code, DB_ERROR_CODES.UPGRADE_FAILED)
    return true
  })
  assert.equal(failing.isOpen(), false)

  // 原数据仍然存在（未被删除、未被清空，版本变更整体回滚）
  const probe = new Dexie(name)
  probe.version(1).stores({ items: "id" })
  await probe.open()
  assert.equal(await probe.items.count(), 1)
  probe.close()
  await Dexie.delete(name)
})

test("8.1 不支持 IndexedDB 时明确报错，不创建空库", async () => {
  assert.equal(isDatabaseSupported(), true) // fake-indexeddb 环境
  const saved = globalThis.indexedDB
  try {
    delete globalThis.indexedDB
    assert.throws(
      () => createFamilyDatabase("b002_unsupported"),
      (error) => error instanceof DbError && error.code === DB_ERROR_CODES.UNSUPPORTED,
    )
  } finally {
    globalThis.indexedDB = saved
  }
})

test("8.1 R-06：restoreState=restoring 时进入异常态，不盖完成章", async (t) => {
  const { db, name } = await createTestDb("b002_db_restoring")
  t.after(() => destroyTestDb(db, name))

  await db.table(TABLE_NAMES.META).put({
    key: "restoreState",
    value: "restoring",
    updatedAt: toIsoTimestamp(),
  })
  db.close()

  await assert.rejects(
    openDatabase(db),
    (error) => error instanceof DbError && error.code === DB_ERROR_CODES.INVALID_STATE,
  )
  const restoreState = await db.table(TABLE_NAMES.META).get("restoreState")
  assert.equal(restoreState?.value, "restoring")
  assert.equal(await db.children.count(), 0)
})

test("8.1 R-06：已有业务数据但缺完成标记时保留原数据并报异常", async (t) => {
  const name = uniqueDbName("b002_db_missing_complete")
  const db = createFamilyDatabase(name)
  t.after(() => destroyTestDb(db, name))

  await openDatabase(db)
  await db.children.add(makeChild({ id: "c_existing" }))
  await db.table(TABLE_NAMES.META).delete("restoreState")
  db.close()

  await assert.rejects(
    openDatabase(db),
    (error) => error instanceof DbError && error.code === DB_ERROR_CODES.INVALID_STATE,
  )
  assert.equal(await db.table(TABLE_NAMES.META).get("restoreState"), undefined)
  assert.equal((await db.children.get("c_existing"))?.id, "c_existing")
  assert.equal(await db.children.count(), 1)
})
