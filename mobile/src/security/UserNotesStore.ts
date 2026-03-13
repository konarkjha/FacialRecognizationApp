import EncryptedStorage from 'react-native-encrypted-storage';

export type UserNote = {
  id: string;
  content: string;
  createdAt: string;
};

const keyForUser = (username: string): string => `@faceauth/notes/${username.toLowerCase()}`;

export const UserNotesStore = {
  async getNotes(username: string): Promise<UserNote[]> {
    const raw = await EncryptedStorage.getItem(keyForUser(username));
    if (!raw) {
      return [];
    }
    try {
      return JSON.parse(raw) as UserNote[];
    } catch {
      return [];
    }
  },

  async addNote(username: string, content: string): Promise<UserNote[]> {
    const current = await this.getNotes(username);
    const next: UserNote[] = [
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        content,
        createdAt: new Date().toISOString(),
      },
      ...current,
    ];
    await EncryptedStorage.setItem(keyForUser(username), JSON.stringify(next));
    return next;
  },
};
