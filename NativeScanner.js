import { useState, useRef, useEffect, useMemo } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  SafeAreaView, Animated, Dimensions, PanResponder, Vibration,
  KeyboardAvoidingView, Platform, ScrollView, Keyboard,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';

let MLKitScannerView = null;
if (Platform.OS === 'ios') {
  try {
    MLKitScannerView = require('./modules/mlkit-scanner').MLKitScannerView;
  } catch (e) {
    console.warn('MLKitScanner not available, falling back to expo-camera:', e.message);
  }
}

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

export default function NativeScanner({ onScan, onClose }) {
  const [permission, requestPermission] = useCameraPermissions();
  const [canScan, setCanScan] = useState(true);
  const [lastCode, setLastCode] = useState('');
  const [manualCode, setManualCode] = useState('');
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const scanLineAnim = useRef(new Animated.Value(0)).current;

  // Track keyboard
  useEffect(() => {
    const showSub = Keyboard.addListener('keyboardDidShow', () => setKeyboardVisible(true));
    const hideSub = Keyboard.addListener('keyboardDidHide', () => setKeyboardVisible(false));
    return () => { showSub.remove(); hideSub.remove(); };
  }, []);

  // Swipe right to go back
  const panResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, gs) => {
      return Math.abs(gs.dx) > 25 && Math.abs(gs.dx) > Math.abs(gs.dy) * 0.8;
    },
    onPanResponderRelease: (_, gs) => {
      if (gs.dx > 80 && Math.abs(gs.dx) > Math.abs(gs.dy) * 0.8) {
        onClose();
      }
    },
  }), [onClose]);

  // Animated scan line
  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(scanLineAnim, { toValue: 1, duration: 2200, useNativeDriver: true }),
        Animated.timing(scanLineAnim, { toValue: 0, duration: 2200, useNativeDriver: true }),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, []);

  const scanLineTranslateY = scanLineAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, SCREEN_HEIGHT * 0.45],
  });

  const handleBarcodeScanned = ({ type, data }) => {
    if (!canScan) return;
    setCanScan(false);
    setLastCode(data);
    try { Vibration.vibrate(100); } catch (e) {}
    onScan(data);
    setTimeout(() => setCanScan(true), 2000);
  };

  const handleManualSearch = () => {
    const code = manualCode.trim();
    if (!code) return;
    Keyboard.dismiss();
    onScan(code);
    setManualCode('');
  };

  if (!permission) {
    return <View style={styles.container}><Text style={styles.loadingText}>Cargando...</Text></View>;
  }

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.permissionContainer}>
          <Text style={styles.permissionTitle}>Track INN</Text>
          <Text style={styles.permissionText}>Necesitamos acceso a la camara para escanear codigos de barras.</Text>
          <TouchableOpacity style={styles.permissionBtn} onPress={requestPermission}>
            <Text style={styles.permissionBtnText}>Permitir Camara</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
            <Text style={styles.closeBtnText}>Cancelar</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // Back arrow SVG matching the PWA style
  const BackArrow = () => (
    <View style={styles.backBtn}>
      <View style={{ width: 20, height: 20 }}>
        <View style={{ position: 'absolute', top: 9, left: 2, width: 14, height: 2.5, backgroundColor: '#fff', borderRadius: 1 }} />
        <View style={{ position: 'absolute', top: 3.5, left: 2, width: 9, height: 2.5, backgroundColor: '#fff', borderRadius: 1, transform: [{ rotate: '-45deg' }] }} />
        <View style={{ position: 'absolute', top: 14.5, left: 2, width: 9, height: 2.5, backgroundColor: '#fff', borderRadius: 1, transform: [{ rotate: '45deg' }] }} />
      </View>
    </View>
  );

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={0}
    >
      <SafeAreaView style={styles.container} {...panResponder.panHandlers}>
        {/* Header — same position and style as PWA */}
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} activeOpacity={0.7}>
            <BackArrow />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Escaner</Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Camera — shrink when keyboard is visible */}
          {!keyboardVisible ? (
            <View style={styles.cameraContainer}>
              {Platform.OS === 'ios' && MLKitScannerView ? (
                <MLKitScannerView
                  style={styles.camera}
                  barcodeTypes={[
                    // Solo los formatos que usa el retail: EAN-13 (cajas Nike/Adidas),
                    // UPC-A (algunos productos US) y CODE128 (etiquetas internas).
                    // Se removieron itf14/code39/code93/codabar/datamatrix/qr porque
                    // causaban misreads de códigos EAN-13 en productos reales.
                    'ean13', 'upc_a', 'code128',
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
                    // Solo los formatos que usa el retail: EAN-13 (cajas Nike/Adidas),
                    // UPC-A (algunos productos US) y CODE128 (etiquetas internas).
                    // Se removieron itf14/code39/code93/codabar/datamatrix/qr porque
                    // causaban misreads de códigos EAN-13 en productos reales (Android).
                    barcodeTypes: [
                      'ean13', 'upc_a', 'code128',
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

          {/* Instruction */}
          <Text style={styles.instruction}>Escanea un codigo de barras</Text>
          {!keyboardVisible ? <Text style={styles.swipeHint}>← Desliza para volver</Text> : null}

          {/* Manual input */}
          <View style={styles.manualSection}>
            <Text style={styles.manualLabel}>o ingresa el codigo manualmente</Text>
            <TextInput
              style={styles.manualInput}
              placeholder="UPC, Estilo o Material..."
              placeholderTextColor="#666"
              value={manualCode}
              onChangeText={setManualCode}
              onSubmitEditing={handleManualSearch}
              returnKeyType="search"
              autoCorrect={false}
              autoCapitalize="characters"
            />
            <TouchableOpacity style={styles.searchBtn} onPress={handleManualSearch} activeOpacity={0.8}>
              <Text style={styles.searchBtnText}>Buscar</Text>
            </TouchableOpacity>
          </View>

          {lastCode ? <Text style={styles.lastScan}>Ultimo: {lastCode}</Text> : null}
        </ScrollView>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1D1D1D' },
  loadingText: { color: '#fff', fontSize: 18, textAlign: 'center', marginTop: 100 },
  permissionContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
  permissionTitle: { color: '#fff', fontSize: 28, fontWeight: '800', marginBottom: 20 },
  permissionText: { color: '#888', fontSize: 14, textAlign: 'center', marginBottom: 30, lineHeight: 22 },
  permissionBtn: { backgroundColor: '#E63946', paddingVertical: 16, paddingHorizontal: 40, borderRadius: 14, marginBottom: 16 },
  permissionBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  closeBtn: { paddingVertical: 12, paddingHorizontal: 30 },
  closeBtnText: { color: '#95A5A6', fontSize: 14 },
  // Header — matches PWA .screen-header.header-dark
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 32, paddingBottom: 8 },
  backBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: '#2B2B2B', justifyContent: 'center', alignItems: 'center' },
  headerTitle: { flex: 1, color: '#fff', fontSize: 18, fontWeight: '600', textAlign: 'center', marginRight: 40 },
  // Scroll
  scrollContent: { alignItems: 'center', paddingHorizontal: 20, paddingBottom: 20 },
  // Camera
  cameraContainer: { width: '100%', height: SCREEN_HEIGHT * 0.50, overflow: 'hidden', position: 'relative', marginLeft: -20, marginRight: -20, alignSelf: 'center', width: Dimensions.get('window').width },
  camera: { flex: 1 },
  overlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center' },
  corner: { position: 'absolute', width: 36, height: 36, borderColor: '#E63946', borderWidth: 3 },
  cornerTL: { top: '15%', left: 20, borderRightWidth: 0, borderBottomWidth: 0, borderTopLeftRadius: 12 },
  cornerTR: { top: '15%', right: 20, borderLeftWidth: 0, borderBottomWidth: 0, borderTopRightRadius: 12 },
  cornerBL: { bottom: '15%', left: 20, borderRightWidth: 0, borderTopWidth: 0, borderBottomLeftRadius: 12 },
  cornerBR: { bottom: '15%', right: 20, borderLeftWidth: 0, borderTopWidth: 0, borderBottomRightRadius: 12 },
  scanLine: { position: 'absolute', left: 30, right: 30, height: 2, backgroundColor: '#E63946', shadowColor: '#E63946', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.8, shadowRadius: 12, elevation: 5 },
  // Instruction
  instruction: { color: '#95A5A6', fontSize: 13, textAlign: 'center', marginTop: 12, fontWeight: '400' },
  swipeHint: { color: '#444', fontSize: 11, textAlign: 'center', marginTop: 4 },
  // Manual input
  manualSection: { width: '100%', maxWidth: 340, marginTop: 12, gap: 10 },
  manualLabel: { color: '#666', fontSize: 12, textAlign: 'center' },
  manualInput: { backgroundColor: '#2B2B2B', borderRadius: 14, borderWidth: 2, borderColor: '#2B2B2B', padding: 14, color: '#fff', fontSize: 16, fontWeight: '500' },
  searchBtn: { backgroundColor: '#E63946', borderRadius: 14, paddingVertical: 14, alignItems: 'center', minHeight: 52 },
  searchBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  lastScan: { color: '#666', fontSize: 12, textAlign: 'center', marginTop: 8 },
});
