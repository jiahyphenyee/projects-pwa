'use client';

// Who is looking, read once from the session after mount. `ready` matters to anything
// that routes by role: before it, every viewer looks like they can do nothing, and a
// redirect taken on that would send an admin to the wrong view.

import { useEffect, useState } from 'react';
import { getUser } from '@/lib/session';
import { can } from '@/lib/roles.mjs';

export function useViewer() {
  const [viewer, setViewer] = useState({ userName: '', role: '', ready: false });
  useEffect(() => {
    const u = getUser();
    setViewer({ userName: u?.name || '', role: u?.role || '', ready: true });
  }, []);
  return { ...viewer, can: permission => can(viewer.role, permission) };
}
