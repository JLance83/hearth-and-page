/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      // Palette mirrors the legacy app's tokens where practical so /app-v2/
      // screens don't look out-of-place next to /* screens. Adjust as we
      // build out shared design tokens.
      colors: {
        // Hearth & Page green (from legacy CSS)
        hp: {
          primary: '#0f766e',   // teal-700
          accent: '#14b8a6',    // teal-500
          ink: '#0f172a',       // slate-900
          muted: '#64748b',     // slate-500
          surface: '#f8fafc',   // slate-50
          border: '#e2e8f0',    // slate-200
        },
      },
      fontFamily: {
        sans: ['system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
