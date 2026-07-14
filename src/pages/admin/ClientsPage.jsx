import React from 'react';
import CatalogManager from './CatalogManager';
import { MODULE_ROUTES, pick } from '../../services/moduleApi';

const empty = { id: '', name: '', contacto: '', telefono: '', correo: '', direccion: '', sitioWeb: '', chatWebhook: '', status: 'ACTIVO' };

const config = {
  title: 'Clientes',
  singular: 'cliente',
  description: 'Registra los datos de contacto utilizados por las boletas y, opcionalmente, un Chat de Google para sus reportes.',
  icon: 'corporate_fare',
  routes: MODULE_ROUTES.clients,
  sortBy: 'Nombre',
  createPermissions: ['CLIENTES_CREAR'],
  editPermissions: ['CLIENTES_EDITAR'],
  empty,
  emptyMessage: 'Crea el primer cliente para utilizarlo en las boletas.',
  fields: [
    { name: 'name', label: 'Nombre o razón social', required: true, wide: true },
    { name: 'contacto', label: 'Contacto' },
    { name: 'telefono', label: 'Teléfono' },
    { name: 'correo', label: 'Correo', type: 'email' },
    { name: 'sitioWeb', label: 'Sitio web', type: 'url' },
    { name: 'direccion', label: 'Dirección', type: 'textarea', wide: true },
    { name: 'chatWebhook', label: 'Webhook de Google Chat del cliente (opcional)', type: 'url', wide: true },
    { name: 'status', label: 'Estado', type: 'select', options: ['ACTIVO', 'INACTIVO'] },
  ],
  fromRecord: (record) => ({
    id: pick(record, ['ClienteID', 'ID', 'RowID', 'id']),
    name: pick(record, ['Clientes', 'Cliente', 'Nombre', 'name']),
    contacto: pick(record, ['Contacto', 'contacto']),
    telefono: pick(record, ['Telefonos', 'Teléfonos', 'Telefono', 'Teléfono', 'telefono']),
    correo: pick(record, ['CorreoGeneral', 'Correo', 'correo']),
    direccion: pick(record, ['DireccionEnvio', 'Dirección envío', 'Direccion', 'Dirección', 'direccion']),
    sitioWeb: pick(record, ['SitioWeb', 'Sitio web', 'Web', 'sitioWeb']),
    chatWebhook: pick(record, ['ChatWebhook', 'ChatWebhookURL', 'chatWebhook']),
    status: pick(record, ['Estado', 'estado'], 'ACTIVO'),
  }),
  toPayload: (form) => ({
    ...form,
    ClienteID: form.id,
    clienteId: form.id,
    Clientes: form.name,
    Cliente: form.name,
    Nombre: form.name,
    Contacto: form.contacto,
    Telefonos: form.telefono,
    Telefono: form.telefono,
    CorreoGeneral: form.correo,
    Correo: form.correo,
    DireccionEnvio: form.direccion,
    Direccion: form.direccion,
    SitioWeb: form.sitioWeb,
    ChatWebhook: form.chatWebhook,
    Estado: form.status,
  }),
  summary: (view) => [
    { label: 'contacto', icon: 'person', value: view.contacto, empty: 'Sin contacto' },
    { label: 'telefono', icon: 'call', value: view.telefono, empty: 'Sin teléfono' },
    { label: 'correo', icon: 'mail', value: view.correo, empty: 'Sin correo' },
    { label: 'chat', icon: 'chat', value: view.chatWebhook ? 'Chat de cliente configurado' : '', empty: 'Sin Chat asociado' },
    { label: 'direccion', icon: 'location_on', value: view.direccion, empty: 'Sin dirección' },
  ],
};

export default function ClientsPage() {
  return <CatalogManager config={config} />;
}
