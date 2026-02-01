import '../styles/globals.css';
import '../styles/dashboard.css';
import type { AppProps } from 'next/app';
import { NotificationProvider } from '../components/NotificationProvider';

function MyApp({ Component, pageProps }: AppProps) {
    return (
        <NotificationProvider>
            <Component {...pageProps} />
        </NotificationProvider>
    );
}

export default MyApp;
