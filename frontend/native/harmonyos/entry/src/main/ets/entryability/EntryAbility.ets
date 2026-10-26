import { UIAbility, Want } from '@kit.AbilityKit';
import { window } from '@kit.ArkUI';
import { webview } from '@kit.ArkWeb';

/** Index.ets 取用：推送点击带来的来电信息，格式 "callId|caller" */
export const PUSH_CALL_KEY: string = 'omniPushCall';

export default class EntryAbility extends UIAbility {
  onForeground(): void { this.context.eventHub.emit('videoForeground'); }
  onBackground(): void { this.context.eventHub.emit('videoBackground'); }
  onCreate(want: Want): void {
    AppStorage.setOrCreate('omni.video.call', '');
    AppStorage.setOrCreate('omni.video.dismissed', '');
    webview.WebviewController.initializeWebEngine();
    this.cachePushCall(want);
  }

  /** App 已在后台时点推送走这里 */
  onNewWant(want: Want): void {
    this.cachePushCall(want);
  }

  onWindowStageCreate(windowStage: window.WindowStage): void {
    windowStage.loadContent('pages/Index', (err) => {
      if (err.code) {
        console.error(`loadContent failed: ${JSON.stringify(err)}`);
      }
    });
  }

  /**
   * 来电推送的 extraData 由后端 push.ts 下发（caller / call_id）。
   * 这里只暂存，等 WebView 起来后由 Index.ets 投给 Web，
   * 避免 Vue 还没加载就把事件丢了。
   */
  private cachePushCall(want: Want): void {
    const params = want.parameters as Record<string, Object> | undefined;
    if (params === undefined) {
      return;
    }
    const caller: string = params['caller'] === undefined ? '' : `${params['caller']}`;
    const callId: string = params['call_id'] === undefined ? '' : `${params['call_id']}`;
    if (caller.length === 0 && callId.length === 0) {
      return;
    }
    AppStorage.setOrCreate(PUSH_CALL_KEY, `${callId}|${caller}`);
  }
}
