// Public surface of the identity feature: other features import only from here.
export { identity, type IdentityApp } from './entry-points/dependencies';
export { actor, sameOrigin } from './entry-points/http/session-guard';
export { listPeople } from './entry-points/http/people';
export { currentSession, selectPerson } from './entry-points/http/session';
export { personaSwitcherEnabled } from './entry-points/http/persona-switcher';
