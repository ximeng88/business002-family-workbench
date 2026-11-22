/**
 * 内联 SVG 图标集。
 * 全部 24×24、stroke 风格、currentColor 上色；不引入外部图标依赖，
 * 保证离线可用与构建体积可控。
 */

const PATHS = {
  sun: `
    <circle cx="12" cy="12" r="4.1" />
    <path d="M12 2.6v2.2M12 19.2v2.2M2.6 12h2.2M19.2 12h2.2M5.4 5.4l1.6 1.6M17 17l1.6 1.6M18.6 5.4L17 7M7 17l-1.6 1.6" />`,
  paw: `
    <ellipse cx="7.4" cy="8.2" rx="2.1" ry="2.6" />
    <ellipse cx="12" cy="6.4" rx="2.1" ry="2.7" />
    <ellipse cx="16.6" cy="8.2" rx="2.1" ry="2.6" />
    <ellipse cx="19.6" cy="13" rx="1.8" ry="2.2" />
    <path d="M12 10.6c3.2 0 6 2.6 6 5.4 0 2.1-1.7 3.4-3.9 3.4-1 0-1.6-.3-2.1-.3s-1.1.3-2.1.3c-2.2 0-3.9-1.3-3.9-3.4 0-2.8 2.8-5.4 6-5.4Z" />`,
  shield: `
    <path d="M12 3.2 19.4 6v5.7c0 4.3-3.1 7.5-7.4 8.9-4.3-1.4-7.4-4.6-7.4-8.9V6Z" />
    <path d="m8.9 11.8 2.1 2.1 4.1-4.3" />`,
  star: `<path d="M12 3.4l2.6 5.4 5.8.8-4.2 4.2 1 5.9L12 16.9 6.8 19.7l1-5.9L3.6 9.6l5.8-.8Z" />`,
  starSolid: `<path d="M12 3.4l2.6 5.4 5.8.8-4.2 4.2 1 5.9L12 16.9 6.8 19.7l1-5.9L3.6 9.6l5.8-.8Z" fill="currentColor" stroke="none" />`,
  book: `
    <path d="M4 5.6C4 4.7 4.7 4 5.6 4H10a2.4 2.4 0 0 1 2 1.1A2.4 2.4 0 0 1 14 4h4.4c.9 0 1.6.7 1.6 1.6v11.8c0 .6-.4 1-1 1h-4.6c-.9 0-1.6.5-1.6 1.4" />
    <path d="M4 5.6v11.8c0 .6.4 1 1 1h4.6c.9 0 1.6.5 1.6 1.4V7.1a2.4 2.4 0 0 0-1.5-2.2" />`,
  calc: `
    <rect x="4.6" y="3" width="14.8" height="18" rx="3.4" />
    <path d="M8.4 7.6h7.2" />
    <circle cx="8.8" cy="12.4" r="0.9" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12.4" r="0.9" fill="currentColor" stroke="none" />
    <circle cx="15.2" cy="12.4" r="0.9" fill="currentColor" stroke="none" />
    <circle cx="8.8" cy="16.4" r="0.9" fill="currentColor" stroke="none" />
    <circle cx="12" cy="16.4" r="0.9" fill="currentColor" stroke="none" />
    <circle cx="15.2" cy="16.4" r="0.9" fill="currentColor" stroke="none" />`,
  backpack: `
    <rect x="4.4" y="7.4" width="15.2" height="13.2" rx="4.2" />
    <path d="M8.6 7.4V6.2a3.4 3.4 0 0 1 6.8 0v1.2" />
    <path d="M4.4 12.6h15.2" />
    <path d="M9.8 16.4h4.4" />`,
  broom: `
    <path d="M14.6 3.4 9.8 12" />
    <path d="M9.6 11.4 4.2 16.8c-.5.5-.4 1.3.3 1.7l1.6 1c.6.4 1.4.2 1.8-.4l4.2-6" />
    <path d="m7.6 13.2 5.5 3.6" />`,
  pencil: `
    <path d="M15.6 4.4l4 4-10 10-5 1 1-5Z" />
    <path d="m13.4 6.6 4 4" />`,
  palette: `
    <path d="M12 3.4a8.6 8.6 0 0 0 0 17.2c1.4 0 2.2-.9 2.2-2 0-1.4 1-2.1 2.3-2.1h1.4a2.7 2.7 0 0 0 2.7-2.7c0-4.9-3.9-8.4-8.6-8.4Z" />
    <circle cx="8.2" cy="9.4" r="1.1" fill="currentColor" stroke="none" />
    <circle cx="12" cy="7.4" r="1.1" fill="currentColor" stroke="none" />
    <circle cx="15.8" cy="9.4" r="1.1" fill="currentColor" stroke="none" />`,
  music: `
    <circle cx="7.4" cy="17.2" r="2.8" />
    <circle cx="17.4" cy="15.4" r="2.8" />
    <path d="M10.2 17.2V6.6l10-2v10.8" />`,
  moon: `<path d="M20 14.4A8.4 8.4 0 0 1 9.6 4a8.6 8.6 0 1 0 10.4 10.4Z" />`,
  check: `<path d="m4.8 12.6 4.6 4.6L19.4 6.8" />`,
  clock: `
    <circle cx="12" cy="12" r="8.8" />
    <path d="M12 7.2V12l3.2 2" />`,
  refresh: `
    <path d="M20 12a8 8 0 1 1-2.4-5.7" />
    <path d="M20 4.4V9h-4.6" />`,
  chevron: `<path d="m9.4 5.6 6.4 6.4-6.4 6.4" />`,
  close: `<path d="M6 6l12 12M18 6 6 18" />`,
  plus: `<path d="M12 5.4v13.2M5.4 12h13.2" />`,
  sparkle: `
    <path d="M12 3.6c.7 4.4 2.2 6 6.6 6.7-4.4.7-5.9 2.2-6.6 6.6-.7-4.4-2.2-5.9-6.6-6.6 4.4-.7 5.9-2.3 6.6-6.7Z" />
    <path d="M17.8 15.4c.35 2.1 1.05 2.85 3.15 3.2-2.1.35-2.8 1.05-3.15 3.15-.35-2.1-1.05-2.8-3.15-3.15 2.1-.35 2.8-1.1 3.15-3.2Z" />`,
  info: `
    <circle cx="12" cy="12" r="8.8" />
    <path d="M12 11v5.4" />
    <circle cx="12" cy="7.9" r="0.95" fill="currentColor" stroke="none" />`,
  trophy: `
    <path d="M7.6 4.4h8.8v4.2a4.4 4.4 0 0 1-8.8 0Z" />
    <path d="M7.6 5.6H4.8v1.6a3 3 0 0 0 3 3M16.4 5.6h2.8v1.6a3 3 0 0 1-3 3" />
    <path d="M12 13v3.4M8.6 19.6h6.8" />`,
  home: `
    <path d="M4.4 10.4 12 4l7.6 6.4V19a1.4 1.4 0 0 1-1.4 1.4h-3.4v-5.2H9.2v5.2H5.8A1.4 1.4 0 0 1 4.4 19Z" />`,
  users: `
    <circle cx="9.4" cy="8.4" r="3.4" />
    <path d="M3.8 19.4c0-3 2.5-5.2 5.6-5.2s5.6 2.2 5.6 5.2" />
    <path d="M16.4 5.8a3 3 0 0 1 0 5.6M17.6 14.8c1.9.5 3.2 2.2 3.2 4.2" />`,
  flame: `
    <path d="M12 3.6c2.6 3.2 4.6 5.5 4.6 8.7a4.6 4.6 0 0 1-9.2 0c0-1.7.7-2.9 1.9-4.3.6 1 1.2 1.6 2 1.9.3-1.6.5-3.4.7-6.3Z" />`,
  calendar: `
    <rect x="3.8" y="5.4" width="16.4" height="15" rx="4" />
    <path d="M8.2 3.4v4M15.8 3.4v4M3.8 10.2h16.4" />`,
  undo: `
    <path d="M4 9.8h8.6a5.3 5.3 0 1 1 0 10.6H8.4" />
    <path d="M7.6 5.8 3.8 9.8l3.8 4" />`,
  edit: `
    <path d="M4.4 19.6h4l10-10a2.3 2.3 0 0 0-3.2-3.2l-10 10Z" />
    <path d="m13.6 7.6 3.2 3.2" />`,
  /**
   * 设置。故意画成"滑杆"而不是齿轮：
   * 齿缘在 18–20px 的导航尺寸下会糊成一团，还容易和太阳图标混。
   */
  gear: `
    <path d="M4.6 7.6h8.2M18.4 7.6h1M4.6 16.4h1M10.8 16.4h8.6" />
    <circle cx="15.6" cy="7.6" r="2.1" />
    <circle cx="8" cy="16.4" r="2.1" />`,
  lock: `
    <rect x="4.8" y="10.4" width="14.4" height="9.6" rx="3" />
    <path d="M8.4 10.4V7.8a3.6 3.6 0 0 1 7.2 0v2.6" />
    <circle cx="12" cy="15.2" r="1.1" fill="currentColor" stroke="none" />`,
  download: `
    <path d="M12 4.4v10.2" />
    <path d="m7.8 10.6 4.2 4.2 4.2-4.2" />
    <path d="M4.8 18.4h14.4" />`,
  upload: `
    <path d="M12 19.4V9.2" />
    <path d="m7.8 13.2 4.2-4.2 4.2 4.2" />
    <path d="M4.8 5.6h14.4" />`,
  trash: `
    <path d="M5.4 7.6h13.2" />
    <path d="M9.4 7.6V5.8a1.4 1.4 0 0 1 1.4-1.4h2.4a1.4 1.4 0 0 1 1.4 1.4v1.8" />
    <path d="M7.2 7.6l.8 10.2a2 2 0 0 0 2 1.9h4a2 2 0 0 0 2-1.9l.8-10.2" />
    <path d="M10.4 11v5M13.6 11v5" />`,
  repeat: `
    <path d="M5.2 10.2A6.8 6.8 0 0 1 17 6.2l1.8 1.9" />
    <path d="M18.8 4.6v3.5h-3.5" />
    <path d="M18.8 13.8A6.8 6.8 0 0 1 7 17.8l-1.8-1.9" />
    <path d="M5.2 19.4v-3.5h3.5" />`,
  /** 恢复码：一把钥匙，比 lock 更像"备用的那条路" */
  key: `
    <circle cx="8" cy="15.8" r="3.3" />
    <path d="m10.6 13.4 8.2-8.2" />
    <path d="m16.4 7.6 2 2M14.2 9.8l1.8 1.8" />`,
  /** 相机：头像上传的唯一入口，比"图片"图标更能表达"从相册选或现在拍" */
  camera: `
    <path d="M4.6 8.6h2.3l1.3-2.1h7.6l1.3 2.1h2.3a1.6 1.6 0 0 1 1.6 1.6v7.3a1.6 1.6 0 0 1-1.6 1.6H4.6A1.6 1.6 0 0 1 3 17.5v-7.3a1.6 1.6 0 0 1 1.6-1.6Z" />
    <circle cx="12" cy="13.5" r="3.2" />`,
  /** 放大镜（带加号）：裁剪层的缩放滑杆用它标"这一端是放大" */
  zoom: `
    <circle cx="11" cy="11" r="6.4" />
    <path d="m15.9 15.9 4.1 4.1" />
    <path d="M8.6 11h4.8M11 8.6v4.8" />`,
}

/**
 * 孩子头像：数据集里只存 key，Emoji 与文案属于界面层。
 * 不在数据库里存 Emoji，换皮时不用迁移数据。
 */
export const AVATARS = Object.freeze([
  { key: "cat", emoji: "🐱", label: "小猫" },
  { key: "rabbit", emoji: "🐰", label: "小兔" },
  { key: "bear", emoji: "🐻", label: "小熊" },
  { key: "fox", emoji: "🦊", label: "小狐" },
  { key: "panda", emoji: "🐼", label: "熊猫" },
  { key: "owl", emoji: "🦉", label: "猫头鹰" },
  { key: "dino", emoji: "🦖", label: "小恐龙" },
  { key: "whale", emoji: "🐳", label: "小鲸鱼" },
])

export function avatarOf(key) {
  return AVATARS.find((avatar) => avatar.key === key) ?? AVATARS[0]
}

/**
 * @param {keyof typeof PATHS} name
 * @param {{ size?: number, className?: string, strokeWidth?: number, fill?: boolean }} [options]
 */
export function icon(name, { size = 24, className = "", strokeWidth = 1.9 } = {}) {
  const body = PATHS[name] ?? PATHS.star
  return `<svg class="icon ${className}" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`
}

/**
 * 任务标题 → 科目视觉。纯 UI 配置，不写入数据库。
 * 匹配不上时回落到「星星」通用样式。
 */
const SUBJECTS = [
  { key: "chinese", tone: "purple", iconName: "book", words: ["朗读", "课文", "阅读", "背", "语文", "日记", "写字"] },
  { key: "math", tone: "green", iconName: "calc", words: ["口算", "数学", "算", "题", "计算"] },
  { key: "bag", tone: "blue", iconName: "backpack", words: ["书包", "文具", "准备"] },
  { key: "tidy", tone: "orange", iconName: "broom", words: ["书桌", "收拾", "整理", "打扫", "房间", "叠"] },
  { key: "art", tone: "pink", iconName: "palette", words: ["画", "美术", "手工", "color"] },
  { key: "music", tone: "blue", iconName: "music", words: ["琴", "唱", "音乐", "舞"] },
  { key: "sport", tone: "green", iconName: "trophy", words: ["跳绳", "运动", "跑步", "球"] },
  { key: "english", tone: "purple", iconName: "pencil", words: ["英语", "单词", "拼写"] },
]

const TONES = ["orange", "blue", "green", "purple", "pink"]

export function subjectOf(title = "") {
  const text = String(title)
  const hit = SUBJECTS.find((subject) => subject.words.some((word) => text.includes(word)))
  if (hit) return hit
  // 稳定回落：同一标题永远得到同一色调
  let hash = 0
  for (let index = 0; index < text.length; index += 1) hash = (hash * 31 + text.charCodeAt(index)) % 9973
  return { key: "generic", tone: TONES[hash % TONES.length], iconName: "star", words: [] }
}
