/**
 * 奖励中心服务测试（M2）。
 *
 * 环境：fake-indexeddb。重点验证：
 * - 11 个内置奖励（6 生活 + 5 装扮）首次补齐，重复补齐不覆盖家长改价与启停；
 * - 自定义奖励不写 templateKey（否则第二个会撞 `&templateKey` 唯一索引）；
 * - 内置奖励只能改积分与启停，不能改名。
 */

import "fake-indexeddb/auto"
import test from "node:test"
import assert from "node:assert/strict"
import Dexie from "dexie"

import { closeDb, openDatabase } from "../src/db/database.js"
import { DB_NAME } from "../src/db/schema.js"
import { DB_ERROR_CODES } from "../src/db/errors.js"
import {
  BUILTIN_REWARD_TEMPLATES,
  REWARD_COST_MAX,
  REWARD_COST_MIN,
  REWARD_COST_QUICK_PICKS,
  createCustomReward,
  ensureBuiltinRewardConfigs,
  listRewards,
  parseRewardCost,
  setRewardEnabled,
  updateReward,
} from "../src/services/reward.service.js"

async function useCleanDatabase(t) {
  closeDb()
  await Dexie.delete(DB_NAME)
  await openDatabase()
  t.after(async () => {
    closeDb()
    await Dexie.delete(DB_NAME)
  })
}

test("M2-RW1 首次补齐：11 个内置奖励，价格取建议默认价", async (t) => {
  await useCleanDatabase(t)
  const result = await ensureBuiltinRewardConfigs()
  assert.equal(result.added, 11)
  assert.equal(BUILTIN_REWARD_TEMPLATES.length, 11)

  const rewards = await listRewards()
  assert.equal(rewards.length, 11)

  const life = rewards.filter((row) => row.category === "life")
  const costume = rewards.filter((row) => row.category === "costume")
  assert.equal(life.length, 6)
  assert.equal(costume.length, 5)

  for (const row of rewards) {
    assert.equal(row.source, "builtin")
    assert.equal(row.enabled, true)
    assert.equal(row.cost, row.defaultCost)
    assert.equal(typeof row.templateKey, "string")
    if (row.category === "costume") assert.equal(typeof row.costumeKey, "string")
    else assert.equal(Object.hasOwn(row, "costumeKey"), false)
  }

  // 小草帽默认 20（PRD §6.4）
  const hat = rewards.find((row) => row.templateKey === "costume_hat_straw")
  assert.equal(hat.name, "小草帽")
  assert.equal(hat.cost, 20)
  assert.equal(hat.costumeKey, "hat_straw")
})

test("M2-RW2 重复补齐不覆盖家长改价、停用与编辑内容", async (t) => {
  await useCleanDatabase(t)
  await ensureBuiltinRewardConfigs()

  await updateReward({ rewardId: "rw_costume_hat_straw", cost: 7 })
  await setRewardEnabled({ rewardId: "rw_life_park", enabled: false })

  const second = await ensureBuiltinRewardConfigs()
  assert.equal(second.added, 0)

  const rewards = await listRewards()
  const hat = rewards.find((row) => row.id === "rw_costume_hat_straw")
  const park = rewards.find((row) => row.id === "rw_life_park")
  assert.equal(hat.cost, 7, "家长改过的价不能被 Seed 覆盖")
  assert.equal(hat.defaultCost, 20, "建议默认价保留作对照")
  assert.equal(park.enabled, false, "停用状态不能被 Seed 覆盖")
  assert.equal(rewards.length, 11, "不能因为重复补齐产生重复记录")
})

test("M2-RW3 自定义奖励不写 templateKey，可建多条", async (t) => {
  await useCleanDatabase(t)
  await ensureBuiltinRewardConfigs()

  const first = await createCustomReward({ name: "  挑一部电影  ", cost: 45, description: "全家一起看" })
  const second = await createCustomReward({ name: "周末晚睡半小时", cost: 25 })

  assert.equal(first.name, "挑一部电影")
  assert.equal(first.source, "custom")
  assert.equal(first.category, "life")
  assert.equal(Object.hasOwn(first, "templateKey"), false, "空字符串会撞唯一索引，必须让属性不存在")
  assert.equal(Object.hasOwn(second, "templateKey"), false)

  const life = await listRewards({ category: "life" })
  assert.equal(life.length, 8)
  // 内置在前、自定义在后，家长一眼能分出系统项
  const sources = life.map((row) => row.source)
  assert.deepEqual(sources.slice(0, 6), Array(6).fill("builtin"))
  assert.deepEqual(sources.slice(6), ["custom", "custom"])
})

test("M2-RW4 入参校验：缺积分 / 超长名称 / 非法图标 / 内置改名校验", async (t) => {
  await useCleanDatabase(t)
  await ensureBuiltinRewardConfigs()

  await assert.rejects(
    () => createCustomReward({ name: "没写积分", cost: undefined }),
    (error) => error.code === DB_ERROR_CODES.VALIDATION_FAILED,
  )
  await assert.rejects(
    () => createCustomReward({ name: "一二三四五六七八九十一二三", cost: 10 }),
    (error) => error.code === DB_ERROR_CODES.VALIDATION_FAILED,
  )
  await assert.rejects(
    () => createCustomReward({ name: "图标不对", cost: 10, iconKey: "not-exist" }),
    (error) => error.code === DB_ERROR_CODES.VALIDATION_FAILED,
  )
  await assert.rejects(
    () => updateReward({ rewardId: "rw_life_book", name: "偷偷改名" }),
    (error) => error.code === DB_ERROR_CODES.VALIDATION_FAILED,
  )

  // 自定义奖励可以改名改价
  const custom = await createCustomReward({ name: "看电影", cost: 45 })
  const updated = await updateReward({ rewardId: custom.id, name: "看一部电影", cost: 50 })
  assert.equal(updated.name, "看一部电影")
  assert.equal(updated.cost, 50)
})

test("M2-RW5 停用只影响新申请：enabledOnly 过滤，记录与历史保留", async (t) => {
  await useCleanDatabase(t)
  await ensureBuiltinRewardConfigs()
  await setRewardEnabled({ rewardId: "rw_life_cartoon", enabled: false })

  const enabled = await listRewards({ enabledOnly: true })
  assert.equal(enabled.some((row) => row.id === "rw_life_cartoon"), false)
  assert.equal(enabled.length, 10)

  const all = await listRewards()
  assert.equal(all.length, 11, "停用不是删除")
})

/* ---------------- M6：积分自由输入 ---------------- */

test("M6-RW1 parseRewardCost：任意正整数都过，非法值一律拦住且不纠正", () => {
  assert.equal(REWARD_COST_MIN, 1)
  assert.equal(REWARD_COST_MAX, 10000)

  for (const value of [1, 7, 13, 99, 100, 250, 999, 1000, 9999, 10000]) {
    const parsed = parseRewardCost(String(value))
    assert.equal(parsed.ok, true, `${value} 应该合法`)
    assert.equal(parsed.value, value)
  }

  // 前导零是合法整数，不拦也不改写
  assert.deepEqual(parseRewardCost("007"), { ok: true, value: 7 })

  const cases = [
    ["", "empty"],
    ["   ", "empty"],
    ["0", "min"],
    ["-5", "negative"],
    ["13.5", "decimal"],
    ["13.", "decimal"],
    ["abc", "shape"],
    ["1e3", "shape"],
    ["10001", "max"],
  ]
  for (const [input, reason] of cases) {
    const parsed = parseRewardCost(input)
    assert.equal(parsed.ok, false, `${input} 应该被拦住`)
    assert.equal(parsed.reason, reason, input)
    assert.equal(typeof parsed.message, "string")
    assert.equal(parsed.message.length > 0, true)
  }

  assert.deepEqual([...REWARD_COST_QUICK_PICKS], [5, 10, 20, 30, 50, 100])
})

test("M6-RW2 上限提到 10000：写库接受 10000，10001 与 0 被拒", async (t) => {
  await useCleanDatabase(t)
  await ensureBuiltinRewardConfigs()

  const high = await updateReward({ rewardId: "rw_life_book", cost: 10000 })
  assert.equal(high.cost, 10000)

  const odd = await updateReward({ rewardId: "rw_life_book", cost: 13 })
  assert.equal(odd.cost, 13, "不再限定 5 / 10 的倍数")

  for (const bad of [0, -1, 10001, 12.5, "30", null]) {
    await assert.rejects(
      updateReward({ rewardId: "rw_life_book", cost: bad }),
      (error) => error?.code === DB_ERROR_CODES.VALIDATION_FAILED,
      String(bad),
    )
  }

  // 被拒之后价格仍是上一次成功的值
  const rows = await listRewards()
  assert.equal(rows.find((row) => row.id === "rw_life_book").cost, 13)
})

test("M6-RW3 自定义奖励同样支持任意整数，改价不回默认", async (t) => {
  await useCleanDatabase(t)
  await ensureBuiltinRewardConfigs()

  const custom = await createCustomReward({ name: "周末露营", cost: 137 })
  assert.equal(custom.cost, 137)

  const updated = await updateReward({ rewardId: custom.id, cost: 88 })
  assert.equal(updated.cost, 88)

  // 重新补齐内置配置不能把家长改过的价格覆盖掉
  await ensureBuiltinRewardConfigs()
  const rows = await listRewards()
  assert.equal(rows.find((row) => row.id === custom.id).cost, 88)
})
