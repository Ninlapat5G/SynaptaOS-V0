/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        bg0:       'var(--bg-0)',
        bg1:       'var(--bg-1)',
        panel:     'var(--panel)',
        card:      'var(--card)',
        line:      'var(--line)',
        'line-strong': 'var(--line-strong)',
        accent:    'var(--accent)',
        ink:       'var(--ink)',
        'ink-dim':  'var(--ink-dim)',
        'ink-xdim': 'var(--ink-xdim)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      borderRadius: {
        '4xl': '2rem',
      },
    },
  },
  plugins: [],
}
