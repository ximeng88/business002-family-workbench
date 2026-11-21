/**
 * 固定任务模板与自动生成测试（M3）。
 *
 * 覆盖任务书 §二·任务 3 的核心要求：
 * - 勾了「每天」/「每周几」后能自动补出当天任务；
 * - **同一天绝对不会生成两条一样的任务**（`generationKey` 唯一索引 + 事务内查重）；
 * - 每周几只在该星期生成；
 * - 停用不生成，删除模板不删历史任务；
 * - 多孩各自一条，互不冲突。
 */

import "fake-indexeddb/auto"
import test from "node:test"
import assert from "node:assert/strict"
import Dexie from "dexie"

import { closeDb, getDb, openDatabase } from "../src/db/database.js"
import { DB_NAME } from "../src/db/schema.js"
import { DB_ERROR_CODES } from "../src/db/errors.js"
import { toLocalDateKey, weekdayOfDateKey } from "../src/db/date.js"
import { createChild } from "../src/services/child.service.js"
import { ensureSeedData, listTodayTasks, M0_CHILD_ID } from "../src/services/task.service.js"
import {
  createTemplate,
  deleteTemplate,
  describeTemplate,
  ensureTodayTemplateTasks,
  generateTemplateTasks,
  generationKeyOf,
  listTemplates,
  setTemplateEnabled,
} from "../src/services/template.service.js"

async function useCleanDatabase(t) {
  closeDb()
  await Dexie.delete(DB_NAME)
  await openDatabase()
  await ensureSeedData()
  t.after(async () => {
    closeDb()
    await Dexie.delete(DB_NAME)
  })
}

const TODAY = toLocalDateKey()

test("M3-TP1 每日模板生成今天的任务，生成键格式正确", async (t) => {
  await useCleanDatabase(t)

  const template = await createTemplate({
    title: "朗读课文",
    points: 10,
    type: "daily",
    childIds: [M0_CHILD_ID],
  })
  assert.equal(template.type, "daily")
  assert.equal(template.enabled, true)
  assert.equal(Object.hasOwn(template, "weekdays"), false, "每天重复不写 weekdays")

  const result = await generateTemplateTasks({ dateKey: TODAY })
  assert.equal(result.created, 1)
  assert.equal(result.skipped, 0)

  const today = await listTodayTasks(M0_CHILD_ID)
  // seed 有 5 条，加上自动生成的 1 条
  const generated = today.find((task) => task.templateId === template.id)
  assert.ok(generated, "今天应该有一条由模板生成的任务")
  assert.equal(generated.title, "朗读课文")
  assert.equal(generated.points, 10)
  assert.equal(generated.type, "daily")
  assert.equal(generated.status, "todo")
  assert.equal(generated.dueDate, TODAY)
  assert.equal(
    generated.generationKey,
    generationKeyOf({ type: "daily", childId: M0_CHILD_ID, templateId: template.id, dateKey: TODAY }),
  )
  assert.equal(generated.generationKey, `daily:${M0_CHILD_ID}:${template.id}:${TODAY}`)
})

test("M3-TP2 同一天重复生成不会出现第二条（防重）", async (t) => {
  await useCleanDatabase(t)
  await createTemplate({ title: "口算", points: 10, type: "daily", childIds: [M0_CHILD_ID] })

  const first = await ensureTodayTemplateTasks()
  assert.equal(first.created, 1)

  const second = await ensureTodayTemplateTasks()
  assert.equal(second.created, 0, "第二次启动不能再生成")
  assert.equal(second.skipped, 1)

  const third = await generateTemplateTasks({ dateKey: TODAY })
  assert.equal(third.created, 0)
  assert.equal(third.skipped, 1)

  const generated = (await listTodayTasks(M0_CHILD_ID)).filter((task) => task.templateId)
  assert.equal(generated.length, 1, "同一天同一个模板只能有一条")
})

test("M3-TP3 每周模板只在选中的星期生成", async (t) => {
  await useCleanDatabase(t)
  const weekday = weekdayOfDateKey(TODAY)
  const otherDay = (weekday + 3) % 7

  // 命中今天
  const hit = await createTemplate({
    title: "周三才做的事",
    points: 10,
    type: "weekly",
    childIds: [M0_CHILD_ID],
    weekdays: [weekday],
  })
  // 不命中今天
  await createTemplate({
    title: "别的时候做的事",
    points: 10,
    type: "weekly",
    childIds: [M0_CHILD_ID],
    weekdays: [otherDay],
  })

  const result = await generateTemplateTasks({ dateKey: TODAY })
  assert.equal(result.created, 1, "只有命中今天的那个模板会生成")

  const generated = (await listTodayTasks(M0_CHILD_ID)).filter((task) => task.templateId)
  assert.equal(generated.length, 1)
  assert.equal(generated[0].templateId, hit.id)
  assert.equal(generated[0].type, "weekly")
  assert.equal(generated[0].generationKey, `weekly:${M0_CHILD_ID}:${hit.id}:${TODAY}`)
})

test("M3-TP4 停用不生成、删除模板不删历史任务", async (t) => {
  await useCleanDatabase(t)
  const template = await createTemplate({ title: "跳绳", points: 5, type: "daily", childIds: [M0_CHILD_ID] })
  await ensureTodayTemplateTasks()

  const before = (await listTodayTasks(M0_CHILD_ID)).filter((task) => task.templateId).length
  assert.equal(before, 1)

  await setTemplateEnabled({ templateId: template.id, enabled: false })
  const paused = await generateTemplateTasks({ dateKey: TODAY })
  assert.equal(paused.created, 0, "停用后不生成新的")

  await deleteTemplate({ templateId: template.id })
  assert.equal(await getDb().taskTemplates.count(), 0)
  const kept = (await listTodayTasks(M0_CHILD_ID)).filter((task) => task.templateId === template.id)
  assert.equal(kept.length, 1, "已经生成的任务是历史，不能跟着模板一起删")
})

test("M3-TP5 两个孩子各生成一条，生成键不会互撞", async (t) => {
  await useCleanDatabase(t)
  const second = await createChild({ nickname: "小宝", avatarKey: "rabbit" })

  await createTemplate({ title: "亲子阅读", points: 15, type: "daily", childIds: [M0_CHILD_ID, second.id] })
  const result = await generateTemplateTasks({ dateKey: TODAY })
  assert.equal(result.created, 2)

  const a = await listTodayTasks(M0_CHILD_ID)
  const b = await listTodayTasks(second.id)
  const generatedA = a.filter((task) => task.templateId)
  const generatedB = b.filter((task) => task.templateId)
  assert.equal(generatedA.length, 1)
  assert.equal(generatedB.length, 1)
  assert.notEqual(generatedA[0].generationKey, generatedB[0].generationKey)
  assert.ok(generatedA[0].generationKey.includes(M0_CHILD_ID))
  assert.ok(generatedB[0].generationKey.includes(second.id))

  // 每个孩子只看到自己的那条（多孩隔离）
  assert.equal(b.filter((task) => task.childId !== second.id).length, 0)
})

test("M3-TP6 不同日期各自生成，不互相干扰", async (t) => {
  await useCleanDatabase(t)
  await createTemplate({ title: "睡前阅读", points: 10, type: "daily", childIds: [M0_CHILD_ID] })

  const today = await generateTemplateTasks({ dateKey: TODAY })
  const tomorrow = await generateTemplateTasks({ dateKey: "2099-01-02" })
  const tomorrowAgain = await generateTemplateTasks({ dateKey: "2099-01-02" })

  assert.equal(today.created, 1)
  assert.equal(tomorrow.created, 1, "换一天应该再生成一条")
  assert.equal(tomorrowAgain.created, 0, "同一天第二次不重复")
  assert.equal(await getDb().tasks.where("dueDate").equals("2099-01-02").count(), 1)
})

test("M3-TP7 非法参数在写库前就被拒绝", async (t) => {
  await useCleanDatabase(t)

  const cases = [
    ["没名字", { title: "  ", points: 10, childIds: [M0_CHILD_ID] }],
    ["星星为负", { title: "跑步", points: -1, childIds: [M0_CHILD_ID] }],
    ["星星超上限", { title: "跑步", points: 999, childIds: [M0_CHILD_ID] }],
    ["没指定孩子", { title: "跑步", points: 10, childIds: [] }],
    ["孩子不存在", { title: "跑步", points: 10, childIds: ["c_ghost"] }],
    ["每周没选星期", { title: "跑步", points: 10, type: "weekly", childIds: [M0_CHILD_ID] }],
    [
      "星期取值非法",
      { title: "跑步", points: 10, type: "weekly", childIds: [M0_CHILD_ID], weekdays: [9] },
    ],
  ]

  for (const [label, input] of cases) {
    await assert.rejects(
      () => createTemplate(input),
      (error) => {
        assert.equal(error.code, DB_ERROR_CODES.VALIDATION_FAILED, `${label} 应该校验失败`)
        return true
      },
      `${label} 必须被拒绝`,
    )
  }

  assert.equal(await getDb().taskTemplates.count(), 0, "校验失败不能留下半条模板")

  // 非法日期键也不能生成
  await assert.rejects(
    () => generateTemplateTasks({ dateKey: "2026-02-30" }),
    (error) => error.code === DB_ERROR_CODES.VALIDATION_FAILED,
  )
})

test("M3-TP8 模板的中文描述与列表排序", async (t) => {
  await useCleanDatabase(t)
  // 显式错开 createdAt：同一毫秒内创建的 id 是随机的，排序断言会偶发失败
  const daily = await createTemplate({
    title: "每日晨读",
    points: 10,
    type: "daily",
    childIds: [M0_CHILD_ID],
    now: new Date("2026-03-01T08:00:00.000Z"),
  })
  const weekly = await createTemplate({
    title: "周末大扫除",
    points: 20,
    type: "weekly",
    childIds: [M0_CHILD_ID],
    weekdays: [6, 0],
    now: new Date("2026-03-01T08:00:01.000Z"),
  })

  assert.equal(describeTemplate(daily), "每天")
  assert.equal(describeTemplate(weekly), "每周六、周日")

  const templates = await listTemplates()
  assert.equal(templates.length, 2)
  assert.equal(templates[0].id, daily.id, "按创建时间正序")
  assert.equal(templates[1].id, weekly.id)
})
