/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: '#F7F7FB',
        brand: {
          DEFAULT: '#6C4DFF',
          deep: '#5B3DF5',
          soft: '#EDE9FE',
          mist: '#F3F0FF',
          ink: '#2D1B69',
        },
        edge: '#E8E8F0',
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
        card: '0 4px 24px rgba(99, 70, 255, 0.06), 0 1px 3px rgba(15, 23, 42, 0.04)',
        prompt: '0 8px 32px rgba(99, 70, 255, 0.08), 0 2px 8px rgba(15, 23, 42, 0.04)',
      },
    },
  },
  plugins: [],
};
