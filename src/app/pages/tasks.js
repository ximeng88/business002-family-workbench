/**
 * 今日任务页（孩子端主界面）。
 * 只负责渲染；交互由 app.js 委托处理。
 *
 * M1 变化：
 * - 顶部增加「连续学习天数」与今日总进度；
 * - 列表按「今天 / 逾期补交」分组，逾期查询取全量、渲染层折叠；
 * - 「需修改」状态显示家长原因，点开可重提。
 */

import { icon, subjectOf } from "../icons.js"
import { state } from "../store.js"
import { describeDate, escapeHtml, greeting } from "../ui.js"

const STATUS_META = {
  todo: { label: "待完成", tone: "todo" },
  submitted: { label: "等确认", tone: "submitted" },
  approved: { label: "已完成", tone: "approved" },
  revision: { label: "要改一下", tone: "revision" },
}

const FILTERS = [
  { id: "all", label: "全部" },
  { id: "todo", label: "待做" },
  { id: "submitted", label: "等确认" },
  { id: "approved", label: "完成" },
]

function allTasks() {
  return [...state.tasks, ...state.overdue]
}

function countsOf() {
  const tasks = allTasks()
  return {
    all: tasks.length,
    todo: tasks.filter((task) => task.status === "todo" || task.status === "revision").length,
    submitted: tasks.filter((task) => task.status === "submitted").length,
    approved: tasks.filter((task) => task.status === "approved").length,
  }
}

function matchesFilter(task) {
  if (state.filter === "all") return true
  if (state.filter === "todo") return task.status === "todo" || task.status === "revision"
  return task.status === state.filter
}

/** 逾期天数（本地自然日相减，不经过 UTC 字符串） */
function lateDaysOf(task) {
  const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(task.dueDate ?? ""))
  if (!matched) return 0
  const due = new Date(Number(matched[1]), Number(matched[2]) - 1, Number(matched[3]))
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const days = Math.round((today.getTime() - due.getTime()) / 86400000)
  return days > 0 ? days : 0
}

function progressRing(approved, total) {
  const ratio = total > 0 ? approved / total : 0
  const radius = 27
  const circumference = 2 * Math.PI * radius
  const offset = circumference * (1 - ratio)
  return `
    <div class="ring" role="img" aria-label="今天完成 ${approved} 件，共 ${total} 件">
      <svg viewBox="0 0 68 68" aria-hidden="true">
        <circle class="ring__track" cx="34" cy="34" r="${radius}" />
        <circle class="ring__value" cx="34" cy="34" r="${radius}"
          style="--ring-circ:${circumference.toFixed(1)}; --ring-offset:${offset.toFixed(1)}" />
      </svg>
      <div class="ring__label"><b>${approved}</b><span>/${total}</span></div>
    </div>`
}

function heroCopy(approved, total) {
  if (total === 0) {
    return { title: "今天还没有安排", sub: "让爸爸妈妈加一件小事吧" }
  }
  if (approved === total) {
    return { title: "今天全部做完啦", sub: "去陪团团玩一会儿，星星已经到账" }
  }
  if (approved === 0) {
    return { title: `今天有 ${total} 件小事`, sub: "先挑最容易的一件，开个头" }
  }
  return { title: `还剩 ${total - approved} 件就收工`, sub: `你已经攒了 ${state.todayStars} 颗星星` }
}

function streakPill() {
  if (state.streak > 0) {
    return `<span class="hero__pill hero__pill--streak">${icon("flame", { size: 14 })}连续 ${state.streak} 天</span>`
  }
  return `<span class="hero__pill">${icon("flame", { size: 14 })}今天开个头，连续从今天算</span>`
}

function taskItem(task, index) {
  const meta = STATUS_META[task.status] ?? STATUS_META.todo
  const subject = subjectOf(task.title)
  const isDone = task.status === "approved"
  const lateDays = lateDaysOf(task)

  const revisionText =
    task.status === "revision"
      ? `<p class="task__note">${icon("info", { size: 14 })}<span>${
          task.revisionReason ? escapeHtml(task.revisionReason) : "家长希望你再看一遍，改好可以重新交"
        }</span></p>`
      : ""

  const metaLine =
    task.status === "approved"
      ? `已经把 ${task.points} 颗星星放进口袋`
      : task.status === "submitted"
        ? "已经交给爸爸妈妈，等他们点头"
        : task.status === "revision"
          ? "看一眼家长的话，再补一次"
          : `做完可以拿到 ${task.points} 颗星星`

  return `
    <li class="task task--${meta.tone} ${isDone ? "is-done" : ""}" data-status="${task.status}"
        data-task-id="${escapeHtml(task.id)}" style="--i:${index}">
      <button class="task__hit" type="button" data-open-task="${escapeHtml(task.id)}"
        aria-label="${escapeHtml(task.title)}，${meta.label}，${metaLine}">
        <span class="task__icon tone-${subject.tone}">${icon(subject.iconName, { size: 26 })}</span>
        <span class="task__body">
          <span class="task__title">${escapeHtml(task.title)}</span>
          <span class="task__meta">${lateDays > 0 ? `<span class="task__late">逾期 ${lateDays} 天</span>` : ""}${escapeHtml(metaLine)}</span>
        </span>
        <span class="task__tail">
          <span class="state state--${meta.tone}">
            ${isDone ? icon("check", { size: 13, strokeWidth: 2.6 }) : ""}<span>${meta.label}</span>
          </span>
          <span class="task__cost">${icon("starSolid", { size: 13 })}${task.points}</span>
        </span>
      </button>
      ${revisionText}
    </li>`
}

function todayGroup(tasks) {
  if (!tasks.length) return ""
  return `
    <div class="task-group">
      <div class="group-head">
        <h2>${icon("sun", { size: 15 })}今天</h2>
        <span>${tasks.length} 件</span>
      </div>
      <ul class="task-list">${tasks.map(taskItem).join("")}</ul>
    </div>`
}

function overdueGroup(tasks) {
  if (!tasks.length) return ""
  const expanded = state.showOverdue
  return `
    <div class="task-group task-group--overdue">
      <div class="group-head">
        <h2>${icon("clock", { size: 15 })}逾期 · 补交</h2>
        <span>${tasks.length} 件</span>
        ${
          expanded
            ? `<button class="group-head__toggle" type="button" data-overdue-collapse>收起</button>`
            : ""
        }
      </div>
      ${
        expanded
          ? `<ul class="task-list">${tasks
              .map((task, index) => taskItem(task, index))
              .join("")}</ul>`
          : `<button class="overdue-toggle" type="button" data-toggle-overdue>
              <span class="overdue-toggle__ico">${icon("clock", { size: 17 })}</span>
              <span>还有 ${tasks.length} 条逾期任务，展开查看</span>
              ${icon("chevron", { size: 16 })}
            </button>`
      }
    </div>`
}

export function renderTasks() {
  const counts = countsOf()
  const approved = state.todayApproved
  const total = state.tasks.length
  const copy = heroCopy(approved, total)
  const today = describeDate()
  const todayVisible = state.tasks.filter(matchesFilter)
  const overdueVisible = state.overdue.filter(matchesFilter)
  const nothingVisible = !todayVisible.length && !overdueVisible.length
  const chips = FILTERS.filter((filter) => filter.id === "all" || counts[filter.id] > 0)

  return `
  <section class="page page--tasks" data-page-view="tasks" aria-labelledby="tasks-heading">
    <h1 class="sr-only" id="tasks-heading">今日任务</h1>

    <div class="hero">
      <div class="hero__glow" aria-hidden="true"></div>
      <div class="hero__text">
        <p class="hero__kicker">${today.short} · ${today.weekday} · ${greeting()}</p>
        <h2 class="hero__title">${escapeHtml(copy.title)}</h2>
        <p class="hero__sub">${escapeHtml(copy.sub)}</p>
        <div class="hero__pills">
          ${streakPill()}
          <span class="hero__pill hero__pill--soft">完成 ${approved}/${total}</span>
        </div>
      </div>
      ${progressRing(approved, total)}
    </div>

    <div class="chips" role="tablist" aria-label="按状态筛选">
      ${chips
        .map(
          (filter) => `
        <button class="chip ${state.filter === filter.id ? "is-active" : ""}" type="button"
          role="tab" aria-selected="${state.filter === filter.id}" data-filter="${filter.id}">
          ${filter.label}<span class="chip__num">${counts[filter.id]}</span>
        </button>`,
        )
        .join("")}
    </div>

    ${todayGroup(todayVisible)}
    ${overdueGroup(overdueVisible)}

    ${
      nothingVisible
        ? `<div class="empty">
            <div class="empty__art">${icon("sparkle", { size: 34 })}</div>
            <h2>${state.filter === "all" ? "今天还没有任务" : "这个分组里是空的"}</h2>
            <p>${
              state.filter === "all"
                ? "让爸爸妈妈在家长端布置一件小事。"
                : "换个分组看看别的小事。"
            }</p>
          </div>`
        : ""
    }

    <p class="page-foot">${icon("info", { size: 14 })}<span>${
      state.overdue.length
        ? "逾期任务可以补交，星星按家长通过的那天记"
        : "数据存在这台设备的浏览器里，刷新不会丢"
    }</span></p>
  </section>`
}
