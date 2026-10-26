require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name = 'OmniagentOmniSip'
  s.version = package['version']
  s.summary = package['description']
  s.license = 'Proprietary'
  s.homepage = 'https://github.com/smcloud/smc-icc'
  s.author = 'SM Cloud'
  s.source = { :git => '.', :tag => s.version.to_s }
  s.ios.deployment_target = '14.0'
  s.dependency 'Capacitor'
  s.swift_version = '5.9'

  s.source_files = 'ios/Sources/**/*.{swift,h,m,mm}'
  s.public_header_files = 'ios/Sources/OmniSipCore/include/*.h'

  # scripts/build-pjsip-ios.sh 的产物，未编译时 pod install 会直接报错——这是预期行为
  s.vendored_frameworks = 'ios/Frameworks/pjsua2.xcframework'
  s.libraries = 'c++', 'resolv'
  s.frameworks = 'AVFoundation', 'AudioToolbox', 'CallKit', 'PushKit', 'Network'

  s.pod_target_xcconfig = {
    'CLANG_CXX_LANGUAGE_STANDARD' => 'c++17',
    'CLANG_CXX_LIBRARY' => 'libc++',
    # pjsua2 的头文件走 xcframework 内的 Headers 目录
    'HEADER_SEARCH_PATHS' => '"${PODS_TARGET_SRCROOT}/ios/Frameworks/pjsua2.xcframework/ios-arm64/pjsua2.framework/Headers"',
  }
end
