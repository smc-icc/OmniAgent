#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/**
 * PJSIP（pjsua2，C++）的 Objective-C 门面。
 *
 * Swift 不能直接用 pjsua2 的 C++ 接口，所以这一层用 .mm 把 C++ 包起来，
 * 只暴露 NSDictionary / NSString。字段名与 src/services/sip/SipEngine.ts 完全一致，
 * Swift 侧不做任何字段改名，避免三端协议漂移。
 */

/** 与 SipRegistrationState 对应：unregistered / registering / registered / failed */
typedef NSString *OmniSipRegState NS_TYPED_ENUM;

@protocol OmniSipCoreDelegate <NSObject>
- (void)sipRegistrationChanged:(NSString *)state code:(int)code reason:(NSString *)reason registrationId:(NSString *)registrationId;
/** call 字典即 SipCall：callId / sipCallId / remoteNumber / remoteDisplayName / direction / state / connectedAt */
- (void)sipIncomingCall:(NSDictionary *)call;
- (void)sipCallStateChanged:(NSDictionary *)call;
- (void)sipMediaStateChanged:(NSDictionary *)info;
- (void)sipQualityChanged:(NSDictionary *)info;
- (void)sipError:(NSString *)code message:(NSString *)message callId:(nullable NSString *)callId;
@end

@interface OmniSipCore : NSObject

@property (class, nonatomic, readonly) OmniSipCore *shared;
@property (nonatomic, weak, nullable) id<OmniSipCoreDelegate> delegate;
@property (nonatomic, readonly) NSString *registrationState;
@property (nonatomic, readonly) BOOL muted;

/** cfg 的键与 SipConfig 一致（username/password/realm/proxyHost/proxyPort/transport/srtp/codecs/...） */
- (BOOL)registerWithConfig:(NSDictionary *)cfg error:(NSError **)error;
- (void)unregisterAccount;
- (BOOL)unregisterRegistration:(NSString *)registrationId error:(NSError **)error;
/** 进程退出前释放 pjsua2；CallKit 生命周期之外调用 */
- (void)shutdown;

- (nullable NSDictionary *)makeCall:(NSString *)number error:(NSError **)error;
- (BOOL)answerCall:(NSString *)callId error:(NSError **)error;
- (BOOL)hangupCall:(NSString *)callId error:(NSError **)error;
- (BOOL)holdCall:(NSString *)callId on:(BOOL)on error:(NSError **)error;
- (BOOL)setMuted:(BOOL)on error:(NSError **)error;
- (BOOL)sendDtmf:(NSString *)digits callId:(nullable NSString *)callId error:(NSError **)error;
- (NSArray<NSDictionary *> *)activeCalls;

/**
 * CallKit 接管音频会话后必须通知 pjsua2 重新挂上音频设备，
 * 否则 iOS 下会出现「通话建立但双向无声」。
 */
- (void)audioSessionActivated:(BOOL)activated;

/** 收到 VoIP push 后先把注册续上，再等 INVITE */
- (BOOL)reRegisterIfPossible;
- (BOOL)hasCredentials;

@end

NS_ASSUME_NONNULL_END
