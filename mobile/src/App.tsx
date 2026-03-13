import * as React from 'react';
import {StatusBar, View} from 'react-native';

import EnrollmentScreen from './features/auth/EnrollmentScreen';
import LiveDetectionScreen from './features/auth/LiveDetectionScreen';
import LoginScreen from './features/auth/LoginScreen';
import MfaFacePrompt from './features/auth/MfaFacePrompt';
import UserDashboardScreen from './features/dashboard/UserDashboardScreen';
import {cyberTheme} from './theme/cyberTheme';

type AppScreen = 'login' | 'enroll' | 'mfa' | 'live' | 'dashboard';

function App() {
  const [screen, setScreen] = React.useState<AppScreen>('login');
  const [activeUsername, setActiveUsername] = React.useState<string | null>(null);

  const handleLoginSuccess = (username: string) => {
    setActiveUsername(username);
    setScreen('dashboard');
  };

  let content = (
    <LoginScreen
      onGoEnroll={() => setScreen('enroll')}
      onGoMfa={() => setScreen('mfa')}
      onGoLive={() => setScreen('live')}
      onLoginSuccess={handleLoginSuccess}
    />
  );
  if (screen === 'enroll') {
    content = <EnrollmentScreen onGoLogin={() => setScreen('login')} onLoginSuccess={handleLoginSuccess} />;
  }
  if (screen === 'mfa') {
    content = <MfaFacePrompt onGoLogin={() => setScreen('login')} onLoginSuccess={handleLoginSuccess} />;
  }
  if (screen === 'live') {
    content = <LiveDetectionScreen onGoLogin={() => setScreen('login')} onLoginSuccess={handleLoginSuccess} />;
  }
  if (screen === 'dashboard' && activeUsername) {
    content = (
      <UserDashboardScreen
        username={activeUsername}
        onLogout={() => {
          setActiveUsername(null);
          setScreen('login');
        }}
      />
    );
  }

  return (
    <View style={{flex: 1, backgroundColor: cyberTheme.colors.background}}>
      <StatusBar barStyle="light-content" backgroundColor={cyberTheme.colors.background} />
      {content}
    </View>
  );
}

export default App;
