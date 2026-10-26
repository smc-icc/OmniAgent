import { ElMessage } from 'element-plus'
import { isAxiosError } from 'axios'
import { api } from '@/api/client'

const MAX_BYTES = 20 * 1024 * 1024

export interface UploadResult {
  file_url: string
  content_type: string
  byte_size: number
}

export interface RichMessagePayload {
  kind: 'image' | 'file' | 'red_packet' | 'shake'
  file_url?: string
  file_name?: string
  content_type?: string
  byte_size?: number
  title?: string
  amount?: string | number
}

export function useChatMedia() {
  async function uploadFile(file: File): Promise<UploadResult> {
    if (file.size > MAX_BYTES) {
      throw new Error('文件不能超过 20MB')
    }
    const fd = new FormData()
    fd.append('file', file)
    try {
      const { data } = await api.post<UploadResult>('/api/v1/accounts/1/upload', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      return data
    } catch (err) {
      if (isAxiosError(err)) {
        const status = err.response?.status
        if (status === 401) {
          throw new Error('请先登录后再上传文件')
        }
        const body = err.response?.data as { error?: string; message?: string } | undefined
        const detail = body?.message || body?.error
        if (detail) {
          throw new Error(detail)
        }
      }
      throw new Error('文件上传失败，请确认后端服务已启动且文件服务可用')
    }
  }

  async function sendRichMessage(convId: number, content: string, attrs: Record<string, unknown>) {
    await api.post(`/api/v1/accounts/1/conversations/${convId}/messages`, {
      content,
      message_type: 'outgoing',
      private: false,
      content_attributes: attrs,
    })
  }

  async function sendImage(convId: number, file: File) {
    const uploaded = await uploadFile(file)
    await sendRichMessage(convId, '[图片]', {
      kind: 'image',
      file_url: uploaded.file_url,
      file_name: file.name,
      content_type: uploaded.content_type,
      byte_size: uploaded.byte_size,
    })
  }

  async function sendFileAttachment(convId: number, file: File) {
    const uploaded = await uploadFile(file)
    await sendRichMessage(convId, `[文件] ${file.name}`, {
      kind: 'file',
      file_url: uploaded.file_url,
      file_name: file.name,
      content_type: uploaded.content_type,
      byte_size: uploaded.byte_size,
    })
  }

  async function sendRedPacket(convId: number, title: string, amount?: string | number) {
    await sendRichMessage(convId, '[红包]', {
      kind: 'red_packet',
      title,
      amount: amount ?? '',
      status: 'pending',
    })
  }

  function extractPasteImageFile(e: ClipboardEvent): File | null {
    const items = e.clipboardData?.items
    if (!items) return null
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile()
        if (file) return file
      }
    }
    return null
  }

  async function onPasteImage(convId: number, e: ClipboardEvent) {
    const file = extractPasteImageFile(e)
    if (!file) return false
    e.preventDefault()
    await sendImage(convId, file)
    ElMessage.success('图片已发送')
    return true
  }

  return {
    uploadFile,
    sendRichMessage,
    sendImage,
    sendFileAttachment,
    sendRedPacket,
    extractPasteImageFile,
    onPasteImage,
  }
}
