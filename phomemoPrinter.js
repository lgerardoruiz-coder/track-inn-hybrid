/**
 * Phomemo M120 BLE Printer Module
 * Port from PWA (Web Bluetooth) to React Native using react-native-ble-plx
 *
 * BLE Details:
 *   Service UUID:        0xFF00
 *   Write Char UUID:     0xFF02
 *   Device name prefix:  'Q'
 *   Printer width:       384 pixels (48 bytes) at 203 DPI
 */

import { BleManager } from 'react-native-ble-plx';
import { Platform, PermissionsAndroid } from 'react-native';

// ── Constants ────────────────────────────────────────────────────────────────

const SERVICE_UUID = '0000ff00-0000-1000-8000-00805f9b34fb';
const WRITE_CHAR_UUID = '0000ff02-0000-1000-8000-00805f9b34fb';
const PRINTER_WIDTH_BYTES = 48; // 384 pixels / 8
const CHUNK_SIZE = 128;
const CHUNK_DELAY = 20; // ms
const KEEPALIVE_INTERVAL = 30_000; // 30 s
const AUTO_DISCONNECT_TIMEOUT = 10 * 60 * 1000; // 10 min

// ── State ────────────────────────────────────────────────────────────────────

const manager = new BleManager();

let connectedDevice = null;
let writeCharacteristic = null;
let keepaliveTimer = null;
let idleTimer = null;

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Convert a Uint8Array to a base64-encoded string.
 * react-native-ble-plx requires base64 for characteristic writes.
 */
function uint8ToBase64(uint8Array) {
  const lookup =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let base64 = '';
  const len = uint8Array.length;
  for (let i = 0; i < len; i += 3) {
    const b0 = uint8Array[i];
    const b1 = i + 1 < len ? uint8Array[i + 1] : 0;
    const b2 = i + 2 < len ? uint8Array[i + 2] : 0;

    base64 += lookup[b0 >> 2];
    base64 += lookup[((b0 & 3) << 4) | (b1 >> 4)];
    base64 += i + 1 < len ? lookup[((b1 & 15) << 2) | (b2 >> 6)] : '=';
    base64 += i + 2 < len ? lookup[b2 & 63] : '=';
  }
  return base64;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resetIdleTimer() {
  if (idleTimer) {
    clearTimeout(idleTimer);
  }
  idleTimer = setTimeout(() => {
    disconnect();
  }, AUTO_DISCONNECT_TIMEOUT);
}

function startKeepalive() {
  stopKeepalive();
  keepaliveTimer = setInterval(() => {
    if (connectedDevice && writeCharacteristic) {
      const ping = new Uint8Array([0x1f, 0x11, 0x08]);
      writeCharacteristic
        .writeWithoutResponse(uint8ToBase64(ping))
        .catch(() => {
          // Silently ignore keepalive failures
        });
    }
  }, KEEPALIVE_INTERVAL);
}

function stopKeepalive() {
  if (keepaliveTimer) {
    clearInterval(keepaliveTimer);
    keepaliveTimer = null;
  }
}

/**
 * Send raw bytes to the printer, splitting into CHUNK_SIZE pieces with a
 * small delay between each write to avoid overwhelming the BLE buffer.
 */
async function sendBytes(data) {
  if (!connectedDevice || !writeCharacteristic) {
    throw new Error('Impresora no conectada');
  }

  for (let offset = 0; offset < data.length; offset += CHUNK_SIZE) {
    const chunk = data.slice(offset, offset + CHUNK_SIZE);
    await writeCharacteristic.writeWithoutResponse(uint8ToBase64(chunk));
    if (offset + CHUNK_SIZE < data.length) {
      await delay(CHUNK_DELAY);
    }
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Scan for Phomemo printers (name prefix 'Q'), connect to the first one
 * found, discover services and resolve the write characteristic.
 *
 * @returns {Promise<string>} The connected device name.
 */
async function requestBLEPermissions() {
  if (Platform.OS === 'android') {
    const perms = [];
    if (Platform.Version >= 31) {
      perms.push(PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN);
      perms.push(PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT);
    }
    // Always request location — needed for BLE scan on all Android versions
    perms.push(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);

    const results = await PermissionsAndroid.requestMultiple(perms);
    const denied = Object.entries(results).filter(([k, v]) => v !== PermissionsAndroid.RESULTS.GRANTED);
    if (denied.length > 0) {
      throw new Error('Permisos denegados: ' + denied.map(([k]) => k.split('.').pop()).join(', '));
    }
  }
}

async function connect() {
  try {
    // Request BLE permissions
    await requestBLEPermissions();

    // Make sure Bluetooth is powered on
    const state = await manager.state();
    if (state !== 'PoweredOn') {
      await new Promise((resolve, reject) => {
        const sub = manager.onStateChange((newState) => {
          if (newState === 'PoweredOn') {
            sub.remove();
            resolve();
          }
        }, true);
        // Timeout after 10 s
        setTimeout(() => {
          sub.remove();
          reject(new Error('Bluetooth no disponible'));
        }, 10_000);
      });
    }

    // Scan for devices whose name starts with 'Q'
    const device = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        manager.stopDeviceScan();
        reject(new Error('No se encontró impresora Phomemo'));
      }, 15_000);

      manager.startDeviceScan(null, { allowDuplicates: false }, (error, scannedDevice) => {
        if (error) {
          clearTimeout(timeout);
          manager.stopDeviceScan();
          reject(error);
          return;
        }
        const name = scannedDevice?.name || scannedDevice?.localName || '';
        if (name.startsWith('Q')) {
          clearTimeout(timeout);
          manager.stopDeviceScan();
          resolve(scannedDevice);
        }
      });
    });

    // Connect
    connectedDevice = await device.connect({ requestMTU: 512 });

    // Discover all services and characteristics
    await connectedDevice.discoverAllServicesAndCharacteristics();

    // Find the write characteristic
    const services = await connectedDevice.services();
    for (const service of services) {
      if (service.uuid.toLowerCase() === SERVICE_UUID) {
        const chars = await service.characteristics();
        for (const char of chars) {
          if (char.uuid.toLowerCase() === WRITE_CHAR_UUID) {
            writeCharacteristic = char;
            break;
          }
        }
        break;
      }
    }

    if (!writeCharacteristic) {
      throw new Error(
        'No se encontró la característica de escritura en la impresora',
      );
    }

    // Listen for disconnection
    connectedDevice.onDisconnected(() => {
      connectedDevice = null;
      writeCharacteristic = null;
      stopKeepalive();
      if (idleTimer) {
        clearTimeout(idleTimer);
        idleTimer = null;
      }
    });

    startKeepalive();
    resetIdleTimer();

    return connectedDevice.name || connectedDevice.localName || 'Phomemo';
  } catch (error) {
    connectedDevice = null;
    writeCharacteristic = null;
    throw error;
  }
}

/**
 * Disconnect from the printer and clean up timers.
 */
async function disconnect() {
  stopKeepalive();
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  try {
    if (connectedDevice) {
      await connectedDevice.cancelConnection();
    }
  } catch (_) {
    // Ignore errors during disconnect
  } finally {
    connectedDevice = null;
    writeCharacteristic = null;
  }
}

/**
 * @returns {boolean} Whether the printer is currently connected.
 */
function isConnected() {
  return connectedDevice !== null && writeCharacteristic !== null;
}

/**
 * @returns {string|null} The name of the connected device, or null.
 */
function getDeviceName() {
  if (!connectedDevice) {
    return null;
  }
  return connectedDevice.name || connectedDevice.localName || null;
}

/**
 * Convert RGBA pixel data into monochrome raster data suitable for the
 * Phomemo printer.
 *
 * @param {Uint8Array|Uint8ClampedArray} pixelData - RGBA pixel array
 * @param {number} width  - image width in pixels
 * @param {number} height - image height in pixels
 * @returns {{ data: Uint8Array, widthBytes: number, heightLines: number }}
 */
function canvasToRaster(pixelData, width, height) {
  const srcWidthBytes = Math.ceil(width / 8);
  const dstWidthBytes = PRINTER_WIDTH_BYTES;
  const offsetBytes = Math.max(0, Math.floor((dstWidthBytes - srcWidthBytes) / 2));

  const raster = new Uint8Array(dstWidthBytes * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixelIndex = (y * width + x) * 4;
      const r = pixelData[pixelIndex];
      const g = pixelData[pixelIndex + 1];
      const b = pixelData[pixelIndex + 2];
      const a = pixelData[pixelIndex + 3];

      const brightness = 0.299 * r + 0.587 * g + 0.114 * b;
      const isBlack = a > 128 && brightness < 128;

      if (isBlack) {
        const byteIndex = y * dstWidthBytes + offsetBytes + Math.floor(x / 8);
        const bitIndex = 7 - (x % 8); // MSB first
        raster[byteIndex] |= 1 << bitIndex;
      }
    }
  }

  // Replace 0x0A (LF) bytes to avoid protocol issues
  for (let i = 0; i < raster.length; i++) {
    if (raster[i] === 0x0a) {
      raster[i] = 0x14;
    }
  }

  return {
    data: raster,
    widthBytes: dstWidthBytes,
    heightLines: height,
  };
}

/**
 * Print raster image data on the connected Phomemo printer.
 *
 * @param {{ data: Uint8Array, widthBytes: number, heightLines: number }} imageData
 *   Output of canvasToRaster().
 * @param {number} density - Print density 0-8 (default 4).
 */
async function print(imageData, density = 4) {
  if (!isConnected()) {
    throw new Error('Impresora no conectada');
  }

  try {
    resetIdleTimer();

    const { data, widthBytes, heightLines } = imageData;
    const densityValue = Math.round(5 + density * 1.25);

    // 1. Set speed
    await sendBytes(new Uint8Array([0x1b, 0x4e, 0x0d, 0x05]));
    await delay(30);

    // 2. Set density
    await sendBytes(new Uint8Array([0x1b, 0x4e, 0x04, densityValue]));
    await delay(30);

    // 3. Set media type (labels with gaps)
    await sendBytes(new Uint8Array([0x1f, 0x11, 0x0a]));
    await delay(30);

    // 4. Raster header
    await sendBytes(
      new Uint8Array([
        0x1d,
        0x76,
        0x30,
        0x00,
        widthBytes & 0xff,
        (widthBytes >> 8) & 0xff,
        heightLines & 0xff,
        (heightLines >> 8) & 0xff,
      ]),
    );

    // 5. Send raster data
    await sendBytes(data);

    // 6. Footer — wait for the print head to finish rendering the raster
    //    before issuing the feed-to-gap command, otherwise consecutive
    //    labels (5th onward) desync from the physical gap and skew.
    await delay(300);
    await sendBytes(
      new Uint8Array([0x1f, 0xf0, 0x05, 0x00, 0x1f, 0xf0, 0x03, 0x00]),
    );
  } catch (error) {
    throw new Error(`Error al imprimir: ${error.message}`);
  }
}

// ── Exports ──────────────────────────────────────────────────────────────────

export { connect, disconnect, isConnected, getDeviceName, print, canvasToRaster };
