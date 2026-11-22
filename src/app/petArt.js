/**
 * 五种宠物的分层 SVG 素材（M6）。**本文件由 design/assets/pets/*.svg 生成**，
 * 手改请同步改素材，否则下次重新生成会覆盖。
 *
 * 为什么拆成图层而不是整段 SVG：装扮必须插在**特定位置**——
 * 帽子要在头之后、围巾要在脖子处、星空背景要在最底层。渲染顺序见 `pet.js`。
 *
 * 五种宠物共用同一套骨相（画布 264×254、头 132,104 r65/57、身 132,180 r63/53、
 * 眼 108/156 y106），因此五件装扮对五只全部可用，不需要 25 次单独对齐。
 * 差异只在耳朵、尾巴、配色与口鼻（见 design/07 §3）。
 *
 * 动画 class 沿用现有 `.cat__*` 选择器（pages.css），CSS 不需要改；
 * 每只宠物单独的 transform-origin 用内联 style 覆盖。
 */

/** 宠物元信息：界面上的名字、一句话简介、绘制顺序里的摆动锚点 */
export const PET_META = Object.freeze({
  cat: Object.freeze({ key: "cat", label: "小猫" }),
  bear: Object.freeze({ key: "bear", label: "小熊" }),
  rabbit: Object.freeze({ key: "rabbit", label: "小兔" }),
  dog: Object.freeze({ key: "dog", label: "小狗" }),
  fox: Object.freeze({ key: "fox", label: "小狐狸" }),
})

/** 绘制顺序：改动这个数组会让帽子被头挡住、或垂耳盖住镜片，不要随意调整 */
export const PET_LAYER_ORDER = Object.freeze([
  "background",
  "shadow",
  "tail",
  "body",
  "outfit",
  "earLeft",
  "earRight",
  "head",
  "earFrontLeft",
  "earFrontRight",
  "earFront",
  "scarf",
  "glasses",
  "hat",
  "spark",
])

/** 每只宠物的静态图层（空字符串 = 这只没有这一层） */
export const PET_ART = Object.freeze({
  cat: Object.freeze({
    shadow: `<ellipse data-layer="shadow" cx="132" cy="236" rx="68" ry="11" fill="rgba(122,74,36,0.14)" />`,
    tail: `<g class="cat__tail" style="transform-origin:178px 200px"><path d="M178 200c32 8 52-10 47-38-2.4-14-12-23-23-20" fill="none" stroke="#7a4a24" stroke-width="25" stroke-linecap="round" />
    <path d="M178 200c32 8 52-10 47-38-2.4-14-12-23-23-20" fill="none" stroke="#f7a751" stroke-width="17" stroke-linecap="round" />
    <path d="M212 178c7-4 11-11 11-18" fill="none" stroke="#ffcf9a" stroke-width="5" stroke-linecap="round" /></g>`,
    body: `<g ><ellipse cx="132" cy="180" rx="63" ry="53" fill="#f9b268" stroke="#7a4a24" stroke-width="7" />
    <ellipse cx="132" cy="192" rx="40" ry="34" fill="#ffe3c1" />
    <path d="M96 156c2-10 10-16 19-15" fill="none" stroke="#e08a35" stroke-width="6" stroke-linecap="round" opacity="0.55" />
    <path d="M170 160c-2-9-9-14-17-14" fill="none" stroke="#e08a35" stroke-width="6" stroke-linecap="round" opacity="0.55" />
    <ellipse cx="106" cy="218" rx="20" ry="12.5" fill="#ffe3c1" stroke="#7a4a24" stroke-width="6" />
    <ellipse cx="158" cy="218" rx="20" ry="12.5" fill="#ffe3c1" stroke="#7a4a24" stroke-width="6" />
    <path d="M112 216v4M120 216v4M150 216v4M158 216v4" stroke="#e4a877" stroke-width="2.6" stroke-linecap="round" /></g>`,
    earLeft: `<g class="cat__ear cat__ear--left" style="transform-origin:90px 84px"><path d="M76 82 62 34l46 24Z" fill="#f9b268" stroke="#7a4a24" stroke-width="7" stroke-linejoin="round" />
    <path d="M82 70 74 46l22 12Z" fill="#ffb3a6" /></g>`,
    earRight: `<g class="cat__ear cat__ear--right" style="transform-origin:174px 84px"><path d="M188 82 202 34l-46 24Z" fill="#f9b268" stroke="#7a4a24" stroke-width="7" stroke-linejoin="round" />
    <path d="M182 70 190 46l-22 12Z" fill="#ffb3a6" /></g>`,
    head: `<g class="cat__head"><ellipse cx="132" cy="104" rx="65" ry="57" fill="#f9b268" stroke="#7a4a24" stroke-width="7" />
    <path d="M118 54v13M132 50v16M146 54v13" stroke="#e08a35" stroke-width="6" stroke-linecap="round" opacity="0.7" />
    <path d="M132 47c-3-13 3-20 11-17" fill="none" stroke="#7a4a24" stroke-width="5" stroke-linecap="round" />

    <g data-layer="face">
      <ellipse cx="87" cy="130" rx="14" ry="8.5" fill="#ff9e9e" opacity="0.42" />
      <ellipse cx="177" cy="130" rx="14" ry="8.5" fill="#ff9e9e" opacity="0.42" />

      <g class="cat__eye cat__eye--left">
        <ellipse cx="108" cy="106" rx="10.5" ry="12.5" fill="#4a2e1e" />
        <circle cx="104.5" cy="101" r="3.6" fill="#ffffff" />
        <circle cx="111.5" cy="110" r="1.9" fill="#ffffff" opacity="0.75" />
      </g>
      <g class="cat__eye cat__eye--right">
        <ellipse cx="156" cy="106" rx="10.5" ry="12.5" fill="#4a2e1e" />
        <circle cx="152.5" cy="101" r="3.6" fill="#ffffff" />
        <circle cx="159.5" cy="110" r="1.9" fill="#ffffff" opacity="0.75" />
      </g>

      <ellipse cx="120" cy="124" rx="16" ry="12" fill="#ffe3c1" />
      <ellipse cx="144" cy="124" rx="16" ry="12" fill="#ffe3c1" />
      <path d="M132 114.5 125 109h14Z" fill="#e8638b" stroke="#e8638b" stroke-width="2" stroke-linejoin="round" />
      <path d="M132 115v5.5" stroke="#7a4a24" stroke-width="3.4" stroke-linecap="round" />
      <path d="M132 120.5c-4.4 6-12 5.2-15.2 0.6M132 120.5c4.4 6 12 5.2 15.2 0.6" fill="none" stroke="#7a4a24" stroke-width="3.4" stroke-linecap="round" />
      <path d="M96 118 78 114M96 126 79 128M168 118l18-4M168 126l17 2" stroke="#7a4a24" stroke-width="2.8" stroke-linecap="round" opacity="0.45" />
    </g></g>`,
    spark: `<g class="cat__spark"><path d="M28 96c.9 5.4 2.7 7.2 8.1 8.1-5.4.9-7.2 2.7-8.1 8.1-.9-5.4-2.7-7.2-8.1-8.1 5.4-.9 7.2-2.7 8.1-8.1Z" fill="#ffc531" />
    <path d="M238 138c.7 4 2 5.4 6 6.1-4 .7-5.3 2-6 6.1-.7-4-2-5.4-6-6.1 4-.7 5.3-2.1 6-6.1Z" fill="#8b7cff" opacity="0.7" />
    <path d="M222 62c.6 3.4 1.7 4.5 5.1 5.1-3.4.6-4.5 1.7-5.1 5.1-.6-3.4-1.7-4.5-5.1-5.1 3.4-.6 4.5-1.7 5.1-5.1Z" fill="#4c9aff" opacity="0.6" /></g>`,
  }),
  bear: Object.freeze({
    shadow: `<ellipse data-layer="shadow" cx="132" cy="236" rx="68" ry="11" fill="rgba(122,74,36,0.14)" />`,
    tail: `<g class="cat__tail" style="transform-origin:190px 206px"><circle cx="190" cy="206" r="13" fill="#f6dcc0" stroke="#7a5233" stroke-width="6" /></g>`,
    body: `<g ><ellipse cx="132" cy="180" rx="63" ry="53" fill="#d9a06b" stroke="#7a5233" stroke-width="7" />
    <ellipse cx="132" cy="192" rx="40" ry="34" fill="#f6dcc0" />
    <path d="M96 156c2-10 10-16 19-15" fill="none" stroke="#b9834e" stroke-width="6" stroke-linecap="round" opacity="0.5" />
    <path d="M170 160c-2-9-9-14-17-14" fill="none" stroke="#b9834e" stroke-width="6" stroke-linecap="round" opacity="0.5" />
    <ellipse cx="106" cy="218" rx="20" ry="12.5" fill="#f6dcc0" stroke="#7a5233" stroke-width="6" />
    <ellipse cx="158" cy="218" rx="20" ry="12.5" fill="#f6dcc0" stroke="#7a5233" stroke-width="6" />
    <path d="M112 216v4M120 216v4M150 216v4M158 216v4" stroke="#c79a6d" stroke-width="2.6" stroke-linecap="round" /></g>`,
    earLeft: `<g class="cat__ear cat__ear--left" style="transform-origin:80px 60px"><circle cx="80" cy="60" r="22" fill="#d9a06b" stroke="#7a5233" stroke-width="7" />
    <circle cx="80" cy="62" r="11" fill="#e8b98f" /></g>`,
    earRight: `<g class="cat__ear cat__ear--right" style="transform-origin:184px 60px"><circle cx="184" cy="60" r="22" fill="#d9a06b" stroke="#7a5233" stroke-width="7" />
    <circle cx="184" cy="62" r="11" fill="#e8b98f" /></g>`,
    head: `<g class="cat__head"><ellipse cx="132" cy="104" rx="65" ry="57" fill="#d9a06b" stroke="#7a5233" stroke-width="7" />

    <g data-layer="face">
      <ellipse cx="86" cy="132" rx="14" ry="8.5" fill="#ff9e9e" opacity="0.38" />
      <ellipse cx="178" cy="132" rx="14" ry="8.5" fill="#ff9e9e" opacity="0.38" />

      <g class="cat__eye cat__eye--left">
        <ellipse cx="108" cy="104" rx="9.5" ry="11.5" fill="#4a2e1e" />
        <circle cx="104.8" cy="99.5" r="3.4" fill="#ffffff" />
        <circle cx="111" cy="108" r="1.8" fill="#ffffff" opacity="0.75" />
      </g>
      <g class="cat__eye cat__eye--right">
        <ellipse cx="156" cy="104" rx="9.5" ry="11.5" fill="#4a2e1e" />
        <circle cx="152.8" cy="99.5" r="3.4" fill="#ffffff" />
        <circle cx="159" cy="108" r="1.8" fill="#ffffff" opacity="0.75" />
      </g>

      <ellipse cx="132" cy="128" rx="30" ry="22" fill="#f6dcc0" />
      <ellipse cx="132" cy="118" rx="8.5" ry="6.5" fill="#4a2e1e" />
      <path d="M132 124v4" stroke="#7a5233" stroke-width="3.4" stroke-linecap="round" />
      <path d="M132 128c-4 5.5-11 5-14 0.8M132 128c4 5.5 11 5 14 0.8" fill="none" stroke="#7a5233" stroke-width="3.4" stroke-linecap="round" />
    </g></g>`,
    spark: `<g class="cat__spark"><path d="M28 96c.9 5.4 2.7 7.2 8.1 8.1-5.4.9-7.2 2.7-8.1 8.1-.9-5.4-2.7-7.2-8.1-8.1 5.4-.9 7.2-2.7 8.1-8.1Z" fill="#ffc531" />
    <path d="M238 138c.7 4 2 5.4 6 6.1-4 .7-5.3 2-6 6.1-.7-4-2-5.4-6-6.1 4-.7 5.3-2.1 6-6.1Z" fill="#8b7cff" opacity="0.7" /></g>`,
  }),
  rabbit: Object.freeze({
    shadow: `<ellipse data-layer="shadow" cx="132" cy="236" rx="68" ry="11" fill="rgba(122,74,36,0.14)" />`,
    tail: `<g class="cat__tail" style="transform-origin:192px 200px"><circle cx="192" cy="200" r="15" fill="#fffdfa" stroke="#a9877a" stroke-width="6" /></g>`,
    body: `<g ><ellipse cx="132" cy="180" rx="63" ry="53" fill="#f7f1ea" stroke="#a9877a" stroke-width="7" />
    <ellipse cx="132" cy="192" rx="40" ry="34" fill="#fffdfa" />
    <path d="M96 156c2-10 10-16 19-15" fill="none" stroke="#dcc9bb" stroke-width="6" stroke-linecap="round" opacity="0.7" />
    <path d="M170 160c-2-9-9-14-17-14" fill="none" stroke="#dcc9bb" stroke-width="6" stroke-linecap="round" opacity="0.7" />
    <ellipse cx="106" cy="218" rx="20" ry="12.5" fill="#fffdfa" stroke="#a9877a" stroke-width="6" />
    <ellipse cx="158" cy="218" rx="20" ry="12.5" fill="#fffdfa" stroke="#a9877a" stroke-width="6" />
    <path d="M112 216v4M120 216v4M150 216v4M158 216v4" stroke="#dcc9bb" stroke-width="2.6" stroke-linecap="round" /></g>`,
    earLeft: `<g class="cat__ear cat__ear--left" style="transform-origin:97px 45px"><ellipse cx="97" cy="45" rx="17" ry="48" fill="#f7f1ea" stroke="#a9877a" stroke-width="7" transform="rotate(-9 97 45)" />
    <ellipse cx="98" cy="46" rx="8.5" ry="33" fill="#ffb3c6" transform="rotate(-9 98 46)" /></g>`,
    earRight: `<g class="cat__ear cat__ear--right" style="transform-origin:167px 45px"><ellipse cx="167" cy="45" rx="17" ry="48" fill="#f7f1ea" stroke="#a9877a" stroke-width="7" transform="rotate(9 167 45)" />
    <ellipse cx="166" cy="46" rx="8.5" ry="33" fill="#ffb3c6" transform="rotate(9 166 46)" /></g>`,
    head: `<g class="cat__head"><ellipse cx="132" cy="104" rx="65" ry="57" fill="#f7f1ea" stroke="#a9877a" stroke-width="7" />

    <g data-layer="face">
      <ellipse cx="84" cy="132" rx="15" ry="9" fill="#ff9e9e" opacity="0.45" />
      <ellipse cx="180" cy="132" rx="15" ry="9" fill="#ff9e9e" opacity="0.45" />

      <g class="cat__eye cat__eye--left">
        <ellipse cx="108" cy="104" rx="10.5" ry="12.5" fill="#4a2e1e" />
        <circle cx="104.5" cy="99" r="3.6" fill="#ffffff" />
        <circle cx="111.5" cy="108" r="1.9" fill="#ffffff" opacity="0.75" />
      </g>
      <g class="cat__eye cat__eye--right">
        <ellipse cx="156" cy="104" rx="10.5" ry="12.5" fill="#4a2e1e" />
        <circle cx="152.5" cy="99" r="3.6" fill="#ffffff" />
        <circle cx="159.5" cy="108" r="1.9" fill="#ffffff" opacity="0.75" />
      </g>

      <ellipse cx="132" cy="126" rx="24" ry="17" fill="#fffdfa" />
      <path d="M132 112.5 126 118h12Z" fill="#e8638b" stroke="#e8638b" stroke-width="2" stroke-linejoin="round" />
      <path d="M132 118v4.5" stroke="#a9877a" stroke-width="3.2" stroke-linecap="round" />
      <path d="M132 122.5c-3 4-8 4-10 .5M132 122.5c3 4 8 4 10 .5" fill="none" stroke="#a9877a" stroke-width="3.2" stroke-linecap="round" />
      <rect x="127" y="128" width="10" height="11" rx="3" fill="#ffffff" stroke="#dcc9bb" stroke-width="2.4" />
      <path d="M132 128v11" stroke="#dcc9bb" stroke-width="2" />
      <path d="M96 120 80 116M96 128 81 130M168 120l16-4M168 128l15 2" stroke="#a9877a" stroke-width="2.6" stroke-linecap="round" opacity="0.4" />
    </g></g>`,
    spark: `<g class="cat__spark"><path d="M28 96c.9 5.4 2.7 7.2 8.1 8.1-5.4.9-7.2 2.7-8.1 8.1-.9-5.4-2.7-7.2-8.1-8.1 5.4-.9 7.2-2.7 8.1-8.1Z" fill="#ffc531" />
    <path d="M238 138c.7 4 2 5.4 6 6.1-4 .7-5.3 2-6 6.1-.7-4-2-5.4-6-6.1 4-.7 5.3-2.1 6-6.1Z" fill="#ff7aa8" opacity="0.6" /></g>`,
  }),
  dog: Object.freeze({
    shadow: `<ellipse data-layer="shadow" cx="132" cy="236" rx="68" ry="11" fill="rgba(122,74,36,0.14)" />`,
    tail: `<g class="cat__tail" style="transform-origin:176px 198px"><path d="M176 198c26 0 36-16 30-34" fill="none" stroke="#8a5f33" stroke-width="22" stroke-linecap="round" />
    <path d="M176 198c26 0 36-16 30-34" fill="none" stroke="#e9b978" stroke-width="14" stroke-linecap="round" />
    <path d="M200 170c4-4 6-9 6-13" fill="none" stroke="#ffeed4" stroke-width="4.5" stroke-linecap="round" /></g>`,
    body: `<g ><ellipse cx="132" cy="180" rx="63" ry="53" fill="#e9b978" stroke="#8a5f33" stroke-width="7" />
    <ellipse cx="132" cy="192" rx="40" ry="34" fill="#ffeed4" />
    <path d="M96 156c2-10 10-16 19-15" fill="none" stroke="#c9945a" stroke-width="6" stroke-linecap="round" opacity="0.5" />
    <path d="M170 160c-2-9-9-14-17-14" fill="none" stroke="#c9945a" stroke-width="6" stroke-linecap="round" opacity="0.5" />
    <ellipse cx="106" cy="218" rx="20" ry="12.5" fill="#ffeed4" stroke="#8a5f33" stroke-width="6" />
    <ellipse cx="158" cy="218" rx="20" ry="12.5" fill="#ffeed4" stroke="#8a5f33" stroke-width="6" />
    <path d="M112 216v4M120 216v4M150 216v4M158 216v4" stroke="#d0a877" stroke-width="2.6" stroke-linecap="round" /></g>`,
    head: `<g class="cat__head"><ellipse cx="132" cy="104" rx="65" ry="57" fill="#e9b978" stroke="#8a5f33" stroke-width="7" />

    <g data-layer="face">
      <ellipse cx="88" cy="134" rx="14" ry="8.5" fill="#ff9e9e" opacity="0.4" />
      <ellipse cx="176" cy="134" rx="14" ry="8.5" fill="#ff9e9e" opacity="0.4" />

      <g class="cat__eye cat__eye--left">
        <ellipse cx="108" cy="104" rx="10" ry="12" fill="#3d2a1c" />
        <circle cx="104.6" cy="99" r="3.5" fill="#ffffff" />
        <circle cx="111.4" cy="108" r="1.8" fill="#ffffff" opacity="0.75" />
      </g>
      <g class="cat__eye cat__eye--right">
        <ellipse cx="156" cy="104" rx="10" ry="12" fill="#3d2a1c" />
        <circle cx="152.6" cy="99" r="3.5" fill="#ffffff" />
        <circle cx="159.4" cy="108" r="1.8" fill="#ffffff" opacity="0.75" />
      </g>

      <ellipse cx="132" cy="128" rx="27" ry="19" fill="#ffeed4" />
      <ellipse cx="132" cy="117" rx="9.5" ry="7" fill="#3d2a1c" />
      <path d="M132 124v4" stroke="#8a5f33" stroke-width="3.2" stroke-linecap="round" />
      <path d="M132 128c-3.6 4.6-10 4.4-13 0.6M132 128c3.6 4.6 10 4.4 13 0.6" fill="none" stroke="#8a5f33" stroke-width="3.2" stroke-linecap="round" />
      <path d="M126 134c0 11 12 11 12 0 0-2-3-3-6-3s-6 1-6 3Z" fill="#ff8f9e" />
    </g></g>`,
    earFrontLeft: `<g ><ellipse cx="70" cy="104" rx="19" ry="33" fill="#c98f4e" stroke="#8a5f33" stroke-width="7" transform="rotate(13 70 104)" /></g>`,
    earFrontRight: `<g ><ellipse cx="194" cy="104" rx="19" ry="33" fill="#c98f4e" stroke="#8a5f33" stroke-width="7" transform="rotate(-13 194 104)" /></g>`,
    spark: `<g class="cat__spark"><path d="M28 96c.9 5.4 2.7 7.2 8.1 8.1-5.4.9-7.2 2.7-8.1 8.1-.9-5.4-2.7-7.2-8.1-8.1 5.4-.9 7.2-2.7 8.1-8.1Z" fill="#ffc531" />
    <path d="M238 138c.7 4 2 5.4 6 6.1-4 .7-5.3 2-6 6.1-.7-4-2-5.4-6-6.1 4-.7 5.3-2.1 6-6.1Z" fill="#4c9aff" opacity="0.55" /></g>`,
  }),
  fox: Object.freeze({
    shadow: `<ellipse data-layer="shadow" cx="132" cy="236" rx="68" ry="11" fill="rgba(122,74,36,0.14)" />`,
    tail: `<g class="cat__tail" style="transform-origin:174px 200px"><path d="M174 200c34 12 58-2 56-30-1.5-16-12-27-24-26" fill="none" stroke="#8c4a22" stroke-width="30" stroke-linecap="round" />
    <path d="M174 200c34 12 58-2 56-30-1.5-16-12-27-24-26" fill="none" stroke="#f4914f" stroke-width="21" stroke-linecap="round" />
    <path d="M206 146c8-2 14 2 18 8" fill="none" stroke="#fff6ec" stroke-width="12" stroke-linecap="round" /></g>`,
    body: `<g ><ellipse cx="132" cy="180" rx="63" ry="53" fill="#f4914f" stroke="#8c4a22" stroke-width="7" />
    <ellipse cx="132" cy="194" rx="36" ry="32" fill="#fff6ec" />
    <path d="M96 156c2-10 10-16 19-15" fill="none" stroke="#d5722f" stroke-width="6" stroke-linecap="round" opacity="0.55" />
    <path d="M170 160c-2-9-9-14-17-14" fill="none" stroke="#d5722f" stroke-width="6" stroke-linecap="round" opacity="0.55" />
    <ellipse cx="106" cy="218" rx="20" ry="12.5" fill="#fff6ec" stroke="#8c4a22" stroke-width="6" />
    <ellipse cx="158" cy="218" rx="20" ry="12.5" fill="#fff6ec" stroke="#8c4a22" stroke-width="6" />
    <path d="M112 216v4M120 216v4M150 216v4M158 216v4" stroke="#d9a179" stroke-width="2.6" stroke-linecap="round" /></g>`,
    earLeft: `<g class="cat__ear cat__ear--left" style="transform-origin:74px 82px"><path d="M74 82 52 14l56 32Z" fill="#f4914f" stroke="#8c4a22" stroke-width="7" stroke-linejoin="round" />
    <path d="M78 74 62 32l34 22Z" fill="#fff6ec" />
    <path d="M52 14 64 34l-12 6Z" fill="#5c3a25" /></g>`,
    earRight: `<g class="cat__ear cat__ear--right" style="transform-origin:190px 82px"><path d="M190 82 212 14l-56 32Z" fill="#f4914f" stroke="#8c4a22" stroke-width="7" stroke-linejoin="round" />
    <path d="M186 74 202 32l-34 22Z" fill="#fff6ec" />
    <path d="M212 14 200 34l12 6Z" fill="#5c3a25" /></g>`,
    head: `<g class="cat__head"><ellipse cx="132" cy="104" rx="65" ry="57" fill="#f4914f" stroke="#8c4a22" stroke-width="7" />

    <g data-layer="face">
      <ellipse cx="86" cy="132" rx="14" ry="8.5" fill="#ff9e9e" opacity="0.4" />
      <ellipse cx="178" cy="132" rx="14" ry="8.5" fill="#ff9e9e" opacity="0.4" />

      <g class="cat__eye cat__eye--left">
        <ellipse cx="108" cy="106" rx="10.5" ry="12" fill="#3d2a1c" />
        <circle cx="104.5" cy="101" r="3.6" fill="#ffffff" />
        <circle cx="111.5" cy="110" r="1.9" fill="#ffffff" opacity="0.75" />
      </g>
      <g class="cat__eye cat__eye--right">
        <ellipse cx="156" cy="106" rx="10.5" ry="12" fill="#3d2a1c" />
        <circle cx="152.5" cy="101" r="3.6" fill="#ffffff" />
        <circle cx="159.5" cy="110" r="1.9" fill="#ffffff" opacity="0.75" />
      </g>

      <path d="M96 98 82 90M168 98l14-8" stroke="#5c3a25" stroke-width="4.5" stroke-linecap="round" />

      <path d="M132 108c-16 0-26 9-26 18 0 9 12 15 26 15s26-6 26-15c0-9-10-18-26-18Z" fill="#fff6ec" />
      <path d="M132 112.5 124 119h16Z" fill="#3d2a1c" stroke="#3d2a1c" stroke-width="2" stroke-linejoin="round" />
      <path d="M132 119v5" stroke="#8c4a22" stroke-width="3.2" stroke-linecap="round" />
      <path d="M132 125c-3.4 4.6-9.6 4.4-12.4 0.6M132 125c3.4 4.6 9.6 4.4 12.4 0.6" fill="none" stroke="#8c4a22" stroke-width="3.2" stroke-linecap="round" />
    </g></g>`,
    spark: `<g class="cat__spark"><path d="M28 96c.9 5.4 2.7 7.2 8.1 8.1-5.4.9-7.2 2.7-8.1 8.1-.9-5.4-2.7-7.2-8.1-8.1 5.4-.9 7.2-2.7 8.1-8.1Z" fill="#ffc531" />
    <path d="M238 138c.7 4 2 5.4 6 6.1-4 .7-5.3 2-6 6.1-.7-4-2-5.4-6-6.1 4-.7 5.3-2.1 6-6.1Z" fill="#ffc531" opacity="0.7" /></g>`,
  }),
})
