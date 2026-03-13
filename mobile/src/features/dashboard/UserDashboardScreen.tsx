import React, {useEffect, useState} from 'react';
import {Pressable, ScrollView, StyleSheet, Text, TextInput, View} from 'react-native';

import {cyberTheme} from '../../theme/cyberTheme';
import {UserNote, UserNotesStore} from '../../security/UserNotesStore';

type UserDashboardScreenProps = {
  username: string;
  onLogout?: () => void;
};

function UserDashboardScreen({username, onLogout}: UserDashboardScreenProps) {
  const [noteInput, setNoteInput] = useState('');
  const [notes, setNotes] = useState<UserNote[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    UserNotesStore.getNotes(username).then(setNotes);
  }, [username]);

  const addNote = async () => {
    const content = noteInput.trim();
    if (!content || saving) {
      return;
    }
    setSaving(true);
    const next = await UserNotesStore.addNote(username, content);
    setNotes(next);
    setNoteInput('');
    setSaving(false);
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Welcome, {username}</Text>
      <Text style={styles.subtitle}>Your secure dashboard is ready.</Text>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Add secure note</Text>
        <TextInput
          style={styles.input}
          placeholder="Write something for this account"
          placeholderTextColor={cyberTheme.colors.textMuted}
          value={noteInput}
          onChangeText={setNoteInput}
          multiline
          cursorColor={cyberTheme.colors.accent}
        />
        <Pressable style={[styles.button, (!noteInput.trim() || saving) && styles.disabled]} onPress={addNote}>
          <Text style={styles.buttonText}>{saving ? 'Saving...' : 'Save note'}</Text>
        </Pressable>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Your notes</Text>
        {notes.length === 0 ? <Text style={styles.empty}>No notes yet for this user.</Text> : null}
        {notes.map(note => (
          <View key={note.id} style={styles.noteItem}>
            <Text style={styles.noteText}>{note.content}</Text>
            <Text style={styles.noteTime}>{new Date(note.createdAt).toLocaleString()}</Text>
          </View>
        ))}
      </View>

      {onLogout ? (
        <Pressable style={styles.logoutButton} onPress={onLogout}>
          <Text style={styles.logoutText}>Logout</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: cyberTheme.spacing.outer,
    backgroundColor: cyberTheme.colors.background,
    flexGrow: 1,
  },
  title: {
    color: cyberTheme.colors.textPrimary,
    fontSize: 30,
    fontWeight: '800',
    marginBottom: 6,
  },
  subtitle: {
    color: cyberTheme.colors.textSecondary,
    marginBottom: 16,
  },
  card: {
    backgroundColor: cyberTheme.colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1d2b1a',
    padding: 14,
    marginBottom: 16,
  },
  cardTitle: {
    color: cyberTheme.colors.accent,
    fontWeight: '700',
    marginBottom: 10,
  },
  input: {
    minHeight: 92,
    borderWidth: 1,
    borderColor: '#1f2937',
    borderRadius: 12,
    padding: 12,
    color: cyberTheme.colors.textPrimary,
    backgroundColor: cyberTheme.colors.surfaceSoft,
    textAlignVertical: 'top',
    marginBottom: 10,
  },
  button: {
    backgroundColor: cyberTheme.colors.accent,
    borderRadius: 12,
    padding: 13,
    alignItems: 'center',
  },
  buttonText: {
    color: '#05170A',
    fontWeight: '700',
  },
  disabled: {
    opacity: 0.55,
  },
  empty: {
    color: cyberTheme.colors.textSecondary,
  },
  noteItem: {
    borderWidth: 1,
    borderColor: '#1f2937',
    borderRadius: 12,
    padding: 12,
    backgroundColor: cyberTheme.colors.surfaceSoft,
    marginBottom: 10,
  },
  noteText: {
    color: cyberTheme.colors.textPrimary,
    marginBottom: 6,
  },
  noteTime: {
    color: cyberTheme.colors.textMuted,
    fontSize: 12,
  },
  logoutButton: {
    borderWidth: 1,
    borderColor: '#ef4444',
    borderRadius: 12,
    padding: 13,
    alignItems: 'center',
    backgroundColor: '#2a1115',
  },
  logoutText: {
    color: '#fda4af',
    fontWeight: '700',
  },
});

export default UserDashboardScreen;
