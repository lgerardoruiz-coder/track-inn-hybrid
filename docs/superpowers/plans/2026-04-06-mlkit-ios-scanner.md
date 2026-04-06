# MLKit iOS Barcode Scanner — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace ZXingObjC with Google MLKit for barcode scanning on iOS, matching Android's speed and accuracy.

**Architecture:** Local Expo Module (`modules/mlkit-scanner/`) with Swift code that uses AVCaptureSession + Google MLKit BarcodeScanning. NativeScanner.js uses Platform.OS to render the custom view on iOS and expo-camera on Android. Zero npm dependencies added.

**Tech Stack:** Expo SDK 55, Expo Modules API (Swift), Google MLKit BarcodeScanning iOS pod, AVFoundation

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `modules/mlkit-scanner/expo-module.config.json` | Create | Register module with Expo |
| `modules/mlkit-scanner/index.ts` | Create | Public export |
| `modules/mlkit-scanner/src/MLKitScannerView.tsx` | Create | React Native wrapper component |
| `modules/mlkit-scanner/ios/MLKitScanner.podspec` | Create | Declare MLKit pod dependency |
| `modules/mlkit-scanner/ios/MLKitScannerModule.swift` | Create | Expo module definition |
| `modules/mlkit-scanner/ios/MLKitScannerView.swift` | Create | Native view: AVCaptureSession + MLKit |
| `NativeScanner.js` | Modify | Platform.OS conditional rendering |
| `app.json` | Modify | Add local module plugin reference |

---

### Task 1: Create module scaffolding

**Files:**
- Create: `modules/mlkit-scanner/expo-module.config.json`
- Create: `modules/mlkit-scanner/ios/MLKitScanner.podspec`

- [ ] **Step 1: Create expo-module.config.json**

```json
{
  "platforms": ["ios"],
  "ios": {
    "modules": ["MLKitScannerModule"]
  }
}
```

This tells Expo: "this module only runs on iOS, and the Swift entry point is MLKitScannerModule".

- [ ] **Step 2: Create the podspec**

```ruby
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
```

- [ ] **Step 3: Commit**

```bash
cd "C:/Users/Gerardo Ruiz/Projects/track-inn-hybrid"
git add modules/mlkit-scanner/expo-module.config.json modules/mlkit-scanner/ios/MLKitScanner.podspec
git commit -m "feat: scaffold mlkit-scanner expo module (iOS only)"
```

---

### Task 2: Create the Swift module definition

**Files:**
- Create: `modules/mlkit-scanner/ios/MLKitScannerModule.swift`

- [ ] **Step 1: Write the module definition**

This file registers the module with Expo and defines the native view, its props, and events.

```swift
import ExpoModulesCore

public class MLKitScannerModule: Module {
  public func definition() -> ModuleDefinition {
    Name("MLKitScanner")

    View(MLKitScannerView.self) {
      Events("onBarcodeScanned")

      Prop("barcodeTypes") { (view: MLKitScannerView, types: [String]) in
        view.setBarcodeTypes(types)
      }
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add modules/mlkit-scanner/ios/MLKitScannerModule.swift
git commit -m "feat: add MLKitScannerModule with view, props and events"
```

---

### Task 3: Create the native iOS view with AVCaptureSession + MLKit

**Files:**
- Create: `modules/mlkit-scanner/ios/MLKitScannerView.swift`

This is the core file. It sets up the camera, captures frames, and runs MLKit barcode detection.

- [ ] **Step 1: Write MLKitScannerView.swift**

```swift
import ExpoModulesCore
import AVFoundation
import MLKitBarcodeScanning
import MLKitVision

class MLKitScannerView: ExpoView, AVCaptureVideoDataOutputSampleBufferDelegate {

  // MARK: - Properties

  private let captureSession = AVCaptureSession()
  private let previewLayer = AVCaptureVideoPreviewLayer()
  private var barcodeScanner: BarcodeScanner?
  private var isProcessing = false
  private let sessionQueue = DispatchQueue(label: "com.trackinn.mlkit.session")
  private let processingQueue = DispatchQueue(label: "com.trackinn.mlkit.processing")

  // Event callback to JS
  private let onBarcodeScanned = EventDispatcher()

  // MARK: - Initialization

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    setupScanner(types: [.EAN13, .EAN8, .UPCA, .UPCE, .code128, .code39, .code93, .ITF, .codaBar, .dataMatrix, .qrCode])
    setupCamera()
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    previewLayer.frame = bounds
  }

  override func removeFromSuperview() {
    super.removeFromSuperview()
    sessionQueue.async { [weak self] in
      self?.captureSession.stopRunning()
    }
  }

  // MARK: - Configuration

  func setBarcodeTypes(_ types: [String]) {
    let mlkitFormats = types.compactMap { mapStringToFormat($0) }
    if !mlkitFormats.isEmpty {
      setupScanner(types: mlkitFormats)
    }
  }

  private func setupScanner(types: [BarcodeFormat]) {
    var combinedFormat: BarcodeFormat = []
    for format in types {
      combinedFormat.insert(format)
    }
    let options = BarcodeScannerOptions(formats: combinedFormat)
    barcodeScanner = BarcodeScanner.barcodeScanner(options: options)
  }

  // MARK: - Camera Setup

  private func setupCamera() {
    previewLayer.session = captureSession
    previewLayer.videoGravity = .resizeAspectFill
    layer.addSublayer(previewLayer)

    sessionQueue.async { [weak self] in
      guard let self = self else { return }

      guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back),
            let input = try? AVCaptureDeviceInput(device: device) else {
        return
      }

      if self.captureSession.canAddInput(input) {
        self.captureSession.addInput(input)
      }

      let output = AVCaptureVideoDataOutput()
      output.setSampleBufferDelegate(self, queue: self.processingQueue)
      output.alwaysDiscardsLateVideoFrames = true

      if self.captureSession.canAddOutput(output) {
        self.captureSession.addOutput(output)
      }

      self.captureSession.startRunning()
    }
  }

  // MARK: - Frame Processing (MLKit)

  func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
    guard !isProcessing else { return }
    isProcessing = true

    let image = VisionImage(buffer: sampleBuffer)
    image.orientation = .right

    barcodeScanner?.process(image) { [weak self] barcodes, error in
      defer { self?.isProcessing = false }

      guard error == nil, let barcodes = barcodes, let barcode = barcodes.first else {
        return
      }

      guard let rawValue = barcode.rawValue else { return }

      let typeString = self?.mapFormatToString(barcode.format) ?? "unknown"

      DispatchQueue.main.async {
        self?.onBarcodeScanned([
          "type": typeString,
          "data": rawValue
        ])
      }
    }
  }

  // MARK: - Format Mapping

  private func mapStringToFormat(_ str: String) -> BarcodeFormat? {
    switch str {
    case "ean13": return .EAN13
    case "ean8": return .EAN8
    case "upc_a": return .UPCA
    case "upc_e": return .UPCE
    case "code128": return .code128
    case "code39": return .code39
    case "code93": return .code93
    case "itf14", "itf": return .ITF
    case "codabar": return .codaBar
    case "datamatrix": return .dataMatrix
    case "qr": return .qrCode
    default: return nil
    }
  }

  private func mapFormatToString(_ format: BarcodeFormat) -> String {
    switch format {
    case .EAN13: return "ean13"
    case .EAN8: return "ean8"
    case .UPCA: return "upc_a"
    case .UPCE: return "upc_e"
    case .code128: return "code128"
    case .code39: return "code39"
    case .code93: return "code93"
    case .ITF: return "itf14"
    case .codaBar: return "codabar"
    case .dataMatrix: return "datamatrix"
    case .qrCode: return "qr"
    default: return "unknown"
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add modules/mlkit-scanner/ios/MLKitScannerView.swift
git commit -m "feat: add MLKitScannerView with AVCaptureSession + MLKit barcode detection"
```

---

### Task 4: Create the TypeScript wrapper

**Files:**
- Create: `modules/mlkit-scanner/src/MLKitScannerView.tsx`
- Create: `modules/mlkit-scanner/index.ts`

- [ ] **Step 1: Write the React Native wrapper component**

`modules/mlkit-scanner/src/MLKitScannerView.tsx`:

```tsx
import { requireNativeView } from 'expo-modules-core';
import { ViewStyle } from 'react-native';

type BarcodeResult = {
  type: string;
  data: string;
};

type MLKitScannerViewProps = {
  style?: ViewStyle;
  barcodeTypes?: string[];
  onBarcodeScanned?: (event: { nativeEvent: BarcodeResult }) => void;
};

const NativeView = requireNativeView<MLKitScannerViewProps>('MLKitScanner');

export function MLKitScannerView(props: MLKitScannerViewProps) {
  return <NativeView {...props} />;
}
```

- [ ] **Step 2: Write the public export**

`modules/mlkit-scanner/index.ts`:

```ts
export { MLKitScannerView } from './src/MLKitScannerView';
```

- [ ] **Step 3: Commit**

```bash
git add modules/mlkit-scanner/src/MLKitScannerView.tsx modules/mlkit-scanner/index.ts
git commit -m "feat: add TypeScript wrapper for MLKitScannerView"
```

---

### Task 5: Integrate into NativeScanner.js

**Files:**
- Modify: `NativeScanner.js` (lines 1-8 imports, lines 127-148 camera section)

- [ ] **Step 1: Add conditional import at the top of NativeScanner.js**

Replace the current imports (lines 1-8):

```javascript
import { useState, useRef, useEffect, useMemo } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  SafeAreaView, Animated, Dimensions, PanResponder, Vibration,
  KeyboardAvoidingView, Platform, ScrollView, Keyboard,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';

let MLKitScannerView = null;
if (Platform.OS === 'ios') {
  MLKitScannerView = require('./modules/mlkit-scanner').MLKitScannerView;
}
```

Note: `Platform` was already imported in line 6 but inside the destructure of react-native. The new import block above already includes it.

- [ ] **Step 2: Replace the camera render section**

Replace the `<CameraView>` block inside the `{!keyboardVisible ? (` section (lines 127-148) with:

```javascript
          {!keyboardVisible ? (
            <View style={styles.cameraContainer}>
              {Platform.OS === 'ios' && MLKitScannerView ? (
                <MLKitScannerView
                  style={styles.camera}
                  barcodeTypes={[
                    'ean13', 'ean8', 'upc_a', 'upc_e',
                    'code128', 'code39', 'code93',
                    'itf14', 'codabar', 'datamatrix', 'qr',
                  ]}
                  onBarcodeScanned={canScan ? (event) => {
                    handleBarcodeScanned(event.nativeEvent);
                  } : undefined}
                />
              ) : (
                <CameraView
                  style={styles.camera}
                  facing="back"
                  barcodeScannerSettings={{
                    barcodeTypes: [
                      'ean13', 'ean8', 'upc_a', 'upc_e',
                      'code128', 'code39', 'code93',
                      'itf14', 'codabar', 'datamatrix', 'qr',
                    ],
                  }}
                  onBarcodeScanned={canScan ? handleBarcodeScanned : undefined}
                />
              )}
              <View style={styles.overlay}>
                <View style={[styles.corner, styles.cornerTL]} />
                <View style={[styles.corner, styles.cornerTR]} />
                <View style={[styles.corner, styles.cornerBL]} />
                <View style={[styles.corner, styles.cornerBR]} />
                <Animated.View style={[styles.scanLine, { transform: [{ translateY: scanLineTranslateY }] }]} />
              </View>
            </View>
          ) : null}
```

Note: The MLKit native view sends events as `event.nativeEvent` (Expo Modules convention), so we unwrap it with `(event) => handleBarcodeScanned(event.nativeEvent)`. expo-camera already passes `{ type, data }` directly.

- [ ] **Step 3: Commit**

```bash
git add NativeScanner.js
git commit -m "feat: use MLKitScannerView on iOS, keep expo-camera on Android"
```

---

### Task 6: Update app.json and verify configuration

**Files:**
- Modify: `app.json`

- [ ] **Step 1: Add the local module to app.json plugins**

Add the `plugins` array to the `expo` object in `app.json`:

```json
{
  "expo": {
    "name": "Track Inn H",
    "slug": "track-inn-hybrid",
    "version": "1.0.0",
    "plugins": [
      "./modules/mlkit-scanner"
    ],
    ...
  }
}
```

- [ ] **Step 2: Verify file structure is correct**

Run:

```bash
cd "C:/Users/Gerardo Ruiz/Projects/track-inn-hybrid"
find modules/mlkit-scanner -type f | sort
```

Expected output:

```
modules/mlkit-scanner/expo-module.config.json
modules/mlkit-scanner/index.ts
modules/mlkit-scanner/ios/MLKitScanner.podspec
modules/mlkit-scanner/ios/MLKitScannerModule.swift
modules/mlkit-scanner/ios/MLKitScannerView.swift
modules/mlkit-scanner/src/MLKitScannerView.tsx
```

- [ ] **Step 3: Commit**

```bash
git add app.json
git commit -m "feat: register mlkit-scanner module in app.json plugins"
```

---

### Task 7: Build and test on iOS device

- [ ] **Step 1: Run EAS Build for iOS**

```bash
cd "C:/Users/Gerardo Ruiz/Projects/track-inn-hybrid"
eas build --platform ios --profile preview
```

Watch the build log for:
- "Installing pods" should include `GoogleMLKit/BarcodeScanning`
- No compilation errors in MLKitScanner Swift files
- Build completes successfully

- [ ] **Step 2: Install on iOS device and test**

Test checklist:
- Scanner opens without crash
- Camera preview displays correctly
- Scan an EAN-13 barcode (standard product) — should detect fast
- Scan a small thermal label (the problem case) — should detect like Android
- Scan a QR code
- Verify vibration feedback works
- Verify manual input still works
- Close scanner and verify WebView receives the barcode data
- Test batch scanning mode

- [ ] **Step 3: Verify Android still works**

```bash
eas build --platform android --profile preview
```

Install on Android device and verify:
- Scanner opens normally
- Barcode scanning works exactly as before
- No regressions in any functionality

- [ ] **Step 4: Final commit with version bump**

```bash
# Update version in app.json if desired
git add -A
git commit -m "feat: MLKit barcode scanning on iOS — tested and verified"
```

---

## Troubleshooting

### If EAS Build fails on pod install
- Check that `MLKitScanner.podspec` has the correct `s.platform = :ios, '15.1'`
- Verify `s.dependency 'ExpoModulesCore'` is present
- Check EAS build logs for the specific pod error

### If camera shows black screen on iOS
- Verify `NSCameraUsageDescription` is in app.json (it already is)
- Check that AVCaptureSession is starting on `sessionQueue` (not main thread)
- Verify `previewLayer.frame` is set in `layoutSubviews()`

### If barcodes don't detect
- Verify `image.orientation = .right` in captureOutput (critical for MLKit)
- Check that `barcodeTypes` prop is being received correctly
- Test with a large, clean barcode first to isolate the issue

### If Android breaks
- It shouldn't — the module is iOS-only (`"platforms": ["ios"]`)
- If it does, check that `expo-module.config.json` has `"platforms": ["ios"]`
- Verify NativeScanner.js `Platform.OS` check is correct
