import { Head, Html, Main, NextScript } from 'next/document';

// Global document shell. The favicon reuses the header brand mark (the ">_"
// symbol) so the browser tab matches the app identity.
export default function Document() {
    return (
        <Html lang="en">
            <Head>
                <link rel="icon" href="/favicon.ico" sizes="any" />
                <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
                <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
                <meta name="theme-color" content="#1e1e1e" />
            </Head>
            <body>
                <Main />
                <NextScript />
            </body>
        </Html>
    );
}
