import { badRequest } from '../core/errors.js';
import { customerCaseHandlers } from '../modules/customer-cases.module.js';

const INSTALL_FLAG = Symbol.for('dms.customerCasePayloadLimit');
const MAX_TOTAL_BYTES = 16 * 1024 * 1024;

function clean(value) {
  return String(value ?? '').trim();
}

function base64Bytes(value) {
  const text = clean(value);
  const comma = text.indexOf(',');
  const encoded = comma >= 0 && text.slice(0, comma).includes('base64')
    ? text.slice(comma + 1)
    : text;
  if (!encoded) return 0;
  const normalized = encoded.replace(/[\r\n\s]/g, '');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) return 0;
  const padding = normalized.endsWith('==') ? 2 : normalized.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor(normalized.length * 3 / 4) - padding);
}

function evidenceBytes(payload = {}) {
  const evidences = Array.isArray(payload.evidences)
    ? payload.evidences
    : Array.isArray(payload.evidencias)
      ? payload.evidencias
      : [];
  return evidences.reduce((total, evidence) => total + base64Bytes(
    evidence?.base64 || evidence?.dataUrl || evidence?.fileBase64,
  ), 0);
}

if (!customerCaseHandlers[INSTALL_FLAG]) {
  const publicGet = customerCaseHandlers.publicGet;
  customerCaseHandlers.publicGet = async (ctx) => {
    const result = await publicGet(ctx);
    return {
      ...result,
      limits: {
        ...(result?.limits || {}),
        maxTotalMb: MAX_TOTAL_BYTES / 1024 / 1024,
      },
    };
  };

  const publicSubmit = customerCaseHandlers.publicSubmit;
  customerCaseHandlers.publicSubmit = async (ctx) => {
    if (evidenceBytes(ctx.payload) > MAX_TOTAL_BYTES) {
      throw badRequest('Las evidencias superan el límite total de 16 MB. Reduzca la cantidad o el tamaño de las imágenes.');
    }
    return publicSubmit(ctx);
  };

  customerCaseHandlers[INSTALL_FLAG] = true;
}

export const CUSTOMER_CASE_PUBLIC_PAYLOAD_LIMIT = MAX_TOTAL_BYTES;
