declare module 'react-native-encrypted-storage' {
  const EncryptedStorage: {
    setItem(key: string, value: string): Promise<void>;
    getItem(key: string): Promise<string | null>;
    removeItem(key: string): Promise<void>;
  };

  export default EncryptedStorage;
}

declare module 'react-native-image-picker' {
  export type CameraOptions = {
    mediaType?: 'photo' | 'video' | 'mixed';
    cameraType?: 'back' | 'front';
    saveToPhotos?: boolean;
    quality?: number;
    includeBase64?: boolean;
  };

  export type Asset = {
    uri?: string;
    base64?: string;
    fileSize?: number;
    width?: number;
    height?: number;
    type?: string;
  };

  export type ImagePickerResponse = {
    didCancel?: boolean;
    errorCode?: string;
    errorMessage?: string;
    assets?: Asset[];
  };

  export function launchCamera(options?: CameraOptions): Promise<ImagePickerResponse>;
}

declare module 'react-native-fs' {
  const RNFS: {
    readFile(path: string, encoding: 'base64' | string): Promise<string>;
  };

  export default RNFS;
}

declare module 'react-native-webview' {
  import React from 'react';

  export const WebView: React.ComponentType<any>;
}

declare module 'react-native-camera-kit' {
  import React from 'react';

  export const CameraType: {
    Back: string;
    Front: string;
  };

  export const Camera: React.ComponentType<any>;
}