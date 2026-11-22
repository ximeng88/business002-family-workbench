/**
 * 家长「布置任务」页（M1 → M3 加固定任务）。
 *
 * 两种布置方式：
 * - 只这一次：调 `createTask`，写一条 temp 任务，不写 templateId / generationKey；
 * - 每天 / 每周几：调 `createTemplate` 建模板，再补今天这一条，
 *   之后每天启动时由 `template.service` 自动生成，靠 `generationKey` 防重。
 */

import { avatarMarkup } from "../avatar.js"
import { icon, subjectOf } from "../icons.js"
import { state } from "../store.js"
import { WEEKDAY_OPTIONS, childNamesOf, describeTemplate } from "../../services/template.service.js"
import { dateKeyOffset, dateLabelOffset, describeDateKey, escapeHtml } from "../ui.js"

const PRESETS = ["朗读课文", "数学口算", "整理书包", "收拾书桌", "亲子阅读", "练字 10 分钟", "跳绳 100 下"]

const STATUS_LABEL = {
  todo: "待完成",
  submitted: "等确认",
  approved: "已完成",
  revision: "要改",
}

function presetChips() {
  return PRESETS.map(
    (preset) => `<button class="preset" type="button" data-preset="${escapeHtml(preset)}">${escapeHtml(preset)}</button>`,
  ).join("")
}

function todayRows() {
  if (!state.tasks.length) {
    return `<p class="assign-list__empty">今天还没有任务，上面布置第一件吧。</p>`
  }
  return `<ul class="assign-list__items">
    ${state.tasks
      .map(
        (task) => `
      <li class="assign-row">
        <span class="assign-row__icon tone-${subjectOf(task.title).tone}">${icon(subjectOf(task.title).iconName, { size: 18 })}</span>
        <span class="assign-row__title">${escapeHtml(task.title)}${
          task.templateId ? `<span class="assign-row__tag">固定</span>` : ""
        }</span>
        <span class="assign-row__points">+${task.points}</span>
        <span class="assign-row__state assign-row__state--${task.status}">${STATUS_LABEL[task.status] ?? task.status}</span>
      </li>`,
      )
      .join("")}
  </ul>`
}

function upcomingRows() {
  if (!state.upcoming.length) return ""
  return `
    <div class="assign-list">
      <div class="assign-list__head">
        <h2>接下来几天</h2>
        <span>${state.upcoming.length} 件</span>
      </div>
      <ul class="assign-list__items">
        ${state.upcoming
          .map(
            (task) => `
          <li class="assign-row">
            <span class="assign-row__icon tone-${subjectOf(task.title).tone}">${icon(subjectOf(task.title).iconName, { size: 18 })}</span>
            <span class="assign-row__title">${escapeHtml(task.title)}</span>
            <span class="assign-row__points">+${task.points}</span>
            <span class="assign-row__state">${escapeHtml(describeDateKey(task.dueDate))}</span>
          </li>`,
          )
          .join("")}
      </ul>
    </div>`
}

function childPicker() {
  if (state.children.length <= 1) return ""
  return `
    <div class="form-card">
      <span class="form-label">布置给谁</span>
      <div class="kid-strip kid-strip--inline" role="tablist" aria-label="选择孩子">
        ${state.children
          .map((child) => {
            const active = child.id === state.childId
            return `
              <button class="kid-chip ${active ? "is-active" : ""}" type="button"
                role="tab" aria-selected="${active}" data-switch-child="${escapeHtml(child.id)}">
                <span class="kid-chip__avatar">${avatarMarkup(child, { size: "xs" })}</span>
                <span class="kid-chip__name">${escapeHtml(child.nickname)}</span>
              </button>`
          })
          .join("")}
      </div>
    </div>`
}

/** 重复选项：只这一次 / 每天 / 每周几 */
function repeatCard() {
  return `
    <div class="form-card">
      <div class="form-row">
        <span class="form-label">要不要每天都布置</span>
        <span class="repeat-view"><b data-repeat-view>只这一次</b></span>
      </div>
      <div class="segmented segmented--tight" role="tablist" aria-label="重复方式">
        <button class="segmented__btn is-active" type="button" role="tab" aria-selected="true" data-repeat="none">只这一次</button>
        <button class="segmented__btn" type="button" role="tab" aria-selected="false" data-repeat="daily">每天</button>
        <button class="segmented__btn" type="button" role="tab" aria-selected="false" data-repeat="weekly">每周几</button>
      </div>

      <div class="weekday-picker" data-weekday-picker hidden>
        <span class="form-label">星期几要做</span>
        <div class="weekday-picker__row">
          ${WEEKDAY_OPTIONS.map(
            (option) => `
            <button class="weekday" type="button" data-weekday="${option.value}"
              aria-pressed="false" aria-label="${option.short}">${option.label}</button>`,
          ).join("")}
        </div>
      </div>

      <input type="hidden" name="repeat" value="none" data-repeat-input />
      <input type="hidden" name="weekdays" value="" data-weekdays-input />

      <p class="sheet__hint">${
        state.templates.length
          ? `固定任务会自动出现在当天列表里，同一天不会重复生成。现在有 ${state.templates.length} 个固定任务。`
          : "选了「每天」或「每周几」，以后就不用天天手动布置了。"
      }</p>
    </div>`
}

function templateRows() {
  if (!state.templates.length) {
    return `<p class="assign-list__empty">还没有固定任务。上面勾选「每天」布置一件，明天它会自己出现。</p>`
  }
  return `<ul class="assign-list__items">
    ${state.templates
      .map((template) => {
        const off = template.enabled === false
        return `
        <li class="tpl-row ${off ? "is-off" : ""}" data-template-row="${escapeHtml(template.id)}">
          <span class="tpl-row__icon tone-${subjectOf(template.title).tone}">${icon("repeat", { size: 17 })}</span>
          <div class="tpl-row__body">
            <strong>${escapeHtml(template.title)}</strong>
            <small>${escapeHtml(describeTemplate(template))} · ${escapeHtml(
              childNamesOf(template, state.children),
            )} · +${template.points}</small>
          </div>
          <div class="tpl-row__ctrl">
            <button class="mini-btn ${off ? "" : "mini-btn--off"}" type="button"
              data-template-toggle="${escapeHtml(template.id)}" data-enabled="${off ? "true" : "false"}">
              ${off ? "启用" : "暂停"}
            </button>
            <button class="mini-btn mini-btn--danger" type="button"
              data-template-delete="${escapeHtml(template.id)}" aria-label="删除固定任务">
              ${icon("trash", { size: 15 })}
            </button>
          </div>
        </li>`
      })
      .join("")}
  </ul>`
}

export function renderAssign() {
  const nickname = state.child?.nickname ?? "孩子"

  return `
  <section class="page page--assign" data-page-view="assign" aria-labelledby="assign-heading">
    <h1 class="sr-only" id="assign-heading">布置任务</h1>

    <div class="parent-hero parent-hero--assign">
      <div class="parent-hero__text">
        <p class="parent-hero__kicker">家长模式 · ${escapeHtml(nickname)}</p>
        <h2>布置一件小事</h2>
        <p class="parent-hero__sub">布置后会出现在 ${escapeHtml(nickname)} 的列表里；做完提交、你点头才发星星。</p>
      </div>
      <span class="parent-hero__shield" aria-hidden="true">${icon("plus", { size: 30 })}</span>
    </div>

    <form class="assign-form" data-assign-form novalidate>
      <input type="hidden" name="childId" value="${escapeHtml(state.childId)}" />
      <input type="hidden" name="dueDate" value="${dateKeyOffset(0)}" data-due-input />
      <input type="hidden" name="points" value="10" data-points-input />

      ${childPicker()}

      <div class="form-card">
        <label class="form-label" for="assign-title">要做什么</label>
        <input class="input" id="assign-title" name="title" maxlength="20"
          placeholder="例如：朗读第 8 课 3 遍" autocomplete="off" enterkeyhint="done" />
        <div class="presets">${presetChips()}</div>
      </div>

      <div class="form-card">
        <div class="form-row">
          <span class="form-label">完成后奖励</span>
          <span class="points-view"><b data-points-value>10</b> 颗星星</span>
        </div>
        <div class="stepper">
          <button class="stepper__btn" type="button" data-points-step="-5" aria-label="减少 5 颗星星">−</button>
          <span class="stepper__hint">5 颗一档 · 最多 50</span>
          <button class="stepper__btn" type="button" data-points-step="5" aria-label="增加 5 颗星星">＋</button>
        </div>
      </div>

      ${repeatCard()}

      <div class="form-card" data-due-card>
        <span class="form-label">什么时候交</span>
        <div class="segment">
          <button class="segment__btn is-active" type="button" data-due-offset="0">
            今天 · ${dateLabelOffset(0)}
          </button>
          <button class="segment__btn" type="button" data-due-offset="1">
            明天 · ${dateLabelOffset(1)}
          </button>
        </div>
      </div>

      <button class="btn btn--primary btn--xl" type="submit" data-idle-label="布置给他">
        ${icon("plus", { size: 18 })}布置给 ${escapeHtml(nickname)}
      </button>
    </form>

    <div class="assign-list">
      <div class="assign-list__head">
        <h2>今天的任务</h2>
        <span>${state.tasks.length} 件</span>
      </div>
      ${todayRows()}
    </div>

    <div class="assign-list">
      <div class="assign-list__head">
        <h2>固定任务</h2>
        <span>${state.templates.filter((template) => template.enabled !== false).length} 个在生效</span>
      </div>
      ${templateRows()}
    </div>

    ${upcomingRows()}

    <p class="page-foot page-foot--parent">${icon("info", { size: 14 })}<span>只这一次的任务不写生成键，同一天可以布置任意多条同名任务；固定任务按「类型:孩子:模板:日期」防重。</span></p>
  </section>`
}
