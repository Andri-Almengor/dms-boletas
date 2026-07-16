export function sanitizeTicketFileNamePart(value, fallback = 'Sin dato', maxLength = 100) {
  const clean = String(value ?? '')
    .trim()
    .replace(/[\\/:*?"<>|#%{}~&]/g, '-')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/-+/g, '-')
    .replace(/^[-.\s]+|[-.\s]+$/g, '');

  const resolved = clean || String(fallback || 'Sin dato');
  return resolved.slice(0, Math.max(1, Number(maxLength) || 100));
}

function ticketNumberPart(ticket = {}) {
  const rawNumber = sanitizeTicketFileNamePart(
    ticket.BoletaID || ticket.BoletaUID,
    'Sin numero',
    40,
  );

  return rawNumber
    .replace(/^boleta\s*#?\s*/i, '')
    .trim()
    || 'Sin numero';
}

export function ticketPdfBaseName(ticket = {}) {
  const client = sanitizeTicketFileNamePart(
    ticket.Cliente || ticket.ClienteNombre,
    'Sin cliente',
    80,
  );
  const number = ticketNumberPart(ticket);
  const title = sanitizeTicketFileNamePart(
    ticket.Titulo || ticket.Título || ticket.TituloBoleta,
    'Boleta de servicio',
    120,
  );

  return `${client}-Boleta ${number}-${title}`
    .slice(0, 230)
    .replace(/[-.\s]+$/g, '');
}

export function ticketPdfFileName(ticket = {}) {
  return `${ticketPdfBaseName(ticket)}.pdf`;
}
