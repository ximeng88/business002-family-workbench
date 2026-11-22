/**
 * 家长「孩子管理」页（M1）。
 *
 * - 列出全部孩子：今天完成情况、待确认、逾期、星星、连续天数；
 * - 切换当前孩子（全局生效，孩子端随之切换）；
 * - 添加孩子：昵称 + 头像，写入 children 表，不升 Schema。
 */

import { AVATARS, avatarOf, icon } from "../icons.js"
import { avatarMarkup } from "../avatar.js"
import { state } from "../store.js"
import { escapeHtml } from "../ui.js"

function cardOf(child, index) {
  const stat = state.childStats.find((row) => row.id === child.id)
  const active = child.id === state.childId
  const total = stat?.todayTotal ?? 0
  const approved = stat?.approved ?? 0
  const ratio = total > 0 ? approved / total : 0
  const pending = stat?.pending ?? 0
  const overdue = stat?.overdue ?? 0
  const streak = stat?.streak ?? 0

  return `
    <li class="kid-card ${active ? "is-active" : ""}" style="--i:${index}">
      <span class="kid-card__avatar">${avatarMarkup(child, { size: "md" })}</span>
      <div class="kid-card__body">
        <h2>
          ${escapeHtml(child.nickname)}
          ${active ? `<span class="kid-card__now">当前</span>` : ""}
          <button class="kid-card__edit" type="button" data-edit-child="${escapeHtml(child.id)}"
            aria-label="改 ${escapeHtml(child.nickname)} 的名字或头像">${icon("edit", { size: 13 })}</button>
        </h2>
        <p>今天 ${approved}/${total} 完成${
          pending ? ` · 待确认 ${pending}` : ""
        }${overdue ? ` · 逾期 ${overdue}` : ""}${streak ? ` · 连续 ${streak} 天` : ""}</p>
        <div class="kid-card__bar" role="progressbar" aria-valuemin="0" aria-valuemax="${total || 1}"
          aria-valuenow="${approved}" aria-label="${escapeHtml(child.nickname)}今天的完成进度">
          <i style="--to:${ratio}"></i>
        </div>
      </div>
      <div class="kid-card__tail">
        <strong>${stat?.balance ?? 0}</strong>
        <span>颗星星</span>
        ${
          active
            ? `<span class="kid-card__flag">${icon("check", { size: 13, strokeWidth: 2.6 })}使用中</span>`
            : `<button class="kid-card__switch" type="button" data-switch-child="${escapeHtml(child.id)}">切换</button>`
        }
      </div>
    </li>`
}

function defaultAvatarKey() {
  const used = new Set(state.children.map((child) => child.avatarKey))
  return (AVATARS.find((avatar) => !used.has(avatar.key)) ?? AVATARS[0]).key
}

export function renderChildren() {
  const fallbackAvatar = defaultAvatarKey()

  return `
  <section class="page page--children" data-page-view="children" aria-labelledby="children-heading">
    <h1 class="sr-only" id="children-heading">孩子管理</h1>

    <div class="parent-hero parent-hero--kids">
      <div class="parent-hero__text">
        <p class="parent-hero__kicker">家庭设置</p>
        <h2>家里有 <b>${state.children.length}</b> 个孩子</h2>
        <p class="parent-hero__sub">每个孩子的任务、星星、宠物经验完全分开记录。切换后，孩子端和家长端都只看这一个孩子。</p>
      </div>
      <span class="parent-hero__shield" aria-hidden="true">${icon("users", { size: 30 })}</span>
    </div>

    <ul class="kid-cards">
      ${state.children.map(cardOf).join("")}
    </ul>

    <form class="add-child" data-add-child novalidate>
      <h2>${icon("plus", { size: 18 })}添加一个孩子</h2>
      <p>添加后可以直接给他布置任务，两个孩子的数据不会混在一起。</p>

      <label class="form-label" for="child-name">孩子昵称</label>
      <input class="input" id="child-name" name="nickname" maxlength="12"
        placeholder="例如：小明" autocomplete="off" enterkeyhint="done" />

      <span class="form-label">选一个头像</span>
      <div class="avatar-picker" role="radiogroup" aria-label="选择头像">
        ${AVATARS.map(
          (avatar, index) => `
          <button class="avatar-opt ${avatar.key === fallbackAvatar ? "is-active" : ""}" type="button"
            role="radio" aria-checked="${avatar.key === fallbackAvatar}" aria-label="${avatar.label}"
            data-avatar="${avatar.key}">
            <span aria-hidden="true">${avatar.emoji}</span>
          </button>`,
        ).join("")}
      </div>
      <input type="hidden" name="avatarKey" value="${fallbackAvatar}" data-avatar-input />

      <button class="btn btn--primary btn--xl" type="submit">添加孩子</button>
    </form>

    <p class="page-foot page-foot--parent">${icon("info", { size: 14 })}<span>孩子档案存在本机浏览器里；不设数量上限，也不会上传到任何服务器</span></p>
  </section>`
}
