export const OWNER_UID = 'GFJo0PH7VNYkoI3Fjgr2ytnjq9t1';

export function isOwnerUid(uid: string | null | undefined) {
  return Boolean(uid && uid === OWNER_UID);
}
