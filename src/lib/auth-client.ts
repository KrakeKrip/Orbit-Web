import { createAuthClient } from "better-auth/react";

/**
 * Клиентский Better Auth (same-origin): серверный auth instance, пул БД и
 * секреты сюда не импортируются и в client bundle не попадают.
 */
export const authClient = createAuthClient();
