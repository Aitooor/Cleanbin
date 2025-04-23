import { useState } from 'react';
import { useRouter } from 'next/router';
import { useNotification } from '../components/NotificationProvider';

const Login = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const router = useRouter();
  const { addNotification } = useNotification();

  const handleLogin = async () => {
    if (!/\S+@\S+\.\S+/.test(email)) {
      addNotification('Please enter a valid email.');
      return;
    }

    const response = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    if (response.ok) {
      document.cookie = `auth-token=true; path=/;`;
      router.push('/dashboard');
    } else {
      const data = await response.json();
      addNotification(data.message || 'Invalid credentials');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter') {
      handleLogin();
    }
  };

  return (
    <div onKeyDown={handleKeyDown}>
      <h1>Login</h1>
      <input
        type="email"
        placeholder="Enter email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <input
        type="password"
        placeholder="Enter password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <button onClick={handleLogin}>Login</button>
    </div>
  );
};

export default Login;
