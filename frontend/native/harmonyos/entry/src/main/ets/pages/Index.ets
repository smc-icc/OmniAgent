import { webview } from '@kit.ArkWeb';
import { common } from '@kit.AbilityKit';
import { OmniBridge } from '../bridge/OmniBridge';
import { PUSH_CALL_KEY } from '../entryability/EntryAbility';
import { VideoCall } from '../components/VideoCall';
import { util } from '@kit.ArkTS';
import { OFFLINE_ORIGIN, HARMONY_BOOTSTRAP, resolveOfflineAsset, prepareOfflineHtml } from '../bridge/OfflineWeb';

@Entry
@Component
struct Index {
  @StorageLink('omni.video.call') videoCallId: string = '';
  @State loadError: string = '';
  controller: webview.WebviewController = new webview.WebviewController();
  private bridge: OmniBridge | null = null;

  aboutToAppear(): void {
    webview.WebviewController.setWebDebuggingAccess(true);
    const context = this.getUIContext().getHostContext() as common.UIAbilityContext;
    this.bridge = new OmniBridge(this.controller, context);
  }

  private offlineResponse(event: OnInterceptRequestEvent): WebResourceResponse | null {
    const asset = resolveOfflineAsset(event.request.getRequestUrl(), event.request.isMainFrame());
    if (asset === null) return null;
    const response = new WebResourceResponse();
    response.setResponseMimeType(asset.mimeType);
    response.setResponseEncoding('utf-8');
    response.setResponseHeader([{ headerKey: 'Cache-Control', headerValue: 'no-cache' }]);
    try {
      const context = this.getUIContext().getHostContext() as common.UIAbilityContext;
      const bytes = context.resourceManager.getRawFileContentSync(asset.path);
      if (asset.mimeType === 'text/html') {
        response.setResponseData(prepareOfflineHtml(util.TextDecoder.create('utf-8').decodeToString(bytes)));
      } else {
        response.setResponseData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
      }
      response.setResponseCode(200);
      response.setReasonMessage('OK');
    } catch (error) {
      console.error(`[omni-web] packaged resource missing: ${asset.path}`);
      response.setResponseCode(404);
      response.setReasonMessage('Not Found');
      response.setResponseData('Not Found');
    }
    return response;
  }

  aboutToDisappear(): void {
    // 页面销毁前把长时任务收掉，否则会被系统判为异常占用
    this.bridge?.keepAlive(false);
  }

  /** 页面加载完再投推送来电，早于 Vue 就绪会把事件丢掉 */
  private deliverPushCall(): void {
    const cached: string | undefined = AppStorage.get(PUSH_CALL_KEY);
    if (cached === undefined || cached.length === 0) {
      return;
    }
    AppStorage.setOrCreate(PUSH_CALL_KEY, '');
    const parts: string[] = cached.split('|');
    this.bridge?.notifyIncomingFromPush(parts.length > 1 ? parts[1] : '', parts[0]);
  }

  build() {
    Stack() {
      Web({
        src: `${OFFLINE_ORIGIN}/`,
        controller: this.controller
      })
        .javaScriptAccess(true)
        .domStorageAccess(true)
        .fileAccess(true)
        .imageAccess(true)
        .onlineImageAccess(true)
        .javaScriptOnDocumentStart([{ script: HARMONY_BOOTSTRAP, scriptRules: [OFFLINE_ORIGIN] }])
        // ArkWeb accepts null to let network requests through; the SDK type omits it.
        .onInterceptRequest((event) => this.offlineResponse(event) as WebResourceResponse)
        .onLoadIntercept((event) => {
          return event.data.isMainFrame() && resolveOfflineAsset(event.data.getRequestUrl(), true) === null;
        })
        .onErrorReceive((event) => {
          if (event.request.isMainFrame()) this.loadError = event.error.getErrorInfo();
        })
        // 麦克风权限：通话必须，首次会弹系统授权
        .onPermissionRequest((event) => {
          event?.request.grant(event.request.getAccessibleResource());
        })
        .javaScriptProxy({
          object: this.bridge,
          name: 'OmniHarmonyNative',
          methodList: OmniBridge.methodList(),
          controller: this.controller,
        })
        .width('100%')
        .height('100%')
        .onPageEnd(() => {
          this.deliverPushCall();
        })
      if (this.loadError.length > 0) {
        Column({ space: 12 }) {
          Text('页面加载失败').fontSize(18)
          Text(this.loadError).fontSize(13)
          Button('重试').onClick(() => { this.loadError = ''; this.controller.loadUrl(`${OFFLINE_ORIGIN}/`); })
        }.padding(24).width('100%').backgroundColor(Color.White)
      }
      if (this.videoCallId.length > 0) {
        VideoCall({ callId: this.videoCallId })
      }
    }
    .width('100%')
    .height('100%')
  }
}
