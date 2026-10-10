import { people } from '../people';
import { json } from '../../platform/http/respond';
import type { PublicHandler } from '../../platform/http/context';
export const listPeople: PublicHandler = () => json(people);
