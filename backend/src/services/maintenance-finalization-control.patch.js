import { pick } from '../core/utils.js';
import { maintenanceAutomationHandlers } from '../modules/maintenance-automation.module.js';
import { maintenanceProgressChatHandlers } from '../modules/maintenance-progress-chat.module.js';
import { maintenanceFinalizationControlHandlers } from './maintenance-finalization-control.service.js';

const INSTALL_FLAG = Symbol.for('dms.maintenanceFinalizationControl');

function boolean(value) {
  return value === true || ['true', '1', 'si', 'sí', 'yes'].includes(String(value ?? '').trim().toLowerCase());
}

function activeListRequested(ctx) {
  return boolean(pick(ctx?.payload || {}, ['finalizationActiveOnly', 'soloFinalizacionesActivas'], false));
}

function stopRequested(ctx) {
  return boolean(pick(ctx?.payload || {}, ['stopFinalization', 'detenerFinalizacion'], false));
}

function install(target) {
  if (!target || target[INSTALL_FLAG]) return;

  const previousFinalize = target.finalize;
  if (typeof previousFinalize === 'function') {
    target.finalize = async (ctx) => {
      if (stopRequested(ctx)) return maintenanceFinalizationControlHandlers.stop(ctx);
      return previousFinalize(ctx);
    };
  }

  const previousList = target.list;
  if (typeof previousList === 'function') {
    target.list = async (ctx) => {
      if (activeListRequested(ctx)) return maintenanceFinalizationControlHandlers.listActive(ctx);
      return previousList(ctx);
    };
  }

  target[INSTALL_FLAG] = true;
}

install(maintenanceAutomationHandlers);
install(maintenanceProgressChatHandlers);
