/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: '#F5F7F6',
        brand: {
          DEFAULT: '#0F766E',
          deep: '#115E59',
          soft: '#CCFBF1',
          mist: '#F0FDFA',
          ink: '#134E4A',
        },
        edge: '#E5E7EB',
        mute: '#9CA3AF',
        ink: {
          DEFAULT: '#1F1F2E',
          soft: '#6B7280',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        card: '0 4px 24px rgba(15, 118, 110, 0.06), 0 1px 3px rgba(15, 23, 42, 0.04)',
        prompt: '0 8px 32px rgba(15, 118, 110, 0.08), 0 2px 8px rgba(15, 23, 42, 0.04)',
      },
    },
  },
  plugins: [],
};
