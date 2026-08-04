import { apiRequest } from '../api';

export const PASSWORD_VAULT_ROUTES = Object.freeze({
  dashboard: 'passwordVault.dashboard.get',
  categoryCreate: 'passwordVault.categories.create',
  categoryUpdate: 'passwordVault.categories.update',
  categoryDelete: 'passwordVault.categories.delete',
  credentialCreate: 'passwordVault.credentials.create',
  credentialUpdate: 'passwordVault.credentials.update',
  credentialDelete: 'passwordVault.credentials.delete',
  credentialReveal: 'passwordVault.credentials.reveal',
});

export function getPasswordVaultDashboard(payload, sessionToken, options = {}) {
  return apiRequest(PASSWORD_VAULT_ROUTES.dashboard, payload || {}, sessionToken, options);
}

export function createPasswordVaultCategory(payload, sessionToken) {
  return apiRequest(PASSWORD_VAULT_ROUTES.categoryCreate, payload, sessionToken);
}

export function updatePasswordVaultCategory(payload, sessionToken) {
  return apiRequest(PASSWORD_VAULT_ROUTES.categoryUpdate, payload, sessionToken);
}

export function deletePasswordVaultCategory(categoryId, sessionToken) {
  return apiRequest(PASSWORD_VAULT_ROUTES.categoryDelete, { categoryId }, sessionToken);
}

export function createPasswordVaultCredential(payload, sessionToken) {
  return apiRequest(PASSWORD_VAULT_ROUTES.credentialCreate, payload, sessionToken);
}

export function updatePasswordVaultCredential(payload, sessionToken) {
  return apiRequest(PASSWORD_VAULT_ROUTES.credentialUpdate, payload, sessionToken);
}

export function deletePasswordVaultCredential(credentialId, sessionToken) {
  return apiRequest(PASSWORD_VAULT_ROUTES.credentialDelete, { credentialId }, sessionToken);
}

export function revealPasswordVaultCredential(credentialId, sessionToken) {
  return apiRequest(PASSWORD_VAULT_ROUTES.credentialReveal, { credentialId }, sessionToken);
}
