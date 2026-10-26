# PJSIP 编译产物目录

这里的内容由 `scripts/build-pjsip-android.sh` 生成，**不要手工编辑、不要提交到仓库**：

```
android/src/pjsua2/jniLibs/arm64-v8a/libpjsua2.so
android/src/pjsua2/jniLibs/armeabi-v7a/libpjsua2.so
android/src/pjsua2/java/org/pjsip/pjsua2/*.java
```

`android/build.gradle` 已把这两个目录挂进 `sourceSets`，所以产物一旦就位，
Gradle 直接就能编译；产物缺失时插件模块会因为找不到 `org.pjsip.pjsua2` 而编译失败，
这是预期行为——先跑编译脚本。

体积参考（release、去符号后）：单 ABI 约 4–6 MB。
