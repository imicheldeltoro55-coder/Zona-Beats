const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

// Duración máxima que soportamos mezclar (evita cuelgues con archivos absurdamente largos)
const MAX_DURATION_SECONDS = 60 * 60; // 1 hora

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args);
    let stderr = '';
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    proc.on('error', (err) => reject(new Error(`No se pudo ejecutar ffmpeg: ${err.message}`)));
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg terminó con código ${code}: ${stderr.slice(-800)}`));
    });
  });
}

function getDurationSeconds(filePath) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'csv=p=0',
      filePath,
    ]);
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    proc.on('error', (err) => reject(new Error(`No se pudo ejecutar ffprobe: ${err.message}`)));
    proc.on('close', (code) => {
      const seconds = parseFloat(stdout.trim());
      if (code !== 0 || isNaN(seconds)) {
        reject(new Error(`No se pudo leer la duración del audio: ${stderr.slice(-400)}`));
        return;
      }
      resolve(seconds);
    });
  });
}

/**
 * Mezcla una marca de agua de voz sobre una pista completa, repitiéndola cada
 * `intervalSeconds` a volumen `volume` (0 a 1). Devuelve la ruta del archivo mezclado.
 * Si algo falla, lanza un error — quien llama decide si aborta la subida o no.
 */
async function applyWatermark({ inputPath, watermarkPath, outputPath, intervalSeconds, volume }) {
  if (!fs.existsSync(inputPath)) throw new Error('Archivo de audio de entrada no encontrado');
  if (!fs.existsSync(watermarkPath)) throw new Error('Archivo de marca de agua no encontrado');

  const duration = await getDurationSeconds(inputPath);
  if (duration > MAX_DURATION_SECONDS) {
    throw new Error(`El audio dura más de ${MAX_DURATION_SECONDS / 60} minutos, no se puede procesar`);
  }

  const safeInterval = Math.max(5, Math.min(600, Number(intervalSeconds) || 20));
  const safeVolume = Math.max(0.05, Math.min(1, Number(volume) || 0.35));

  // Silencio de relleno entre repeticiones de la voz, calculado en el propio filtro con apad,
  // y luego 'aloop' repite ese bloque (voz + silencio) indefinidamente hasta cubrir la pista completa.
  // -1 en aloop = loop infinito; 'size' es el tamaño del buffer en samples a 44.1kHz mono.
  const loopBufferSamples = Math.round(safeInterval * 44100);

  const filterComplex =
    `[1:a]aformat=sample_rates=44100:channel_layouts=mono,` +
    `apad=whole_dur=${safeInterval},` +
    `aloop=loop=-1:size=${loopBufferSamples}[wm];` +
    `[0:a][wm]amix=inputs=2:duration=first:dropout_transition=0:weights=1 ${safeVolume}[out]`;

  await runFfmpeg([
    '-y',
    '-i', inputPath,
    '-i', watermarkPath,
    '-filter_complex', filterComplex,
    '-map', '[out]',
    '-ar', '44100',
    '-ac', '2',
    '-t', String(duration),
    outputPath,
  ]);

  return outputPath;
}

module.exports = { applyWatermark, getDurationSeconds };
