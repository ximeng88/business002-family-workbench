/**
 * 家长端「设置」页（M3 + M4）。
 *
 * 内容：
 * 1. 家长 PIN：设置 / 修改 / 关闭，并说明"这是防误触"；
 * 2. 恢复码（M4）：忘记 PIN 时的唯一自救通道，可补生成 / 换一个；
 * 3. 数据备份：导出 JSON、导入（覆盖）、撤销上次导入；
 * 4. 固定任务：数量概览 + 去布置页管理；
 * 5. 安装到主屏幕 + 数据库信息；
 * 6. 危险区（M4）：删除全部家庭数据（G-05）；
 * 7. 退出家长模式。
 *
 * 纪律：本页只渲染 + 发 `data-*` 指令，所有写操作在 `app.js` → `store.js` → services 里完成。
 */

import { icon } from "../icons.js"
import { installState } from "../install.js"
import { state } from "../store.js"
import { describeDateTime, describeRelative, escapeHtml } from "../ui.js"
import { SCHEMA_VERSION } from "../../db/schema.js"
import { BACKUP_TABLES } from "../../services/backup.service.js"

const PIN_HINT = "4 位数字，只有家长知道。忘了可以用恢复码重置，不会丢数据。"
const RECOVERY_HINT =
  "恢复码只在生成时显示一次，系统里只存摘要，看不到原文。请抄在纸上或拍张照，和 PIN 分开放。"
/** 构建时由 vite.config.js 从 package.json 注入（见 define） */
const APP_VERSION = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev"

function pinCard() {
  const configured = Boolean(state.pinStatus.configured)
  const updated = state.pinStatus.updatedAt ? describeRelative(state.pinStatus.updatedAt) : ""

  if (configured) {
    return `
      <section class="set-card set-card--pin" aria-labelledby="set-pin-title">
        <header class="set-card__head">
          <span class="set-card__ico set-card__ico--ok">${icon("lock", { size: 20 })}</span>
          <div>
            <h2 id="set-pin-title">家长 PIN 已开启</h2>
            <p>从孩子端点「家长」要先输 4 位数字${updated ? ` · ${escapeHtml(updated)}设置` : ""}</p>
          </div>
          <span class="set-badge is-on">开着</span>
        </header>
        <div class="set-actions">
          <button class="mini-btn" type="button" data-change-pin>改 PIN</button>
          <button class="mini-btn mini-btn--off" type="button" data-clear-pin>关闭保护</button>
        </div>
        <p class="set-hint">${icon("info", { size: 14 })}<span>${escapeHtml(PIN_HINT)}</span></p>
      </section>`
  }

  return `
    <section class="set-card set-card--pin is-warn" aria-labelledby="set-pin-title">
      <header class="set-card__head">
        <span class="set-card__ico">${icon("lock", { size: 20 })}</span>
        <div>
          <h2 id="set-pin-title">建议设置家长 PIN</h2>
          <p>现在点「家长」会直接进管理界面，孩子容易误触到布置、改价、审核。</p>
        </div>
        <span class="set-badge">没设</span>
      </header>

      <form class="set-pin-form" data-set-pin-form novalidate>
        <label class="form-label" for="pin-new">设一个 4 位数字</label>
        <div class="set-pin-inputs">
          <input class="input input--pin" id="pin-new" name="pin" type="text" inputmode="numeric"
            autocomplete="off" maxlength="4" placeholder="••••" pattern="\\d{4}" data-pin-input />
          <input class="input input--pin" id="pin-confirm" name="confirm" type="text" inputmode="numeric"
            autocomplete="off" maxlength="4" placeholder="再输一次" pattern="\\d{4}" />
        </div>
        <p class="sheet__hint">${escapeHtml(PIN_HINT)}</p>
        <button class="btn btn--primary btn--block" type="submit">开启 PIN 保护</button>
      </form>
    </section>`
}

/**
 * 恢复码卡片（M4）。
 * 三种状态：没设 PIN（不显示）/ 有 PIN 但没恢复码（催着补）/ 已就绪（可换一个）。
 */
function recoveryCard() {
  const { configured, recoveryConfigured, recoveryUpdatedAt } = state.pinStatus
  if (!configured) return ""

  const updated = recoveryUpdatedAt ? describeRelative(recoveryUpdatedAt) : ""

  if (!recoveryConfigured) {
    return `
      <section class="set-card set-card--warn" aria-labelledby="set-recovery-title">
        <header class="set-card__head">
          <span class="set-card__ico set-card__ico--warn">${icon("key", { size: 20 })}</span>
          <div>
            <h2 id="set-recovery-title">还没有恢复码</h2>
            <p>这台设备的 PIN 是早前设置的，没有配套恢复码</p>
          </div>
          <span class="set-badge is-late">待生成</span>
        </header>
        <p class="set-hint set-hint--warn">${icon("info", { size: 14 })}<span>现在如果忘了 PIN，只能清空数据重来。生成一份恢复码只要十秒。</span></p>
        <button class="btn btn--ghost btn--block" type="button" data-new-recovery>
          ${icon("key", { size: 17 })}生成恢复码
        </button>
      </section>`
  }

  return `
    <section class="set-card" aria-labelledby="set-recovery-title">
      <header class="set-card__head">
        <span class="set-card__ico set-card__ico--warn">${icon("key", { size: 20 })}</span>
        <div>
          <h2 id="set-recovery-title">恢复码已就绪</h2>
          <p>忘了 PIN 时凭它重置${updated ? ` · ${escapeHtml(updated)}生成` : ""}</p>
        </div>
        <span class="set-badge is-on">有</span>
      </header>
      <div class="set-actions">
        <button class="mini-btn" type="button" data-new-recovery>换一个恢复码</button>
      </div>
      <p class="set-hint">${icon("info", { size: 14 })}<span>${escapeHtml(RECOVERY_HINT)}</span></p>
    </section>`
}

/** 危险区（M4 / G-05）：删除全部家庭数据 */
function dangerCard() {
  return `
    <section class="set-card set-card--danger" aria-labelledby="set-danger-title">
      <header class="set-card__head">
        <span class="set-card__ico set-card__ico--danger">${icon("trash", { size: 20 })}</span>
        <div>
          <h2 id="set-danger-title">删除全部家庭数据</h2>
          <p>孩子、任务、星星、兑换、装扮，一次全清</p>
        </div>
        <span class="set-badge is-danger">危险</span>
      </header>
      <ul class="set-danger-list">
        <li>删完回到第一次打开的样子，只有朵朵和几条示例任务</li>
        <li>不能撤销，也没有"回收站"</li>
        <li><b>已经导出到电脑 / 网盘里的 JSON 备份不会被删</b></li>
      </ul>
      <button class="btn btn--reject btn--block" type="button" data-wipe-data>
        ${icon("trash", { size: 17 })}删除全部家庭数据
      </button>
      <p class="set-hint set-hint--danger">${icon("info", { size: 14 })}<span>想换设备或重来一遍，先「导出全部数据」存一份，再删。</span></p>
    </section>`
}

function backupCard() {
  const backup = state.backup
  const lastAt = backup.lastBackupAt ? describeRelative(backup.lastBackupAt) : null
  const tableCount = Object.keys(backup.counts ?? {}).length || BACKUP_TABLES.length

  return `
    <section class="set-card" aria-labelledby="set-backup-title">
      <header class="set-card__head">
        <span class="set-card__ico set-card__ico--blue">${icon("download", { size: 20 })}</span>
        <div>
          <h2 id="set-backup-title">数据备份</h2>
          <p>${lastAt ? `上次导出：${escapeHtml(lastAt)}` : "还没导出过，建议现在就存一份"}</p>
        </div>
        <span class="set-badge ${lastAt ? "is-on" : "is-late"}">${lastAt ? "有备份" : "待备份"}</span>
      </header>

      <ul class="set-stat">
        <li><strong>${tableCount}</strong><span>张表</span></li>
        <li><strong>${backup.total ?? 0}</strong><span>条记录</span></li>
        <li><strong>${backup.canUndo ? "可撤销" : "—"}</strong><span>上次导入</span></li>
      </ul>

      <div class="set-actions set-actions--stack">
        <button class="btn btn--primary btn--block" type="button" data-export-backup>
          ${icon("download", { size: 17 })}导出全部数据（JSON）
        </button>
        <button class="btn btn--ghost btn--block" type="button" data-import-backup>
          ${icon("upload", { size: 17 })}从备份文件恢复
        </button>
        ${
          backup.canUndo
            ? `<button class="btn btn--ghost btn--block set-undo" type="button" data-undo-restore>
                 ${icon("undo", { size: 17 })}撤销上次导入（${escapeHtml(describeDateTime(backup.undoSnapshotAt) || "")} 那份）
               </button>`
            : ""
        }
      </div>

      <input type="file" accept=".json,application/json" hidden data-import-input />

      <p class="set-hint">${icon("info", { size: 14 })}<span>备份里有孩子、任务、积分流水、奖励、兑换与装扮。恢复会<b>覆盖</b>当前全部数据，导入前会自动留一份可撤销的快照。</span></p>
    </section>`
}

function templateCard() {
  const all = state.templates
  const active = all.filter((template) => template.enabled !== false).length
  return `
    <section class="set-card" aria-labelledby="set-template-title">
      <header class="set-card__head">
        <span class="set-card__ico set-card__ico--orange">${icon("repeat", { size: 20 })}</span>
        <div>
          <h2 id="set-template-title">固定任务</h2>
          <p>${all.length ? `${active} 个在生效 · 共 ${all.length} 个` : "还没有固定任务，每天都要手动布置"}</p>
        </div>
      </header>
      <div class="set-actions">
        <button class="mini-btn" type="button" data-page="assign">去布置页管理</button>
      </div>
      <p class="set-hint">${icon("info", { size: 14 })}<span>在布置任务时勾选「每天」或「每周几」，之后每天打开就自动出现，同一天不会重复生成。</span></p>
    </section>`
}

function installCard() {
  const install = installState()
  let body
  if (install.installed) {
    body = `<p class="set-install__done">${icon("check", { size: 16, strokeWidth: 2.6 })}已经在独立窗口里运行，主屏幕上应该能看到图标</p>`
  } else if (install.canPrompt) {
    body = `<button class="btn btn--ghost btn--block" type="button" data-install-app>${icon("plus", { size: 17 })}添加到主屏幕</button>`
  } else if (install.ios) {
    body = `
      <p class="set-install__tip">在 Safari 里点底部的「分享」按钮 →「添加到主屏幕」，之后就能像 App 一样打开。</p>
      <button class="btn btn--ghost btn--block" type="button" data-install-help>${icon("info", { size: 17 })}看安装步骤</button>`
  } else {
    body = `
      <p class="set-install__tip">${
        install.localhost
          ? "现在跑在开发地址 localhost，浏览器不会给出「一键安装」按钮；部署到正式网址后，这里会自动变成可点的按钮。"
          : "浏览器没给一键安装入口，用右上角菜单也能装。"
      }</p>
      <button class="btn btn--ghost btn--block" type="button" data-install-help>${icon("info", { size: 17 })}看安装步骤</button>`
  }

  return `
    <section class="set-card" aria-labelledby="set-install-title">
      <header class="set-card__head">
        <span class="set-card__ico set-card__ico--green">${icon("home", { size: 20 })}</span>
        <div>
          <h2 id="set-install-title">添加到主屏幕</h2>
          <p>装到桌面后打开更快，也没有地址栏</p>
        </div>
      </header>
      ${body}
    </section>`
}

function storageCard() {
  return `
    <section class="set-card set-card--flat" aria-labelledby="set-storage-title">
      <header class="set-card__head">
        <span class="set-card__ico">${icon("shield", { size: 20 })}</span>
        <div>
          <h2 id="set-storage-title">数据存在哪</h2>
          <p>全部在这台设备的浏览器里，没有账号、没有上云</p>
        </div>
      </header>
      <dl class="set-dl">
        <div><dt>应用版本</dt><dd>v${escapeHtml(APP_VERSION)} · 稳定版</dd></div>
        <div><dt>数据库版本</dt><dd>Schema v${SCHEMA_VERSION} · ${BACKUP_TABLES.length} 张表</dd></div>
        <div><dt>最近导出</dt><dd>${
          state.backup?.lastBackupFileName
            ? escapeHtml(state.backup.lastBackupFileName)
            : "还没有导出过"
        }</dd></div>
      </dl>
      <p class="set-hint">${icon("info", { size: 14 })}<span>换手机、清缓存、卸载浏览器都会让数据消失。定期导出 JSON 是最稳的保险。</span></p>
    </section>`
}

export function renderSettings() {
  return `
  <section class="page page--settings" data-page-view="settings" aria-labelledby="settings-heading">
    <h1 class="sr-only" id="settings-heading">设置</h1>

    <div class="parent-hero parent-hero--settings">
      <div class="parent-hero__text">
        <p class="parent-hero__kicker">家庭设置 · 安全与备份</p>
        <h2>最后的三道防线</h2>
        <p class="parent-hero__sub">PIN 挡住孩子的手，恢复码救回忘掉的 PIN，备份挡住意外的清空。三件事都做了，这套系统就可以放心交给孩子天天用。</p>
      </div>
      <span class="parent-hero__shield" aria-hidden="true">${icon("gear", { size: 30 })}</span>
    </div>

    ${pinCard()}
    ${recoveryCard()}
    ${backupCard()}
    ${templateCard()}
    ${installCard()}
    ${storageCard()}
    ${dangerCard()}

    <button class="btn btn--ghost btn--block set-exit" type="button" data-exit-parent>
      ${icon("lock", { size: 17 })}退出家长模式
    </button>
    <p class="page-foot page-foot--parent">${icon("info", { size: 14 })}<span>退出后回到孩子端，再进家长端要重新输 PIN（刷新页面同理）</span></p>
  </section>`
}
