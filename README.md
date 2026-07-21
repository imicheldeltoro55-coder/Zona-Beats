# Zona Beats

Plataforma de streaming para subir música y el público la escuche sin poder descargarla fácilmente. Sin dependencias externas — solo Node.js 22+ (usa `node:sqlite` nativo).

## Cómo funciona la protección del contenido

Es importante ser claro sobre esto: **ninguna plataforma (ni Spotify) puede impedir al 100% que alguien grabe el audio que sale por los parlantes o audífonos**. Eso es una limitación física, no de software. Ninguna de las capas de abajo lo cambia — solo suben el esfuerzo necesario para redistribuir el audio.

Lo que esta app sí hace:

- El audio nunca se ofrece como descarga. Se sirve en fragmentos (streaming por rangos de bytes), igual que Spotify o YouTube.
- Cada reproducción requiere un token temporal que expira solo (30 min). El link del audio no sirve si se comparte fuera de la app.
- Click derecho, atajos de guardar (`Ctrl+S`), y herramientas de desarrollador básicas están bloqueados en la interfaz pública (disuade al usuario casual, no a alguien técnico).
- Las portadas e imágenes tampoco se pueden arrastrar/guardar fácilmente.
- **Marca de agua audible** (opcional, configurable desde el panel admin en "Protección de audio"): se sube un audio corto de voz una sola vez, y el servidor lo mezcla automáticamente a bajo volumen sobre cada pista nueva que se suba, repitiéndolo cada cierto intervalo (configurable). Esto no impide grabar el audio, pero deja la marca incrustada en cualquier copia que se comparta — la misma técnica que usan los previews de SoundCloud y los packs de samples. Requiere `ffmpeg` en el servidor (ver sección de despliegue).

Esto bloquea el 95% de los intentos casuales de robo (copiar el link, descargar el MP3 directo) y desincentiva la redistribución de lo que sí se logre grabar. No bloquea a alguien grabando con otro dispositivo o software de captura de audio del sistema — eso no lo resuelve nadie.

## Estructura

```
zona-beats/
├── Dockerfile           # Imagen con Node 22 + ffmpeg (necesario para la marca de agua)
├── server.js            # Servidor HTTP (rutas API + streaming + estáticos)
├── db.js                # Base de datos SQLite (nativa de Node, sin dependencias)
├── streamAuth.js        # Tokens temporales de streaming
├── watermark.js          # Mezcla de marca de agua audible con ffmpeg
├── public/               # Interfaz pública (lo que ve el oyente)
│   ├── index.html
│   ├── style.css
│   └── app.js
├── admin/                # Panel privado de administración
│   ├── index.html
│   ├── admin.css
│   └── admin.js
├── uploads/
│   ├── audio/             # Pistas ya procesadas (las que se sirven al público)
│   ├── covers/             # Portadas e imagen de perfil
│   ├── receipts/            # Comprobantes de compra subidos por los compradores
│   ├── watermark/            # El audio de voz de la marca de agua
│   └── tmp/                   # Carpeta temporal usada durante el procesamiento con ffmpeg
└── db/                    # Base de datos SQLite (se crea sola)
```

## Cómo correrlo localmente

1. Necesitas **Node.js 22 o superior** (usa `node --version` para comprobarlo).
2. Copia `.env.example` a `.env` y cambia la contraseña del admin:
   ```
   cp .env.example .env
   ```
   Edita `.env` y pon una contraseña real en `ADMIN_PASSWORD`.
3. Arranca el servidor:
   ```
   node server.js
   ```
4. Abre `http://localhost:3000` para la vista pública.
5. Abre `http://localhost:3000/admin` para el panel de administración (pide la contraseña que pusiste en `.env`).

No hace falta `npm install` — no tiene dependencias externas.

## Desplegar en Railway

1. Sube este proyecto a un repo de GitHub (usa el `.gitignore` incluido, que ya excluye `.env`, la base de datos y los archivos subidos).
2. En Railway, crea un nuevo proyecto desde ese repo.
3. En **Variables**, agrega:
   - `ADMIN_PASSWORD` → la contraseña real del panel
   - `ADMIN_SESSION_SECRET` → una cadena aleatoria larga (por ejemplo generada con `openssl rand -hex 32`), para que las sesiones no se invaliden si el servidor reinicia
4. **Importante — este proyecto incluye un `Dockerfile`**. Railway lo detecta automáticamente y lo usa en vez de su build por defecto (Nixpacks). Esto es necesario porque instala `ffmpeg`, requerido para la marca de agua audible — sin él, cualquier intento de activar la protección de audio fallará al subir una pista. Si por algún motivo Railway no toma el Dockerfile automáticamente, en la configuración del servicio revisa que el "Builder" esté puesto en "Dockerfile" y no en "Nixpacks".
5. **Importante — almacenamiento persistente**: Railway borra el sistema de archivos en cada deploy. Como el audio, la base de datos y la voz de marca de agua se guardan en disco (`db/` y `uploads/`), necesitas agregar un **Volume** en Railway y montarlo en la carpeta raíz del proyecto (o específicamente en `/app/db` y `/app/uploads` si usas el Dockerfile) para que las pistas subidas no se pierdan en cada actualización.

## Protección de audio (marca de agua audible)

Desde el panel admin, en la sección "Protección de audio":

1. Se sube un audio corto de voz (una frase, el nombre artístico, un "tag" — unos segundos bastan).
2. Se configura cada cuántos segundos se repite (por defecto 20s) y a qué volumen se mezcla (por defecto 0.35, en una escala de 0.05 a 1).
3. A partir de ese momento, **cada pista nueva que se suba** se procesa con `ffmpeg` para mezclar esa voz por encima del audio original, repitiéndose durante toda la duración de la pista.
4. Se puede escuchar la voz configurada actualmente con el botón "Escuchar la voz actual", o quitarla del todo con "Quitar marca de agua".

Detalles importantes:

- **Solo afecta a pistas subidas después de configurarla.** Las que ya estaban publicadas no se reprocesan automáticamente — si se quiere aplicar retroactivamente, habría que volver a subirlas.
- El archivo final que se sirve al público es siempre el resultado ya mezclado (formato WAV). El archivo original que se subió no se guarda por separado.
- Si el servidor no tiene `ffmpeg` disponible (por ejemplo, si Railway no usó el Dockerfile), la subida de pistas con marca de agua activa fallará con un error claro en el panel — no se sube nada a medias ni se corrompe el catálogo.
- Como con cualquier protección de audio, esto no impide que alguien grabe la pista — su función es que, si lo hace y lo comparte, la copia lleve la marca incrustada.

## Venta de pistas (pago manual por transferencia)

Se puede poner precio a cualquier pista y activar la venta desde el panel admin. Esto **no es una pasarela de pago automática** — es un flujo manual, pero diseñado para tener el menor contacto posible con cada comprador antes de que llegue el aviso por WhatsApp:

1. En "Cobros y ventas" (panel admin), se cargan las cuentas (banco + número) y el teléfono de WhatsApp.
2. En cada pista del catálogo, puede marcar "En venta" y poner un precio en texto libre (ej. "500 CUP", "5 USD", "300 MLC").
3. En la vista pública, si una pista tiene precio, aparece un botón "Comprar" en el reproductor, que abre un modal con las cuentas (con botón de copiar).
4. El comprador transfiere, luego completa su **nombre**, su **teléfono**, y sube la **foto del comprobante**. El botón de envío permanece bloqueado hasta llenar los tres campos.
5. Al enviarlo, el comprobante (con nombre, teléfono, pista y precio) **se sube y se guarda en el servidor** — no en el navegador del comprador. Recién ahí se activa un botón "Avisar por WhatsApp", que abre un chat con un mensaje ya redactado usando el nombre real de la persona: *"Hola, soy [Nombre] 👋 Acabo de comprar '[Pista]' ([Precio]). Ya te envié el comprobante de mi transferencia a través de la plataforma. ¡Gracias!"*
6. Desde el panel admin se ve la sección "Comprobantes de compra" con la foto, nombre, teléfono y pista de cada uno, y se puede tocar "WhatsApp" para responder directo a esa persona, o eliminar el comprobante una vez procesado (para no acumular espacio).

**Sobre el límite real de WhatsApp**: ninguna página web puede adjuntar una imagen a un chat de WhatsApp de forma automática — es una restricción que WhatsApp impone deliberadamente, no algo que dependa del código de esta app. Por eso el comprobante se sube directo al servidor (no se reenvía por WhatsApp), y el mensaje de WhatsApp solo sirve para avisar y dar contexto; la evidencia real vive en el panel admin, donde ya está guardada y visible antes de intercambiar un solo mensaje con el comprador.

**Nota de seguridad**: los números de cuenta, el teléfono de contacto y los comprobantes se guardan en la base de datos y el disco locales (`db/app.db` y `uploads/receipts/`), nunca en el código fuente. Si usas Railway con un Volume persistente, sobreviven a los despliegues igual que las pistas. Recuerda eliminar los comprobantes ya procesados desde el panel admin para no acumular espacio en disco con el tiempo.

## Redes sociales

En el panel admin, sección "Redes sociales": se puede agregar, editar o quitar cualquier cantidad de links (nombre + URL), sin límite de plataformas. Se muestran como íconos circulares en la página pública, debajo del nombre y la biografía del artista.

- La plataforma se detecta automáticamente por el dominio del link: Spotify, Facebook, YouTube (incluye YouTube Music), Instagram, TikTok y SoundCloud tienen ícono propio.
- Cualquier otra red (Beatport, Twitter/X, un sitio propio, etc.) se muestra con un ícono genérico de enlace — no hace falta que la plataforma esté en una lista predefinida.
- El campo "Nombre" es lo que aparece como tooltip al pasar el cursor sobre el ícono; puede ser el nombre de la red o cualquier etiqueta.
- Los links deben empezar con `http://` o `https://`; el servidor rechaza cualquier otro esquema (por ejemplo `javascript:`) como medida de seguridad básica.
- Si no se configura ninguna red social, la fila de íconos simplemente no aparece en la página pública.

## Uso para el panel de administración

1. Entra a `tuapp.railway.app/admin`
2. Pone la contraseña
3. En **"Cobros y ventas"**, carga su teléfono de WhatsApp y las cuentas bancarias donde quiere recibir pagos (solo se hace una vez, se puede editar cuando quiera)
4. Llena título, género (opcional), sube el archivo de audio y opcionalmente una portada — si quiere venderla, marca "Poner esta pista a la venta" y pone el precio (ej: "500 CUP", "5 USD")
5. Click en "Publicar pista" — aparece al instante en la página pública
6. Puede editar el precio de cualquier pista ya subida directamente desde "Tu catálogo"
7. Puede editar su nombre artístico, biografía y foto en la sección "Perfil público"
8. Puede eliminar cualquier pista desde "Tu catálogo"

## Formatos soportados

- **Audio**: MP3, WAV, M4A, OGG, FLAC (máx. 150MB por archivo — pensado para WAV sin comprimir)
- **Imágenes**: JPG, PNG, WEBP (máx. 8MB)

## Si falla la subida de archivos grandes ("Failed to fetch")

Con archivos WAV pesados (100MB+), un error de `Failed to fetch` casi siempre viene de uno de estos tres lugares, en este orden de probabilidad:

1. **Conexión inestable / lenta**: subir 100-150MB por una red móvil o WiFi débil puede tardar varios minutos, y cualquier corte momentáneo aborta la subida. La interfaz ahora muestra una barra de progreso real — si se queda pegada o se cae, es la red, no la app. Recomendación: subir por WiFi estable, no por datos móviles.
2. **Límite del proxy de Railway**: Railway puede imponer su propio límite de tamaño de request en su capa de proxy/edge, independiente del límite que configuramos en el código (actualmente 150MB). Si las subidas grandes siguen fallando incluso con buena conexión, busca en la documentación de Railway el límite actual de "request body size" o "max upload size" para tu plan — puede requerir un plan superior o no ser ajustable.
3. **Memoria del contenedor**: el servidor carga el archivo completo en memoria durante la subida (hasta ~160MB por subida). Si el plan de Railway tiene poca RAM asignada (los planes gratuitos suelen dar 512MB-1GB), una subida grande podría hacer que el proceso se reinicie. Si ves que el servicio se "reinicia" en los logs de Railway justo cuando subes un archivo grande, es esto — considera subir de plan o comprimir los WAV a FLAC (mismo audio sin pérdida, pero bastante más liviano).


