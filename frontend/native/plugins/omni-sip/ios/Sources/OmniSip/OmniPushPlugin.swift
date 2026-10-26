import Capacitor
import Foundation
import PushKit

/**
 * OmniPush 的 iOS 实现：PushKit VoIP push。
 *
 * 与 Android 的关键差别：收到 VoIP push 必须在本次回调内**立刻** report 一通来电，
 * 否则 iOS 会先警告、再吊销 App 的 VoIP push 能力。所以这里不等 SIP INVITE，
 * 直接用推送里的 call_id 占位报给 CallKit，等真正的 INVITE 到达后再 rebind。
 */
@objc(OmniPushPlugin)
public class OmniPushPlugin: CAPPlugin, CAPBridgedPlugin {

    public let identifier = "OmniPushPlugin"
    public let jsName = "OmniPush"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getToken", returnType: CAPPluginReturnPromise),
    ]

    private var registry: PKPushRegistry?
    private var token: String = ""
    private var pendingTokenCall: CAPPluginCall?

    override public func load() {
        VoipPushCenter.shared.plugin = self
        let registry = PKPushRegistry(queue: .main)
        registry.delegate = VoipPushCenter.shared
        registry.desiredPushTypes = [.voIP]
        self.registry = registry
    }

    @objc func getToken(_ call: CAPPluginCall) {
        let current = VoipPushCenter.shared.token
        if current.isEmpty {
            // token 还没下来：挂起，等 didUpdate 回调
            pendingTokenCall = call
            call.keepAlive = true
            return
        }
        call.resolve(payload(current))
    }

    func onToken(_ value: String) {
        token = value
        if let pending = pendingTokenCall {
            pendingTokenCall = nil
            pending.resolve(payload(value))
            return
        }
        notifyListeners("tokenRefreshed", data: payload(value))
    }

    private func payload(_ token: String) -> [String: Any] {
        // iOS 走 PushKit VoIP 通道，后端据此选择 apns-push-type=voip
        ["token": token, "provider": "apns", "voip": true]
    }
}

/**
 * PushKit 的 delegate 必须在 App 存活期内一直有人持有，
 * 而插件实例可能随 WebView 重建，所以单独放一个常驻单例。
 */
final class VoipPushCenter: NSObject, PKPushRegistryDelegate {

    static let shared = VoipPushCenter()

    weak var plugin: OmniPushPlugin?
    /** CallKit 需要在 push 回调内同步使用 */
    var callKit: CallKitManager?
    private(set) var token: String = ""

    func pushRegistry(_ registry: PKPushRegistry, didUpdate pushCredentials: PKPushCredentials, for type: PKPushType) {
        token = pushCredentials.token.map { String(format: "%02x", $0) }.joined()
        plugin?.onToken(token)
    }

    func pushRegistry(_ registry: PKPushRegistry, didInvalidatePushTokenFor type: PKPushType) {
        token = ""
    }

    func pushRegistry(
        _ registry: PKPushRegistry,
        didReceiveIncomingPushWith payload: PKPushPayload,
        for type: PKPushType,
        completion: @escaping () -> Void
    ) {
        let data = payload.dictionaryPayload
        let caller = data["caller"] as? String ?? ""
        let callId = data["call_id"].map { String(describing: $0) } ?? ""

        // 必须同步 report，不能等注册或 INVITE
        callKit?.reportIncoming(callId: callId, handle: caller, placeholder: true)
        // 再补注册，等 INVITE 过来后由 rebind 把两通合成一通
        _ = OmniSipCore.shared.reRegisterIfPossible()
        completion()
    }
}
