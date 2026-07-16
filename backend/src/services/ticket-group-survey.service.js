import { ensureSurveyForTicket } from '../modules/survey.module.js';
import { ensureTestSurveyForTicket } from './test-survey.service.js';
import { ensureVisitGroupForTicket } from './ticket-visit-group.service.js';

function withGroupData(survey, group, testMode) {
  return {
    ...survey,
    ticketUid: group.rootId,
    ticketNumber: group.visits.map((ticket) => ticket.BoletaID || ticket.BoletaUID).join(', '),
    ticketTitle: group.visits.length > 1
      ? `${testMode ? '[PRUEBA] ' : ''}Seguimiento de ${group.visits.length} visitas - ${group.root.Titulo || 'Servicio técnico'}`
      : survey.ticketTitle,
    groupId: group.id,
    visitCount: group.visits.length,
  };
}

export async function ensureSurveyForVisitGroup(options) {
  const group = await ensureVisitGroupForTicket(options.ticketId, options.actor || 'SISTEMA');
  const survey = await ensureSurveyForTicket({ ...options, ticketId: group.rootId });
  return withGroupData(survey, group, false);
}

export async function ensureTestSurveyForVisitGroup(options) {
  const group = await ensureVisitGroupForTicket(options.ticketId, options.actor || 'SISTEMA');
  const survey = await ensureTestSurveyForTicket({ ...options, ticketId: group.rootId });
  return withGroupData(survey, group, true);
}
