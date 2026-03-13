import EncryptedStorage from 'react-native-encrypted-storage';

import {FaceEmbedding} from '../features/face/EmbeddingEngine';

const TEMPLATE_KEY = '@faceauth/template';
const DEVICE_KEY = '@faceauth/device';

export type DeviceBinding = {
  deviceId: string;
  deviceName: string;
  bindingKeyId: string;
  username: string;
};

export const BiometricStore = {
  async saveTemplate(template: FaceEmbedding): Promise<void> {
    await EncryptedStorage.setItem(TEMPLATE_KEY, JSON.stringify(template));
  },

  async getTemplate(): Promise<FaceEmbedding | null> {
    const raw = await EncryptedStorage.getItem(TEMPLATE_KEY);
    return raw ? (JSON.parse(raw) as FaceEmbedding) : null;
  },

  async saveDeviceBinding(binding: DeviceBinding): Promise<void> {
    await EncryptedStorage.setItem(DEVICE_KEY, JSON.stringify(binding));
  },

  async getDeviceBinding(): Promise<DeviceBinding | null> {
    const raw = await EncryptedStorage.getItem(DEVICE_KEY);
    return raw ? (JSON.parse(raw) as DeviceBinding) : null;
  },

  async clearAll(): Promise<void> {
    await EncryptedStorage.removeItem(TEMPLATE_KEY);
    await EncryptedStorage.removeItem(DEVICE_KEY);
  },
};
