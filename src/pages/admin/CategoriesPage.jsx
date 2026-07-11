import React from 'react';
import CatalogManager from './CatalogManager';
import { MODULE_ROUTES, pick } from '../../services/moduleApi';

const empty = { id: '', name: '', descripcion: '', status: 'ACTIVO' };

const config = {
  title: 'Categorías',
  singular: 'categoría',
  description: 'Define los tipos de servicio disponibles al crear boletas.',
  icon: 'category',
  routes: MODULE_ROUTES.categories,
  sortBy: 'Nombre',
  empty,
  emptyMessage: 'Crea la primera categoría para utilizarla en las boletas.',
  fields: [
    { name: 'name', label: 'Nombre', required: true },
    { name: 'status', label: 'Estado', type: 'select', options: ['ACTIVO', 'INACTIVO'] },
    { name: 'descripcion', label: 'Descripción', type: 'textarea', wide: true },
  ],
  fromRecord: (record) => ({
    id: pick(record, ['CategoriaID', 'ID', 'RowID', 'id']),
    name: pick(record, ['Nombre', 'Categoria', 'Categoría', 'name']),
    descripcion: pick(record, ['Descripcion', 'Descripción', 'description']),
    status: pick(record, ['Estado', 'estado'], 'ACTIVO'),
  }),
  toPayload: (form) => ({
    ...form,
    CategoriaID: form.id,
    categoriaId: form.id,
    Nombre: form.name,
    Categoria: form.name,
    Descripcion: form.descripcion,
    Estado: form.status,
  }),
  summary: (view) => [
    { label: 'descripcion', value: view.descripcion, empty: 'Sin descripción.' },
  ],
};

export default function CategoriesPage() {
  return <CatalogManager config={config} />;
}
