import { json } from '../../../platform/http/respond';
import { identity } from '../dependencies';
import { requirePersonaSwitcher } from './persona-switcher';
import type { PublicHandler } from '../../../platform/http/context';
export const listPeople: PublicHandler = () => {
  requirePersonaSwitcher();
  return json(identity().listPeople());
};
