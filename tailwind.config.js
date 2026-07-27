/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        'tertiary': '#5f5e5e', 'surface-dim': '#d9dadb', 'inverse-surface': '#2e3132',
        'background': '#f8f9fa', 'secondary-container': '#90efef', 'primary': '#904d00',
        'on-surface-variant': '#564334', 'on-primary': '#ffffff', 'error-container': '#ffdad6',
        'inverse-primary': '#ffb77d', 'surface-variant': '#e1e3e4', 'on-tertiary-container': '#3e3e3e',
        'surface-container-high': '#e7e8e9', 'on-error': '#ffffff', 'surface-container-highest': '#e1e3e4',
        'on-background': '#191c1d', 'surface-container': '#edeeef', 'on-tertiary': '#ffffff',
        'primary-container': '#ff8c00', 'on-secondary-container': '#006e6e', 'surface-bright': '#f8f9fa',
        'surface': '#f8f9fa', 'on-surface': '#191c1d', 'on-secondary': '#ffffff',
        'inverse-on-surface': '#f0f1f2', 'error': '#ba1a1a', 'surface-container-low': '#f3f4f5',
        'surface-container-lowest': '#ffffff', 'primary-fixed': '#ffdcc3', 'outline-variant': '#ddc1ae',
        'outline': '#897362', 'secondary': '#006a6a', 'surface-tint': '#904d00',
        'on-primary-container': '#623200', 'tertiary-container': '#aba9a9',
        // brand aliases
        'tangerine': '#ff8c00', 'emerald': '#008080',
      },
      fontFamily: {
        display: ['Be Vietnam Pro', 'sans-serif'],
        head: ['Be Vietnam Pro', 'sans-serif'],
        body: ['Be Vietnam Pro', 'sans-serif'],
      },
      borderRadius: { DEFAULT: '0.5rem', md: '0.75rem', lg: '1rem', xl: '1.5rem' },
    },
  },
  plugins: [require('@tailwindcss/forms'), require('@tailwindcss/container-queries')],
};
