# Configuración de Gemini para redacción técnica

La función de redacción técnica se ejecuta únicamente en el backend. La clave nunca debe colocarse en variables `VITE_*`, en el frontend ni dentro del repositorio.

## Variables del backend

Agregue estas variables en `backend/.env` para desarrollo local y en **Environment** del servicio de Render:

```env
GEMINI_API_KEY=SU_CLAVE_DE_GEMINI
GEMINI_MODEL=gemini-3.5-flash
```

`GEMINI_MODEL` es opcional. Si no se establece, el backend utiliza `gemini-3.5-flash`.

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
- `GEMINI_QUOTA_EXCEEDED`: la cuenta alcanzó el límite temporal de Gemini.
- `GEMINI_REQUEST_FAILED`: la clave no tiene acceso, el modelo no está disponible o la API no está habilitada.
