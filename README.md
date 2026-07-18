# Zona Beats

Plataforma de streaming para que un DJ suba su música y el público la escuche sin poder descargarla fácilmente. Sin dependencias externas — solo Node.js 22+ (usa `node:sqlite` nativo).

## Cómo funciona la protección del contenido

Es importante ser claro sobre esto: **ninguna plataforma (ni Spotify) puede impedir al 100% que alguien grabe el audio que sale por los parlantes o audífonos**. Eso es una limitación física, no de software.

Lo que esta app sí hace:

- El audio nunca se ofrece como descarga. Se sirve en fragmentos (streaming por rangos de bytes), igual que Spotify o YouTube.
- Cada reproducción requiere un token temporal que expira solo (30 min). El link del audio no sirve si se comparte fuera de la app.
- Click derecho, atajos de guardar (`Ctrl+S`), y herramientas de desarrollador básicas están bloqueados en la interfaz pública (disuade al usuario casual, no a alguien técnico).
- Las portadas e imágenes tampoco se pueden arrastrar/guardar fácilmente.

Esto bloquea el 95% de los intentos casuales de robo (copiar el link, descargar el MP3 directo). No bloquea a alguien grabando con otro dispositivo o software de captura de audio del sistema — eso no lo resuelve nadie.

## Estructura

```
dj-app/
├── server.js          # Servidor HTTP (rutas API + streaming + estáticos)
├── db.js              # Base de datos SQLite (nativa de Node, sin dependencias)
├── streamAuth.js       # Tokens temporales de streaming
├── public/             # Interfaz pública (lo que ve el oyente)
│   ├── index.html
│   ├── style.css
│   └── app.js
├── admin/               # Panel privado del DJ
│   ├── index.html
│   ├── admin.css
│   └── admin.js
├── uploads/
│   ├── audio/           # Archivos de audio subidos
│   └── covers/          # Portadas e imagen de perfil
└── db/                  # Base de datos SQLite (se crea sola)
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
5. Abre `http://localhost:3000/admin` para el panel del DJ (pide la contraseña que pusiste en `.env`).

No hace falta `npm install` — no tiene dependencias externas.

## Desplegar en Railway

1. Sube este proyecto a un repo de GitHub (usa el `.gitignore` incluido, que ya excluye `.env`, la base de datos y los archivos subidos).
2. En Railway, crea un nuevo proyecto desde ese repo.
3. En **Variables**, agrega:
   - `ADMIN_PASSWORD` → la contraseña real del panel
   - `ADMIN_SESSION_SECRET` → una cadena aleatoria larga (por ejemplo generada con `openssl rand -hex 32`), para que las sesiones no se invaliden si el servidor reinicia
4. Railway detecta el `package.json` y usa `node server.js` como comando de arranque automáticamente.
5. **Importante — almacenamiento persistente**: Railway borra el sistema de archivos en cada deploy. Como el audio y la base de datos se guardan en disco (`db/` y `uploads/`), necesitas agregar un **Volume** en Railway y montarlo en la carpeta raíz del proyecto (o específicamente en `/db` y `/uploads`) para que las pistas subidas no se pierdan en cada actualización.

## Venta de pistas (pago manual por transferencia)

El DJ puede poner precio a cualquier pista y activar la venta desde el panel admin. Esto **no es una pasarela de pago automática** — es un flujo manual:

1. En "Cobros y ventas" (panel admin), el DJ carga sus cuentas (banco + número) y su teléfono de WhatsApp.
2. En cada pista del catálogo, puede marcar "En venta" y poner un precio en texto libre (ej. "500 CUP", "5 USD", "300 MLC").
3. En la vista pública, si una pista tiene precio, aparece un botón "Comprar" en el reproductor.
4. Al hacer clic, se abre un modal con las cuentas (con botón de copiar) y un botón que abre WhatsApp con un mensaje prellenado mencionando la pista y el precio.
5. El comprador transfiere y confirma manualmente por WhatsApp — el DJ revisa y le envía el archivo por fuera de la app (o donde prefieran).

**Nota de seguridad**: los números de cuenta y el teléfono se guardan en la base de datos local (`db/app.db`), nunca en el código fuente. Si usas Railway con un Volume persistente, sobreviven a los despliegues igual que las pistas.

## Uso para tu amigo el DJ

1. Entra a `tuapp.railway.app/admin`
2. Pone la contraseña
3. En **"Cobros y ventas"**, carga su teléfono de WhatsApp y las cuentas bancarias donde quiere recibir pagos (solo se hace una vez, se puede editar cuando quiera)
4. Llena título, género (opcional), sube el archivo de audio y opcionalmente una portada — si quiere venderla, marca "Poner esta pista a la venta" y pone el precio (ej: "500 CUP", "5 USD")
5. Click en "Publicar pista" — aparece al instante en la página pública
6. Puede editar el precio de cualquier pista ya subida directamente desde "Tu catálogo"
7. Puede editar su nombre artístico, biografía y foto en la sección "Perfil público"
8. Puede eliminar cualquier pista desde "Tu catálogo"

## Formatos soportados

- **Audio**: MP3, WAV, M4A, OGG, FLAC (máx. 60MB por archivo)
- **Imágenes**: JPG, PNG, WEBP (máx. 8MB)
