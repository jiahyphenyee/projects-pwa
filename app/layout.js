import './globals.css';
import ServiceWorker from '@/app/components/ServiceWorker';

export const metadata = {
  title:       'Projects',
  description: 'Project and cost tracking',
  manifest:    '/manifest.json',
  appleWebApp: {
    capable:        true,
    title:          'Projects',
    statusBarStyle: 'default',
  },
  icons: {
    icon:  [{ url: '/icon-192.png', sizes: '192x192', type: 'image/png' }],
    apple: [{ url: '/icon-192.png', sizes: '192x192', type: 'image/png' }],
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
