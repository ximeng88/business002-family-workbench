/**
 * Schema v1 → v2 平滑升级测试（M2）。
 *
 * 这是"数据库升级是否无损"的唯一机器证据：
 * 1. 先按 v1 结构（schemaV1）建一个真实形态的旧库，写入孩子 / 任务 / 提交 / 审核 / 积分 / 经验 / 连续记录；
 * 2. 关闭后用当前版本（v2）打开，触发 Dexie upgrade；
 * 3. 逐表比对内容，确认一个字段都没丢、新表已建好、_meta.schemaVersion 同步为 2；
 * 4. 再关再开一次，确认升级幂等、不重复搬数据。
 *
 * 环境：fake-indexeddb。真实浏览器升级路径仍需在浏览器里验（见交付说明）。
 */

import "fake-indexeddb/auto"
import test from "node:test"
import assert from "node:assert/strict"
import Dexie from "dexie"

import { createFamilyDatabase, openDatabase, readSchemaVersion } from "../src/db/database.js"
import { SCHEMA_VERSION, TABLE_NAMES, schemaV1 } from "../src/db/schema.js"
import { ensureBuiltinRewardConfigs, listRewards } from "../src/services/reward.service.js"
import { uniqueDbName } from "./test-utils.js"

const META = (db) => db.table(TABLE_NAMES.META)

const ISO = "2026-11-20T02:30:00.000Z"
const DATE = "2026-11-20"

/** 按 v1 结构造一个"老用户"库，返回升级前的内容快照 */
async function buildLegacyV1Database(name) {
  const legacy = new Dexie(name)
  legacy.version(1).stores(schemaV1)
  await legacy.open()

  const child = {
    id: "c_m0",
    nickname: "朵朵",
    avatarKey: "cat",
    hasChildPin: false,
    createdAt: ISO,
  }

  const tasks = [
    {
      id: "t_seed_01",
      childId: "c_m0",
      title: "整理书包",
      points: 5,
      type: "temp",
      status: "approved",
      dueDate: DATE,
      submittedAt: ISO,
      approvedAt: ISO,
      approvalDate: DATE,
      createdAt: ISO,
    },
    {
      id: "t_fixed_01",
      childId: "c_m0",
      title: "朗读课文",
      points: 10,
      type: "daily",
      status: "submitted",
      dueDate: DATE,
      templateId: "tpl_01",
      generationKey: "daily:c_m0:tpl_01:2026-11-20",
      submittedAt: ISO,
      createdAt: ISO,
    },
    {
      id: "t_revision_01",
      childId: "c_m0",
      title: "数学口算",
      points: 10,
      type: "temp",
      status: "revision",
      dueDate: DATE,
      revisionReason: "再检查一遍",
      returnCount: 1,
      createdAt: ISO,
    },
  ]

  const submission = {
    id: "sub_01",
    taskId: "t_seed_01",
    childId: "c_m0",
    submittedAt: ISO,
    version: 1,
    status: "submitted",
    contentType: "text",
    content: "语文书和数学书都装好了",
  }

  const review = {
    id: "rev_01",
    taskId: "t_seed_01",
    childId: "c_m0",
    result: "approved",
    reason: null,
    reviewer: "parent",
    reviewedAt: ISO,
    approvalDate: DATE,
    eventKey: "approval:t_seed_01",
  }

  const ledger = {
    id: "lgr_01",
    childId: "c_m0",
    delta: 5,
    reason: "完成「整理书包」",
    source: "task",
    taskId: "t_seed_01",
    approvalDate: DATE,
    eventKey: "approval:t_seed_01",
    createdAt: ISO,
  }

  const exp = {
    id: "exp_01",
    childId: "c_m0",
    delta: 5,
    taskId: "t_seed_01",
    approvalDate: DATE,
    eventKey: "approval:t_seed_01",
    createdAt: ISO,
  }

  const streak = {
    id: "c_m0:2026-11-20",
    childId: "c_m0",
    date: DATE,
    approvedCount: 1,
    createdAt: ISO,
    updatedAt: ISO,
  }

  // v1 里 rewards 从未被写入过；这里故意放一条"来历不明"的记录，验证防御性回填不清空
  const legacyReward = { id: "rw_legacy", name: "旧奖励", cost: 15, enabled: true, createdAt: ISO }

  await legacy.children.add(child)
  for (const task of tasks) await legacy.tasks.add(task)
  await legacy.submissions.add(submission)
  await legacy.reviews.add(review)
  await legacy.pointLedger.add(ledger)
  await legacy.petProgress.add(exp)
  await legacy.streaks.add(streak)
  await legacy.rewards.add(legacyReward)
  await META(legacy).put({ key: "schemaVersion", value: 1, updatedAt: ISO })
  await META(legacy).put({ key: "createdAt", value: ISO, updatedAt: ISO })
  await META(legacy).put({ key: "restoreState", value: "complete", updatedAt: ISO })

  const snapshot = {
    child: await legacy.children.get("c_m0"),
    // toArray 按主键排序，不能按下标取；统一按 id 查
    tasks: new Map((await legacy.tasks.toArray()).map((task) => [task.id, task])),
    submission: await legacy.submissions.get("sub_01"),
    review: await legacy.reviews.get("rev_01"),
    ledger: await legacy.pointLedger.toArray(),
    exp: await legacy.petProgress.toArray(),
    streak: await legacy.streaks.get("c_m0:2026-11-20"),
  }

  legacy.close()
  return snapshot
}

test("M2-MG1 v1 旧库升级到 v2：逐表内容完全保留", async (t) => {
  const name = uniqueDbName("b002_migrate")
  const before = await buildLegacyV1Database(name)

  const db = createFamilyDatabase(name)
  t.after(async () => {
    try {
      db.close()
    } catch {
      // 已关闭
    }
    await Dexie.delete(name)
  })

  await openDatabase(db)
  assert.equal(await readSchemaVersion(db), SCHEMA_VERSION)
  assert.equal(SCHEMA_VERSION, 2)

  // 孩子、任务、提交、审核、流水、经验、连续记录：一个字段都不能变
  assert.deepEqual(await db.children.get("c_m0"), before.child)
  for (const taskId of ["t_seed_01", "t_fixed_01", "t_revision_01"]) {
    assert.deepEqual(await db.tasks.get(taskId), before.tasks.get(taskId), `任务 ${taskId} 必须逐字段一致`)
  }
  assert.equal((await db.tasks.count()), 3, "任务条数不能变")
  assert.deepEqual(await db.submissions.get("sub_01"), before.submission)
  assert.deepEqual(await db.reviews.get("rev_01"), before.review)
  assert.deepEqual(await db.pointLedger.toArray(), before.ledger)
  assert.deepEqual(await db.petProgress.toArray(), before.exp)
  assert.deepEqual(await db.streaks.get("c_m0:2026-11-20"), before.streak)

  // 积分余额仍由流水派生，升级不影响
  const total = (await db.pointLedger.toArray()).reduce((sum, row) => sum + row.delta, 0)
  assert.equal(total, 5)

  // 老任务的唯一生成键仍生效（没有因为升级丢索引）
  const byGenerationKey = await db.tasks.where("generationKey").equals("daily:c_m0:tpl_01:2026-11-20").first()
  assert.equal(byGenerationKey.id, "t_fixed_01")
})

test("M2-MG2 v2 新表已建好且为空，旧奖励被防御性回填", async (t) => {
  const name = uniqueDbName("b002_migrate_tables")
  await buildLegacyV1Database(name)

  const db = createFamilyDatabase(name)
  t.after(async () => {
    try {
      db.close()
    } catch {
      // 已关闭
    }
    await Dexie.delete(name)
  })

  await openDatabase(db)

  const tables = db.tables.map((table) => table.name).sort()
  assert.deepEqual(tables, Object.values(TABLE_NAMES).sort())
  assert.equal(await db.petCostumeOwnerships.count(), 0)
  assert.equal(await db.petCostumeStates.count(), 0)

  const legacy = await db.rewards.get("rw_legacy")
  assert.equal(legacy.name, "旧奖励")
  assert.equal(legacy.cost, 15, "旧价格必须保留，不能被默认值覆盖")
  assert.equal(legacy.enabled, true)
  assert.equal(legacy.source, "custom", "来历不明的旧奖励按自定义处理，不冒充内置模板")
  assert.equal(legacy.category, "life")
  assert.equal(Object.hasOwn(legacy, "templateKey"), false, "自定义奖励不能有 templateKey 属性")

  // 升级后仍可正常补齐 11 个内置奖励，且不与旧记录冲突
  const result = await ensureBuiltinRewardConfigs(db)
  assert.equal(result.added, 11)
  assert.equal(result.total, 12)
  const rewards = await listRewards({ db })
  assert.equal(rewards.filter((row) => row.source === "builtin").length, 11)
})

test("M2-MG3 重复打开不重复迁移，数据不丢", async (t) => {
  const name = uniqueDbName("b002_migrate_twice")
  await buildLegacyV1Database(name)

  const first = createFamilyDatabase(name)
  await openDatabase(first)
  const firstCount = await first.tasks.count()
  first.close()

  const second = createFamilyDatabase(name)
  t.after(async () => {
    try {
      second.close()
    } catch {
      // 已关闭
    }
    await Dexie.delete(name)
  })

  await openDatabase(second)
  assert.equal(await readSchemaVersion(second), 2)
  assert.equal(await second.tasks.count(), firstCount)
  assert.equal((await second.pointLedger.toArray()).reduce((sum, row) => sum + row.delta, 0), 5)
  assert.equal((await second.tasks.get("t_seed_01")).status, "approved")
})
