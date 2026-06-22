import { useState, useRef, useCallback, useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { View, StyleSheet, BackHandler } from 'react-native';
import { WebView } from 'react-native-webview';
import NativeScanner from './NativeScanner';
import * as Printer from './phomemoPrinter';

// Cache-bust: append timestamp so WebView always fetches fresh HTML
const TRACK_INN_URL = 'https://lgerardoruiz-coder.github.io/track-inn/?v=' + Date.now();

export default function App() {
  const [showScanner, setShowScanner] = useState(false);
  const [scannerMode, setScannerMode] = useState('main'); // 'main' or 'batch'
  const [batchTargetId, setBatchTargetId] = useState(null);
  const webViewRef = useRef(null);

  // Android back button handler
  useEffect(() => {
    const handler = BackHandler.addEventListener('hardwareBackPress', () => {
      if (showScanner) {
        handleScannerClose();
        return true;
      }
      // Let WebView handle back navigation via injected JS
      if (webViewRef.current) {
        webViewRef.current.injectJavaScript(`
          if (typeof currentScreen !== 'undefined' && currentScreen > 0) {
            if (currentScreen === 6) goToScreen(1);
            else if (currentScreen === 5) leaveBatchScreen();
            else if (currentScreen === 4) goToScreen(1);
            else if (currentScreen === 3) goToScreen(1);
            else if (currentScreen === 1) goToScreen(0);
          }
          true;
        `);
        return true;
      }
      return false;
    });
    return () => handler.remove();
  }, [showScanner]);

  // Helper: send status update to PWA
  const updatePWAPrinterUI = useCallback((state, msg) => {
    if (!webViewRef.current) return;
    const stateStr = state === true ? 'true' : state === false ? 'false' : `'${state}'`;
    const msgStr = msg ? `'${msg.replace(/'/g, "\\'")}'` : 'undefined';
    webViewRef.current.injectJavaScript(`
      if (window.updatePrinterUI) window.updatePrinterUI(${stateStr}, ${msgStr});
      true;
    `);
  }, []);

  // JavaScript injected into the PWA
  const injectedJS = `
    (function() {
      if (window.__HYBRID_INJECTED__) return;
      window.__HYBRID_INJECTED__ = true;
      window.__TRACK_INN_HYBRID__ = true;

      // Force Service Worker update on every load
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistrations().then(function(regs) {
          regs.forEach(function(reg) { reg.update(); });
        });
      }

      // === DEPLOY VERIFICATION: visible build badge ===
      // Shows on screen which version of the printer code is actually running,
      // so we can confirm a new build is really installed (no more guessing).
      window.__PRINTER_BUILD__ = 'IMPRESORA v4';
      (function addBadge() {
        if (!document.body) { setTimeout(addBadge, 300); return; }
        if (document.getElementById('__hybridBadge__')) return;
        var b = document.createElement('div');
        b.id = '__hybridBadge__';
        b.textContent = window.__PRINTER_BUILD__;
        b.style.cssText = 'position:fixed;bottom:4px;right:4px;z-index:2147483647;'
          + 'background:rgba(220,38,38,0.92);color:#fff;'
          + 'font:700 10px sans-serif;padding:2px 6px;border-radius:6px;pointer-events:none;';
        document.body.appendChild(b);
      })();

      function setup() {
        if (!window.goToScreen) return;
        if (window.__HYBRID_SETUP_DONE__) return;
        window.__HYBRID_SETUP_DONE__ = true;

        var original = window.goToScreen;

        // === NAVIGATION: intercept scanner screen ===
        window.goToScreen = function(target) {
          if (target === 2) {
            var from = window.currentScreen;
            if (from === 3 || from === 4) {
              // From product/not-found back button → go to splash
              original(1);
              return;
            }
            // From splash or anywhere else → open native MLKit scanner
            window.__preScanner__ = from || 1;
            window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'OPEN_SCANNER', mode: 'main' }));
            return;
          }
          original(target);
        };

        // Override CTA buttons to open scanner (not go to splash)
        var ctaBtn = document.querySelector('.btn-cta-red');
        if (ctaBtn) {
          ctaBtn.onclick = function() {
            window.__preScanner__ = 1;
            window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'OPEN_SCANNER', mode: 'main' }));
          };
        }
        var tryAgainBtn = document.querySelector('.btn-try-again');
        if (tryAgainBtn) {
          tryAgainBtn.onclick = function() {
            window.__preScanner__ = 1;
            window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'OPEN_SCANNER', mode: 'main' }));
          };
        }

        // === BATCH SCANNER: intercept batch scanner too ===
        if (window.openBatchScanner) {
          var origOpenBatch = window.openBatchScanner;
          window.openBatchScanner = function(rowId) {
            window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'OPEN_SCANNER', mode: 'batch', rowId: rowId }));
          };
        }

        // === QUEUE SCANNER: intercept queue scanner same way ===
        if (window.openQueueScanner) {
          window.openQueueScanner = function(rowId) {
            window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'OPEN_SCANNER', mode: 'queue', rowId: rowId }));
          };
        }

        // === SCAN RESULTS FROM NATIVE ===
        document.addEventListener('nativeScan', function(e) {
          if (window.processBarcode) window.processBarcode(e.detail);
        });

        document.addEventListener('nativeBatchScan', function(e) {
          var rowId = e.detail.rowId;
          var code = e.detail.code;
          var input = document.getElementById('batchInput' + rowId);
          if (input) input.value = code;
          if (window.batchLookupCode) window.batchLookupCode(rowId);
        });

        document.addEventListener('nativeQueueScan', function(e) {
          var rowId = e.detail.rowId;
          var code = e.detail.code;
          var input = document.getElementById('queueInput' + rowId);
          if (input) input.value = code;
          if (window.queueLookupCode) window.queueLookupCode(rowId);
        });

        document.addEventListener('nativeScannerClosed', function() {
          var backTo = window.__preScanner__;
          if (backTo !== undefined && backTo !== null) {
            original(backTo);
            window.__preScanner__ = null;
          }
        });

        // === PRINTER: replace _phomemo with native BLE bridge ===
        window._phomemo = {
          _nativeConnected: false,
          _deviceName: 'Phomemo M120',

          isConnected: function() { return this._nativeConnected; },
          getDeviceName: function() { return this._deviceName; },

          connect: function() {
            window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'PRINTER_CONNECT' }));
            return new Promise(function(resolve, reject) {
              window.__printerResolve__ = resolve;
              window.__printerReject__ = reject;
              setTimeout(function() {
                if (window.__printerReject__) {
                  window.__printerReject__(new Error('Timeout: impresora no respondio'));
                  window.__printerReject__ = null;
                  window.__printerResolve__ = null;
                }
              }, 20000);
            });
          },

          disconnect: function() {
            window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'PRINTER_DISCONNECT' }));
            this._nativeConnected = false;
          },

          print: function(canvas) {
            var ctx = canvas.getContext('2d');
            var w = canvas.width, h = canvas.height;
            var imageData = ctx.getImageData(0, 0, w, h);
            var pixels = Array.from(imageData.data);
            window.ReactNativeWebView.postMessage(JSON.stringify({
              type: 'PRINTER_PRINT',
              width: w,
              height: h,
              pixels: pixels
            }));
            return new Promise(function(resolve, reject) {
              window.__printResolve__ = resolve;
              window.__printReject__ = reject;
              setTimeout(function() {
                if (window.__printResolve__) {
                  window.__printResolve__();
                  window.__printResolve__ = null;
                }
              }, 15000);
            });
          },

          canvasToRaster: function() { return null; },
          PRINTER_WIDTH_BYTES: 48
        };

        // Printer events from native
        document.addEventListener('printerConnected', function(e) {
          window._phomemo._nativeConnected = true;
          window._phomemo._deviceName = e.detail || 'Phomemo M120';
          if (window.__printerResolve__) {
            window.__printerResolve__();
            window.__printerResolve__ = null;
            window.__printerReject__ = null;
          }
          if (window.updatePrinterUI) window.updatePrinterUI(true);
        });

        document.addEventListener('printerDisconnected', function() {
          window._phomemo._nativeConnected = false;
          if (window.updatePrinterUI) window.updatePrinterUI(false);
        });

        document.addEventListener('printerError', function(e) {
          window._phomemo._nativeConnected = false;
          if (window.__printerReject__) {
            window.__printerReject__(new Error(e.detail));
            window.__printerReject__ = null;
            window.__printerResolve__ = null;
          }
          if (window.updatePrinterUI) window.updatePrinterUI(false, e.detail);
        });

        document.addEventListener('printDone', function() {
          if (window.__printResolve__) {
            window.__printResolve__();
            window.__printResolve__ = null;
          }
        });

        // Suppress BLE alerts from PWA
        var origAlert = window.alert;
        window.alert = function(msg) {
          if (msg && (msg.indexOf('Bluetooth') >= 0 || msg.indexOf('bluetooth') >= 0 || msg.indexOf('BLE') >= 0)) return;
          origAlert(msg);
        };

        if (window.handleBleError) {
          window.handleBleError = function(e) {
            if (window.updatePrinterUI) window.updatePrinterUI(false, e.message || 'Error BLE');
          };
        }

        // === GEOLOCATION: enable in WebView ===
        // WebView geolocation should work if permissions are granted
        // The PWA already calls detectStore() on load which uses navigator.geolocation
      }

      setup();
      setTimeout(setup, 1500);
      setTimeout(setup, 4000);
    })();
    true;
  `;

  const handleLoadEnd = useCallback(() => {
    if (webViewRef.current) {
      webViewRef.current.injectJavaScript(injectedJS);
    }
  }, []);

  const handleMessage = useCallback(async (event) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);

      // === SCANNER ===
      if (data.type === 'OPEN_SCANNER') {
        setScannerMode(data.mode || 'main');
        if (data.rowId) setBatchTargetId(data.rowId);
        setShowScanner(true);
      }

      // === PRINTER ===
      if (data.type === 'PRINTER_CONNECT') {
        try {
          updatePWAPrinterUI('connecting', 'Buscando impresora...');
          await Printer.connect();
          const name = Printer.getDeviceName() || 'Phomemo M120';
          webViewRef.current?.injectJavaScript(`
            document.dispatchEvent(new CustomEvent('printerConnected', { detail: '${name}' }));
            true;
          `);
        } catch (e) {
          const errMsg = (e.message || 'Error').replace(/'/g, "\\'");
          webViewRef.current?.injectJavaScript(`
            document.dispatchEvent(new CustomEvent('printerError', { detail: '${errMsg}' }));
            true;
          `);
        }
      }

      if (data.type === 'PRINTER_DISCONNECT') {
        Printer.disconnect();
        webViewRef.current?.injectJavaScript(`
          document.dispatchEvent(new CustomEvent('printerDisconnected'));
          true;
        `);
      }

      if (data.type === 'PRINTER_PRINT') {
        try {
          updatePWAPrinterUI('printing', 'Imprimiendo...');
          const pixels = new Uint8Array(data.pixels);
          const raster = Printer.canvasToRaster(pixels, data.width, data.height);
          await Printer.print(raster);
          webViewRef.current?.injectJavaScript(`
            document.dispatchEvent(new CustomEvent('printDone'));
            true;
          `);
          updatePWAPrinterUI(true, 'Etiqueta impresa!');
          setTimeout(() => updatePWAPrinterUI(true), 3000);
        } catch (e) {
          updatePWAPrinterUI(false, 'Error: ' + e.message);
        }
      }

    } catch (e) {}
  }, [updatePWAPrinterUI]);

  // MLKit scanned a barcode
  const handleBarcodeScan = useCallback((code) => {
    setShowScanner(false);
    if (webViewRef.current) {
      const escaped = code.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      if (scannerMode === 'batch' && batchTargetId) {
        // Batch scan — send to specific row
        webViewRef.current.injectJavaScript(`
          document.dispatchEvent(new CustomEvent('nativeBatchScan', {
            detail: { rowId: ${batchTargetId}, code: '${escaped}' }
          }));
          true;
        `);
      } else if (scannerMode === 'queue' && batchTargetId) {
        // Queue scan — send to queue row
        webViewRef.current.injectJavaScript(`
          document.dispatchEvent(new CustomEvent('nativeQueueScan', {
            detail: { rowId: ${batchTargetId}, code: '${escaped}' }
          }));
          true;
        `);
      } else {
        // Main scan
        webViewRef.current.injectJavaScript(`
          document.dispatchEvent(new CustomEvent('nativeScan', { detail: '${escaped}' }));
          true;
        `);
      }
    }
  }, [scannerMode, batchTargetId]);

  // Scanner closed without scanning
  const handleScannerClose = useCallback(() => {
    setShowScanner(false);
    if (scannerMode === 'main' && webViewRef.current) {
      webViewRef.current.injectJavaScript(`
        document.dispatchEvent(new CustomEvent('nativeScannerClosed'));
        true;
      `);
    }
    // For batch mode, just close — user stays on batch screen
  }, [scannerMode]);

  return (
    <View style={styles.container}>
      <StatusBar style="light" translucent backgroundColor="transparent" />
      <View style={[styles.webviewContainer, showScanner && styles.hidden]}>
        <WebView
          ref={webViewRef}
          source={{ uri: TRACK_INN_URL }}
          style={styles.webview}
          javaScriptEnabled={true}
          domStorageEnabled={true}
          allowFileAccess={true}
          allowFileAccessFromFileURLs={true}
          allowUniversalAccessFromFileURLs={true}
          mediaPlaybackRequiresUserAction={false}
          allowsInlineMediaPlayback={true}
          geolocationEnabled={true}
          onLoadEnd={handleLoadEnd}
          onMessage={handleMessage}
          injectedJavaScript={injectedJS}
          originWhitelist={['*']}
          mixedContentMode="always"
          cacheEnabled={false}
          cacheMode="LOAD_NO_CACHE"
          setSupportMultipleWindows={false}
        />
      </View>
      {showScanner ? (
        <View style={styles.scannerOverlay}>
          <NativeScanner onScan={handleBarcodeScan} onClose={handleScannerClose} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1D1D1D',
  },
  webviewContainer: {
    flex: 1,
  },
  hidden: {
    position: 'absolute',
    width: 0,
    height: 0,
    overflow: 'hidden',
  },
  webview: {
    flex: 1,
  },
  scannerOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 100,
  },
});
