/**
 * 避免 Chromium 报「ResizeObserver loop completed with undelivered notifications」，
 * Element Plus 等库的滚动/表格在嵌套布局下易触发，属浏览器已知行为。
 * @see https://stackoverflow.com/questions/49384120/resizeobserver-loop-completed-with-undelivered-notifications
 */
export function patchResizeObserverForStableLayout() {
  if (typeof window === 'undefined' || !window.ResizeObserver) return
  const Original = window.ResizeObserver
  window.ResizeObserver = class extends Original {
    constructor(callback: ResizeObserverCallback) {
      super((entries, observer) => {
        requestAnimationFrame(() => {
          try {
            callback(entries, observer)
          } catch (err) {
            // 延迟到下一帧后，部分组件（如 el-select 的 resetSelectionWidth）可能已卸载，
            // 内部仍对 null/非 Element 调用 getComputedStyle，需吞掉避免整页报错。
            if (
              err instanceof TypeError &&
              typeof (err as Error).message === 'string' &&
              ((err as Error).message.includes('getComputedStyle') ||
                (err as Error).message.includes('is not of type') ||
                (err as Error).message.includes('Element'))
            ) {
              return
            }
            throw err
          }
        })
      })
    }
  } as typeof ResizeObserver
}

patchResizeObserverForStableLayout()
