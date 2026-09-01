# PromptVault — Desktop (versión local, para probar ya)

App de escritorio que guarda prompts localmente en tu máquina (sin nube,
sin cuentas todavía) y los copia con un clic. Se abre/oculta con el atajo
global `Ctrl+Shift+P` desde cualquier programa.

## Cómo probarlo en tu Windows, paso a paso

1. Abre una terminal (PowerShell) dentro de la carpeta `promptvault-desktop`.

2. Instala las dependencias de Node:
   ```powershell
   npm install
   ```

3. Corre la app en modo desarrollo:
   ```powershell
   npm run tauri dev
   ```
   La primera vez tarda un par de minutos porque Rust compila las
   dependencias nativas. Después de eso arranca en segundos.

4. Debería abrirse una ventana con dos categorías de ejemplo
   ("Video/Motion" con 2 prompts precargados). Prueba:
   - Hacer clic en una tarjeta → se copia el prompt (verás el ✓).
   - Cerrar la ventana (la X) y presionar `Ctrl+Shift+P` → debe reaparecer.
   - Agregar un prompt nuevo con el botón "+ Nuevo prompt".
   - Borrar uno con la ✕.

5. Los prompts quedan guardados en un archivo local
   (`prompts.json` dentro de la carpeta de datos de la app), así que
   persisten aunque cierres el programa.

## Si algo falla al compilar

- Si Rust no está actualizado: `rustup update`
- Si falta el "MSVC build tools" en Windows, Tauri te dará un link directo
  para instalarlo (es un instalador oficial de Microsoft, rápido).
- Copia el error exacto y lo revisamos juntos — es normal que la primera
  compilación tenga uno o dos ajustes pendientes.

## Qué NO tiene todavía (a propósito, para mantenerlo simple)

- Sin categorías editables (son 4 fijas por ahora)
- Sin nube/sincronización — solo vive en esta máquina
- Sin login, sin plan premium, sin anuncios
- Sin ícono propio de la app (usa el ícono por defecto de Tauri)

## Siguiente fase — cuando esto ya funcione en tu máquina

Una vez confirmes que corre bien y se siente bien de usar, seguimos con:
1. Categorías editables por el usuario
2. Conectar Supabase para sincronizar (usando `supabase_schema.sql`, que
   ya está listo para esa fase)
3. Empaquetar el instalador (`npm run tauri build`) para poder compartirlo
   o subirlo
