Pod::Spec.new do |s|
  s.name           = 'MLKitScanner'
  s.version        = '1.0.0'
  s.summary        = 'MLKit Barcode Scanner for Track Inn'
  s.description    = 'Custom Expo Module using Google MLKit for barcode scanning on iOS'
  s.homepage       = 'https://github.com/lgerardoruiz-coder/track-inn'
  s.license        = { :type => 'MIT' }
  s.author         = 'Gerardo Ruiz'
  s.source         = { :git => '' }
  s.platform       = :ios, '15.1'
  s.swift_version  = '5.4'
  s.source_files   = '**/*.swift'

  s.dependency 'ExpoModulesCore'
  s.dependency 'GoogleMLKit/BarcodeScanning', '~> 7.0'
end
