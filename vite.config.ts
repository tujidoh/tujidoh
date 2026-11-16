import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// base: './' にすることで、ビルド結果をどのパスに置いても動作します
export default defineConfig({
  base: './',
  plugins: [react()],
  build: { chunkSizeWarningLimit: 800 }, // 個人利用のため1ファイルで十分（gzip 約190KB）
})
