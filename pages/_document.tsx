import { Head, Html, Main, NextScript } from 'next/document';

// Global document shell. The favicon reuses the header brand mark (the ">_"
// symbol) so the browser tab matches the app identity.
// The ?v= query keeps CDNs (Cloudflare cached an older HTML response for the
// plain paths) from serving a stale asset.
const ICON_VERSION = 'v2';

export default function Document() {
    return (
        <Html lang="en">
            <Head>
                <link rel="icon" href={`/favicon.ico?${ICON_VERSION}`} sizes="any" />
                <link rel="icon" type="image/svg+xml" href={`/favicon.svg?${ICON_VERSION}`} />
                <link rel="apple-touch-icon" href={`/apple-touch-icon.png?${ICON_VERSION}`} />
                <meta name="theme-color" content="#1e1e1e" />
            </Head>
            <body>
                <Main />
                <NextScript />
            </body>
        </Html>
    );
}
