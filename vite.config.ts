import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({plugins:[react()],server:{host:'127.0.0.1',port:5173,strictPort:true,watch:{ignored:['**/.qa-data/**','**/tests/artifacts*/**','**/tests/report/**','**/data/**']},proxy:{'/api':process.env.VITE_API_PROXY || 'http://127.0.0.1:3100'}},build:{outDir:'dist',sourcemap:false}});
