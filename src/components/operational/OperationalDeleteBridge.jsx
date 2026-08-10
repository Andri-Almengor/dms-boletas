import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../AuthContext';
import { MODULE_ROUTES, requestAvailable } from '../../services/moduleApi';

function buttonMarkup(icon, label) {
  return `<span class="material-symbols-outlined" aria-hidden="true">${icon}</span><span>${label}</span>`;
}

function maintenanceIsPending() {
  return [...document.querySelectorAll('.maintenance-detail-page .status-chip, .maintenance-detail-page .maintenance-mobile-fold__badge')]
    .some((node) => String(node.textContent || '').trim().toUpperCase().startsWith('PENDIENTE'));
}

function maintenanceDeviceId(container) {
  const text = String(container.querySelector('.maintenance-inventory-device-id')?.textContent || '');
  return text.replace(/^\s*ID:\s*/i, '').trim();
}

export default function OperationalDeleteBridge() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { sessionToken, hasPermission } = useAuth();

  const ticketMatch = pathname.match(/^\/boletas\/([^/]+)\/?$/);
  const maintenanceMatch = pathname.match(/^\/mantenimientos\/([^/]+)\/?$/);
  const ticketId = ticketMatch && !['pendientes', 'finalizadas', 'nueva'].includes(String(ticketMatch[1]).toLowerCase())
    ? decodeURIComponent(ticketMatch[1])
    : '';
  const maintenanceId = maintenanceMatch && !['nuevo'].includes(String(maintenanceMatch[1]).toLowerCase())
    ? decodeURIComponent(maintenanceMatch[1])
    : '';

  const isAdministrator = hasPermission('USUARIOS_GESTIONAR');
  const canDeleteTicket = isAdministrator || hasPermission('BOLETAS_EDITAR');
  const canManageMaintenanceDevices = isAdministrator
    || hasPermission('MANTENIMIENTOS_GESTIONAR')
    || hasPermission('MANTENIMIENTOS_ELIMINAR');
  const canTechnicianDeleteMaintenanceDevices = hasPermission('MANTENIMIENTOS_EDITAR')
    || hasPermission('BOLETAS_EDITAR');

  useEffect(() => {
    if ((!ticketId || !canDeleteTicket) && (!maintenanceId || (!canManageMaintenanceDevices && !canTechnicianDeleteMaintenanceDevices))) return undefined;
    let active = true;

    async function deleteTicket(button) {
      if (!window.confirm('¿Eliminar esta boleta? Se retirará de las listas operativas, pero sus datos permanecerán conservados para auditoría y respaldo.')) return;
      button.disabled = true;
      button.innerHTML = buttonMarkup('progress_activity', 'Eliminando...');
      try {
        await requestAvailable(MODULE_ROUTES.tickets.annul, {
          boletaUid: ticketId,
          BoletaUID: ticketId,
          estado: 'ANULADA',
        }, sessionToken);
        navigate('/boletas/pendientes', { replace: true });
      } catch (error) {
        window.alert(error.message || 'No se pudo eliminar la boleta.');
        if (active) {
          button.disabled = false;
          button.innerHTML = buttonMarkup('delete', 'Eliminar boleta');
        }
      }
    }

    async function deleteMaintenanceDevice(button, deviceId) {
      if (navigator.onLine === false) {
        window.alert('Para eliminar un dispositivo del mantenimiento debe recuperar la conexión a internet.');
        return;
      }
      if (!window.confirm('¿Eliminar este dispositivo del mantenimiento? El registro quedará marcado como inactivo para conservar trazabilidad.')) return;
      button.disabled = true;
      button.innerHTML = buttonMarkup('progress_activity', 'Eliminando...');
      try {
        await requestAvailable(MODULE_ROUTES.maintenance.deviceDelete, {
          maintenanceId,
          MantenimientoID: maintenanceId,
          deviceId,
          EvidenciaMantenimientoID: deviceId,
        }, sessionToken);
        window.dispatchEvent(new CustomEvent('dms-offline-sync-complete', { detail: { source: 'device-delete' } }));
      } catch (error) {
        window.alert(error.message || 'No se pudo eliminar el dispositivo.');
        if (active) {
          button.disabled = false;
          button.innerHTML = buttonMarkup('delete', 'Eliminar dispositivo');
        }
      }
    }

    function enhanceTicket() {
      if (!ticketId || !canDeleteTicket) return;
      const actions = document.querySelector('.ticket-detail-page .ticket-detail-actions');
      if (!actions || actions.querySelector('.dms-operational-delete-ticket')) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'button button--danger dms-operational-delete-ticket';
      button.innerHTML = buttonMarkup('delete', 'Eliminar boleta');
      button.addEventListener('click', () => void deleteTicket(button));
      actions.appendChild(button);
    }

    function enhanceMaintenanceDevices() {
      if (!maintenanceId || (!canManageMaintenanceDevices && !canTechnicianDeleteMaintenanceDevices)) return;
      const technicianAllowed = canTechnicianDeleteMaintenanceDevices && maintenanceIsPending();
      if (!canManageMaintenanceDevices && !technicianAllowed) return;
      document.querySelectorAll('.maintenance-detail-page .maintenance-inventory-expanded').forEach((container) => {
        const heading = container.querySelector('.maintenance-inventory-expanded__heading');
        const deviceId = maintenanceDeviceId(container);
        if (!heading || !deviceId || heading.querySelector('.dms-operational-delete-device')) return;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'button button--danger button--compact dms-operational-delete-device';
        button.innerHTML = buttonMarkup('delete', 'Eliminar dispositivo');
        button.addEventListener('click', () => void deleteMaintenanceDevice(button, deviceId));
        heading.appendChild(button);
      });
    }

    function enhance() {
      enhanceTicket();
      enhanceMaintenanceDevices();
    }

    enhance();
    const observer = new MutationObserver(enhance);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      active = false;
      observer.disconnect();
      document.querySelectorAll('.dms-operational-delete-ticket, .dms-operational-delete-device').forEach((node) => node.remove());
    };
  }, [
    ticketId,
    maintenanceId,
    canDeleteTicket,
    canManageMaintenanceDevices,
    canTechnicianDeleteMaintenanceDevices,
    sessionToken,
    navigate,
  ]);

  return null;
}
