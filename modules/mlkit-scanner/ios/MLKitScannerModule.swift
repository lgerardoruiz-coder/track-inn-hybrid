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
