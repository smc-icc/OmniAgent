import AVFoundation
import Foundation

/**
 * iOS 的音频路由。
 *
 * 与 Android 不同，iOS 只能「建议」路由：听筒/免提用 overrideOutputAudioPort，
 * 蓝牙与有线耳机由系统按插入状态自动选择，App 不能强抢。
 * 所以 setAudioRoute('bluetooth') 在 iOS 上等价于「允许蓝牙」，实际是否走蓝牙看系统。
 */
enum AudioRouter {

    static func configureForCall() throws {
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(
            .playAndRecord,
            mode: .voiceChat,
            options: [.allowBluetooth, .allowBluetoothA2DP]
        )
        // 8k/16k 窄带语音，缓冲给小一点降低单向延迟
        try session.setPreferredIOBufferDuration(0.02)
        try session.setActive(true)
    }

    static func apply(_ route: String) throws {
        let session = AVAudioSession.sharedInstance()
        switch route {
        case "speaker":
            try session.overrideOutputAudioPort(.speaker)
        default:
            // earpiece / bluetooth / wired 都交回系统默认选路
            try session.overrideOutputAudioPort(.none)
        }
    }

    static func currentRoute() -> String {
        let outputs = AVAudioSession.sharedInstance().currentRoute.outputs
        guard let port = outputs.first?.portType else { return "earpiece" }
        switch port {
        case .builtInSpeaker:
            return "speaker"
        case .bluetoothHFP, .bluetoothA2DP, .bluetoothLE:
            return "bluetooth"
        case .headphones, .usbAudio:
            return "wired"
        default:
            return "earpiece"
        }
    }
}
