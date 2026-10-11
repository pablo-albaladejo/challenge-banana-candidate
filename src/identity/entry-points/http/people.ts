import { json } from '../../../platform/http/respond';
import { identity } from '../dependencies';
import type { PublicHandler } from '../../../platform/http/context';
export const listPeople: PublicHandler = () => json(identity().listPeople());
