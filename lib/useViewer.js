'use client';

// Who is looking, read once from the session after mount. `ready` matters to anything
// that routes by role: before it, every viewer looks like a non-admin, and a redirect
// taken on that would send an admin to the wrong view.

import { useEffect, useState } from 'react';
import { getUser } from '@/lib/session';
import { ADMIN_ROLES } from '@/lib/constants';

export function useViewer() {
  const [viewer, setViewer] = useState({ userName: '', isAdmin: false, ready: false });
  useEffect(() => {
    const u = getUser();
    setViewer({ userName: u?.name || '', isAdmin: !!u && ADMIN_ROLES.includes(u.role), ready: true });
  }, []);
  return viewer;
}
