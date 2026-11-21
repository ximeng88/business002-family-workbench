/**
 * 家长确认页（M1）。
 *
 * - 总览：今天几件、通过几件、待确认几件、今日星星；
 * - 待确认卡片：孩子原话 + 「退回」+ 「通过」；
 * - 退回会写 reviews(result="revision") 并把任务转「需修改」，不发任何分；
 * - 多个孩子时顶部有一条快速切换带。
 */

import { avatarOf, icon, subjectOf } from "../icons.js"
import { state, submissionOf } from "../store.js"
import { describeTime, escapeHtml } from "../ui.js"

function isOverdue(task) {
  const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(task.dueDate ?? ""))
  if (!matched) return false
  const due = new Date(Number(matched[1]), Number(matched[2]) - 1, Number(matched[3]))
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return due.getTime() < today.getTime()
}

function kidStrip() {
  if (state.children.length <= 1) return ""
  return `
    <div class="kid-strip" role="tablist" aria-label="切换孩子">
      ${state.children
        .map((child) => {
          const avatar = avatarOf(child.avatarKey)
          const stat = state.childStats.find((row) => row.id === child.id)
          const pending = stat?.pending ?? 0
          const active = child.id === state.childId
          return `
            <button class="kid-chip ${active ? "is-active" : ""}" type="button"
              role="tab" aria-selected="${active}" data-switch-child="${escapeHtml(child.id)}">
              <span class="kid-chip__avatar">${avatar.emoji}</span>
              <span class="kid-chip__name">${escapeHtml(child.nickname)}</span>
              ${pending > 0 ? `<span class="kid-chip__badge">${pending}</span>` : ""}
            </button>`
        })
        .join("")}
    </div>`
}

function reviewCard(task, index) {
  const submission = submissionOf(task.id)
  const subject = subjectOf(task.title)
  const late = isOverdue(task)
  const round = submission?.version && submission.version > 1 ? `第 ${submission.version} 次提交` : ""

  return `
    <li class="review" data-task-id="${escapeHtml(task.id)}" data-status="submitted" style="--i:${index}">
      <div class="review__head">
        <span class="task__icon tone-${subject.tone}">${icon(subject.iconName, { size: 24 })}</span>
        <div class="review__title">
          <h2>${escapeHtml(task.title)}${
            late ? `<span class="review__late">补交</span>` : ""
          }</h2>
          <p>${
            submission
              ? `${describeTime(submission.submittedAt)} 提交${round ? ` · ${round}` : ""}`
              : "提交记录读取中"
          } · 通过后 +${task.points} 星</p>
        </div>
        <span class="state state--submitted">待确认</span>
      </div>
      <blockquote class="review__quote">
        <span class="review__quote-mark" aria-hidden="true">“</span>
        ${escapeHtml(submission?.content ?? "未读取到孩子的完成说明")}
      </blockquote>
      <div class="review__actions">
        <button class="btn btn--reject" type="button" data-reject-task="${escapeHtml(task.id)}">
          ${icon("undo", { size: 17 })}退回
        </button>
        <button class="btn btn--pass" type="button" data-approve-task="${escapeHtml(task.id)}"
          data-idle-label="通过 +${task.points}★">
          通过 +${task.points}★
        </button>
      </div>
    </li>`
}

function doneRow(task, index) {
  const submission = submissionOf(task.id)
  return `
    <li class="done-row" style="--i:${index}">
      <span class="done-row__tick">${icon("check", { size: 13, strokeWidth: 3 })}</span>
      <span class="done-row__title">${escapeHtml(task.title)}</span>
      <span class="done-row__time">${submission ? describeTime(submission.submittedAt) : ""}</span>
      <span class="done-row__points">+${task.points}</span>
    </li>`
}

export function renderReview() {
  const pending = [...state.tasks, ...state.overdue].filter((task) => task.status === "submitted")
  const approved = state.tasks.filter((task) => task.status === "approved")
  const revision = state.tasks.filter((task) => task.status === "revision")
  const waiting = state.tasks.filter((task) => task.status === "todo")

  return `
  <section class="page page--review" data-page-view="review" aria-labelledby="review-heading">
    <h1 class="sr-only" id="review-heading">家长确认</h1>

    ${kidStrip()}

    <div class="parent-hero">
      <div class="parent-hero__text">
        <p class="parent-hero__kicker">家长模式 · ${escapeHtml(state.child?.nickname ?? "孩子")}</p>
        <h2>${
          pending.length
            ? `今天有 <b>${pending.length}</b> 条等你点头`
            : "今天都看完啦"
        }</h2>
        <p class="parent-hero__sub">${
          pending.length
            ? "看完孩子的说明，点一下就通过。退回不会扣星星，任务会回到孩子的「需要改一下」。"
            : "孩子提交新的完成说明后，会立刻出现在这里。"
        }</p>
      </div>
      <span class="parent-hero__shield" aria-hidden="true">${icon("shield", { size: 30 })}</span>
    </div>

    <div class="parent-stats parent-stats--four">
      <div class="parent-stat">
        <strong>${state.tasks.length}</strong>
        <span>今日任务</span>
      </div>
      <div class="parent-stat">
        <strong>${approved.length}</strong>
        <span>已通过</span>
      </div>
      <div class="parent-stat parent-stat--hot">
        <strong>${pending.length}</strong>
        <span>待确认</span>
      </div>
      <div class="parent-stat">
        <strong>${state.todayStars}</strong>
        <span>今日星星</span>
      </div>
    </div>

    ${
      pending.length
        ? `<ul class="review-list">${pending.map(reviewCard).join("")}</ul>`
        : `<div class="empty empty--parent">
            <div class="empty__art">${icon("check", { size: 32, strokeWidth: 2.6 })}</div>
            <h2>现在没有要确认的</h2>
            <p>${
              waiting.length
                ? `还有 ${waiting.length} 件孩子还没交，等等他。`
                : "孩子提交完成说明后，会立刻出现在这里。"
            }</p>
            <button class="btn btn--ghost" type="button" data-page="assign">去布置一件小事</button>
          </div>`
    }

    ${
      revision.length
        ? `<div class="queue-note">
            ${icon("undo", { size: 16 })}
            <span>${revision.length} 件已退回，等孩子改完重交</span>
          </div>`
        : ""
    }

    ${
      approved.length
        ? `<div class="done-block">
            <div class="done-block__head">
              <h2>今天已经通过</h2>
              <span>${approved.length} 条</span>
            </div>
            <ul class="done-list">${approved.map(doneRow).join("")}</ul>
          </div>`
        : ""
    }

    <p class="page-foot page-foot--parent">${icon("info", { size: 14 })}<span>通过 = 任务、审核记录、积分、宠物经验、当天记录，五张表同一个事务；退回只改任务与审核记录，不发分</span></p>
  </section>`
}
