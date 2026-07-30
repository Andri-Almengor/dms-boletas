import { useCallback, useState } from 'react';
import {
  createTicketInlineRecord,
  EMPTY_TICKET_INLINE_VALUES,
  ticketInlineSelection,
} from './ticketQuickCreateService';

const INLINE_CATALOGS = Object.freeze({
  category: 'categories',
  failure: 'failures',
  device: 'devices',
  manufacturer: 'manufacturers',
  model: 'models',
});

export default function useTicketQuickCreate({
  form,
  setForm,
  sessionToken,
  reloadCatalogs,
  appendRelation,
  appendCatalog,
}) {
  const [modal, setModal] = useState(null);
  const [modalError, setModalError] = useState('');
  const [modalSaving, setModalSaving] = useState(false);

  const openModal = useCallback((type) => {
    setModal({ type, values: { ...EMPTY_TICKET_INLINE_VALUES } });
    setModalError('');
  }, []);

  const closeModal = useCallback(() => {
    if (modalSaving) return;
    setModal(null);
    setModalError('');
  }, [modalSaving]);

  const modalUpdate = useCallback((event) => {
    const { name, value } = event.target;
    setModal((current) => current ? {
      ...current,
      values: { ...current.values, [name]: value },
    } : current);
  }, []);

  const submitModal = useCallback(async (event) => {
    event.preventDefault();
    if (!modal) return;
    const { type, values } = modal;
    if (!values.nombre.trim()) {
      setModalError('El nombre es obligatorio.');
      return;
    }

    setModalSaving(true);
    setModalError('');
    try {
      const result = await createTicketInlineRecord({
        type,
        values,
        form,
        sessionToken,
      });
      const selection = ticketInlineSelection(type, result, values);
      if (selection.relation) {
        appendRelation(selection.relation, result);
      } else {
        const catalog = INLINE_CATALOGS[type];
        if (catalog && appendCatalog) appendCatalog(catalog, result);
        else await reloadCatalogs();
      }
      setForm((current) => ({ ...current, ...selection.patch }));
      setModal(null);
    } catch (error) {
      setModalError(error.message);
    } finally {
      setModalSaving(false);
    }
  }, [appendCatalog, appendRelation, form, modal, reloadCatalogs, sessionToken, setForm]);

  return {
    modal,
    modalError,
    modalSaving,
    openModal,
    closeModal,
    modalUpdate,
    submitModal,
  };
}
