import EncryptedStorage from 'react-native-encrypted-storage';

import {FaceEmbedding, MultiPoseFaceProfile} from '../features/face/EmbeddingEngine';

const TEMPLATE_KEY = '@faceauth/template';
const DEVICE_KEY = '@faceauth/device';
const TEMPLATE_PROFILE_KEY = '@faceauth/template_profile';

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

  async saveTemplateProfile(profile: MultiPoseFaceProfile): Promise<void> {
    await EncryptedStorage.setItem(TEMPLATE_PROFILE_KEY, JSON.stringify(profile));
  },

  async getTemplate(): Promise<FaceEmbedding | null> {
    const raw = await EncryptedStorage.getItem(TEMPLATE_KEY);
    return raw ? (JSON.parse(raw) as FaceEmbedding) : null;
  },

  async getTemplateProfile(): Promise<MultiPoseFaceProfile | null> {
    const raw = await EncryptedStorage.getItem(TEMPLATE_PROFILE_KEY);
    if (raw) {
      return JSON.parse(raw) as MultiPoseFaceProfile;
    }

    const legacy = await this.getTemplate();
    if (!legacy) {
      return null;
    }

    return {
      poses: {
        front: legacy,
        left: legacy,
        right: legacy,
        up: legacy,
        down: legacy,
      },
      capturedAt: legacy.capturedAt,
    };
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
    await EncryptedStorage.removeItem(TEMPLATE_PROFILE_KEY);
    await EncryptedStorage.removeItem(DEVICE_KEY);
  },
};
