import React, { useState, useEffect, useRef } from 'react';
// Añade esta línea para que TypeScript reconozca JSX.Element
import type { JSX } from 'react';
import { useRouter } from 'next/router';
import { FiFilePlus, FiSave } from 'react-icons/fi';
import hljs from 'highlight.js/lib/core';
import 'highlight.js/styles/github-dark.css'; // Puedes cambiar el tema si quieres
import javascript from 'highlight.js/lib/languages/javascript';
import python from 'highlight.js/lib/languages/python';
import typescript from 'highlight.js/lib/languages/typescript';
import bash from 'highlight.js/lib/languages/bash';
import json from 'highlight.js/lib/languages/json';
import java from 'highlight.js/lib/languages/java';
import kotlin from 'highlight.js/lib/languages/kotlin';

// Registra los lenguajes que quieras soportar
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('python', python);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('json', json);
hljs.registerLanguage('java', java);
hljs.registerLanguage('kotlin', kotlin);

// Usa SVGs originales de los lenguajes más comunes
const langDisplay = {
    java: 'Java',
    jav: 'Java',
    kotlin: 'Kotlin',
    typescript: 'TypeScript',
    javascript: 'JavaScript',
    python: 'Python',
    bash: 'Bash',
    sh: 'Bash',
    shell: 'Bash',
    plaintext: 'Texto plano',
    jsx: 'React',
    tsx: 'React',
    react: 'React',
    // ...otros si quieres...
} as Record<string, string>;

const langSVGs: Record<string, JSX.Element> = {
    Java: (
        // SVG Java oficial (taza de café) de simpleicons.org/icons/java.svg
        <svg width="20" height="20" viewBox="0 0 24 24" style={{verticalAlign: 'middle'}} xmlns="http://www.w3.org/2000/svg">
            <title>Java</title>
            <path d="M8.851 18.56s-1.084.63.772.84c2.25.256 3.398.219 5.877-.246 0 0 .653.41 1.563.765-5.557 2.38-12.566-.138-8.212-1.359zm-.708-2.02s-1.216.9.642 1.094c2.406.248 4.304.27 7.592-.363 0 0 .454.461 1.17.712-6.727 1.97-14.213.155-9.404-1.443zm11.354 3.356s.803.663-.885 1.177c-3.216.974-13.41 1.267-16.228.039-1.018-.443.888-1.057 1.488-1.188.624-.137.98-.112.98-.112-.112-.079-.724-.155-1.28.028-1.037.346-1.674.935-.673 1.334 6.87 2.782 18.828 1.18 16.885-.106zm-10.964-5.68s-2.563.609-.908 1.664c2.77.84 9.922 1.09 12.022.033.755-.368-0.908-1.634-0.908-1.634-.189.075-.548.159-.548.159.444.177.646.285.464.613-1.785.363-7.504.497-9.646-.11-.304-.075-.24-.237.096-.38-.001 0-.223-.016-.572-.145zm9.527-13.216c0 0 1.466 1.466-1.39 3.726-2.282 1.807-.521 2.84.001 4.021-.133-.149-2.292-2.162 1.09-4.885.771-.6.544-1.13.299-1.862zm-7.924 8.97s-1.624 1.289.857 1.654c3.13.426 5.637.366 9.965-.426 0 0 .285.116.617.36-7.053 2.06-15.47.162-12.439-1.484zm11.36 6.1c7.186-3.73 3.868-7.322 1.547-6.844-0.567.117-.822.219-.822.219s.211-.332.617-.476c4.617-1.617 8.168 4.782-1.492 7.11-.001 0 .112-.101.15-.009zm-10.13-9.7c2.282 2.6 8.682 2.02 10.548.072-1.17 1.17-3.36 2.38-6.682 2.02-2.11-.236-4.211-.938-3.866-2.092zm8.36 13.13c-2.406.456-6.07.446-8.022.012-.126-.027-.15.03-.016.067 0 0 0.603.497 2.07.712 2.624.36 6.003.028 7.646-.34.001 0 .151.123-.178.22z" fill="#007396"/>
        </svg>
    ),
    Kotlin: (
        // SVG oficial de Kotlin desde simpleicons.org/icons/kotlin.svg
        <svg width="20" height="20" viewBox="0 0 24 24" style={{verticalAlign: 'middle'}} xmlns="http://www.w3.org/2000/svg">
            <title>Kotlin</title>
            <path d="M24 24H0V0h24L12 12Z" fill="#7F52FF"/>
        </svg>
    ),
    Bash: (
        // SVG oficial de GNU Bash desde simpleicons.org/icons/gnubash.svg
        <svg width="20" height="20" viewBox="0 0 24 24" style={{verticalAlign: 'middle'}} xmlns="http://www.w3.org/2000/svg">
            <title>GNU Bash</title>
            <path d="M21.038,4.9l-7.577-4.498C13.009,0.134,12.505,0,12,0c-0.505,0-1.009,0.134-1.462,0.403L2.961,4.9 C2.057,5.437,1.5,6.429,1.5,7.503v8.995c0,1.073,0.557,2.066,1.462,2.603l7.577,4.497C10.991,23.866,11.495,24,12,24 c0.505,0,1.009-0.134,1.461-0.402l7.577-4.497c0.904-0.537,1.462-1.529,1.462-2.603V7.503C22.5,6.429,21.943,5.437,21.038,4.9z M15.17,18.946l0.013,0.646c0.001,0.078-0.05,0.167-0.111,0.198l-0.383,0.22c-0.061,0.031-0.111-0.007-0.112-0.085L14.57,19.29 c-0.328,0.136-0.66,0.169-0.872,0.084c-0.04-0.016-0.057-0.075-0.041-0.142l0.139-0.584c0.011-0.046,0.036-0.092,0.069-0.121 c0.012-0.011,0.024-0.02,0.036-0.026c0.022-0.011,0.043-0.014,0.062-0.006c0.229,0.077,0.521,0.041,0.802-0.101 c0.357-0.181,0.596-0.545,0.592-0.907c-0.003-0.328-0.181-0.465-0.613-0.468c-0.55,0.001-1.064-0.107-1.072-0.917 c-0.007-0.667,0.34-1.361,0.889-1.8l-0.007-0.652c-0.001-0.08,0.048-0.168,0.111-0.2l0.37-0.236 c0.061-0.031,0.111,0.007,0.112,0.087l0.006,0.653c0.273-0.109,0.511-0.138,0.726-0.088c0.047,0.012,0.067,0.076,0.048,0.151 l-0.144,0.578c-0.011,0.044-0.036,0.088-0.065,0.116c-0.012,0.012-0.025,0.021-0.038,0.028c-0.019,0.01-0.038,0.013-0.057,0.009 c-0.098-0.022-0.332-0.073-0.699,0.113c-0.385,0.195-0.52,0.53-0.517,0.778c0.003,0.297,0.155,0.387,0.681,0.396 c0.7,0.012,1.003,0.318,1.01,1.023C16.105,17.747,15.736,18.491,15.17,18.946z M19.143,17.859c0,0.06-0.008,0.116-0.058,0.145 l-1.916,1.164c-0.05,0.029-0.09,0.004-0.09-0.056v-0.494c0-0.06,0.037-0.093,0.087-0.122l1.887-1.129 c0.05-0.029,0.09-0.004,0.09,0.056V17.859z M20.459,6.797l-7.168,4.427c-0.894,0.523-1.553,1.109-1.553,2.187v8.833 c0,0.645,0.26,1.063,0.66,1.184c-0.131,0.023-0.264,0.039-0.398,0.039c-0.42,0-0.833-0.114-1.197-0.33L3.226,18.64 c-0.741-0.44-1.201-1.261-1.201-2.142V7.503c0-0.881,0.46-1.702,1.201-2.142l7.577-4.498c0.363-0.216,0.777-0.33,1.197-0.33 c0.419,0,0.833,0.114,1.197,0.33l7.577,4.498c0.624,0.371,1.046,1.013,1.164,1.732C21.686,6.557,21.12,6.411,20.459,6.797z"/>
        </svg>
    ),
    React: (
        // SVG oficial de React desde simpleicons.org/icons/react.svg
        <svg width="20" height="20" viewBox="0 0 24 24" style={{verticalAlign: 'middle'}} xmlns="http://www.w3.org/2000/svg">
            <title>React</title>
            <g>
                <circle cx="12" cy="12" r="2.05" fill="#61DAFB"/>
                <g stroke="#61DAFB" strokeWidth="1.2" fill="none">
                    <ellipse rx="10" ry="4.5" cx="12" cy="12" transform="rotate(0 12 12)"/>
                    <ellipse rx="10" ry="4.5" cx="12" cy="12" transform="rotate(60 12 12)"/>
                    <ellipse rx="10" ry="4.5" cx="12" cy="12" transform="rotate(120 12 12)"/>
                </g>
            </g>
        </svg>
    ),
    'TypeScript': (
        <svg width="20" height="20" viewBox="0 0 32 32" style={{verticalAlign: 'middle'}}>
            <rect width="32" height="32" rx="6" fill="#3178C6"/>
            <text x="16" y="22" textAnchor="middle" fontSize="15" fill="#fff" fontFamily="Arial, sans-serif" fontWeight="bold">TS</text>
        </svg>
    ),
    'JavaScript': (
        <svg width="20" height="20" viewBox="0 0 32 32" style={{verticalAlign: 'middle'}}>
            <rect width="32" height="32" rx="6" fill="#F7DF1E"/>
            <text x="16" y="22" textAnchor="middle" fontSize="15" fill="#222" fontFamily="Arial, sans-serif" fontWeight="bold">JS</text>
        </svg>
    ),
    Python: (
        // SVG oficial de Python desde simpleicons.org/icons/python.svg con colores nativos
        <svg width="20" height="20" viewBox="0 0 24 24" style={{verticalAlign: 'middle'}} xmlns="http://www.w3.org/2000/svg">
            <title>Python</title>
            <linearGradient id="python-a" gradientUnits="userSpaceOnUse" x1="12" y1="0" x2="12" y2="24">
                <stop offset="0" stopColor="#387EB8"/>
                <stop offset="1" stopColor="#366994"/>
            </linearGradient>
            <linearGradient id="python-b" gradientUnits="userSpaceOnUse" x1="12" y1="0" x2="12" y2="24">
                <stop offset="0" stopColor="#FFE052"/>
                <stop offset="1" stopColor="#FFC331"/>
            </linearGradient>
            <path d="M14.25.18l.9.2.73.26.59.3.45.32.34.34.25.34.16.33.1.3.04.26.02.2-.01.13V8.5l-.05.63-.13.55-.21.46-.26.38-.3.31-.33.25-.35.19-.35.14-.33.1-.3.07-.26.04-.21.02H8.77l-.69.05-.59.14-.5.22-.41.27-.33.32-.27.35-.2.36-.15.37-.1.35-.07.32-.04.27-.02.21v3.06H3.17l-.21-.03-.28-.07-.32-.12-.35-.18-.36-.26-.36-.36-.35-.46-.32-.59-.28-.73-.21-.88-.14-1.05-.05-1.23.06-1.22.16-1.04.24-.87.32-.71.36-.57.4-.44.42-.33.42-.24.4-.16.36-.1.32-.05.24-.01h.16l.06.01h8.16v-.83H6.18l-.01-2.75-.02-.37.05-.34.11-.31.17-.28.25-.26.31-.23.38-.2.44-.18.51-.15.58-.12.64-.1.71-.06.77-.04.84-.02 1.27.05z" fill="url(#python-a)"/>
            <path d="M7.95 2.16a.7.7 0 00-.41.09l-.33.22-.23.33-.08.41.08.41.23.34.33.22.41.09.41-.09.33-.22.23-.34.08-.41-.08-.41-.23-.33-.33-.22a.7.7 0 00-.41-.09zm13.09 3.95l.28.06.32.12.35.18.36.27.36.35.35.47.32.59.28.73.21.88.14 1.04.05 1.23-.06 1.23-.16 1.04-.24.86-.32.71-.36.57-.4.45-.42.33-.42.24-.4.16-.36.09-.32.05-.24.02-.16-.01h-8.22v.82h5.84l.01 2.76.02.36-.05.34-.11.31-.17.29-.25.25-.31.24-.38.2-.44.17-.51.15-.58.13-.64.09-.71.07-.77.04-.84.01-1.27-.04-1.07-.14-.9-.2-.73-.25-.59-.3-.45-.33-.34-.34-.25-.34-.16-.33-.1-.3-.04-.25-.02-.2.01-.13v-5.34l.05-.64.13-.54.21-.46.26-.38.3-.32.33-.24.35-.2.35-.14.33-.1.3-.06.26-.04.21-.02.13-.01h5.84l.69-.05.59-.14.5-.21.41-.28.33-.32.27-.35.2-.36.15-.36.1-.35.07-.32.04-.28.02-.21V6.07h2.09l.14.01z" fill="url(#python-b)"/>
            <circle cx="8.5" cy="3.5" r="1" fill="#fff"/>
            <circle cx="15.5" cy="20.5" r="1" fill="#fff"/>
        </svg>
    ),
    'Texto plano': (
        <svg width="20" height="20" viewBox="0 0 32 32" style={{verticalAlign: 'middle'}}>
            <rect width="32" height="32" rx="6" fill="#888"/>
            <text x="16" y="22" textAnchor="middle" fontSize="13" fill="#fff" fontFamily="Arial, sans-serif" fontWeight="bold">TXT</text>
        </svg>
    ),
};

// Cambia getLangDisplayAndIcon para recibir content como argumento obligatorio
function getLangDisplayAndIcon(lang: string, content: string | undefined) {
    const l = (lang || '').toLowerCase();
    let display = langDisplay[l] || langDisplay[lang] || lang;

    // Detección robusta de React: solo si es JSX/TSX o import React explícito
    if (
        l === 'jsx' || l === 'tsx' || l === 'react' ||
        (
            (l === 'javascript' || l === 'typescript') &&
            content &&
            (
                /\bimport\s+React\b/.test(content) ||
                /\bfrom\s+['"]react['"]/.test(content) ||
                /import\s+\{[^}]*\}\s+from\s+['"]react['"]/.test(content) ||
                /import\s+\*\s+as\s+React\s+from\s+['"]react['"]/.test(content)
            )
        )
    ) {
        display = 'React';
    } else if (l === 'java' || l.startsWith('java')) {
        display = 'Java';
    } else if (l === 'kotlin' || l.startsWith('kotlin')) {
        display = 'Kotlin';
    } else if (l === 'bash' || l === 'sh' || l === 'shell' || l.startsWith('bash')) {
        display = 'Bash';
    } else if (l === 'typescript' || l.startsWith('typescript')) {
        display = 'TypeScript';
    } else if (l === 'javascript' || l.startsWith('javascript')) {
        display = 'JavaScript';
    } else if (l === 'python' || l.startsWith('python')) {
        display = 'Python';
    } else if (l.startsWith('plain')) {
        display = 'Texto plano';
    }

    return {
        display,
        icon: langSVGs[display] || langSVGs['Texto plano'],
    };
}

const PastePreview = () => {
    const [content, setContent] = useState('');
    const [name, setName] = useState('');
    const [permanent, setPermanent] = useState(false);
    const [expiresAt, setExpiresAt] = useState<string | null>(null);
    const [timeLeftLabel, setTimeLeftLabel] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const router = useRouter();
    const { id } = router.query;
    const codeRef = useRef<HTMLElement>(null);
    const [showImports, setShowImports] = useState(false);

    useEffect(() => {
        // Only fetch if id is a string (not undefined or array)
        if (typeof id === 'string') {
            setLoading(true);
            fetch(`/api/paste/${id}`)
                .then((response) => {
                    if (!response.ok) {
                        throw new Error(`HTTP error! status: ${response.status}`);
                    }
                    return response.json();
                })
                .then((data) => {
                    if (typeof data.content === 'string') {
                        setContent(data.content);
                    } else {
                        setContent('Failed to load paste.');
                    }
                    setName(typeof data.name === 'string' ? data.name : '');
                    setPermanent(data.permanent === true || data.permanent === 'true');
                    if (data && typeof data.expiresAt === 'string') {
                        setExpiresAt(data.expiresAt);
                        // Broadcast refreshed expiration so other tabs update their countdown
                        import('../utils/broadcast')
                            .then((mod) => {
                                try {
                                    mod.postMessage({
                                        type: 'paste_touched',
                                        id: id,
                                        expiresAt: data.expiresAt,
                                    });
                                } catch {
                                    // ignore broadcast errors
                                }
                            })
                            .catch(() => {});
                    } else {
                        setExpiresAt(null);
                    }
                })
                .catch(() => {
                    setContent('Failed to load paste.');
                })
                .finally(() => setLoading(false));
        }
    }, [id]);

    useEffect(() => {
        if (codeRef.current) {
            hljs.highlightElement(codeRef.current);
        }
    }, [content]);

    // Listen for paste_touched messages so all open previews stay in sync
    useEffect(() => {
        let cleanup: (() => void) | undefined;
        if (typeof window === 'undefined') return () => {};

        import('../utils/broadcast')
            .then((mod) => {
                try {
                    cleanup = mod.listen((msg) => {
                        if (!msg) return;
                        if (msg.type === 'paste_touched' && typeof id === 'string' && msg.id === id) {
                            if (msg.expiresAt) {
                                setExpiresAt(msg.expiresAt);
                            }
                        }
                    });
                } catch {
                    // ignore listener errors
                }
            })
            .catch(() => {});

        return () => {
            if (cleanup) cleanup();
        };
    }, [id]);

    // Actualiza la etiqueta de cuenta atrás para pastes temporales (en tiempo real)
    useEffect(() => {
        if (!expiresAt || permanent) {
            setTimeLeftLabel(null);
            return;
        }

        const updateLabel = () => {
            const target = new Date(expiresAt).getTime();
            if (!target || Number.isNaN(target)) {
                setTimeLeftLabel(null);
                return;
            }
            const diff = target - Date.now();
            if (diff <= 0) {
                setTimeLeftLabel('Deleting soon');
                return;
            }
            const totalSeconds = Math.floor(diff / 1000);
            const days = Math.floor(totalSeconds / 86400);
            const hours = Math.floor((totalSeconds % 86400) / 3600);
            const minutes = Math.floor((totalSeconds % 3600) / 60);
            const seconds = totalSeconds % 60;

            const parts: string[] = [];
            if (days > 0) parts.push(`${days}d`);
            if (hours > 0 || days > 0) parts.push(`${hours}h`);
            if (minutes > 0 || hours > 0 || days > 0) parts.push(`${minutes}m`);
            parts.push(`${seconds}s`);

            setTimeLeftLabel(`Deleting in: ${parts.join(' ')}`);
        };

        updateLabel();
        const intervalId = window.setInterval(updateLabel, 1000); // actualiza cada segundo
        return () => window.clearInterval(intervalId);
    }, [expiresAt, permanent]);

    // Detección de lenguaje completamente automática y agnóstica
    let detectedLang = 'plaintext';
    let highlighted = content || '';
    if (content) {
        const result = hljs.highlightAuto(content);
        detectedLang = result.language || 'plaintext';
        highlighted = result.value;
    }

    let code = content || '';
    let beforeImports = '';
    let importBlock = '';
    let afterImports = '';

    if (code) {
        // Detecta el bloque de imports de forma robusta recorriendo las líneas
        const lines = code.split(/\r?\n/);
        let start = -1;
        let end = -1;

        const isImportLine = (line: string) => /^(\s*)import(\s+type|\s+static|\s+)/.test(line);
        const isBlankOrComment = (line: string) => /^(\s*$|\s*\/\/.*$)/.test(line);

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            if (start === -1) {
                // Aún no hemos encontrado el primer import
                if (isImportLine(line)) {
                    start = i;
                    end = i;
                }
            } else {
                // Ya dentro del bloque de imports: permitimos más imports,
                // líneas en blanco y comentarios entre ellos
                if (isImportLine(line) || isBlankOrComment(line)) {
                    end = i;
                } else {
                    break;
                }
            }
        }

        if (start !== -1) {
            beforeImports = lines.slice(0, start).join('\n');
            importBlock = lines.slice(start, end + 1).join('\n');
            afterImports = lines.slice(end + 1).join('\n');
        } else {
            beforeImports = code;
        }
    }

    // Divide los imports en líneas
    const importLines = importBlock
        ? importBlock.split(/\r?\n/).filter(line => line.trim().length > 0)
        : [];

    // Resalta cada parte por separado
    const beforeHtml = hljs.highlightAuto(beforeImports, [detectedLang]).value;
    const afterHtml = hljs.highlightAuto(afterImports, [detectedLang]).value;

    // Para los imports, resalta cada línea individualmente
    const importLinesHtml = importLines.map(line =>
        hljs.highlightAuto(line, [detectedLang]).value
    );

    const renderImports = () => {
        if (!importLines.length) return null;

        if (!showImports) {
            // Mostrar solo el primer import con la flecha
            return (
                <span style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }} onClick={() => setShowImports(true)}>
                    <span
                        style={{
                            fontSize: 16,
                            transition: 'transform 0.2s',
                            transform: 'rotate(0deg)',
                            display: 'inline-block',
                            marginRight: 6,
                            color: '#90caf9',
                            userSelect: 'none',
                        }}
                    >
                        ▶
                    </span>
                    <span
                        dangerouslySetInnerHTML={{ __html: importLinesHtml[0] }}
                        style={{ display: 'inline-block' }}
                    />
                </span>
            );
        } else {
            // Mostrar todos los imports, flecha en el primero
            return (
                <span style={{ display: 'block' }}>
                    {importLines.map((line, idx) => (
                        <span
                            key={idx}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                cursor: idx === 0 ? 'pointer' : 'default',
                            }}
                            onClick={idx === 0 ? () => setShowImports(false) : undefined}
                        >
                            {idx === 0 && (
                                <span
                                    style={{
                                        fontSize: 16,
                                        transition: 'transform 0.2s',
                                        transform: 'rotate(90deg)',
                                        display: 'inline-block',
                                        marginRight: 6,
                                        color: '#90caf9',
                                        userSelect: 'none',
                                    }}
                                >
                                    ▶
                                </span>
                            )}
                            <span
                                dangerouslySetInnerHTML={{ __html: importLinesHtml[idx] }}
                                style={{ display: 'inline-block' }}
                            />
                        </span>
                    ))}
                </span>
            );
        }
    };

    const renderCode = () => {
        if (!importBlock) {
            return (
                <code
                    ref={codeRef}
                    className={`hljs ${detectedLang}`}
                    dangerouslySetInnerHTML={{ __html: highlighted }}
                    style={{
                        background: 'none',
                        color: 'inherit',
                        fontFamily: 'inherit',
                        fontSize: 'inherit',
                        lineHeight: 'inherit',
                        display: 'block',
                        whiteSpace: 'pre',
                        minWidth: '100%',
                        minHeight: '100%',
                    }}
                />
            );
        }

        return (
            <>
                {beforeImports && (
                    <div
                        dangerouslySetInnerHTML={{ __html: beforeHtml }}
                        style={{ display: 'block', whiteSpace: 'pre' }}
                    />
                )}
                {renderImports()}
                {afterImports && (
                    <div
                        dangerouslySetInnerHTML={{ __html: afterHtml }}
                        style={{ display: 'block', whiteSpace: 'pre' }}
                    />
                )}
            </>
        );
    };

    // Cambia la llamada para pasar el contenido
    const { display, icon } = getLangDisplayAndIcon(detectedLang, content);

    return (
        <div
            style={{
                minHeight: '100vh',
                height: '100vh',
                width: '100vw',
                background: '#1e1e1e', // Cambiado a #1e1e1e para igualar el editor del index
                margin: 0,
                padding: 0,
                display: 'flex',
                flexDirection: 'column',
            }}
        >
            {(name || (!permanent && timeLeftLabel)) && (
                <div
                    style={{
                        position: 'fixed',
                        top: 12,
                        right: 12,
                        zIndex: 10,
                        maxWidth: 220,
                        padding: '8px 12px',
                        background: 'rgba(40, 40, 40, 0.92)',
                        border: '1px solid rgba(255,255,255,0.12)',
                        borderRadius: 8,
                        fontSize: 13,
                        color: '#b0b0b0',
                        fontFamily: 'Fira Mono, Menlo, Monaco, Consolas, monospace',
                        boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
                        overflow: 'hidden',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                    }}
                >
                    {!permanent && timeLeftLabel && (
                        <div
                            style={{
                                marginBottom: 4,
                                fontSize: 11,
                                color: '#ffb74d',
                                whiteSpace: 'nowrap',
                            }}
                        >
                            {timeLeftLabel}
                        </div>
                    )}
                    {name && (
                        <div
                            title={name || 'Untitled'}
                            dangerouslySetInnerHTML={{
                                __html: (() => {
                                    const HR_PLACEHOLDER = '\u0001HR\u0001';
                                    const hrHtml =
                                        '<hr style="margin:6px 0;border:none;border-top:1px solid rgba(255,255,255,0.25);" />';
                                    return name
                                        .replace(/<br\s*\/?/gi, '\n')
                                        .replace(/<hr\s*\/?/gi, HR_PLACEHOLDER)
                                        .replace(/&/g, '&amp;')
                                        .replace(/</g, '&lt;')
                                        .replace(/>/g, '&gt;')
                                        .replace(/"/g, '&quot;')
                                        .replace(/\n/g, '<br />')
                                        .split(HR_PLACEHOLDER)
                                        .join(hrHtml);
                                })(),
                            }}
                        />
                    )}
                </div>
            )}
            <div
                style={{
                    width: '100vw',
                    flex: 1,
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'stretch',
                    overflow: 'hidden',
                }}
            >
                <pre
                    style={{
                        width: '100vw',
                        height: 'calc(100vh - 40px)',
                        margin: 0,
                        padding: '18px 8vw 18px 8vw',
                        fontSize: 'clamp(11px, 2vw, 15px)',
                        lineHeight: 1.8,
                        fontFamily: 'Fira Mono, Menlo, Monaco, Consolas, monospace',
                        color: '#e0e0e0',
                        background: 'none',
                        borderRadius: 0,
                        overflow: 'auto',
                        boxSizing: 'border-box',
                        outline: 'none',
                        border: 'none',
                        letterSpacing: 0.01,
                    }}
                >
                    {renderCode()}
                </pre>
            </div>
        </div>
    );
};

export default PastePreview;