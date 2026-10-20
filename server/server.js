/**
 * Server Entry Point
 */

const app = require('./app');

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

const isNamedPipe = isNaN(Number(PORT));
const listenArgs = isNamedPipe ? [PORT] : [PORT, HOST];

const server = app.listen(...listenArgs, () => {
  console.log('====================================================');
  console.log(`🚀 MEMEMIND Adaptive Memory Game Server`);
  console.log(`📡 Listening on ${isNamedPipe ? PORT : `http://localhost:${PORT}`}`);
  console.log(`🌐 Environment: ${process.env.NODE_ENV || 'production'}`);
  console.log('====================================================');
});

// Graceful shutdown handling
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received. Closing HTTP server gracefully...');
  server.close(() => {
    console.log('HTTP server closed.');
    process.exit(0);
  });
});
