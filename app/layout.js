import './globals.css';
import ServiceWorker from '@/app/components/ServiceWorker';

export const metadata = {
  title:       'HFC Projects',
  description: 'Project and cost tracking',
  manifest:    '/manifest.json',
  appleWebApp: {
    capable:        true,
    // Must match manifest short_name, or the home screen label differs per platform
    title:          'HFC Projects',
    statusBarStyle: 'default',
  },
  icons: {
    icon: [
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    // iOS ignores transparency and composites onto black, so this one is flattened
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
};

export const viewport = {
  themeColor:   '#0F766E',
  width:        'device-width',
  initialScale: 1,
  // Fills the notch area so the sticky header's safe-area padding works
  viewportFit:  'cover',
  // Stops iOS zooming the page when a form field is focused
  maximumScale: 1,
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <ServiceWorker />
        {children}
      </body>
    </html>
  );
}
