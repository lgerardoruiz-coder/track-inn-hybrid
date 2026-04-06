# MLKit iOS Barcode Scanner — Expo Module Propio

**Fecha:** 2026-04-06
**Proyecto:** Track Inn Hybrid
**Problema:** expo-camera usa ZXingObjC en iOS para escaneo de barcodes. Es lento y falla con etiquetas pequenas. En Android usa Google MLKit y funciona perfecto.
**Solucion:** Crear un Expo Module local que use Google MLKit directamente en iOS para barcode scanning.

## Principio de diseno

- Android NO se toca. expo-camera sigue funcionando con MLKit.
- Solo se agrega codigo iOS nuevo.
- Cero paquetes npm nuevos. Solo un pod nativo (GoogleMLKit/BarcodeScanning).
- El modulo es 100% propio, sin dependencias de terceros en JS.

## Arquitectura

```
NativeScanner.js
    |
    +-- Platform.OS === 'ios'
    |   --> <MLKitScannerView />  (modulo local: modules/mlkit-scanner/)
    |       Swift: AVCaptureSession + MLKit BarcodeScanning
    |
    +-- Platform.OS === 'android'
        --> <CameraView />  (expo-camera, sin cambios)

Ambos disparan: onBarcodeScanned({ type, data })
```

## Estructura del modulo

```
modules/
  mlkit-scanner/
    expo-module.config.json     Registro del modulo para Expo
    index.ts                    Export publico
    src/
      MLKitScannerView.tsx      Componente RN (wrapper de la vista nativa)
    ios/
      MLKitScanner.podspec      Dependencia: GoogleMLKit/BarcodeScanning
      MLKitScannerModule.swift  Definicion del modulo Expo
      MLKitScannerView.swift    Vista nativa: AVCaptureSession + MLKit
```

## Flujo nativo iOS

1. AVCaptureSession inicia camara trasera
2. AVCaptureVideoDataOutput captura frames en tiempo real
3. Cada frame se convierte a VisionImage (formato MLKit)
4. MLKit BarcodeScanner.process(visionImage) detecta codigos
5. Barcode detectado -> callback a JS: onBarcodeScanned({ type, data })

## Formatos de barcode soportados

ean13, ean8, upc_a, upc_e, code128, code39, code93, itf14, codabar, datamatrix, qr

(Identicos a los configurados en Android actualmente)

## Props del componente MLKitScannerView

- style: ViewStyle (para dimensionar la camara)
- barcodeTypes: string[] (formatos a detectar)
- onBarcodeScanned: ({ type, data }) => void | undefined (undefined = pausar deteccion)

## Cambios en archivos existentes

### NativeScanner.js
- Agregar import condicional del modulo iOS
- En el render, Platform.OS check para elegir componente de camara
- handleBarcodeScanned NO cambia (misma firma { type, data })
- UI compartida: header, scan line, corners, input manual, swipe

### app.json
- Agregar "./modules/mlkit-scanner" a la lista de plugins

### Archivos que NO cambian
- App.js
- phomemoPrinter.js
- package.json (cero paquetes npm nuevos)
- expo-camera (se queda, Android la usa)
- Carpeta android/
- WebView bridge (eventos nativeScan, nativeBatchScan intactos)
- eas.json

## Dependencias nativas (solo iOS)

- Pod: GoogleMLKit/BarcodeScanning (gratuito, ~4MB)
- Instalado automaticamente por CocoaPods durante EAS Build

## Permisos

Sin cambios. NSCameraUsageDescription ya existe en app.json.

## Tamano del codigo

- Swift: ~100-120 lineas (2 archivos)
- TypeScript: ~30 lineas (2 archivos)
- expo-module.config.json: ~5 lineas
- podspec: ~15 lineas

## Riesgos y mitigacion

| Riesgo | Mitigacion |
|--------|-----------|
| Error en Swift | Android sigue funcionando, se itera solo en iOS |
| MLKit pod no se instala en EAS | podspec bien configurado, EAS soporta pods custom |
| Compatibilidad Expo 55 | Expo Modules API es la forma oficial, garantizada |
| Rendimiento | MLKit procesa frames en background thread, no bloquea UI |

## Criterios de exito

1. iOS escanea barcodes de etiquetas pequenas tan rapido como Android
2. Todos los formatos de barcode funcionan igual que en Android
3. Android sigue funcionando exactamente igual
4. Build de EAS compila sin errores en ambas plataformas
5. El callback onBarcodeScanned entrega { type, data } identico en ambas plataformas
