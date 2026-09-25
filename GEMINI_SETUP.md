# Configuración de Gemini para redacción técnica

La función de redacción técnica se ejecuta únicamente en el backend. La clave nunca debe colocarse en variables `VITE_*`, en el frontend ni dentro del repositorio.

## Variables del backend

Agregue estas variables en `backend/.env` para desarrollo local y en **Environment** del servicio de Render:

```env
GEMINI_API_KEY=SU_CLAVE_DE_GEMINI
GEMINI_MODEL=gemini-3.5-flash
GEMINI_FALLBACK_MODELS=gemini-3.1-flash-lite,gemini-2.5-flash-lite
GEMINI_TIMEOUT_MS=65000
GEMINI_TOTAL_TIMEOUT_MS=210000
GEMINI_MAX_RETRIES=1
```

`GEMINI_MODEL` es opcional. Si no se establece, el backend utiliza `gemini-3.5-flash`.

La redacción de boletas usa una cadena de modelos. Si el modelo activo alcanza cuota (`429`), no está disponible o supera el tiempo por modelo, el backend continúa con el siguiente modelo configurado. Los modelos agotados por cuota entran además en cooldown para no insistir sobre ellos en solicitudes posteriores.

Los valores recomendados en Render dejan hasta 65 segundos a un modelo individual y un presupuesto máximo de 210 segundos para toda la cadena. El navegador espera hasta 240 segundos en las rutas de redacción para no cancelar antes que el backend.

## Google Cloud / Google AI Studio

1. Mantenga habilitada la API de Gemini o Generative Language API en el proyecto correspondiente.
2. Cree una API key para el backend.
3. Restrinja la clave a la API de Gemini/Generative Language cuando la consola lo permita.
4. No comparta la clave ni la guarde en GitHub.

## Prueba local

Reinicie el backend después de cambiar `.env`:

```powershell
cd backend
npm run dev
```

En una boleta, vaya al paso **Trabajo realizado**, escriba al menos uno de estos campos y pulse **Mejorar los cinco campos**:

- Razón de visita
- Descripción
- Pruebas realizadas
- Resultado
- Recomendaciones

Gemini devuelve una versión técnica, pero el usuario debe revisarla antes de guardar o finalizar. El botón **Deshacer** restaura la redacción anterior.

## Errores comunes

- `GEMINI_NOT_CONFIGURED`: falta `GEMINI_API_KEY`.
- `GEMINI_QUOTA_EXCEEDED`: todos los modelos disponibles alcanzaron temporalmente su cuota.
- `GEMINI_QUOTA_COOLDOWN`: los modelos configurados siguen en cooldown por cuota.
- `GEMINI_TEMPORARILY_UNAVAILABLE`: se probaron los modelos alternativos pero ninguno respondió dentro del presupuesto disponible.
- `GEMINI_REQUEST_FAILED`: la clave o la API rechazaron una solicitud que no puede resolverse cambiando de modelo.
