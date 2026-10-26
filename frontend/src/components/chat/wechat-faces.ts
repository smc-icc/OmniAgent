/**
 * 微信/企微表情 ↔ 原版表情图 ↔ emoji 的对照。
 *
 * 背景：微信/QQ 的表情在协议里就是一段文本（`[发呆]`），客户端再渲染成自家图集。
 * 这个图集是**独立的一套**，和 Unicode emoji 不是同一个东西：
 *   - 收到：客户发 `[发呆]`，要渲染成微信那张原版图（而不是用 emoji 近似）
 *   - 发送：坐席选表情，要发 `[发呆]` 文本，微信才会渲染成表情图
 *
 * 图集来自微信官方 CDN（已实测可用，索引 0–104）：
 *   https://res.wx.qq.com/mpres/htmledition/images/icon/emotion/{idx}.gif
 *
 * ⚠️ idx 是**逐格比对官方图集**得到的，不是照抄网上流传的列表 ——
 * 两者并不一致（例：图集 61=猪头、62=玫瑰）。改动前请先核对图片。
 * 这里只收录高频表情；未命中的 `[xxx]` 一律原样保留，不会误伤普通方括号文本。
 */
export interface WechatFace {
  /** 微信表情名（占位符里就是它，如 `[发呆]` 里的「发呆」） */
  name: string
  /** 官方图集索引 */
  idx: number
  /** 对应的 Unicode emoji（每个都唯一，供发送侧反向转换、无歧义） */
  emoji: string
}

export const WECHAT_FACES: WechatFace[] = [
  { name: '微笑', idx: 0, emoji: '🙂' },
  { name: '色', idx: 2, emoji: '😍' },
  { name: '发呆', idx: 3, emoji: '😳' },
  { name: '得意', idx: 4, emoji: '😎' },
  { name: '流泪', idx: 5, emoji: '😭' },
  { name: '害羞', idx: 6, emoji: '😊' },
  { name: '睡', idx: 8, emoji: '😴' },
  { name: '大哭', idx: 9, emoji: '😩' },
  { name: '发怒', idx: 11, emoji: '😡' },
  { name: '调皮', idx: 12, emoji: '😜' },
  { name: '呲牙', idx: 13, emoji: '😁' },
  { name: '惊讶', idx: 14, emoji: '😲' },
  { name: '难过', idx: 15, emoji: '😔' },
  { name: '冷汗', idx: 17, emoji: '😰' },
  { name: '抓狂', idx: 18, emoji: '😫' },
  { name: '偷笑', idx: 20, emoji: '🤭' },
  { name: '可爱', idx: 21, emoji: '🥰' },
  { name: '鼓掌', idx: 41, emoji: '👏' },
  { name: '亲亲', idx: 51, emoji: '😘' },
  { name: '西瓜', idx: 55, emoji: '🍉' },
  { name: '啤酒', idx: 56, emoji: '🍺' },
  { name: '篮球', idx: 57, emoji: '🏀' },
  { name: '猪头', idx: 61, emoji: '🐷' },
  { name: '玫瑰', idx: 62, emoji: '🌹' },
  { name: '爱心', idx: 65, emoji: '❤️' },
  { name: '蛋糕', idx: 67, emoji: '🎂' },
  { name: '闪电', idx: 68, emoji: '⚡' },
  { name: '便便', idx: 73, emoji: '💩' },
  { name: '礼物', idx: 77, emoji: '🎁' },
  { name: '拥抱', idx: 78, emoji: '🤗' },
  { name: '强', idx: 79, emoji: '👍' },
  { name: '弱', idx: 80, emoji: '👎' },
  { name: '握手', idx: 81, emoji: '🤝' },
  { name: '胜利', idx: 82, emoji: '✌️' },
  { name: '抱拳', idx: 83, emoji: '🙏' },
]

const WECHAT_FACE_CDN = 'https://res.wx.qq.com/mpres/htmledition/images/icon/emotion'

/** 官方图集里某索引的表情图地址。 */
export function wechatFaceUrl(idx: number): string {
  return `${WECHAT_FACE_CDN}/${idx}.gif`
}

const NAME_TO_IDX = new Map(WECHAT_FACES.map((f) => [f.name, f.idx]))

/** 匹配 `[发呆]` 这类微信表情占位符（名字不含方括号，1–8 个字符）。 */
const FACE_RE = /\[([^[\]]{1,8})\]/g

/**
 * 把文本里的微信表情占位符换成**官方表情图**。
 *
 * 产出的是 HTML（`<img>`），所以必须**在 escapeHtml 之后**调用，
 * 否则转义会把标签吃掉。未收录的名字原样保留。
 */
export function replaceWechatFacesWithImg(text: string): string {
  return text.replace(FACE_RE, (whole, name: string) => {
    const idx = NAME_TO_IDX.get(name)
    if (idx == null) return whole
    return `<img class="wx-face" src="${wechatFaceUrl(idx)}" alt="[${name}]" />`
  })
}

/**
 * 把 emoji 换成微信表情占位符（发给微信系渠道时用）。
 *
 * 只有微信系渠道才该调用 —— 其它渠道（Web Widget、短信等）没有表情图集，
 * 发 `[发呆]` 只会让对方看到一串方括号文字。
 */
export function emojiToWechatFace(text: string): string {
  let out = text
  for (const f of WECHAT_FACES) {
    if (out.includes(f.emoji)) out = out.split(f.emoji).join(`[${f.name}]`)
  }
  return out
}
