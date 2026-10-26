import { ref, type Ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import html2canvas from 'html2canvas'
import Tesseract from 'tesseract.js'
import { useChatMedia } from '@/composables/useChatMedia'
import { translateText } from '@/api/translate'
import { HIDE_WINDOW_STORAGE_KEY } from '@/components/chat/screenshot-context'

function readHideWindowPref(): boolean {
  try {
    return localStorage.getItem(HIDE_WINDOW_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function persistHideWindowPref(value: boolean) {
  try {
    localStorage.setItem(HIDE_WINDOW_STORAGE_KEY, value ? '1' : '0')
  } catch {
    /* ignore */
  }
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('导出图片失败'))
    }, 'image/png')
  })
}

async function withHiddenPanel<T>(
  hideWindow: boolean,
  hideTarget: HTMLElement | null | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  if (!hideWindow || !hideTarget) return fn()
  const prev = hideTarget.style.visibility
  hideTarget.style.visibility = 'hidden'
  await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
  try {
    return await fn()
  } finally {
    hideTarget.style.visibility = prev
  }
}

async function captureDisplayFrame(): Promise<Blob> {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    throw new Error('当前浏览器不支持屏幕捕获')
  }
  let stream: MediaStream | null = null
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: false,
    })
    const video = document.createElement('video')
    video.srcObject = stream
    await video.play()
    await new Promise((r) => setTimeout(r, 200))
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth || 1280
    canvas.height = video.videoHeight || 720
    const ctx = canvas.getContext('2d')
    ctx?.drawImage(video, 0, 0)
    return await canvasToBlob(canvas)
  } finally {
    stream?.getTracks().forEach((t) => t.stop())
  }
}

function pickCropRegion(imageBlob: Blob): Promise<Blob | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(imageBlob)
    const overlay = document.createElement('div')
    overlay.style.cssText =
      'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.45);cursor:crosshair;'
    const img = document.createElement('img')
    img.src = url
    img.style.cssText = 'max-width:100%;max-height:100%;display:block;margin:auto;'
    const box = document.createElement('div')
    box.style.cssText =
      'position:absolute;border:2px solid #409eff;background:rgba(64,158,255,.15);pointer-events:none;display:none;'
    const hint = document.createElement('div')
    hint.textContent = '拖动框选区域，Enter 确认，Esc 取消'
    hint.style.cssText =
      'position:fixed;top:12px;left:50%;transform:translateX(-50%);color:#fff;font-size:14px;z-index:10000;'
    overlay.appendChild(img)
    overlay.appendChild(box)
    overlay.appendChild(hint)
    document.body.appendChild(overlay)

    let startX = 0
    let startY = 0
    let dragging = false

    const cleanup = () => {
      URL.revokeObjectURL(url)
      overlay.remove()
      document.removeEventListener('keydown', onKey)
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        cleanup()
        resolve(null)
      }
      if (e.key === 'Enter' && box.style.display !== 'none') {
        const rect = box.getBoundingClientRect()
        const imgRect = img.getBoundingClientRect()
        const scaleX = img.naturalWidth / imgRect.width
        const scaleY = img.naturalHeight / imgRect.height
        const sx = (rect.left - imgRect.left) * scaleX
        const sy = (rect.top - imgRect.top) * scaleY
        const sw = rect.width * scaleX
        const sh = rect.height * scaleY
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(sw))
        canvas.height = Math.max(1, Math.round(sh))
        const ctx = canvas.getContext('2d')
        const temp = new Image()
        temp.onload = () => {
          ctx?.drawImage(temp, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height)
          canvasToBlob(canvas).then((b) => {
            cleanup()
            resolve(b)
          })
        }
        temp.src = url
      }
    }

    overlay.addEventListener('mousedown', (e) => {
      dragging = true
      startX = e.clientX
      startY = e.clientY
      box.style.display = 'block'
      box.style.left = `${startX}px`
      box.style.top = `${startY}px`
      box.style.width = '0'
      box.style.height = '0'
    })
    overlay.addEventListener('mousemove', (e) => {
      if (!dragging) return
      const x = Math.min(startX, e.clientX)
      const y = Math.min(startY, e.clientY)
      const w = Math.abs(e.clientX - startX)
      const h = Math.abs(e.clientY - startY)
      box.style.left = `${x}px`
      box.style.top = `${y}px`
      box.style.width = `${w}px`
      box.style.height = `${h}px`
    })
    overlay.addEventListener('mouseup', () => {
      dragging = false
    })

    document.addEventListener('keydown', onKey)
    img.onload = () => {
      img.style.marginTop = `${Math.max(0, (window.innerHeight - img.clientHeight) / 2)}px`
    }
  })
}

let ocrWorker: Tesseract.Worker | null = null

async function getOcrWorker() {
  if (!ocrWorker) {
    ocrWorker = await Tesseract.createWorker('chi_sim+eng')
  }
  return ocrWorker
}

async function ocrFromBlob(blob: Blob): Promise<string> {
  const worker = await getOcrWorker()
  const { data } = await worker.recognize(blob)
  return (data.text || '').trim()
}

export function useScreenshotCapture(options: {
  conversationId: Ref<number | null>
  hideTarget: Ref<HTMLElement | null | undefined>
  longTarget: Ref<HTMLElement | null | undefined>
  onSent?: () => void
  onFillDraft?: (text: string) => void
}) {
  const { sendImage, sendFileAttachment } = useChatMedia()
  const hideWindow = ref(readHideWindowPref())
  const recording = ref(false)

  let mediaRecorder: MediaRecorder | null = null
  let recordChunks: Blob[] = []
  let recordStream: MediaStream | null = null

  function setHideWindow(v: boolean) {
    hideWindow.value = v
    persistHideWindowPref(v)
  }

  async function captureScreenshot() {
    const convId = options.conversationId.value
    if (!convId) return
    try {
      const raw = await withHiddenPanel(
        hideWindow.value,
        options.hideTarget.value ?? null,
        captureDisplayFrame,
      )
      const cropped = await pickCropRegion(raw)
      const finalBlob = cropped ?? raw
      const file = new File([finalBlob], `screenshot-${Date.now()}.png`, { type: 'image/png' })
      await sendImage(convId, file)
      ElMessage.success('截图已发送')
      options.onSent?.()
    } catch (err) {
      if ((err as DOMException)?.name !== 'NotAllowedError') {
        ElMessage.warning((err as Error).message || '截图已取消或失败')
      }
    }
  }

  async function startScreenRecord() {
    const convId = options.conversationId.value
    if (!convId || recording.value) return
    if (!navigator.mediaDevices?.getDisplayMedia) {
      ElMessage.warning('当前浏览器不支持录屏')
      return
    }
    try {
      recordStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      })
      recordChunks = []
      mediaRecorder = new MediaRecorder(recordStream, {
        mimeType: MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
          ? 'video/webm;codecs=vp9'
          : 'video/webm',
      })
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordChunks.push(e.data)
      }
      mediaRecorder.onstop = async () => {
        recording.value = false
        recordStream?.getTracks().forEach((t) => t.stop())
        recordStream = null
        const blob = new Blob(recordChunks, { type: 'video/webm' })
        if (blob.size < 1) return
        const file = new File([blob], `screen-record-${Date.now()}.webm`, { type: 'video/webm' })
        try {
          await sendFileAttachment(convId, file)
          ElMessage.success('录屏已发送')
          options.onSent?.()
        } catch {
          ElMessage.error('录屏上传失败')
        }
      }
      recordStream.getVideoTracks()[0]?.addEventListener('ended', () => {
        if (mediaRecorder?.state === 'recording') mediaRecorder.stop()
      })
      mediaRecorder.start(500)
      recording.value = true
    } catch (err) {
      if ((err as DOMException)?.name !== 'NotAllowedError') {
        ElMessage.warning('录屏已取消或失败')
      }
    }
  }

  function stopScreenRecord() {
    if (mediaRecorder?.state === 'recording') {
      mediaRecorder.stop()
    }
  }

  async function captureLongScreenshot() {
    const convId = options.conversationId.value
    const el = options.longTarget.value
    if (!convId) return
    if (!el) {
      ElMessage.warning('未找到聊天消息区域')
      return
    }
    const loading = ElMessage.info({ message: '正在生成长截图…', duration: 0 })
    try {
      const blob = await stitchScrollCapture(el)
      const file = new File([blob], `long-screenshot-${Date.now()}.png`, { type: 'image/png' })
      await sendImage(convId, file)
      ElMessage.success('长截图已发送')
      options.onSent?.()
    } catch (err) {
      ElMessage.error((err as Error).message || '长截图失败')
    } finally {
      loading.close()
    }
  }

  async function extractText() {
    try {
      const raw = await withHiddenPanel(
        hideWindow.value,
        options.hideTarget.value ?? null,
        captureDisplayFrame,
      )
      const cropped = await pickCropRegion(raw)
      const blob = cropped ?? raw
      const loading = ElMessage.info({ message: '正在识别文字…', duration: 0 })
      let text = ''
      try {
        text = await ocrFromBlob(blob)
      } finally {
        loading.close()
      }
      if (!text) {
        ElMessage.warning('未识别到文字')
        return
      }
      await showTextResult('提取文字', text)
    } catch (err) {
      if ((err as DOMException)?.name !== 'NotAllowedError') {
        ElMessage.warning((err as Error).message || '提取文字失败')
      }
    }
  }

  async function screenTranslate() {
    try {
      const raw = await withHiddenPanel(
        hideWindow.value,
        options.hideTarget.value ?? null,
        captureDisplayFrame,
      )
      const cropped = await pickCropRegion(raw)
      const blob = cropped ?? raw
      const loading = ElMessage.info({ message: '正在识别并翻译…', duration: 0 })
      let original = ''
      try {
        original = await ocrFromBlob(blob)
      } finally {
        loading.close()
      }
      if (!original) {
        ElMessage.warning('未识别到可翻译的文字')
        return
      }
      const result = await translateText(original, 'zh')
      const translated = result.translated ? result.text : original
      const body = `原文：\n${original}\n\n译文：\n${translated}`
      await showTextResult('屏幕翻译', body, translated)
    } catch (err) {
      if ((err as DOMException)?.name !== 'NotAllowedError') {
        ElMessage.warning((err as Error).message || '屏幕翻译失败')
      }
    }
  }

  async function showTextResult(title: string, fullText: string, fillText?: string) {
    try {
      await ElMessageBox.confirm(fullText, title, {
        confirmButtonText: '填入输入框',
        cancelButtonText: '复制',
        distinguishCancelAndClose: true,
        customClass: 'screenshot-text-result-box',
      })
      options.onFillDraft?.(fillText ?? fullText)
    } catch (action) {
      if (action === 'cancel') {
        await navigator.clipboard.writeText(fullText)
        ElMessage.success('已复制到剪贴板')
      }
    }
  }

  return {
    hideWindow,
    recording,
    setHideWindow,
    captureScreenshot,
    startScreenRecord,
    stopScreenRecord,
    captureLongScreenshot,
    extractText,
    screenTranslate,
  }
}

async function stitchScrollCapture(el: HTMLElement): Promise<Blob> {
  const originalScroll = el.scrollTop
  const totalHeight = el.scrollHeight
  const viewHeight = el.clientWidth > 0 ? el.clientHeight : 400
  const width = el.clientWidth

  if (totalHeight <= viewHeight + 2) {
    const canvas = await html2canvas(el, {
      useCORS: true,
      scale: window.devicePixelRatio || 1,
      scrollY: -el.scrollTop,
    })
    return canvasToBlob(canvas)
  }

  const canvas = document.createElement('canvas')
  const scale = window.devicePixelRatio || 1
  canvas.width = Math.round(width * scale)
  canvas.height = Math.round(totalHeight * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建画布')

  let offsetY = 0
  while (offsetY < totalHeight) {
    el.scrollTop = offsetY
    await new Promise((r) => setTimeout(r, 80))
    const sliceHeight = Math.min(viewHeight, totalHeight - offsetY)
    const frame = await html2canvas(el, {
      useCORS: true,
      scale,
      height: sliceHeight,
      width,
      scrollY: -el.scrollTop,
      windowHeight: viewHeight,
    })
    ctx.drawImage(
      frame,
      0,
      0,
      frame.width,
      frame.height,
      0,
      Math.round(offsetY * scale),
      frame.width,
      frame.height,
    )
    offsetY += sliceHeight
  }

  el.scrollTop = originalScroll
  return canvasToBlob(canvas)
}
