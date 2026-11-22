/**
 * 备份 / 恢复测试（M3，最高优先级）。
 *
 * 覆盖：
 * - 导出必须包含全部 14 张表（含积分流水、装扮收藏、固定任务、设置）；
 * - 导出文本可被自己解析回来（往返一致）；
 * - 坏文件（不是 JSON / 不是本应用的 / 缺表 / 断链 / 重复主键）**一律拒绝且不改库**；
 * - 恢复是覆盖式的：加一个孩子再导入，回到备份那一刻；
 * - 恢复是原子的：中途写失败整体回滚，旧数据一条不少；
 * - v1 老备份导入时自动补齐 v2 字段；
 * - 导入前自动留快照，可一键撤销；
 * - 导入不改本机 PIN。
 */

import "fake-indexeddb/auto"
import test from "node:test"
import assert from "node:assert/strict"
import Dexie from "dexie"

import { closeDb, getDb, openDatabase, readSchemaVersion } from "../src/db/database.js"
import { DB_NAME, SCHEMA_VERSION, TABLE_NAMES } from "../src/db/schema.js"
import { DB_ERROR_CODES } from "../src/db/errors.js"
import { approveTask } from "../src/services/approval.service.js"
import {
  BACKUP_FORMAT,
  BACKUP_TABLES,
  backupOverview,
  clearPreRestoreSnapshot,
  exportBackup,
  parseBackupText,
  readPreRestoreSnapshot,
  restoreBackup,
  undoLastRestore,
  validateBackupPayload,
  wipeAllData,
} from "../src/services/backup.service.js"
import { getBalance, adjustPoints } from "../src/services/points.service.js"
import { getPinStatus, setParentPin } from "../src/services/pin.service.js"
import { createChild, getChild, updateChildProfile } from "../src/services/child.service.js"
import { ensureSeedData, M0_CHILD_ID, submitTask } from "../src/services/task.service.js"

async function useCleanDatabase(t) {
  closeDb()
  await Dexie.delete(DB_NAME)
  clearPreRestoreSnapshot()
  await openDatabase()
  await ensureSeedData()
  t.after(async () => {
    closeDb()
    await Dexie.delete(DB_NAME)
    clearPreRestoreSnapshot()
  })
}

/** 造一批"有内容"的数据：一条通过的完整任务 + 一笔手动流水 */
async function seedRichData() {
  await submitTask({
    taskId: "t_seed_01",
    childId: M0_CHILD_ID,
    contentType: "text",
    content: "书包整理好了",
  })
  await approveTask({ taskId: "t_seed_01", reviewerId: "parent" })
  await adjustPoints({ childId: M0_CHILD_ID, delta: 20, reason: "测试加分" })
}

async function countTables() {
  const counts = {}
  for (const table of BACKUP_TABLES) counts[table] = await getDb().table(table).count()
  return counts
}

test("M3-BK1 导出包含全部 14 张表，表头齐全", async (t) => {
  await useCleanDatabase(t)
  await seedRichData()

  const result = await exportBackup()

  assert.equal(result.payload.format, BACKUP_FORMAT)
  assert.equal(result.payload.formatVersion, 1)
  assert.equal(result.payload.schemaVersion, SCHEMA_VERSION)
  assert.equal(BACKUP_TABLES.length, 14, "13 张业务表 + _meta")
  assert.deepEqual(Object.keys(result.payload.data).sort(), [...BACKUP_TABLES].sort())

  // 每张表都在，且 counts 与实际写入一致
  for (const table of BACKUP_TABLES) {
    assert.ok(Array.isArray(result.payload.data[table]), `${table} 必须是数组`)
    assert.equal(result.payload.counts[table], result.payload.data[table].length)
  }

  assert.equal(result.payload.counts[TABLE_NAMES.TASKS], 5, "5 条 seed 任务")
  assert.equal(result.payload.counts[TABLE_NAMES.POINT_LEDGER], 2, "审核 +5、手动 +20")
  assert.equal(result.payload.counts[TABLE_NAMES.SUBMISSIONS], 1)
  assert.equal(result.payload.counts[TABLE_NAMES.REVIEWS], 1)
  assert.equal(result.payload.counts[TABLE_NAMES.PET_PROGRESS], 1)
  assert.equal(result.payload.counts[TABLE_NAMES.STREAKS], 1)

  // 文件名可读、带日期
  assert.match(result.fileName, /^学习工作台-备份-\d{4}-\d{2}-\d{2}-\d{4}\.json$/)
  assert.ok(result.bytes > 100)

  // 导出会记下最近备份时间
  assert.equal((await backupOverview()).lastBackupAt, result.payload.exportedAt)
})

test("M3-BK2 导出的文本能原样解析回来", async (t) => {
  await useCleanDatabase(t)
  await seedRichData()

  const { text, payload } = await exportBackup()
  const summary = parseBackupText(text)

  assert.equal(summary.total, Object.values(payload.counts).reduce((sum, n) => sum + n, 0))
  assert.equal(summary.schemaVersion, SCHEMA_VERSION)
  assert.deepEqual(summary.counts, payload.counts)
  assert.equal(summary.payload.data.tasks.length, payload.data.tasks.length)

  // 摘要信息足够用户在导入弹窗里判断"是不是这份"
  assert.equal(typeof summary.exportedAt, "string")
})

test("M3-BK3 坏文件一律拒绝，且库内数据一条不动", async (t) => {
  await useCleanDatabase(t)
  await seedRichData()
  // 先导出（导出会写"最近备份"三个设置键），再取基线
  const good = await exportBackup()
  const before = await countTables()

  const broken = [
    ["不是 JSON", "这不是 json"],
    ["空文件", "   "],
    ["不是本应用的备份", JSON.stringify({ ...good.payload, format: "something-else" })],
    [
      "缺表",
      JSON.stringify({
        ...good.payload,
        data: { ...good.payload.data, [TABLE_NAMES.STREAKS]: undefined },
      }),
    ],
    [
      "多出未知表",
      JSON.stringify({
        ...good.payload,
        data: { ...good.payload.data, surprise: [] },
      }),
    ],
    [
      "任务指向不存在的孩子",
      JSON.stringify({
        ...good.payload,
        data: {
          ...good.payload.data,
          [TABLE_NAMES.TASKS]: good.payload.data[TABLE_NAMES.TASKS].map((task) => ({
            ...task,
            childId: "c_ghost",
          })),
        },
      }),
    ],
    [
      "重复主键",
      JSON.stringify({
        ...good.payload,
        data: {
          ...good.payload.data,
          [TABLE_NAMES.TASKS]: [
            good.payload.data[TABLE_NAMES.TASKS][0],
            good.payload.data[TABLE_NAMES.TASKS][0],
          ],
        },
      }),
    ],
    [
      "没有孩子",
      JSON.stringify({
        ...good.payload,
        data: { ...good.payload.data, [TABLE_NAMES.CHILDREN]: [] },
      }),
    ],
    ["版本比当前新", JSON.stringify({ ...good.payload, schemaVersion: SCHEMA_VERSION + 1 })],
  ]

  for (const [label, text] of broken) {
    await assert.rejects(
      () => restoreBackup(text),
      (error) => {
        assert.equal(error.code, DB_ERROR_CODES.VALIDATION_FAILED, `${label} 应该是校验失败`)
        return true
      },
      `${label} 必须被拒绝`,
    )
  }

  assert.deepEqual(await countTables(), before, "拒绝坏文件时不能写坏任何一张表")
  assert.equal(await readSchemaVersion(), SCHEMA_VERSION)
})

test("M3-BK4 覆盖恢复：加一个孩子再导入，回到备份那一刻", async (t) => {
  await useCleanDatabase(t)
  await seedRichData()

  const snapshot = await exportBackup()
  const balanceBefore = (await getBalance(M0_CHILD_ID)).balance
  assert.equal(balanceBefore, 25, "5 + 20")

  // 备份之后又加了孩子、又加了分
  await createChild({ nickname: "临时小孩" })
  await adjustPoints({ childId: M0_CHILD_ID, delta: 100, reason: "备份之后的变动" })
  assert.equal((await getDb().children.count()), 2)
  assert.equal((await getBalance(M0_CHILD_ID)).balance, 125)

  const result = await restoreBackup(snapshot.text)

  assert.equal((await getDb().children.count()), 1, "新加的孩子应该被覆盖掉")
  assert.equal((await getBalance(M0_CHILD_ID)).balance, balanceBefore, "流水回到备份时刻")
  assert.equal(result.total, Object.values(snapshot.payload.counts).reduce((sum, n) => sum + n, 0))
  assert.equal(result.fromSchemaVersion, SCHEMA_VERSION)
  assert.equal(result.migrated, false)
  assert.equal(await readSchemaVersion(), SCHEMA_VERSION, "_meta.schemaVersion 要对齐当前版本")
  assert.equal((await getDb().table("_meta").get("restoreState")).value, "complete")

  // 关系仍然对得上：审核记录 → 任务 → 孩子
  const review = await getDb().reviews.toArray()
  assert.equal(review.length, 1)
  assert.ok(await getDb().tasks.get(review[0].taskId))
})

test("M3-BK5 恢复是原子的：写到一半失败，旧数据完好", async (t) => {
  await useCleanDatabase(t)
  await seedRichData()

  const snapshot = await exportBackup()
  const before = await countTables()
  const payload = JSON.parse(snapshot.text)
  // 让写入阶段炸掉：函数无法被结构化克隆
  payload.data[TABLE_NAMES.CHILDREN][0].nickname = () => "不该被写进去"

  await assert.rejects(() => restoreBackup(payload, { skipSnapshot: true }))

  assert.deepEqual(await countTables(), before, "失败必须整笔回滚，不能出现清空了却没写进去的库")
  assert.equal((await getPinStatus()).configured, false)
  const children = await getDb().children.toArray()
  assert.equal(children.length, 1)
  assert.equal(children[0].nickname, "朵朵", "旧记录不能被改坏")
  assert.equal((await getBalance(M0_CHILD_ID)).balance, 25)
})

test("M3-BK6 v1 老备份导入时自动补齐 v2 字段", async (t) => {
  await useCleanDatabase(t)
  const snapshot = await exportBackup()
  const payload = JSON.parse(snapshot.text)

  // 模拟一份 v1 时代的备份：没有 rewards 的 v2 字段，也没有装扮表内容
  payload.schemaVersion = 1
  payload.data[TABLE_NAMES.REWARDS] = [
    { id: "rw_old", name: "旧奖励", cost: 30, enabled: true, createdAt: "2026-11-01T00:00:00.000Z" },
  ]
  payload.data[TABLE_NAMES.REDEMPTIONS] = []

  const result = await restoreBackup(payload, { skipSnapshot: true })
  assert.equal(result.migrated, true)

  const reward = await getDb().rewards.get("rw_old")
  assert.equal(reward.source, "custom", "缺来源按自定义处理")
  assert.equal(reward.category, "life")
  assert.equal(reward.cost, 30, "已有价格不能被覆盖")
  assert.equal(Object.hasOwn(reward, "templateKey"), false, "自定义奖励不能有空 templateKey")
  assert.equal(await readSchemaVersion(), SCHEMA_VERSION)
})

test("M3-BK7 导入前自动留快照，可一键撤销", async (t) => {
  await useCleanDatabase(t)
  await seedRichData()
  const backupAll = await exportBackup()

  // 备份之后新增一个孩子
  const extra = await createChild({ nickname: "小宝" })
  assert.equal((await getDb().children.count()), 2)

  const result = await restoreBackup(backupAll.text)
  assert.ok(result.snapshot, "导入时必须自动存一份快照")
  assert.ok(["localStorage", "memory"].includes(result.snapshot.saved))

  const stored = readPreRestoreSnapshot()
  assert.ok(stored, "快照应该能读回来")
  assert.equal(stored.counts[TABLE_NAMES.CHILDREN], 2, "快照里应该有两个孩子")

  // 撤销：回到导入前（有两个孩子的状态）
  const undone = await undoLastRestore()
  assert.equal(undone.total, stored.total)
  assert.equal((await getDb().children.count()), 2)
  assert.ok(await getDb().children.get(extra.id))
  assert.equal(readPreRestoreSnapshot(), null, "撤销成功后快照要清掉，避免误点第二次")

  await assert.rejects(() => undoLastRestore(), (error) => error.code === DB_ERROR_CODES.VALIDATION_FAILED)
})

test("M3-BK8 导入不改本机 PIN", async (t) => {
  await useCleanDatabase(t)
  await setParentPin({ pin: "4826" })

  const snapshot = await exportBackup()
  const payload = JSON.parse(snapshot.text)
  // 把备份里的 PIN 抹掉，模拟"从没有 PIN 的设备导过来"
  payload.data[TABLE_NAMES.SETTINGS] = payload.data[TABLE_NAMES.SETTINGS].filter(
    (row) => !String(row.key).startsWith("parentPin"),
  )

  await restoreBackup(payload, { skipSnapshot: true })

  const status = await getPinStatus()
  assert.equal(status.configured, true, "本机 PIN 不能被备份清掉")
})

test("M3-BK9 校验器本身不改库（纯函数）", async (t) => {
  await useCleanDatabase(t)
  const snapshot = await exportBackup()
  const before = await countTables()

  const summary = validateBackupPayload(snapshot.payload)
  assert.equal(summary.total, Object.values(snapshot.payload.counts).reduce((sum, n) => sum + n, 0))
  assert.deepEqual(await countTables(), before, "校验只读，不能写库")
})

/* =============== M4：彻底删除（G-05） =============== */

test("M4-BK10 彻底清空：业务表归零、_meta 回到刚建库、设置与 PIN 一起清掉", async (t) => {
  await useCleanDatabase(t)
  await seedRichData()
  await setParentPin({ pin: "4826" })

  // 造一个"导入前快照"，验证清空会连它一起抹掉
  const snapshot = await exportBackup()
  await restoreBackup(snapshot.payload)
  assert.ok(await readPreRestoreSnapshot(), "先得有一份可撤销的快照")
  // 导入会保住本机 PIN，所以这里仍然是"已配置"状态
  assert.equal((await getPinStatus()).configured, true)

  const before = await countTables()
  assert.ok(before[TABLE_NAMES.TASKS] > 0)

  const result = await wipeAllData()

  const after = await countTables()
  for (const table of BACKUP_TABLES) {
    if (table === TABLE_NAMES.META) continue
    assert.equal(after[table], 0, `${table} 必须一条不剩`)
  }
  assert.equal(after[TABLE_NAMES.META], 3, "只留 schemaVersion / createdAt / restoreState")
  assert.equal(result.wiped[TABLE_NAMES.TASKS], before[TABLE_NAMES.TASKS])
  assert.ok(result.total > 0)

  // 元数据：版本还是当前版本，状态是 complete —— 否则下次打开会被判成异常库
  assert.equal(await readSchemaVersion(), SCHEMA_VERSION)
  const meta = await getDb().table(TABLE_NAMES.META).toArray()
  assert.equal(meta.find((row) => row.key === "restoreState")?.value, "complete")
  assert.ok(meta.find((row) => row.key === "createdAt")?.value, "重置后要有一个新的创建时间")

  // PIN 与恢复码也算家庭数据，一并清掉
  const status = await getPinStatus()
  assert.equal(status.configured, false)
  assert.equal(status.recoveryConfigured, false)
  assert.equal(await getDb().settings.count(), 0)

  // 快照不能留：留着就等于"删了还能一键恢复"
  assert.equal(await readPreRestoreSnapshot(), null)
  const overview = await backupOverview()
  assert.equal(overview.counts[TABLE_NAMES.CHILDREN], 0)
  assert.equal(overview.counts[TABLE_NAMES.TASKS], 0)
  assert.equal(overview.total, 3, "只剩 _meta 的三行；业务表全部为 0")
  assert.equal(overview.canUndo, false)
})

test("M4-BK11 清空后重新初始化，回到只有朵朵和示例任务的第一天", async (t) => {
  await useCleanDatabase(t)
  await seedRichData()
  assert.equal(await getDb().children.count(), 1)

  await wipeAllData()
  await ensureSeedData()

  const children = await getDb().children.toArray()
  assert.equal(children.length, 1, "重新种出唯一的孩子")
  assert.equal(children[0].id, M0_CHILD_ID)
  assert.equal(children[0].nickname, "朵朵")
  assert.equal(await getDb().tasks.count(), 5, "5 条示例任务回来了")
  assert.equal(await getDb().pointLedger.count(), 0, "星星归零，不带走旧流水")
  assert.equal(await getDb().children.get("c_test"), undefined)
})

test("M4-BK12 清空是原子的：中途失败整笔回滚，一条也不删", async (t) => {
  await useCleanDatabase(t)
  await seedRichData()

  const before = await countTables()
  const db = getDb()
  const realTable = db.table.bind(db)
  const poisoned = new Proxy(db, {
    get(target, prop, receiver) {
      if (prop === "table") {
        return (name) => {
          const table = realTable(name)
          if (name !== TABLE_NAMES.TASKS) return table
          return new Proxy(table, {
            get(tableTarget, key) {
              if (key === "clear") {
                return async () => {
                  throw new Error("模拟写失败")
                }
              }
              const value = Reflect.get(tableTarget, key)
              return typeof value === "function" ? value.bind(tableTarget) : value
            },
          })
        }
      }
      const value = Reflect.get(target, prop, receiver)
      return typeof value === "function" ? value.bind(target) : value
    },
  })

  await assert.rejects(
    () => wipeAllData({ db: poisoned }),
    (error) => Boolean(error.code),
    "写失败必须抛错",
  )
  assert.deepEqual(await countTables(), before, "失败必须整笔回滚，不能留下半个空库")
})

test("M4-BK13 清空后的库还能正常打开（再关再开不报 INVALID_STATE）", async (t) => {
  await useCleanDatabase(t)
  await seedRichData()

  await wipeAllData()
  closeDb()
  await openDatabase()

  assert.equal(await getDb().children.count(), 0)
  assert.equal(await getDb().settings.count(), 0)
  assert.equal(await readSchemaVersion(), SCHEMA_VERSION)
})

/* ---------------- M6：头像进备份 ---------------- */

const AVATAR_JPEG = `data:image/jpeg;base64,${"B".repeat(96)}`

test("M6-BK1 头像（dataURL）随整表导出，恢复后一模一样", async (t) => {
  await useCleanDatabase(t)
  await ensureSeedData()
  const child = await createChild({ nickname: "小美", avatarKey: "rabbit" })
  await updateChildProfile({
    childId: child.id,
    avatarImage: AVATAR_JPEG,
    petKey: "fox",
    nickname: "小美美",
  })

  const exported = await exportBackup()
  const row = exported.payload.data[TABLE_NAMES.CHILDREN].find((item) => item.id === child.id)
  assert.equal(row.avatarImage, AVATAR_JPEG, "备份必须带图片本体，而不是 blob: 地址")
  assert.equal(row.petKey, "fox")
  assert.equal(row.nickname, "小美美")

  // 往返：解析 → 恢复 → 头像 / 昵称 / 伙伴都回来
  const summary = parseBackupText(exported.text)
  assert.equal(summary.counts[TABLE_NAMES.CHILDREN], 2)
  await restoreBackup(exported.text)
  const restored = await getChild(child.id)
  assert.equal(restored.avatarImage, AVATAR_JPEG)
  assert.equal(restored.avatarKey, "rabbit", "照片与预设 key 是两个字段，都要回来")
  assert.equal(restored.petKey, "fox")
  assert.equal(restored.nickname, "小美美")
})

test("M6-BK2 头像不是合法图片数据时整份备份被拒，库内一条不动", async (t) => {
  await useCleanDatabase(t)
  await ensureSeedData()
  await createChild({ nickname: "小美" })

  const exported = await exportBackup()
  const bad = JSON.parse(exported.text)
  bad.data[TABLE_NAMES.CHILDREN][0].avatarImage = '"><img src=x onerror=alert(1)>'

  assert.throws(
    () => validateBackupPayload(bad),
    (error) => error?.code === DB_ERROR_CODES.VALIDATION_FAILED && /头像/.test(error.message),
  )

  const before = await getDb().children.count()
  await assert.rejects(restoreBackup(bad))
  assert.equal(await getDb().children.count(), before)
  assert.equal(Object.hasOwn(await getChild(M0_CHILD_ID), "avatarImage"), false)
})

test("M6-BK3 彻底清空：头像随孩子一起消失，不留孤儿", async (t) => {
  await useCleanDatabase(t)
  await ensureSeedData()
  const child = await createChild({ nickname: "小美" })
  await updateChildProfile({ childId: child.id, avatarImage: AVATAR_JPEG })

  await wipeAllData()
  assert.equal(await getDb().children.count(), 0)
  const rows = await getDb().children.toArray()
  assert.equal(rows.some((row) => typeof row.avatarImage === "string"), false)
})
