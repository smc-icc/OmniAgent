# pjsua2 的 Java 绑定全部通过 JNI 反向调用，混淆会直接崩在 native 回调上
-keep class org.pjsip.** { *; }
-keepclasseswithmembernames class * {
    native <methods>;
}
# Capacitor 通过反射找插件方法
-keep class com.smcloud.omnisip.** { *; }
