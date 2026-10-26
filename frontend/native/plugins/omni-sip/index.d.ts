/**
 * 插件方法与事件的权威定义在 src/services/sip/SipEngine.ts，
 * 这里只给出插件对象的形状，避免两处类型重复维护。
 */
export declare const OmniSip: Record<string, (...args: unknown[]) => Promise<unknown>>
export declare const OmniPush: Record<string, (...args: unknown[]) => Promise<unknown>>
