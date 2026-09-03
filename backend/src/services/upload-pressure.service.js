import { env } from '../config/env.js';
import { AppError } from '../core/errors.js';
import { createUploadPressureGate, megabytes } from '../core/upload-pressure.js';

const gate = createUploadPressureGate({
  softLimitBytes: megabytes(env.uploadMemorySoftLimitMb),
  reserveBytes: megabytes(env.uploadMemoryReserveMb),
  maxInFlightBytes: megabytes(env.uploadMaxInFlightMb),
  maxRequestBytes: megabytes(env.uploadBinaryMaxRequestMb),
});

function rejectionError(result) {
  if (result.reason === 'REQUEST_TOO_LARGE') {
    return new AppError(
      'PAYLOAD_TOO_LARGE',
      `La carga binaria supera el máximo de ${env.uploadBinaryMaxRequestMb} MB por solicitud.`,
      413,
    );
  }

  return new AppError(
    'UPLOAD_BACKPRESSURE',
    'El servidor está procesando otras evidencias y protegió la memoria disponible. La carga puede reintentarse en unos segundos.',
    503,
    {
      retryAfterSeconds: 2,
      reason: result.reason,
    },
  );
}

export function reserveBinaryUpload(req) {
  const declaredBytes = Number(req?.headers?.['content-length'] || 0);
  const reservation = gate.reserve(declaredBytes);
  if (!reservation.accepted) throw rejectionError(reservation);
  return reservation;
}

export function uploadPressureSnapshot() {
  return gate.snapshot();
}
