import { useEffect, useState } from 'react';
import { apiRequest } from '../api';
import { useAuth } from '../AuthContext';

export default function useRoles() {
  const { sessionToken } = useAuth();
  const [roles, setRoles] = useState([]);
  const [error, setError] = useState('');

  async function loadRoles() {
    setError('');
    try {
      const data = await apiRequest(
        'roles.list',
        { page: 1, pageSize: 200, sortBy: 'Nombre', sortDir: 'asc' },
        sessionToken,
      );
      setRoles(data.items || []);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    loadRoles();
  }, [sessionToken]);

  return { roles, error, reload: loadRoles };
}
