import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
} from '@whiskeysockets/baileys';
import path from 'path';
import { fileURLToPath } from 'url';
import { processMessage } from './ai.js';
import { logFood, logExercise, getTodaySummary, getUserConfig, deleteLastFood } from './db.js';
import { simulateTyping } from './humanizer.js';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const AUTH_DIR   = path.join(__dirname, '..', 'auth_info_baileys');
const OWNER      = process.env.OWNER_PHONE || null; // Si está definido, solo responde al dueño

// Logger silencioso para Baileys (evita spam en consola)
const silentLogger = {
  level: 'silent',
  trace: () => {}, debug: () => {}, info: () => {},
  warn:  () => {}, error: console.error, fatal: console.error,
  child: function() { return this; },
};

// Evita procesar el mismo mensaje dos veces
const processing = new Set();

export async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version }          = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth:               state,
    logger:             silentLogger,
    printQRInTerminal:  true,
    browser:            ['Chrome (Linux)', 'Chrome', '124.0.0'],
    generateHighQualityLinkPreview: false,
    syncFullHistory:    false,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      console.log('\n📱 Escanea el QR con WhatsApp → Dispositivos vinculados → Vincular dispositivo\n');
    }
    if (connection === 'open') {
      console.log('✅ NutriBot conectado a WhatsApp');
    }
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        console.log('❌ Sesión cerrada. Elimina la carpeta auth_info_baileys/ y reinicia.');
      } else {
        console.log(`⚠️  Desconectado (${code}), reconectando en 5s...`);
        setTimeout(connectToWhatsApp, 5000);
      }
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      handleMessage(sock, msg).catch(err =>
        console.error('Error en handleMessage:', err.message)
      );
    }
  });
}

async function handleMessage(sock, msg) {
  if (msg.key.fromMe)                          return; // ignora mensajes propios
  if (msg.key.remoteJid === 'status@broadcast') return; // ignora estados

  const msgId = msg.key.id;
  if (processing.has(msgId)) return;
  processing.add(msgId);
  setTimeout(() => processing.delete(msgId), 60_000);

  const jid    = msg.key.remoteJid;
  const userId = jid.split('@')[0]; // número de teléfono como ID

  // Si OWNER_PHONE está definido, solo responder a ese número
  if (OWNER && userId !== OWNER) return;

  // Ignorar grupos si el JID termina en @g.us
  if (jid.endsWith('@g.us')) return;

  const content = extractContent(msg);
  if (!content) return;

  // Marcar como leído
  try { await sock.readMessages([msg.key]); } catch {}

  // Obtener contexto del día y config del usuario
  const summary = getTodaySummary(userId);
  const config  = getUserConfig(userId);

  // Llamar a la IA
  let aiResponse;
  try {
    if (content.type === 'image') {
      const buffer   = await downloadMediaMessage(msg, 'buffer', {});
      const mimeType = msg.message.imageMessage?.mimetype || 'image/jpeg';
      aiResponse = await processMessage({
        userId, text: content.caption || 'Analiza este alimento',
        imageBuffer: buffer, imageMime: mimeType,
        summary, config,
      });
    } else {
      aiResponse = await processMessage({
        userId, text: content.text,
        summary, config,
      });
    }
  } catch (err) {
    console.error('Error en AI:', err.message);
    await simulateTyping(sock, jid, 'Ups, algo salió mal.');
    await sock.sendMessage(jid, { text: '⚠️ Tuve un problema procesando eso. Intenta de nuevo.' });
    return;
  }

  // Ejecutar acción en la base de datos
  switch (aiResponse.action) {
    case 'log_food':
      if (aiResponse.data) logFood(userId, aiResponse.data);
      break;
    case 'log_exercise':
      if (aiResponse.data) logExercise(userId, aiResponse.data);
      break;
    case 'log_steps':
      if (aiResponse.data) logExercise(userId, {
        type:            'pasos',
        duration:        0,
        calories_burned: aiResponse.data.calories_burned || 0,
        steps:           aiResponse.data.steps           || 0,
      });
      break;
    case 'delete_last':
      deleteLastFood(userId);
      break;
  }

  // Simular escritura humana y enviar
  const responseText = aiResponse.message || '✅';
  await simulateTyping(sock, jid, responseText);
  await sock.sendMessage(jid, { text: responseText });
}

function extractContent(msg) {
  const m = msg.message;
  if (!m) return null;

  // Mensaje de texto simple
  if (m.conversation)              return { type: 'text', text: m.conversation };
  if (m.extendedTextMessage?.text) return { type: 'text', text: m.extendedTextMessage.text };

  // Imagen (con o sin caption)
  if (m.imageMessage) return { type: 'image', caption: m.imageMessage.caption || '' };

  return null;
}
