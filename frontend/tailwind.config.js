/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: '#F7F8FA',
        brand: {
          DEFAULT: '#0F766E',
          deep: '#115E59',
          soft: '#CCFBF1',
          mist: '#F0FDFA',
          ink: '#1F2023',
        },
        edge: '#E8EAED',
        mute: '#9CA3AF',
        ink: {
          DEFAULT: '#1F2023',
          soft: '#5F6368',
        },
        surface: {
          DEFAULT: '#FFFFFF',
          muted: '#F1F3F4',
          dark: '#1F2023',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        card: '0 4px 24px rgba(15, 118, 110, 0.06), 0 1px 3px rgba(15, 23, 42, 0.04)',
        prompt: '0 8px 30px rgba(0, 0, 0, 0.18), 0 2px 8px rgba(15, 23, 42, 0.06)',
      },
    },
  },
  plugins: [],
};
