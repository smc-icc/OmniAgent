import { api } from '@/api/client'

export interface TranslateTextResult {
  text: string
  translated: boolean
  target_language?: string
  message?: string
}

export async function translateText(
  text: string,
  targetLanguage = 'zh',
): Promise<TranslateTextResult> {
  const { data } = await api.post<TranslateTextResult>(
    '/api/v1/accounts/1/translate-text',
    { text, target_language: targetLanguage },
  )
  return data
}
