import 'dotenv/config';
import { connectToWhatsApp } from './client.js';

if (!process.env.GEMINI_API_KEY) {
  console.error('❌ Falta GEMINI_API_KEY en el archivo .env');
  console.error('   Crea un .env copiando .env.example y añade tu clave de Gemini.');
  process.exit(1);
}

console.log('🥦 Iniciando NutriBot...');
connectToWhatsApp().catch(err => {
  console.error('Error fatal:', err);
  process.exit(1);
});
