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
