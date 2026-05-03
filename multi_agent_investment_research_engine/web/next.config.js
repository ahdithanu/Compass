/** @type {import('next').NextConfig} */
const API_URL = process.env.API_URL || "http://127.0.0.1:8000";

module.exports = {
  async rewrites() {
    return [
      // Proxy /api/* in the browser to the FastAPI backend so the UI can
      // call relative URLs without CORS hassles in production.
      { source: "/api/:path*", destination: `${API_URL}/api/:path*` },
    ];
  },
};
