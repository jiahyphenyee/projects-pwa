/** @type {import('next').NextConfig} */
const nextConfig = {
  /* config options here */
  reactCompiler: true,
  // The quote PDF reads its logo from disk. Files only read at runtime are not traced into
  // the server bundle on their own, so name them for the routes that make the PDF.
  outputFileTracingIncludes: {
    '/api/quotes/pdf': ['./assets/**/*'],
    '/api/quotes/bill': ['./assets/**/*'],
  },
};

export default nextConfig;
