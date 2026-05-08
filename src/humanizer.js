// Simula comportamiento humano: typing indicator + delay variable según largo del mensaje

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Calcula el delay de "escritura" entre 5 y 20 segundos según el largo del mensaje.
 * Fórmula: 1.5s base + ~1s por cada 25 caracteres, clampado entre 5s-20s.
 */
export function calculateDelay(text) {
  const base    = 1500;
  const perChar = 40; // ms por carácter (simula ~375 chars/min ≈ ~75 WPM)
  const total   = base + text.length * perChar;
  return Math.min(20_000, Math.max(5_000, total));
}

/**
 * Muestra "escribiendo..." en WhatsApp durante el tiempo calculado,
 * luego pausa brevemente antes de que el caller envíe el mensaje.
 */
export async function simulateTyping(sock, jid, responseText) {
  const delay = calculateDelay(responseText);

  try {
    await sock.sendPresenceUpdate('composing', jid);
    await sleep(delay);
    await sock.sendPresenceUpdate('paused', jid);
    await sleep(400); // pequeña pausa natural antes de enviar
  } catch {
    // Las actualizaciones de presencia son best-effort
  }
}
