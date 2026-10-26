/** 坐席会话线程里的一条消息（气泡组件与会话页共用） */
export interface ThreadMsg {
  id: string
  from: 'customer' | 'agent'
  kind: 'text' | 'bot' | 'video' | 'image' | 'voice' | 'file' | 'red_packet' | 'shake' | 'news' | 'sms' | 'tts' | 'weibo'
  text?: string
  lines?: string[]
  time: string
  day: string
  file_url?: string
  file_name?: string
  byte_size?: number
  content_type?: string
  red_packet_title?: string
  red_packet_amount?: string | number
  articles?: Array<{ title?: string; description?: string; picUrl?: string; url?: string }>
  /** 后端下发的原始消息元数据；短信触达为 kind='sms_outbound' + template_name/status/to */
  content_attributes?: Record<string, unknown>
}
