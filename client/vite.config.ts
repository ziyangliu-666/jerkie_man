import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: '0.0.0.0', // 监听所有网络接口，允许远程访问
    port: 5173
  }
});

