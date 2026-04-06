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
